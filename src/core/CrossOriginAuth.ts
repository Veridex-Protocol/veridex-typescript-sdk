/**
 * Veridex Protocol SDK - Cross-Origin Authentication
 * 
 * Enables passkey sharing across different domains using WebAuthn Related Origin Requests.
 * 
 * There are two approaches for cross-domain passkey usage:
 * 
 * 1. **Related Origin Requests (Recommended)** - W3C Standard
 *    - Host a `.well-known/webauthn` file at veridex.network
 *    - Third-party apps use rpId: 'veridex.network' directly
 *    - Requires browser support for Related Origin Requests
 *    - No popup needed, seamless UX
 * 
 * 2. **Auth Portal Flow (Fallback)** - Popup/Redirect Pattern
 *    - User is redirected to auth.veridex.network
 *    - Signs with their passkey at veridex.network
 *    - Returns a session token to the third-party app
 *    - Works on all browsers, but requires popup/redirect
 * 
 * @example Related Origins (Recommended)
 * ```typescript
 * import { createCrossOriginAuth } from '@veridex/sdk';
 * 
 * const auth = createCrossOriginAuth();
 * 
 * // Check if browser supports Related Origin Requests
 * if (await auth.supportsRelatedOrigins()) {
 *   // Direct passkey usage with veridex.network rpId
 *   const credential = await auth.authenticate();
 * } else {
 *   // Fallback to Auth Portal
 *   const session = await auth.authenticateViaPortal();
 * }
 * ```
 * 
 * @example Auth Portal Flow
 * ```typescript
 * const auth = createCrossOriginAuth({
 *   authPortalUrl: 'https://auth.veridex.network',
 *   mode: 'popup', // or 'redirect'
 * });
 * 
 * const session = await auth.connectWithVeridex();
 * // session contains: { address, sessionKey, expiresAt }
 * ```
 */

import { PasskeyManager, type PasskeyCredential, type WebAuthnSignature } from './PasskeyManager.js';

// ============================================================================
// Constants
// ============================================================================

// Re-export VERIDEX_RP_ID from PasskeyManager for consistency
import { VERIDEX_RP_ID } from './PasskeyManager.js';
export { VERIDEX_RP_ID };

/** Default auth portal URL */
export const DEFAULT_AUTH_PORTAL_URL = 'https://auth.veridex.network';

/** Default relayer API URL for server-side session tokens */
export const DEFAULT_RELAYER_URL = 'https://amused-kameko-veridex-demo-37453117.koyeb.app/api/v1';

/** Message types for postMessage communication */
export const AUTH_MESSAGE_TYPES = {
    AUTH_REQUEST: 'VERIDEX_AUTH_REQUEST',
    AUTH_RESPONSE: 'VERIDEX_AUTH_RESPONSE',
    AUTH_ERROR: 'VERIDEX_AUTH_ERROR',
} as const;

// ============================================================================
// Types
// ============================================================================

export interface CrossOriginAuthConfig {
    /** The Veridex RP ID (defaults to veridex.network) */
    rpId?: string;

    /** Auth portal URL for popup/redirect flow */
    authPortalUrl?: string;

    /** Relayer API URL for server-side session tokens */
    relayerUrl?: string;

    /** Authentication mode: popup or redirect */
    mode?: 'popup' | 'redirect';

    /** Popup window features */
    popupFeatures?: string;

    /** Timeout for auth operations (ms) */
    timeout?: number;

    /** Callback URL for redirect mode */
    redirectUri?: string;
}

export interface CrossOriginSession {
    /** User's vault address */
    address: string;

    /** Session key public key (for signing transactions) */
    sessionPublicKey: string;

    /** Session key (encrypted, stored on client) */
    encryptedSessionKey?: string;

    /** When the session expires */
    expiresAt: number;

    /** Proof of passkey ownership */
    signature: WebAuthnSignature;

    /** The credential used */
    credential: PasskeyCredential;

    /** Server-validated session token ID (from relayer) */
    serverSessionId?: string;
}

/** Server-side session token returned by the relayer */
export interface ServerSessionToken {
    id: string;
    keyHash: string;
    appOrigin: string;
    permissions: string[];
    expiresAt: number;
    createdAt: number;
}

