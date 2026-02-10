# Stacks SDK Integration Plan

> **Reference**: [ADR-0027: Stacks x402 Spoke Deployment](../../docs/architecture/decisions/0027-stacks-x402-spoke-deployment-and-passkey-migration.md)
> **Package**: `packages/sdk/src/chains/stacks/`
> **Dependencies**: `@stacks/transactions ^7.3.0`, `@stacks/network ^7.2.0`, `@stacks/common`

---

## Overview

This plan extends the core Veridex SDK (`@veridex/sdk`) with Stacks blockchain support. The SDK must implement the `ChainClient` interface for Stacks, handle Passkey signature format conversion (WebAuthn → Clarity-compatible), and integrate with the Stacks Spoke contract deployed in `packages/contracts/stacks/`.

---

## Phase 1: Chain Preset Registration

### 1.1 Add Stacks to `ChainName` and `CHAIN_PRESETS`

**File**: `src/presets.ts`

Add `STACKS: 'stacks'` to `CHAIN_NAMES` and add a new entry to `CHAIN_PRESETS`:

```typescript
stacks: {
  displayName: 'Stacks',
  type: 'stacks',  // New chain type
  canBeHub: false,  // Spoke only (Hub remains EVM)
  testnet: {
    name: 'Stacks Testnet',
    chainId: 2147483648,  // CAIP-2: stacks:2147483648
    wormholeChainId: 60,   // 
    rpcUrl: 'https://api.testnet.hiro.so',
    explorerUrl: 'https://explorer.hiro.so/?chain=testnet',
    isEvm: false,
    contracts: {
      hub: '',  // Spoke contract address (deployed)
      wormholeCoreBridge: '',  // Phase 2
    },
  },
  mainnet: {
    name: 'Stacks Mainnet',
    chainId: 1,  // CAIP-2: stacks:1
    wormholeChainId: 60,
    rpcUrl: 'https://api.hiro.so',
    explorerUrl: 'https://explorer.hiro.so',
    isEvm: false,
    contracts: {
      hub: '',
      wormholeCoreBridge: '',
    },
  },
}
```

### 1.2 Update `ChainPreset.type` Union

**File**: `src/presets.ts`

Add `'stacks'` to the type union:
```typescript
type: 'evm' | 'solana' | 'aptos' | 'sui' | 'starknet' | 'stacks' | 'near' | 'cosmos';
```

### 1.3 Update Factory

**File**: `src/factory.ts`

Add `case 'stacks':` to `createChainClient()`:
```typescript
case 'stacks':
  return new StacksClient({
    rpcUrl,
    spokeContractAddress: config.contracts.hub || '',
    spokeContractName: 'veridex-spoke',
    network: network === 'testnet' ? 'testnet' : 'mainnet',
    wormholeChainId: config.wormholeChainId,
  });
```

---

## Phase 2: StacksClient Implementation

### 2.1 `src/chains/stacks/StacksClient.ts`

**Purpose**: Implements the `ChainClient` interface for Stacks.

**Config Interface:**

```typescript
export interface StacksClientConfig {
  rpcUrl: string;
  spokeContractAddress: string;
  spokeContractName: string;
  network: 'mainnet' | 'testnet';
  wormholeChainId: number;
}
```

**ChainClient Method Mapping:**

| ChainClient Method | Stacks Implementation |
|:---|:---|
| `getConfig()` | Returns `ChainConfig` with Stacks-specific values |
| `getNonce(keyHash)` | Read-only call to `veridex-spoke.get-identity` → extract nonce |
| `getMessageFee()` | Returns `0n` (no Wormhole fee for Phase 1) |
| `buildTransferPayload(params)` | Encodes STX/sBTC transfer parameters for Spoke contract |
| `buildExecutePayload(params)` | Encodes arbitrary contract call parameters |
| `buildBridgePayload(params)` | Throws "not yet supported" (Phase 2) |
| `dispatch(sig, x, y, target, payload, nonce, signer)` | Builds and broadcasts Stacks contract call via `makeContractCall` |
| `getVaultAddress(keyHash)` | Read-only call to Spoke → returns contract principal (vaults are map-based) |
| `computeVaultAddress(keyHash)` | Returns Spoke contract address (all vaults in one contract) |
| `vaultExists(keyHash)` | Read-only call to `get-identity` → check if identity exists |
| `createVault(keyHash, signer)` | Calls `register-identity` on Spoke contract |
| `estimateVaultCreationGas(keyHash)` | Estimates fee for `register-identity` call |

**Key Implementation Details:**

