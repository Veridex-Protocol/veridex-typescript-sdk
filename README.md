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

// Initialize — returns synchronously, defaults to testnet
const sdk = createSDK('base');

// Register a passkey (biometric prompt)
const credential = await sdk.passkey.register('user@example.com', 'My Wallet');

// Deterministic vault address derived from your passkey
const vault = sdk.getVaultAddress();
console.log('Your vault:', vault);

// Prepare and execute a transfer (requires a signer to pay gas)
const prepared = await sdk.prepareTransfer({
  targetChain: 10004,  // Base Sepolia Wormhole chain ID
  token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC
  recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f5A234',
  amount: 1000000n,    // 1 USDC (6 decimals)
});
const result = await sdk.executeTransfer(prepared, signer);
console.log('Tx hash:', result.transactionHash);
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
| **Monad** | Spoke (EVM) | 10048 | secp256r1 (EIP-7951) + secp256k1 | Testnet + Mainnet |
| **Solana** | Spoke | 1 | Ed25519 | Devnet + Mainnet |
| **Aptos** | Spoke | 22 | Ed25519 | Testnet + Mainnet |
| **Sui** | Spoke | 21 | secp256k1 | Testnet + Mainnet |
| **Starknet** | Spoke | 50001 | Stark ECDSA | Sepolia + Mainnet |
| **Stacks** | Spoke | 60 | secp256r1 (native!) + secp256k1 | Testnet + Mainnet |

## Key Features

### Passkey Registration & Authentication

```typescript
import { createSDK } from '@veridex/sdk';

const sdk = createSDK('base');

// Register — triggers biometric prompt, returns credential
const credential = await sdk.passkey.register('user@example.com', 'My Wallet');
console.log('Key hash:', credential.keyHash);
console.log('Credential ID:', credential.credentialId);

// Check for existing passkeys
const stored = sdk.passkey.getAllStoredCredentials();
if (stored.length > 0) {
  // Authenticate with a discoverable credential (shows passkey picker)
  const { credential, signature } = await sdk.passkey.authenticate();
  console.log('Authenticated as:', credential.keyHash);
} else {
  // Or set a known credential directly
  sdk.passkey.setCredential({
    credentialId: 'abc123',
    publicKeyX: BigInt('0x...'),
    publicKeyY: BigInt('0x...'),
    keyHash: '0x...',
  });
}
```

- **RIP-7212** native P-256 verification on EVM (~3,450 gas)
- **FCL fallback** for chains without precompile
- **Stacks** has native `secp256r1-verify` in Clarity — no workarounds needed
- **Monad** has EIP-7951 P-256 precompile at `0x0100` (6,900 gas)

### Deterministic Vaults

```typescript
// Same address on Base, Optimism, Arbitrum, Ethereum, Polygon
const vault = sdk.getVaultAddress();

// Get vault address for a specific chain
const opVault = sdk.getVaultAddressForChain(24); // Optimism

// Check if vault exists on-chain
const info = await sdk.getVaultInfo();
console.log('Deployed:', info?.exists);

// Create vault (user pays gas)
const result = await sdk.createVault(signer);
console.log('Vault created:', result.address);

// Or create with sponsored gas (Veridex pays)
const sponsored = await sdk.createVaultSponsored();
```

### Transfers

```typescript
import { createSDK } from '@veridex/sdk';
import { ethers } from 'ethers';

const sdk = createSDK('base', { network: 'testnet' });

// After registering or setting a credential...
await sdk.passkey.register('user@example.com', 'My Wallet');

// 1. Prepare transfer (shows gas estimate before signing)
const prepared = await sdk.prepareTransfer({
  targetChain: 10004,  // Base Sepolia
  token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC
  recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f5A234',
  amount: 1000000n,    // 1 USDC
});

// 2. Show human-readable summary
const summary = await sdk.getTransactionSummary(prepared);
console.log(summary.title);       // "Transfer"
console.log(summary.description); // "Send 1.0 USDC to 0x742d...5A234"
console.log('Gas cost:', prepared.formattedCost);

// 3. Execute (signs with passkey, then dispatches)
const provider = new ethers.JsonRpcProvider('https://sepolia.base.org');
const signer = new ethers.Wallet(PRIVATE_KEY, provider);
const result = await sdk.executeTransfer(prepared, signer);
console.log('Tx hash:', result.transactionHash);

// 4. Wait for confirmation
const state = await sdk.waitForTransaction(result.transactionHash);
console.log('Confirmed in block:', state.blockNumber);
```

### Gasless Transfers (via Relayer)

```typescript
const sdk = createSDK('base', {
  network: 'testnet',
  relayerUrl: 'https://relayer.veridex.network',
  relayerApiKey: 'your-api-key',
});

await sdk.passkey.register('user@example.com', 'My Wallet');

// Relayer sponsors gas — user pays nothing
const result = await sdk.transferViaRelayer({
  targetChain: 10004,
  token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f5A234',
  amount: 1000000n,
});
console.log('Tx hash:', result.transactionHash);
```

