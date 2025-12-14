/**
 * Veridex Protocol SDK - Core Type Definitions
 */

// ============================================================================
// Configuration Types
// ============================================================================

export interface VeridexConfig {
    /**
     * Chain-specific client implementation
     */
    chain: ChainClient;

    /**
     * Optional relayer URL for automated VAA submission
     */
    relayerUrl?: string;

    /**
     * Whether to use testnet or mainnet
     */
    testnet?: boolean;

    /**
     * Whether to persist wallet data to localStorage
     */
    persistWallet?: boolean;
}

export interface WalletManagerConfig {
    /**
     * Whether to cache computed addresses in memory
     */
    cacheAddresses?: boolean;

    /**
     * Whether to persist addresses to localStorage
     */
    persistToStorage?: boolean;

    /**
     * Storage key for localStorage
     */
    storageKey?: string;
}

export interface ChainConfig {
    name: string;
    chainId: number;
    wormholeChainId: number;
    rpcUrl: string;
    explorerUrl: string;
    isEvm: boolean;
    contracts: {
        hub?: string;
        vaultFactory?: string;
        vaultImplementation?: string;
        wormholeCoreBridge: string;
        tokenBridge?: string;
    };
}

// ============================================================================
// Credential Types
// ============================================================================

export interface PasskeyCredential {
    credentialId: string;
    publicKeyX: bigint;
    publicKeyY: bigint;
    keyHash: string;
}

export interface WebAuthnSignature {
    authenticatorData: string;
    clientDataJSON: string;
    challengeIndex: number;
    typeIndex: number;
    r: bigint;
    s: bigint;
}

// ============================================================================
// Action Parameter Types
// ============================================================================

export interface TransferParams {
    targetChain: number; // Wormhole chain ID
    token: string; // Token address or "native"
    recipient: string;
    amount: bigint;
}

export interface ExecuteParams {
    targetChain: number;
    target: string;
    value: bigint;
    data: string;
}

export interface BridgeParams {
    sourceChain: number; // Chain where vault holds the tokens
    token: string; // Token address or "native"
    amount: bigint;
    destinationChain: number; // Wormhole chain ID of destination
    recipient: string; // Recipient address on destination chain
}

export interface ConfigParams {
    targetChain: number;
    configType: number;
    configData: string;
}

// ============================================================================
// Result Types
// ============================================================================

export interface DispatchResult {
    transactionHash: string;
    sequence: bigint;
    userKeyHash: string;
    targetChain: number;
    blockNumber?: number;
}

export interface VaultInfo {
    address: string;
    ownerKeyHash: string;
    chain: string;
    wormholeChainId: number;
    exists: boolean;
}

// ============================================================================
// Wallet & Identity Types
// ============================================================================

/**
 * Represents an address on a specific chain
 */
export interface ChainAddress {
    /** Wormhole chain identifier */
    wormholeChainId: number;
    /** Human-readable chain name */
    chainName: string;
    /** The address on this chain */
    address: string;
    /** Whether this is an EVM chain */
    isEvm: boolean;
    /** Whether the vault has been deployed */
    deployed: boolean;
    /** Transaction hash of vault deployment */
    deploymentTxHash?: string;
    /** For non-EVM chains, the derivation type used */
    derivationType?: 'pda' | 'resource_account' | 'object' | 'create2';
}

/**
 * Unified identity representing a user across all chains
 */
export interface UnifiedIdentity {
    /** The unique key hash derived from public key */
    keyHash: string;
    /** P-256 public key X coordinate */
    publicKeyX: bigint;
    /** P-256 public key Y coordinate */
    publicKeyY: bigint;
    /** WebAuthn credential ID */
    credentialId: string;
    /** Addresses on each supported chain */
    addresses: ChainAddress[];
    /** Timestamp when identity was created */
    createdAt: number;
    /** Timestamp when identity was last updated */
    updatedAt: number;
}

/**
 * Result of vault creation operation
 */
