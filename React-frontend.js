'use strict';
const { Contract } = require('fabric-contract-api');


class HRContract extends Contract {
    // SSI/ZKP VERIFICATION FUNCTION
    async VerifyEmployeeZKP(ctx, employeeId, zkProofPayload) {
        console.info(`Validating Zero Knowledge Proof for Employee: ${employeeId}`);
        
        // Parse the proof submitted by the Employee's wallet app
        const proof = JSON.parse(zkProofPayload);

        // Simulate complex ZKP math verification
        // In reality, this checks the cryptographic curve points against the Gov's public key
        const isMathValid = (proof.signature && proof.issuer === "GOV_AUTHORITY");

        if (!isMathValid) {
            throw new Error('ZKP Verification Failed. Cryptographic proof is invalid or manipulated.');
        }

        // The Magic of SSI: We record the VERIFICATION, but we NEVER record the National ID
        const verificationRecord = {
            docType: 'employee_zkp_verification',
            employeeId: employeeId,          // Just an internal company ID, NOT the National ID
            status: 'VERIFIED_VIA_ZKP',
            issuerAuthority: proof.issuer,
            verifiedAt: new Date().toISOString()
        };

        // Save it to the blockchain
        await ctx.stub.putState(employeeId, Buffer.from(JSON.stringify(verificationRecord)));
        
        return JSON.stringify(verificationRecord);
    }
    
    // ==========================================
    // 1. Create Employee
    // ==========================================
    async createEmployee(ctx, id, name, dept, salary) {
        const exists = await ctx.stub.getState(id);
        if (exists && exists.length > 0) {
            throw new Error(`The employee ${id} already exists`);
        }
        
        const employee = { id, name, dept, salary };
        await ctx.stub.putState(id, Buffer.from(JSON.stringify(employee)));
        return JSON.stringify(employee);
    }

    // ==========================================
    // 2. Read Employee
    // ==========================================
    async readEmployee(ctx, id) {
        const employeeJSON = await ctx.stub.getState(id);
        if (!employeeJSON || employeeJSON.length === 0) {
            throw new Error(`The employee ${id} does not exist`);
        }
        return employeeJSON.toString();
    }

    // ==========================================
    // 3. Update Employee (NEW)
    // ==========================================
    async updateEmployee(ctx, id, name, dept, salary) {
        // Step 1: Check if the employee actually exists on the ledger
        const employeeJSON = await ctx.stub.getState(id);
        if (!employeeJSON || employeeJSON.length === 0) {
            throw new Error(`The employee ${id} does not exist and cannot be updated.`);
        }

        // Step 2: Overwrite the old state with the new data
        // Note: In Fabric, putState completely overwrites the existing key
        const updatedEmployee = { id, name, dept, salary };
        await ctx.stub.putState(id, Buffer.from(JSON.stringify(updatedEmployee)));
        
        return JSON.stringify(updatedEmployee);
    }

    // ==========================================
    // 4. Get Employee History (For Thesis Testing)
    // ==========================================
    async getEmployeeHistory(ctx, id) {
        const iterator = await ctx.stub.getHistoryForKey(id);
        const allResults = [];

        while (true) {
            const res = await iterator.next();
            if (res.value && res.value.value.toString()) {
                let jsonRes = {};
                jsonRes.txId = res.value.txId;
                jsonRes.timestamp = res.value.timestamp;
                jsonRes.isDelete = res.value.isDelete;
                
                try {
                    jsonRes.data = JSON.parse(res.value.value.toString('utf8'));
                } catch (err) {
                    jsonRes.data = res.value.value.toString('utf8');
                }
                allResults.push(jsonRes);
            }
            if (res.done) {
                await iterator.close();
                return JSON.stringify(allResults);
            }
        }
    }
}

module.exports = HRContract;