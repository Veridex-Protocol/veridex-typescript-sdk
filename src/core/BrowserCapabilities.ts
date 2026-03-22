/**
 * Veridex Protocol SDK - Browser Capabilities Detection
 *
 * Detects WebAuthn and passkey capabilities of the current browser/platform.
 * Used to drive UI branching (ROR vs Auth Portal fallback, conditional UI,
 * PRF availability, backup-state awareness, hybrid transport support).
 *
 * @example
 * ```typescript
 * import { detectCapabilities } from '@veridex/sdk';
 *
 * const caps = await detectCapabilities();
 * if (caps.relatedOrigins) {
 *   // Direct cross-domain passkey usage
 * } else {
 *   // Auth Portal popup/redirect fallback
 * }
 *
 * if (caps.prf) {
 *   // Can use PRF extension for recovery vault encryption
 * }
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Complete browser capability report for passkey-related features.
 */
export interface BrowserCapabilities {
    /** Basic WebAuthn support (navigator.credentials + PublicKeyCredential) */
    webauthn: boolean;

    /** Platform authenticator available (Touch ID, Face ID, Windows Hello) */
    platformAuthenticator: boolean;

    /** Related Origin Requests (WebAuthn L3) — cross-domain passkey use */
    relatedOrigins: boolean;

    /** Conditional UI / autofill-assisted passkey selection */
    conditionalMediation: boolean;

    /** Hybrid transport (phone as authenticator via QR/BLE) */
    hybridTransport: boolean;

    /** PRF extension (pseudo-random function for key wrapping) */
    prf: boolean;

    /** User-verifying platform authenticator (biometric bound) */
    userVerification: boolean;

    /** Whether passkeys on this device are backed up / synced to cloud */
    backupEligible: boolean | null;

    /** Detected platform / ecosystem */
    platform: PlatformHint;

    /** Raw getClientCapabilities result (if available) */
    rawCapabilities: Record<string, boolean> | null;
}

/**
 * Platform hint for ecosystem-specific guidance.
 */
export type PlatformHint =
    | 'apple'      // iCloud Keychain
    | 'google'     // Google Password Manager
    | 'windows'    // Windows Hello
    | 'android'    // Android (could be Google PM or third-party)
    | 'linux'
    | 'unknown';

/**
 * Recommendation for the best authentication strategy on this browser.
 */
export interface AuthStrategy {
    /** Primary method to attempt */
    primary: 'ror' | 'conditional' | 'portal-popup' | 'portal-redirect';
    /** Fallback if primary fails */
    fallback: 'portal-popup' | 'portal-redirect' | 'none';
    /** Whether hybrid transport is available as an additional option */
    hybridAvailable: boolean;
    /** Human-readable explanation */
    reason: string;
}

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Detect the current platform/ecosystem from user agent and platform strings.
 */
export function detectPlatform(): PlatformHint {
    if (typeof navigator === 'undefined') return 'unknown';

    const ua = navigator.userAgent.toLowerCase();
    const platform = (navigator.platform || '').toLowerCase();

    if (/iphone|ipad|ipod|macintosh|macos/.test(ua) || /mac/.test(platform)) {
        return 'apple';
    }
    if (/android/.test(ua)) {
        return 'android';
    }
    if (/windows/.test(ua) || /win/.test(platform)) {
        return 'windows';
    }
    if (/cros/.test(ua)) {
        return 'google'; // ChromeOS uses Google Password Manager
    }
    if (/linux/.test(ua) || /linux/.test(platform)) {
        return 'linux';
    }

    return 'unknown';
}

// ============================================================================
// Capability Detection
// ============================================================================

/**
 * Detect all browser capabilities related to passkeys and WebAuthn.
 *
 * This performs multiple async checks in parallel for efficiency.
 * Safe to call on any browser — returns sensible defaults for unsupported features.
 */
