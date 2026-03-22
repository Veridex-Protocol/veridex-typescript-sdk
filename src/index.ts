/**
 * Veridex Protocol SDK
 * 
 * Chain-agnostic SDK for Passkey-based cross-chain authentication
 * 
 * @example Simple Initialization (Recommended)
 * ```typescript
 * import { createSDK } from '@veridex/sdk';
 * 
 * // Just specify chain name - testnet by default
 * const sdk = createSDK('base');
 * 
 * // Register passkey
 * await sdk.passkey.register('alice', 'My Wallet');
 * 
 * // Get your vault address
 * const vaultAddress = sdk.getVaultAddress();
 * console.log('Your vault:', vaultAddress);
 * ```
 * 
 * @example Mainnet
 * ```typescript
 * const sdk = createSDK('base', { network: 'mainnet' });
 * ```
 * 
 * @example With Gasless Transactions
 * ```typescript
 * const sdk = createSDK('base', {
 *   relayerUrl: 'https://relayer.veridex.network',
 *   relayerApiKey: 'your-api-key',
 * });
 * ```
 * 
 * @example Advanced (Direct Construction)
 * ```typescript
 * import { VeridexSDK, EVMClient } from '@veridex/sdk';
 * 
 * const sdk = new VeridexSDK({
 *   chain: new EVMClient({ ... }),
 * });
 * ```
 */

// ============================================================================
// START Simple Factory Functions (Recommended)
// ============================================================================

export {
    // Main factory function
    createSDK,

    // Convenience factories
    createHubSDK,
    createTestnetSDK,
    createMainnetSDK,
    createSessionSDK,
    createEnterpriseSDK,

    // Chain client factory (public)
    createChainClient,

    // Chain presets
    CHAIN_NAMES,
    CHAIN_PRESETS,
    getChainConfig,
    getChainPreset,
    getSupportedChains,
    getHubChains,
    isChainSupported,
    isHubChain,
    getDefaultHub,

    // Feature Flags
    getFeatureFlags,
    setFeatureFlags,
    resetFeatureFlags,
    isMultiHubEnabled,
    getEffectivePrimaryHub,
} from './factory.js';

export type {
    // Factory types
    SimpleSDKConfig,
    SessionConfig as SimpleSessionConfig,
    EnterpriseSDKConfig,
    ChainName,
    NetworkType,
    FeatureFlags,
} from './factory.js';

// ============================================================================
// Core Exports
// ============================================================================

export { VeridexSDK } from './core/VeridexSDK.js';
export { PasskeyManager, detectRpId, VERIDEX_RP_ID, supportsRelatedOrigins } from './core/PasskeyManager.js';
export type { PasskeyCredential, PasskeyManagerConfig, WebAuthnSignature } from './core/PasskeyManager.js';

// Browser Capabilities Detection
export { detectCapabilities, getAuthStrategy, detectPlatform } from './core/BrowserCapabilities.js';
export type { BrowserCapabilities, PlatformHint, AuthStrategy } from './core/BrowserCapabilities.js';

// Credential Inventory Management
export { CredentialManager } from './core/CredentialManager.js';
export type { ManagedCredential, CredentialMetadata, AddCredentialOptions } from './core/CredentialManager.js';
export { AccountManager } from './core/AccountManager.js';
export type { PortabilityOverview, RecoveryOverview, AccountManagerConfig } from './core/AccountManager.js';

// Guardian Recovery Orchestration
export { RecoveryManager } from './core/RecoveryManager.js';
export type {
    RecoveryCapableChainClient,
    GuardiansResult,
    RecoveryStatusResult,
    RecoveryReadiness,
    SetupGuardiansParams,
    AddGuardianParams,
    RemoveGuardianParams,
    InitiateRecoveryParams,
    ApproveRecoveryParams,
    ExecuteRecoveryParams,
    CancelRecoveryParams,
    RecoveryManagerConfig,
} from './core/RecoveryManager.js';