export interface AuthPortalMessage {
    type: typeof AUTH_MESSAGE_TYPES[keyof typeof AUTH_MESSAGE_TYPES];
    payload: CrossOriginSession | { error: string; code: string };
    origin: string;
}

// ============================================================================
// CrossOriginAuth Class
// ============================================================================

/**
 * Manages cross-origin passkey authentication for third-party apps.
 * 
 * Third-party developers can use this to enable Veridex passkey authentication
 * in their own applications without users having to create new passkeys.
 */
export class CrossOriginAuth {
    private config: Required<CrossOriginAuthConfig>;
    private passkeyManager: PasskeyManager | null = null;

    constructor(config: CrossOriginAuthConfig = {}) {
        this.config = {
            rpId: config.rpId ?? VERIDEX_RP_ID,
            authPortalUrl: config.authPortalUrl ?? DEFAULT_AUTH_PORTAL_URL,
            relayerUrl: config.relayerUrl ?? DEFAULT_RELAYER_URL,
            mode: config.mode ?? 'popup',
            popupFeatures: config.popupFeatures ?? 'width=500,height=600,left=100,top=100',
            timeout: config.timeout ?? 120000, // 2 minutes
            redirectUri: config.redirectUri ?? (typeof window !== 'undefined' ? window.location.href : ''),
        };
    }

    // ========================================================================
    // Browser Capability Detection
    // ========================================================================

    /**
     * Check if the browser supports Related Origin Requests.
     * This is a WebAuthn Level 3 feature that allows using passkeys across different domains.
     */
    async supportsRelatedOrigins(): Promise<boolean> {
        if (typeof window === 'undefined' || !window.PublicKeyCredential) {
            return false;
        }

        // Check for getClientCapabilities (WebAuthn L3)
        if ('getClientCapabilities' in PublicKeyCredential) {
            try {
                const getCapabilities = (PublicKeyCredential as unknown as { getClientCapabilities: () => Promise<{ relatedOrigins?: boolean }> }).getClientCapabilities;
                const capabilities = await getCapabilities();
                return capabilities?.relatedOrigins === true;
            } catch {
                return false;
            }
        }

        return false;
    }

    /**
     * Check if WebAuthn is supported at all.
     */
    isSupported(): boolean {
        return PasskeyManager.isSupported();
    }

    // ========================================================================
    // Related Origin Requests (Direct Method)
    // ========================================================================

    /**
     * Authenticate using Related Origin Requests.
     * This allows using a passkey registered at veridex.network from any origin
     * listed in the /.well-known/webauthn file.
     * 
     * @throws If browser doesn't support Related Origin Requests
     * @throws If the current origin isn't listed in veridex.network's well-known file
     */
    async authenticate(challenge?: Uint8Array): Promise<{
        credential: PasskeyCredential;
        signature: WebAuthnSignature;
    }> {
        // Create PasskeyManager with veridex.network as rpId
        const manager = new PasskeyManager({
            rpId: this.config.rpId,
            rpName: 'Veridex Protocol',
        });

        // Use discoverable credential flow (passkey autofill)
        return manager.authenticate(challenge);
    }

    /**
     * Register a new passkey with veridex.network as the RP.
     * This should only be called from veridex.network origins.
     */
    async register(username: string, displayName: string): Promise<PasskeyCredential> {
        const manager = new PasskeyManager({
            rpId: this.config.rpId,
            rpName: 'Veridex Protocol',
        });

        return manager.register(username, displayName);
    }

    // ========================================================================
    // Auth Portal Flow (Popup/Redirect)
    // ========================================================================

    /**
     * Authenticate via the Veridex Auth Portal.
     * Opens a popup or redirects to auth.veridex.network where the user
     * signs with their passkey, then returns a session to the calling app.
     */
    async connectWithVeridex(): Promise<CrossOriginSession> {
        if (this.config.mode === 'popup') {
            return this.authenticateViaPopup();
        } else {
            return this.initiateRedirectAuth();
        }
    }