export async function detectCapabilities(): Promise<BrowserCapabilities> {
    // Quick bail for non-browser environments
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return {
            webauthn: false,
            platformAuthenticator: false,
            relatedOrigins: false,
            conditionalMediation: false,
            hybridTransport: false,
            prf: false,
            userVerification: false,
            backupEligible: null,
            platform: 'unknown',
            rawCapabilities: null,
        };
    }

    const hasWebAuthn = !!(window.PublicKeyCredential);
    if (!hasWebAuthn) {
        return {
            webauthn: false,
            platformAuthenticator: false,
            relatedOrigins: false,
            conditionalMediation: false,
            hybridTransport: false,
            prf: false,
            userVerification: false,
            backupEligible: null,
            platform: detectPlatform(),
            rawCapabilities: null,
        };
    }

    // Run independent checks in parallel
    const [
        platformAuth,
        conditionalUI,
        clientCaps,
    ] = await Promise.all([
        detectPlatformAuthenticator(),
        detectConditionalMediation(),
        detectClientCapabilities(),
    ]);

    const platform = detectPlatform();

    return {
        webauthn: true,
        platformAuthenticator: platformAuth,
        relatedOrigins: clientCaps?.relatedOrigins ?? false,
        conditionalMediation: conditionalUI,
        hybridTransport: clientCaps?.hybridTransport ?? false,
        prf: clientCaps?.prf ?? false,
        userVerification: platformAuth, // UV requires platform authenticator
        backupEligible: inferBackupEligibility(platform),
        platform,
        rawCapabilities: clientCaps?.raw ?? null,
    };
}

/**
 * Get the recommended authentication strategy based on detected capabilities.
 */
export async function getAuthStrategy(): Promise<AuthStrategy> {
    const caps = await detectCapabilities();

    if (caps.relatedOrigins) {
        return {
            primary: 'ror',
            fallback: 'portal-popup',
            hybridAvailable: caps.hybridTransport,
            reason: 'Browser supports Related Origin Requests — direct cross-domain passkey use.',
        };
    }

    if (caps.conditionalMediation) {
        return {
            primary: 'conditional',
            fallback: 'portal-popup',
            hybridAvailable: caps.hybridTransport,
            reason: 'Browser supports conditional UI — passkey autofill available, with portal fallback.',
        };
    }

    // No ROR or conditional UI — use portal
    if (caps.webauthn && caps.platformAuthenticator) {
        return {
            primary: 'portal-popup',
            fallback: 'portal-redirect',
            hybridAvailable: caps.hybridTransport,
            reason: 'Browser lacks ROR/conditional UI — using Auth Portal popup flow.',
        };
    }

    return {
        primary: 'portal-redirect',
        fallback: 'none',
        hybridAvailable: false,
        reason: 'Limited WebAuthn support — using Auth Portal redirect flow.',
    };
}

// ============================================================================
// Internal Detection Helpers
// ============================================================================

async function detectPlatformAuthenticator(): Promise<boolean> {
    try {
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
        return false;
    }
}

async function detectConditionalMediation(): Promise<boolean> {
    try {
        if ('isConditionalMediationAvailable' in PublicKeyCredential) {
            const isAvailable = (PublicKeyCredential as unknown as {
                isConditionalMediationAvailable: () => Promise<boolean>;
            }).isConditionalMediationAvailable;
            return await isAvailable();
        }
    } catch {
        // Not supported
    }
    return false;
}

interface ClientCapabilities {
    relatedOrigins: boolean;
    hybridTransport: boolean;
    prf: boolean;
    raw: Record<string, boolean>;
}

async function detectClientCapabilities(): Promise<ClientCapabilities | null> {
    try {
        if ('getClientCapabilities' in PublicKeyCredential) {
            const getCapabilities = (PublicKeyCredential as unknown as {
                getClientCapabilities: () => Promise<Record<string, boolean>>;
            }).getClientCapabilities;
            const capabilities = await getCapabilities();

            return {
                relatedOrigins: capabilities?.['relatedOrigins'] === true,
                hybridTransport: capabilities?.['hybridTransport'] === true,
                prf: capabilities?.['prf'] === true,
                raw: capabilities ?? {},
            };
        }
    } catch {
        // getClientCapabilities not supported
    }
    return null;
}

/**
 * Infer backup eligibility based on platform.
 * Returns null if we can't determine (backup state is only available
 * from the authenticator response during registration/authentication).
 */
function inferBackupEligibility(platform: PlatformHint): boolean | null {
    switch (platform) {
        case 'apple':
            return true; // iCloud Keychain syncs passkeys
        case 'google':
        case 'android':
            return true; // Google Password Manager syncs passkeys
        case 'windows':
            return true; // Windows Hello supports passkey backup (Windows 11+)
        case 'linux':
            return false; // No native passkey sync on Linux
        default:
            return null;
    }
}
