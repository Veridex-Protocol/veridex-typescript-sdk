/**
 * Veridex Protocol SDK - Stacks Signature Format Conversion
 *
 * Converts WebAuthn/Passkey signatures to Clarity-compatible formats.
 *
 * Key conversions:
 * - WebAuthn DER-encoded signature → 64-byte compact (buff 64) for secp256r1-verify
 * - Uncompressed pubkey (x, y) → 33-byte compressed (buff 33)
 * - Session key signing via secp256k1 → 65-byte recoverable (buff 65)
 */

// ============================================================================
// Constants
// ============================================================================

/** secp256r1 curve order (P-256) */
const P256_ORDER = BigInt(
    '0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551'
);

/** secp256r1 half-order for low-S normalization */
const P256_HALF_ORDER = P256_ORDER / 2n;

// ============================================================================
// Public Key Compression
// ============================================================================

/**
 * Compress a P-256 public key from (x, y) coordinates to 33-byte compressed format.
 * The prefix byte is 0x02 if y is even, 0x03 if y is odd.
 *
 * @param x - P-256 public key X coordinate
 * @param y - P-256 public key Y coordinate
 * @returns 33-byte compressed public key
 */
export function compressPublicKey(x: bigint, y: bigint): Uint8Array {
    const prefix = y % 2n === 0n ? 0x02 : 0x03;
    const xBytes = bigintToBytes(x, 32);
    const compressed = new Uint8Array(33);
    compressed[0] = prefix;
    compressed.set(xBytes, 1);
    return compressed;
}

// ============================================================================
// Signature Conversion
// ============================================================================

/**
 * Convert (r, s) bigint pair to 64-byte compact signature for secp256r1-verify.
 * Applies low-S normalization (required by Clarity's secp256r1-verify).
 *
 * @param r - Signature r component
 * @param s - Signature s component
 * @returns 64-byte compact signature buffer
 */
export function rsToCompactSignature(r: bigint, s: bigint): Uint8Array {
    // Low-S normalization: if s > half-order, use order - s
    const normalizedS = s > P256_HALF_ORDER ? P256_ORDER - s : s;

    const compact = new Uint8Array(64);
    compact.set(bigintToBytes(r, 32), 0);
    compact.set(bigintToBytes(normalizedS, 32), 32);
    return compact;
}

/**
 * Parse a DER-encoded ECDSA signature into (r, s) components.
 * WebAuthn signatures are typically DER-encoded.
 *
 * DER format: 0x30 [total-len] 0x02 [r-len] [r] 0x02 [s-len] [s]
 *
 * @param der - DER-encoded signature bytes
 * @returns Object with r and s as bigints
 */
export function parseDERSignature(der: Uint8Array): { r: bigint; s: bigint } {
    if (der[0] !== 0x30) {
        throw new Error('Invalid DER signature: expected SEQUENCE tag 0x30');
    }

    let offset = 2; // Skip SEQUENCE tag and length

    // Parse r
    if (der[offset] !== 0x02) {
        throw new Error('Invalid DER signature: expected INTEGER tag 0x02 for r');
    }
    offset++;
    const rLen = der[offset]!;
    offset++;
    const rBytes = der.slice(offset, offset + rLen);
    offset += rLen;

    // Parse s
    if (der[offset] !== 0x02) {
        throw new Error('Invalid DER signature: expected INTEGER tag 0x02 for s');
    }
    offset++;
    const sLen = der[offset]!;
    offset++;
    const sBytes = der.slice(offset, offset + sLen);

    return {
        r: bytesToBigint(rBytes),
        s: bytesToBigint(sBytes),
    };
}

/**
 * Convert a DER-encoded signature to 64-byte compact format.
 * Combines DER parsing with compact encoding and low-S normalization.
 *
 * @param der - DER-encoded signature bytes
 * @returns 64-byte compact signature buffer
 */
export function derToCompactSignature(der: Uint8Array): Uint8Array {
    const { r, s } = parseDERSignature(der);
    return rsToCompactSignature(r, s);
}

// ============================================================================
// Key Hash Computation
// ============================================================================

/**
 * Compute the key hash (SHA-256 of compressed public key).
 * This matches the Clarity contract's `(sha256 compressed-pubkey)`.
 *
 * @param compressedPubkey - 33-byte compressed public key
 * @returns 32-byte key hash as hex string (with 0x prefix)
 */
export async function computeKeyHash(compressedPubkey: Uint8Array): Promise<string> {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', compressedPubkey.buffer as ArrayBuffer);
    const hashArray = new Uint8Array(hashBuffer);
    return '0x' + bytesToHex(hashArray);
}

/**
 * Compute the key hash from (x, y) public key coordinates.
 * Compresses the key first, then SHA-256 hashes it.
 *
 * @param x - P-256 public key X coordinate
 * @param y - P-256 public key Y coordinate
 * @returns 32-byte key hash as hex string (with 0x prefix)
 */
