/**
 * Veridex Protocol SDK — Multisig Manager (ADR-0037)
 *
 * Implements the SDK surface for **threshold multisig transaction authorization**.
 *
 * Architecture summary (from ADR-0037):
 * ─────────────────────────────────────
 *  • A per-identity **TransactionPolicy** on the Hub defines whether threshold
 *    approval is required.  When `policy.enabled === true`, direct dispatch of
 *    protected actions (transfer, execute, bridge, config) reverts on-chain.
 *  • Instead, an authorized key **creates a proposal**.  Other authorized keys
 *    **approve** it.  Once `approvalCount >= threshold`, anyone may **execute** it.
 *  • Sessions are disabled for threshold-governed identities in Phase 1.
 *  • Proposals expire after `proposalTtl`.
 *  • Execution emits a Wormhole VAA wrapping the inner action
 *    (ACTION_EXECUTE_MULTISIG = 14).
 *
 * This manager exposes:
 *   1. Policy configuration & queries
 *   2. Proposal lifecycle (create / approve / cancel / execute / query)
 *   3. Convenience proposal creators for transfer, execute, bridge
 *   4. Policy-aware guard for direct dispatch (`assertDirectDispatchAllowed`)
 *
 * @module MultisigManager
 */

import type { PasskeyManager } from './PasskeyManager.js';
import type {
    ChainClient,
    WebAuthnSignature,
    TransferParams,
    ExecuteParams,
    BridgeParams,
    DispatchResult,
} from './types.js';

// ============================================================================
// Multisig types (ADR-0037 §3, §4, §11)
// ============================================================================

/** Phase 1 action type bitmask values (ADR-0037 §2) */
export const PROTECTED_ACTION = {
    TRANSFER: 1 << 0,
    EXECUTE:  1 << 1,
    BRIDGE:   1 << 2,
    CONFIG:   1 << 3,
} as const;

/** Default protected-action mask covering all sensitive operations */
export const DEFAULT_PROTECTED_ACTION_MASK =
    PROTECTED_ACTION.TRANSFER |
    PROTECTED_ACTION.EXECUTE |
    PROTECTED_ACTION.BRIDGE |
    PROTECTED_ACTION.CONFIG;

/** Default proposal TTL in seconds (24 hours) */
export const DEFAULT_PROPOSAL_TTL = 86_400;

export type ProposalState =
    | 'none'
    | 'pending'
    | 'approved'
    | 'executed'
    | 'cancelled'
    | 'expired';

/**
 * Per-identity transaction policy stored on-chain (Hub).
 */
export interface MultisigPolicy {
    enabled: boolean;
    threshold: number;
    protectedActionMask: number;
    proposalTtl: number;
    disableSessions: boolean;
}

/**
 * On-chain transaction proposal.
 */
export interface TransactionProposal {
    proposalId: string;
    identityKeyHash: string;
    proposerKeyHash: string;
    targetChain: number;
    actionType: number;
    actionHash: string;
    actionPayload: string;
    createdAt: bigint;
    expiresAt: bigint;
    approvalCount: number;
    requiredThreshold: number;
    state: ProposalState;
}

/**
 * Human-readable summary of a proposal's action payload.
 */
export interface ProposalActionSummary {
    type: 'transfer' | 'execute' | 'bridge' | 'config' | 'unknown';
    description: string;
    targetChain: number;
    /** Decoded parameters — shape depends on `type` */
    params: TransferParams | ExecuteParams | BridgeParams | Record<string, unknown>;
}

export interface CreateProposalResult {
    proposalId: string;
    sequence: bigint;
    summary: ProposalActionSummary;
}

export interface ApproveProposalResult {
    proposalId: string;
    approvalCount: number;
    thresholdReached: boolean;
}

export interface ExecuteProposalResult {
    proposalId: string;
    sequence: bigint;
    dispatch: DispatchResult;
}

// ============================================================================
// Multisig-capable chain detection
// ============================================================================

/**
 * Chain client methods required for threshold multisig.
 * In Phase 1 these exist only on EVMClient (Hub chain).
 */
export interface MultisigCapableChainClient extends ChainClient {
    configureTransactionPolicy(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        threshold: number,
        protectedActionMask: number,
        proposalTtl: number,
        disableSessions: boolean,
        signer: unknown,
    ): Promise<{ receipt: unknown }>;

    getTransactionPolicy(identityKeyHash: string): Promise<MultisigPolicy>;

    createTransactionProposal(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        targetChain: number,
        actionPayload: string,
        signer: unknown,
    ): Promise<{ proposalId: string; receipt: unknown; sequence: bigint }>;

    approveTransactionProposal(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        proposalId: string,
        signer: unknown,
    ): Promise<{ receipt: unknown; approvalCount: number; thresholdReached: boolean }>;

    cancelTransactionProposal(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        proposalId: string,
        signer: unknown,
    ): Promise<{ receipt: unknown }>;