// Threshold Multisig (ADR-0037)
export {
    MultisigManager,
    PROTECTED_ACTION,
    DEFAULT_PROTECTED_ACTION_MASK,
    DEFAULT_PROPOSAL_TTL,
} from './core/MultisigManager.js';
export type {
    ProposalState,
    MultisigPolicy,
    TransactionProposal,
    ProposalActionSummary,
    CreateProposalResult,
    ApproveProposalResult,
    ExecuteProposalResult,
    MultisigCapableChainClient,
    MultisigManagerConfig,
    ConfigurePolicyParams,
    CreateProposalParams,
    ApproveProposalParams,
    CancelProposalParams,
    ExecuteProposalParams,
} from './core/MultisigManager.js';

// Policy Enforcement & Launch Gates (ADR-0040)
export {
    validateNoKeyExtraction,
    validateChainCapability,
    validateMetaMaskInteropClaim,
    validateSessionCreationPolicy,
    validateFederatedOrigin,
    buildCapabilityMatrix,
    PolicyViolationError,
    CHAIN_CAPABILITIES,
} from './core/PolicyEnforcement.js';
export type {
    ChainCapabilityTier,
    ChainCapabilities,
    PlatformCapabilityMatrix,
    PolicyViolationCode,
} from './core/PolicyEnforcement.js';

// Cross-Origin Authentication (for third-party apps)
export {
    CrossOriginAuth,
    createCrossOriginAuth,
    sendAuthResponse,
    sendAuthError,
    DEFAULT_AUTH_PORTAL_URL,
    DEFAULT_RELAYER_URL,
    AUTH_MESSAGE_TYPES,
} from './core/CrossOriginAuth.js';
export type {
    CrossOriginAuthConfig,
    CrossOriginSession,
    ServerSessionToken,
    AuthPortalMessage,
} from './core/CrossOriginAuth.js';

export { WalletManager } from './core/WalletManager.js';
export { InjectedWalletAdapter, createInjectedWalletAdapter } from './core/InjectedWalletAdapter.js';
export type { InjectedWalletAdapterConfig, InjectedWalletConnection, WalletEvent, WalletEventCallback } from './core/InjectedWalletAdapter.js';
export { BalanceManager } from './core/BalanceManager.js';
export { TransactionTracker, getExplorerUrl, formatTransactionState } from './core/TransactionTracker.js';
export { ChainDetector, createChainDetector } from './core/ChainDetector.js';

// Feature Flags
// Feature flags are exported from factory.ts to avoid circular dependencies
// but the implementation lives in featureFlags.ts


// Issue #26: Human-Readable Transaction Summaries
export {
    TransactionParser,
    createTransactionParser,
    createAuditEntry,
    logTransactionSummary,
} from './core/TransactionParser.js';
export type { TransactionAuditEntry } from './core/TransactionParser.js';

// Issue #27: Spending Limits Configuration
export {
    SpendingLimitsManager,
    createSpendingLimitsManager,
} from './core/SpendingLimitsManager.js';
export type { SpendingLimitsManagerConfig } from './core/SpendingLimitsManager.js';
export {
    CONFIG_TYPE,
    LIMIT_PRESETS,
    formatDuration,
    calculatePercentage,
    formatLargeAmount,
} from './core/SpendingLimits.types.js';
export type {
    SpendingLimits,
    FormattedSpendingLimits,
    SpendingLimitConfig,
    SetDailyLimitParams,
    SetTransactionLimitParams,
    LimitCheckResult,
    LimitViolationType,
    LimitViolationSuggestion,
    SpendingTransaction,
    DailySpendingSummary,
    SpendingLimitChangedEvent,
    SpendingLimitEventCallback,
    LimitPreset,
    DurationDisplay,
} from './core/SpendingLimits.types.js';

