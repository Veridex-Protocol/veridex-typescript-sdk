/**
 * Veridex Protocol SDK - RecoveryManager Tests
 *
 * Tests for guardian recovery orchestration:
 * - Readiness checks
 * - Guardian management (setup)
 * - Recovery lifecycle (initiate → approve → execute)
 * - Cancellation
 * - Non-recovery-capable chain detection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecoveryManager } from '../src/core/RecoveryManager.js';
import type { PasskeyManager } from '../src/core/PasskeyManager.js';
import type { ChainClient, WebAuthnSignature } from '../src/core/types.js';

// ============================================================================
// Mock Data
// ============================================================================

const mockSignature: WebAuthnSignature = {
    authenticatorData: '0x00',
    clientDataJSON: '{}',
    challengeIndex: 0,
    typeIndex: 0,
    r: 1n,
    s: 2n,
};

// ============================================================================
// Mock Factories
// ============================================================================

function createMockPasskey(hasCredential = true): PasskeyManager {
    return {
        getCredential: vi.fn(() => hasCredential ? ({
            credentialId: 'cred-123',
            publicKeyX: 1n,
            publicKeyY: 2n,
            keyHash: '0xabc',
        }) : null),
        sign: vi.fn(async () => mockSignature),
    } as unknown as PasskeyManager;
}

function createMockRecoveryChainClient(
    overrides: Record<string, unknown> = {},
): ChainClient {
    return {
        getConfig: vi.fn(() => ({
            name: 'Base Sepolia',
            wormholeChainId: 10004,
            nativeToken: 'ETH',
        })),
        getNonce: vi.fn(async () => 1n),
        getGuardians: vi.fn(async () => ({
            guardians: ['0xg1', '0xg2'],
            threshold: 2n,
            isConfigured: true,
        })),
        getRecoveryStatus: vi.fn(async () => ({
            isActive: false,
            newOwnerKeyHash: '0x0',
            initiatedAt: 0n,
            approvalCount: 0n,
            threshold: 2n,
            canExecuteAt: 0n,
            expiresAt: 0n,
        })),
        hasGuardianApproved: vi.fn(async () => false),
        setupGuardians: vi.fn(async () => ({ receipt: {}, sequence: 1n })),
        addGuardian: vi.fn(async () => ({ receipt: {}, sequence: 2n })),
        removeGuardian: vi.fn(async () => ({ receipt: {}, sequence: 3n })),
        initiateRecovery: vi.fn(async () => ({ receipt: {}, sequence: 4n })),
        approveRecovery: vi.fn(async () => ({ receipt: {}, sequence: 5n })),
        executeRecovery: vi.fn(async () => ({ receipt: {}, sequence: 6n })),
        cancelRecovery: vi.fn(async () => ({ receipt: {}, sequence: 7n })),
        ...overrides,
    } as unknown as ChainClient;
}

function createMockNonRecoveryChainClient(): ChainClient {
    return {
        getConfig: vi.fn(() => ({
            name: 'Solana',
            wormholeChainId: 1,
            nativeToken: 'SOL',
        })),
        getNonce: vi.fn(async () => 1n),
    } as unknown as ChainClient;
}

// ============================================================================
// Tests
// ============================================================================

describe('RecoveryManager', () => {
    let passkey: PasskeyManager;
    let chain: ChainClient;
    let manager: RecoveryManager;

    beforeEach(() => {
        passkey = createMockPasskey();
        chain = createMockRecoveryChainClient();
        manager = new RecoveryManager({ passkey, chain });
    });

    describe('constructor', () => {
        it('throws on non-recovery-capable chains', () => {
            const nonRecoveryChain = createMockNonRecoveryChainClient();
            expect(() => new RecoveryManager({ passkey, chain: nonRecoveryChain }))
                .toThrow('RecoveryManager requires a chain client');
        });

        it('creates successfully with recovery-capable chain', () => {
            expect(manager).toBeDefined();
        });
    });

    describe('getReadiness', () => {
        it('returns readiness with guardian count and threshold', async () => {
            const readiness = await manager.getReadiness();
            expect(readiness.guardianCount).toBe(2);
            expect(readiness.threshold).toBe(2n);
            expect(readiness.guardiansConfigured).toBe(true);
            expect(readiness.recoveryInProgress).toBe(false);
        });

        it('reports not configured when no guardians', async () => {
            chain = createMockRecoveryChainClient({
                getGuardians: vi.fn(async () => ({
                    guardians: [],
                    threshold: 0n,
                    isConfigured: false,
                })),
            });
            manager = new RecoveryManager({ passkey, chain });
            const readiness = await manager.getReadiness();
            expect(readiness.guardiansConfigured).toBe(false);
            expect(readiness.guardianCount).toBe(0);
        });
    });

    describe('getGuardians', () => {
        it('returns guardian data from chain client', async () => {
            const result = await manager.getGuardians();
            expect(result.guardians).toEqual(['0xg1', '0xg2']);
            expect(result.isConfigured).toBe(true);
        });
    });

    describe('getRecoveryStatus', () => {
        it('returns inactive recovery status', async () => {
            const status = await manager.getRecoveryStatus();
            expect(status.isActive).toBe(false);
            expect(status.approvalCount).toBe(0n);
        });

        it('returns active recovery status', async () => {
            chain = createMockRecoveryChainClient({
                getRecoveryStatus: vi.fn(async () => ({
                    isActive: true,
                    newOwnerKeyHash: '0xnewowner',
                    initiatedAt: BigInt(Math.floor(Date.now() / 1000) - 3600),
                    approvalCount: 1n,
                    threshold: 2n,
                    canExecuteAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
                    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 86400),
                })),
            });
            manager = new RecoveryManager({ passkey, chain });
            const status = await manager.getRecoveryStatus();
            expect(status.isActive).toBe(true);
            expect(status.newOwnerKeyHash).toBe('0xnewowner');
        });
    });

    describe('setupGuardians', () => {
        it('throws when no credential is set', async () => {
            const noCredPasskey = createMockPasskey(false);
            const mgr = new RecoveryManager({ passkey: noCredPasskey, chain });
            await expect(mgr.setupGuardians({
                signature: mockSignature,
                guardians: ['0xg1'],
                threshold: 1,
                signer: {},
            })).rejects.toThrow();
        });

        it('throws on invalid threshold', async () => {
            await expect(manager.setupGuardians({
                signature: mockSignature,
                guardians: ['0xg1', '0xg2'],
                threshold: 3, // > guardian count
                signer: {},
            })).rejects.toThrow('Invalid threshold');
        });

        it('calls chain client with correct params', async () => {
            const result = await manager.setupGuardians({
                signature: mockSignature,
                guardians: ['0xg1', '0xg2'],
                threshold: 2,
                signer: {},
            });
            expect(result.sequence).toBe(1n);
            expect((chain as any).setupGuardians).toHaveBeenCalled();
        });
    });

    describe('hasGuardianApproved', () => {
        it('delegates to chain client', async () => {
            const result = await manager.hasGuardianApproved('0xidentity', '0xguardian1');
            expect(result).toBe(false);
            expect((chain as any).hasGuardianApproved).toHaveBeenCalledWith('0xidentity', '0xguardian1');
        });
    });

    describe('initiateRecovery', () => {
        it('throws when no credential is set', async () => {
            const noCredPasskey = createMockPasskey(false);
            const mgr = new RecoveryManager({ passkey: noCredPasskey, chain });
            await expect(mgr.initiateRecovery({
                signature: mockSignature,
                identityToRecover: '0xidentity',
                newOwnerKeyHash: '0xnew',
                signer: {},
            })).rejects.toThrow();
        });

        it('initiates recovery via chain client', async () => {
            const result = await manager.initiateRecovery({
                signature: mockSignature,
                identityToRecover: '0xidentity',
                newOwnerKeyHash: '0xnew',
                signer: {},
            });
            expect(result.sequence).toBe(4n);
            expect((chain as any).initiateRecovery).toHaveBeenCalled();
        });
    });

    describe('cancelRecovery', () => {
        it('cancels active recovery', async () => {
            const result = await manager.cancelRecovery({
                signature: mockSignature,
                signer: {},
            });
            expect(result.sequence).toBe(7n);
            expect((chain as any).cancelRecovery).toHaveBeenCalled();
        });
    });

    describe('executeRecovery', () => {
        it('executes recovery with new owner keys', async () => {
            const result = await manager.executeRecovery({
                identityToRecover: '0xidentity',
                newPublicKeyX: 10n,
                newPublicKeyY: 20n,
                signer: {},
            });
            expect(result.sequence).toBe(6n);
            expect((chain as any).executeRecovery).toHaveBeenCalled();
        });
    });
});
