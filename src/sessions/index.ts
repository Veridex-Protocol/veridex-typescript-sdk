/**
 * Veridex Protocol SDK - Session Manager
 * 
 * Manages ephemeral session keys for fast, native L1-speed transactions
 * after initial biometric authentication.
 * 
 * Key Features:
 * - One-time Passkey auth to create session
 * - Instant software-backed signing for subsequent transactions
 * - Query-based validation on Spokes (no VAA wait)
 * - ~400ms transactions after initial setup
 * - Secure encrypted storage (AES-GCM)
 * - Auto-refresh before expiry
 * - Per-session value limits
 */

import { ethers } from 'ethers';
import type {
    SessionKey,
    SessionConfig,
    SessionSignature,
    SessionManagerConfig,
    SessionStorage,
    SessionEvent,
    SessionEventCallback,
    ActionParams,
    SessionSignedAction,
} from './types.js';
import { SessionError, SessionErrorCode } from './types.js';
import {
    generateSecp256k1KeyPair,
    computeSessionKeyHash,
    signWithSessionKey,
    hashAction,
    validateSessionConfig,
    DEFAULT_SESSION_DURATION,
    DEFAULT_REFRESH_BUFFER,
} from './crypto.js';
import { createSessionStorage } from './storage.js';
import type { PasskeyCredential } from '../core/PasskeyManager.js';
import type { RegisterSessionParams, RevokeSessionParams } from '../types.js';

// ============================================================================
// Hub Client Interface
// ============================================================================

/**
 * Interface for Hub contract interactions
 * 
 * This should be implemented by chain clients (e.g., EVMHubClientAdapter).
 */
interface HubClient {
    /**
     * Register a session on the Hub
     * 
     * @param params Registration parameters with Passkey signature
     * @returns Promise that resolves when registration completes
     */
    registerSession(params: RegisterSessionParams): Promise<void>;
    
    /**
     * Revoke a session on the Hub
     * 
     * @param params Revocation parameters with Passkey signature
     * @returns Promise that resolves when revocation completes
     */
    revokeSession(params: RevokeSessionParams): Promise<void>;

    /**
     * Revoke all sessions for an identity on the Hub (emergency wipe).
     * 
     * @param params WebAuthn-signed revocation covering all sessions.
     * @returns Number of sessions revoked.
     */
    revokeAllSessions?(params: RevokeSessionParams): Promise<number>;
}

// ============================================================================
// Session Manager Class
// ============================================================================

/**
 * Manages session key lifecycle and signing operations
 * 
 * Usage:
 * ```typescript
 * const manager = new SessionManager(credential, hubClient, passkeySign, config);
 * 
 * // Create session (requires biometric)
 * const session = await manager.createSession();
 * 
 * // Sign actions instantly (no biometric)
 * const signature = await manager.signWithSession(action);
 * 
 * // Revoke session (requires biometric)
 * await manager.revokeSession();
 * ```
 */
class SessionManager {
    private currentSession: SessionKey | null = null;
    private storage: SessionStorage;
    private config: Required<SessionConfig>;
    private refreshTimer: NodeJS.Timeout | null = null;
    private eventCallbacks: SessionEventCallback[] = [];
    private debug: boolean;
    
    /**
     * @param credential User's Passkey credential (for Hub interaction)
     * @param hubClient Hub client for on-chain session operations
     * @param passkeySign Function to sign challenges with Passkey
     * @param config Session configuration
     * @param managerConfig SessionManager configuration
     */
    constructor(
        private credential: PasskeyCredential,
        private hubClient: HubClient,
        private passkeySign: (challenge: Uint8Array) => Promise<any>,
        config: Partial<SessionConfig>,
        managerConfig?: SessionManagerConfig
    ) {
        // Validate and set configuration
        this.config = {
            duration: config.duration ?? DEFAULT_SESSION_DURATION,
            maxValue: config.maxValue ?? 0n,
            autoRefresh: config.autoRefresh ?? true,
            refreshBuffer: config.refreshBuffer ?? DEFAULT_REFRESH_BUFFER,
            chainScopes: config.chainScopes ?? [],
        };
        
        validateSessionConfig(this.config);
        
        this.debug = managerConfig?.debug ?? false;
        
        // Initialize storage
        this.storage = managerConfig?.encryptionKey
            ? createSessionStorage(credential.credentialId)
            : createSessionStorage(
                credential.credentialId,
                managerConfig?.storageBackend
            );
    }
    
    // ========================================================================
    // Session Lifecycle
    // ========================================================================
    