// Phase 3: Cross-Chain Exports
export { CrossChainManager, crossChainManager } from './core/CrossChainManager.js';
export { RelayerClient, createRelayerClient } from './core/RelayerClient.js';
export type {
    RegisteredAppStatus,
    RegisteredAppTrustLevel,
    RegisteredAppSummary,
    RegisteredAppDetail,
    RelayerAppSession,
    CredentialMetadataRecord,
} from './core/RelayerClient.js';

// Gas Sponsorship (Gasless Vault Creation)
export { GasSponsor, createGasSponsor } from './core/GasSponsor.js';

// Session Key Management (Issue #14)
export { SessionManager } from './sessions/index.js';
export { EVMClient, EVMHubClientAdapter } from './chains/evm/index.js';
export type { EVMClientConfig } from './chains/evm/index.js';
export { SolanaClient } from './chains/solana/index.js';
export type { SolanaClientConfig } from './chains/solana/index.js';
export { AptosClient } from './chains/aptos/AptosClient.js';
export type { AptosClientConfig } from './chains/aptos/AptosClient.js';
export { SuiClient } from './chains/sui/SuiClient.js';
export type { SuiClientConfig } from './chains/sui/SuiClient.js';
export { StarknetClient } from './chains/starknet/StarknetClient.js';
export type { StarknetClientConfig } from './chains/starknet/StarknetClient.js';
export { StacksClient, STACKS_ACTION_TYPES } from './chains/stacks/index.js';
export type { StacksClientConfig } from './chains/stacks/index.js';
export {
    compressPublicKey as stacksCompressPublicKey,
    rsToCompactSignature as stacksRsToCompactSignature,
    derToCompactSignature as stacksDerToCompactSignature,
    computeKeyHash as stacksComputeKeyHash,
    computeKeyHashFromCoords as stacksComputeKeyHashFromCoords,
    buildRegistrationHash as stacksBuildRegistrationHash,
    buildSessionRegistrationHash as stacksBuildSessionRegistrationHash,
    buildRevocationHash as stacksBuildRevocationHash,
    buildExecuteHash as stacksBuildExecuteHash,
    buildWithdrawalHash as stacksBuildWithdrawalHash,
    isValidStacksPrincipal,
    isValidStandardPrincipal as isValidStacksStandardPrincipal,
    isValidContractName as isValidStacksContractName,
    getNetworkFromAddress as getStacksNetworkFromAddress,
    getContractPrincipal as getStacksContractPrincipal,
    parseContractPrincipal as parseStacksContractPrincipal,
    isContractPrincipal as isStacksContractPrincipal,
    getStacksExplorerTxUrl,
    getStacksExplorerAddressUrl,
    buildStxWithdrawalPostConditions,
    buildStxDepositPostConditions,
    buildSbtcWithdrawalPostConditions,
    buildExecutePostConditions as buildStacksExecutePostConditions,
    validatePostConditions as validateStacksPostConditions,
} from './chains/stacks/index.js';
export type {
    PostConditionComparison,
    StxPostCondition,
    FtPostCondition,
    NftPostCondition,
    PostCondition as StacksPostCondition,
} from './chains/stacks/index.js';
export {
    generateSecp256k1KeyPair,
    computeSessionKeyHash,
    signWithSessionKey,
    hashAction,
    verifySessionSignature,
    deriveEncryptionKey,
    encrypt,
    decrypt,
    validateSessionConfig,
    MAX_SESSION_DURATION,
    MIN_SESSION_DURATION,
    DEFAULT_SESSION_DURATION,
    DEFAULT_REFRESH_BUFFER,
} from './sessions/crypto.js';
export {
    IndexedDBSessionStorage,
    LocalStorageSessionStorage,
    createSessionStorage,
} from './sessions/storage.js';

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

    // Issue #22: Backup Passkey Types
    IdentityState,
    AddBackupKeyResult,
    RemoveKeyResult,
    AuthorizedKey,
} from './core/types.js';

