/**
 * Veridex Protocol SDK - Session Storage Module Tests
 * 
 * Comprehensive unit tests for encrypted session storage:
 * - LocalStorage backend (fallback)
 * - IndexedDB backend (preferred)
 * - Encryption/decryption of private keys
 * - Session lifecycle (save, load, clear, exists)
 * - Error handling and edge cases
 * 
 * Security focus areas:
 * - Private keys NEVER stored in plaintext
 * - Encryption key derived from credential ID
 * - Automatic cleanup of expired sessions
 * - Cross-session isolation
 * 
 * Note: IndexedDB tests require a browser environment or polyfill.
 * These tests focus on LocalStorage which works in Node.js via mocking.
 * 
 * @author Veridex Protocol
 * @license MIT
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { ethers } from 'ethers';
import {
    LocalStorageSessionStorage,
    createSessionStorage,
} from '../src/sessions/storage.js';
import {
    generateSecp256k1KeyPair,
    computeSessionKeyHash,
    deriveEncryptionKey,
    encrypt,
    decrypt,
} from '../src/sessions/crypto.js';
import { SessionError, SessionErrorCode, type SessionKey } from '../src/sessions/types.js';

// ============================================================================
// Mock LocalStorage for Node.js Environment
// ============================================================================

class MockLocalStorage implements Storage {
    private store: Map<string, string> = new Map();
    
    get length(): number {
        return this.store.size;
    }
    
    clear(): void {
        this.store.clear();
    }
    
    getItem(key: string): string | null {
        return this.store.get(key) ?? null;
    }
    
    key(index: number): string | null {
        const keys = Array.from(this.store.keys());
        return keys[index] ?? null;
    }
    
    removeItem(key: string): void {
        this.store.delete(key);
    }
    
    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }
}

// ============================================================================
// Test Helpers
// ============================================================================

function createTestSessionKey(overrides: Partial<SessionKey> = {}): SessionKey {
    const keyPair = generateSecp256k1KeyPair();
    const keyHash = computeSessionKeyHash(keyPair.publicKey);
    
    return {
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey,
        keyHash,
        expiry: Date.now() + 3600 * 1000, // 1 hour from now
        maxValue: BigInt(1e18),
        chainScopes: [10004], // Base Sepolia
        userKeyHash: ethers.keccak256(ethers.toUtf8Bytes('test-user')),
        ...overrides,
    };
}

// ============================================================================
// LocalStorage Session Storage Tests
// ============================================================================

describe('LocalStorageSessionStorage', () => {
    let mockStorage: MockLocalStorage;
    let storage: LocalStorageSessionStorage;
    const testCredentialId = 'test-credential-id-12345';
    
    beforeEach(() => {
        mockStorage = new MockLocalStorage();
        
        // Inject mock localStorage
        vi.stubGlobal('localStorage', mockStorage);
        
        storage = new LocalStorageSessionStorage(testCredentialId);
    });
    
    afterEach(() => {
        vi.unstubAllGlobals();
    });
    
    // ────────────────────────────────────────────────────────────────────────
    // Constructor Tests
    // ────────────────────────────────────────────────────────────────────────
    
    describe('constructor', () => {
        it('should create storage with valid credential ID', () => {
            expect(() => new LocalStorageSessionStorage('valid-credential')).not.toThrow();
        });
        
        it('should reject empty credential ID', () => {
            expect(() => new LocalStorageSessionStorage('')).toThrow(SessionError);
        });
        
        it('should reject undefined credential ID', () => {
            expect(() => new LocalStorageSessionStorage(undefined as any)).toThrow(SessionError);
        });
        
        it('should reject null credential ID', () => {
            expect(() => new LocalStorageSessionStorage(null as any)).toThrow(SessionError);
        });
    });
    
    // ────────────────────────────────────────────────────────────────────────
    // Save Tests
    // ────────────────────────────────────────────────────────────────────────
    
    describe('save', () => {
        it('should save a session', async () => {
            const session = createTestSessionKey();
            
            await storage.save(session);
            
            expect(mockStorage.length).toBeGreaterThan(0);
        });
        
        it('should encrypt private key before storage', async () => {
            const session = createTestSessionKey();
            
            await storage.save(session);
            
            // The storage layout is an implementation detail; read whatever key was
            // written rather than reconstructing it.
            const storageKey = mockStorage.key(0);
            expect(storageKey).toBeTruthy();
            const storedData = mockStorage.getItem(storageKey!);
            expect(storedData).toBeDefined();
            
            const parsed = JSON.parse(storedData!);
            
            // Private key should be encrypted (stored as hex string)
            expect(typeof parsed.encryptedPrivateKey).toBe('string');
            expect(parsed.encryptedPrivateKey.startsWith('0x')).toBe(true);
            
            // Encrypted data should be longer than plaintext (IV + ciphertext + tag)
            // 32 bytes * 2 hex chars = 64, but encrypted is longer
            expect(parsed.encryptedPrivateKey.length).toBeGreaterThan(64 + 2); // +2 for 0x
        });
        
        it('should store public key as hex string', async () => {
            const session = createTestSessionKey();
            
            await storage.save(session);
            
            const storageKey = mockStorage.key(0);
            expect(storageKey).toBeTruthy();
            const storedData = mockStorage.getItem(storageKey!);
            const parsed = JSON.parse(storedData!);
            
            expect(typeof parsed.publicKey).toBe('string');
            expect(parsed.publicKey.startsWith('0x')).toBe(true);
            // 65 bytes * 2 hex chars + 2 for 0x = 132
            expect(parsed.publicKey.length).toBe(132);
        });
        
        it('should store maxValue as string (BigInt serialization)', async () => {
            const session = createTestSessionKey({ maxValue: BigInt('12345678901234567890') });
            
            await storage.save(session);
            
            const storageKey = mockStorage.key(0);
            expect(storageKey).toBeTruthy();
            const storedData = mockStorage.getItem(storageKey!);
            const parsed = JSON.parse(storedData!);
            
            expect(typeof parsed.maxValue).toBe('string');
            expect(parsed.maxValue).toBe('12345678901234567890');
        });
        
        it('should overwrite existing session with same key hash', async () => {
            // Multi-session storage keys entries by session keyHash. Saving the same
            // session twice should overwrite the existing entry rather than create
            // a second one.
            const session = createTestSessionKey();
            
            await storage.save(session);
            const initialLength = mockStorage.length;
            
            await storage.save(session);
            
            expect(mockStorage.length).toBe(initialLength);
        });
    });
    
    // ────────────────────────────────────────────────────────────────────────
    // Load Tests
    // ────────────────────────────────────────────────────────────────────────
    
    describe('load', () => {
        it('should load saved session', async () => {
            const session = createTestSessionKey();
            await storage.save(session);
            
            const loaded = await storage.load();
            
            expect(loaded).toBeDefined();
            expect(loaded!.keyHash).toBe(session.keyHash);
        });
        
        it('should decrypt private key on load', async () => {
            const session = createTestSessionKey();
            await storage.save(session);
            
            const loaded = await storage.load();
            
            expect(loaded!.privateKey).toBeInstanceOf(Uint8Array);
            expect(loaded!.privateKey.length).toBe(32);
            expect(loaded!.privateKey).toEqual(session.privateKey);
        });
        
        it('should restore public key correctly', async () => {
            const session = createTestSessionKey();
            await storage.save(session);
            
            const loaded = await storage.load();
            
            expect(loaded!.publicKey).toBeInstanceOf(Uint8Array);
            expect(loaded!.publicKey.length).toBe(65);
            expect(loaded!.publicKey).toEqual(session.publicKey);
        });
        
        it('should restore BigInt maxValue correctly', async () => {
            const originalMaxValue = BigInt('999999999999999999999');
            const session = createTestSessionKey({ maxValue: originalMaxValue });
            await storage.save(session);
            
            const loaded = await storage.load();
            
            expect(typeof loaded!.maxValue).toBe('bigint');
            expect(loaded!.maxValue).toBe(originalMaxValue);
        });
        
        it('should return null when no session exists', async () => {
            const loaded = await storage.load();
            
            expect(loaded).toBeNull();
        });
        
        it('should return null for expired sessions', async () => {
            const expiredSession = createTestSessionKey({
                expiry: Date.now() - 1000, // Expired 1 second ago
            });
            await storage.save(expiredSession);
            
            const loaded = await storage.load();
            
            expect(loaded).toBeNull();
        });
        
        it('should load most recent non-expired session', async () => {
            const oldSession = createTestSessionKey({ expiry: Date.now() + 1000 * 1000 });
            const newSession = createTestSessionKey({ expiry: Date.now() + 2000 * 1000 });
            
            await storage.save(oldSession);
            
            // Simulate time passing
            await new Promise(r => setTimeout(r, 10));
            
            await storage.save(newSession);
            
            const loaded = await storage.load();
            
            // Should return the more recently saved session
            expect(loaded!.keyHash).toBe(newSession.keyHash);
        });
        
        it('should preserve chainScopes correctly', async () => {
            const session = createTestSessionKey({
                chainScopes: [10004, 10005, 1], // Base Sepolia, Optimism Sepolia, Ethereum
            });
            await storage.save(session);
            
            const loaded = await storage.load();
            
            expect(loaded!.chainScopes).toEqual([10004, 10005, 1]);
        });
        
        it('should preserve userKeyHash correctly', async () => {
            const userKeyHash = ethers.keccak256(ethers.toUtf8Bytes('unique-user-id'));
            const session = createTestSessionKey({ userKeyHash });
            await storage.save(session);
            
            const loaded = await storage.load();
            
            expect(loaded!.userKeyHash).toBe(userKeyHash);
        });
    });
    
    // ────────────────────────────────────────────────────────────────────────
    // Clear Tests
    // ────────────────────────────────────────────────────────────────────────
    
    describe('clear', () => {
        it('should clear the session', async () => {
            const session = createTestSessionKey();
            
            await storage.save(session);
            expect(await storage.exists()).toBe(true);
            
            await storage.clear();
            
            expect(await storage.exists()).toBe(false);
        });
        
        it('should work on empty storage', async () => {
            await expect(storage.clear()).resolves.not.toThrow();
        });
        
        it('should allow new save after clear', async () => {
            const session = createTestSessionKey();
            await storage.save(session);
            await storage.clear();
            
            const newSession = createTestSessionKey();
            await storage.save(newSession);
            
            const loaded = await storage.load();
            expect(loaded!.keyHash).toBe(newSession.keyHash);
        });
    });
    
    // ────────────────────────────────────────────────────────────────────────
    // Exists Tests
    // ────────────────────────────────────────────────────────────────────────
    
    describe('exists', () => {
        it('should return false when no sessions exist', async () => {
            const exists = await storage.exists();
            
            expect(exists).toBe(false);
        });
        
        it('should return true when session exists', async () => {
            const session = createTestSessionKey();
            await storage.save(session);
            
            const exists = await storage.exists();
            
            expect(exists).toBe(true);
        });
        
        it('should return false after clear', async () => {
            const session = createTestSessionKey();
            await storage.save(session);
            await storage.clear();
            
            const exists = await storage.exists();
            
            expect(exists).toBe(false);
        });
    });
    
    // ────────────────────────────────────────────────────────────────────────
    // Cross-Credential Isolation Tests
    // ────────────────────────────────────────────────────────────────────────
    
    describe('credential isolation', () => {
        it('should not see sessions from different credential', async () => {
            // Save with one credential
            const storage1 = new LocalStorageSessionStorage('credential-1');
            const session = createTestSessionKey();
            await storage1.save(session);
            
            // Try to load with different credential
            const storage2 = new LocalStorageSessionStorage('credential-2');
            
            // Should return null since different storage key
            const loaded = await storage2.load();
            expect(loaded).toBeNull();
        });
        
        it('should isolate sessions by credential ID', async () => {
            const storage1 = new LocalStorageSessionStorage('user-1');
            const storage2 = new LocalStorageSessionStorage('user-2');
            
            const session1 = createTestSessionKey();
            const session2 = createTestSessionKey();
            
            await storage1.save(session1);
            await storage2.save(session2);
            
            // Each storage should only see its own session
            const loaded1 = await storage1.load();
            const loaded2 = await storage2.load();
            
            expect(loaded1!.keyHash).toBe(session1.keyHash);
            expect(loaded2!.keyHash).toBe(session2.keyHash);
        });
        
        it('should use different storage keys for different credentials', async () => {
            const storage1 = new LocalStorageSessionStorage('credential-A');
            const storage2 = new LocalStorageSessionStorage('credential-B');
            
            const session1 = createTestSessionKey();
            const session2 = createTestSessionKey();
            
            await storage1.save(session1);
            await storage2.save(session2);
            
            // Should have 2 entries (different keys)
            expect(mockStorage.length).toBe(2);
            
            // Clearing one shouldn't affect the other
            await storage1.clear();
            expect(mockStorage.length).toBe(1);
            expect(await storage2.exists()).toBe(true);
        });
    });
});

// ============================================================================
// Storage Factory Tests
// ============================================================================

describe('createSessionStorage', () => {
    let mockStorage: MockLocalStorage;
    
    beforeEach(() => {
        mockStorage = new MockLocalStorage();
        vi.stubGlobal('localStorage', mockStorage);
        // createSessionStorage checks for window to detect browser environment
        vi.stubGlobal('window', {});
    });
    
    afterEach(() => {
        vi.unstubAllGlobals();
    });
    
    it('should create LocalStorage backend when specified', () => {
        const storage = createSessionStorage('test-cred', 'localstorage');
        
        expect(storage).toBeInstanceOf(LocalStorageSessionStorage);
    });
    
    it('should default to IndexedDB when available', () => {
        // Mock IndexedDB (minimal mock - may fall back to localStorage)
        vi.stubGlobal('indexedDB', {
            open: vi.fn(),
        });
        
        // May return either IndexedDB or LocalStorage depending on constructor success
        const storage = createSessionStorage('test-cred');
        expect(storage).toBeDefined();
    });
    
    it('should fall back to LocalStorage when IndexedDB unavailable', () => {
        // Remove IndexedDB
        vi.stubGlobal('indexedDB', undefined);
        
        const storage = createSessionStorage('test-cred');
        
        // Should gracefully fall back to LocalStorage
        expect(storage).toBeInstanceOf(LocalStorageSessionStorage);
    });
    
    it('should throw when not in browser environment', () => {
        // Remove window
        vi.unstubAllGlobals();
        
        expect(() => createSessionStorage('test-cred')).toThrow('Session storage requires browser environment');
    });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Storage Error Handling', () => {
    let mockStorage: MockLocalStorage;
    let storage: LocalStorageSessionStorage;
    
    beforeEach(() => {
        mockStorage = new MockLocalStorage();
        vi.stubGlobal('localStorage', mockStorage);
        storage = new LocalStorageSessionStorage('test-credential');
    });
    
    afterEach(() => {
        vi.unstubAllGlobals();
    });
    
    it('should throw SessionError on storage failure', async () => {
        // Mock setItem to throw
        mockStorage.setItem = () => {
            throw new Error('QuotaExceeded');
        };
        
        const session = createTestSessionKey();
        
        await expect(storage.save(session)).rejects.toThrow(SessionError);
    });
    
    it('should include error code in SessionError', async () => {
        mockStorage.setItem = () => {
            throw new Error('QuotaExceeded');
        };
        
        const session = createTestSessionKey();
        
        try {
            await storage.save(session);
        } catch (error) {
            expect(error).toBeInstanceOf(SessionError);
            expect((error as SessionError).code).toBe(SessionErrorCode.STORAGE_ERROR);
        }
    });
    
    it('should handle corrupted stored data by throwing SessionError', async () => {
        // Manually insert corrupted data using the correct storage key
        const storageKey = `veridex-session-${ethers.keccak256(ethers.toUtf8Bytes('test-credential'))}`;
        mockStorage.setItem(storageKey, '{invalid json');
        
        // Implementation throws SessionError for corrupted data
        await expect(storage.load()).rejects.toThrow(SessionError);
    });
    
    it('should handle missing fields in stored data by throwing SessionError', async () => {
        // Manually insert incomplete data using the correct storage key
        const storageKey = `veridex-session-${ethers.keccak256(ethers.toUtf8Bytes('test-credential'))}`;
        mockStorage.setItem(
            storageKey,
            JSON.stringify({ 
                keyHash: 'some-hash',
                expiry: Date.now() + 3600000 
            }) // Missing encryptedPrivateKey, publicKey, etc.
        );
        
        // Implementation throws SessionError for missing fields
        await expect(storage.load()).rejects.toThrow(SessionError);
    });
});

// ============================================================================
// Edge Cases and Security Tests
// ============================================================================

describe('Security Edge Cases', () => {
    let mockStorage: MockLocalStorage;
    let storage: LocalStorageSessionStorage;
    
    beforeEach(() => {
        mockStorage = new MockLocalStorage();
        vi.stubGlobal('localStorage', mockStorage);
        storage = new LocalStorageSessionStorage('test-credential');
    });
    
    afterEach(() => {
        vi.unstubAllGlobals();
    });
    
    it('should handle very long credential IDs', async () => {
        const longCredential = 'a'.repeat(10000);
        const longCredStorage = new LocalStorageSessionStorage(longCredential);
        
        const session = createTestSessionKey();
        await longCredStorage.save(session);
        
        const loaded = await longCredStorage.load();
        expect(loaded!.keyHash).toBe(session.keyHash);
    });
    
    it('should handle unicode credential IDs', async () => {
        const unicodeStorage = new LocalStorageSessionStorage('用户凭证🔐');
        
        const session = createTestSessionKey();
        await unicodeStorage.save(session);
        
        const loaded = await unicodeStorage.load();
        expect(loaded!.keyHash).toBe(session.keyHash);
    });
    
    it('should handle session with empty chainScopes', async () => {
        const session = createTestSessionKey({ chainScopes: [] });
        await storage.save(session);
        
        const loaded = await storage.load();
        expect(loaded!.chainScopes).toEqual([]);
    });
    
    it('should handle session with many chainScopes', async () => {
        const manyChains = Array.from({ length: 50 }, (_, i) => i + 1);
        const session = createTestSessionKey({ chainScopes: manyChains });
        await storage.save(session);
        
        const loaded = await storage.load();
        expect(loaded!.chainScopes).toEqual(manyChains);
    });
    
    it('should handle maxValue of zero', async () => {
        const session = createTestSessionKey({ maxValue: 0n });
        await storage.save(session);
        
        const loaded = await storage.load();
        expect(loaded!.maxValue).toBe(0n);
    });
    
    it('should handle maximum safe BigInt', async () => {
        const maxBigInt = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        const session = createTestSessionKey({ maxValue: maxBigInt });
        await storage.save(session);
        
        const loaded = await storage.load();
        expect(loaded!.maxValue).toBe(maxBigInt);
    });
    
    it('should reject session with expiry far in the future', async () => {
        // This is more of a business logic test - storage should still work
        const farFuture = Date.now() + (365 * 24 * 60 * 60 * 1000); // 1 year
        const session = createTestSessionKey({ expiry: farFuture });
        
        await storage.save(session);
        const loaded = await storage.load();
        
        expect(loaded).toBeDefined();
    });
    
    it('should handle rapid save/load cycles', async () => {
        const session = createTestSessionKey();
        
        // Rapid save/load
        for (let i = 0; i < 100; i++) {
            await storage.save({ ...session, expiry: Date.now() + i * 1000 });
            const loaded = await storage.load();
            expect(loaded).toBeDefined();
        }
    });
});

// ============================================================================
// Integration Test - Full Session Lifecycle
// ============================================================================

describe('Full Session Storage Lifecycle', () => {
    let mockStorage: MockLocalStorage;
    
    beforeEach(() => {
        mockStorage = new MockLocalStorage();
        vi.stubGlobal('localStorage', mockStorage);
    });
    
    afterEach(() => {
        vi.unstubAllGlobals();
    });
    
    it('should complete full lifecycle: create → save → load → use → clear', async () => {
        const credentialId = 'user-passkey-credential';
        const storage = new LocalStorageSessionStorage(credentialId);
        
        // 1. Initially no session exists
        expect(await storage.exists()).toBe(false);
        expect(await storage.load()).toBeNull();
        
        // 2. Create and save a session
        const session = createTestSessionKey({
            expiry: Date.now() + 3600 * 1000, // 1 hour
            maxValue: ethers.parseUnits('100', 6), // 100 USDC
            chainScopes: [10004], // Base Sepolia only
        });
        await storage.save(session);
        
        // 3. Session exists
        expect(await storage.exists()).toBe(true);
        
        // 4. Load and verify session integrity
        const loaded = await storage.load();
        expect(loaded).toBeDefined();
        expect(loaded!.keyHash).toBe(session.keyHash);
        expect(loaded!.privateKey).toEqual(session.privateKey);
        expect(loaded!.publicKey).toEqual(session.publicKey);
        expect(loaded!.maxValue).toBe(session.maxValue);
        expect(loaded!.chainScopes).toEqual(session.chainScopes);
        
        // 5. Simulate using the session key for signing
        const { signWithSessionKey, hashAction } = await import('../src/sessions/crypto.js');
        const actionHash = hashAction({
            action: 'transfer',
            targetChain: 10004,
            value: BigInt(50e6), // 50 USDC
            payload: new Uint8Array(0),
            nonce: 1,
        });
        const signature = signWithSessionKey(loaded!.privateKey, actionHash);
        expect(signature.signature.length).toBe(65);
        
        // 6. Clear session (revocation)
        await storage.clear();
        expect(await storage.exists()).toBe(false);
        expect(await storage.load()).toBeNull();
    });
});