export interface VaultCreationResult {
    /** The vault address */
    address: string;
    /** Transaction hash of the creation */
    transactionHash: string;
    /** Block number where vault was created */
    blockNumber: number;
    /** Gas used for creation */
    gasUsed: bigint;
    /** Whether this was a new deployment or already existed */
    alreadyExisted: boolean;
}

// ============================================================================
// Action Payload Types
// ============================================================================

export interface TransferAction {
    type: 'transfer';
    token: string;
    recipient: string;
    amount: bigint;
}

export interface BridgeAction {
    type: 'bridge';
    token: string;
    amount: bigint;
    targetChain: number;
    recipient: string;
}

export interface ExecuteAction {
    type: 'execute';
    target: string;
    value: bigint;
    data: string;
}

export interface ConfigAction {
    type: 'config';
    configType: number;
    configData: string;
}

export type ActionPayload =
    | TransferAction
    | BridgeAction
    | ExecuteAction
    | ConfigAction
    | { type: string; raw: string };

// ============================================================================
// VAA Types
// ============================================================================

export interface VAA {
    version: number;
    guardianSetIndex: number;
    signatures: VAASignature[];
    timestamp: number;
    nonce: number;
    emitterChain: number;
    emitterAddress: string;
    sequence: bigint;
    consistencyLevel: number;
    payload: string;
    hash: string;
}

export interface VAASignature {
    guardianIndex: number;
    signature: string;
}

export interface VeridexPayload {
    version: number;
    userKeyHash: string;
    targetChain: number;
    nonce: bigint;
    publicKeyX: bigint;
    publicKeyY: bigint;
    actionPayload: string;
}

// ============================================================================
// Chain Client Interface
// ============================================================================

/**
 * Chain-agnostic interface that all chain implementations must follow
 */
export interface ChainClient {
    /**
     * Get the chain configuration
     */
    getConfig(): ChainConfig;

    /**
     * Get the current nonce for a user
     */
    getNonce(userKeyHash: string): Promise<bigint>;

    /**
     * Get the Wormhole message fee
     */
    getMessageFee(): Promise<bigint>;

    /**
     * Build a transfer action payload
     */
    buildTransferPayload(params: TransferParams): Promise<string>;

    /**
     * Build an execute action payload
     */
    buildExecutePayload(params: ExecuteParams): Promise<string>;

    /**
     * Build a bridge action payload
     */
    buildBridgePayload(params: BridgeParams): Promise<string>;

    /**
     * Dispatch an action to the Hub
     */
    dispatch(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        targetChain: number,
        actionPayload: string,
        nonce: bigint,
        signer: any // Chain-specific signer type
    ): Promise<DispatchResult>;

    /**
     * Get vault address for a user (may query on-chain registry)
     */
    getVaultAddress(userKeyHash: string): Promise<string | null>;

    /**
     * Compute vault address deterministically (off-chain calculation)
     * Returns the address the vault will have when deployed
     */
    computeVaultAddress(userKeyHash: string): string;

    /**
     * Check if a vault exists for a user
     */
    vaultExists(userKeyHash: string): Promise<boolean>;

    /**
     * Create a vault for a user
     */
    createVault(userKeyHash: string, signer: any): Promise<VaultCreationResult>;

    /**
     * Estimate gas for vault creation
     */
    estimateVaultCreationGas(userKeyHash: string): Promise<bigint>;

    /**
     * Get the factory contract address (if applicable)
     */
    getFactoryAddress(): string | undefined;

    /**
     * Get the implementation contract address (if applicable)
     */
    getImplementationAddress(): string | undefined;
}

// ============================================================================
// Test Result Types
// ============================================================================

export interface TestResult {
    success: boolean;
    sourceChain: string;
    targetChain: string;
    txHash?: string;
    vaaSequence?: bigint;
    error?: string;
    duration?: number;
}

// ============================================================================
// Transfer Types (Phase 2)
// ============================================================================

/**
 * Prepared transfer with gas estimates
 */
