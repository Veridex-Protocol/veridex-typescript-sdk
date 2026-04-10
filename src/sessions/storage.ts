/**
 * Veridex Protocol SDK - Secure Session Storage
 * 
 * Provides encrypted storage for session keys using IndexedDB or LocalStorage.
 * Private keys are ALWAYS encrypted at rest using AES-GCM.
 * 
 * Security guarantees:
 * - Private keys never stored in plaintext
 * - Encryption keys derived from Passkey credential ID (user-bound)
 * - Keys are non-extractable (remain in browser's crypto subsystem)
 * - Automatic cleanup on revocation or expiry
 */

import { ethers } from 'ethers';
import type { SessionKey, SessionStorage } from './types.js';
import { SessionError, SessionErrorCode } from './types.js';
import { encrypt, decrypt, deriveEncryptionKey } from './crypto.js';

interface StoredSessionRecord {
    keyHash: string;
    publicKey: number[] | string;
    encryptedPrivateKey: number[] | string;
    expiry: number;
    maxValue: string;
    chainScopes?: number[];
    userKeyHash: string;
    savedAt: number;
}

// ============================================================================
// IndexedDB Session Storage (Preferred)
// ============================================================================

/** IndexedDB database name */
const DB_NAME = 'veridex-sessions';

/** IndexedDB version */
const DB_VERSION = 1;

/** Object store name */
const STORE_NAME = 'sessions';

/**
 * IndexedDB-based session storage with encryption
 * 
 * Preferred storage backend because:
 * - Larger storage quota (~50MB vs ~10MB)
 * - Structured storage (no serialization overhead)
 * - Better performance for binary data
 * - Non-blocking async API
 */
export class IndexedDBSessionStorage implements SessionStorage {
    private db: IDBDatabase | null = null;
    private encryptionKey: CryptoKey | null = null;
    private credentialId: string;
    
    /**
     * @param credentialId User's Passkey credential ID (for key derivation)
     */
    constructor(credentialId: string) {
        if (!credentialId) {
            throw new SessionError(
                'Credential ID required for session storage',
                SessionErrorCode.INVALID_CONFIG
            );
        }
        this.credentialId = credentialId;
    }
    
    /**
     * Initialize database connection
     */
    private async initialize(): Promise<void> {
        if (this.db) return;
        
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = () => {
                reject(new SessionError(
                    'Failed to open IndexedDB',
                    SessionErrorCode.STORAGE_ERROR,
                    request.error
                ));
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                
                // Create object store if it doesn't exist
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'keyHash' });
                    
