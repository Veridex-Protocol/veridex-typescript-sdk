/**
 * Veridex Protocol SDK — Stellar-Wallets-Kit ModuleInterface implementation
 *
 * Drop-in module for `@creit.tech/stellar-wallets-kit` that exposes
 * Veridex's passkey-backed Soroban smart account as a wallet option.
 *
 * Usage (downstream app):
 * ```ts
 * import { StellarWalletsKit, allowAllModules } from '@creit.tech/stellar-wallets-kit';
 * import { PasskeyManager } from '@veridex/sdk/passkey';
 * import { VeridexStellarWalletModule } from '@veridex/sdk/chains/stellar';
 *
 * const passkey = new PasskeyManager({ rpName: 'My Dapp' });
 * const veridexModule = new VeridexStellarWalletModule({ passkey });
 *
 * const kit = new StellarWalletsKit({
 *   network: WalletNetwork.TESTNET,
 *   selectedWalletId: VERIDEX_PASSKEY_ID,
 *   modules: [...allowAllModules(), veridexModule],
 * });
 * ```
 */

import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { PasskeyManager } from '../../core/PasskeyManager.js';
import type { PasskeyCredential } from '../../core/PasskeyManager.js';
import { StellarPasskeySigner } from './StellarPasskeySigner.js';
import {
    StellarModuleType,
    StellarNetworks,
    type StellarWalletModuleInterface,
    type VeridexStellarConfig,
} from './types.js';

export const VERIDEX_PASSKEY_ID = 'veridex-passkey';

export interface VeridexStellarWalletModuleOptions {
    passkey: PasskeyManager;
    credential?: PasskeyCredential;
    config?: VeridexStellarConfig;
    productName?: string;
    productUrl?: string;
    productIcon?: string;
}

export class VeridexStellarWalletModule implements StellarWalletModuleInterface {
    readonly moduleType: StellarModuleType = StellarModuleType.HOT_WALLET;
    readonly productId: string = VERIDEX_PASSKEY_ID;
    readonly productName: string;
    readonly productUrl: string;
    readonly productIcon: string;

    private readonly signer: StellarPasskeySigner;

    constructor(opts: VeridexStellarWalletModuleOptions) {
        this.signer = new StellarPasskeySigner({
            passkey: opts.passkey,
            credential: opts.credential,
            config: opts.config,
        });
        this.productName = opts.productName ?? 'Veridex Passkey';
        this.productUrl = opts.productUrl ?? 'https://veridex.network';
        this.productIcon =
            opts.productIcon ??
            'https://veridex.network/icons/passkey-256.png';
    }

    async isAvailable(): Promise<boolean> {
        try {
            return browserSupportsWebAuthn();
        } catch {
            return false;
        }
    }

    async isPlatformWrapper(): Promise<boolean> {
        return false;
    }

    async getAddress(params?: {
        path?: string;
        skipRequestAccess?: boolean;
    }): Promise<{ address: string }> {
        return this.signer.getAddress(params?.skipRequestAccess);
    }

    async signTransaction(
        xdr: string,
        opts?: { networkPassphrase?: string; address?: string; path?: string },
    ): Promise<{ signedTxXdr: string; signerAddress?: string }> {
        return this.signer.signTransaction(xdr, {
            networkPassphrase: opts?.networkPassphrase,
            address: opts?.address,
        });
    }

    async signAuthEntry(
        authEntry: string,
        opts?: { networkPassphrase?: string; address?: string; path?: string },
    ): Promise<{ signedAuthEntry: string; signerAddress?: string }> {
        return this.signer.signAuthEntry(authEntry, {
            networkPassphrase: opts?.networkPassphrase,
            address: opts?.address,
        });
    }

    async signMessage(
        message: string,
        opts?: { networkPassphrase?: string; address?: string; path?: string },
    ): Promise<{ signedMessage: string; signerAddress?: string }> {
        return this.signer.signMessage(message, {
            networkPassphrase: opts?.networkPassphrase,
            address: opts?.address,
        });
    }
}

export { StellarNetworks };
