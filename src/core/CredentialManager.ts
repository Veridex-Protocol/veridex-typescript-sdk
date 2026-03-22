/**
 * Veridex Protocol SDK - Credential Manager
 *
 * First-class credential inventory management: list, rename, track usage,
 * detect device/platform hints, revoke, and add-backup flows.
 *
 * This module sits on top of PasskeyManager and provides the account-management
 * layer that PasskeyManager's low-level credential storage doesn't cover.
 *
 * @example
 * ```typescript
 * import { CredentialManager } from '@veridex/sdk';
 *
 * const manager = new CredentialManager({ relayerUrl: '...' });
 *
 * // List all credentials with metadata
 * const credentials = manager.listCredentials();
 *
 * // Rename a credential
 * manager.renameCredential(credentialId, 'MacBook Pro');
 *
 * // Check which credential was used most recently
 * const recent = manager.getMostRecentCredential();
 * ```
 */

import type { PasskeyCredential } from './PasskeyManager.js';
import { detectPlatform, type PlatformHint } from './BrowserCapabilities.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended credential metadata stored alongside the base PasskeyCredential.
 */
export interface CredentialMetadata {
    /** User-assigned display name (e.g., "MacBook Pro", "iPhone 15") */
    displayName: string;

    /** When this credential was first registered (ISO 8601) */
    createdAt: string;

    /** When this credential was last used for authentication (ISO 8601) */
    lastUsedAt: string | null;

    /** Number of times this credential has been used */
    useCount: number;

    /** Platform/ecosystem hint from registration context */
    platformHint: PlatformHint;

    /** User agent string at registration time (for device identification) */
    registrationUserAgent: string;

    /** Whether the authenticator indicated backup eligibility */
    backupEligible: boolean | null;

    /** Whether the authenticator indicated the credential is currently backed up */
    backupState: boolean | null;

    /** Whether this is the root (first) credential for the identity */
    isRoot: boolean;

    /** Credential status */
    status: 'active' | 'revoked';
}

/**
 * A credential entry combining the base credential with metadata.
 */
export interface ManagedCredential {
    /** Base passkey credential (credentialId, publicKey, keyHash) */
    credential: PasskeyCredential;

    /** Extended metadata */
    metadata: CredentialMetadata;
}

/**
 * Options for adding a credential to the inventory.
 */
export interface AddCredentialOptions {
    /** Display name for this credential */
    displayName?: string;

    /** Whether this is the root credential */
    isRoot?: boolean;

    /** Backup eligibility from authenticator response */
    backupEligible?: boolean;

    /** Backup state from authenticator response */
    backupState?: boolean;
}

export interface CredentialManagerConfig {
    /** localStorage key for credential metadata */
    storageKey?: string;

    /** Relayer URL for remote credential metadata sync */
    relayerUrl?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_STORAGE_KEY = 'veridex_credential_metadata';

// ============================================================================
// CredentialManager Class
// ============================================================================

export class CredentialManager {
    private config: Required<CredentialManagerConfig>;

    constructor(config: CredentialManagerConfig = {}) {
        this.config = {
            storageKey: config.storageKey ?? DEFAULT_STORAGE_KEY,
            relayerUrl: config.relayerUrl ?? '',
        };
    }

    // ========================================================================
    // Credential Inventory
    // ========================================================================

    /**
     * List all credentials with their metadata.
     * Merges base credentials (from PasskeyManager storage) with metadata.
     */
    listCredentials(): ManagedCredential[] {
        const metadataMap = this.loadMetadataMap();
        const baseCredentials = this.loadBaseCredentials();

        return baseCredentials.map(credential => {
            const metadata = metadataMap[credential.credentialId];
            return {
                credential,
                metadata: metadata ?? this.createDefaultMetadata(credential.credentialId),
            };
        });
    }

    /**
     * Get a single credential by ID with metadata.
     */
    getCredential(credentialId: string): ManagedCredential | null {
        const all = this.listCredentials();
        return all.find(c => c.credential.credentialId === credentialId) ?? null;
    }

    /**
     * Get the most recently used credential.
     */
    getMostRecentCredential(): ManagedCredential | null {
        const all = this.listCredentials();
        if (all.length === 0) return null;

        return all.reduce((latest, current) => {
            const latestTime = latest.metadata.lastUsedAt ? new Date(latest.metadata.lastUsedAt).getTime() : 0;
            const currentTime = current.metadata.lastUsedAt ? new Date(current.metadata.lastUsedAt).getTime() : 0;
            return currentTime > latestTime ? current : latest;
        });
    }

