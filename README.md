# @veridex/sdk

[![npm version](https://img.shields.io/npm/v/@veridex/sdk.svg)](https://www.npmjs.com/package/@veridex/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Passkey-based cross-chain identity and authentication.** One passkey. Every chain.

Register a WebAuthn passkey once, get a deterministic vault address on every supported chain. No seed phrases, no private keys, no browser extensions.

```bash
npm install @veridex/sdk ethers
```

```typescript
import { createSDK } from '@veridex/sdk';

const sdk = createSDK('base');

// Register a passkey (biometric prompt)
const credential = await sdk.passkey.register('user@example.com', 'My Wallet');

// Same vault address on every EVM chain
const vault = sdk.getVaultAddress();

// Transfer tokens (gasless via relayer)
await sdk.transferViaRelayer({
  token: USDC_ADDRESS,
  recipient: '0x742d35Cc...',
  amount: 1000000n, // 1 USDC
});
```

## Architecture

```
                    ┌─────────────────────┐
                    │   WebAuthn Passkey   │
                    │   (P-256 / secp256r1)│
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │    Veridex Hub      │
                    │   (Base / EVM)      │
                    │  Identity + Vaults  │
                    └──────────┬──────────┘
                               │ Wormhole / Custom Bridge
          ┌────────┬───────────┼───────────┬────────┬────────┐
          ▼        ▼           ▼           ▼        ▼        ▼
       Solana   Aptos       Sui      Starknet   Stacks    EVM Spokes
      (Ed25519) (Ed25519) (secp256k1) (Stark)  (secp256r1) (Opt/Arb/Poly)
```

**Hub-and-Spoke model**: Identity lives on the Hub (Base). Actions are dispatched to spoke chains via Wormhole guardian-attested messages or custom bridge attestations.

## Supported Chains

| Chain | Type | Wormhole ID | Signature | Networks |
|-------|------|-------------|-----------|----------|
| **Base** | Hub (EVM) | 30 | secp256r1 (passkey) + secp256k1 (session) | Sepolia + Mainnet |
| **Ethereum** | Spoke (EVM) | 2 | secp256r1 + secp256k1 | Sepolia + Mainnet |
| **Optimism** | Spoke (EVM) | 24 | secp256r1 + secp256k1 | Sepolia + Mainnet |
| **Arbitrum** | Spoke (EVM) | 23 | secp256r1 + secp256k1 | Sepolia + Mainnet |
| **Polygon** | Spoke (EVM) | 5 | secp256r1 + secp256k1 | Amoy + Mainnet |
| **Solana** | Spoke | 1 | Ed25519 | Devnet + Mainnet |
| **Aptos** | Spoke | 22 | Ed25519 | Testnet + Mainnet |
| **Sui** | Spoke | 21 | secp256k1 | Testnet + Mainnet |
| **Starknet** | Spoke | 50001 | Stark ECDSA | Sepolia + Mainnet |
| **Stacks** | Spoke | 60 | secp256r1 (native!) + secp256k1 | Testnet + Mainnet |

## Key Features

### Passkey Authentication (No Seed Phrases)

```typescript
// Register — triggers biometric prompt
const credential = await sdk.passkey.register('user@example.com', 'My Wallet');

// Authenticate — biometric verification
const signature = await sdk.passkey.sign(challenge);
```

- **RIP-7212** native P-256 verification on EVM (~3,450 gas)
- **FCL fallback** for chains without precompile
- **Stacks** has native `secp256r1-verify` in Clarity — no workarounds needed

### Deterministic Vaults

```typescript
// Same address on Base, Optimism, Arbitrum, Ethereum, Polygon
const vault = sdk.getVaultAddress();

// Vault is derived from your passkey — no deployment needed on spokes
```

### Session Keys

Delegate temporary access with spending limits — no repeated biometric prompts:

```typescript
const session = await sdk.sessions.create({
  duration: 3600,           // 1 hour
  maxValue: parseEther('0.1'),
  allowedChains: [30, 1],  // Base + Solana
});

// Multiple transactions without prompts
await sdk.sessions.transfer(session, { token, recipient, amount });
await sdk.sessions.transfer(session, { token, recipient, amount });

// Revoke anytime
await sdk.sessions.revoke(session);
```

### Gasless Transactions

```typescript
const sdk = createSDK('base', {
  relayerUrl: 'https://relayer.veridex.network',
  relayerApiKey: 'your-api-key',
});

// Relayer sponsors gas — user pays nothing
await sdk.transferViaRelayer({
  token: USDC_ADDRESS,
  recipient: '0x...',
  amount: 1000000n,
});
```

### Cross-Chain Bridging

```typescript
import { parseUnits } from 'ethers';

// Bridge USDC from Base to Optimism via Wormhole
await sdk.bridge({
  targetChain: 'optimism',
  token: USDC_ADDRESS,
  amount: parseUnits('100', 6),
  recipient: '0x...', // defaults to your vault
});
```

## Chain Clients

Each chain has a dedicated client implementing the `ChainClient` interface:

```typescript
import { EVMClient } from '@veridex/sdk/chains/evm';
import { SolanaClient } from '@veridex/sdk/chains/solana';
import { AptosClient } from '@veridex/sdk/chains/aptos';
import { SuiClient } from '@veridex/sdk/chains/sui';
import { StarknetClient } from '@veridex/sdk/chains/starknet';
import { StacksClient } from '@veridex/sdk/chains/stacks';
```

All clients support:
- `buildTransferPayload()` — Build token transfer payloads
- `buildExecutePayload()` — Build arbitrary execution payloads
- `buildBridgePayload()` — Build cross-chain bridge payloads
- `dispatch()` / `dispatchGasless()` — Submit signed actions
- `getBalance()` / `getTokenBalance()` — Query balances
- `createVault()` / `createVaultViaRelayer()` — Vault management

### Stacks-Specific

Stacks has unique capabilities leveraged by the SDK:

```typescript
import { StacksClient } from '@veridex/sdk/chains/stacks';
import {
  compressPublicKey,
  rsToCompactSignature,
  parseDERSignature,
} from '@veridex/sdk/chains/stacks';

// Native secp256r1 verification (no ZK proofs needed)
// Native sponsored transactions (gasless built-in)
// Post-conditions for protocol-level spending safety
```

## API Reference

### Core Exports

| Export | Description |
|--------|-------------|
| `createSDK(chain, config?)` | Create SDK instance for a chain |
| `VeridexSDK` | Main SDK class |
| `PasskeyManager` | WebAuthn credential management |
| `WalletManager` | Deterministic vault address derivation |
| `SessionManager` | Session key lifecycle management |

### Utilities

```typescript
import {
  encodeTransferAction,
  encodeExecuteAction,
  encodeBridgeAction,
  parseVAA,
  fetchVAA,
  WORMHOLE_CHAIN_IDS,
  TESTNET_CHAINS,
  MAINNET_CHAINS,
} from '@veridex/sdk';
```

### Types

```typescript
import type {
  ChainName,
  ChainClient,
  ChainConfig,
  NetworkType,
  SimpleSDKConfig,
  TransferParams,
  ExecuteParams,
  BridgeParams,
  SessionKey,
  WebAuthnSignature,
  DispatchResult,
  VaultCreationResult,
} from '@veridex/sdk';
```

## Security

- **Passkeys only** — No EOA, no seed phrases, no browser extensions
- **RIP-7212** — Native P-256 verification (~3,450 gas on EVM)
- **FCL fallback** — Software verification when precompile unavailable
- **Wormhole VAA** — 13/19 guardian quorum for cross-chain messages
- **Custom bridge** — Multi-relayer threshold attestations for Starknet
- **Replay protection** — Nonce-based action deduplication on all chains
- **Post-conditions** — Protocol-level spending caps on Stacks

## Browser Support

WebAuthn requires HTTPS and a compatible browser:

| Browser | Minimum Version |
|---------|-----------------|
| Chrome | 67+ |
| Firefox | 60+ |
| Safari | 14+ |
| Edge | 18+ |

## Related Packages

| Package | Description |
|---------|-------------|
| [`@veridex/agentic-payments`](https://www.npmjs.com/package/@veridex/agentic-payments) | Agent payment SDK — x402, UCP, ACP, AP2 |
| `@veridex/relayer` | Transaction relayer for gasless execution |
| `@veridex/contracts` | Smart contracts (EVM, Solana, Aptos, Sui, Starknet, Stacks) |

## License

MIT

## Links

- [Documentation](https://docs.veridex.network)
- [GitHub](https://github.com/Veridex-Protocol/sdk)
- [npm](https://www.npmjs.com/package/@veridex/sdk)
- [Discord](https://discord.gg/veridex)
- [Twitter](https://twitter.com/VeridexProtocol)