1. **Read-Only Calls**: Use `@stacks/transactions` `callReadOnlyFunction`:
   ```typescript
   import { callReadOnlyFunction, Cl } from '@stacks/transactions';
   
   async getNonce(keyHash: string): Promise<bigint> {
     const result = await callReadOnlyFunction({
       contractAddress: this.config.spokeContractAddress,
       contractName: this.config.spokeContractName,
       functionName: 'get-identity',
       functionArgs: [Cl.bufferFromHex(keyHash)],
       network: this.network,
       senderAddress: this.config.spokeContractAddress,
     });
     // Parse Clarity response tuple
     return BigInt(result.value.nonce.value);
   }
   ```

2. **Contract Calls**: Use `makeContractCall` with optional sponsorship:
   ```typescript
   import { makeContractCall, broadcastTransaction, Cl, Pc } from '@stacks/transactions';
   
   async dispatch(sig, x, y, target, payload, nonce, signer): Promise<DispatchResult> {
     const txOptions = {
       contractAddress: this.config.spokeContractAddress,
       contractName: this.config.spokeContractName,
       functionName: 'execute-with-session',
       functionArgs: [/* encoded args */],
       senderKey: signer,
       network: this.network,
       postConditions: this.buildPostConditions(payload),
       postConditionMode: PostConditionMode.Deny,
       sponsored: true,  // Gasless for agents
     };
     const tx = await makeContractCall(txOptions);
     const result = await broadcastTransaction({ transaction: tx, network: this.network });
     return { txHash: result.txid, sequence: 0n };
   }
   ```

3. **Post-Condition Builder**:
   ```typescript
   private buildPostConditions(payload: string): PostCondition[] {
     const decoded = this.decodePayload(payload);
     if (decoded.type === 'stx-transfer') {
       return [Pc.principal(senderAddress).willSendEq(decoded.amount).ustx()];
     }
     if (decoded.type === 'sbtc-transfer') {
       return [Pc.principal(senderAddress).willSendEq(decoded.amount)
         .ft('SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token', 'sbtc-token')];
     }
     return [];
   }
   ```

---

## Phase 3: Signature Format Conversion

### 3.1 `src/chains/stacks/StacksSigner.ts`

**Purpose**: Converts WebAuthn/Passkey signatures to Clarity-compatible formats.

**Key Conversions:**

| From (WebAuthn) | To (Clarity) | Function |
|:---|:---|:---|
| DER-encoded signature | 64-byte compact `(buff 64)` | `derToCompactSignature(der: Uint8Array): Uint8Array` |
| Uncompressed pubkey `(x, y)` as `bigint` | 33-byte compressed `(buff 33)` | `compressPublicKey(x: bigint, y: bigint): Uint8Array` |
| `(r, s)` as `bigint` | 64-byte compact buffer | `rsToCompactSignature(r: bigint, s: bigint): Uint8Array` |
| Passkey `keyHash` (ethers format) | `(buff 32)` hex | `keyHashToBuffer(keyHash: string): string` |

**Implementation:**

```typescript
export function compressPublicKey(x: bigint, y: bigint): Uint8Array {
  const prefix = y % 2n === 0n ? 0x02 : 0x03;
  const xBytes = bigintToBytes(x, 32);
  const compressed = new Uint8Array(33);
  compressed[0] = prefix;
  compressed.set(xBytes, 1);
  return compressed;
}

export function rsToCompactSignature(r: bigint, s: bigint): Uint8Array {
  const compact = new Uint8Array(64);
  compact.set(bigintToBytes(r, 32), 0);
  compact.set(bigintToBytes(s, 32), 32);
  return compact;
}
```

### 3.2 Session Key Signing

For session keys (secp256k1), use `@stacks/transactions` native signing:

```typescript
import { createStacksPrivateKey, signWithKey } from '@stacks/transactions';

export function signWithSessionKey(
  messageHash: Uint8Array,
  sessionPrivateKey: string
): Uint8Array {
  const key = createStacksPrivateKey(sessionPrivateKey);
  const signature = signWithKey(key, bytesToHex(messageHash));
  return hexToBytes(signature.data);  // 65-byte recoverable signature
}
```

---

## Phase 4: Address Utilities

### 4.1 `src/chains/stacks/StacksAddressUtils.ts`

**Functions:**

| Function | Description |
|:---|:---|
| `isValidStacksPrincipal(address: string): boolean` | Validates SP/ST principal format |
| `keyHashToStacksPrincipal(keyHash: string, network: 'mainnet' \| 'testnet'): string` | Derives a Stacks address from a key hash (for vault identification) |
| `stacksAddressToVersion(address: string): { version: number, hash: Uint8Array }` | Decomposes a Stacks address |
| `getContractPrincipal(address: string, contractName: string): string` | Returns `address.contractName` format |

