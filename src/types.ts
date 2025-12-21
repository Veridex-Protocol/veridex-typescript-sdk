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
