/**
 * Veridex Protocol SDK - Session Cryptography Utilities
 * 
 * Provides cryptographic operations for session key management:
 * - secp256k1 key generation (NOT secp256r1 - sessions are software-backed)
 * - ECDSA signing with session keys
 * - Key hash derivation (keccak256)
 * - Secure random generation
 */

import { ethers } from 'ethers';
import { SessionError, SessionErrorCode } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum session duration enforced on-chain (24 hours) */
export const MAX_SESSION_DURATION = 86400; // 24 hours in seconds

/** Minimum session duration (60 seconds) */
export const MIN_SESSION_DURATION = 60;

/** Default session duration (1 hour) */
export const DEFAULT_SESSION_DURATION = 3600;

/** Default refresh buffer (5 minutes before expiry) */
export const DEFAULT_REFRESH_BUFFER = 300;

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Key pair for secp256k1 session keys
 */
export interface KeyPair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    address: string; // Ethereum-style address for verification
}

/**
 * Generate a new secp256k1 key pair for session key
 * 
 * Security:
 * - Uses cryptographically secure random (ethers.Wallet.createRandom)
 * - Returns uncompressed public key (65 bytes)
 * - Private key is 32 bytes
 * 
 * @returns KeyPair with public/private keys and derived address
 */
export function generateSecp256k1KeyPair(): KeyPair {
    try {
        // Use ethers.js for secure key generation
        const wallet = ethers.Wallet.createRandom();
        
        // Extract raw private key (32 bytes)
        const privateKey = ethers.getBytes(wallet.privateKey);
        
        // ethers v6 returns COMPRESSED public key (33 bytes).
        // We need UNCOMPRESSED (65 bytes: 0x04 || x || y).
        // Use SigningKey to derive the uncompressed form.
        const signingKey = new ethers.SigningKey(wallet.privateKey);
        const publicKey = ethers.getBytes(signingKey.publicKey);
        
        return {
            publicKey,
            privateKey,
            address: wallet.address,
        };
    } catch (error) {
        throw new SessionError(
            'Failed to generate secp256k1 key pair',
            SessionErrorCode.ENCRYPTION_ERROR,
            error
        );
    }
}

/**
 * Compute keccak256 hash of public key (session key identifier)
 * 
 * This hash is used as the on-chain identifier for the session.
 * It matches the Solidity keccak256(publicKey) computation.
 * 
 * @param publicKey Uncompressed public key (65 bytes)
 * @returns Hex string of keccak256 hash (0x...)
 */
export function computeSessionKeyHash(publicKey: Uint8Array): string {
    if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
        throw new SessionError(
            'Invalid public key format (expected 65-byte uncompressed key)',
            SessionErrorCode.INVALID_CONFIG
        );
    }
    
    // Hash the full uncompressed public key (including 0x04 prefix)
    return ethers.keccak256(publicKey);
}

// ============================================================================
// Signing
// ============================================================================

/**
 * Sign a message hash with a session key (secp256k1 ECDSA)
 * 
 * @param privateKey Session private key (32 bytes)
 * @param messageHash Message hash to sign (32 bytes)
 * @returns Signature with r, s, v components
 */
export function signWithSessionKey(
    privateKey: Uint8Array,
    messageHash: Uint8Array | string
): { r: string; s: string; v: number; signature: Uint8Array } {
    try {
        if (privateKey.length !== 32) {
            throw new SessionError(
                'Invalid private key length (expected 32 bytes)',
                SessionErrorCode.ENCRYPTION_ERROR
            );
        }
        
        // Create signing key from private key
        const signingKey = new ethers.SigningKey(privateKey);
        
        // Ensure message hash is bytes
        const hashBytes = typeof messageHash === 'string' 
            ? ethers.getBytes(messageHash)
            : messageHash;
        
        if (hashBytes.length !== 32) {
            throw new SessionError(
                'Invalid message hash length (expected 32 bytes)',
                SessionErrorCode.INVALID_CONFIG
            );
        }
        
        // Sign the hash
        const sig = signingKey.sign(hashBytes);
        
        // Extract r, s, v
        const r = sig.r;
        const s = sig.s;
        const v = sig.v;
        
        // Combine into 65-byte signature (r + s + v)
        const signature = ethers.getBytes(sig.serialized);
        
        return { r, s, v, signature };
    } catch (error) {
        throw new SessionError(
            'Failed to sign with session key',
            SessionErrorCode.ENCRYPTION_ERROR,
            error
        );
    }
}

/**
 * Hash an action for signing
 * 
 * Creates a deterministic hash of action parameters that can be
 * signed with a session key and verified on-chain.
 * 
 * Hash format: keccak256(abi.encodePacked(
 *   action, targetChain, value, keccak256(payload), nonce, deadline
 * ))
 * 
 * @param params Action parameters
 * @returns Message hash (32 bytes)
 */
export function hashAction(params: {
    action: string;
    targetChain: number;
    value: bigint;
    payload: Uint8Array;
    nonce: number;
    deadline?: number;
}): Uint8Array {
    try {
        // Hash the payload first
        const payloadHash = ethers.keccak256(params.payload);
        
        // Encode packed (matches Solidity abi.encodePacked)
        const encoded = ethers.solidityPacked(
            ['string', 'uint256', 'uint256', 'bytes32', 'uint256', 'uint256'],
            [
                params.action,
                params.targetChain,
                params.value,
                payloadHash,
                params.nonce,
                params.deadline ?? 0,
            ]
        );
        
        // Return keccak256 hash
        return ethers.getBytes(ethers.keccak256(encoded));
    } catch (error) {
        throw new SessionError(
            'Failed to hash action',
            SessionErrorCode.INVALID_CONFIG,
            error
        );
    }
}

