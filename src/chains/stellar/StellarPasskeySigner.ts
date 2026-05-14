/**
 * Veridex Protocol SDK — Stellar Passkey Signer
 *
 * Bridges Veridex's WebAuthn `PasskeyManager` to the SEP-43 signing surface
 * expected by Soroban smart accounts (and the Stellar-Wallets-Kit
 * `ModuleInterface`).
 *
 * Design:
 *   - The signer treats every SEP-43 signing call (transaction / auth entry
 *     / message) as a request to produce a WebAuthn assertion over the
 *     SHA-256 of a canonical preimage.
 *   - For a transaction we hash `network_id || tagged_tx_envelope` per the
 *     XDR-hash spec; for an auth entry we hash the
 *     `HashIdPreimageSorobanAuthorization`; for a message we hash the bytes
 *     directly.
 *   - The returned `signedTxXdr` / `signedAuthEntry` strings are
 *     base64-encoded JSON containers carrying the assertion. The downstream
 *     Soroban smart-account contract (`__check_auth`) is responsible for
 *     parsing the container, verifying secp256r1, and authorizing.
 *
 *   This separation lets `@veridex/sdk` ship without a hard dependency on
 *   `@stellar/stellar-sdk`. Consumers who want full XDR-aware signing can
 *   subclass and override `hashTransactionXdr` / `hashAuthEntry`.
 */

import { sha256 } from '@noble/hashes/sha256';
import { PasskeyManager } from '../../core/PasskeyManager.js';
import type { PasskeyCredential } from '../../core/PasskeyManager.js';
import { base64URLDecode } from '../../utils.js';
import {
    StellarNetworks,
    type PasskeyAuthAssertion,
    type VeridexStellarConfig,
} from './types.js';
import { deriveSmartAccountId } from './SmartAccount.js';

export interface StellarPasskeySignerOptions {
    passkey: PasskeyManager;
    credential?: PasskeyCredential;
    config?: VeridexStellarConfig;
}

export class StellarPasskeySigner {
    private readonly passkey: PasskeyManager;
    private credential?: PasskeyCredential;
    private readonly network: StellarNetworks;
    private readonly smartAccountContractId?: string;

    constructor(opts: StellarPasskeySignerOptions) {
        this.passkey = opts.passkey;
        this.credential = opts.credential;
        this.network = opts.config?.network ?? StellarNetworks.TESTNET;
        this.smartAccountContractId = opts.config?.smartAccountContractId;
    }

    /**
     * Returns the Soroban smart-account address (C-address-derivable hex)
     * associated with the active passkey. If a fixed contract id was
     * configured we return it verbatim; otherwise we derive deterministically.
     */
    async getAddress(skipRequestAccess = false): Promise<{ address: string }> {
        if (this.smartAccountContractId) {
            return { address: this.smartAccountContractId };
        }
        const cred = await this.ensureCredential(skipRequestAccess);
        const id = deriveSmartAccountId(cred.keyHash, this.network);
        return { address: id };
    }

    /**
     * Produce a SEP-43 `signedTxXdr` for the given transaction envelope XDR.
     *
     * Because we do not bundle `@stellar/stellar-sdk` we hash the XDR's
     * binary form prefixed with the network passphrase. Consumers that need
     * canonical Stellar transaction hashes should preprocess `xdr` to the
     * spec-compliant preimage before calling, or override this method.
     */
    async signTransaction(
        xdr: string,
        opts?: { networkPassphrase?: string; address?: string },
    ): Promise<{ signedTxXdr: string; signerAddress: string }> {
        const cred = await this.ensureCredential(true);
        const passphrase = opts?.networkPassphrase ?? this.network;
        const challenge = this.hashTransactionXdr(xdr, passphrase);
        const assertion = await this.signChallenge(challenge, cred);
        const container = this.encodeAssertionContainer('tx', xdr, assertion);
        const { address } = await this.getAddress(true);
        return { signedTxXdr: container, signerAddress: opts?.address ?? address };
    }

