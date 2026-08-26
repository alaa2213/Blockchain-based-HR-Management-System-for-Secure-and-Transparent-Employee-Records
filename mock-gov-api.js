const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

// The Government's highly guarded private key
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

app.post('/issue-credential', (req, res) => {
    const { employeeName, nationalId } = req.body;

    if (!nationalId) {
        return res.status(400).send({ error: "National ID required for issuance" });
    }

    // The Government creates a digital signature wrapping the National ID
    const sign = crypto.createSign('SHA256');
    sign.update(nationalId);
    sign.end();
    const signature = sign.sign(privateKey, 'hex');

    console.log(`[GOV] Credential successfully issued for ${employeeName}`);

    // This JSON is sent to the Employee's Phone/Wallet App
    res.json({
        issuer: "GOV_AUTHORITY",
        credentialType: "National_ID_V1",
        employeeName: employeeName,
        signature: signature // The math proof they will send to the blockchain
    });
});

app.listen(3002, () => console.log('Mock Government SSI API running on port 3002'));