    /**
     * Popup-based authentication flow.
     */
    private async authenticateViaPopup(): Promise<CrossOriginSession> {
        return new Promise((resolve, reject) => {
            const state = this.generateState();
            const authUrl = new URL('/auth', this.config.authPortalUrl);
            authUrl.searchParams.set('state', state);
            authUrl.searchParams.set('origin', window.location.origin);
            authUrl.searchParams.set('callback', 'postMessage');

            // Open popup
            const popup = window.open(
                authUrl.toString(),
                'veridex-auth',
                this.config.popupFeatures
            );

            if (!popup) {
                reject(new Error('Failed to open auth popup. Please allow popups for this site.'));
                return;
            }

            // Set timeout
            const timeoutId = setTimeout(() => {
                popup.close();
                window.removeEventListener('message', messageHandler);
                reject(new Error('Authentication timed out'));
            }, this.config.timeout);

            // Listen for response
            const messageHandler = (event: MessageEvent<AuthPortalMessage>) => {
                // Validate origin
                if (!event.origin.includes('veridex.network')) {
                    return;
                }

                const { type, payload } = event.data;

                if (type === AUTH_MESSAGE_TYPES.AUTH_RESPONSE) {
                    clearTimeout(timeoutId);
                    window.removeEventListener('message', messageHandler);
                    popup.close();
                    resolve(payload as CrossOriginSession);
                } else if (type === AUTH_MESSAGE_TYPES.AUTH_ERROR) {
                    clearTimeout(timeoutId);
                    window.removeEventListener('message', messageHandler);
                    popup.close();
                    const error = payload as { error: string; code: string };
                    reject(new Error(error.error));
                }
            };

            window.addEventListener('message', messageHandler);
        });
    }

    /**
     * Redirect-based authentication flow.
     * Stores state in sessionStorage and redirects to auth portal.
     */
    private async initiateRedirectAuth(): Promise<CrossOriginSession> {
        const state = this.generateState();

        // Store state for verification after redirect
        sessionStorage.setItem('veridex_auth_state', state);
        sessionStorage.setItem('veridex_auth_redirect', this.config.redirectUri);

        const authUrl = new URL('/auth', this.config.authPortalUrl);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
        authUrl.searchParams.set('origin', window.location.origin);

        // Redirect - this will not resolve, page navigates away
        window.location.href = authUrl.toString();

        // This promise never resolves as page navigates
        return new Promise(() => { });
    }