    /**
     * Sign a Soroban `HashIdPreimageSorobanAuthorization` XDR. The auth
     * entry payload is hashed and wrapped identically to a transaction.
     */
    async signAuthEntry(
        authEntry: string,
        opts?: { networkPassphrase?: string; address?: string },
    ): Promise<{ signedAuthEntry: string; signerAddress: string }> {
        const cred = await this.ensureCredential(true);
        const passphrase = opts?.networkPassphrase ?? this.network;
        const challenge = this.hashAuthEntry(authEntry, passphrase);
        const assertion = await this.signChallenge(challenge, cred);
        const container = this.encodeAssertionContainer('auth', authEntry, assertion);
        const { address } = await this.getAddress(true);
        return { signedAuthEntry: container, signerAddress: opts?.address ?? address };
    }

    /**
     * Sign an arbitrary message per SEP-43 `signMessage`.
     */
    async signMessage(
        message: string,
        opts?: { networkPassphrase?: string; address?: string },
    ): Promise<{ signedMessage: string; signerAddress: string }> {
        const cred = await this.ensureCredential(true);
        const challenge = sha256(new TextEncoder().encode(message));
        const assertion = await this.signChallenge(challenge, cred);
        const container = this.encodeAssertionContainer('msg', message, assertion);
        const { address } = await this.getAddress(true);
        return { signedMessage: container, signerAddress: opts?.address ?? address };
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    protected hashTransactionXdr(xdr: string, networkPassphrase: string): Uint8Array {
        const passphraseHash = sha256(new TextEncoder().encode(networkPassphrase));
        const xdrBytes = this.decodeBase64(xdr);
        const buf = new Uint8Array(passphraseHash.length + xdrBytes.length);
        buf.set(passphraseHash, 0);
        buf.set(xdrBytes, passphraseHash.length);
        return sha256(buf);
    }

    protected hashAuthEntry(authEntry: string, networkPassphrase: string): Uint8Array {
        return this.hashTransactionXdr(authEntry, networkPassphrase);
    }

    private async signChallenge(
        challenge: Uint8Array,
        credential: PasskeyCredential,
    ): Promise<PasskeyAuthAssertion> {
        const sig = await this.passkey.sign(challenge);
        return {
            keyHash: credential.keyHash,
            authenticatorData: sig.authenticatorData,
            clientDataJSON: sig.clientDataJSON,
            challengeIndex: sig.challengeIndex,
            typeIndex: sig.typeIndex,
            signatureR: '0x' + sig.r.toString(16).padStart(64, '0'),
            signatureS: '0x' + sig.s.toString(16).padStart(64, '0'),
        };
    }

    private async ensureCredential(skipRequestAccess: boolean): Promise<PasskeyCredential> {
        if (this.credential) return this.credential;
        if (skipRequestAccess) {
            throw new Error(
                'StellarPasskeySigner: no credential cached. Call passkey.authenticate() ' +
                'first or pass `credential` to the constructor.',
            );
        }
        const { credential } = await this.passkey.authenticate();
        this.credential = credential;
        return credential;
    }

    private encodeAssertionContainer(
        kind: 'tx' | 'auth' | 'msg',
        payload: string,
        assertion: PasskeyAuthAssertion,
    ): string {
        const container = {
            v: 1,
            kind,
            payload,
            assertion,
        };
        const json = JSON.stringify(container);
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(json, 'utf8').toString('base64');
        }
        // Browser fallback.
        return btoa(unescape(encodeURIComponent(json)));
    }

    private decodeBase64(input: string): Uint8Array {
        try {
            if (typeof Buffer !== 'undefined') {
                return new Uint8Array(Buffer.from(input, 'base64'));
            }
            const binary = atob(input);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return bytes;
        } catch {
            // Fall back to base64url if standard base64 fails.
            return base64URLDecode(input);
        }
    }
}