export async function computeKeyHashFromCoords(x: bigint, y: bigint): Promise<string> {
    const compressed = compressPublicKey(x, y);
    return computeKeyHash(compressed);
}

// ============================================================================
// Message Hash Construction
// ============================================================================

/**
 * Build a registration message hash.
 * Format: SHA-256("veridex:register:<nonce>")
 *
 * @param nonce - Registration nonce (typically 0 for first registration)
 * @returns 32-byte message hash
 */
export async function buildRegistrationHash(nonce: number): Promise<Uint8Array> {
    const message = `veridex:register:${nonce}`;
    const encoded = new TextEncoder().encode(message);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded.buffer as ArrayBuffer);
    return new Uint8Array(hashBuffer);
}

/**
 * Build a session registration message hash.
 * Format: SHA-256("veridex:session:<session-key-hash>:<duration>:<max-value>:<nonce>")
 *
 * @param sessionKeyHash - Hex string of session key hash
 * @param duration - Session duration in blocks
 * @param maxValue - Maximum spending value in microSTX
 * @param nonce - Identity nonce
 * @returns 32-byte message hash
 */
export async function buildSessionRegistrationHash(
    sessionKeyHash: string,
    duration: number,
    maxValue: bigint,
    nonce: number
): Promise<Uint8Array> {
    const cleanHash = sessionKeyHash.replace('0x', '');
    const message = `veridex:session:${cleanHash}:${duration}:${maxValue}:${nonce}`;
    const encoded = new TextEncoder().encode(message);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded.buffer as ArrayBuffer);
    return new Uint8Array(hashBuffer);
}

/**
 * Build a session revocation message hash.
 * Format: SHA-256("veridex:revoke:<session-hash>:<nonce>")
 *
 * @param sessionHash - Hex string of session hash to revoke
 * @param nonce - Identity nonce
 * @returns 32-byte message hash
 */
export async function buildRevocationHash(
    sessionHash: string,
    nonce: number
): Promise<Uint8Array> {
    const cleanHash = sessionHash.replace('0x', '');
    const message = `veridex:revoke:${cleanHash}:${nonce}`;
    const encoded = new TextEncoder().encode(message);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded.buffer as ArrayBuffer);
    return new Uint8Array(hashBuffer);
}

/**
 * Build an execute action message hash.
 * Format: SHA-256("veridex:execute:<action-type>:<amount>:<recipient>:<nonce>")
 *
 * @param actionType - Action type (1=STX transfer, 2=sBTC transfer)
 * @param amount - Amount in base units
 * @param recipient - Stacks principal address
 * @param nonce - Identity nonce
 * @returns 32-byte message hash
 */
export async function buildExecuteHash(
    actionType: number,
    amount: bigint,
    recipient: string,
    nonce: number
): Promise<Uint8Array> {
    const message = `veridex:execute:${actionType}:${amount}:${recipient}:${nonce}`;
    const encoded = new TextEncoder().encode(message);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded.buffer as ArrayBuffer);
    return new Uint8Array(hashBuffer);
}

/**
 * Build a withdrawal message hash.
 * Format: SHA-256("veridex:withdraw:<amount>:<recipient>:<nonce>")
 *
 * @param amount - Amount in microSTX
 * @param recipient - Stacks principal address
 * @param nonce - Identity nonce (from spoke contract, not used for passkey withdrawals but kept for consistency)
 * @returns 32-byte message hash
 */
export async function buildWithdrawalHash(
    amount: bigint,
    recipient: string,
    nonce: number
): Promise<Uint8Array> {
    const message = `veridex:withdraw:${amount}:${recipient}:${nonce}`;
    const encoded = new TextEncoder().encode(message);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded.buffer as ArrayBuffer);
    return new Uint8Array(hashBuffer);
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Convert a bigint to a fixed-length byte array (big-endian).
 */
function bigintToBytes(value: bigint, length: number): Uint8Array {
    const hex = value.toString(16).padStart(length * 2, '0');
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

/**
 * Convert a byte array to a bigint (big-endian).
 * Handles leading zero bytes (positive integers in DER encoding).
 */
function bytesToBigint(bytes: Uint8Array): bigint {
    // Skip leading zero bytes (DER positive integer padding)
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) {
        start++;
    }
    let result = 0n;
    for (let i = start; i < bytes.length; i++) {
        result = (result << 8n) | BigInt(bytes[i]!);
    }
    return result;
}

/**
 * Convert a byte array to a hex string (no prefix).
 */
export function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Convert a hex string to a byte array.
 */
export function hexToBytes(hex: string): Uint8Array {
    const clean = hex.replace('0x', '');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}
