# Changelog

All notable changes to the Veridex SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-XX

### Added

- **Core SDK**
  - `createSDK()` factory function for easy initialization
  - `VeridexSDK` class with full passkey authentication support
  - `PasskeyManager` for WebAuthn credential registration and authentication
  - `WalletManager` for deterministic vault address derivation
  - `BalanceManager` for multi-chain balance queries
  - `TransactionTracker` for transaction status monitoring

- **Chain Support**
  - EVM chains: Base, Optimism, Arbitrum, Ethereum, Polygon, and more
  - Solana: SPL token and SOL transfer support
  - Aptos: Fungible asset and APT transfer support
  - Sui: Coin and SUI transfer support
  - Starknet: Custom bridge with multi-relayer attestations

- **Cross-Chain Features**
  - Wormhole VAA-based cross-chain messaging
  - Cross-chain balance queries via Wormhole CCQ
  - Bridge operations between supported chains
  - Unified identity across all chains

- **Session Keys**
  - `SessionManager` for temporary delegated access
  - Time-limited sessions with value caps
  - Secure key generation and storage
  - Session revocation support

- **Gasless Transactions**
  - `RelayerClient` for sponsored transactions
  - `GasSponsor` for integrator-sponsored vault creation
  - Automatic gas estimation and relaying

- **Security**
  - P-256 (secp256r1) signature verification
  - RIP-7212 precompile support where available
  - FCL fallback for chains without precompile
  - Replay protection via nonces
  - Guardian quorum validation (13/19)

- **Utilities**
  - Payload encoding/decoding functions
  - VAA parsing and validation
  - Chain ID mappings and constants
  - Error handling with categorized error codes

### Security

- WebAuthn challenge binding enforced
- Signature malleability protections
- Cross-chain message validation
- Nonce-based replay prevention

---

## [Unreleased]

### Planned

- React hooks package (`@veridex/react`)
- Vue composables package (`@veridex/vue`)
- Wallet adapter integrations
- Additional chain support (NEAR, Cosmos)
