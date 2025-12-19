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
 *     vaultFactory: '0x...', // Required for vault address computation
 *     vaultImplementation: '0x...', // Required for vault address computation
 *   }),
 * });
 * 
 * // Register passkey
 * const credential = await sdk.passkey.register('alice', 'Alice');
 * console.log('Key Hash:', credential.keyHash);
 * 
 * // Get deterministic vault address (no deployment needed)
 * const vaultAddress = sdk.getVaultAddress();
 * console.log('Your vault address:', vaultAddress);
 * 
 * // Get unified identity with all chain addresses
 * const identity = await sdk.getUnifiedIdentity();
 * console.log('Identity:', identity);
 * 
 * // Connect wallet for gas payment
 * const provider = new ethers.BrowserProvider(window.ethereum);
 * const signer = await provider.getSigner();
 * 
 * // Create vault (or ensure it exists)
 * const vault = await sdk.ensureVault(signer);
 * console.log('Vault ready:', vault);
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
export { WalletManager } from './core/WalletManager.js';
export { BalanceManager } from './core/BalanceManager.js';
export { TransactionTracker, getExplorerUrl, formatTransactionState } from './core/TransactionTracker.js';
export { ChainDetector, createChainDetector } from './core/ChainDetector.js';

// Phase 3: Cross-Chain Exports
export { CrossChainManager, crossChainManager } from './core/CrossChainManager.js';
export { RelayerClient, createRelayerClient } from './core/RelayerClient.js';

// Gas Sponsorship (Gasless Vault Creation)
export { GasSponsor, createGasSponsor } from './core/GasSponsor.js';

// ============================================================================
// Error Code Exports (for Solana program error parsing)
// ============================================================================

export {
  VERIDEX_ERRORS,
  ERROR_RANGES,
  ERROR_MESSAGES,
  isCoreError,
  isQueryExecutionError,
  isAbiError,
  isQueryParsingError,
  isQueryError,
  getErrorCategory,
  getErrorMessage,
  parseVeridexError,
  isRetryableError,
  getSuggestedAction,
} from './constants/errors.js';

export type { VeridexErrorCode } from './constants/errors.js';

// ============================================================================
// Type Exports
// ============================================================================

export type {
    // Configuration
    VeridexConfig,
    ChainConfig,
    WalletManagerConfig,

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
    VaultCreationResult,

    // Wallet & Identity
    UnifiedIdentity,
    ChainAddress,

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

    // Phase 2: Transfer Types
    PreparedTransfer,
    TransferResult,
    ReceiveAddress,
    TransactionHistoryEntry,

    // Phase 3: Cross-Chain Types
    CrossChainFees,
    PreparedBridge,
    BridgeResult,
} from './core/types.js';

// Re-export ChainAddressConfig from WalletManager
export type { ChainAddressConfig } from './core/WalletManager.js';

// Re-export Balance types
export type { 
    TokenBalance, 
    PortfolioBalance, 
    BalanceManagerConfig 
} from './core/BalanceManager.js';

// Re-export Transaction Tracker types
export type { 
    TransactionStatus, 
    TransactionState, 
    TransactionCallback, 
    TrackerConfig 
} from './core/TransactionTracker.js';

// Re-export Chain Detector types
export type {
    ChainDetectorConfig,
    NativeBalanceCapable,
} from './core/ChainDetector.js';

// Re-export Cross-Chain Manager types
export type {
    CrossChainStatus,
    CrossChainProgress,
    CrossChainResult,
    CrossChainConfig,
    CrossChainProgressCallback,
} from './core/CrossChainManager.js';

// Re-export Relayer Client types
export type {
    RelayStatus,
    RelayRequest,
    RelayRoute,
    RelayerInfo,
    RelayFeeQuote,
    RelayerClientConfig,
    SubmitSignedActionRequest,
    SubmitActionResult,
} from './core/RelayerClient.js';

// Re-export Gas Sponsor types
export type {
    GasSponsorConfig,
    ChainDeploymentConfig,
    SponsoredVaultResult,
    MultiChainVaultResult,
    SponsorshipSource,
} from './core/GasSponsor.js';

// ============================================================================
// Token Constants
// ============================================================================

export {
    NATIVE_TOKEN_ADDRESS,
    EVM_ZERO_ADDRESS,
    BASE_SEPOLIA_TOKENS,
    OPTIMISM_SEPOLIA_TOKENS,
    ARBITRUM_SEPOLIA_TOKENS,
    TOKEN_REGISTRY,
    getTokenList,
    getAllTokens,
    getTokenBySymbol,
    getTokenByAddress,
    isNativeToken,
    getSupportedChainIds,
    getChainName,
} from './constants/tokens.js';

export type {
    TokenInfo,
    ChainTokenList,
} from './constants/tokens.js';

// ============================================================================
// Re-export from existing modules (backward compatibility)
// ============================================================================

export * from './constants.js';
export * from './utils.js';
export * from './payload.js';

// Client-first authentication preparation (Wormhole Queries)
export * from './auth/prepareAuth.js';
export * from './queries/index.js';
export * from './wormhole.js';

// ============================================================================
// Default Export
// ============================================================================

export { VeridexSDK as default } from './core/VeridexSDK.js';