                    // Create indexes for efficient queries
                    store.createIndex('userKeyHash', 'userKeyHash', { unique: false });
                    store.createIndex('expiry', 'expiry', { unique: false });
                }
            };
        });
    }
    
    /**
     * Get or derive encryption key
     */
    private async getEncryptionKey(): Promise<CryptoKey> {
        if (this.encryptionKey) {
            return this.encryptionKey;
        }
        
        this.encryptionKey = await deriveEncryptionKey(this.credentialId);
        return this.encryptionKey;
    }
    
    /**
     * Save a session (encrypts private key)
     */
    async save(session: SessionKey): Promise<void> {
        try {
            await this.initialize();
            
            if (!this.db) {
                throw new Error('Database not initialized');
            }
            
            // Get encryption key
            const key = await this.getEncryptionKey();
            
            // Encrypt private key
            const encryptedPrivateKey = await encrypt(session.privateKey, key);
            
            // Prepare storage object (private key encrypted)
            const storageObject = {
                keyHash: session.keyHash,
                publicKey: Array.from(session.publicKey), // Store as array for IndexedDB
                encryptedPrivateKey: Array.from(encryptedPrivateKey),
                expiry: session.expiry,
                maxValue: session.maxValue.toString(), // BigInt as string
                chainScopes: session.chainScopes,
                userKeyHash: session.userKeyHash,
                savedAt: Date.now(),
            };
            
            // Store in IndexedDB
            return new Promise((resolve, reject) => {
                const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.put(storageObject);
                
                request.onsuccess = () => resolve();
                request.onerror = () => {
                    reject(new SessionError(
                        'Failed to save session',
                        SessionErrorCode.STORAGE_ERROR,
                        request.error
                    ));
                };
            });
        } catch (error) {
            if (error instanceof SessionError) {
                throw error;
            }
            throw new SessionError(
                'Failed to save session',
                SessionErrorCode.STORAGE_ERROR,
                error
            );
        }
    }

    private async decryptSession(stored: StoredSessionRecord): Promise<SessionKey> {
        const key = await this.getEncryptionKey();
        const encryptedPrivateKey = new Uint8Array(stored.encryptedPrivateKey as number[]);
        const privateKey = await decrypt(encryptedPrivateKey, key);

        return {
            keyHash: stored.keyHash,
            publicKey: new Uint8Array(stored.publicKey as number[]),
            privateKey,
            expiry: stored.expiry,
            maxValue: BigInt(stored.maxValue),
            chainScopes: stored.chainScopes ?? [],
            userKeyHash: stored.userKeyHash,
        };
    }

    private async pruneExpiredSessions(records: StoredSessionRecord[]): Promise<StoredSessionRecord[]> {
        const now = Date.now();
        const validRecords = records.filter((record) => record.expiry > now);
        const expiredRecords = records.filter((record) => record.expiry <= now);

        if (expiredRecords.length > 0) {
            await Promise.all(expiredRecords.map((record) => this.remove(record.keyHash)));
        }

        return validRecords.sort((left, right) => right.savedAt - left.savedAt);
    }
    
    /**
     * Load a session (decrypts private key)
     */
    async load(keyHash?: string): Promise<SessionKey | null> {
        try {
            await this.initialize();
            
            if (!this.db) {
                throw new Error('Database not initialized');
            }
            
            const sessions = keyHash
                ? await this.getSessionByKeyHash(keyHash)
                : await this.getAllSessions();

            const validSessions = await this.pruneExpiredSessions(sessions);

            if (validSessions.length === 0) {
                return null;
            }

            return this.decryptSession(validSessions[0]);
        } catch (error) {
            if (error instanceof SessionError) {
                throw error;
            }
            throw new SessionError(
                'Failed to load session',
                SessionErrorCode.STORAGE_ERROR,
                error
            );
        }
    }
    
    /**
     * Get all stored sessions (internal helper)
     */
    private async getAllSessions(): Promise<Array<any>> {
        if (!this.db) {
            return [];
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => {
                reject(new SessionError(
                    'Failed to get sessions',
                    SessionErrorCode.STORAGE_ERROR,
                    request.error
                ));
            };
        });
    }

    private async getSessionByKeyHash(keyHash: string): Promise<StoredSessionRecord[]> {
        if (!this.db) {
            return [];
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(keyHash);

            request.onsuccess = () => {
                resolve(request.result ? [request.result] : []);
            };
            request.onerror = () => {
                reject(new SessionError(
                    'Failed to get session',
                    SessionErrorCode.STORAGE_ERROR,
                    request.error
                ));
            };
        });
    }

    async loadAll(): Promise<SessionKey[]> {
        try {
            await this.initialize();

            if (!this.db) {
                return [];
            }

            const records = await this.pruneExpiredSessions(await this.getAllSessions());
            return Promise.all(records.map((record) => this.decryptSession(record)));
        } catch (error) {
            if (error instanceof SessionError) {
                throw error;
            }
            throw new SessionError(
                'Failed to load sessions',
                SessionErrorCode.STORAGE_ERROR,
                error
            );
        }
    }

    async remove(keyHash: string): Promise<void> {
        try {
            await this.initialize();

            if (!this.db) {
                return;
            }

            return new Promise((resolve, reject) => {
                const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.delete(keyHash);

                request.onsuccess = () => resolve();
                request.onerror = () => {
                    reject(new SessionError(
                        'Failed to remove session',
                        SessionErrorCode.STORAGE_ERROR,
                        request.error
                    ));
                };
            });
        } catch (error) {
            if (error instanceof SessionError) {
                throw error;
            }
            throw new SessionError(
                'Failed to remove session',
                SessionErrorCode.STORAGE_ERROR,
                error
            );
        }
    }
    
    /**
     * Clear all sessions
     */
    async clear(): Promise<void> {
        try {
            await this.initialize();
            
            if (!this.db) {
                return;
            }
            
            return new Promise((resolve, reject) => {
                const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.clear();
                
                request.onsuccess = () => resolve();
                request.onerror = () => {
                    reject(new SessionError(
                        'Failed to clear sessions',
                        SessionErrorCode.STORAGE_ERROR,
                        request.error
                    ));
                };
            });
        } catch (error) {
            if (error instanceof SessionError) {
                throw error;
            }
            throw new SessionError(
                'Failed to clear sessions',
                SessionErrorCode.STORAGE_ERROR,
                error
            );
        }
    }
    
    /**
     * Check if any session exists
     */
    async exists(keyHash?: string): Promise<boolean> {
        try {
            return (await this.load(keyHash)) !== null;
        } catch {
            return false;
        }
    }
    
    /**
     * Close database connection
     */
    close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}

