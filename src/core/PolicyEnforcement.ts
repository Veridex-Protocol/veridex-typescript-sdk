/**
 * Veridex Protocol SDK — Launch Gate & Policy Enforcement (ADR-0040)
 *
 * Runtime validation layer that enforces the product boundaries defined in
 * ADR-0040 across the SDK surface.  Every SDK operation that touches
 * credentials, sessions, or dispatch is funnelled through this module's
 * `validate*` helpers to catch violations early with clear developer errors.
 *
 * Non-negotiables enforced here:
 *
 *   1. Passkeys are non-extractable.  No API may expose private-key material.
 *   2. Self-custody is preserved.  The SDK never constructs or transmits
 *      private keys.
 *   3. Cross-site passkey reuse is scoped to the Veridex RP federation model.
 *   4. Cross-ecosystem portability requires explicit credential registration.
 *   5. MetaMask interop is limited to smart-account / injected-wallet flows.
 *   6. Chain parity claims require real cryptographic verification.
 *
 * Additionally this module exposes a lightweight **CapabilityMatrix** that
 * integrators can use to understand what is available on a given platform,
 * browser, and chain combination — preventing false assumptions at the UI
 * level.
 *
 * @module PolicyEnforcement
 */

// ============================================================================
// Product boundary constants
// ============================================================================

/**
 * Capability tiers per chain type — used to gate SDK features at runtime.
 */
export type ChainCapabilityTier = 'full' | 'partial' | 'unsupported';

export interface ChainCapabilities {
    /** WebAuthn P-256 verification on-chain */
    passkeyVerification: ChainCapabilityTier;
    /** On-chain session key registration and validation */
    sessionKeys: ChainCapabilityTier;
    /** Guardian recovery initiation, approval, execution */
    recovery: ChainCapabilityTier;
    /** Threshold multisig (ADR-0037) */
    multisig: ChainCapabilityTier;
    /** Cross-chain VAA reception (Wormhole spoke) */
    crossChainReceive: ChainCapabilityTier;
}

/**
 * Canonical capability definitions per chain type.
 * These are validated before claiming "supported" status.
 */
export const CHAIN_CAPABILITIES: Record<string, ChainCapabilities> = {
    evm: {
        passkeyVerification: 'full',
        sessionKeys: 'full',
        recovery: 'full',
        multisig: 'full',
        crossChainReceive: 'full',
    },
    avalanche: {
        passkeyVerification: 'full', // ACP-204 native P-256
        sessionKeys: 'full',
        recovery: 'full',
        multisig: 'full',
        crossChainReceive: 'full',
    },
    solana: {
        passkeyVerification: 'partial', // via precompile / verifier program
        sessionKeys: 'partial',
        recovery: 'unsupported',
        multisig: 'unsupported',
        crossChainReceive: 'full',
    },
    aptos: {
        passkeyVerification: 'partial',
        sessionKeys: 'partial',
        recovery: 'unsupported',
        multisig: 'unsupported',
        crossChainReceive: 'full',
    },
    sui: {
        passkeyVerification: 'partial',
        sessionKeys: 'partial',
        recovery: 'unsupported',
        multisig: 'unsupported',
        crossChainReceive: 'full',
    },
    starknet: {
        passkeyVerification: 'partial',
        sessionKeys: 'unsupported',
        recovery: 'unsupported',
        multisig: 'unsupported',
        crossChainReceive: 'partial',
    },
    stacks: {
        passkeyVerification: 'partial',
        sessionKeys: 'partial',
        recovery: 'unsupported',
        multisig: 'unsupported',
        crossChainReceive: 'partial',
    },
};

// ============================================================================
// Validation helpers
// ============================================================================

/**
 * Prevent any code path that would attempt to export or derive private keys
 * from passkey material (ADR-0040, Non-Negotiable #1).
 */
export function validateNoKeyExtraction(operation: string): void {
    const forbidden = [
        'exportPrivateKey', 'derivePrivateKey', 'getMnemonic',
        'getSeedPhrase', 'getKeystore', 'extractKey',
        'exportSeed', 'deriveSeed', 'getEntropy',
    ];
    const lower = operation.toLowerCase();
    for (const keyword of forbidden) {
        if (lower.includes(keyword.toLowerCase())) {
            throw new PolicyViolationError(
                `Operation "${operation}" violates Veridex security policy: ` +
                'passkey credentials are non-extractable WebAuthn keys and cannot be ' +
                'exported as private keys, mnemonics, or keystore files.',
                'NON_EXTRACTABLE_CREDENTIAL',
            );
        }
    }
}

/**
 * Validate that a chain has real (not placeholder) support for a capability
 * before claiming it is available (ADR-0040, Non-Negotiable #6).
 */
export function validateChainCapability(
    chainType: string,
    capability: keyof ChainCapabilities,
    operation: string,
): void {
    const caps = CHAIN_CAPABILITIES[chainType];
    if (!caps) {
        throw new PolicyViolationError(
            `Unknown chain type "${chainType}" — cannot validate capability "${capability}" ` +
            `for operation "${operation}".`,
            'UNKNOWN_CHAIN_TYPE',
        );
    }

    const tier = caps[capability];
    if (tier === 'unsupported') {
        throw new PolicyViolationError(
            `Chain type "${chainType}" does not support "${capability}". ` +
            `Operation "${operation}" is not available on this chain.`,
            'UNSUPPORTED_CAPABILITY',
        );
    }
}