    /**
     * Create a new session (requires biometric authentication)
     * 
     * Steps:
     * 1. Generate ephemeral secp256k1 key pair
     * 2. Sign session registration with Passkey
     * 3. Register session on Hub contract
     * 4. Store session securely (encrypted)
     * 5. Start auto-refresh timer (if enabled)
     * 
     * @returns Created session key
     * @throws SessionError if registration fails
     */
    async createSession(): Promise<SessionKey> {
        try {
            this.log('Creating new session...');
            
            // 1. Generate ephemeral key pair
            const keyPair = generateSecp256k1KeyPair();
            const keyHash = computeSessionKeyHash(keyPair.publicKey);
            
            this.log('Generated session key:', keyHash);
            
            // 2. Prepare challenge for Passkey signing
            const challenge = ethers.solidityPacked(
                ['string', 'bytes32', 'uint256', 'uint256'],
                ['registerSession', keyHash, this.config.duration, this.config.maxValue]
            );
            
            this.log('Challenge prepared, requesting Passkey signature...');
            
            // 3. Sign with Passkey (this triggers biometric prompt)
            const signature = await this.passkeySign(ethers.getBytes(challenge));
            
            this.log('Passkey signature obtained, registering on Hub...');
            
            // 4. Register session on Hub
            const registerParams: RegisterSessionParams = {
                signature,
                publicKeyX: this.credential.publicKeyX,
                publicKeyY: this.credential.publicKeyY,
                sessionKeyHash: keyHash,
                duration: this.config.duration,
                maxValue: this.config.maxValue,
                requireUV: true,
            };
            
            await this.hubClient.registerSession(registerParams);
            
            this.log('Session registered on Hub');
            
            // 5. Create session object
            const expiry = Date.now() + this.config.duration * 1000;
            
            this.currentSession = {
                publicKey: keyPair.publicKey,
                privateKey: keyPair.privateKey,
                keyHash,
                expiry,
                maxValue: this.config.maxValue,
                chainScopes: this.config.chainScopes,
                userKeyHash: this.credential.keyHash,
            };
            
            // 6. Store securely
            await this.storage.save(this.currentSession);
            
            this.log('Session stored securely');
            
            // 7. Start auto-refresh
            if (this.config.autoRefresh) {
                this.scheduleRefresh();
            }
            
            // 8. Emit event
            this.emit({ type: 'session-created', session: this.currentSession });
            
            return this.currentSession;
            
        } catch (error) {
            const sessionError = error instanceof SessionError
                ? error
                : new SessionError(
                    'Failed to create session',
                    SessionErrorCode.REGISTRATION_FAILED,
                    error
                );
            
            this.emit({ type: 'session-error', error: sessionError });
            throw sessionError;
        }
    }
    
    /**
     * Load existing session from storage
     * 
     * @returns Loaded session or null if no valid session exists
     */
    async loadSession(): Promise<SessionKey | null> {
        try {
            this.log('Loading session from storage...');
            
            const session = await this.storage.load();
            
            if (!session) {
                this.log('No session found in storage');
                return null;
            }
            
            // Verify session is not expired
            if (session.expiry <= Date.now()) {
                this.log('Session expired, clearing...');
                await this.storage.clear();
                return null;
            }
            
            this.currentSession = session;
            this.log('Session loaded:', session.keyHash);
            
            // Start auto-refresh if enabled
            if (this.config.autoRefresh) {
                this.scheduleRefresh();
            }
            
            this.emit({ type: 'session-loaded', session });
            
            return session;
            
        } catch (error) {
            this.log('Failed to load session:', error);
            await this.storage.clear();
            return null;
        }
    }
    