export interface PreparedTransfer {
    /** Original transfer parameters */
    params: TransferParams;
    /** Encoded action payload */
    actionPayload: string;
    /** Current nonce */
    nonce: bigint;
    /** Challenge to sign */
    challenge: Uint8Array;
    /** Estimated gas for the transaction */
    estimatedGas: bigint;
    /** Current gas price */
    gasPrice: bigint;
    /** Wormhole message fee */
    messageFee: bigint;
    /** Total estimated cost (gas + message fee) */
    totalCost: bigint;
    /** Formatted total cost in native token */
    formattedCost: string;
    /** Timestamp when prepared */
    preparedAt: number;
    /** Expiration timestamp (nonce may change) */
    expiresAt: number;
}

/**
 * Enhanced transfer result with tracking info
 */
export interface TransferResult extends DispatchResult {
    /** Transfer parameters used */
    params: TransferParams;
    /** Gas used in the transaction */
    gasUsed?: bigint;
    /** Effective gas price */
    effectiveGasPrice?: bigint;
    /** Total cost of the transaction */
    totalCost?: bigint;
    /** Timestamp of the transfer */
    timestamp: number;
}

/**
 * Receive address information for sharing
 */
export interface ReceiveAddress {
    /** The vault address */
    address: string;
    /** Chain name */
    chainName: string;
    /** Wormhole chain ID */
    wormholeChainId: number;
    /** QR code data URI (if generated) */
    qrCodeDataUri?: string;
    /** Deep link for wallet apps */
    deepLink?: string;
    /** Plain text for copying */
    copyText: string;
}

/**
 * Transaction history entry
 */
export interface TransactionHistoryEntry {
    /** Transaction hash */
    hash: string;
    /** Type of transaction */
    type: 'transfer' | 'bridge' | 'execute' | 'vault_creation';
    /** Transaction status */
    status: 'pending' | 'confirmed' | 'failed';
    /** Source chain */
    sourceChain: number;
    /** Target chain (for cross-chain txs) */
    targetChain?: number;
    /** Token address involved */
    token?: string;
    /** Amount transferred */
    amount?: bigint;
    /** Recipient address */
    recipient?: string;
    /** Timestamp */
    timestamp: number;
    /** Block number */
    blockNumber?: number;
    /** VAA sequence for cross-chain */
    vaaSequence?: bigint;
}

// ============================================================================
// Phase 3: Cross-Chain Types
// ============================================================================

/**
 * Fee breakdown for cross-chain transfers
 */
export interface CrossChainFees {
    /** Gas cost on source chain */
    sourceGas: bigint;
    /** Wormhole message fee */
    messageFee: bigint;
    /** Relayer fee (if using automatic relay) */
    relayerFee: bigint;
    /** Total estimated cost in source chain native token */
    totalCost: bigint;
    /** Formatted total cost */
    formattedTotal: string;
    /** Currency symbol */
    currency: string;
}

/**
 * Prepared bridge with fee estimates
 */
export interface PreparedBridge {
    /** Original bridge parameters */
    params: BridgeParams;
    /** Encoded action payload */
    actionPayload: string;
    /** Current nonce */
    nonce: bigint;
    /** Challenge to sign */
    challenge: Uint8Array;
    /** Fee breakdown */
    fees: CrossChainFees;
    /** Source chain Wormhole ID */
    sourceChain: number;
    /** Destination chain Wormhole ID */
    destinationChain: number;
    /** Timestamp when prepared */
    preparedAt: number;
    /** Expiration timestamp */
    expiresAt: number;
}

/**
 * Result of a bridge/cross-chain transfer
 */
export interface BridgeResult extends DispatchResult {
    /** Bridge parameters used */
    params: BridgeParams;
    /** Source chain Wormhole ID */
    sourceChain: number;
    /** Destination chain Wormhole ID */
    destinationChain: number;
    /** VAA base64 (once fetched) */
    vaa?: string;
    /** Destination chain transaction hash */
    destinationTxHash?: string;
    /** Duration of the operation in ms */
    duration: number;
    /** Timestamp of completion */
    timestamp: number;
}
