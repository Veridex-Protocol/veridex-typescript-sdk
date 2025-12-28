# @veridex/sdk

Veridex Protocol SDK - Client library for **Passkey-based cross-chain authentication**.

Build applications with WebAuthn/Passkeys (P-256) that work across EVM, Solana, Aptos, Sui, and Starknet.

## Features

- **Passkey Authentication** - WebAuthn P-256 signature verification (no seed phrases)
- **Cross-Chain Support** - EVM, Solana, Aptos, Sui, Starknet
- **Deterministic Vaults** - Same address across all EVM chains
- **Gasless Transactions** - Relayer-sponsored execution
- **Session Keys** - Temporary delegated access for smooth UX
- **Wormhole Integration** - Guardian-attested cross-chain messaging

## Installation

```bash
npm install @veridex/sdk ethers
# or
yarn add @veridex/sdk ethers
# or
bun add @veridex/sdk ethers
```

## Quick Start

```typescript
import { createSDK } from '@veridex/sdk';

// Initialize SDK (testnet by default)
const sdk = createSDK('base');

// Register a passkey
const credential = await sdk.passkey.register('user@example.com', 'My Wallet');

// Get your vault address (same on all EVM chains!)
const vaultAddress = sdk.getVaultAddress();
console.log('Your vault:', vaultAddress);

// Transfer tokens
await sdk.transfer({
  token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC
  recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f5A234',
  amount: 1000000n, // 1 USDC (6 decimals)
});
```

## Networks

```typescript
// Testnet (default)
const testnetSdk = createSDK('base');

// Mainnet
const mainnetSdk = createSDK('base', { network: 'mainnet' });

// Custom RPC
const customSdk = createSDK('base', { 
  rpcUrl: 'https://my-rpc.example.com' 
});
```

## Supported Chains

| Chain | Type | Status |
|-------|------|--------|
| Base | Hub (EVM) | Testnet + Mainnet |
| Optimism | Spoke (EVM) | Testnet + Mainnet |
| Arbitrum | Spoke (EVM) | Testnet + Mainnet |
| Ethereum | Spoke (EVM) | Testnet + Mainnet |
| Polygon | Spoke (EVM) | Testnet + Mainnet |
| Solana | Spoke | Devnet + Mainnet |
| Aptos | Spoke | Testnet + Mainnet |
| Sui | Spoke | Testnet + Mainnet |
| Starknet | Spoke | Sepolia + Mainnet |

## Gasless Transactions

```typescript
const sdk = createSDK('base', {
  relayerUrl: 'https://relayer.veridex.io',
  relayerApiKey: 'your-api-key',
});

// Transfers are now gasless
await sdk.transferViaRelayer({
  token: USDC_ADDRESS,
  recipient: '0x...',
  amount: 1000000n,
});
```

## Session Keys

Enable seamless UX without repeated biometric prompts:

```typescript
// Create a 1-hour session with 0.1 ETH limit
const session = await sdk.sessions.create({
  duration: 3600,
  maxValue: parseEther('0.1'),
});

// Execute multiple transactions without prompts
await sdk.sessions.transfer(session, { ... });
await sdk.sessions.transfer(session, { ... });

// Revoke when done
await sdk.sessions.revoke(session);
```

## Cross-Chain Bridging

```typescript
import { parseUnits } from 'ethers';

await sdk.bridge({
  targetChain: 'optimism',
  token: USDC_ADDRESS,
  amount: parseUnits('100', 6),
  recipient: '0x...', // Optional, defaults to your vault
});
```

## API Reference

### Core

| Export | Description |
|--------|-------------|
| `createSDK(chain, config?)` | Create SDK for a chain |
| `VeridexSDK` | Main SDK class |
| `PasskeyManager` | WebAuthn credential management |
| `WalletManager` | Vault address derivation |
| `SessionManager` | Session key management |

### Chain Clients

```typescript
import { EVMClient } from '@veridex/sdk/chains/evm';
import { SolanaClient } from '@veridex/sdk/chains/solana';
import { AptosClient } from '@veridex/sdk/chains/aptos';
import { SuiClient } from '@veridex/sdk/chains/sui';
import { StarknetClient } from '@veridex/sdk/chains/starknet';
```

### Utilities

```typescript
import { 
  encodeTransferAction,
  encodeBridgeAction,
  parseVAA,
  fetchVAA,
} from '@veridex/sdk';
```

### Constants

```typescript
import { 
  WORMHOLE_CHAIN_IDS,
  TESTNET_CHAINS,
  MAINNET_CHAINS,
} from '@veridex/sdk';
```

## Security

- **Passkeys Only** - No EOA or seed phrase assumptions
- **RIP-7212 Support** - Native P-256 verification (~3,450 gas)
- **FCL Fallback** - Software verification when precompile unavailable
- **Wormhole VAA** - 13/19 guardian quorum for cross-chain messages
- **Replay Protection** - Nonce-based action deduplication

## Browser Support

WebAuthn requires a secure context (HTTPS) and a compatible browser:

| Browser | Minimum Version |
|---------|-----------------|
| Chrome | 67+ |
| Firefox | 60+ |
| Safari | 14+ |
| Edge | 18+ |

## TypeScript

Full TypeScript support with comprehensive type definitions:

```typescript
import type {
  ChainName,
  NetworkType,
  SimpleSDKConfig,
  TransferParams,
  BridgeParams,
  SessionKey,
} from '@veridex/sdk';
```

## License

MIT

## Links

- [Documentation](https://docs.veridex.io)
- [GitHub](https://github.com/Veridex-Protocol/sdk)
- [Discord](https://discord.gg/veridex)
- [Twitter](https://twitter.com/VeridexProtocol)
