# Blockchain-based-HR-Management-System-for-Secure-and-Transparent-Employee-Records

## Project Overview
This repository contains the core infrastructure for a privacy-preserving HR management system. It bridges the gap between traditional enterprise web interfaces and immutable distributed ledger technology, utilizing Zero-Knowledge Proofs (ZKPs) and off-chain trust anchors to ensure strict data minimization and compliance.

## System Architecture and Codebase

The architecture is decoupled into four primary layers:

*   **Web2.5 Orchestration Gateway (Backend API):** An Express.js Node server that acts as a secure custodian, translating standard REST HTTP actions into cryptographically signed gRPC transactions for the Hyperledger Fabric network. It manages a shared gateway state for standard operations while handling unique identity flows for SSI onboarding.
*   **Smart Contract Execution (Chaincode):** The Hyperledger Fabric `HRContract` validates zero-knowledge proofs submitted during onboarding to ensure cryptographic proof of identity without storing sensitive National IDs on the ledger. It also handles the creation, reading, and updating of employee states, alongside querying the immutable block history.
*   **External Trust Anchor (Mock Government API):** An independent Node.js service utilizing an RSA-2048 private key to simulate a government authority. It issues highly guarded digital credentials by generating SHA-256 digital signatures that wrap the employee's National ID.
*   **Presentation Layer (Frontend):** A lightweight React Single Page Application (SPA) designed to provide a seamless, enterprise-grade user experience.