**Stacks Address Format:**
- Mainnet: `SP` prefix (version 22)
- Testnet: `ST` prefix (version 26)
- Contract principals: `SP1234.contract-name`

---

## Phase 5: Barrel Exports and Index Updates

### 5.1 `src/chains/stacks/index.ts`

```typescript
export { StacksClient } from './StacksClient';
export type { StacksClientConfig } from './StacksClient';
export { StacksSigner, compressPublicKey, rsToCompactSignature, derToCompactSignature } from './StacksSigner';
export { StacksAddressUtils } from './StacksAddressUtils';
export { StacksPostConditions } from './StacksPostConditions';
```

### 5.2 Update `src/index.ts`

Add exports:
```typescript
export { StacksClient } from './chains/stacks/index.js';
export type { StacksClientConfig } from './chains/stacks/index.js';
export { StacksSigner } from './chains/stacks/index.js';
```

---

## Phase 6: Testing

### 6.1 Unit Tests

**File**: `test/chains/stacks/StacksClient.test.ts`

| Test | Description |
|:---|:---|
| `should create StacksClient with valid config` | Constructor validation |
| `should return correct ChainConfig` | `getConfig()` returns Stacks-specific values |
| `should convert WebAuthn signature to compact format` | DER → 64-byte compact |
| `should compress public key correctly` | `(x, y)` → 33-byte compressed |
| `should build STX post-conditions` | Post-condition builder for STX |
| `should build sBTC post-conditions` | Post-condition builder for sBTC |
| `should validate Stacks principals` | Address validation |
| `should make read-only calls` | Mock RPC for `callReadOnlyFunction` |

### 6.2 Integration Tests (requires devnet)

| Test | Description |
|:---|:---|
| `should register identity on devnet` | Full identity registration flow |
| `should create and use session on devnet` | Session lifecycle |
| `should transfer STX with post-conditions` | Payment with protocol safety |

---

## Dependencies to Add

**`packages/sdk/package.json`:**

```json
{
  "dependencies": {
    "@stacks/transactions": "^7.3.0",
    "@stacks/network": "^7.2.0",
    "@stacks/common": "^7.0.0"
  }
}
```

These should be added as optional peer dependencies or dynamically imported to avoid bloating the bundle for non-Stacks users.

---

## File Summary

| File | Status | Description |
|:---|:---|:---|
| `src/presets.ts` | Modify | Add `stacks` chain preset |
| `src/factory.ts` | Modify | Add `case 'stacks'` to factory |
| `src/index.ts` | Modify | Add Stacks exports |
| `src/chains/stacks/StacksClient.ts` | **New** | ChainClient implementation |
| `src/chains/stacks/StacksSigner.ts` | **New** | Signature format conversion |
| `src/chains/stacks/StacksAddressUtils.ts` | **New** | Address utilities |
| `src/chains/stacks/StacksPostConditions.ts` | **New** | Post-condition builder |
| `src/chains/stacks/index.ts` | **New** | Barrel exports |
| `test/chains/stacks/StacksClient.test.ts` | **New** | Unit tests |
| `test/chains/stacks/StacksSigner.test.ts` | **New** | Signature conversion tests |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|:---|:---|:---|
| Bundle size increase from `@stacks/*` | SDK becomes heavier for non-Stacks users | Use dynamic imports or separate entry point (`@veridex/sdk/stacks`) |
| Clarity value encoding complexity | Incorrect contract calls | Use `Cl` helper extensively; add comprehensive encoding tests |
| Stacks RPC rate limits | Read-only calls throttled | Add caching layer for `getNonce` and `getVaultAddress` |
| Compressed pubkey format edge cases | Signature verification fails on-chain | Test with real WebAuthn credentials on multiple platforms |

---

## Estimated Timeline

| Phase | Duration | Dependencies |
|:---|:---|:---|
| Phase 1: Presets & Factory | 0.5 day | None |
| Phase 2: StacksClient | 2 days | Phase 1, Contracts Phase 2 |
| Phase 3: Signature Conversion | 1 day | Phase 2 |
| Phase 4: Address Utilities | 0.5 day | Phase 2 |
| Phase 5: Exports | 0.25 day | Phase 2-4 |
| Phase 6: Testing | 1.5 days | Phase 2-5 |
| **Total** | **5.75 days** | |