### Session Keys

Session keys are managed via the `SessionManager` class, separate from the main SDK:

```typescript
import { createSDK, SessionManager } from '@veridex/sdk';

const sdk = createSDK('base');
await sdk.passkey.register('user@example.com', 'My Wallet');

// SessionManager wraps the SDK for session operations
const sessionManager = new SessionManager({ sdk });

// Create a session (one passkey auth)
const session = await sessionManager.createSession({
  duration: 3600,                 // 1 hour
  maxValue: BigInt(1e18),         // Max 1 token per tx
  allowedChains: [10004],         // Base Sepolia only
});

// Execute transactions with session key (no biometric prompts)
await sessionManager.executeWithSession({
  targetChain: 10004,
  token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  recipient: '0x...',
  amount: 1000000n,
}, session);

// Revoke anytime
await sessionManager.revokeSession(session);
```

### Session Key Cryptography (Low-Level)

```typescript
import {
  generateSecp256k1KeyPair,
  computeSessionKeyHash,
  deriveEncryptionKey,
  encrypt,
  decrypt,
} from '@veridex/sdk';

// Generate a session key pair
const keyPair = generateSecp256k1KeyPair();
console.log('Public key:', keyPair.publicKey);

// Compute on-chain key hash
const keyHash = computeSessionKeyHash(keyPair.publicKey);

// Encrypt private key (only passkey owner can decrypt)
const encryptionKey = await deriveEncryptionKey(credential.credentialId);
const encrypted = await encrypt(keyPair.privateKey, encryptionKey);
const decrypted = await decrypt(encrypted, encryptionKey);
```

### Cross-Chain Bridging

```typescript
const sdk = createSDK('base', { network: 'testnet' });
await sdk.passkey.register('user@example.com', 'My Wallet');

// Prepare bridge with fee estimation
const prepared = await sdk.prepareBridge({
  sourceChain: 10004,        // Base Sepolia
  destinationChain: 10005,   // Optimism Sepolia
  token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  amount: 1000000n,
});
console.log('Bridge fees:', prepared.fees.formattedTotal);

// Execute with progress tracking
const result = await sdk.executeBridge(prepared, signer, (progress) => {
  console.log(`Step ${progress.step}/${progress.totalSteps}: ${progress.message}`);
});
console.log('Source tx:', result.transactionHash);
console.log('VAA ready:', !!result.vaa);

// Or bridge gaslessly via relayer
const gaslessResult = await sdk.bridgeViaRelayer({
  sourceChain: 10004,
  destinationChain: 10005,
  token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  amount: 1000000n,
});
```

### Balances

```typescript
const sdk = createSDK('base', { network: 'testnet' });
await sdk.passkey.register('user@example.com', 'My Wallet');

// Native token balance
const native = await sdk.getVaultNativeBalance();
console.log(`${native.token.symbol}: ${native.formatted}`);

// All token balances on current chain
const portfolio = await sdk.getVaultBalances();
for (const entry of portfolio.tokens) {
  console.log(`${entry.token.symbol}: ${entry.formatted}`);
}
console.log('Total USD:', portfolio.totalUsdValue);

// Multi-chain balances
const multiChain = await sdk.getMultiChainBalances([10004, 10005, 10003]);
for (const chain of multiChain) {
  console.log(`${chain.chainName}: ${chain.tokens.length} tokens`);
}
```

### Spending Limits

```typescript
import { ethers } from 'ethers';

// Check current on-chain spending limits
const limits = await sdk.getSpendingLimits();
console.log('Daily remaining:', limits.dailyRemaining);

// Check if a specific amount is allowed
const check = await sdk.checkSpendingLimit(ethers.parseEther('1.0'));
if (!check.allowed) {
  console.log('Blocked:', check.message);
  console.log('Suggestions:', check.suggestions);
}

// Get formatted limits for UI display
const formatted = await sdk.getFormattedSpendingLimits();
console.log(`${formatted.dailyUsedPercentage}% of daily limit used`);
console.log(`Resets in: ${formatted.timeUntilReset}`);

// Update daily limit (requires passkey signature)
const prepared = await sdk.prepareSetDailyLimit(ethers.parseEther('5.0'));
await sdk.executeTransfer(prepared, signer);
```

## Chain Clients

Each chain has a dedicated client implementing the `ChainClient` interface:

```typescript
import { EVMClient } from '@veridex/sdk';
import { SolanaClient } from '@veridex/sdk';
import { AptosClient } from '@veridex/sdk';
import { SuiClient } from '@veridex/sdk';
import { StarknetClient } from '@veridex/sdk';
import { StacksClient } from '@veridex/sdk';

// Or use subpath imports
import { EVMClient } from '@veridex/sdk/chains/evm';
import { StacksClient } from '@veridex/sdk/chains/stacks';
```