    /**
     * Get the root (first) credential for the identity.
     */
    getRootCredential(): ManagedCredential | null {
        const all = this.listCredentials();
        return all.find(c => c.metadata.isRoot) ?? null;
    }

    /**
     * Get count of active credentials.
     */
    getActiveCount(): number {
        return this.listCredentials().filter(c => c.metadata.status === 'active').length;
    }

    // ========================================================================
    // Credential Lifecycle
    // ========================================================================

    /**
     * Add a newly registered credential to the inventory with metadata.
     * Call this after PasskeyManager.register() to track the credential.
     */
    addCredential(credential: PasskeyCredential, options: AddCredentialOptions = {}): ManagedCredential {
        const now = new Date().toISOString();
        const existingCredentials = this.listCredentials();
        const isFirst = existingCredentials.length === 0;

        const metadata: CredentialMetadata = {
            displayName: options.displayName ?? this.generateDisplayName(),
            createdAt: now,
            lastUsedAt: now,
            useCount: 0,
            platformHint: detectPlatform(),
            registrationUserAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
            backupEligible: options.backupEligible ?? null,
            backupState: options.backupState ?? null,
            isRoot: options.isRoot ?? isFirst,
            status: 'active',
        };

        this.saveMetadata(credential.credentialId, metadata);

        return { credential, metadata };
    }

    /**
     * Record that a credential was used for authentication.
     */
    recordUsage(credentialId: string): void {
        const metadataMap = this.loadMetadataMap();
        const metadata = metadataMap[credentialId];
        if (!metadata) return;

        metadata.lastUsedAt = new Date().toISOString();
        metadata.useCount += 1;
        this.saveMetadataMap(metadataMap);
    }

    /**
     * Rename a credential's display name.
     */
    renameCredential(credentialId: string, displayName: string): boolean {
        const metadataMap = this.loadMetadataMap();
        const metadata = metadataMap[credentialId];
        if (!metadata) return false;

        metadata.displayName = displayName;
        this.saveMetadataMap(metadataMap);
        return true;
    }

    /**
     * Mark a credential as revoked (local metadata only).
     * Actual on-chain revocation happens through VeridexHub.removeKey().
     */
    markRevoked(credentialId: string): boolean {
        const metadataMap = this.loadMetadataMap();
        const metadata = metadataMap[credentialId];
        if (!metadata) return false;

        if (metadata.isRoot) {
            throw new Error('Cannot revoke the root credential. Use identity migration instead.');
        }

        metadata.status = 'revoked';
        this.saveMetadataMap(metadataMap);
        return true;
    }

    /**
     * Update backup state flags (call after authenticator response provides these).
     */
    updateBackupState(credentialId: string, backupEligible: boolean, backupState: boolean): void {
        const metadataMap = this.loadMetadataMap();
        const metadata = metadataMap[credentialId];
        if (!metadata) return;

        metadata.backupEligible = backupEligible;
        metadata.backupState = backupState;
        this.saveMetadataMap(metadataMap);
    }

    /**
     * Remove a credential's metadata from local storage.
     * Does NOT remove the base credential from PasskeyManager storage.
     */
    removeMetadata(credentialId: string): void {
        const metadataMap = this.loadMetadataMap();
        delete metadataMap[credentialId];
        this.saveMetadataMap(metadataMap);
    }

    // ========================================================================
    // Remote Metadata Sync
    // ========================================================================

