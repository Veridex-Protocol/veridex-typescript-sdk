/**
 * Veridex Protocol SDK - Stacks Signer Tests
 *
 * Tests for signature format conversion, key compression,
 * key hash computation, and message hash construction.
 */

import { describe, it, expect } from 'vitest';
import {
    compressPublicKey,
    rsToCompactSignature,
    parseDERSignature,
    derToCompactSignature,
    computeKeyHash,
    computeKeyHashFromCoords,
    buildRegistrationHash,
    buildSessionRegistrationHash,
    buildRevocationHash,
    buildExecuteHash,
    buildWithdrawalHash,
    bytesToHex,
    hexToBytes,
} from '../../src/chains/stacks/StacksSigner.js';

// ============================================================================
// Test Data
// ============================================================================

// Example P-256 public key coordinates (from WebAuthn)
const TEST_PUB_X = BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296');
const TEST_PUB_Y = BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5');

// Example signature components
const TEST_SIG_R = BigInt('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
const TEST_SIG_S = BigInt('0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321');

// P-256 curve order
const P256_ORDER = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
const P256_HALF_ORDER = P256_ORDER / 2n;

// ============================================================================
// Public Key Compression Tests
// ============================================================================

describe('compressPublicKey', () => {
    it('should produce 33-byte output', () => {
        const compressed = compressPublicKey(TEST_PUB_X, TEST_PUB_Y);
        expect(compressed.length).toBe(33);
    });

    it('should use 0x02 prefix for even Y', () => {
        const evenY = 2n; // Even
        const compressed = compressPublicKey(TEST_PUB_X, evenY);
        expect(compressed[0]).toBe(0x02);
    });

    it('should use 0x03 prefix for odd Y', () => {
        const oddY = 3n; // Odd
        const compressed = compressPublicKey(TEST_PUB_X, oddY);
        expect(compressed[0]).toBe(0x03);
    });

    it('should encode X coordinate in bytes 1-32', () => {
        const compressed = compressPublicKey(TEST_PUB_X, TEST_PUB_Y);
        const xHex = bytesToHex(compressed.slice(1));
        expect(xHex).toBe(TEST_PUB_X.toString(16).padStart(64, '0'));
    });

    it('should handle zero coordinates', () => {
        const compressed = compressPublicKey(0n, 0n);
        expect(compressed.length).toBe(33);
        expect(compressed[0]).toBe(0x02); // 0 is even
    });

    it('should be deterministic', () => {
        const a = compressPublicKey(TEST_PUB_X, TEST_PUB_Y);
        const b = compressPublicKey(TEST_PUB_X, TEST_PUB_Y);
        expect(bytesToHex(a)).toBe(bytesToHex(b));
    });
});

// ============================================================================
// Signature Conversion Tests
// ============================================================================

describe('rsToCompactSignature', () => {
    it('should produce 64-byte output', () => {
        const compact = rsToCompactSignature(TEST_SIG_R, TEST_SIG_S);
        expect(compact.length).toBe(64);
    });

    it('should encode r in first 32 bytes', () => {
        const compact = rsToCompactSignature(TEST_SIG_R, TEST_SIG_S);
        const rHex = bytesToHex(compact.slice(0, 32));
        expect(rHex).toBe(TEST_SIG_R.toString(16).padStart(64, '0'));
    });

    it('should apply low-S normalization when s > half-order', () => {
        const highS = P256_HALF_ORDER + 1n;
        const compact = rsToCompactSignature(TEST_SIG_R, highS);
        const sBytes = compact.slice(32, 64);
        const normalizedS = BigInt('0x' + bytesToHex(sBytes));
        expect(normalizedS).toBeLessThanOrEqual(P256_HALF_ORDER);
        expect(normalizedS).toBe(P256_ORDER - highS);
    });

    it('should not modify s when s <= half-order', () => {
        const lowS = P256_HALF_ORDER - 1n;
        const compact = rsToCompactSignature(TEST_SIG_R, lowS);
        const sBytes = compact.slice(32, 64);
        const resultS = BigInt('0x' + bytesToHex(sBytes));
        expect(resultS).toBe(lowS);
    });

    it('should handle s exactly at half-order', () => {
        const compact = rsToCompactSignature(TEST_SIG_R, P256_HALF_ORDER);
        const sBytes = compact.slice(32, 64);
        const resultS = BigInt('0x' + bytesToHex(sBytes));
        expect(resultS).toBe(P256_HALF_ORDER);
    });
});

describe('parseDERSignature', () => {
    it('should parse a valid DER signature', () => {
        // Construct a minimal DER signature: 30 [len] 02 [rlen] [r] 02 [slen] [s]
        const r = new Uint8Array([0x01, 0x02, 0x03]);
        const s = new Uint8Array([0x04, 0x05, 0x06]);
        const der = new Uint8Array([
            0x30, 2 + r.length + 2 + s.length,
            0x02, r.length, ...r,
            0x02, s.length, ...s,
        ]);

        const result = parseDERSignature(der);
        expect(result.r).toBe(BigInt('0x010203'));
        expect(result.s).toBe(BigInt('0x040506'));
    });

    it('should handle DER with leading zero padding', () => {
        // DER encodes positive integers with leading 0x00 if high bit is set
        const r = new Uint8Array([0x00, 0x80, 0x01]);
        const s = new Uint8Array([0x00, 0xff, 0x02]);
        const der = new Uint8Array([
            0x30, 2 + r.length + 2 + s.length,
            0x02, r.length, ...r,
            0x02, s.length, ...s,
        ]);

        const result = parseDERSignature(der);
        expect(result.r).toBe(BigInt('0x8001'));
        expect(result.s).toBe(BigInt('0xff02'));
    });

    it('should throw for invalid DER (missing SEQUENCE tag)', () => {
        const invalid = new Uint8Array([0x31, 0x00]);
        expect(() => parseDERSignature(invalid)).toThrow('SEQUENCE tag');
    });

    it('should throw for invalid DER (missing INTEGER tag for r)', () => {
        const invalid = new Uint8Array([0x30, 0x02, 0x03, 0x01, 0x00]);
        expect(() => parseDERSignature(invalid)).toThrow('INTEGER tag');
    });
});

describe('derToCompactSignature', () => {
    it('should convert DER to 64-byte compact', () => {
        const r = new Uint8Array(32).fill(0x11);
        const s = new Uint8Array(32).fill(0x22);
        const der = new Uint8Array([
            0x30, 2 + r.length + 2 + s.length,
            0x02, r.length, ...r,
            0x02, s.length, ...s,
        ]);

        const compact = derToCompactSignature(der);
        expect(compact.length).toBe(64);
    });
});

// ============================================================================
// Key Hash Tests
// ============================================================================

describe('computeKeyHash', () => {
    it('should produce a 0x-prefixed hex string', async () => {
        const compressed = compressPublicKey(TEST_PUB_X, TEST_PUB_Y);
        const hash = await computeKeyHash(compressed);
        expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('should be deterministic', async () => {
        const compressed = compressPublicKey(TEST_PUB_X, TEST_PUB_Y);
        const hash1 = await computeKeyHash(compressed);
        const hash2 = await computeKeyHash(compressed);
        expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different keys', async () => {
        const key1 = compressPublicKey(TEST_PUB_X, TEST_PUB_Y);
        const key2 = compressPublicKey(TEST_PUB_X, TEST_PUB_Y + 1n);
        const hash1 = await computeKeyHash(key1);
        const hash2 = await computeKeyHash(key2);
        expect(hash1).not.toBe(hash2);
    });
});

describe('computeKeyHashFromCoords', () => {
    it('should produce same result as manual compress + hash', async () => {
        const compressed = compressPublicKey(TEST_PUB_X, TEST_PUB_Y);
        const hashDirect = await computeKeyHash(compressed);
        const hashFromCoords = await computeKeyHashFromCoords(TEST_PUB_X, TEST_PUB_Y);
        expect(hashFromCoords).toBe(hashDirect);
    });
});

// ============================================================================
// Message Hash Construction Tests
// ============================================================================

describe('buildRegistrationHash', () => {
    it('should produce 32-byte hash', async () => {
        const hash = await buildRegistrationHash(0);
        expect(hash.length).toBe(32);
    });

    it('should produce different hashes for different nonces', async () => {
        const hash0 = await buildRegistrationHash(0);
        const hash1 = await buildRegistrationHash(1);
        expect(bytesToHex(hash0)).not.toBe(bytesToHex(hash1));
    });

    it('should be deterministic', async () => {
        const hash1 = await buildRegistrationHash(42);
        const hash2 = await buildRegistrationHash(42);
        expect(bytesToHex(hash1)).toBe(bytesToHex(hash2));
    });
});

describe('buildSessionRegistrationHash', () => {
    it('should produce 32-byte hash', async () => {
        const hash = await buildSessionRegistrationHash(
            '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
            100,
            1000000n,
            0
        );
        expect(hash.length).toBe(32);
    });

    it('should strip 0x prefix from session key hash', async () => {
        const hash1 = await buildSessionRegistrationHash('0xabc', 100, 1000n, 0);
        const hash2 = await buildSessionRegistrationHash('abc', 100, 1000n, 0);
        expect(bytesToHex(hash1)).toBe(bytesToHex(hash2));
    });
});

describe('buildRevocationHash', () => {
    it('should produce 32-byte hash', async () => {
        const hash = await buildRevocationHash('0xdeadbeef', 5);
        expect(hash.length).toBe(32);
    });
});

describe('buildExecuteHash', () => {
    it('should produce 32-byte hash', async () => {
        const hash = await buildExecuteHash(
            1, // STX transfer
            1000000n,
            'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
            0
        );
        expect(hash.length).toBe(32);
    });

    it('should produce different hashes for different action types', async () => {
        const hash1 = await buildExecuteHash(1, 1000n, 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM', 0);
        const hash2 = await buildExecuteHash(2, 1000n, 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM', 0);
        expect(bytesToHex(hash1)).not.toBe(bytesToHex(hash2));
    });
});

describe('buildWithdrawalHash', () => {
    it('should produce 32-byte hash', async () => {
        const hash = await buildWithdrawalHash(
            500000n,
            'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
            0
        );
        expect(hash.length).toBe(32);
    });
});

// ============================================================================
// Hex Utility Tests
// ============================================================================

describe('bytesToHex', () => {
    it('should convert bytes to hex string', () => {
        expect(bytesToHex(new Uint8Array([0x00, 0xff, 0x80]))).toBe('00ff80');
    });

    it('should handle empty array', () => {
        expect(bytesToHex(new Uint8Array([]))).toBe('');
    });
});

describe('hexToBytes', () => {
    it('should convert hex string to bytes', () => {
        const bytes = hexToBytes('00ff80');
        expect(bytes).toEqual(new Uint8Array([0x00, 0xff, 0x80]));
    });

    it('should handle 0x prefix', () => {
        const bytes = hexToBytes('0x00ff80');
        expect(bytes).toEqual(new Uint8Array([0x00, 0xff, 0x80]));
    });

    it('should handle empty string', () => {
        const bytes = hexToBytes('');
        expect(bytes.length).toBe(0);
    });

    it('should roundtrip with bytesToHex', () => {
        const original = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);
        const hex = bytesToHex(original);
        const result = hexToBytes(hex);
        expect(result).toEqual(original);
    });
});
