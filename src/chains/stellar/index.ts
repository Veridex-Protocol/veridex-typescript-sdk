/**
 * Veridex Protocol SDK — Stellar chain module
 *
 * Provides:
 *   - `StellarPasskeySigner`: SEP-43-compatible passkey signer
 *   - `VeridexStellarWalletModule`: Stellar-Wallets-Kit `ModuleInterface`
 *   - `deriveSmartAccountId`: deterministic Soroban smart-account derivation
 */

export { StellarPasskeySigner } from './StellarPasskeySigner.js';
export type { StellarPasskeySignerOptions } from './StellarPasskeySigner.js';

export {
    VeridexStellarWalletModule,
    VERIDEX_PASSKEY_ID,
    StellarNetworks,
} from './VeridexStellarWalletModule.js';
export type { VeridexStellarWalletModuleOptions } from './VeridexStellarWalletModule.js';

export { deriveSmartAccountId } from './SmartAccount.js';

export {
    StellarModuleType,
} from './types.js';
export type {
    StellarWalletModuleInterface,
    StellarKitError,
    VeridexStellarConfig,
    PasskeyAuthAssertion,
} from './types.js';