// Issue #26: Human-Readable Transaction Summary Types
export type {
    ActionDisplayType,
    TokenDisplay,
    RecipientDisplay,
    ChainDisplay,
    RiskLevel,
    RiskWarning,
    RiskWarningType,
    TransferDetails,
    BridgeDetails,
    ExecuteDetails,
    ConfigDetails,
    ActionDetails,
    TransactionSummary,
    TransactionParserConfig,
} from './core/TransactionSummary.types.js';
export { CHAIN_DISPLAY_INFO, getChainDisplay, getConfigTypeName } from './core/TransactionSummary.types.js';

// Issue #23: Social Recovery Types
export type {
    GuardianConfig,
    RecoveryStatus,
    SetupGuardiansResult,
    AddGuardianResult,
    RemoveGuardianResult,
    InitiateRecoveryResult,
    ApproveRecoveryResult,
    ExecuteRecoveryResult,
    CancelRecoveryResult,
} from './types.js';

// Query Types (Issue #9/#10/#11/#12) - from types.js
export type {
    QueryProof,
    ExecutionPath,
    QuerySubmissionResult,
} from './types.js';

// Session Key Types (Issue #13 - Hub contract) - from types.js
export type {
    SessionKey,
    SessionValidationResult,
    RegisterSessionParams,
    RevokeSessionParams,
} from './types.js';

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
    // Issue #11/#12: Query submission types
    SubmitQueryRequest,
    SubmitQueryResult,
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
// Unified Error Normalization
// ============================================================================

export {
    VeridexError,
    VeridexErrorCode as UnifiedErrorCode,
    normalizeError,
} from './core/VeridexError.js';

// ============================================================================
// Balance Watcher (Subscription API)
// ============================================================================

export { BalanceWatcher } from './core/BalanceWatcher.js';
export type {
    BalanceChangeEvent,
    TokenBalanceChange,
    BalanceWatcherOptions,
    BalanceChangeCallback,
    BalanceErrorCallback,
    BalanceEventType,
    Unsubscribe,
} from './core/BalanceWatcher.js';

// ============================================================================
// Enterprise Manager
// ============================================================================

export { EnterpriseManager } from './core/EnterpriseManager.js';
export type {
    EnterpriseManagerConfig,
    BatchVaultRequest,
    BatchVaultResult,
    VaultOverview,
    BatchTransferRequest,
    BatchTransferResult,
    BatchSpendingLimitRequest,
    BatchSpendingLimitResult,
    BatchLifecycleEvent,
    BatchLifecycleCallback,
} from './core/EnterpriseManager.js';

// Re-export Session Manager types (Issue #14)
export type {
    SessionConfig,
    SessionSignature,
    SessionManagerConfig,
    SessionStorage,
    SessionEvent,
    SessionEventCallback,
    ActionParams,
    SessionSignedAction,
    SessionErrorCode,
} from './sessions/types.js';

export type {
    KeyPair,
} from './sessions/crypto.js';

export { SessionError } from './sessions/types.js';
export type { HubClient } from './sessions/index.js';

// ============================================================================
// Token Constants
// ============================================================================

export {
    NATIVE_TOKEN_ADDRESS,
    EVM_ZERO_ADDRESS,
    BASE_SEPOLIA_TOKENS,
    OPTIMISM_SEPOLIA_TOKENS,
    ARBITRUM_SEPOLIA_TOKENS,
    ETHEREUM_SEPOLIA_TOKENS,
    MONAD_TESTNET_TOKENS,
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

// Wormhole utilities (VAA parsing, fetching, encoding — no heavy class imports)
export * from './wormhole.js';

// NOTE: queries (hubState, portfolio) and auth/prepareAuth are NOT re-exported here
// because they import class values from @wormhole-foundation/wormhole-query-sdk
// which cause TDZ errors in client-side bundles (Next.js "use client").
// Use the subpath import instead:  import { ... } from '@veridex/sdk/queries'

// ============================================================================
// ERC-8004 Low-Level Utilities
// ============================================================================

export * from './erc8004/index.js';

// ============================================================================
// Default Export
// ============================================================================

export { VeridexSDK as default } from './core/VeridexSDK.js';

