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
     * Get vault address for a user
     */
    getVaultAddress(userKeyHash: string): Promise<string | null>;

    /**
     * Check if a vault exists for a user
     */
    vaultExists(userKeyHash: string): Promise<boolean>;

    /**
     * Create a vault for a user
     */
    createVault(userKeyHash: string, signer: any): Promise<string>;
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