    /**
     * Revoke the current session (requires biometric authentication)
     * 
     * @throws SessionError if no active session or revocation fails
     */
    async revokeSession(): Promise<void> {
        if (!this.currentSession) {
            throw new SessionError(
                'No active session to revoke',
                SessionErrorCode.NO_ACTIVE_SESSION
            );
        }
        
        try {
            this.log('Revoking session:', this.currentSession.keyHash);
            
            // 1. Prepare challenge for revocation
            const challenge = ethers.solidityPacked(
                ['string', 'bytes32'],
                ['revokeSession', this.currentSession.keyHash]
            );
            
            // 2. Sign with Passkey (biometric prompt)
            const signature = await this.passkeySign(ethers.getBytes(challenge));
            
            this.log('Passkey signature obtained, revoking on Hub...');
            
            // 3. Revoke on Hub
            const revokeParams: RevokeSessionParams = {
                signature,
                publicKeyX: this.credential.publicKeyX,
                publicKeyY: this.credential.publicKeyY,
                sessionKeyHash: this.currentSession.keyHash,
                requireUV: true,
            };
            
            await this.hubClient.revokeSession(revokeParams);
            
            this.log('Session revoked on Hub');
            
            // 4. Clear local storage
            await this.storage.clear();
            
            // 5. Cancel refresh timer
            if (this.refreshTimer) {
                clearTimeout(this.refreshTimer);
                this.refreshTimer = null;
            }
            
            const revokedKeyHash = this.currentSession.keyHash;
            this.currentSession = null;
            
            // 6. Emit event
            this.emit({ type: 'session-revoked', keyHash: revokedKeyHash });
            
            this.log('Session revoked successfully');
            
        } catch (error) {
            const sessionError = error instanceof SessionError
                ? error
                : new SessionError(
                    'Failed to revoke session',
                    SessionErrorCode.REVOCATION_FAILED,
                    error
                );
            
            this.emit({ type: 'session-error', error: sessionError });
            throw sessionError;
        }
    }

    /**
     * Revoke **all** sessions for this identity (emergency wipe).
     *
     * Requires a WebAuthn biometric prompt.  If the Hub client does not
     * support batch revocation the method falls back to revoking the
     * local session only and throws so the caller knows the on-chain
     * wipe did not happen.
     */
    async revokeAllSessions(): Promise<number> {
        if (!this.hubClient.revokeAllSessions) {
            // If the current session is active, revoke it individually
            if (this.currentSession) {
                await this.revokeSession();
            }
            throw new SessionError(
                'Hub client does not support batch session revocation. Only the local session was revoked.',
                SessionErrorCode.BATCH_REVOCATION_FAILED,
            );
        }

        try {
            this.log('Revoking ALL sessions...');

            // Build a challenge that is clearly distinct from single-revoke
            const challenge = ethers.solidityPacked(
                ['string'],
                ['revokeAllSessions'],
            );

            const signature = await this.passkeySign(ethers.getBytes(challenge));

            this.log('Passkey signature obtained, batch revoking on Hub...');

            const revokeParams: RevokeSessionParams = {
                signature,
                publicKeyX: this.credential.publicKeyX,
                publicKeyY: this.credential.publicKeyY,
                sessionKeyHash: ethers.ZeroHash, // sentinel: revoke all
                requireUV: true,
            };

            const count = await this.hubClient.revokeAllSessions(revokeParams);

            // Clear local state
            await this.storage.clear();
            if (this.refreshTimer) {
                clearTimeout(this.refreshTimer);
                this.refreshTimer = null;
            }
            this.currentSession = null;

            this.emit({ type: 'all-sessions-revoked', count });
            this.log(`All sessions revoked (${count} on-chain)`);
            return count;

        } catch (error) {
            if (error instanceof SessionError) throw error;
            const sessionError = new SessionError(
                'Failed to revoke all sessions',
                SessionErrorCode.BATCH_REVOCATION_FAILED,
                error,
            );
            this.emit({ type: 'session-error', error: sessionError });
            throw sessionError;
        }
    }
    
    // ========================================================================
    // Session Signing
    // ========================================================================
    
    /**
     * Sign an action with the session key (instant, no biometric)
     * 
     * @param action Action parameters to sign
     * @returns Session signature
     * @throws SessionError if no active session, expired, or value exceeds limit
     */
    async signWithSession(action: ActionParams): Promise<SessionSignature> {
        if (!this.currentSession) {
            throw new SessionError(
                'No active session available',
                SessionErrorCode.NO_ACTIVE_SESSION
            );
        }
        
        const now = Date.now();
        if (now >= this.currentSession.expiry) {
            this.emit({ type: 'session-expired', keyHash: this.currentSession.keyHash });
            throw new SessionError(
                'Session has expired',
                SessionErrorCode.SESSION_EXPIRED
            );
        }
        
        if (this.currentSession.maxValue > 0n && action.value > this.currentSession.maxValue) {
            throw new SessionError(
                `Transaction value (${action.value}) exceeds session limit (${this.currentSession.maxValue})`,
                SessionErrorCode.VALUE_EXCEEDS_LIMIT,
                { value: action.value, limit: this.currentSession.maxValue }
            );
        }
        
        if (
            this.currentSession.chainScopes.length > 0 &&
            !this.currentSession.chainScopes.includes(action.targetChain)
        ) {
            throw new SessionError(
                `Chain ${action.targetChain} not in session scope`,
                SessionErrorCode.CHAIN_NOT_ALLOWED,
                { chain: action.targetChain, allowedChains: this.currentSession.chainScopes }
            );
        }
        
        this.log('Signing action with session key...');
        
        const messageHash = hashAction(action);
        const { signature } = signWithSessionKey(
            this.currentSession.privateKey,
            messageHash
        );
        
        const sessionSignature: SessionSignature = {
            signature,
            sessionKeyHash: this.currentSession.keyHash,
            userKeyHash: this.currentSession.userKeyHash,
            timestamp: now,
            nonce: action.nonce,
        };
        
        this.log('Action signed successfully');
        
        return sessionSignature;
    }
    
