/**
 * Veridex Protocol SDK - Session Key Management Types
 * 
 * Type definitions for ephemeral session keys that enable
 * native L1-speed transactions after initial biometric auth.
 */

// ============================================================================
// Core Session Types
// ============================================================================

/**
 * Ephemeral session key for fast software-backed signing
 * 
 * Security model:
 * - Private key encrypted at rest (AES-GCM)
 * - Max 24-hour duration enforced on-chain
 * - Value limits prevent unlimited spending
 * - Chain scopes restrict cross-chain usage
 */
export interface SessionKey {
    /** Public key of the session (secp256k1) */
    publicKey: Uint8Array;
    
    /** Private key (MUST be encrypted before storage) */
    privateKey: Uint8Array;
    
    /** Keccak256 hash of public key (on-chain identifier) */
    keyHash: string;
    
    /** Unix timestamp when session expires (milliseconds) */
    expiry: number;
    
    /** Maximum transaction value allowed (in token's base units) */
    maxValue: bigint;
    
    /** Wormhole chain IDs where this session is valid */
    chainScopes: number[];
    
    /** User's Passkey key hash (binds session to user) */
    userKeyHash: string;
}

/**
 * Configuration for session creation and lifecycle
 */
export interface SessionConfig {
    /** Session duration in seconds (default: 3600 = 1 hour, max: 86400 = 24 hours) */
    duration: number;
    
    /** Maximum transaction value in base units (0 = unlimited, but NOT RECOMMENDED) */
    maxValue: bigint;
    
    /** Auto-refresh session before expiry (default: true) */
    autoRefresh: boolean;
    
    /** Refresh buffer time in seconds (refresh this many seconds before expiry, default: 300 = 5 min) */
    refreshBuffer?: number;
    
    /** Chain scopes - which Wormhole chain IDs can use this session (empty = all chains) */
    chainScopes?: number[];
}

/**
 * Signature produced by signing with a session key
 * 
 * This is a lightweight software signature (secp256k1) that can be
 * validated on-chain via CCQ to Hub's isSessionActive() state.
 */
export interface SessionSignature {
    /** ECDSA signature (r, s, v) from session private key */
    signature: Uint8Array;
    
    /** Session key hash (links signature to registered session) */
    sessionKeyHash: string;
    
    /** User's Passkey key hash (for Hub state query) */
    userKeyHash: string;
    
    /** Timestamp when signature was created (for replay prevention) */
    timestamp: number;
    
    /** Optional nonce for additional replay protection */
    nonce?: number;
}

/**
 * Configuration for SessionManager initialization
 */
export interface SessionManagerConfig {
    /** Default session configuration */
    defaultSessionConfig: SessionConfig;
    
    /** Storage backend ('indexeddb' or 'localstorage', default: 'indexeddb') */
    storageBackend?: 'indexeddb' | 'localstorage';
    
    /** Enable debug logging */
    debug?: boolean;
    
    /** Custom encryption key derivation (for testing only) */
    encryptionKey?: CryptoKey;
}

// ============================================================================
// Session Lifecycle Events
// ============================================================================

/**
 * Events emitted during session lifecycle
 */
export type SessionEvent = 
    | { type: 'session-created'; session: SessionKey }
    | { type: 'session-loaded'; session: SessionKey }
    | { type: 'session-expired'; keyHash: string }
    | { type: 'session-refreshed'; session: SessionKey }
    | { type: 'session-revoked'; keyHash: string }
    | { type: 'session-error'; error: Error };

export type SessionEventCallback = (event: SessionEvent) => void;

// ============================================================================
// Storage Interface
// ============================================================================

/**
 * Interface for session storage implementations
 * 
 * Implementations MUST:
 * - Encrypt private keys before storage
 * - Use secure key derivation (e.g., PBKDF2 or similar)
 * - Provide atomic read/write/delete operations
 */
export interface SessionStorage {
    /**
     * Save a session (private key will be encrypted)
     */
    save(session: SessionKey): Promise<void>;
    
    /**
     * Load the active session (private key will be decrypted)
     */
    load(): Promise<SessionKey | null>;
    
    /**
     * Clear all stored sessions
     */
    clear(): Promise<void>;
    
    /**
     * Check if a session exists
     */
    exists(): Promise<boolean>;
}

// ============================================================================
// Action Signing Types
// ============================================================================

/**
 * Parameters for an action to be signed with a session key
 */
export interface ActionParams {
    /** Action type (transfer, execute, bridge, etc.) */
    action: string;
    
    /** Target chain (Wormhole chain ID) */
    targetChain: number;
    
    /** Transaction value in base units */
    value: bigint;
    
    /** Action-specific payload */
    payload: Uint8Array;
    
    /** Nonce for replay prevention */
    nonce: number;
    
    /** Optional deadline timestamp */
    deadline?: number;
}

/**
 * Result of session-signed action
 */
export interface SessionSignedAction {
    /** Original action parameters */
    action: ActionParams;
    
    /** Session signature */
    signature: SessionSignature;
    
    /** Ready to submit to relayer or on-chain */
    readyToSubmit: boolean;
}

// ============================================================================
// Error Types
// ============================================================================

export class SessionError extends Error {
    constructor(
        message: string,
        public code: SessionErrorCode,
        public details?: unknown
    ) {
        super(message);
        this.name = 'SessionError';
    }
}

export enum SessionErrorCode {
    NO_ACTIVE_SESSION = 'NO_ACTIVE_SESSION',
    SESSION_EXPIRED = 'SESSION_EXPIRED',
    VALUE_EXCEEDS_LIMIT = 'VALUE_EXCEEDS_LIMIT',
    CHAIN_NOT_ALLOWED = 'CHAIN_NOT_ALLOWED',
    STORAGE_ERROR = 'STORAGE_ERROR',
    ENCRYPTION_ERROR = 'ENCRYPTION_ERROR',
    INVALID_CONFIG = 'INVALID_CONFIG',
    REGISTRATION_FAILED = 'REGISTRATION_FAILED',
    REVOCATION_FAILED = 'REVOCATION_FAILED',
}
