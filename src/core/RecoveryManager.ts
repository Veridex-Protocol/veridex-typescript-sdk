/**
 * Veridex Protocol SDK — Recovery Manager
 *
 * Orchestrates the full guardian-based social recovery lifecycle on top of the
 * low-level EVMClient methods.  Provides a high-level, ergonomic API for:
 *
 *  1. Guardian configuration  (setup / add / remove)
 *  2. Recovery initiation      (initiateRecovery — called from a guardian device)
 *  3. Approval collection      (approveRecovery  — each guardian signs)
 *  4. Execution                (executeRecovery  — permissionless after threshold + timelock)
 *  5. Cancellation             (cancelRecovery   — by the current owner)
 *  6. Status monitoring        (readiness, state, approvals)
 *
 * Design rationale
 * ────────────────
 * • All mutating operations require a WebAuthn signature and an on-chain signer
 *   (ethers.Signer).  The SDK never holds private-key material — ADR-0040.
 * • The manager delegates on-chain calls to the provided ChainClient, which must
 *   implement {@link RecoveryCapableChainClient}.  At runtime this is checked via
 *   duck-typing so non-EVM chains that lack recovery simply throw clearly.
 * • Cross-chain propagation of recovery results (new-owner VAA) is out of scope
 *   for this manager; it is handled by the relayer once the Hub emits the VAA.
 *
 * @module RecoveryManager
 */

import type { PasskeyManager } from './PasskeyManager.js';
import type {
    ChainClient,
    WebAuthnSignature,

} from './types.js';

// ============================================================================
// Recovery-capable chain detection
// ============================================================================

/**
 * Subset of ChainClient that supports the guardian / recovery contract surface.
 * EVMClient satisfies this; non-EVM clients currently do not.
 */
export interface RecoveryCapableChainClient extends ChainClient {
    getGuardians(identityKeyHash: string): Promise<GuardiansResult>;
    getRecoveryStatus(identityKeyHash: string): Promise<RecoveryStatusResult>;
    hasGuardianApproved(identityKeyHash: string, guardianKeyHash: string): Promise<boolean>;
    setupGuardians(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        guardians: string[],
        threshold: bigint,
        signer: unknown,
    ): Promise<{ receipt: unknown; sequence: bigint }>;
    addGuardian(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        guardianKeyHash: string,
        signer: unknown,
    ): Promise<{ receipt: unknown; sequence: bigint }>;
    removeGuardian(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        guardianKeyHash: string,
        signer: unknown,
    ): Promise<{ receipt: unknown; sequence: bigint }>;
    initiateRecovery(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        identityToRecover: string,
        newOwnerKeyHash: string,
        signer: unknown,
    ): Promise<{ receipt: unknown; sequence: bigint }>;
    approveRecovery(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        identityToRecover: string,
        signer: unknown,
    ): Promise<{ receipt: unknown; sequence: bigint }>;
    executeRecovery(
        identityToRecover: string,
        newPublicKeyX: bigint,
        newPublicKeyY: bigint,
        signer: unknown,
    ): Promise<{ receipt: unknown; sequence: bigint }>;
    cancelRecovery(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        signer: unknown,
    ): Promise<{ receipt: unknown; sequence: bigint }>;
}

// ============================================================================
// Public types
// ============================================================================

export interface GuardiansResult {
    guardians: string[];
    threshold: bigint;
    isConfigured: boolean;
}

export interface RecoveryStatusResult {
    isActive: boolean;
    newOwnerKeyHash: string;
    initiatedAt: bigint;
    approvalCount: bigint;
    threshold: bigint;
    canExecuteAt: bigint;
    expiresAt: bigint;
}

export interface RecoveryReadiness {
    /** Whether at least one guardian is configured */
    guardiansConfigured: boolean;
    /** Number of guardians */
    guardianCount: number;
    /** Required approval count */
    threshold: bigint;
    /** Whether a recovery is currently in progress */
    recoveryInProgress: boolean;
    /** If in progress, whether it can be executed now */
    canExecuteNow: boolean;
    /** If in progress, whether it has expired */
    isExpired: boolean;
    /** If in progress, how many more approvals are needed (0 when ready) */
    approvalsRemaining: number;
    /** Full recovery status if active */
    recoveryStatus: RecoveryStatusResult | null;
    /** List of guardian key hashes */
    guardians: string[];
}