    /**
     * Sign an action and prepare for submission
     * 
     * @param action Action parameters
     * @returns Session-signed action ready for submission
     */
    async signAction(action: ActionParams): Promise<SessionSignedAction> {
        const signature = await this.signWithSession(action);
        
        return {
            action,
            signature,
            readyToSubmit: true,
        };
    }
    
    // ========================================================================
    // Session State
    // ========================================================================
    
    /**
     * Check if a session is currently active
     * 
     * @returns True if an active, non-expired session exists
     */
    isActive(): boolean {
        if (!this.currentSession) {
            return false;
        }
        return Date.now() < this.currentSession.expiry;
    }
    
    /**
     * Get current session information (if active)
     * 
     * @returns Current session or null
     */
    getSession(): SessionKey | null {
        if (!this.isActive()) {
            return null;
        }
        return this.currentSession;
    }
    
    /**
     * Get time remaining until session expiry (in seconds)
     * 
     * @returns Seconds until expiry, or 0 if no active session
     */
    getTimeRemaining(): number {
        if (!this.currentSession) {
            return 0;
        }
        const remaining = Math.floor((this.currentSession.expiry - Date.now()) / 1000);
        return Math.max(0, remaining);
    }
    
    // ========================================================================
    // Auto-Refresh
    // ========================================================================
    
    /**
     * Schedule automatic session refresh
     */
    private scheduleRefresh(): void {
        if (!this.currentSession || !this.config.autoRefresh) {
            return;
        }
        
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        
        const timeUntilRefresh = this.currentSession.expiry - Date.now() - (this.config.refreshBuffer * 1000);
        
        if (timeUntilRefresh <= 0) {
            this.log('Session expiring soon, refreshing now...');
            this.refreshSession().catch(error => {
                this.log('Auto-refresh failed:', error);
                this.emit({ type: 'session-error', error });
            });
            return;
        }
        
        this.log(`Scheduling refresh in ${Math.floor(timeUntilRefresh / 1000)}s`);
        
        this.refreshTimer = setTimeout(() => {
            this.refreshSession().catch(error => {
                this.log('Auto-refresh failed:', error);
                this.emit({ type: 'session-error', error });
            });
        }, timeUntilRefresh);
    }
    
    /**
     * Refresh the current session (creates a new session)
     * 
     * @returns New session key
     */
    async refreshSession(): Promise<SessionKey> {
        this.log('Refreshing session...');
        const newSession = await this.createSession();
        this.emit({ type: 'session-refreshed', session: newSession });
        return newSession;
    }
    
    // ========================================================================
    // Event Handling
    // ========================================================================
    
    /**
     * Register an event callback
     */
    on(callback: SessionEventCallback): void {
        this.eventCallbacks.push(callback);
    }
    
    /**
     * Unregister an event callback
     */
    off(callback: SessionEventCallback): void {
        this.eventCallbacks = this.eventCallbacks.filter(cb => cb !== callback);
    }
    
    /**
     * Emit a session event
     */
    private emit(event: SessionEvent): void {
        for (const callback of this.eventCallbacks) {
            try {
                callback(event);
            } catch (error) {
                console.error('Session event callback error:', error);
            }
        }
    }
    
    // ========================================================================
    // Utilities
    // ========================================================================
    
    /**
     * Log debug message (if debug enabled)
     */
    private log(...args: any[]): void {
        if (this.debug) {
            console.log('[SessionManager]', ...args);
        }
    }
    
    /**
     * Cleanup resources
     */
    dispose(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
        this.eventCallbacks = [];
        this.currentSession = null;
    }
}

// ============================================================================
// Exports
// ============================================================================

export { SessionManager };
export type { HubClient };
export * from './types.js';
export * from './crypto.js';
export * from './storage.js';