    executeTransactionProposal(
        proposalId: string,
        signer: unknown,
    ): Promise<{ receipt: unknown; sequence: bigint }>;

    getTransactionProposal(proposalId: string): Promise<TransactionProposal>;

    hasApprovedTransactionProposal(
        proposalId: string,
        keyHash: string,
    ): Promise<boolean>;
}

// ============================================================================
// Configuration
// ============================================================================

export interface MultisigManagerConfig {
    passkey: PasskeyManager;
    chain: ChainClient;
}

export interface ConfigurePolicyParams {
    signature: WebAuthnSignature;
    threshold: number;
    protectedActionMask?: number;
    proposalTtl?: number;
    disableSessions?: boolean;
    signer: unknown;
}

export interface CreateProposalParams {
    signature: WebAuthnSignature;
    targetChain: number;
    actionPayload: string;
    signer: unknown;
}

export interface ApproveProposalParams {
    signature: WebAuthnSignature;
    proposalId: string;
    signer: unknown;
}

export interface CancelProposalParams {
    signature: WebAuthnSignature;
    proposalId: string;
    signer: unknown;
}

export interface ExecuteProposalParams {
    proposalId: string;
    signer: unknown;
}

// ============================================================================
// MultisigManager
// ============================================================================

export class MultisigManager {
    private readonly passkey: PasskeyManager;
    private readonly chain: MultisigCapableChainClient;