export interface SetupGuardiansParams {
    /** WebAuthn assertion for the operation */
    signature: WebAuthnSignature;
    /** Guardian key hashes to set */
    guardians: string[];
    /** Approval threshold (must be >= 1 and <= guardians.length) */
    threshold: number;
    /** Ethers signer to submit the transaction */
    signer: unknown;
}

export interface AddGuardianParams {
    signature: WebAuthnSignature;
    guardianKeyHash: string;
    signer: unknown;
}

export interface RemoveGuardianParams {
    signature: WebAuthnSignature;
    guardianKeyHash: string;
    signer: unknown;
}

export interface InitiateRecoveryParams {
    signature: WebAuthnSignature;
    /** Identity key hash to recover */
    identityToRecover: string;
    /** New owner key hash that will replace the old one */
    newOwnerKeyHash: string;
    signer: unknown;
}

export interface ApproveRecoveryParams {
    signature: WebAuthnSignature;
    identityToRecover: string;
    signer: unknown;
}

export interface ExecuteRecoveryParams {
    identityToRecover: string;
    /** The new owner's P-256 public key X coordinate */
    newPublicKeyX: bigint;
    /** The new owner's P-256 public key Y coordinate */
    newPublicKeyY: bigint;
    signer: unknown;
}

export interface CancelRecoveryParams {
    signature: WebAuthnSignature;
    signer: unknown;
}

export interface RecoveryManagerConfig {
    passkey: PasskeyManager;
    chain: ChainClient;
}

// ============================================================================
// RecoveryManager
// ============================================================================

export class RecoveryManager {
    private readonly passkey: PasskeyManager;
    private readonly chain: RecoveryCapableChainClient;

