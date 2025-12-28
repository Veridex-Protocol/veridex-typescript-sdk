/**
 * Veridex Protocol SDK - Session Crypto Module Tests
 * 
 * Comprehensive unit tests for cryptographic operations:
 * - secp256k1 key generation (65-byte uncompressed public key)
 * - Session key hash computation (keccak256)
 * - ECDSA signing with session keys
 * - Signature verification (recovery)
 * - Action hashing (EIP-712-like deterministic)
 * - AES-GCM encryption/decryption
 * - Key derivation (PBKDF2)
 * - Session configuration validation
 * 
 * Security focus areas:
 * - Key format correctness (uncompressed vs compressed)
 * - Signature malleability prevention
 * - Deterministic hashing
 * - Encryption boundary conditions
 * 
 * @author Veridex Protocol
 * @license MIT
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ethers } from 'ethers';
import {
    generateSecp256k1KeyPair,
    computeSessionKeyHash,
    signWithSessionKey,
    verifySessionSignature,
    hashAction,
    deriveEncryptionKey,
    encrypt,
    decrypt,
    generateIv,
    validateSessionConfig,
    MAX_SESSION_DURATION,
    MIN_SESSION_DURATION,
    DEFAULT_SESSION_DURATION,
    DEFAULT_REFRESH_BUFFER,
    type KeyPair,
} from '../src/sessions/crypto.js';
import { SessionError, SessionErrorCode } from '../src/sessions/types.js';

// ============================================================================
// Key Generation Tests
// ============================================================================

describe('generateSecp256k1KeyPair', () => {
    it('should generate a valid key pair', () => {
        const keyPair = generateSecp256k1KeyPair();
        
        expect(keyPair).toBeDefined();
        expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
        expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
        expect(keyPair.address).toBeDefined();
    });
    
    it('should generate 65-byte uncompressed public key (0x04 prefix)', () => {
        const keyPair = generateSecp256k1KeyPair();
        
        // CRITICAL: Must be uncompressed (65 bytes) for on-chain verification
        expect(keyPair.publicKey.length).toBe(65);
        expect(keyPair.publicKey[0]).toBe(0x04); // Uncompressed marker
    });
    
    it('should generate 32-byte private key', () => {
        const keyPair = generateSecp256k1KeyPair();
        
        expect(keyPair.privateKey.length).toBe(32);
    });
    
    it('should generate valid Ethereum address', () => {
        const keyPair = generateSecp256k1KeyPair();
        
        expect(ethers.isAddress(keyPair.address)).toBe(true);
        expect(keyPair.address.startsWith('0x')).toBe(true);
        expect(keyPair.address.length).toBe(42);
    });
    
    it('should generate unique keys each time', () => {
        const keyPair1 = generateSecp256k1KeyPair();
        const keyPair2 = generateSecp256k1KeyPair();
        
        expect(keyPair1.privateKey).not.toEqual(keyPair2.privateKey);
        expect(keyPair1.publicKey).not.toEqual(keyPair2.publicKey);
        expect(keyPair1.address).not.toBe(keyPair2.address);
    });
    
    it('should generate cryptographically strong random keys', () => {
        // Generate 100 keys and check entropy (no duplicates)
        const keys = new Set<string>();
        for (let i = 0; i < 100; i++) {
            const keyPair = generateSecp256k1KeyPair();
            const keyHex = ethers.hexlify(keyPair.privateKey);
            expect(keys.has(keyHex)).toBe(false);
            keys.add(keyHex);
        }
    });
    
    it('should derive consistent address from public key', () => {
        const keyPair = generateSecp256k1KeyPair();
        
        // Verify address derivation matches ethers
        // ethers.computeAddress expects hex string for public key
        const derivedAddress = ethers.computeAddress(ethers.hexlify(keyPair.publicKey));
        expect(keyPair.address.toLowerCase()).toBe(derivedAddress.toLowerCase());
    });
});

// ============================================================================
// Session Key Hash Tests
// ============================================================================

describe('computeSessionKeyHash', () => {
    let keyPair: KeyPair;
    
    beforeEach(() => {
        keyPair = generateSecp256k1KeyPair();
    });
    
    it('should compute keccak256 hash of public key', () => {
        const hash = computeSessionKeyHash(keyPair.publicKey);
        
        expect(hash).toBeDefined();
        expect(hash.startsWith('0x')).toBe(true);
        expect(hash.length).toBe(66); // 0x + 64 hex chars
    });
    
    it('should produce deterministic hash for same key', () => {
        const hash1 = computeSessionKeyHash(keyPair.publicKey);
        const hash2 = computeSessionKeyHash(keyPair.publicKey);
        
        expect(hash1).toBe(hash2);
    });
    
    it('should produce different hash for different keys', () => {
        const keyPair2 = generateSecp256k1KeyPair();
        
        const hash1 = computeSessionKeyHash(keyPair.publicKey);
        const hash2 = computeSessionKeyHash(keyPair2.publicKey);
        
        expect(hash1).not.toBe(hash2);
    });
    
    it('should reject compressed public keys (33 bytes)', () => {
        // Create a fake 33-byte compressed key
        const compressedKey = new Uint8Array(33);
        compressedKey[0] = 0x02; // Compressed even y
        
        expect(() => computeSessionKeyHash(compressedKey)).toThrow(SessionError);
    });
    
    it('should reject invalid public key length', () => {
        const invalidKey = new Uint8Array(64); // Missing prefix byte
        
        expect(() => computeSessionKeyHash(invalidKey)).toThrow(SessionError);
    });
    
    it('should reject public key without 0x04 prefix', () => {
        const wrongPrefix = new Uint8Array(65);
        wrongPrefix[0] = 0x03; // Compressed odd y (invalid for uncompressed)
        
        expect(() => computeSessionKeyHash(wrongPrefix)).toThrow(SessionError);
    });
    
    it('should match on-chain keccak256 computation', () => {
        // This test ensures SDK hash matches Solidity keccak256(publicKey)
        const hash = computeSessionKeyHash(keyPair.publicKey);
        const expectedHash = ethers.keccak256(keyPair.publicKey);
        
        expect(hash).toBe(expectedHash);
    });
});

// ============================================================================
// Signing Tests
// ============================================================================

describe('signWithSessionKey', () => {
    let keyPair: KeyPair;
    let messageHash: Uint8Array;
    
    beforeEach(() => {
        keyPair = generateSecp256k1KeyPair();
        // Generate a random 32-byte message hash
        messageHash = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes('test message')));
    });
    
    it('should sign a message hash', () => {
        const sig = signWithSessionKey(keyPair.privateKey, messageHash);
        
        expect(sig).toBeDefined();
        expect(sig.r).toBeDefined();
        expect(sig.s).toBeDefined();
        expect(sig.v).toBeDefined();
        expect(sig.signature).toBeInstanceOf(Uint8Array);
    });
    
    it('should produce 65-byte signature (r + s + v)', () => {
        const sig = signWithSessionKey(keyPair.privateKey, messageHash);
        
        expect(sig.signature.length).toBe(65);
    });
    
    it('should produce valid r value (32 bytes, 0x prefix)', () => {
        const sig = signWithSessionKey(keyPair.privateKey, messageHash);
        
        expect(sig.r.startsWith('0x')).toBe(true);
        expect(sig.r.length).toBe(66); // 0x + 64 hex
    });
    
    it('should produce valid s value (32 bytes, 0x prefix)', () => {
        const sig = signWithSessionKey(keyPair.privateKey, messageHash);
        
        expect(sig.s.startsWith('0x')).toBe(true);
        expect(sig.s.length).toBe(66); // 0x + 64 hex
    });
    
    it('should produce valid v value (27 or 28)', () => {
        const sig = signWithSessionKey(keyPair.privateKey, messageHash);
        
        expect(sig.v).toBeGreaterThanOrEqual(27);
        expect(sig.v).toBeLessThanOrEqual(28);
    });
    
    it('should accept hex string message hash', () => {
        const hashHex = ethers.keccak256(ethers.toUtf8Bytes('test'));
        
        const sig = signWithSessionKey(keyPair.privateKey, hashHex);
        
        expect(sig.signature.length).toBe(65);
    });
    
    it('should produce deterministic signatures for same inputs', () => {
        const sig1 = signWithSessionKey(keyPair.privateKey, messageHash);
        const sig2 = signWithSessionKey(keyPair.privateKey, messageHash);
        
        // Note: ethers uses RFC 6979 deterministic k, so same inputs = same sig
        expect(sig1.r).toBe(sig2.r);
        expect(sig1.s).toBe(sig2.s);
    });
    
    it('should reject invalid private key length', () => {
        const shortKey = new Uint8Array(31);
        
        expect(() => signWithSessionKey(shortKey, messageHash)).toThrow(SessionError);
    });
    
    it('should reject invalid message hash length', () => {
        const shortHash = new Uint8Array(31);
        
        expect(() => signWithSessionKey(keyPair.privateKey, shortHash)).toThrow(SessionError);
    });
    
    it('should reject empty private key', () => {
        const emptyKey = new Uint8Array(0);
        
        expect(() => signWithSessionKey(emptyKey, messageHash)).toThrow(SessionError);
    });
});

// ============================================================================
// Signature Verification Tests
// ============================================================================

describe('verifySessionSignature', () => {
    let keyPair: KeyPair;
    let messageHash: Uint8Array;
    
    beforeEach(() => {
        keyPair = generateSecp256k1KeyPair();
        messageHash = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes('verify test')));
    });
    
    it('should verify valid signature', () => {
        const sig = signWithSessionKey(keyPair.privateKey, messageHash);
        
        const isValid = verifySessionSignature(messageHash, sig.signature, keyPair.publicKey);
        
        expect(isValid).toBe(true);
    });
    
    it('should accept hex string message hash', () => {
        const hashHex = ethers.hexlify(messageHash);
        const sig = signWithSessionKey(keyPair.privateKey, messageHash);
        
        const isValid = verifySessionSignature(hashHex, sig.signature, keyPair.publicKey);
        
        expect(isValid).toBe(true);
    });
    
    it('should reject signature from different key', () => {
        const otherKeyPair = generateSecp256k1KeyPair();
        const sig = signWithSessionKey(otherKeyPair.privateKey, messageHash);
        
        const isValid = verifySessionSignature(messageHash, sig.signature, keyPair.publicKey);
        
        expect(isValid).toBe(false);
    });
    
    it('should reject signature for different message', () => {
        const sig = signWithSessionKey(keyPair.privateKey, messageHash);
        const differentHash = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes('different')));
        
        const isValid = verifySessionSignature(differentHash, sig.signature, keyPair.publicKey);
        
        expect(isValid).toBe(false);
    });
    
    it('should reject truncated signature', () => {
        const sig = signWithSessionKey(keyPair.privateKey, messageHash);
        const truncated = sig.signature.slice(0, 64); // Missing v byte
        
        const isValid = verifySessionSignature(messageHash, truncated, keyPair.publicKey);
        
        expect(isValid).toBe(false);
    });
    
    it('should reject corrupted signature', () => {
        const sig = signWithSessionKey(keyPair.privateKey, messageHash);
        const corrupted = new Uint8Array(sig.signature);
        corrupted[0] ^= 0xFF; // Flip bits in r
        
        const isValid = verifySessionSignature(messageHash, corrupted, keyPair.publicKey);
        
        expect(isValid).toBe(false);
    });
    
    it('should reject empty signature', () => {
        const isValid = verifySessionSignature(messageHash, new Uint8Array(0), keyPair.publicKey);
        
        expect(isValid).toBe(false);
    });
    
    it('should handle malformed inputs gracefully (no throw)', () => {
        // Should return false, not throw
        expect(() => verifySessionSignature(
            new Uint8Array(0),
            new Uint8Array(65),
            keyPair.publicKey
        )).not.toThrow();
    });
});

// ============================================================================
// Action Hashing Tests
// ============================================================================

describe('hashAction', () => {
    it('should hash action parameters deterministically', () => {
        const params = {
            action: 'transfer',
            targetChain: 10004, // Base Sepolia
            value: BigInt(1e18),
            payload: ethers.toUtf8Bytes('test payload'),
            nonce: 1,
            deadline: 1735689600,
        };
        
        const hash1 = hashAction(params);
        const hash2 = hashAction(params);
        
        expect(hash1).toEqual(hash2);
    });
    
    it('should produce 32-byte hash', () => {
        const hash = hashAction({
            action: 'transfer',
            targetChain: 1,
            value: 0n,
            payload: new Uint8Array(0),
            nonce: 0,
        });
        
        expect(hash.length).toBe(32);
    });
    
    it('should produce different hash for different actions', () => {
        const base = {
            action: 'transfer',
            targetChain: 1,
            value: 100n,
            payload: new Uint8Array([1, 2, 3]),
            nonce: 1,
        };
        
        const hash1 = hashAction(base);
        const hash2 = hashAction({ ...base, action: 'execute' });
        
        expect(hash1).not.toEqual(hash2);
    });
    
    it('should produce different hash for different chains', () => {
        const base = {
            action: 'transfer',
            targetChain: 1,
            value: 100n,
            payload: new Uint8Array([1, 2, 3]),
            nonce: 1,
        };
        
        const hash1 = hashAction(base);
        const hash2 = hashAction({ ...base, targetChain: 2 });
        
        expect(hash1).not.toEqual(hash2);
    });
    
    it('should produce different hash for different values', () => {
        const base = {
            action: 'transfer',
            targetChain: 1,
            value: 100n,
            payload: new Uint8Array([1, 2, 3]),
            nonce: 1,
        };
        
        const hash1 = hashAction(base);
        const hash2 = hashAction({ ...base, value: 200n });
        
        expect(hash1).not.toEqual(hash2);
    });
    
    it('should produce different hash for different payloads', () => {
        const base = {
            action: 'transfer',
            targetChain: 1,
            value: 100n,
            payload: new Uint8Array([1, 2, 3]),
            nonce: 1,
        };
        
        const hash1 = hashAction(base);
        const hash2 = hashAction({ ...base, payload: new Uint8Array([4, 5, 6]) });
        
        expect(hash1).not.toEqual(hash2);
    });
    
    it('should produce different hash for different nonces', () => {
        const base = {
            action: 'transfer',
            targetChain: 1,
            value: 100n,
            payload: new Uint8Array([1, 2, 3]),
            nonce: 1,
        };
        
        const hash1 = hashAction(base);
        const hash2 = hashAction({ ...base, nonce: 2 });
        
        expect(hash1).not.toEqual(hash2);
    });
    
    it('should handle deadline = 0 as default', () => {
        const withDeadline = hashAction({
            action: 'transfer',
            targetChain: 1,
            value: 100n,
            payload: new Uint8Array(0),
            nonce: 1,
            deadline: 0,
        });
        
        const withoutDeadline = hashAction({
            action: 'transfer',
            targetChain: 1,
            value: 100n,
            payload: new Uint8Array(0),
            nonce: 1,
        });
        
        expect(withDeadline).toEqual(withoutDeadline);
    });
    
    it('should handle large payloads', () => {
        const largePayload = new Uint8Array(10000);
        crypto.getRandomValues(largePayload);
        
        const hash = hashAction({
            action: 'execute',
            targetChain: 1,
            value: 0n,
            payload: largePayload,
            nonce: 1,
        });
        
        expect(hash.length).toBe(32);
    });
    
    it('should handle maximum bigint values', () => {
        const hash = hashAction({
            action: 'transfer',
            targetChain: 1,
            value: BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
            payload: new Uint8Array(0),
            nonce: 1,
        });
        
        expect(hash.length).toBe(32);
    });
});

// ============================================================================
// Encryption Key Derivation Tests
// ============================================================================

describe('deriveEncryptionKey', () => {
    it('should derive a CryptoKey from credential ID', async () => {
        const key = await deriveEncryptionKey('test-credential-id');
        
        expect(key).toBeDefined();
        expect(key.type).toBe('secret');
        expect(key.algorithm.name).toBe('AES-GCM');
    });
    
    it('should derive deterministic key for same credential', async () => {
        const key1 = await deriveEncryptionKey('same-credential');
        const key2 = await deriveEncryptionKey('same-credential');
        
        // Can't compare CryptoKey directly, but we can verify encrypt/decrypt works
        const testData = new Uint8Array([1, 2, 3, 4, 5]);
        const encrypted = await encrypt(testData, key1);
        const decrypted = await decrypt(encrypted, key2);
        
        expect(decrypted).toEqual(testData);
    });
    
    it('should derive different keys for different credentials', async () => {
        const key1 = await deriveEncryptionKey('credential-1');
        const key2 = await deriveEncryptionKey('credential-2');
        
        const testData = new Uint8Array([1, 2, 3, 4, 5]);
        const encrypted = await encrypt(testData, key1);
        
        // Decryption with different key should fail
        await expect(decrypt(encrypted, key2)).rejects.toThrow();
    });
    
    it('should handle empty credential ID by creating a valid key', async () => {
        // Implementation accepts empty string (edge case but valid)
        const key = await deriveEncryptionKey('');
        expect(key).toBeDefined();
        expect(key.type).toBe('secret');
    });
    
    it('should handle unicode credential IDs', async () => {
        const key = await deriveEncryptionKey('测试凭证🔐');
        
        expect(key).toBeDefined();
        expect(key.type).toBe('secret');
    });
    
    it('should produce 256-bit AES key', async () => {
        const key = await deriveEncryptionKey('test');
        
        // AES-GCM with 256-bit key
        expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
    });
});

// ============================================================================
// IV Generation Tests
// ============================================================================

describe('generateIv', () => {
    it('should generate 12-byte IV', () => {
        const iv = generateIv();
        
        expect(iv).toBeInstanceOf(Uint8Array);
        expect(iv.length).toBe(12);
    });
    
    it('should generate unique IVs', () => {
        const ivs = new Set<string>();
        for (let i = 0; i < 100; i++) {
            const iv = generateIv();
            const ivHex = ethers.hexlify(iv);
            expect(ivs.has(ivHex)).toBe(false);
            ivs.add(ivHex);
        }
    });
});

// ============================================================================
// Encryption/Decryption Tests
// ============================================================================

describe('encrypt and decrypt', () => {
    let encryptionKey: CryptoKey;
    
    beforeEach(async () => {
        encryptionKey = await deriveEncryptionKey('test-encryption-key');
    });
    
    it('should encrypt and decrypt data', async () => {
        const originalData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        
        const encrypted = await encrypt(originalData, encryptionKey);
        const decrypted = await decrypt(encrypted, encryptionKey);
        
        expect(decrypted).toEqual(originalData);
    });
    
    it('should prepend IV to encrypted data', async () => {
        const data = new Uint8Array([1, 2, 3]);
        
        const encrypted = await encrypt(data, encryptionKey);
        
        // Encrypted = 12-byte IV + ciphertext + 16-byte GCM tag
        expect(encrypted.length).toBeGreaterThanOrEqual(12 + 3 + 16);
    });
    
    it('should produce different ciphertext each time (random IV)', async () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        
        const encrypted1 = await encrypt(data, encryptionKey);
        const encrypted2 = await encrypt(data, encryptionKey);
        
        // IVs (first 12 bytes) should differ
        expect(encrypted1.slice(0, 12)).not.toEqual(encrypted2.slice(0, 12));
    });
    
    it('should reject tampered ciphertext', async () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const encrypted = await encrypt(data, encryptionKey);
        
        // Tamper with ciphertext (after IV)
        const tampered = new Uint8Array(encrypted);
        tampered[15] ^= 0xFF;
        
        await expect(decrypt(tampered, encryptionKey)).rejects.toThrow();
    });
    
    it('should reject truncated data', async () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const encrypted = await encrypt(data, encryptionKey);
        
        const truncated = encrypted.slice(0, 11); // Less than IV length
        
        await expect(decrypt(truncated, encryptionKey)).rejects.toThrow();
    });
    
    it('should handle empty data', async () => {
        const emptyData = new Uint8Array(0);
        
        const encrypted = await encrypt(emptyData, encryptionKey);
        const decrypted = await decrypt(encrypted, encryptionKey);
        
        expect(decrypted.length).toBe(0);
    });
    
    it('should handle large data (1MB)', async () => {
        const largeData = new Uint8Array(1024 * 1024);
        // crypto.getRandomValues has 65536 byte limit, fill in chunks
        for (let i = 0; i < largeData.length; i += 65536) {
            const chunk = new Uint8Array(Math.min(65536, largeData.length - i));
            crypto.getRandomValues(chunk);
            largeData.set(chunk, i);
        }
        
        const encrypted = await encrypt(largeData, encryptionKey);
        const decrypted = await decrypt(encrypted, encryptionKey);
        
        expect(decrypted).toEqual(largeData);
    });
    
    it('should preserve 32-byte private key exactly', async () => {
        // This is the critical use case - session private keys
        const privateKey = generateSecp256k1KeyPair().privateKey;
        
        const encrypted = await encrypt(privateKey, encryptionKey);
        const decrypted = await decrypt(encrypted, encryptionKey);
        
        expect(decrypted.length).toBe(32);
        expect(decrypted).toEqual(privateKey);
    });
});

// ============================================================================
// Session Configuration Validation Tests
// ============================================================================

describe('validateSessionConfig', () => {
    it('should accept valid configuration', () => {
        expect(() => validateSessionConfig({
            duration: 3600,
            maxValue: BigInt(1e18),
        })).not.toThrow();
    });
    
    it('should accept minimum duration', () => {
        expect(() => validateSessionConfig({
            duration: MIN_SESSION_DURATION,
            maxValue: 0n,
        })).not.toThrow();
    });
    
    it('should accept maximum duration', () => {
        expect(() => validateSessionConfig({
            duration: MAX_SESSION_DURATION,
            maxValue: 0n,
        })).not.toThrow();
    });
    
    it('should reject duration below minimum', () => {
        expect(() => validateSessionConfig({
            duration: MIN_SESSION_DURATION - 1,
            maxValue: 0n,
        })).toThrow(SessionError);
    });
    
    it('should reject duration above maximum', () => {
        expect(() => validateSessionConfig({
            duration: MAX_SESSION_DURATION + 1,
            maxValue: 0n,
        })).toThrow(SessionError);
    });
    
    it('should reject negative maxValue', () => {
        expect(() => validateSessionConfig({
            duration: 3600,
            maxValue: -1n,
        })).toThrow(SessionError);
    });
    
    it('should accept zero maxValue (unlimited)', () => {
        expect(() => validateSessionConfig({
            duration: 3600,
            maxValue: 0n,
        })).not.toThrow();
    });
    
    it('should accept large maxValue', () => {
        expect(() => validateSessionConfig({
            duration: 3600,
            maxValue: BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
        })).not.toThrow();
    });
});

// ============================================================================
// Constants Tests
// ============================================================================

describe('Session Constants', () => {
    it('should have correct MAX_SESSION_DURATION (24 hours)', () => {
        expect(MAX_SESSION_DURATION).toBe(86400);
    });
    
    it('should have correct MIN_SESSION_DURATION (60 seconds)', () => {
        expect(MIN_SESSION_DURATION).toBe(60);
    });
    
    it('should have correct DEFAULT_SESSION_DURATION (1 hour)', () => {
        expect(DEFAULT_SESSION_DURATION).toBe(3600);
    });
    
    it('should have correct DEFAULT_REFRESH_BUFFER (5 minutes)', () => {
        expect(DEFAULT_REFRESH_BUFFER).toBe(300);
    });
    
    it('should enforce DEFAULT within MIN/MAX range', () => {
        expect(DEFAULT_SESSION_DURATION).toBeGreaterThanOrEqual(MIN_SESSION_DURATION);
        expect(DEFAULT_SESSION_DURATION).toBeLessThanOrEqual(MAX_SESSION_DURATION);
    });
});

// ============================================================================
// Integration Tests - Full Signing Flow
// ============================================================================

describe('Full Session Signing Flow', () => {
    it('should complete generate → hash → sign → verify flow', () => {
        // 1. Generate session key pair
        const keyPair = generateSecp256k1KeyPair();
        expect(keyPair.publicKey.length).toBe(65);
        
        // 2. Compute session key hash (on-chain identifier)
        const keyHash = computeSessionKeyHash(keyPair.publicKey);
        expect(keyHash.length).toBe(66);
        
        // 3. Hash an action
        const actionHash = hashAction({
            action: 'transfer',
            targetChain: 10004,
            value: BigInt(1e18),
            payload: ethers.toUtf8Bytes('test'),
            nonce: 1,
            deadline: Math.floor(Date.now() / 1000) + 3600,
        });
        expect(actionHash.length).toBe(32);
        
        // 4. Sign with session key
        const signature = signWithSessionKey(keyPair.privateKey, actionHash);
        expect(signature.signature.length).toBe(65);
        
        // 5. Verify signature
        const isValid = verifySessionSignature(
            actionHash,
            signature.signature,
            keyPair.publicKey
        );
        expect(isValid).toBe(true);
    });
    
    it('should fail verification with wrong public key', () => {
        const keyPair = generateSecp256k1KeyPair();
        const wrongKeyPair = generateSecp256k1KeyPair();
        
        const actionHash = hashAction({
            action: 'transfer',
            targetChain: 1,
            value: 100n,
            payload: new Uint8Array(0),
            nonce: 1,
        });
        
        const signature = signWithSessionKey(keyPair.privateKey, actionHash);
        
        const isValid = verifySessionSignature(
            actionHash,
            signature.signature,
            wrongKeyPair.publicKey // Wrong key
        );
        
        expect(isValid).toBe(false);
    });
});