/**
 * Validate that MetaMask interop claims are limited to the smart-account
 * execution path (ADR-0040, Non-Negotiable #5).
 */
export function validateMetaMaskInteropClaim(interopType: string): void {
    const allowed = [
        'injected-wallet',
        'smart-account-control',
        'session-key-delegation',
        'companion-wallet',
        'funding-deposit',
    ];
    if (!allowed.includes(interopType)) {
        throw new PolicyViolationError(
            `MetaMask interop type "${interopType}" is not supported. ` +
            `Allowed types: ${allowed.join(', ')}. ` +
            'Native passkey import into MetaMask is not yet available.',
            'UNSUPPORTED_METAMASK_INTEROP',
        );
    }
}

/**
 * Validate that session creation is allowed for the given identity's
 * multisig policy state (ADR-0037 §9).
 */
export function validateSessionCreationPolicy(
    policyEnabled: boolean,
    sessionsDisabled: boolean,
): void {
    if (policyEnabled && sessionsDisabled) {
        throw new PolicyViolationError(
            'Session key creation is disabled for this identity because a threshold ' +
            'multisig policy is active with disableSessions=true. ' +
            'Use the proposal workflow instead.',
            'SESSIONS_DISABLED_BY_POLICY',
        );
    }
}

/**
 * Validate that cross-site passkey reuse is within the Veridex federation
 * model (ADR-0040, Non-Negotiable #3).
 */
export function validateFederatedOrigin(
    rpId: string,
    allowedRpIds: string[] = ['veridex.network'],
): void {
    const isAllowed = allowedRpIds.some(
        allowed => rpId === allowed || rpId.endsWith('.' + allowed),
    );
    if (!isAllowed) {
        throw new PolicyViolationError(
            `Origin RP ID "${rpId}" is not part of the Veridex federation model. ` +
            'Cross-site passkey reuse requires federation via Related Origin Requests ' +
            'or the Auth Portal fallback.',
            'UNFEDERATED_ORIGIN',
        );
    }
}

// ============================================================================
// Capability matrix for integrator UX
// ============================================================================

export interface PlatformCapabilityMatrix {
    /** Whether passkeys (WebAuthn) are supported on this platform */
    webauthnSupported: boolean;
    /** Whether conditional UI (autofill) is available */
    conditionalUISupported: boolean;
    /** Whether platform authenticators are available (Touch ID, Face ID, etc.) */
    platformAuthenticatorAvailable: boolean;
    /** Chain-specific capabilities */
    chainCapabilities: ChainCapabilities;
    /** Feature set available for the current configuration */
    features: {
        passkeyAuth: boolean;
        sessionKeys: boolean;
        socialRecovery: boolean;
        thresholdMultisig: boolean;
        crossChainBridge: boolean;
        injectedWalletInterop: boolean;
        gaslessTransactions: boolean;
    };
}

/**
 * Build a capability matrix for the current platform and chain configuration.
 * Used by integrator UIs to show/hide features appropriately.
 */
export function buildCapabilityMatrix(
    chainType: string,
    platformInfo: {
        webauthnSupported: boolean;
        conditionalUISupported: boolean;
        platformAuthenticatorAvailable: boolean;
    },
    hasRelayer: boolean,
): PlatformCapabilityMatrix {
    const caps = CHAIN_CAPABILITIES[chainType] ?? CHAIN_CAPABILITIES['evm']!;

    return {
        webauthnSupported: platformInfo.webauthnSupported,
        conditionalUISupported: platformInfo.conditionalUISupported,
        platformAuthenticatorAvailable: platformInfo.platformAuthenticatorAvailable,
        chainCapabilities: caps,
        features: {
            passkeyAuth: platformInfo.webauthnSupported && caps.passkeyVerification !== 'unsupported',
            sessionKeys: caps.sessionKeys === 'full',
            socialRecovery: caps.recovery === 'full',
            thresholdMultisig: caps.multisig === 'full',
            crossChainBridge: caps.crossChainReceive !== 'unsupported',
            injectedWalletInterop: typeof globalThis !== 'undefined' && 'ethereum' in (globalThis as Record<string, unknown>),
            gaslessTransactions: hasRelayer,
        },
    };
}

// ============================================================================
// Error type
// ============================================================================

export type PolicyViolationCode =
    | 'NON_EXTRACTABLE_CREDENTIAL'
    | 'UNKNOWN_CHAIN_TYPE'
    | 'UNSUPPORTED_CAPABILITY'
    | 'UNSUPPORTED_METAMASK_INTEROP'
    | 'SESSIONS_DISABLED_BY_POLICY'
    | 'UNFEDERATED_ORIGIN';

export class PolicyViolationError extends Error {
    public readonly code: PolicyViolationCode;

    constructor(message: string, code: PolicyViolationCode) {
        super(message);
        this.name = 'PolicyViolationError';
        this.code = code;
    }
}
