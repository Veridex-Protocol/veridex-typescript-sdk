/**
 * Veridex Protocol SDK - Passkey Manager
 * 
 * Chain-agnostic WebAuthn/Passkey credential management
 */

import {
    startRegistration,
    startAuthentication,
    browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
import type {
    PublicKeyCredentialCreationOptionsJSON,
    PublicKeyCredentialRequestOptionsJSON,
    RegistrationResponseJSON,
    AuthenticationResponseJSON,
} from '@simplewebauthn/types';
import { ethers } from 'ethers';
import { base64URLEncode, base64URLDecode, parseDERSignature, computeKeyHash } from '../utils.js';

// ============================================================================
// Types
// ============================================================================

export interface PasskeyCredential {
    credentialId: string;
    publicKeyX: bigint;
    publicKeyY: bigint;
    keyHash: string;
}

export interface WebAuthnSignature {
    authenticatorData: string;
    clientDataJSON: string;
    challengeIndex: number;
    typeIndex: number;
    r: bigint;
    s: bigint;
}

export interface PasskeyManagerConfig {
    rpName?: string;
    rpId?: string;
    timeout?: number;
    userVerification?: 'required' | 'preferred' | 'discouraged';
    authenticatorAttachment?: 'platform' | 'cross-platform';
    /** Relayer API URL for cross-device credential recovery */
    relayerUrl?: string;
}

// ============================================================================
// PasskeyManager Class
// ============================================================================

/**
 * Manages WebAuthn passkey credentials for Veridex Protocol
 */
export class PasskeyManager {
    private config: Required<PasskeyManagerConfig>;
    private credential: PasskeyCredential | null = null;

    constructor(config: PasskeyManagerConfig = {}) {
        this.config = {
            rpName: config.rpName ?? 'Veridex Protocol',
            rpId: config.rpId ?? (typeof window !== 'undefined' ? window.location.hostname : 'localhost'),
            timeout: config.timeout ?? 60000,
            userVerification: config.userVerification ?? 'required',
            authenticatorAttachment: config.authenticatorAttachment ?? 'platform',
            relayerUrl: config.relayerUrl ?? '',
        };
    }

    static isSupported(): boolean {
        return browserSupportsWebAuthn();
    }

    static async isPlatformAuthenticatorAvailable(): Promise<boolean> {
        if (typeof window === 'undefined' || !window.PublicKeyCredential) {
            return false;
        }
        return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }

    async register(username: string, displayName: string): Promise<PasskeyCredential> {
        if (!PasskeyManager.isSupported()) {
            throw new Error('WebAuthn is not supported in this browser');
        }

        const challenge = ethers.randomBytes(32);
        const challengeBase64 = base64URLEncode(challenge);

        const options: PublicKeyCredentialCreationOptionsJSON = {
            challenge: challengeBase64,
            rp: {
                name: this.config.rpName,
                id: this.config.rpId,
            },
            user: {
                id: base64URLEncode(ethers.toUtf8Bytes(username)),
                name: username,
                displayName: displayName,
            },
            pubKeyCredParams: [
                { alg: -7, type: 'public-key' },   // ES256 (P-256) - WebAuthn default
                { alg: -257, type: 'public-key' }, // RS256 - Widely supported
                { alg: -8, type: 'public-key' },   // EdDSA - Modern, efficient
                { alg: -35, type: 'public-key' },  // ES384 (P-384)
                { alg: -36, type: 'public-key' },  // ES512 (P-521)
                { alg: -37, type: 'public-key' },  // PS256 - RSA PSS
            ],
            authenticatorSelection: {
                authenticatorAttachment: this.config.authenticatorAttachment,
                userVerification: this.config.userVerification,
                residentKey: 'required',
                requireResidentKey: true,
            },
            timeout: this.config.timeout,
            attestation: 'none',
        };

        const response = await startRegistration(options);
        const publicKey = this.extractPublicKeyFromAttestation(response);
        const keyHash = computeKeyHash(publicKey.x, publicKey.y);

        this.credential = {
            credentialId: response.id,
            publicKeyX: publicKey.x,
            publicKeyY: publicKey.y,
            keyHash,
        };

        return this.credential;
    }

    async sign(challenge: Uint8Array): Promise<WebAuthnSignature> {
        if (!this.credential) {
            throw new Error('No credential set. Call register() or setCredential() first.');
        }

        const challengeBase64 = base64URLEncode(challenge);

        const options: PublicKeyCredentialRequestOptionsJSON = {
            challenge: challengeBase64,
            rpId: this.config.rpId,
            allowCredentials: [
                {
                    id: this.credential.credentialId,
                    type: 'public-key',
                    transports: ['internal'],
                },
            ],
            userVerification: this.config.userVerification,
            timeout: this.config.timeout,
        };

        const response = await startAuthentication(options);
        return this.parseAuthenticationResponse(response);
    }

    /**
     * Authenticate using a discoverable credential (passkey)
     * This allows sign-in without knowing the credential ID ahead of time.
     * The authenticator will show all available passkeys for this RP.
     * 
     * @param challenge - Optional challenge bytes. If not provided, a random challenge is used.
     * @returns The credential that was used to authenticate, along with the signature
     */
    async authenticate(challenge?: Uint8Array): Promise<{
        credential: PasskeyCredential;
        signature: WebAuthnSignature;
    }> {
        if (!PasskeyManager.isSupported()) {
            throw new Error('WebAuthn is not supported in this browser');
        }

        const actualChallenge = challenge ?? ethers.randomBytes(32);
        const challengeBase64 = base64URLEncode(actualChallenge);

        // Use discoverable credentials - no allowCredentials means the authenticator
        // will show all available passkeys for this RP
        const options: PublicKeyCredentialRequestOptionsJSON = {
            challenge: challengeBase64,
            rpId: this.config.rpId,
            // No allowCredentials = discoverable credential flow
            userVerification: this.config.userVerification,
            timeout: this.config.timeout,
        };

        const response = await startAuthentication(options);
        
        // Extract the credential ID that was used
        const credentialId = response.id;
        
        // Parse the signature
        const signature = this.parseAuthenticationResponse(response);
        
        // For discoverable credentials, we need to recover the public key from the response
        // or require it to be stored. Since WebAuthn doesn't return the public key on auth,
        // we need to check if we have it stored, or use a different approach.
        
        // Try to load from localStorage first (might have been stored during registration)
        let storedCredential = this.loadCredentialById(credentialId);
        
        if (storedCredential) {
            this.credential = storedCredential;
            return { credential: storedCredential, signature };
        }
        
        // If not in localStorage, try to fetch from relayer (cross-device recovery)
        if (this.config.relayerUrl) {
            storedCredential = await this.loadCredentialFromRelayer(credentialId);
            if (storedCredential) {
                this.credential = storedCredential;
                // Cache locally for future use
                this.saveToLocalStorage();
                return { credential: storedCredential, signature };
            }
        }
        
        // If we don't have the public key stored anywhere, we need to throw an error
        // because we can't derive the keyHash without the public key
        throw new Error(
            'Credential not found. ' +
            'This passkey was registered on a different device or the data was cleared. ' +
            'Please register a new passkey or ensure the relayer URL is configured.'
        );
    }

    /**
     * Load a credential by its ID from localStorage
     * Used for discoverable credential authentication
     */
    private loadCredentialById(credentialId: string, key = 'veridex_credential'): PasskeyCredential | null {
        if (typeof window === 'undefined') {
            return null;
        }

        const stored = localStorage.getItem(key);
        if (!stored) {
            return null;
        }

        try {
            const data = JSON.parse(stored);
            // Check if this is the right credential
            if (data.credentialId === credentialId) {
                return {
                    credentialId: data.credentialId,
                    publicKeyX: BigInt(data.publicKeyX),
                    publicKeyY: BigInt(data.publicKeyY),
                    keyHash: data.keyHash,
                };
            }
            return null;
        } catch (error) {
            console.error('Failed to load credential:', error);
            return null;
        }
    }

    /**
     * Check if there's a stored credential for this RP
     */
    hasStoredCredential(key = 'veridex_credential'): boolean {
        if (typeof window === 'undefined') {
            return false;
        }
        return localStorage.getItem(key) !== null;
    }

    getCredential(): PasskeyCredential | null {
        return this.credential;
    }

    setCredential(credential: PasskeyCredential): void {
        this.credential = credential;
    }

    createCredentialFromPublicKey(
        credentialId: string,
        publicKeyX: bigint,
        publicKeyY: bigint
    ): PasskeyCredential {
        const keyHash = computeKeyHash(publicKeyX, publicKeyY);
        this.credential = {
            credentialId,
            publicKeyX,
            publicKeyY,
            keyHash,
        };
        return this.credential;
    }

    clearCredential(): void {
        this.credential = null;
    }

    saveToLocalStorage(key = 'veridex_credential'): void {
        if (!this.credential) {
            throw new Error('No credential to save');
        }
        if (typeof window === 'undefined') {
            throw new Error('localStorage is not available');
        }

        const data = {
            credentialId: this.credential.credentialId,
            publicKeyX: this.credential.publicKeyX.toString(),
            publicKeyY: this.credential.publicKeyY.toString(),
            keyHash: this.credential.keyHash,
        };

        localStorage.setItem(key, JSON.stringify(data));
    }

    loadFromLocalStorage(key = 'veridex_credential'): PasskeyCredential | null {
        if (typeof window === 'undefined') {
            return null;
        }

        const stored = localStorage.getItem(key);
        if (!stored) {
            return null;
        }

        try {
            const data = JSON.parse(stored);
            this.credential = {
                credentialId: data.credentialId,
                publicKeyX: BigInt(data.publicKeyX),
                publicKeyY: BigInt(data.publicKeyY),
                keyHash: data.keyHash,
            };
            return this.credential;
        } catch (error) {
            console.error('Failed to load credential from localStorage:', error);
            return null;
        }
    }

    removeFromLocalStorage(key = 'veridex_credential'): void {
        if (typeof window !== 'undefined') {
            localStorage.removeItem(key);
        }
    }

    // =========================================================================
    // Relayer-based Credential Storage (Cross-Device Recovery)
    // =========================================================================

    /**
     * Save the current credential to the relayer for cross-device recovery.
     * This should be called after registration.
     */
    async saveCredentialToRelayer(): Promise<boolean> {
        if (!this.credential) {
            throw new Error('No credential to save');
        }
        if (!this.config.relayerUrl) {
            console.warn('Relayer URL not configured; skipping remote credential storage');
            return false;
        }

        try {
            const response = await fetch(`${this.config.relayerUrl}/api/v1/credential`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    keyHash: this.credential.keyHash,
                    credentialId: this.credential.credentialId,
                    publicKeyX: this.credential.publicKeyX.toString(),
                    publicKeyY: this.credential.publicKeyY.toString(),
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Failed to save credential to relayer:', errorData);
                return false;
            }

            console.log('Credential saved to relayer for cross-device recovery');
            return true;
        } catch (error) {
            console.error('Failed to save credential to relayer:', error);
            return false;
        }
    }

    /**
     * Load a credential from the relayer by credential ID.
     * Used during discoverable credential authentication when localStorage is empty.
     */
    async loadCredentialFromRelayer(credentialId: string): Promise<PasskeyCredential | null> {
        if (!this.config.relayerUrl) {
            return null;
        }

        try {
            const response = await fetch(
                `${this.config.relayerUrl}/api/v1/credential/by-id/${encodeURIComponent(credentialId)}`
            );

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            if (!data.exists) {
                return null;
            }

            return {
                credentialId: data.credentialId,
                publicKeyX: BigInt(data.publicKeyX),
                publicKeyY: BigInt(data.publicKeyY),
                keyHash: data.keyHash,
            };
        } catch (error) {
            console.error('Failed to load credential from relayer:', error);
            return null;
        }
    }

    /**
     * Load a credential from the relayer by keyHash.
     * Useful when you know the user's keyHash but not their credential ID.
     */
    async loadCredentialFromRelayerByKeyHash(keyHash: string): Promise<PasskeyCredential | null> {
        if (!this.config.relayerUrl) {
            return null;
        }

        try {
            const response = await fetch(
                `${this.config.relayerUrl}/api/v1/credential/${encodeURIComponent(keyHash)}`
            );

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            if (!data.exists) {
                return null;
            }

            return {
                credentialId: data.credentialId,
                publicKeyX: BigInt(data.publicKeyX),
                publicKeyY: BigInt(data.publicKeyY),
                keyHash: data.keyHash,
            };
        } catch (error) {
            console.error('Failed to load credential from relayer:', error);
            return null;
        }
    }

    private extractPublicKeyFromAttestation(
        response: RegistrationResponseJSON
    ): { x: bigint; y: bigint } {
        const attestationObject = base64URLDecode(response.response.attestationObject);

        // Parse CBOR attestation object
        // The attestation object is a CBOR map with keys: fmt, authData, attStmt
        // We need to extract the authData which contains the credential public key

        let offset = 0;

        // Skip the CBOR map header (usually 0xa3 for 3-item map or 0xa2 for 2-item map)
        if (attestationObject[offset] >= 0xa0 && attestationObject[offset] <= 0xbf) {
            offset++;
        }

        // Find the authData field in the CBOR map
        // Look for the text string "authData" (0x68 followed by "authData")
        while (offset < attestationObject.length - 37) {
            if (attestationObject[offset] === 0x68 && // text string, 8 bytes
                attestationObject[offset + 1] === 0x61 && // 'a'
                attestationObject[offset + 2] === 0x75 && // 'u'
                attestationObject[offset + 3] === 0x74 && // 't'
                attestationObject[offset + 4] === 0x68 && // 'h'
                attestationObject[offset + 5] === 0x44 && // 'D'
                attestationObject[offset + 6] === 0x61 && // 'a'
                attestationObject[offset + 7] === 0x74 && // 't'
                attestationObject[offset + 8] === 0x61) { // 'a'
                offset += 9;
                break;
            }
            offset++;
        }

        // Skip the byte string header for authData
        if (attestationObject[offset] === 0x58 || attestationObject[offset] === 0x59) {
            // 0x58 = 1-byte length, 0x59 = 2-byte length
            const lengthBytes = attestationObject[offset] === 0x58 ? 1 : 2;
            offset += 1 + lengthBytes;
        }

        // Now we're at the start of authData
        // authData structure:
        // - rpIdHash: 32 bytes
        // - flags: 1 byte
        // - signCount: 4 bytes
        // - attestedCredentialData (if AT flag is set):
        //   - aaguid: 16 bytes
        //   - credentialIdLength: 2 bytes
        //   - credentialId: credentialIdLength bytes
        //   - credentialPublicKey: CBOR-encoded COSE_Key

        offset += 32; // Skip rpIdHash
        offset += 1;  // Skip flags
        offset += 4;  // Skip signCount
        offset += 16; // Skip aaguid

        // Read credential ID length
        const credIdLen = (attestationObject[offset] << 8) | attestationObject[offset + 1];
        offset += 2;
        offset += credIdLen; // Skip credential ID

        // Now we're at the COSE public key
        const coseKey = attestationObject.slice(offset);

        console.log('COSE key length:', coseKey.length);
        console.log('COSE key hex:', this.bytesToHex(coseKey.slice(0, Math.min(100, coseKey.length))));

        const { x, y } = this.parseCOSEKey(coseKey);
        return { x, y };
    }

    private parseCOSEKey(coseKey: Uint8Array): { x: bigint; y: bigint } {
        console.log('COSE key length:', coseKey.length);
        console.log('COSE key hex:', this.bytesToHex(coseKey));

        // Try multiple parsing strategies
        const parsed = this.tryParseCOSEKeyStrategies(coseKey);
        if (parsed) {
            return parsed;
        }

        // If all strategies fail, try using a CBOR parser approach
        return this.parseCOSEKeyWithCBORStructure(coseKey);
    }

    private tryParseCOSEKeyStrategies(coseKey: Uint8Array): { x: bigint; y: bigint } | null {
        // Strategy 1: Look for the specific pattern of EC2 keys
        const keyBytes = new Uint8Array(coseKey);

        // Common pattern for EC2 keys with P-256 curve
        for (let i = 0; i < keyBytes.length - 40; i++) {
            // Check for potential x coordinate (32 bytes preceded by key marker)
            if (keyBytes[i] === 0x58 && keyBytes[i + 1] === 0x20) {
                const potentialX = keyBytes.slice(i + 2, i + 34);

                // Look for y coordinate after x
                for (let j = i + 34; j < keyBytes.length - 34; j++) {
                    if (keyBytes[j] === 0x58 && keyBytes[j + 1] === 0x20) {
                        const potentialY = keyBytes.slice(j + 2, j + 34);

                        // Verify these look like valid coordinates
                        if (this.isValidCoordinate(potentialX) && this.isValidCoordinate(potentialY)) {
                            console.log('Found coordinates via pattern matching');
                            return {
                                x: this.bytesToBigInt(potentialX),
                                y: this.bytesToBigInt(potentialY)
                            };
                        }
                    }
                }
            }
        }

        // Strategy 2: Look for ASN.1 structure
        return this.tryParseASN1Structure(keyBytes);
    }

    private parseCOSEKeyWithCBORStructure(coseKey: Uint8Array): { x: bigint; y: bigint } {
        // More flexible parsing that handles different CBOR structures
        const bytes = new Uint8Array(coseKey);
        let xBytes: Uint8Array | null = null;
        let yBytes: Uint8Array | null = null;

        // Look for x and y coordinates by scanning for byte strings
        let i = 0;
        while (i < bytes.length) {
            // Check for byte string markers
            if (bytes[i] === 0x58) { // Byte string with length byte
                const length = bytes[i + 1];
                if (length === 0x20) { // 32 bytes - likely a coordinate
                    const start = i + 2;
                    const end = start + 32;

                    if (end <= bytes.length) {
                        const coordinate = bytes.slice(start, end);

                        // Assign to x or y based on position or previous assignments
                        if (!xBytes) {
                            xBytes = coordinate;
                            console.log('Found x at offset', i);
                        } else if (!yBytes) {
                            yBytes = coordinate;
                            console.log('Found y at offset', i);
                            break; // Found both, exit loop
                        }
                    }
                    i = end;
                } else {
                    i += length + 2;
                }
            } else if (bytes[i] === 0x42) { // Byte string with 2-byte length
                if (i + 3 < bytes.length) {
                    const length = (bytes[i + 1] << 8) | bytes[i + 2];
                    if (length === 32) {
                        const start = i + 3;
                        const end = start + 32;

                        if (end <= bytes.length) {
                            const coordinate = bytes.slice(start, end);

                            if (!xBytes) {
                                xBytes = coordinate;
                                console.log('Found x at offset', i);
                            } else if (!yBytes) {
                                yBytes = coordinate;
                                console.log('Found y at offset', i);
                                break;
                            }
                        }
                        i = end;
                    } else {
                        i += length + 3;
                    }
                } else {
                    i++;
                }
            } else if (bytes[i] === 0x40) { // Byte string with indefinite length
                // Skip indefinite length marker
                i++;
                // Look for 0x04 marker (uncompressed point) or direct coordinates
                while (i < bytes.length && bytes[i] !== 0xFF) { // 0xFF is break marker
                    if (bytes[i] === 0x04 && i + 65 <= bytes.length) {
                        // Uncompressed EC point format
                        const x = bytes.slice(i + 1, i + 33);
                        const y = bytes.slice(i + 33, i + 65);

                        if (this.isValidCoordinate(x) && this.isValidCoordinate(y)) {
                            xBytes = x;
                            yBytes = y;
                            console.log('Found coordinates in uncompressed point format');
                            break;
                        }
                    }
                    i++;
                }
                if (xBytes && yBytes) break;
            } else {
                i++;
            }
        }

        if (!xBytes || !yBytes) {
            // Fallback: Try to find any 32-byte sequences
            const potentialCoords = this.find32ByteSequences(bytes);
            if (potentialCoords.length >= 2) {
                xBytes = potentialCoords[0];
                yBytes = potentialCoords[1];
                console.log('Fallback: Using first two 32-byte sequences as coordinates');
            }
        }

        if (!xBytes || !yBytes) {
            console.error('Failed to find coordinates in COSE key. Full dump:');
            console.error('Hex:', this.bytesToHex(bytes));
            console.error('Structure analysis:');
            this.analyzeCOSEStructure(bytes);
            throw new Error('Failed to extract public key coordinates from COSE key. Check console for details.');
        }

        return {
            x: this.bytesToBigInt(xBytes),
            y: this.bytesToBigInt(yBytes)
        };
    }

    private tryParseASN1Structure(bytes: Uint8Array): { x: bigint; y: bigint } | null {
        // ASN.1 SEQUENCE for EC public key
        if (bytes[0] === 0x30) { // SEQUENCE tag
            let offset = 2; // Skip tag and length

            // Look for BIT STRING (0x03)
            if (bytes[offset] === 0x03) {
                offset += 2; // Skip BIT STRING tag and unused bits

                // Look for another SEQUENCE
                if (bytes[offset] === 0x30) {
                    offset += 2;

                    // Should now have OID for P-256: 1.2.840.10045.3.1.7
                    // Skip OID (usually 10 bytes: 06 08 2A 86 48 CE 3D 03 01 07)
                    offset += 12;

                    // BIT STRING containing the raw public key
                    if (bytes[offset] === 0x03 && bytes[offset + 2] === 0x04) {
                        offset += 3; // Skip to uncompressed point (0x04)

                        const x = bytes.slice(offset, offset + 32);
                        const y = bytes.slice(offset + 32, offset + 64);

                        if (x.length === 32 && y.length === 32) {
                            console.log('Found coordinates via ASN.1 parsing');
                            return {
                                x: this.bytesToBigInt(x),
                                y: this.bytesToBigInt(y)
                            };
                        }
                    }
                }
            }
        }
        return null;
    }

    private find32ByteSequences(bytes: Uint8Array): Uint8Array[] {
        const sequences: Uint8Array[] = [];

        for (let i = 0; i <= bytes.length - 32; i++) {
            // Check if this 32-byte sequence looks like a valid coordinate
            const sequence = bytes.slice(i, i + 32);
            if (this.isValidCoordinate(sequence)) {
                sequences.push(sequence);
            }
        }

        return sequences;
    }

    private isValidCoordinate(bytes: Uint8Array): boolean {
        if (bytes.length !== 32) return false;

        // Basic validation: not all zeros, not all FF
        let allZeros = true;
        let allOnes = true;

        for (const byte of bytes) {
            if (byte !== 0) allZeros = false;
            if (byte !== 0xFF) allOnes = false;
        }

        return !allZeros && !allOnes;
    }

    private bytesToBigInt(bytes: Uint8Array): bigint {
        return BigInt('0x' + this.bytesToHex(bytes));
    }

    private bytesToHex(bytes: Uint8Array): string {
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    private analyzeCOSEStructure(bytes: Uint8Array): void {
        console.log('COSE Structure Analysis:');
        console.log('First 20 bytes:', this.bytesToHex(bytes.slice(0, 20)));

        // Check for known COSE key structure markers
        const firstByte = bytes[0];
        console.log('First byte (0x' + firstByte.toString(16) + '):');

        if (firstByte >= 0xa0 && firstByte <= 0xbf) {
            console.log('- Definite length map with', (firstByte & 0x1f), 'pairs');
        } else if (firstByte === 0xbf) {
            console.log('- Indefinite length map');
        } else if (firstByte === 0x04) {
            console.log('- Byte string');
        } else if (firstByte === 0x02) {
            console.log('- Negative integer');
        }

        // Count occurrences of 32-byte sequences
        let count32 = 0;
        for (let i = 0; i <= bytes.length - 32; i++) {
            const chunk = bytes.slice(i, i + 32);
            if (this.isValidCoordinate(chunk)) {
                console.log(`Found valid 32-byte sequence at offset ${i}:`,
                    this.bytesToHex(chunk.slice(0, 8)) + '...');
                count32++;
            }
        }
        console.log(`Total valid 32-byte sequences: ${count32}`);

        // Look for specific markers
        console.log('Looking for known markers:');
        const markers = [
            { byte: 0x04, name: 'Uncompressed point marker' },
            { byte: 0x03, name: 'BIT STRING' },
            { byte: 0x30, name: 'SEQUENCE' },
            { byte: 0x02, name: 'INTEGER' },
            { byte: 0x06, name: 'OBJECT IDENTIFIER' },
            { byte: 0x58, name: 'Byte string with length byte' },
            { byte: 0x42, name: 'Byte string with 2-byte length' },
            { byte: 0x40, name: 'Byte string indefinite length' },
            { byte: 0xA0, name: 'Map start' },
            { byte: 0xBF, name: 'Indefinite map start' },
        ];

        for (const marker of markers) {
            const indices = [];
            for (let i = 0; i < bytes.length; i++) {
                if (bytes[i] === marker.byte) {
                    indices.push(i);
                }
            }
            if (indices.length > 0) {
                console.log(`  ${marker.name} (0x${marker.byte.toString(16)}) at positions:`, indices.slice(0, 5).join(', '));
            }
        }
    }

    private parseAuthenticationResponse(response: AuthenticationResponseJSON): WebAuthnSignature {
        const authenticatorData = base64URLDecode(response.response.authenticatorData);
        const clientDataJSON = response.response.clientDataJSON;
        const signature = base64URLDecode(response.response.signature);

        const { r, s } = parseDERSignature(signature);

        // Normalize signature to low-S form.
        // The on-chain WebAuthn verifier rejects signatures with s > n/2.
        // WebAuthn authenticators are not guaranteed to produce low-S signatures,
        // so without this normalization, valid signatures can intermittently fail.
        const P256_N = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
        const P256_N_DIV_2 = BigInt(
            '0x7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCF4279DCE5617E3192A8'
        );

        const clientDataStr = new TextDecoder().decode(base64URLDecode(clientDataJSON));
        const challengeIndex = clientDataStr.indexOf('"challenge"');
        const typeIndex = clientDataStr.indexOf('"type"');

        if (challengeIndex === -1 || typeIndex === -1) {
            throw new Error('Invalid clientDataJSON format');
        }

        return {
            authenticatorData: ethers.hexlify(authenticatorData),
            clientDataJSON: clientDataStr,
            challengeIndex,
            typeIndex,
            r: this.bytesToBigInt(r),
            s: (() => {
                const sBig = this.bytesToBigInt(s);
                return sBig > P256_N_DIV_2 ? P256_N - sBig : sBig;
            })(),
        };
    }
}