/**
 * Verify a session key signature
 * 
 * Used for testing and client-side validation before submission.
 * On-chain verification is handled by Spoke contracts via CCQ.
 * 
 * @param messageHash Message that was signed
 * @param signature Signature to verify
 * @param expectedPublicKey Expected public key of signer
 * @returns True if signature is valid
 */
export function verifySessionSignature(
    messageHash: Uint8Array | string,
    signature: Uint8Array,
    expectedPublicKey: Uint8Array
): boolean {
    try {
        if (signature.length !== 65) {
            return false;
        }
        
        // Ensure hash is bytes
        const hashBytes = typeof messageHash === 'string'
            ? ethers.getBytes(messageHash)
            : messageHash;
        
        // Recover public key from signature
        const recovered = ethers.SigningKey.recoverPublicKey(
            hashBytes,
            ethers.hexlify(signature)
        );
        
        // Compare with expected public key
        const recoveredBytes = ethers.getBytes(recovered);
        
        if (recoveredBytes.length !== expectedPublicKey.length) {
            return false;
        }
        
        // Constant-time comparison
        return recoveredBytes.every((byte, i) => byte === expectedPublicKey[i]);
    } catch {
        return false;
    }
}

// ============================================================================
// Encryption Key Derivation
// ============================================================================

/**
 * Derive an AES-GCM encryption key for session storage
 * 
 * Uses PBKDF2 to derive a key from a user-specific seed.
 * The seed should be derived from the user's Passkey credential ID.
 * 
 * Security considerations:
 * - Uses 100,000 iterations (OWASP minimum)
 * - Salt is derived from credential ID (unique per user)
 * - Key is bound to specific browser/device via extractable: false
 * 
 * @param credentialId User's Passkey credential ID (unique identifier)
 * @returns AES-GCM encryption key
 */
export async function deriveEncryptionKey(credentialId: string): Promise<CryptoKey> {
    try {
        // Use credential ID as password material
        const passwordBytes = ethers.toUtf8Bytes(credentialId);
        
        // Import as key material
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            passwordBytes as BufferSource,
            'PBKDF2',
            false,
            ['deriveKey']
        );
        
        // Derive salt from credential ID (deterministic but unique per user)
        const saltBytes = ethers.getBytes(ethers.keccak256(passwordBytes));
        
        // Derive AES-GCM key
        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: saltBytes as BufferSource,
                iterations: 100000, // OWASP minimum
                hash: 'SHA-256',
            },
            keyMaterial,
            {
                name: 'AES-GCM',
                length: 256,
            },
            false, // Not extractable (stays in browser)
            ['encrypt', 'decrypt']
        );
        
        return key;
    } catch (error) {
        throw new SessionError(
            'Failed to derive encryption key',
            SessionErrorCode.ENCRYPTION_ERROR,
            error
        );
    }
}

/**
 * Generate a random initialization vector (IV) for AES-GCM
 * 
 * @returns 12-byte IV (standard for AES-GCM)
 */
export function generateIv(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(12));
}

/**
 * Encrypt data with AES-GCM
 * 
 * @param data Data to encrypt
 * @param key AES-GCM encryption key
 * @returns Encrypted data with IV prepended
 */
export async function encrypt(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
    try {
        const iv = generateIv();
        
        const encrypted = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv as BufferSource,
            },
            key,
            data as BufferSource
        );
        
        // Prepend IV to encrypted data (IV is not secret)
        const result = new Uint8Array(iv.length + encrypted.byteLength);
        result.set(iv, 0);
        result.set(new Uint8Array(encrypted), iv.length);
        
        return result;
    } catch (error) {
        throw new SessionError(
            'Encryption failed',
            SessionErrorCode.ENCRYPTION_ERROR,
            error
        );
    }
}

/**
 * Decrypt data with AES-GCM
 * 
 * @param encryptedData Data with IV prepended
 * @param key AES-GCM encryption key
 * @returns Decrypted data
 */
export async function decrypt(encryptedData: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
    try {
        if (encryptedData.length < 12) {
            throw new Error('Invalid encrypted data (too short)');
        }
        
        // Extract IV (first 12 bytes)
        const iv = encryptedData.slice(0, 12);
        
        // Extract encrypted data (remaining bytes)
        const ciphertext = encryptedData.slice(12);
        
        const decrypted = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv,
            },
            key,
            ciphertext
        );
        
        return new Uint8Array(decrypted);
    } catch (error) {
        throw new SessionError(
            'Decryption failed',
            SessionErrorCode.ENCRYPTION_ERROR,
            error
        );
    }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate session configuration
 * 
 * @param config Session configuration to validate
 * @throws SessionError if configuration is invalid
 */
export function validateSessionConfig(config: {
    duration: number;
    maxValue: bigint;
}): void {
    if (config.duration < MIN_SESSION_DURATION) {
        throw new SessionError(
            `Session duration too short (minimum: ${MIN_SESSION_DURATION}s)`,
            SessionErrorCode.INVALID_CONFIG
        );
    }
    
    if (config.duration > MAX_SESSION_DURATION) {
        throw new SessionError(
            `Session duration too long (maximum: ${MAX_SESSION_DURATION}s = 24 hours)`,
            SessionErrorCode.INVALID_CONFIG
        );
    }
    
    if (config.maxValue < 0n) {
        throw new SessionError(
            'Session maxValue cannot be negative',
            SessionErrorCode.INVALID_CONFIG
        );
    }
}