    /**
     * Complete redirect-based authentication.
     * Call this on your callback page to extract the session from URL params.
     */
    completeRedirectAuth(): CrossOriginSession | null {
        const params = new URLSearchParams(window.location.search);
        const session = params.get('session');
        const state = params.get('state');
        const error = params.get('error');

        // Verify state
        const storedState = sessionStorage.getItem('veridex_auth_state');
        if (state !== storedState) {
            throw new Error('Invalid auth state - possible CSRF attack');
        }

        // Clean up
        sessionStorage.removeItem('veridex_auth_state');
        sessionStorage.removeItem('veridex_auth_redirect');

        // Clear URL params
        window.history.replaceState({}, '', window.location.pathname);

        if (error) {
            throw new Error(error);
        }

        if (!session) {
            return null;
        }

        return JSON.parse(atob(session)) as CrossOriginSession;
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Generate a random state string for CSRF protection.
     */
    private generateState(): string {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Get the RP ID being used.
     */
    getRpId(): string {
        return this.config.rpId;
    }

    /**
     * Get the auth portal URL.
     */
    getAuthPortalUrl(): string {
        return this.config.authPortalUrl;
    }

    // ========================================================================
    // Server-Side Session Tokens (ADR-0018)
    // ========================================================================

    /**
     * Create a server-validated session token via the relayer.
     * Call this after authenticating (via ROR or auth portal) to get a
     * server-side session that the relayer can verify on subsequent requests.
     */
    async createServerSession(
        session: CrossOriginSession,
        options?: {
            permissions?: string[];
            expiresInMs?: number;
        }
    ): Promise<ServerSessionToken> {
        const keyHash = session.credential?.keyHash;
        if (!keyHash) {
            throw new Error('Session must include credential with keyHash');
        }

        const response = await fetch(`${this.config.relayerUrl}/session/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                keyHash,
                appOrigin: typeof window !== 'undefined' ? window.location.origin : '',
                sessionPublicKey: session.sessionPublicKey || '',
                permissions: options?.permissions ?? ['read', 'transfer'],
                expiresInMs: options?.expiresInMs ?? 3600000,
                signature: session.signature,
            }),
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(data.error || `Failed to create server session: ${response.status}`);
        }

        const data = await response.json();
        return data.session as ServerSessionToken;
    }

    /**
     * Validate an existing server session token.
     * Returns the session details if valid, null if expired/revoked.
     */
    async validateServerSession(sessionId: string): Promise<ServerSessionToken | null> {
        const response = await fetch(`${this.config.relayerUrl}/session/${encodeURIComponent(sessionId)}`);

        if (!response.ok) {
            return null;
        }

        const data = await response.json();
        if (!data.valid) {
            return null;
        }

        return data.session as ServerSessionToken;
    }

    /**
     * Revoke a server session token.
     */
    async revokeServerSession(sessionId: string): Promise<boolean> {
        const response = await fetch(`${this.config.relayerUrl}/session/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE',
        });
        return response.ok;
    }

    /**
     * Full authentication flow: authenticate + create server session.
     * Automatically detects ROR support and falls back to auth portal.
     */
    async authenticateAndCreateSession(options?: {
        permissions?: string[];
        expiresInMs?: number;
    }): Promise<{ session: CrossOriginSession; serverSession: ServerSessionToken }> {
        let session: CrossOriginSession;

        if (await this.supportsRelatedOrigins()) {
            const result = await this.authenticate();
            session = {
                address: '',
                sessionPublicKey: '',
                expiresAt: Date.now() + (options?.expiresInMs ?? 3600000),
                signature: result.signature,
                credential: result.credential,
            };
        } else {
            session = await this.connectWithVeridex();
        }

        const serverSession = await this.createServerSession(session, options);
        session.serverSessionId = serverSession.id;

        return { session, serverSession };
    }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a CrossOriginAuth instance for third-party app integration.
 * 
 * @example
 * ```typescript
 * const auth = createCrossOriginAuth();
 * 
 * // Check for Related Origin support
 * if (await auth.supportsRelatedOrigins()) {
 *   const { credential, signature } = await auth.authenticate();
 * } else {
 *   const session = await auth.connectWithVeridex();
 * }
 * ```
 */
export function createCrossOriginAuth(config?: CrossOriginAuthConfig): CrossOriginAuth {
    return new CrossOriginAuth(config);
}

// ============================================================================
// Auth Portal Helper (for veridex.network auth page)
// ============================================================================

/**
 * Helper for the auth portal page to send results back to the calling app.
 * Only used on auth.veridex.network, not in third-party apps.
 */
export function sendAuthResponse(
    session: CrossOriginSession,
    targetOrigin: string
): void {
    if (window.opener) {
        // Popup mode
        window.opener.postMessage({
            type: AUTH_MESSAGE_TYPES.AUTH_RESPONSE,
            payload: session,
            origin: window.location.origin,
        }, targetOrigin);
    } else {
        // Redirect mode - encode session in URL
        const redirectUri = new URLSearchParams(window.location.search).get('redirect_uri');
        const state = new URLSearchParams(window.location.search).get('state');

        if (redirectUri) {
            const url = new URL(redirectUri);
            url.searchParams.set('session', btoa(JSON.stringify(session)));
            url.searchParams.set('state', state || '');
            window.location.href = url.toString();
        }
    }
}

/**
 * Helper for the auth portal to send an error back to the calling app.
 */
export function sendAuthError(
    error: string,
    code: string,
    targetOrigin: string
): void {
    if (window.opener) {
        window.opener.postMessage({
            type: AUTH_MESSAGE_TYPES.AUTH_ERROR,
            payload: { error, code },
            origin: window.location.origin,
        }, targetOrigin);
    } else {
        const redirectUri = new URLSearchParams(window.location.search).get('redirect_uri');
        const state = new URLSearchParams(window.location.search).get('state');

        if (redirectUri) {
            const url = new URL(redirectUri);
            url.searchParams.set('error', error);
            url.searchParams.set('error_code', code);
            url.searchParams.set('state', state || '');
            window.location.href = url.toString();
        }
    }
}
