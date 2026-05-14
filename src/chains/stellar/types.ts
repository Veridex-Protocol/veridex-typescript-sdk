/**
 * Veridex Protocol SDK — Stellar chain types
 *
 * Local mirror of the subset of the Stellar-Wallets-Kit `ModuleInterface`
 * contract we implement. We mirror it (rather than importing from
 * `@creit.tech/stellar-wallets-kit`) so `@veridex/sdk` does not gain a hard
 * peer dependency on the kit. Consumers who already depend on the kit can
 * cast our module to the upstream type — the shapes are structurally
 * identical.
 *
 * Upstream reference: `@creit.tech/stellar-wallets-kit` →
 *   src/types/mod.ts → `ModuleInterface`
 */

export enum StellarNetworks {
    PUBLIC = 'Public Global Stellar Network ; September 2015',
    TESTNET = 'Test SDF Network ; September 2015',
    FUTURENET = 'Test SDF Future Network ; October 2022',
    SANDBOX = 'Local Sandbox Stellar Network ; September 2022',
    STANDALONE = 'Standalone Network ; February 2017',
}

export enum StellarModuleType {
    HW_WALLET = 'HW_WALLET',
    HOT_WALLET = 'HOT_WALLET',
    BRIDGE_WALLET = 'BRIDGE_WALLET',
    AIR_GAPED_WALLET = 'AIR_GAPED_WALLET',
}

export interface StellarKitError {
    code: number;
    message: string;
    ext?: string;
}

/**
 * Stellar-Wallets-Kit `ModuleInterface` mirror.
 * Only the methods we implement are documented; signature-compatible with
 * the upstream contract.
 */
export interface StellarWalletModuleInterface {
    moduleType: StellarModuleType;
    productId: string;
    productName: string;
    productUrl: string;
    productIcon: string;

    isAvailable(): Promise<boolean>;
    isPlatformWrapper?(): Promise<boolean>;

    getAddress(params?: {
        path?: string;
        skipRequestAccess?: boolean;
    }): Promise<{ address: string }>;

    signTransaction(
        xdr: string,
        opts?: {
            networkPassphrase?: string;
            address?: string;
            path?: string;
        },
    ): Promise<{ signedTxXdr: string; signerAddress?: string }>;

    signAuthEntry(
        authEntry: string,
        opts?: {
            networkPassphrase?: string;
            address?: string;
            path?: string;
        },
    ): Promise<{ signedAuthEntry: string; signerAddress?: string }>;

    signMessage(
        message: string,
        opts?: {
            networkPassphrase?: string;
            address?: string;
            path?: string;
        },
    ): Promise<{ signedMessage: string; signerAddress?: string }>;
}

/**
 * Veridex-specific configuration for the Stellar passkey signer.
 */
export interface VeridexStellarConfig {
    /** Stellar network passphrase. Defaults to TESTNET. */
    network?: StellarNetworks;
    /**
     * Soroban RPC URL (used to resolve the smart-account address or submit
     * transactions when `signAndSubmitTransaction` is invoked).
     */
    rpcUrl?: string;
    /**
     * Optional pre-deployed smart-account contract id (C-address). If
     * provided, `getAddress()` returns this directly. Otherwise the address
     * is derived deterministically from the passkey `keyHash`.
     */
    smartAccountContractId?: string;
    /**
     * Override the deterministic smart-account factory contract. Used for
     * address derivation when `smartAccountContractId` is not set.
     */
    smartAccountFactory?: string;
}

/**
 * A signed WebAuthn assertion ready to be embedded in a Soroban auth entry.
 *
 * The shape matches what a Soroban smart-account's `__check_auth` entrypoint
 * needs to verify a secp256r1 passkey signature:
 *   - `keyHash` identifies which registered passkey signed
 *   - `authenticatorData` + `clientDataJSON` are the WebAuthn assertion
 *   - `r`, `s` are the secp256r1 signature components
 */
export interface PasskeyAuthAssertion {
    keyHash: string;
    authenticatorData: string;
    clientDataJSON: string;
    challengeIndex: number;
    typeIndex: number;
    signatureR: string;
    signatureS: string;
}
