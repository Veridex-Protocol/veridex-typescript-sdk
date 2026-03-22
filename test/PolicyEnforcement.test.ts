/**
 * Veridex Protocol SDK - PolicyEnforcement Tests (ADR-0040)
 *
 * Tests for launch-gate and product boundary enforcement:
 * - Key extraction prevention
 * - Chain capability validation
 * - MetaMask interop claims
 * - Session creation policy
 * - Federated origin validation
 * - Capability matrix builder
 */

import { describe, it, expect } from 'vitest';
import {
    validateNoKeyExtraction,
    validateChainCapability,
    validateMetaMaskInteropClaim,
    validateSessionCreationPolicy,
    validateFederatedOrigin,
    buildCapabilityMatrix,
    PolicyViolationError,
    CHAIN_CAPABILITIES,
} from '../src/core/PolicyEnforcement.js';

describe('PolicyEnforcement', () => {
    // ========================================================================
    // validateNoKeyExtraction
    // ========================================================================

    describe('validateNoKeyExtraction', () => {
        it('throws on exportPrivateKey', () => {
            expect(() => validateNoKeyExtraction('exportPrivateKey')).toThrow(PolicyViolationError);
        });

        it('throws on extractKey', () => {
            expect(() => validateNoKeyExtraction('extractKey')).toThrow(PolicyViolationError);
        });

        it('throws on getMnemonic', () => {
            expect(() => validateNoKeyExtraction('getMnemonic')).toThrow(PolicyViolationError);
        });

        it('throws on getSeedPhrase', () => {
            expect(() => validateNoKeyExtraction('getSeedPhrase')).toThrow(PolicyViolationError);
        });

        it('throws on exportSeed', () => {
            expect(() => validateNoKeyExtraction('exportSeed')).toThrow(PolicyViolationError);
        });

        it('does not throw on safe operations', () => {
            expect(() => validateNoKeyExtraction('getPublicKey')).not.toThrow();
            expect(() => validateNoKeyExtraction('signMessage')).not.toThrow();
            expect(() => validateNoKeyExtraction('verifySignature')).not.toThrow();
        });
    });

    // ========================================================================
    // validateChainCapability
    // ========================================================================

    describe('validateChainCapability', () => {
        it('does not throw for full EVM passkey verification', () => {
            expect(() => validateChainCapability('evm', 'passkeyVerification', 'register')).not.toThrow();
        });

        it('throws for unknown chain type', () => {
            expect(() => validateChainCapability('nonexistent-chain', 'passkeyVerification', 'register'))
                .toThrow(PolicyViolationError);
        });

        it('validates recovery capability on EVM', () => {
            expect(() => validateChainCapability('evm', 'recovery', 'setupGuardians')).not.toThrow();
        });

        it('throws for unsupported capability on chain', () => {
            // Find a chain with an unsupported capability
            const solana = CHAIN_CAPABILITIES['solana'];
            if (solana && solana.recovery === 'unsupported') {
                expect(() => validateChainCapability('solana', 'recovery', 'setupGuardians')).toThrow(PolicyViolationError);
            }
        });
    });

    // ========================================================================
    // validateMetaMaskInteropClaim
    // ========================================================================

    describe('validateMetaMaskInteropClaim', () => {
        it('allows injected-wallet interop type', () => {
            expect(() => validateMetaMaskInteropClaim('injected-wallet')).not.toThrow();
        });

        it('allows smart-account-control interop type', () => {
            expect(() => validateMetaMaskInteropClaim('smart-account-control')).not.toThrow();
        });

        it('allows session-key-delegation interop type', () => {
            expect(() => validateMetaMaskInteropClaim('session-key-delegation')).not.toThrow();
        });

        it('throws on full-custody interop claim', () => {
            expect(() => validateMetaMaskInteropClaim('full-custody')).toThrow(PolicyViolationError);
        });

        it('throws on key-import interop claim', () => {
            expect(() => validateMetaMaskInteropClaim('key-import')).toThrow(PolicyViolationError);
        });
    });

    // ========================================================================
    // validateSessionCreationPolicy
    // ========================================================================

    describe('validateSessionCreationPolicy', () => {
        it('allows session creation when policy disabled', () => {
            expect(() => validateSessionCreationPolicy(false, false)).not.toThrow();
        });

        it('allows session creation when policy enabled but sessions not disabled', () => {
            expect(() => validateSessionCreationPolicy(true, false)).not.toThrow();
        });

        it('throws when multisig policy is active and sessions disabled', () => {
            expect(() => validateSessionCreationPolicy(true, true)).toThrow(PolicyViolationError);
        });
    });

    // ========================================================================
    // validateFederatedOrigin
    // ========================================================================

    describe('validateFederatedOrigin', () => {
        it('allows veridex.network RP ID', () => {
            expect(() => validateFederatedOrigin('veridex.network')).not.toThrow();
        });

        it('allows subdomain of veridex.network', () => {
            expect(() => validateFederatedOrigin('app.veridex.network')).not.toThrow();
        });

        it('allows custom allowed RP IDs', () => {
            expect(() => validateFederatedOrigin('custom.xyz', ['custom.xyz'])).not.toThrow();
        });

        it('throws for unknown RP IDs', () => {
            expect(() => validateFederatedOrigin('malicious-site.com')).toThrow(PolicyViolationError);
        });

        it('throws for empty RP ID', () => {
            expect(() => validateFederatedOrigin('')).toThrow(PolicyViolationError);
        });
    });

    // ========================================================================
    // CHAIN_CAPABILITIES
    // ========================================================================

    describe('CHAIN_CAPABILITIES', () => {
        it('has EVM capabilities', () => {
            expect(CHAIN_CAPABILITIES['evm']).toBeDefined();
            expect(CHAIN_CAPABILITIES['evm']!.passkeyVerification).toBe('full');
        });

        it('has Solana capabilities', () => {
            expect(CHAIN_CAPABILITIES['solana']).toBeDefined();
        });

        it('has Aptos capabilities', () => {
            expect(CHAIN_CAPABILITIES['aptos']).toBeDefined();
        });

        it('has Sui capabilities', () => {
            expect(CHAIN_CAPABILITIES['sui']).toBeDefined();
        });
    });

    // ========================================================================
    // buildCapabilityMatrix
    // ========================================================================

    describe('buildCapabilityMatrix', () => {
        const fullPlatform = {
            webauthnSupported: true,
            conditionalUISupported: true,
            platformAuthenticatorAvailable: true,
        };

        const noPlatform = {
            webauthnSupported: false,
            conditionalUISupported: false,
            platformAuthenticatorAvailable: false,
        };

        it('builds matrix for EVM with full capabilities', () => {
            const matrix = buildCapabilityMatrix('evm', fullPlatform, true);
            expect(matrix.webauthnSupported).toBe(true);
            expect(matrix.features.passkeyAuth).toBe(true);
            expect(matrix.features.gaslessTransactions).toBe(true);
        });

        it('builds matrix without relayer', () => {
            const matrix = buildCapabilityMatrix('evm', fullPlatform, false);
            expect(matrix.features.gaslessTransactions).toBe(false);
        });

        it('builds matrix without WebAuthn support', () => {
            const matrix = buildCapabilityMatrix('evm', noPlatform, false);
            expect(matrix.webauthnSupported).toBe(false);
            expect(matrix.features.passkeyAuth).toBe(false);
        });

        it('falls back to EVM for unknown chain types', () => {
            const matrix = buildCapabilityMatrix('unknown-chain', fullPlatform, false);
            // Should use EVM as fallback
            expect(matrix.chainCapabilities).toBeDefined();
        });

        it('reports chain capabilities accurately', () => {
            const matrix = buildCapabilityMatrix('evm', fullPlatform, false);
            expect(matrix.chainCapabilities.passkeyVerification).toBe('full');
            expect(matrix.chainCapabilities.recovery).toBe('full');
        });
    });

    // ========================================================================
    // PolicyViolationError
    // ========================================================================

    describe('PolicyViolationError', () => {
        it('has code and message', () => {
            const err = new PolicyViolationError('test', 'NON_EXTRACTABLE_CREDENTIAL');
            expect(err.message).toBe('test');
            expect(err.code).toBe('NON_EXTRACTABLE_CREDENTIAL');
            expect(err).toBeInstanceOf(Error);
            expect(err).toBeInstanceOf(PolicyViolationError);
        });
    });
});
