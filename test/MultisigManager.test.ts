/**
 * Veridex Protocol SDK - MultisigManager Tests (ADR-0037)
 *
 * Tests for threshold multisig transaction authorization:
 * - Policy queries and configuration
 * - Direct dispatch guard
 * - Proposal lifecycle (create → approve → execute)
 * - Proposal cancellation
 * - Non-multisig-capable chain detection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    MultisigManager,
    PROTECTED_ACTION,
    DEFAULT_PROTECTED_ACTION_MASK,
    DEFAULT_PROPOSAL_TTL,
    type MultisigPolicy,
    type TransactionProposal,
} from '../src/core/MultisigManager.js';
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

const disabledPolicy: MultisigPolicy = {
    enabled: false,
    threshold: 0,
    protectedActionMask: 0,
    proposalTtl: DEFAULT_PROPOSAL_TTL,
    disableSessions: false,
};

const enabledPolicy: MultisigPolicy = {
    enabled: true,
    threshold: 2,
    protectedActionMask: DEFAULT_PROTECTED_ACTION_MASK,
    proposalTtl: DEFAULT_PROPOSAL_TTL,
    disableSessions: true,
};

const nowSec = BigInt(Math.floor(Date.now() / 1000));

const mockProposal: TransactionProposal = {
    proposalId: 'prop-1',
    identityKeyHash: '0xabc',
    proposerKeyHash: '0xproposer',
    targetChain: 10004,
    actionType: 1,
    actionHash: '0xhash',
    actionPayload: '0x01',
    createdAt: nowSec - 3600n,
    expiresAt: nowSec + 82800n,
    approvalCount: 1,
    requiredThreshold: 2,
    state: 'pending',
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

function createMockMultisigChainClient(
    policy: MultisigPolicy = disabledPolicy,
    proposal: TransactionProposal = mockProposal,
): ChainClient {
    return {
        getConfig: vi.fn(() => ({
            name: 'Base Sepolia',
            wormholeChainId: 10004,
            nativeToken: 'ETH',
        })),
        getNonce: vi.fn(async () => 1n),
        getTransactionPolicy: vi.fn(async () => policy),
        configureTransactionPolicy: vi.fn(async () => ({ receipt: {} })),
        createTransactionProposal: vi.fn(async () => ({
            proposalId: 'prop-1',
            receipt: {},
            sequence: 1n,
        })),
        approveTransactionProposal: vi.fn(async () => ({
            receipt: {},
            approvalCount: 2,
            thresholdReached: true,
        })),
        cancelTransactionProposal: vi.fn(async () => ({ receipt: {} })),
        executeTransactionProposal: vi.fn(async () => ({
            receipt: {},
            sequence: 1n,
        })),
        getTransactionProposal: vi.fn(async () => proposal),
        hasApprovedTransactionProposal: vi.fn(async () => false),
    } as unknown as ChainClient;
}

function createMockNonMultisigChainClient(): ChainClient {
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

describe('MultisigManager', () => {
    let passkey: PasskeyManager;

    beforeEach(() => {
        passkey = createMockPasskey();
    });

    describe('constructor', () => {
        it('throws on non-multisig-capable chains', () => {
            const nonMultisig = createMockNonMultisigChainClient();
            expect(() => new MultisigManager({ passkey, chain: nonMultisig }))
                .toThrow('threshold multisig');
        });

        it('creates successfully with multisig-capable chain', () => {
            const chain = createMockMultisigChainClient();
            const manager = new MultisigManager({ passkey, chain });
            expect(manager).toBeDefined();
        });
    });

    describe('getPolicy', () => {
        it('returns current policy from chain client', async () => {
            const chain = createMockMultisigChainClient(enabledPolicy);
            const manager = new MultisigManager({ passkey, chain });
            const policy = await manager.getPolicy();
            expect(policy.enabled).toBe(true);
            expect(policy.threshold).toBe(2);
        });

        it('returns disabled policy', async () => {
            const chain = createMockMultisigChainClient(disabledPolicy);
            const manager = new MultisigManager({ passkey, chain });
            const policy = await manager.getPolicy();
            expect(policy.enabled).toBe(false);
        });
    });

    describe('assertDirectDispatchAllowed', () => {
        it('does not throw when policy is disabled', async () => {
            const chain = createMockMultisigChainClient(disabledPolicy);
            const manager = new MultisigManager({ passkey, chain });
            await expect(manager.assertDirectDispatchAllowed('transfer')).resolves.toBeUndefined();
        });

        it('throws when action is protected and policy is enabled', async () => {
            const chain = createMockMultisigChainClient(enabledPolicy);
            const manager = new MultisigManager({ passkey, chain });
            await expect(manager.assertDirectDispatchAllowed('transfer'))
                .rejects.toThrow('threshold multisig approval');
        });

        it('does not throw for unprotected actions', async () => {
            const limitedPolicy: MultisigPolicy = {
                ...enabledPolicy,
                protectedActionMask: PROTECTED_ACTION.BRIDGE, // only bridge protected
            };
            const chain = createMockMultisigChainClient(limitedPolicy);
            const manager = new MultisigManager({ passkey, chain });
            await expect(manager.assertDirectDispatchAllowed('transfer')).resolves.toBeUndefined();
        });
    });

    describe('configurePolicy', () => {
        it('throws when threshold < 2', async () => {
            const chain = createMockMultisigChainClient();
            const manager = new MultisigManager({ passkey, chain });
            await expect(manager.configurePolicy({
                signature: mockSignature,
                threshold: 1,
                signer: {},
            })).rejects.toThrow('Threshold must be >= 2');
        });

        it('configures policy via chain client', async () => {
            const chain = createMockMultisigChainClient();
            const manager = new MultisigManager({ passkey, chain });
            await manager.configurePolicy({
                signature: mockSignature,
                threshold: 2,
                signer: {},
            });
            expect((chain as any).configureTransactionPolicy).toHaveBeenCalled();
        });
    });

    describe('createProposal', () => {
        it('throws when no credential is set', async () => {
            const chain = createMockMultisigChainClient(enabledPolicy);
            const noCredPasskey = createMockPasskey(false);
            const manager = new MultisigManager({ passkey: noCredPasskey, chain });
            await expect(manager.createProposal({
                signature: mockSignature,
                actionPayload: '0x01',
                targetChain: 10004,
                signer: {},
            })).rejects.toThrow('No credential');
        });

        it('creates proposal and returns id', async () => {
            const chain = createMockMultisigChainClient(enabledPolicy);
            const manager = new MultisigManager({ passkey, chain });
            const result = await manager.createProposal({
                signature: mockSignature,
                actionPayload: '0x01',
                targetChain: 10004,
                signer: {},
            });
            expect(result.proposalId).toBe('prop-1');
            expect(result.sequence).toBe(1n);
            expect((chain as any).createTransactionProposal).toHaveBeenCalled();
        });
    });

    describe('approveProposal', () => {
        it('approves an existing proposal', async () => {
            const chain = createMockMultisigChainClient(enabledPolicy);
            const manager = new MultisigManager({ passkey, chain });
            const result = await manager.approveProposal({
                signature: mockSignature,
                proposalId: 'prop-1',
                signer: {},
            });
            expect(result.approvalCount).toBe(2);
            expect(result.thresholdReached).toBe(true);
            expect((chain as any).approveTransactionProposal).toHaveBeenCalled();
        });
    });

    describe('cancelProposal', () => {
        it('cancels an existing proposal', async () => {
            const chain = createMockMultisigChainClient(enabledPolicy);
            const manager = new MultisigManager({ passkey, chain });
            await manager.cancelProposal({
                signature: mockSignature,
                proposalId: 'prop-1',
                signer: {},
            });
            expect((chain as any).cancelTransactionProposal).toHaveBeenCalled();
        });
    });

    describe('getProposal', () => {
        it('returns proposal from chain client', async () => {
            const chain = createMockMultisigChainClient(enabledPolicy);
            const manager = new MultisigManager({ passkey, chain });
            const proposal = await manager.getProposal('prop-1');
            expect(proposal).toBeDefined();
            expect(proposal.proposerKeyHash).toBe('0xproposer');
            expect(proposal.state).toBe('pending');
        });
    });

    describe('hasApproved', () => {
        it('checks if a key hash has approved', async () => {
            const chain = createMockMultisigChainClient(enabledPolicy);
            const manager = new MultisigManager({ passkey, chain });
            const result = await manager.hasApproved('prop-1', '0xkeyhash');
            expect(result).toBe(false);
            expect((chain as any).hasApprovedTransactionProposal).toHaveBeenCalledWith('prop-1', '0xkeyhash');
        });
    });

    describe('isProposalExecutable', () => {
        it('returns false when not enough approvals', async () => {
            const chain = createMockMultisigChainClient(enabledPolicy);
            const manager = new MultisigManager({ passkey, chain });
            const result = await manager.isProposalExecutable('prop-1');
            // threshold=2 but approvalCount=1
            expect(result).toBe(false);
        });

        it('returns true when threshold reached and not expired', async () => {
            const readyProposal: TransactionProposal = {
                ...mockProposal,
                approvalCount: 2,
                state: 'approved',
            };
            const chain = createMockMultisigChainClient(enabledPolicy, readyProposal);
            const manager = new MultisigManager({ passkey, chain });
            const result = await manager.isProposalExecutable('prop-1');
            expect(result).toBe(true);
        });

        it('returns false when proposal is executed', async () => {
            const executedProposal: TransactionProposal = {
                ...mockProposal,
                approvalCount: 2,
                state: 'executed',
            };
            const chain = createMockMultisigChainClient(enabledPolicy, executedProposal);
            const manager = new MultisigManager({ passkey, chain });
            const result = await manager.isProposalExecutable('prop-1');
            expect(result).toBe(false);
        });
    });

    describe('PROTECTED_ACTION constants', () => {
        it('has bitmask values', () => {
            expect(PROTECTED_ACTION.TRANSFER).toBe(1);
            expect(PROTECTED_ACTION.EXECUTE).toBe(2);
            expect(PROTECTED_ACTION.BRIDGE).toBe(4);
            expect(PROTECTED_ACTION.CONFIG).toBe(8);
        });

        it('DEFAULT_PROTECTED_ACTION_MASK covers all actions', () => {
            expect(DEFAULT_PROTECTED_ACTION_MASK & PROTECTED_ACTION.TRANSFER).toBeTruthy();
            expect(DEFAULT_PROTECTED_ACTION_MASK & PROTECTED_ACTION.EXECUTE).toBeTruthy();
            expect(DEFAULT_PROTECTED_ACTION_MASK & PROTECTED_ACTION.BRIDGE).toBeTruthy();
            expect(DEFAULT_PROTECTED_ACTION_MASK & PROTECTED_ACTION.CONFIG).toBeTruthy();
        });

        it('DEFAULT_PROPOSAL_TTL is 24 hours', () => {
            expect(DEFAULT_PROPOSAL_TTL).toBe(86_400);
        });
    });
});