    /**
     * Sync credential metadata to the relayer for cross-device availability.
     * Only syncs public metadata (display name, platform, timestamps), never keys.
     */
    async syncToRelayer(credentialId: string): Promise<boolean> {
        if (!this.config.relayerUrl) return false;

        const managed = this.getCredential(credentialId);
        if (!managed) return false;

        try {
            const response = await fetch(`${this.config.relayerUrl}/api/v1/credential/metadata`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    keyHash: managed.credential.keyHash,
                    credentialId: managed.credential.credentialId,
                    displayName: managed.metadata.displayName,
                    platformHint: managed.metadata.platformHint,
                    backupEligible: managed.metadata.backupEligible,
                    backupState: managed.metadata.backupState,
                    isRoot: managed.metadata.isRoot,
                    status: managed.metadata.status,
                }),
            });

            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Fetch credential metadata from the relayer (for cross-device restore).
     */
    async fetchFromRelayer(keyHash: string): Promise<ManagedCredential[] | null> {
        if (!this.config.relayerUrl) return null;

        try {
            const response = await fetch(
                `${this.config.relayerUrl}/api/v1/credential/metadata?keyHash=${encodeURIComponent(keyHash)}`
            );

            if (!response.ok) return null;

            const data = await response.json();
            if (!Array.isArray(data.credentials)) return null;

            return data.credentials.map((item: Record<string, unknown>) => ({
                credential: {
                    credentialId: item.credentialId as string,
                    publicKeyX: BigInt(item.publicKeyX as string),
                    publicKeyY: BigInt(item.publicKeyY as string),
                    keyHash: item.keyHash as string,
                },
                metadata: {
                    displayName: (item.displayName as string) || 'Unknown Device',
                    createdAt: (item.createdAt as string) || new Date().toISOString(),
                    lastUsedAt: (item.lastUsedAt as string) || null,
                    useCount: (item.useCount as number) || 0,
                    platformHint: (item.platformHint as PlatformHint) || 'unknown',
                    registrationUserAgent: '',
                    backupEligible: (item.backupEligible as boolean) ?? null,
                    backupState: (item.backupState as boolean) ?? null,
                    isRoot: (item.isRoot as boolean) ?? false,
                    status: (item.status as 'active' | 'revoked') ?? 'active',
                },
            }));
        } catch {
            return null;
        }
    }

    // ========================================================================
    // Migration Helpers
    // ========================================================================

    /**
     * Get a summary suitable for migration/device-addition flows.
     * Returns what the user should see when deciding to add another device.
     */
    getMigrationSummary(): {
        totalCredentials: number;
        activeCredentials: number;
        platforms: PlatformHint[];
        hasBackup: boolean;
        rootDevice: string | null;
    } {
        const all = this.listCredentials();
        const active = all.filter(c => c.metadata.status === 'active');
        const root = all.find(c => c.metadata.isRoot);

        return {
            totalCredentials: all.length,
            activeCredentials: active.length,
            platforms: [...new Set(active.map(c => c.metadata.platformHint))],
            hasBackup: active.some(c => c.metadata.backupState === true),
            rootDevice: root?.metadata.displayName ?? null,
        };
    }

    // ========================================================================
    // Internal Storage
    // ========================================================================

    private loadMetadataMap(): Record<string, CredentialMetadata> {
        if (typeof window === 'undefined') return {};

        try {
            const stored = localStorage.getItem(this.config.storageKey);
            if (!stored) return {};
            return JSON.parse(stored);
        } catch {
            return {};
        }
    }

    private saveMetadataMap(map: Record<string, CredentialMetadata>): void {
        if (typeof window === 'undefined') return;
        localStorage.setItem(this.config.storageKey, JSON.stringify(map));
    }

    private saveMetadata(credentialId: string, metadata: CredentialMetadata): void {
        const map = this.loadMetadataMap();
        map[credentialId] = metadata;
        this.saveMetadataMap(map);
    }

    private loadBaseCredentials(): PasskeyCredential[] {
        if (typeof window === 'undefined') return [];

        try {
            const stored = localStorage.getItem('veridex_credentials');
            if (!stored) return [];
            const data = JSON.parse(stored);
            if (!Array.isArray(data)) return [];

            return data.map((item: Record<string, unknown>) => ({
                credentialId: item.credentialId as string,
                publicKeyX: BigInt(item.publicKeyX as string),
                publicKeyY: BigInt(item.publicKeyY as string),
                keyHash: item.keyHash as string,
            }));
        } catch {
            return [];
        }
    }

    private generateDisplayName(): string {
        const platform = detectPlatform();

        const platformNames: Record<PlatformHint, string> = {
            apple: 'Apple Device',
            google: 'Chrome OS',
            android: 'Android Device',
            windows: 'Windows PC',
            linux: 'Linux Device',
            unknown: 'Unknown Device',
        };

        const baseName = platformNames[platform];
        const existing = this.listCredentials().filter(
            c => c.metadata.displayName.startsWith(baseName)
        );

        if (existing.length === 0) return baseName;
        return `${baseName} (${existing.length + 1})`;
    }

    private createDefaultMetadata(_credentialId: string): CredentialMetadata {
        return {
            displayName: this.generateDisplayName(),
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
            useCount: 0,
            platformHint: detectPlatform(),
            registrationUserAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
            backupEligible: false,
            backupState: false,
            isRoot: this.listCredentials().length === 0,
            status: 'active',
        };
    }
}
