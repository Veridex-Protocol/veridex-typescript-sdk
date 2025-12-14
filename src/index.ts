/**
 * Veridex Protocol SDK
 * 
 * Chain-agnostic SDK for Passkey-based cross-chain authentication
 * 
 * @example
 * ```typescript
 * import { VeridexSDK } from '@veridex/sdk';
 * import { EVMClient } from '@veridex/sdk/chains/evm';
 * import { ethers } from 'ethers';
 * 
 * // Initialize SDK with EVM chain
 * const sdk = new VeridexSDK({
 *   chain: new EVMClient({
 *     chainId: 84532,
 *     wormholeChainId: 10004,
 *     rpcUrl: 'https://sepolia.base.org',
 *     hubContractAddress: '0xf189b649ecb44708165f36619ED24ff917eF1f94',
 *     wormholeCoreBridge: '0x79A1027a6A159502049F10906D333EC57E95F083',
 *   }),
 * });
 * 
 * // Register passkey
 * const credential = await sdk.passkey.register('alice', 'Alice');
 * console.log('Key Hash:', credential.keyHash);
 * 
 * // Connect wallet for gas payment
 * const provider = new ethers.BrowserProvider(window.ethereum);
 * const signer = await provider.getSigner();
 * 
 * // Transfer tokens cross-chain
 * const result = await sdk.transfer({
 *   targetChain: 10005, // Optimism Sepolia
 *   token: '0x...', // USDC address
 *   recipient: '0x...',
 *   amount: ethers.parseUnits('100', 6),
 * }, signer);
 * 
 * console.log('Transaction:', result.transactionHash);
 * console.log('VAA Sequence:', result.sequence);
 * ```
 */

// ============================================================================
// Core Exports
// ============================================================================

export { VeridexSDK } from './core/VeridexSDK.js';
export { PasskeyManager } from './core/PasskeyManager.js';

// ============================================================================
// Type Exports
// ============================================================================

export type {
    // Configuration
    VeridexConfig,
    ChainConfig,

    // Credentials
    PasskeyCredential,
    WebAuthnSignature,

    // Action Parameters
    TransferParams,
    ExecuteParams,
    BridgeParams,
    ConfigParams,

    // Results
    DispatchResult,
    VaultInfo,

    // Action Payloads
    TransferAction,
    BridgeAction,
    ExecuteAction,
    ConfigAction,
    ActionPayload,

    // VAA
    VAA,
    VAASignature,
    VeridexPayload,

    // Chain Client Interface
    ChainClient,

    // Test Results
    TestResult,
} from './core/types.js';

// ============================================================================
// Re-export from existing modules (backward compatibility)
// ============================================================================

export * from './constants.js';
export * from './utils.js';
export * from './payload.js';
export * from './wormhole.js';

// ============================================================================
// Default Export
// ============================================================================

export { VeridexSDK as default } from './core/VeridexSDK.js';
