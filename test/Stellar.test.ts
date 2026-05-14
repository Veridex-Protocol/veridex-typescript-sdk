/**
 * Smoke tests for the Stellar chain adapter.
 * Validates the synchronous, dependency-free surfaces:
 *   - smart-account address derivation is deterministic and well-formed
 *   - VeridexStellarWalletModule exposes the ModuleInterface shape
 */

import { describe, it, expect } from 'vitest';
import {
    deriveSmartAccountId,
    StellarModuleType,
    StellarNetworks,
    VERIDEX_PASSKEY_ID,
    VeridexStellarWalletModule,
} from '../src/chains/stellar/index.js';
import type { StellarWalletModuleInterface } from '../src/chains/stellar/index.js';
import { PasskeyManager } from '../src/core/PasskeyManager.js';

const SAMPLE_KEY_HASH =
    '0x1122334455667788990011223344556677889900112233445566778899001122';

describe('chains/stellar :: deriveSmartAccountId', () => {
    it('is deterministic for identical inputs', () => {
        const a = deriveSmartAccountId(SAMPLE_KEY_HASH, StellarNetworks.TESTNET);
        const b = deriveSmartAccountId(SAMPLE_KEY_HASH, StellarNetworks.TESTNET);
        expect(a).toBe(b);
        expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('differs across networks', () => {
        const test = deriveSmartAccountId(SAMPLE_KEY_HASH, StellarNetworks.TESTNET);
        const pub = deriveSmartAccountId(SAMPLE_KEY_HASH, StellarNetworks.PUBLIC);
        expect(test).not.toBe(pub);
    });

    it('differs across key hashes', () => {
        const a = deriveSmartAccountId(SAMPLE_KEY_HASH, StellarNetworks.TESTNET);
        const b = deriveSmartAccountId(
            '0x' + 'aa'.repeat(32),
            StellarNetworks.TESTNET,
        );
        expect(a).not.toBe(b);
    });

    it('respects salt', () => {
        const a = deriveSmartAccountId(SAMPLE_KEY_HASH, StellarNetworks.TESTNET);
        const b = deriveSmartAccountId(
            SAMPLE_KEY_HASH,
            StellarNetworks.TESTNET,
            '0x' + 'ff'.repeat(32),
        );
        expect(a).not.toBe(b);
    });

    it('rejects malformed key hashes', () => {
        expect(() => deriveSmartAccountId('0xdeadbeef', StellarNetworks.TESTNET)).toThrow();
    });
});

describe('chains/stellar :: VeridexStellarWalletModule', () => {
    it('matches the ModuleInterface contract', () => {
        const passkey = new PasskeyManager({ rpName: 'test' });
        const mod: StellarWalletModuleInterface = new VeridexStellarWalletModule({
            passkey,
        });

        expect(mod.moduleType).toBe(StellarModuleType.HOT_WALLET);
        expect(mod.productId).toBe(VERIDEX_PASSKEY_ID);
        expect(typeof mod.productName).toBe('string');
        expect(typeof mod.productUrl).toBe('string');
        expect(typeof mod.productIcon).toBe('string');
        expect(typeof mod.isAvailable).toBe('function');
        expect(typeof mod.getAddress).toBe('function');
        expect(typeof mod.signTransaction).toBe('function');
        expect(typeof mod.signAuthEntry).toBe('function');
        expect(typeof mod.signMessage).toBe('function');
    });

    it('returns the configured smart-account contract id when provided', async () => {
        const passkey = new PasskeyManager({ rpName: 'test' });
        const fixed = 'CFIXED_SMART_ACCOUNT_ID';
        const mod = new VeridexStellarWalletModule({
            passkey,
            config: { smartAccountContractId: fixed },
        });
        const { address } = await mod.getAddress({ skipRequestAccess: true });
        expect(address).toBe(fixed);
    });

    it('reports unavailable in non-browser environments', async () => {
        const passkey = new PasskeyManager({ rpName: 'test' });
        const mod = new VeridexStellarWalletModule({ passkey });
        // Vitest default environment is node; WebAuthn should be unavailable.
        await expect(mod.isAvailable()).resolves.toBe(false);
        await expect(mod.isPlatformWrapper()).resolves.toBe(false);
    });
});
