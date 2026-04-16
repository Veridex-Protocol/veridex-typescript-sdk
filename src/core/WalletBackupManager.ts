/**
 * Veridex Protocol SDK — Wallet Backup Manager
 *
 * Orchestrates PRF-based encrypted credential backup and recovery using the
 * relayer as a storage backend. With insights from p2pass recovery patterns but
 * implemented natively against Veridex infrastructure.
 *
 * Key concepts:
 * - **PRF seed**: A deterministic 32-byte value extracted from a passkey via the
 *   WebAuthn PRF extension. Same passkey + same salt = same seed, even on a new device
 *   (provided the passkey syncs via iCloud Keychain / Google Password Manager).
 * - **Encrypted archive**: Credentials + wallet metadata encrypted with an AES-GCM key
 *   derived (via HKDF) from the PRF seed. Stored on the relayer. Only the passkey
 *   holder can decrypt.
 * - **Recovery flow**: On a new device, the user authenticates with a synced passkey,
 *   re-derives the same PRF seed, fetches the encrypted archive from the relayer,
 *   decrypts it, and restores their credentials locally.
 *
 * @module WalletBackupManager
 */

import { PasskeyManager, type PasskeyCredential } from './PasskeyManager.js';
import { buildRelayerApiUrl, normalizeRelayerOrigin } from './relayerUrl.js';

// ============================================================================
// Types
// ============================================================================

export interface WalletBackupConfig {
    /** PasskeyManager instance (must be configured with rpId and relayerUrl) */
    passkey: PasskeyManager;
    /** Relayer API URL */
    relayerUrl: string;
    /** API key for relayer authentication */
    apiKey?: string;
}

export interface BackupStatus {
    /** Whether an encrypted archive exists on the relayer */
    hasArchive: boolean;
    /** Archive schema version */
    archiveVersion: number | null;
    /** When the archive was last updated (epoch ms) */
    archiveUpdatedAt: number | null;
    /** Number of active guardians (from relayer) */
    guardianCount: number;
    /** Whether PRF is supported (true = strong backup, false = rawId fallback) */
    prfSupported: boolean;
}

export interface WalletArchivePayload {
    /** All stored credentials */
    credentials: SerializedCredential[];
    /** Backup metadata */
    meta: {
        version: number;
        createdAt: number;
        deviceInfo?: string;
    };
}

interface SerializedCredential {
    credentialId: string;
    publicKeyX: string;
    publicKeyY: string;
    keyHash: string;
}

// ============================================================================
// WalletBackupManager
// ============================================================================

export class WalletBackupManager {
    private readonly passkey: PasskeyManager;
    private readonly relayerUrl: string;
    private readonly apiKey: string;

    constructor(config: WalletBackupConfig) {
        this.passkey = config.passkey;
        this.relayerUrl = normalizeRelayerOrigin(config.relayerUrl);
        this.apiKey = config.apiKey ?? '';
    }

    // ────────────────────────────────────────────────────────────────────────
    // Backup
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Create an encrypted backup of all locally stored credentials and push
     * it to the relayer.
     *
     * Flow:
     * 1. Authenticate with passkey to extract PRF seed
     * 2. Collect all local credentials
     * 3. Encrypt the credential archive with the PRF-derived key
     * 4. POST the encrypted archive to the relayer
     *
     * @param credentialId - Optional: use a specific credential for PRF extraction
     * @returns The keyHash used as the archive identifier
     */
    async backupCredentials(credentialId?: string): Promise<{ keyHash: string; updatedAt: number }> {
        // 1. Extract PRF seed
        const prfSeed = await this.passkey.extractPrfSeed(credentialId);

        // 2. Collect all stored credentials
        const storedCredentials = this.passkey.getAllStoredCredentials();
        if (storedCredentials.length === 0) {
            throw new Error('No credentials to back up. Register a passkey first.');
        }

        // 3. Build the archive payload
        const payload: WalletArchivePayload = {
            credentials: storedCredentials.map(c => ({
                credentialId: c.credentialId,
                publicKeyX: c.publicKeyX.toString(),
                publicKeyY: c.publicKeyY.toString(),
                keyHash: c.keyHash,
            })),
            meta: {
                version: 1,
                createdAt: Date.now(),
                deviceInfo: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
            },
        };

        // 4. Encrypt with PRF-derived key
        const { ciphertext, iv } = await this.passkey.encryptWalletArchive(
            payload as unknown as Record<string, unknown>,
            prfSeed,
        );

        // 5. POST to relayer
        // Use the first credential's keyHash as the archive identifier
        const keyHash = storedCredentials[0].keyHash;

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['X-API-Key'] = this.apiKey;
        }

