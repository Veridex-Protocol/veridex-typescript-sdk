/**
 * Veridex Protocol SDK - Type Definitions
 */

// ============================================================================
// Configuration Types
// ============================================================================

export interface VeridexConfig {
  hubChainId: number;
  hubRpcUrl: string;
  hubContractAddress: string;
  relayerUrl?: string;
}

export interface ChainConfig {
  name: string;
  chainId: number;
  wormholeChainId: number;
  hubChainId?: number; // Wormhole chain ID of the Hub (for cross-chain auth)
  rpcUrl: string;
  explorerUrl: string;
  isEvm: boolean;
  contracts: {
    hub?: string;
    vaultFactory?: string;
    vaultImplementation?: string;
    wormholeCoreBridge: string;
    tokenBridge?: string;
    /** Wormhole guardian signature verifier (Stacks Phase 2) */
    wormholeVerifier?: string;
    /** VAA-authorized vault for cross-chain transfers (Stacks Phase 2) */
    vaultVaa?: string;
    /** Agent marketplace contract (Monad Agent Gateway) */
    serviceDirectory?: string;
    /** ACP-204 P-256 verifier wrapper (Avalanche) */
    p256Verifier?: string;
    /** ICM Spoke for cross-L1 session bridging (Avalanche Teleporter) */
    icmSpoke?: string;
    /** Chainlink AVAX/USD price feed (Avalanche) */
    chainlinkAvaxUsd?: string;
    /** Chainlink USDC/USD price feed (Avalanche) */
    chainlinkUsdcUsd?: string;
    /** Chainlink USDT/USD price feed (Avalanche) */
    chainlinkUsdtUsd?: string;
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
  assurance?: any;
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
// Action Types
// ============================================================================

export interface TransferParams {
  targetChain: number;
  token: string; // address or "native"
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
  token: string; // Token address (or "native" for native token)
  amount: bigint;
  destinationChain: number; // Wormhole chain ID of destination
  recipient: string; // Recipient address on destination chain (hex string)
}

export interface DispatchResult {
  transactionHash: string;
  sequence: bigint;
  userKeyHash: string;
  targetChain: number;
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

// ============================================================================
// Query Types (Issue #9/#10/#11/#12)
// ============================================================================

/**
 * Wormhole Query proof for optimistic execution
 * Allows ~5-7 second latency vs ~120+ seconds for VAA
 */
export interface QueryProof {
  /** Raw query response bytes from Wormhole Guardians */
  queryResponse: string; // hex
  /** Guardian signatures (13/19 quorum) */
  signatures: string; // hex
}

/**
 * User preference for execution path
 */
export type ExecutionPath = 'query' | 'vaa' | 'auto';

/**
 * Result from query-based submission
 */
export interface QuerySubmissionResult {
  /** Whether submission succeeded */
  success: boolean;
  /** Transaction hash on spoke chain */
  txHash?: string;
  /** Execution path used ('query' or 'vaa') */
  path: ExecutionPath;
  /** Latency in milliseconds */
  latencyMs?: number;
  /** Error message if failed */
  error?: string;
  /** Whether fallback to VAA was triggered */
  fellBack?: boolean;
}

// ============================================================================
// Session Key Types (Issue #13)
// ============================================================================

/**
 * Session key structure for temporary authentication
 * Enables native L1 speed for repeat transactions without biometric auth
 */
export interface SessionKey {
  /** Hash of the temporary session public key */
  sessionKeyHash: string;
  /** Unix timestamp when session expires */
  expiry: number;
  /** Maximum transaction value for this session (0 = unlimited) */
  maxValue: bigint;
  /** Whether session was manually revoked */
  revoked: boolean;
}

/**
 * Result from session validation query
 */
export interface SessionValidationResult {
  /** Whether session is currently active */
  active: boolean;
  /** Session expiry timestamp (0 if inactive) */
  expiry: number;
  /** Maximum transaction value (0 if inactive) */
  maxValue: bigint;
  /** Index in sessions array */
  sessionIndex: number;
}

/**
 * Parameters for registering a new session
 */
export interface RegisterSessionParams {
  /** Signature for Passkey authentication */
  signature: WebAuthnSignature;
  /** User's Passkey public key X coordinate */
  publicKeyX: bigint;
  /** User's Passkey public key Y coordinate */
  publicKeyY: bigint;
  /** Hash of the temporary session public key */
  sessionKeyHash: string;
  /** Session duration in seconds (max 24 hours) */
  duration: number;
  /** Maximum transaction value (0 = unlimited) */
  maxValue: bigint;
  /** Whether to require user verification */
  requireUV: boolean;
}

/**
 * Parameters for revoking a session
 */
export interface RevokeSessionParams {
  /** Signature for Passkey authentication */
  signature: WebAuthnSignature;
  /** User's Passkey public key X coordinate */
  publicKeyX: bigint;
  /** User's Passkey public key Y coordinate */
  publicKeyY: bigint;
  /** Hash of the session key to revoke */
  sessionKeyHash: string;
  /** Whether to require user verification */
  requireUV: boolean;
}

// ============================================================================
// Backup Passkey / Multi-Key Identity Types (Issue #22)
// ============================================================================

/**
 * Identity state for multi-key management
 * First passkey registered becomes the immutable identity root
 */
export interface IdentityState {
  /** Identity key hash (first passkey's keyHash) */
  identity: string;
  /** Number of authorized keys */
  keyCount: number;
  /** Maximum allowed keys per identity */
  maxKeys: number;
  /** Whether the specified key is the root identity */
  isRoot: boolean;
}

/**
 * Result from registering a backup passkey
 */
export interface AddBackupKeyResult {
  /** Transaction hash on Hub chain */
  transactionHash: string;
  /** Wormhole sequence number for cross-chain sync */
  sequence: bigint;
  /** The identity the key was added to */
  identity: string;
  /** The new key hash that was added */
  newKeyHash: string;
  /** Total number of keys after addition */
  keyCount: number;
}

/**
 * Result from removing a passkey
 */
export interface RemoveKeyResult {
  /** Transaction hash on Hub chain */
  transactionHash: string;
  /** Wormhole sequence number for cross-chain sync */
  sequence: bigint;
  /** The identity the key was removed from */
  identity: string;
  /** The key hash that was removed */
  removedKeyHash: string;
  /** Remaining number of keys after removal */
  keyCount: number;
}

/**
 * Authorized key information
 */
export interface AuthorizedKey {
  /** Key hash of the authorized passkey */
  keyHash: string;
  /** Whether this key is the root identity key */
  isRoot: boolean;
}

// =============================================================================
//                      SOCIAL RECOVERY TYPES (Issue #23)
// =============================================================================

/**
 * Guardian configuration for an identity
 */
export interface GuardianConfig {
  /** Array of guardian key hashes */
  guardians: string[];
  /** Required approvals for recovery (M-of-N) */
  threshold: bigint;
  /** Whether guardians have been configured */
  isConfigured: boolean;
}

/**
 * Recovery status for an identity
 */
export interface RecoveryStatus {
  /** Whether a recovery is currently active */
  isActive: boolean;
  /** Proposed new owner key hash */
  newOwnerKeyHash: string;
  /** Timestamp when recovery was initiated */
  initiatedAt: bigint;
  /** Current number of guardian approvals */
  approvalCount: bigint;
  /** Required approvals for recovery */
  threshold: bigint;
  /** Timestamp when recovery can be executed (after timelock) */
  canExecuteAt: bigint;
  /** Timestamp when recovery expires */
  expiresAt: bigint;
}

/**
 * Result from setting up guardians
 */
export interface SetupGuardiansResult {
  /** Transaction hash on Hub chain */
  transactionHash: string;
  /** Wormhole sequence number for cross-chain sync */
  sequence: bigint;
  /** The identity guardians were set up for */
  identity: string;
  /** Array of guardian key hashes */
  guardians: string[];
  /** Required approvals for recovery */
  threshold: bigint;
}

/**
 * Result from adding a guardian
 */
export interface AddGuardianResult {
  /** Transaction hash on Hub chain */
  transactionHash: string;
  /** Wormhole sequence number for cross-chain sync */
  sequence: bigint;
  /** The identity the guardian was added to */
  identity: string;
  /** The guardian key hash that was added */
  guardianKeyHash: string;
}

/**
 * Result from removing a guardian
 */
export interface RemoveGuardianResult {
  /** Transaction hash on Hub chain */
  transactionHash: string;
  /** Wormhole sequence number for cross-chain sync */
  sequence: bigint;
  /** The identity the guardian was removed from */
  identity: string;
  /** The guardian key hash that was removed */
  guardianKeyHash: string;
}

/**
 * Result from initiating recovery
 */
export interface InitiateRecoveryResult {
  /** Transaction hash on Hub chain */
  transactionHash: string;
  /** Wormhole sequence number for cross-chain sync */
  sequence: bigint;
  /** The identity being recovered */
  identity: string;
  /** Proposed new owner key hash */
  newOwnerKeyHash: string;
  /** Timestamp when recovery can be executed */
  canExecuteAt: bigint;
}

/**
 * Result from approving recovery
 */
export interface ApproveRecoveryResult {
  /** Transaction hash on Hub chain */
  transactionHash: string;
  /** Wormhole sequence number for cross-chain sync */
  sequence: bigint;
  /** The identity being recovered */
  identity: string;
  /** The guardian who approved */
  guardianKeyHash: string;
  /** Current approval count */
  approvalCount: bigint;
  /** Required approvals */
  threshold: bigint;
}

/**
 * Result from executing recovery
 */
export interface ExecuteRecoveryResult {
  /** Transaction hash on Hub chain */
  transactionHash: string;
  /** Wormhole sequence number for cross-chain sync */
  sequence: bigint;
  /** The identity that was recovered */
  identity: string;
  /** The new owner key hash */
  newOwnerKeyHash: string;
}

/**
 * Result from cancelling recovery
 */
export interface CancelRecoveryResult {
  /** Transaction hash on Hub chain */
  transactionHash: string;
  /** Wormhole sequence number for cross-chain sync */
  sequence: bigint;
  /** The identity whose recovery was cancelled */
  identity: string;
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

export type ActionPayload = TransferAction | BridgeAction | ExecuteAction | ConfigAction | { type: string; raw: string };

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
  hash: string; // keccak256 of the body (for verification)
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
// Vault Types
// ============================================================================

export interface VaultInfo {
  address: string;
  ownerKeyHash: string;
  chain: string;
  wormholeChainId: number;
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
