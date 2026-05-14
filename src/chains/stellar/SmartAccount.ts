/**
 * Veridex Protocol SDK — Soroban smart-account address derivation
 *
 * The Veridex Stellar adapter binds a WebAuthn passkey to a Soroban smart
 * account whose `__check_auth` entry verifies secp256r1 signatures against
 * the passkey's `keyHash`.
 *
 * For the credibility-artifact stage we expose deterministic address
 * derivation only — actual deployment is handled by a separate Soroban
 * factory contract (see `contracts/stellar/` once added). This keeps the
 * SDK chain-agnostic and avoids pulling in the heavy `@stellar/stellar-sdk`
 * runtime.
 */

import { sha256 } from '@noble/hashes/sha256';

/**
 * Deterministically derive a Soroban contract id (C-address) from a passkey
 * `keyHash`. This mirrors the SEP-0011 Stellar contract-id derivation
 * scheme: contract_id = sha256(networkPassphrase || keyHash || salt).
 *
 * NOTE: This returns a stable 32-byte identifier encoded as hex. To produce
 * a canonical `C...` strkey representation the consumer must encode it with
 * `StrKey.encodeContract` from `@stellar/stellar-sdk`. We deliberately keep
 * the encoding out of `@veridex/sdk` to avoid a hard dependency.
 *
 * @param keyHash - The Veridex passkey keyHash (hex, with or without 0x).
 * @param networkPassphrase - Stellar network passphrase (e.g. testnet).
 * @param salt - Optional 32-byte salt (hex). Defaults to all-zeros.
 * @returns The 32-byte contract id encoded as a 0x-prefixed hex string.
 */
export function deriveSmartAccountId(
    keyHash: string,
    networkPassphrase: string,
    salt?: string,
): string {
    const cleanHash = keyHash.startsWith('0x') ? keyHash.slice(2) : keyHash;
    if (cleanHash.length !== 64) {
        throw new Error(
            `deriveSmartAccountId: keyHash must be 32 bytes (64 hex chars), got ${cleanHash.length}`,
        );
    }

    const cleanSalt = salt
        ? (salt.startsWith('0x') ? salt.slice(2) : salt)
        : '0'.repeat(64);
    if (cleanSalt.length !== 64) {
        throw new Error(
            `deriveSmartAccountId: salt must be 32 bytes (64 hex chars), got ${cleanSalt.length}`,
        );
    }

    const encoder = new TextEncoder();
    const passphraseBytes = encoder.encode(networkPassphrase);
    const keyHashBytes = hexToBytes(cleanHash);
    const saltBytes = hexToBytes(cleanSalt);

    const buffer = new Uint8Array(
        passphraseBytes.length + keyHashBytes.length + saltBytes.length,
    );
    buffer.set(passphraseBytes, 0);
    buffer.set(keyHashBytes, passphraseBytes.length);
    buffer.set(saltBytes, passphraseBytes.length + keyHashBytes.length);

    const digest = sha256(buffer);
    return '0x' + bytesToHex(digest);
}

function hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

function bytesToHex(bytes: Uint8Array): string {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}