        const response = await fetch(
            buildRelayerApiUrl(this.relayerUrl, '/recovery/archive'),
            {
                method: 'POST',
                headers,
                body: JSON.stringify({ keyHash, ciphertext, iv, version: 1 }),
            },
        );

        if (!response.ok) {
            const data = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error((data as { error?: string }).error ?? `Backup failed: ${response.status}`);
        }

        const result = await response.json() as { updatedAt: number };
        return { keyHash, updatedAt: result.updatedAt };
    }

    // ────────────────────────────────────────────────────────────────────────
    // Recovery
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Recover credentials from an encrypted archive on the relayer.
     *
     * Flow:
     * 1. Authenticate with a discoverable passkey — the browser shows all
     *    passkeys for this RP, including synced ones from iCloud/Google.
     *    This single WebAuthn ceremony both verifies the user AND extracts
     *    the PRF seed (if PRF is available) in one biometric prompt.
     * 2. Fetch the credential info from the relayer (using the credentialId
     *    from the WebAuthn response).
     * 3. Fetch the encrypted archive from the relayer.
     * 4. Decrypt with the PRF-derived key.
     * 5. Restore credentials to local storage.
     *
     * @returns The restored credentials
     */
    async recoverCredentials(): Promise<PasskeyCredential[]> {
        // 1. Single WebAuthn ceremony: authenticate + extract PRF seed
        //    extractPrfSeed() does a full discoverable-credential auth internally.
        const prfSeed = await this.passkey.extractPrfSeed();

        // 2. The auth in extractPrfSeed set this.passkey.credential.
        //    We also need the credential from the relayer for the keyHash.
        const credential = this.passkey.getCredential();
        if (!credential) {
            // Shouldn't happen since extractPrfSeed just authenticated, but guard.
            throw new Error('Authentication succeeded but no credential was set.');
        }
        const keyHash = credential.keyHash;

        // 3. Fetch encrypted archive from relayer
        const response = await fetch(
            buildRelayerApiUrl(this.relayerUrl, `/recovery/archive/${encodeURIComponent(keyHash)}`),
        );

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('No backup archive found for this identity. Create a backup first.');
            }
            throw new Error(`Failed to fetch archive: ${response.status}`);
        }

        const archiveData = await response.json() as {
            exists: boolean;
            ciphertext: string;
            iv: string;
        };
        if (!archiveData.exists) {
            throw new Error('No backup archive found for this identity.');
        }

        // 4. Decrypt
        const payload = await this.passkey.decryptWalletArchive(
            { ciphertext: archiveData.ciphertext, iv: archiveData.iv },
            prfSeed,
        ) as unknown as WalletArchivePayload;

        // 5. Restore credentials to local storage
        const restoredCredentials: PasskeyCredential[] = payload.credentials.map(c => ({
            credentialId: c.credentialId,
            publicKeyX: BigInt(c.publicKeyX),
            publicKeyY: BigInt(c.publicKeyY),
            keyHash: c.keyHash,
        }));

        for (const cred of restoredCredentials) {
            this.passkey.addCredentialToStorage(cred);
        }

        return restoredCredentials;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Status
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Check backup/recovery readiness for a given identity.
     *
     * @param keyHash - The identity keyHash to check
     * @returns Backup status including archive existence and guardian count
     */
    async getBackupStatus(keyHash: string): Promise<BackupStatus> {
        const response = await fetch(
            buildRelayerApiUrl(this.relayerUrl, `/recovery/status/${encodeURIComponent(keyHash)}`),
        );

        if (!response.ok) {
            throw new Error(`Failed to check backup status: ${response.status}`);
        }

        const data = await response.json() as {
            hasArchive: boolean;
            archiveVersion: number | null;
            archiveUpdatedAt: number | null;
            guardianCount: number;
        };

        const prfSupported = await PasskeyManager.supportsPRF();

        return {
            hasArchive: data.hasArchive,
            archiveVersion: data.archiveVersion,
            archiveUpdatedAt: data.archiveUpdatedAt,
            guardianCount: data.guardianCount,
            prfSupported,
        };
    }

    /**
     * Check whether PRF-based backup is available on this platform.
     * Falls back to rawId-based backup if PRF is unavailable.
     *
     * @returns { prfSupported: boolean } — true means strong backup, false means weaker fallback
     */
    static async checkPlatformSupport(): Promise<{ prfSupported: boolean; webauthnSupported: boolean }> {
        const webauthnSupported = PasskeyManager.isSupported();
        const prfSupported = webauthnSupported && await PasskeyManager.supportsPRF();
        return { prfSupported, webauthnSupported };
    }
}