    constructor(config: RecoveryManagerConfig) {
        this.passkey = config.passkey;

        if (!isRecoveryCapable(config.chain)) {
            throw new Error(
                'RecoveryManager requires a chain client that supports guardian and recovery methods. ' +
                'Currently only EVMClient implements RecoveryCapableChainClient.',
            );
        }
        this.chain = config.chain;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Queries
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Get full recovery readiness — combines guardian config and recovery state
     * into a single, user-friendly view.
     */
    async getReadiness(identityKeyHash?: string): Promise<RecoveryReadiness> {
        const keyHash = identityKeyHash ?? this.requireCredential().keyHash;

        const [guardians, status] = await Promise.all([
            this.chain.getGuardians(keyHash),
            this.chain.getRecoveryStatus(keyHash),
        ]);

        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        const canExecuteNow = status.isActive
            && status.approvalCount >= status.threshold
            && nowSec >= status.canExecuteAt
            && nowSec < status.expiresAt;
        const isExpired = status.isActive && nowSec >= status.expiresAt;
        const approvalsRemaining = status.isActive
            ? Math.max(0, Number(status.threshold - status.approvalCount))
            : 0;

        return {
            guardiansConfigured: guardians.isConfigured,
            guardianCount: guardians.guardians.length,
            threshold: guardians.threshold,
            recoveryInProgress: status.isActive,
            canExecuteNow,
            isExpired,
            approvalsRemaining,
            recoveryStatus: status.isActive ? status : null,
            guardians: guardians.guardians,
        };
    }

    /**
     * Check whether a specific guardian has already approved the active recovery.
     */
    async hasGuardianApproved(
        identityKeyHash: string,
        guardianKeyHash: string,
    ): Promise<boolean> {
        return this.chain.hasGuardianApproved(identityKeyHash, guardianKeyHash);
    }

    /**
     * Get the raw guardian configuration for a given identity.
     */
    async getGuardians(identityKeyHash?: string): Promise<GuardiansResult> {
        const keyHash = identityKeyHash ?? this.requireCredential().keyHash;
        return this.chain.getGuardians(keyHash);
    }

    /**
     * Get the raw recovery status for a given identity.
     */
    async getRecoveryStatus(identityKeyHash?: string): Promise<RecoveryStatusResult> {
        const keyHash = identityKeyHash ?? this.requireCredential().keyHash;
        return this.chain.getRecoveryStatus(keyHash);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Mutations
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Configure the guardian set and approval threshold for the current identity.
     *
     * @throws If threshold < 1 or threshold > guardians.length
     */
    async setupGuardians(params: SetupGuardiansParams): Promise<{ sequence: bigint }> {
        const { signature, guardians, threshold, signer } = params;

        if (threshold < 1 || threshold > guardians.length) {
            throw new Error(
                `Invalid threshold ${threshold}: must be between 1 and ${guardians.length} (guardian count).`,
            );
        }

        const credential = this.requireCredential();
        const result = await this.chain.setupGuardians(
            signature,
            credential.publicKeyX,
            credential.publicKeyY,
            guardians,
            BigInt(threshold),
            signer,
        );
        return { sequence: result.sequence };
    }

    /**
     * Add a single guardian to the current identity's guardian set.
     */
    async addGuardian(params: AddGuardianParams): Promise<{ sequence: bigint }> {
        const credential = this.requireCredential();
        const result = await this.chain.addGuardian(
            params.signature,
            credential.publicKeyX,
            credential.publicKeyY,
            params.guardianKeyHash,
            params.signer,
        );
        return { sequence: result.sequence };
    }

    /**
     * Remove a guardian from the current identity's guardian set.
     */
    async removeGuardian(params: RemoveGuardianParams): Promise<{ sequence: bigint }> {
        const credential = this.requireCredential();
        const result = await this.chain.removeGuardian(
            params.signature,
            credential.publicKeyX,
            credential.publicKeyY,
            params.guardianKeyHash,
            params.signer,
        );
        return { sequence: result.sequence };
    }

    /**
     * Initiate social recovery — typically called from a guardian's device.
     *
     * The caller must be a guardian of the identity being recovered.
     */
    async initiateRecovery(params: InitiateRecoveryParams): Promise<{ sequence: bigint }> {
        const credential = this.requireCredential();
        const result = await this.chain.initiateRecovery(
            params.signature,
            credential.publicKeyX,
            credential.publicKeyY,
            params.identityToRecover,
            params.newOwnerKeyHash,
            params.signer,
        );
        return { sequence: result.sequence };
    }

    /**
     * Approve an in-progress recovery — each guardian calls this once.
     */
    async approveRecovery(params: ApproveRecoveryParams): Promise<{ sequence: bigint }> {
        const credential = this.requireCredential();
        const result = await this.chain.approveRecovery(
            params.signature,
            credential.publicKeyX,
            credential.publicKeyY,
            params.identityToRecover,
            params.signer,
        );
        return { sequence: result.sequence };
    }

    /**
     * Execute a recovery after threshold + timelock are satisfied.
     *
     * This is permissionless — anyone may call it.  No WebAuthn signature required.
     */
    async executeRecovery(params: ExecuteRecoveryParams): Promise<{ sequence: bigint }> {
        const result = await this.chain.executeRecovery(
            params.identityToRecover,
            params.newPublicKeyX,
            params.newPublicKeyY,
            params.signer,
        );
        return { sequence: result.sequence };
    }

    /**
     * Cancel an in-progress recovery — only the current owner can do this.
     */
    async cancelRecovery(params: CancelRecoveryParams): Promise<{ sequence: bigint }> {
        const credential = this.requireCredential();
        const result = await this.chain.cancelRecovery(
            params.signature,
            credential.publicKeyX,
            credential.publicKeyY,
            params.signer,
        );
        return { sequence: result.sequence };
    }

    // ────────────────────────────────────────────────────────────────────────
    // Internal helpers
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
// Runtime type guard
// ============================================================================

function isRecoveryCapable(chain: ChainClient): chain is RecoveryCapableChainClient {
    const c = chain as Partial<RecoveryCapableChainClient>;
    return (
        typeof c.getGuardians === 'function' &&
        typeof c.getRecoveryStatus === 'function' &&
        typeof c.hasGuardianApproved === 'function' &&
        typeof c.setupGuardians === 'function' &&
        typeof c.initiateRecovery === 'function' &&
        typeof c.approveRecovery === 'function' &&
        typeof c.executeRecovery === 'function' &&
        typeof c.cancelRecovery === 'function'
    );
}
