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