All clients support:
- `buildTransferPayload()` — Build token transfer payloads
- `buildExecutePayload()` — Build arbitrary execution payloads
- `buildBridgePayload()` — Build cross-chain bridge payloads
- `dispatch()` — Submit signed actions with a signer
- `computeVaultAddress()` — Derive deterministic vault address
- `vaultExists()` — Check if vault is deployed
- `createVault()` — Deploy a vault
- `getNonce()` — Get replay-protection nonce
- `getMessageFee()` — Get Wormhole message fee

### Stacks-Specific

Stacks has unique capabilities leveraged by the SDK:

```typescript
import {
  StacksClient,
  stacksCompressPublicKey,
  stacksRsToCompactSignature,
  stacksDerToCompactSignature,
  stacksComputeKeyHash,
  buildStxWithdrawalPostConditions,
  isValidStacksPrincipal,
  getStacksExplorerTxUrl,
} from '@veridex/sdk';

// Native secp256r1 verification (no ZK proofs needed)
// Native sponsored transactions (gasless built-in)
// Post-conditions for protocol-level spending safety
```

## Factory Functions

```typescript
import {
  createSDK,          // Main factory — createSDK('base', { network: 'testnet' })
  createHubSDK,       // Shortcut for Base hub — createHubSDK()
  createTestnetSDK,   // Force testnet — createTestnetSDK('optimism')
  createMainnetSDK,   // Force mainnet — createMainnetSDK('base')
  createSessionSDK,   // Session-enabled — createSessionSDK('base')
} from '@veridex/sdk';

// Check supported chains
import { getSupportedChains, getChainConfig, isChainSupported } from '@veridex/sdk';

const chains = getSupportedChains('testnet');
console.log('Supported:', chains); // ['base', 'ethereum', 'optimism', ...]

const config = getChainConfig('base', 'testnet');
console.log('RPC:', config.rpcUrl);
console.log('Chain ID:', config.chainId);
```

## Types

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
  SessionConfig,
  WebAuthnSignature,
  PasskeyCredential,
  DispatchResult,
  VaultCreationResult,
  PreparedTransfer,
  TransferResult,
  PreparedBridge,
  BridgeResult,
  PortfolioBalance,
  TokenBalance,
  SpendingLimits,
  LimitCheckResult,
  IdentityState,
  UnifiedIdentity,
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

## Frontend Requirement

> **Important:** This SDK requires a **browser frontend** for passkey operations. WebAuthn (passkeys) can only be created and used in a secure browser context — `sdk.passkey.register()` and `sdk.passkey.authenticate()` trigger native OS biometric prompts (FaceID, TouchID, Windows Hello) that cannot run in Node.js or server-side environments.

**You need a frontend to:**
- **Register passkeys** — `sdk.passkey.register()` must be called from a user-initiated browser event (e.g., button click)
- **Authenticate** — `sdk.passkey.authenticate()` shows the platform passkey picker in the browser
- **Store credentials** — Passkey credentials are stored in the browser's platform authenticator (iCloud Keychain, Google Password Manager, etc.)

**What can run server-side:**
- Verifying transactions on-chain
- Querying balances (`sdk.getVaultBalances()`)
- Relayer API calls
- Session key operations (after initial passkey-based creation on the frontend)

**Minimal frontend example (React):**

```tsx
'use client';
import { createSDK } from '@veridex/sdk';

const sdk = createSDK('base', { network: 'testnet' });

export function PasskeyWallet() {
  const handleCreate = async () => {
    // Must be triggered by user interaction (button click)
    const credential = await sdk.passkey.register('user@example.com', 'My Wallet');
    console.log('Vault:', sdk.getVaultAddress());
  };

  const handleLogin = async () => {
    const { credential } = await sdk.passkey.authenticate();
    console.log('Authenticated:', credential.keyHash);
  };

  return (
    <div>
      <button onClick={handleCreate}>Create Wallet</button>
      <button onClick={handleLogin}>Login</button>
    </div>
  );
}
```

For a complete frontend example, see the [test-app](https://github.com/Veridex-Protocol/demo/tree/main/test-app) or the [React integration guide](https://docs.veridex.network/integrations/react).

## Browser Support

WebAuthn requires HTTPS and a compatible browser:

| Browser | Minimum Version |
|---------|-----------------|
| Chrome | 67+ |
| Firefox | 60+ |
| Safari | 14+ |
| Edge | 79+ |

## Related Packages

| Package | Description |
|---------|-------------|
| [`@veridex/agentic-payments`](https://www.npmjs.com/package/@veridex/agentic-payments) | Agent payment SDK — x402, UCP, ACP, AP2, ERC-8004 identity |
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