    constructor(config: MultisigManagerConfig) {
        this.passkey = config.passkey;

        if (!isMultisigCapable(config.chain)) {
            throw new Error(
                'MultisigManager requires a chain client that supports threshold multisig. ' +
                'Ensure your EVMClient implements the ADR-0037 contract extensions.',
            );
        }
        this.chain = config.chain;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Policy
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Query the current transaction policy for the active identity.
     */
    async getPolicy(identityKeyHash?: string): Promise<MultisigPolicy> {
        const keyHash = identityKeyHash ?? this.requireCredential().keyHash;
        return this.chain.getTransactionPolicy(keyHash);
    }

    /**
     * Configure (or update) the transaction policy for the current identity.
     *
     * @throws If threshold < 2
     */
    async configurePolicy(params: ConfigurePolicyParams): Promise<void> {
        const { signature, threshold, signer } = params;
        const protectedActionMask = params.protectedActionMask ?? DEFAULT_PROTECTED_ACTION_MASK;
        const proposalTtl = params.proposalTtl ?? DEFAULT_PROPOSAL_TTL;
        const disableSessions = params.disableSessions ?? true;

        if (threshold < 2) {
            throw new Error(
                `Threshold must be >= 2 for multisig policy. Got ${threshold}.`,
            );
        }

        const credential = this.requireCredential();
        await this.chain.configureTransactionPolicy(
            signature,
            credential.publicKeyX,
            credential.publicKeyY,
            threshold,
            protectedActionMask,
            proposalTtl,
            disableSessions,
            signer,
        );
    }

    /**
     * Check whether direct (single-signer) dispatch is allowed for the given
     * action type under the current policy.  Throws a descriptive error when
     * threshold approval is required instead.
     *
     * Call this before `sdk.transfer()` / `sdk.execute()` / `sdk.bridge()`
     * to fail fast in the SDK rather than reverting on-chain.
     */
    async assertDirectDispatchAllowed(
        actionType: 'transfer' | 'execute' | 'bridge' | 'config',
        identityKeyHash?: string,
    ): Promise<void> {
        const keyHash = identityKeyHash ?? this.requireCredential().keyHash;
        const policy = await this.chain.getTransactionPolicy(keyHash);

        if (!policy.enabled) return; // single-signer is fine

        const bit = actionTypeToBit(actionType);
        if ((policy.protectedActionMask & bit) !== 0) {
            throw new Error(
                `Direct dispatch of "${actionType}" is not allowed: identity ${keyHash} ` +
                `requires threshold multisig approval (threshold=${policy.threshold}). ` +
                'Use sdk.multisig.createProposal() instead.',
            );
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Proposal lifecycle
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Create a new transaction proposal.
     *
     * The proposer's signature counts as the first approval automatically.
     */
    async createProposal(params: CreateProposalParams): Promise<CreateProposalResult> {
        const credential = this.requireCredential();
        const result = await this.chain.createTransactionProposal(
            params.signature,
            credential.publicKeyX,
            credential.publicKeyY,
            params.targetChain,
            params.actionPayload,
            params.signer,
        );

        const summary = decodeActionSummary(params.targetChain, params.actionPayload);

        return {
            proposalId: result.proposalId,
            sequence: result.sequence,
            summary,
        };
    }

    /**
     * Approve an existing proposal.  Each authorized key may approve once.
     */
    async approveProposal(params: ApproveProposalParams): Promise<ApproveProposalResult> {
        const credential = this.requireCredential();
        const result = await this.chain.approveTransactionProposal(
            params.signature,
            credential.publicKeyX,
            credential.publicKeyY,
            params.proposalId,
            params.signer,
        );
        return {
            proposalId: params.proposalId,
            approvalCount: result.approvalCount,
            thresholdReached: result.thresholdReached,
        };
    }

    /**
     * Cancel a proposal — only allowed by an authorized key of the identity.
     */
    async cancelProposal(params: CancelProposalParams): Promise<void> {
        const credential = this.requireCredential();
        await this.chain.cancelTransactionProposal(
            params.signature,
            credential.publicKeyX,
            credential.publicKeyY,
            params.proposalId,
            params.signer,
        );
    }

    /**
     * Execute a proposal after threshold + timelock are satisfied.
     * Permissionless — anyone may call.
     */
    async executeProposal(params: ExecuteProposalParams): Promise<ExecuteProposalResult> {
        const result = await this.chain.executeTransactionProposal(
            params.proposalId,
            params.signer,
        );
        return {
            proposalId: params.proposalId,
            sequence: result.sequence,
            dispatch: {
                transactionHash: '', // filled by chain client
                sequence: result.sequence,
                userKeyHash: '',
                targetChain: 0,
            },
        };
    }

    // ────────────────────────────────────────────────────────────────────────
    // Queries
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Retrieve a proposal by ID.
     */
    async getProposal(proposalId: string): Promise<TransactionProposal> {
        return this.chain.getTransactionProposal(proposalId);
    }

    /**
     * Check whether a specific key has approved a given proposal.
     */
    async hasApproved(proposalId: string, keyHash?: string): Promise<boolean> {
        const resolvedKeyHash = keyHash ?? this.requireCredential().keyHash;
        return this.chain.hasApprovedTransactionProposal(proposalId, resolvedKeyHash);
    }

    /**
     * Convenience: check if a proposal is ready for execution.
     */
    async isProposalExecutable(proposalId: string): Promise<boolean> {
        const proposal = await this.getProposal(proposalId);
        if (proposal.state !== 'pending' && proposal.state !== 'approved') return false;

        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        return (
            proposal.approvalCount >= proposal.requiredThreshold &&
            nowSec < proposal.expiresAt
        );
    }

    // ────────────────────────────────────────────────────────────────────────
    // Internal
    // ────────────────────────────────────────────────────────────────────────

    private requireCredential() {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new Error(
                'No credential set. Call passkey.register() or passkey.authenticate() first.',
            );
        }
        return credential;
    }
}

// ============================================================================
// Helpers
// ============================================================================

function isMultisigCapable(chain: ChainClient): chain is MultisigCapableChainClient {
    const c = chain as Partial<MultisigCapableChainClient>;
    return (
        typeof c.configureTransactionPolicy === 'function' &&
        typeof c.getTransactionPolicy === 'function' &&
        typeof c.createTransactionProposal === 'function' &&
        typeof c.approveTransactionProposal === 'function' &&
        typeof c.cancelTransactionProposal === 'function' &&
        typeof c.executeTransactionProposal === 'function' &&
        typeof c.getTransactionProposal === 'function' &&
        typeof c.hasApprovedTransactionProposal === 'function'
    );
}

function actionTypeToBit(type: 'transfer' | 'execute' | 'bridge' | 'config'): number {
    switch (type) {
        case 'transfer': return PROTECTED_ACTION.TRANSFER;
        case 'execute':  return PROTECTED_ACTION.EXECUTE;
        case 'bridge':   return PROTECTED_ACTION.BRIDGE;
        case 'config':   return PROTECTED_ACTION.CONFIG;
    }
}

/**
 * Best-effort decode of an action payload for human-readable display.
 * Falls back to an opaque summary if decoding fails.
 */
function decodeActionSummary(targetChain: number, actionPayload: string): ProposalActionSummary {
    // Action payloads are ABI-encoded with a leading action-type byte.
    // We attempt a lightweight decode here; full parsing is done by
    // TransactionParser if the integrator wants richer display.
    try {
        const bytes = hexToBytes(actionPayload);
        if (bytes.length === 0) {
            return { type: 'unknown', description: 'Empty payload', targetChain, params: {} };
        }

        const actionByte = bytes[0];
        switch (actionByte) {
            case 1: return { type: 'transfer', description: 'Token transfer', targetChain, params: {} as TransferParams };
            case 2: return { type: 'execute', description: 'Contract execution', targetChain, params: {} as ExecuteParams };
            case 3: return { type: 'bridge', description: 'Cross-chain bridge', targetChain, params: {} as BridgeParams };
            case 4: return { type: 'config', description: 'Configuration change', targetChain, params: {} };
            default: return { type: 'unknown', description: `Action type ${actionByte}`, targetChain, params: {} };
        }
    } catch {
        return { type: 'unknown', description: 'Unable to decode payload', targetChain, params: {} };
    }
}

function hexToBytes(hex: string): Uint8Array {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (clean.length === 0) return new Uint8Array(0);
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}
