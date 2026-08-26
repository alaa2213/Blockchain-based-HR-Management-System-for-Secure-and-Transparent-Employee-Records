const express = require('express');
const cors = require('cors');
const axios = require('axios');
const grpc = require('@grpc/grpc-js');
const { connect, signers } = require('@hyperledger/fabric-gateway');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ── Fabric Paths ────────────────────────────────────────────
const cryptoPath = path.resolve(__dirname, '..', 'fabric-samples', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com');
const tlsCertPath = path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
const certPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts', 'User1@org1.example.com-cert.pem');
const keyDirectoryPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore');
const keyPath = path.resolve(keyDirectoryPath, fs.readdirSync(keyDirectoryPath)[0]);

// ── Shared Gateway State ─────────────────────────────────────
let sharedClient   = null;
let sharedGateway  = null;
let sharedContract = null;
let isConnecting   = false;

async function getSharedContract() {
    // If already connected return immediately
    if (sharedContract) return sharedContract;

    // Prevent multiple simultaneous connection attempts
    if (isConnecting) {
        await new Promise(resolve => setTimeout(resolve, 100));
        return getSharedContract();
    }

    isConnecting = true;
    try {
        console.log('🔗 Initializing shared Fabric Gateway connection...');

        const tlsRootCert = fs.readFileSync(tlsCertPath);
        const certificate = fs.readFileSync(certPath);
        const privateKey  = fs.readFileSync(keyPath);

        sharedClient = new grpc.Client(
            'localhost:7051',
            grpc.credentials.createSsl(tlsRootCert)
        );

        sharedGateway = connect({
            client: sharedClient,
            identity: { mspId: 'Org1MSP', credentials: certificate },
            signer: signers.newPrivateKeySigner(crypto.createPrivateKey(privateKey)),
        });

        const network  = sharedGateway.getNetwork('hrchannel');
        sharedContract = network.getContract('employee');

        console.log('✅ Shared Fabric Gateway connected successfully.');
        return sharedContract;
    } catch (error) {
        // Reset state on failure so next request retries
        sharedClient   = null;
        sharedGateway  = null;
        sharedContract = null;
        console.error('❌ Failed to connect shared gateway:', error.message);
        throw error;
    } finally {
        isConnecting = false;
    }
}

// ── Graceful shutdown — close shared gateway on exit ─────────
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function shutdown(signal) {
    console.log(`\n${signal} received. Closing shared Fabric Gateway...`);
    if (sharedGateway) sharedGateway.close();
    if (sharedClient)  sharedClient.close();
    process.exit(0);
}

// ── Helper for onboarding (still per-request — needs own identity) ──
async function getNetworkContract() {
    const tlsRootCert = fs.readFileSync(tlsCertPath);
    const certificate = fs.readFileSync(certPath);
    const privateKey  = fs.readFileSync(keyPath);

    const client = new grpc.Client(
        'localhost:7051',
        grpc.credentials.createSsl(tlsRootCert)
    );
    const gateway = connect({
        client,
        identity: { mspId: 'Org1MSP', credentials: certificate },
        signer: signers.newPrivateKeySigner(crypto.createPrivateKey(privateKey)),
    });

    const network  = gateway.getNetwork('hrchannel');
    const contract = network.getContract('employee');
    return { contract, gateway, client };
}

// ══════════════════════════════════════════════════════════════
// ENDPOINT 1: Add Employee
// ══════════════════════════════════════════════════════════════
app.post('/api/add', async (req, res) => {
    const { id, name, dept, salary } = req.body;
    try {
        const contract = await getSharedContract();  // ← shared

        const blockchainStart = performance.now();
        await contract.submitTransaction('createEmployee', id, name, dept, salary);
        const blockchainLatency = performance.now() - blockchainStart;

        res.status(200).json({
            message: `Success! ${name} added.`,
            blockchainLatencyMs: blockchainLatency.toFixed(2)
        });
    } catch (error) {
        // Reset shared connection on error so it reconnects next request
        sharedContract = null;
        res.status(500).json({ error: error.message });
    }
});

// ══════════════════════════════════════════════════════════════
// ENDPOINT 2: Read Employee
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// ENDPOINT 2: Read Employee (Sanitized for HR Frontend)
// ══════════════════════════════════════════════════════════════
app.get('/api/read/:id', async (req, res) => {
    try {
        const contract = await getSharedContract();  // ← shared

        console.log(`Querying World State for: ${req.params.id}`);
        const resultBytes = await contract.evaluateTransaction('readEmployee', req.params.id);
        const resultJson  = Buffer.from(resultBytes).toString('utf8');
        
        // 1. Parse the raw ledger data (which includes ZKP data)
        const rawEmployeeData = JSON.parse(resultJson);

        // 2. Sanitize the payload: Extract ONLY the HR-specific fields
        // Modify these keys if your chaincode uses different property names
        const sanitizedHrData = {
            id: rawEmployeeData.id || rawEmployeeData.employeeId,
            name: rawEmployeeData.name,
            dept: rawEmployeeData.dept,
            salary: rawEmployeeData.salary,
            // Optionally pass a flag so the UI knows they are verified, 
            // without sending the massive cryptographic proof
           
        };

        // 3. Send the clean data to the React dashboard
        res.status(200).json(sanitizedHrData);
        
    } catch (error) {
        sharedContract = null;  // ← reset on error
        console.error('Error:', error.message);
        res.status(500).json({ error: 'Employee not found or ledger error.' });
    }
});

// ══════════════════════════════════════════════════════════════
// ENDPOINT 3: Update Employee
// ══════════════════════════════════════════════════════════════
app.put('/api/employee/:id', async (req, res) => {
    const { id } = req.params;
    const { name, dept, salary } = req.body;

    try {
        console.log(`\n➡️ Received request to update employee: ${id}`);
        const contract = await getSharedContract();  // ← shared

        const blockchainStart = performance.now();
        const resultBytes     = await contract.submitTransaction('updateEmployee', id, name, dept, salary.toString());
        const blockchainLatency = performance.now() - blockchainStart;

        const rawString   = Buffer.from(resultBytes).toString('utf8');
        const cleanString = rawString.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();

        res.status(200).json({
            message: `Success! Employee ${id} updated on the ledger.`,
            data: JSON.parse(cleanString),
            blockchainLatencyMs: blockchainLatency.toFixed(2)
        });
    } catch (error) {
        sharedContract = null;  // ← reset on error
        console.error('❌ Error updating employee:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ══════════════════════════════════════════════════════════════
// ENDPOINT 4: Get Employee History
// ══════════════════════════════════════════════════════════════
app.get('/api/employee/history/:id', async (req, res) => {
    const { id } = req.params;

    try {
        console.log(`\n➡️ Querying history for employee: ${id}`);
        const contract = await getSharedContract();  // ← shared

        const rawBytes    = await contract.evaluateTransaction('getEmployeeHistory', id);
        const rawString   = Buffer.from(rawBytes).toString('utf8');
        const cleanString = rawString.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();

        console.log(`Decoded Ledger String:`, cleanString);

        res.status(200).json({
            message: `History retrieved for ${id}`,
            data: JSON.parse(cleanString)
        });
    } catch (error) {
        sharedContract = null;  // ← reset on error
        console.error('❌ Error fetching history:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ══════════════════════════════════════════════════════════════
// ENDPOINT 5: SSI Onboard Employee (keeps per-request gateway
//             because it uses a different identity flow)
// ══════════════════════════════════════════════════════════════
app.post('/api/onboard-employee', async (req, res) => {
    const { employeeId, employeeName, rawNationalId } = req.body;

    if (!employeeId || !employeeName || !rawNationalId) {
        return res.status(400).json({ error: "Missing required fields." });
    }

    console.log(`\n--- Starting SSI Onboarding for ${employeeName} ---`);

    let fabric;
    let gatewayToDisconnect;

    const totalStart = performance.now();
    let govLatencyMs        = null;
    let blockchainLatencyMs = null;

    try {
        // 1. Gov API
        console.log(`1. Requesting ZKP Credential from Gov API...`);
        const govStart    = performance.now();
        const govResponse = await axios.post('http://localhost:3002/issue-credential', {
            employeeName: employeeName,
            nationalId:   rawNationalId
        });
        govLatencyMs = (performance.now() - govStart).toFixed(2);
        console.log(`   ✅ Credential received! (${govLatencyMs}ms)`);

        const zkProofPayload = govResponse.data;

        // 2. Blockchain
        console.log(`2. Connecting to Fabric & Submitting ZKP...`);
        fabric = await getNetworkContract();  // ← per-request for onboarding

        let contract;
        if (fabric.contract) {
            contract = fabric.contract;
            gatewayToDisconnect = fabric.gateway;
        } else {
            contract = fabric;
            gatewayToDisconnect = contract.network ? contract.network.gateway : null;
        }

        if (!contract) throw new Error("Smart contract failed to connect.");

        const payloadString   = JSON.stringify(zkProofPayload);
        const blockchainStart = performance.now();
        const resultBytes     = await contract.submitTransaction('VerifyEmployeeZKP', employeeId, payloadString);
        blockchainLatencyMs   = (performance.now() - blockchainStart).toFixed(2);
        console.log(`   ✅ Blockchain Verification Complete! (${blockchainLatencyMs}ms)`);

        const rawResultString = resultBytes.toString('utf8');
        let resultJson;
        try {
            resultJson = JSON.parse(rawResultString);
        } catch {
            resultJson = { raw_data: rawResultString };
        }

        const totalLatencyMs = (performance.now() - totalStart).toFixed(2);
        console.log(`   ✅ Total onboarding time: ${totalLatencyMs}ms`);

        res.status(200).json({
            success: true,
            message: "Employee successfully verified.",
            blockchainRecord: resultJson,
            latency: {
                govApiLatencyMs:     parseFloat(govLatencyMs),
                blockchainLatencyMs: parseFloat(blockchainLatencyMs),
                totalLatencyMs:      parseFloat(totalLatencyMs),
                overheadLatencyMs:   parseFloat(
                    (totalLatencyMs - govLatencyMs - blockchainLatencyMs).toFixed(2)
                )
            }
        });

    } catch (error) {
        if (error.response) {
            console.error(`❌ Gov API Error:`, error.response.data);
            res.status(502).json({ error: "Government API failed to issue credential.", details: error.response.data });
        } else {
            console.error(`❌ Blockchain Error:`, error.message);
            res.status(500).json({ error: "Blockchain verification failed.", details: error.message });
        }
    } finally {
        if (gatewayToDisconnect && typeof gatewayToDisconnect.disconnect === 'function') {
            console.log("3. Disconnecting from Fabric Gateway...");
            gatewayToDisconnect.disconnect();
        }
    }
});

// ══════════════════════════════════════════════════════════════
const PORT = 3005;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n=============================================`);
    console.log(`🚀 Web Dashboard Running!`);
    console.log(`🌐 Open your browser to: http://localhost:${PORT}`);
    console.log(`=============================================\n`);

    // Pre-warm the shared gateway on startup
    getSharedContract()
        .then(() => console.log('✅ Gateway pre-warmed and ready.\n'))
        .catch(err => console.error('⚠️  Gateway pre-warm failed:', err.message));
});