// ============================================================================
// LocalStorage Session Storage (Fallback)
// ============================================================================

/** LocalStorage key prefix */
const STORAGE_KEY_PREFIX = 'veridex-session-';

/**
 * LocalStorage-based session storage with encryption
 * 
 * Fallback storage backend when IndexedDB is unavailable.
 * 
 * Limitations:
 * - Smaller storage quota (~10MB)
 * - Synchronous API (blocks main thread)
 * - String-based storage (requires serialization)
 */
export class LocalStorageSessionStorage implements SessionStorage {
    private encryptionKey: CryptoKey | null = null;
    private credentialId: string;
    private credentialHash: string;
    private legacyStorageKey: string;
    
    /**
     * @param credentialId User's Passkey credential ID (for key derivation)
     */
    constructor(credentialId: string) {
        if (!credentialId) {
            throw new SessionError(
                'Credential ID required for session storage',
                SessionErrorCode.INVALID_CONFIG
            );
        }
        this.credentialId = credentialId;
        this.credentialHash = ethers.keccak256(ethers.toUtf8Bytes(credentialId));
        this.legacyStorageKey = STORAGE_KEY_PREFIX + this.credentialHash;
    }

    private getSessionStorageKey(keyHash: string): string {
        return `${STORAGE_KEY_PREFIX}${this.credentialHash}:${keyHash}`;
    }

    private getSessionStoragePrefix(): string {
        return `${STORAGE_KEY_PREFIX}${this.credentialHash}:`;
    }

    private async deserializeSession(stored: StoredSessionRecord): Promise<SessionKey> {
        const key = await this.getEncryptionKey();
        const encryptedPrivateKey = typeof stored.encryptedPrivateKey === 'string'
            ? ethers.getBytes(stored.encryptedPrivateKey)
            : new Uint8Array(stored.encryptedPrivateKey);
        const privateKey = await decrypt(encryptedPrivateKey, key);

        return {
            keyHash: stored.keyHash,
            publicKey: typeof stored.publicKey === 'string'
                ? ethers.getBytes(stored.publicKey)
                : new Uint8Array(stored.publicKey),
            privateKey,
            expiry: stored.expiry,
            maxValue: BigInt(stored.maxValue),
            chainScopes: stored.chainScopes ?? [],
            userKeyHash: stored.userKeyHash,
        };
    }

    private getRawRecords(): StoredSessionRecord[] {
        const records: StoredSessionRecord[] = [];
        const prefix = this.getSessionStoragePrefix();

        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (!key || !key.startsWith(prefix)) {
                continue;
            }

            const value = localStorage.getItem(key);
            if (!value) {
                continue;
            }

            records.push(JSON.parse(value) as StoredSessionRecord);
        }

        const legacyValue = localStorage.getItem(this.legacyStorageKey);
        if (legacyValue) {
            records.push(JSON.parse(legacyValue) as StoredSessionRecord);
        }

        return records;
    }

    private async getValidRecords(): Promise<StoredSessionRecord[]> {
        const now = Date.now();
        const validRecords: StoredSessionRecord[] = [];

        for (const record of this.getRawRecords()) {
            if (record.expiry <= now) {
                await this.remove(record.keyHash);
                continue;
            }

            validRecords.push(record);
        }

        return validRecords.sort((left, right) => right.savedAt - left.savedAt);
    }
    
    /**
     * Get or derive encryption key
     */
    private async getEncryptionKey(): Promise<CryptoKey> {
        if (this.encryptionKey) {
            return this.encryptionKey;
        }
        
        this.encryptionKey = await deriveEncryptionKey(this.credentialId);
        return this.encryptionKey;
    }
    
    /**
     * Save a session (encrypts private key)
     */
    async save(session: SessionKey): Promise<void> {
        try {
            // Get encryption key
            const key = await this.getEncryptionKey();
            
            // Encrypt private key
            const encryptedPrivateKey = await encrypt(session.privateKey, key);
            
            // Prepare storage object
            const storageObject = {
                keyHash: session.keyHash,
                publicKey: ethers.hexlify(session.publicKey),
                encryptedPrivateKey: ethers.hexlify(encryptedPrivateKey),
                expiry: session.expiry,
                maxValue: session.maxValue.toString(),
                chainScopes: session.chainScopes,
                userKeyHash: session.userKeyHash,
                savedAt: Date.now(),
            };
            
            // Store as JSON
            localStorage.setItem(this.getSessionStorageKey(session.keyHash), JSON.stringify(storageObject));
        } catch (error) {
            if (error instanceof SessionError) {
                throw error;
            }
            throw new SessionError(
                'Failed to save session',
                SessionErrorCode.STORAGE_ERROR,
                error
            );
        }
    }
    
    /**
     * Load a session (decrypts private key)
     */
    async load(keyHash?: string): Promise<SessionKey | null> {
        try {
            const records = keyHash
                ? (await this.getValidRecords()).filter((record) => record.keyHash === keyHash)
                : await this.getValidRecords();

            if (records.length === 0) {
                return null;
            }

            return this.deserializeSession(records[0]);
        } catch (error) {
            // Clear corrupted data
            await this.clear();
            
            if (error instanceof SessionError) {
                throw error;
            }
            throw new SessionError(
                'Failed to load session',
                SessionErrorCode.STORAGE_ERROR,
                error
            );
        }
    }

    async loadAll(): Promise<SessionKey[]> {
        try {
            const records = await this.getValidRecords();
            return Promise.all(records.map((record) => this.deserializeSession(record)));
        } catch (error) {
            await this.clear();

            if (error instanceof SessionError) {
                throw error;
            }
            throw new SessionError(
                'Failed to load sessions',
                SessionErrorCode.STORAGE_ERROR,
                error
            );
        }
    }

    async remove(keyHash: string): Promise<void> {
        try {
            localStorage.removeItem(this.getSessionStorageKey(keyHash));

            const legacyValue = localStorage.getItem(this.legacyStorageKey);
            if (legacyValue) {
                const legacyRecord = JSON.parse(legacyValue) as StoredSessionRecord;
                if (legacyRecord.keyHash === keyHash) {
                    localStorage.removeItem(this.legacyStorageKey);
                }
            }
        } catch (error) {
            throw new SessionError(
                'Failed to remove session',
                SessionErrorCode.STORAGE_ERROR,
                error
            );
        }
    }
    
    /**
     * Clear all sessions
     */
    async clear(): Promise<void> {
        try {
            const keysToRemove: string[] = [];
            const prefix = this.getSessionStoragePrefix();

            for (let index = 0; index < localStorage.length; index++) {
                const key = localStorage.key(index);
                if (key && key.startsWith(prefix)) {
                    keysToRemove.push(key);
                }
            }

            keysToRemove.forEach((key) => localStorage.removeItem(key));
            localStorage.removeItem(this.legacyStorageKey);
        } catch (error) {
            throw new SessionError(
                'Failed to clear sessions',
                SessionErrorCode.STORAGE_ERROR,
                error
            );
        }
    }
    
    /**
     * Check if any session exists
     */
    async exists(keyHash?: string): Promise<boolean> {
        try {
            return (await this.load(keyHash)) !== null;
        } catch {
            return false;
        }
    }
}

// ============================================================================
// Storage Factory
// ============================================================================

/**
 * Create appropriate session storage based on environment
 * 
 * @param credentialId User's Passkey credential ID
 * @param preferredBackend Preferred storage backend ('indexeddb' or 'localstorage')
 * @returns Session storage implementation
 */
export function createSessionStorage(
    credentialId: string,
    preferredBackend?: 'indexeddb' | 'localstorage'
): SessionStorage {
    // Check if running in browser
    if (typeof window === 'undefined') {
        throw new SessionError(
            'Session storage requires browser environment',
            SessionErrorCode.STORAGE_ERROR
        );
    }
    
    // Try IndexedDB first (if not explicitly requesting localStorage)
    if (preferredBackend !== 'localstorage' && typeof indexedDB !== 'undefined') {
        try {
            return new IndexedDBSessionStorage(credentialId);
        } catch (error) {
            console.warn('IndexedDB unavailable, falling back to LocalStorage:', error);
        }
    }
    
    // Fallback to LocalStorage
    if (typeof localStorage !== 'undefined') {
        console.warn(
            '[Veridex SDK] Security advisory: IndexedDB is unavailable; falling back to LocalStorage for session storage. ' +
            'Both backends encrypt session keys with AES-GCM, but IndexedDB is recommended for production use.',
        );
        return new LocalStorageSessionStorage(credentialId);
    }
    
    throw new SessionError(
        'No storage backend available (requires IndexedDB or LocalStorage)',
        SessionErrorCode.STORAGE_ERROR
    );
}
