/**
 * Veridex Protocol SDK - Stacks Chain Client
 *
 * Production-grade implementation of ChainClient interface for Stacks.
 * Supports direct relay with native sponsored transactions.
 *
 * Security:
 * - Native secp256r1-verify for Passkey (P-256) validation
 * - Native secp256k1-verify for session key validation
 * - Protocol-level Post-Conditions for spending safety
 * - Nonce-based replay protection
 * - Block-height based session expiry
 *
 * Architecture:
 * - Phase 1: Direct relay (relayer sponsors Stacks transactions)
 * - Phase 2: Wormhole cross-chain messaging (VAA + CCQ)
 * - Vaults are map-based (Clarity doesn't support factory patterns)
 * - All identities stored in veridex-spoke.clar
 * - STX/sBTC custody in veridex-vault.clar (direct) + veridex-vault-vaa.clar (cross-chain)
 * - Guardian signature verification in veridex-wormhole-verifier.clar
 */

import type { SessionKey } from '../../sessions/types.js';
import type {
    ChainClient,
    ChainConfig,
    TransferParams,
    ExecuteParams,
    BridgeParams,
    DispatchResult,
    WebAuthnSignature,
    VaultCreationResult,
    RegisterSessionParams,
    RevokeSessionParams,
    SessionValidationResult,
} from '../../core/types.js';
import { encodeTransferAction, encodeExecuteAction, encodeBridgeAction } from '../../payload.js';
import {
    compressPublicKey,
    rsToCompactSignature,
    computeKeyHashFromCoords,
    bytesToHex,
    hexToBytes,
} from './StacksSigner.js';
import {
    parseContractPrincipal,
    isContractPrincipal,
} from './StacksAddressUtils.js';

// ============================================================================
// Constants
// ============================================================================

/** Stacks action types matching veridex-spoke.clar constants */
export const STACKS_ACTION_TYPES = {
    TRANSFER_STX: 1,
    TRANSFER_SBTC: 2,
    CONTRACT_CALL: 3,
} as const;

/** Default Hiro API endpoints */
const HIRO_API = {
    testnet: 'https://api.testnet.hiro.so',
    mainnet: 'https://api.hiro.so',
} as const;

// ============================================================================
// Types
// ============================================================================

export interface StacksClientConfig {
    /** Wormhole chain ID (60 for Stacks) */
    wormholeChainId: number;
    /** Stacks RPC URL (Hiro API) */
    rpcUrl: string;
    /** Spoke contract principal (e.g., "ST1PQHQKV...veridex-spoke") */
    spokeContractAddress?: string;
    /** Vault contract principal (e.g., "ST1PQHQKV...veridex-vault") */
    vaultContractAddress?: string;
    /** Wormhole verifier contract principal (Phase 2) */
    wormholeVerifierAddress?: string;
    /** VAA-authorized vault contract principal (Phase 2) */
    vaultVaaContractAddress?: string;
    /** Network type */
    network?: 'mainnet' | 'testnet';
    /** Hub RPC URL for cross-chain session management */
    hubRpcUrl?: string;
    /** Hub contract address for cross-chain session management */
    hubContractAddress?: string;
}

/** Parsed contract principal */
interface ContractId {
    address: string;
    name: string;
}

// ============================================================================
// StacksClient
// ============================================================================

export class StacksClient implements ChainClient {
    private config: ChainConfig;
    private rpcUrl: string;
    private spokeContract: ContractId | null;
    private vaultContract: ContractId | null;
    private wormholeVerifierContract: ContractId | null;
    private vaultVaaContract: ContractId | null;
    private networkType: 'mainnet' | 'testnet';

    constructor(clientConfig: StacksClientConfig) {
        this.networkType = clientConfig.network || 'testnet';
        this.rpcUrl = clientConfig.rpcUrl || HIRO_API[this.networkType];

        // Parse spoke contract principal
        if (clientConfig.spokeContractAddress && isContractPrincipal(clientConfig.spokeContractAddress)) {
            const parsed = parseContractPrincipal(clientConfig.spokeContractAddress);
            this.spokeContract = { address: parsed.address, name: parsed.contractName };
        } else {
            this.spokeContract = null;
        }

        // Parse vault contract principal
        if (clientConfig.vaultContractAddress && isContractPrincipal(clientConfig.vaultContractAddress)) {
            const parsed = parseContractPrincipal(clientConfig.vaultContractAddress);
            this.vaultContract = { address: parsed.address, name: parsed.contractName };
        } else {
            this.vaultContract = null;
        }

        // Parse wormhole verifier contract principal (Phase 2)
        if (clientConfig.wormholeVerifierAddress && isContractPrincipal(clientConfig.wormholeVerifierAddress)) {
            const parsed = parseContractPrincipal(clientConfig.wormholeVerifierAddress);
            this.wormholeVerifierContract = { address: parsed.address, name: parsed.contractName };
        } else {
            this.wormholeVerifierContract = null;
        }

        // Parse vault-vaa contract principal (Phase 2)
        if (clientConfig.vaultVaaContractAddress && isContractPrincipal(clientConfig.vaultVaaContractAddress)) {
            const parsed = parseContractPrincipal(clientConfig.vaultVaaContractAddress);
            this.vaultVaaContract = { address: parsed.address, name: parsed.contractName };
        } else {
            this.vaultVaaContract = null;
        }

        // If spoke is set but vault is not, derive vault from same deployer
        if (this.spokeContract && !this.vaultContract) {
            this.vaultContract = {
                address: this.spokeContract.address,
                name: 'veridex-vault',
            };
        }

        // Auto-derive Phase 2 contracts from spoke deployer if not explicitly set
        if (this.spokeContract && !this.wormholeVerifierContract) {
            this.wormholeVerifierContract = {
                address: this.spokeContract.address,
                name: 'veridex-wormhole-verifier',
            };
        }
        if (this.spokeContract && !this.vaultVaaContract) {
            this.vaultVaaContract = {
                address: this.spokeContract.address,
                name: 'veridex-vault-vaa',
            };
        }

        this.config = {
            name: `Stacks ${this.networkType}`,
            chainId: this.networkType === 'mainnet' ? 1 : 2147483648,
            wormholeChainId: clientConfig.wormholeChainId,
            rpcUrl: this.rpcUrl,
            explorerUrl: this.networkType === 'testnet'
                ? 'https://explorer.hiro.so/?chain=testnet'
                : 'https://explorer.hiro.so',
            isEvm: false,
            contracts: {
                hub: clientConfig.spokeContractAddress,
                wormholeCoreBridge: '',
                wormholeVerifier: this.wormholeVerifierContract
                    ? `${this.wormholeVerifierContract.address}.${this.wormholeVerifierContract.name}`
                    : undefined,
                vaultVaa: this.vaultVaaContract
                    ? `${this.vaultVaaContract.address}.${this.vaultVaaContract.name}`
                    : undefined,
            },
        };
    }

    // ========================================================================
    // ChainClient Interface - Configuration
    // ========================================================================

    getConfig(): ChainConfig {
        return this.config;
    }

    // ========================================================================
    // ChainClient Interface - Nonce & Fees
    // ========================================================================

    /**
     * Get the current nonce for a user identity from the spoke contract.
     * Calls the read-only function `get-nonce` on veridex-spoke.
     */
    async getNonce(userKeyHash: string): Promise<bigint> {
        if (!this.spokeContract) {
            return 0n;
        }

        try {
            const result = await this.callReadOnly(
                this.spokeContract.address,
                this.spokeContract.name,
                'get-nonce',
                [`0x${userKeyHash.replace('0x', '')}`]
            );

            // Result is (ok uint) or (err uint)
            if (result && result.value !== undefined) {
                return BigInt(result.value);
            }
            return 0n;
        } catch {
            return 0n;
        }
    }

    /**
     * Get the Wormhole message fee.
     * Phase 1: No Wormhole integration, returns 0.
     */
    async getMessageFee(): Promise<bigint> {
        return 0n;
    }

    // ========================================================================
    // ChainClient Interface - Payload Building
    // ========================================================================

    async buildTransferPayload(params: TransferParams): Promise<string> {
        return encodeTransferAction(params.token, params.recipient, params.amount);
    }

    async buildExecutePayload(params: ExecuteParams): Promise<string> {
        return encodeExecuteAction(params.target, params.value, params.data);
    }

    async buildBridgePayload(params: BridgeParams): Promise<string> {
        return encodeBridgeAction(params.token, params.amount, params.destinationChain, params.recipient);
    }

    // ========================================================================
    // ChainClient Interface - Dispatch
    // ========================================================================

    /**
     * Direct dispatch is not supported on Stacks in Phase 1.
     * Stacks actions are executed via sponsored transactions through the relayer.
     */
    async dispatch(
        _signature: WebAuthnSignature,
        _publicKeyX: bigint,
        _publicKeyY: bigint,
        _targetChain: number,
        _actionPayload: string,
        _nonce: bigint,
        _signer: unknown
    ): Promise<DispatchResult> {
        throw new Error(
            'Direct dispatch not supported on Stacks in Phase 1. ' +
            'Use dispatchGasless() to route through the relayer, which sponsors Stacks transactions. ' +
            'Phase 2 will add Wormhole cross-chain dispatch support.'
        );
    }

    /**
     * Dispatch an action via the relayer (gasless/sponsored).
     *
     * Flow:
     * 1. User signs action with Passkey (on client)
     * 2. SDK submits to relayer with targetChain=60 (Stacks)
     * 3. Relayer builds Clarity contract-call transaction
     * 4. Relayer sponsors the transaction (pays STX gas)
     * 5. Relayer broadcasts to Stacks network
     * 6. Transaction confirmed on Stacks
     */
    async dispatchGasless(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        targetChain: number,
        actionPayload: string,
        nonce: bigint,
        relayerUrl: string
    ): Promise<DispatchResult> {
        const keyHash = await computeKeyHashFromCoords(publicKeyX, publicKeyY);
        const compressedPubkey = compressPublicKey(publicKeyX, publicKeyY);
        const compactSig = rsToCompactSignature(signature.r, signature.s);

        const request = {
            signature: {
                r: '0x' + signature.r.toString(16).padStart(64, '0'),
                s: '0x' + signature.s.toString(16).padStart(64, '0'),
                authenticatorData: signature.authenticatorData,
                clientDataJSON: signature.clientDataJSON,
                challengeIndex: signature.challengeIndex,
                typeIndex: signature.typeIndex,
            },
            publicKeyX: '0x' + publicKeyX.toString(16).padStart(64, '0'),
            publicKeyY: '0x' + publicKeyY.toString(16).padStart(64, '0'),
            compressedPubkey: '0x' + bytesToHex(compressedPubkey),
            compactSignature: '0x' + bytesToHex(compactSig),
            targetChain,
            actionPayload,
            userNonce: Number(nonce),
        };

        const response = await fetch(`${relayerUrl}/api/v1/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(
                `Relayer submission failed: ${response.status} ${response.statusText}. ` +
                `Error: ${errorText}`
            );
        }

        const result = await response.json() as Record<string, unknown>;

        return {
            transactionHash: (result.transactionHash ?? result.txHash ?? result.hubTxHash ?? '') as string,
            sequence: BigInt((result.sequence as string | number) || 0),
            userKeyHash: keyHash,
            targetChain,
        };
    }

    // ========================================================================
    // ChainClient Interface - Vault Management
    // ========================================================================

    /**
     * Get vault address for a user.
     * On Stacks, vaults are map-based within the vault contract.
     * The "vault address" is the vault contract principal itself.
     */
    async getVaultAddress(userKeyHash: string): Promise<string | null> {
        if (!this.vaultContract) {
            return null;
        }

        // Check if identity exists in spoke contract
        const exists = await this.vaultExists(userKeyHash);
        if (!exists) {
            return null;
        }

        return `${this.vaultContract.address}.${this.vaultContract.name}`;
    }

    /**
     * Compute vault address deterministically.
     * On Stacks, all vaults live in the same contract (map-based).
     */
    computeVaultAddress(_userKeyHash: string): string {
        if (!this.vaultContract) {
            throw new Error('Vault contract not configured');
        }
        return `${this.vaultContract.address}.${this.vaultContract.name}`;
    }

    /**
     * Check if a vault (identity) exists for a user.
     * Queries the spoke contract's `identity-exists` read-only function.
     */
    async vaultExists(userKeyHash: string): Promise<boolean> {
        if (!this.spokeContract) {
            return false;
        }

        try {
            const result = await this.callReadOnly(
                this.spokeContract.address,
                this.spokeContract.name,
                'identity-exists',
                [`0x${userKeyHash.replace('0x', '')}`]
            );

            return result === true || result?.value === true;
        } catch {
            return false;
        }
    }

    /**
     * Create a vault (register identity) on Stacks.
     * Must be done via Hub dispatch or relayer in Phase 1.
     */
    async createVault(userKeyHash: string, _signer: unknown): Promise<VaultCreationResult> {
        throw new Error(
            'Vault creation on Stacks requires Passkey signature verification. ' +
            'Use createVaultViaRelayer() for sponsored identity registration, ' +
            'or call register-identity directly with a signed Stacks transaction. ' +
            `KeyHash=${userKeyHash}`
        );
    }

    /**
     * Create a vault with a sponsor wallet.
     * On Stacks, this registers an identity via sponsored transaction.
     */
    async createVaultSponsored?(
        userKeyHash: string,
        _sponsorPrivateKey: string,
        _rpcUrl?: string
    ): Promise<VaultCreationResult> {
        throw new Error(
            'Sponsored vault creation on Stacks requires the user to sign with their Passkey. ' +
            'Use createVaultViaRelayer() which handles the sponsored transaction flow. ' +
            `KeyHash=${userKeyHash}`
        );
    }

    /**
     * Create a vault via the relayer (sponsored/gasless).
     * The relayer will sponsor the register-identity transaction.
     */
    async createVaultViaRelayer(
        userKeyHash: string,
        relayerUrl: string
    ): Promise<VaultCreationResult> {
        const response = await fetch(`${relayerUrl}/api/v1/stacks/vault`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userKeyHash,
                chainId: this.config.wormholeChainId,
            }),
        });

        const result = await response.json() as Record<string, unknown>;

        if (!response.ok || !result.success) {
            throw new Error((result.error as string) || 'Failed to create vault via relayer');
        }

        return {
            address: (result.vaultAddress as string) || this.computeVaultAddress(userKeyHash),
            transactionHash: (result.transactionHash as string) || '',
            blockNumber: 0,
            gasUsed: 0n,
            alreadyExisted: (result.alreadyExists as boolean) || false,
            sponsoredBy: 'relayer',
        };
    }

    async estimateVaultCreationGas(_userKeyHash: string): Promise<bigint> {
        // Stacks fees are typically 0.001-0.01 STX for contract calls
        return 10000n; // 0.01 STX in microSTX
    }

    getFactoryAddress(): string | undefined {
        return undefined; // No factory pattern on Stacks
    }

    getImplementationAddress(): string | undefined {
        return undefined;
    }

    // ========================================================================
    // Stacks-Specific: Balance Queries
    // ========================================================================

    /**
     * Get native STX balance for an address.
     */
    async getNativeBalance(address: string): Promise<bigint> {
        try {
            const response = await fetch(
                `${this.rpcUrl}/v2/accounts/${address}?proof=0`
            );
            if (!response.ok) {
                return 0n;
            }
            const data = await response.json() as Record<string, string>;
            return BigInt(data.balance || '0');
        } catch {
            return 0n;
        }
    }

    /**
     * Get vault STX balance for an identity.
     * Queries the vault contract's `get-stx-balance` read-only function.
     */
    async getVaultStxBalance(keyHash: string): Promise<bigint> {
        if (!this.vaultContract) {
            return 0n;
        }

        try {
            const result = await this.callReadOnly(
                this.vaultContract.address,
                this.vaultContract.name,
                'get-stx-balance',
                [`0x${keyHash.replace('0x', '')}`]
            );

            if (result && result.value !== undefined) {
                return BigInt(result.value);
            }
            return 0n;
        } catch {
            return 0n;
        }
    }

    /**
     * Get vault sBTC balance for an identity.
     */
    async getVaultSbtcBalance(keyHash: string): Promise<bigint> {
        if (!this.vaultContract) {
            return 0n;
        }

        try {
            const result = await this.callReadOnly(
                this.vaultContract.address,
                this.vaultContract.name,
                'get-sbtc-balance',
                [`0x${keyHash.replace('0x', '')}`]
            );

            if (result && result.value !== undefined) {
                return BigInt(result.value);
            }
            return 0n;
        } catch {
            return 0n;
        }
    }

    // ========================================================================
    // Stacks-Specific: Identity & Session Queries
    // ========================================================================

    /**
     * Get identity info from the spoke contract.
     */
    async getIdentity(keyHash: string): Promise<{
        compressedPubkey: string;
        owner: string;
        nonce: bigint;
        createdAt: bigint;
    } | null> {
        if (!this.spokeContract) {
            return null;
        }

        try {
            const result = await this.callReadOnly(
                this.spokeContract.address,
                this.spokeContract.name,
                'get-identity',
                [`0x${keyHash.replace('0x', '')}`]
            );

            if (!result || result.value === undefined) {
                return null;
            }

            const val = result.value;
            return {
                compressedPubkey: val['compressed-pubkey']?.value || '',
                owner: val.owner?.value || '',
                nonce: BigInt(val.nonce?.value || 0),
                createdAt: BigInt(val['created-at']?.value || 0),
            };
        } catch {
            return null;
        }
    }

    /**
     * Get session info from the spoke contract.
     */
    async getSession(keyHash: string, sessionHash: string): Promise<{
        sessionPubkey: string;
        expiry: bigint;
        maxValue: bigint;
        spent: bigint;
        revoked: boolean;
        createdAt: bigint;
    } | null> {
        if (!this.spokeContract) {
            return null;
        }

        try {
            const cleanKeyHash = `0x${keyHash.replace('0x', '')}`;
            const cleanSessionHash = `0x${sessionHash.replace('0x', '')}`;

            const result = await this.callReadOnly(
                this.spokeContract.address,
                this.spokeContract.name,
                'get-session',
                [cleanKeyHash, cleanSessionHash]
            );

            if (!result || result.value === undefined) {
                return null;
            }

            const val = result.value;
            return {
                sessionPubkey: val['session-pubkey']?.value || '',
                expiry: BigInt(val.expiry?.value || 0),
                maxValue: BigInt(val['max-value']?.value || 0),
                spent: BigInt(val.spent?.value || 0),
                revoked: val.revoked?.value === true,
                createdAt: BigInt(val['created-at']?.value || 0),
            };
        } catch {
            return null;
        }
    }

    /**
     * Check if a session is currently active.
     */
    async checkSessionActive(keyHash: string, sessionHash: string): Promise<boolean> {
        if (!this.spokeContract) {
            return false;
        }

        try {
            const cleanKeyHash = `0x${keyHash.replace('0x', '')}`;
            const cleanSessionHash = `0x${sessionHash.replace('0x', '')}`;

            const result = await this.callReadOnly(
                this.spokeContract.address,
                this.spokeContract.name,
                'is-session-active',
                [cleanKeyHash, cleanSessionHash]
            );

            return result?.value === true;
        } catch {
            return false;
        }
    }

    /**
     * Get remaining spending budget for a session.
     */
    async getRemainingBudget(keyHash: string, sessionHash: string): Promise<bigint> {
        if (!this.spokeContract) {
            return 0n;
        }

        try {
            const cleanKeyHash = `0x${keyHash.replace('0x', '')}`;
            const cleanSessionHash = `0x${sessionHash.replace('0x', '')}`;

            const result = await this.callReadOnly(
                this.spokeContract.address,
                this.spokeContract.name,
                'get-remaining-budget',
                [cleanKeyHash, cleanSessionHash]
            );

            if (result && result.value !== undefined) {
                return BigInt(result.value);
            }
            return 0n;
        } catch {
            return 0n;
        }
    }

    // ========================================================================
    // Stacks-Specific: Protocol Status
    // ========================================================================

    /**
     * Check if the spoke contract is paused.
     */
    async isProtocolPaused(): Promise<boolean> {
        if (!this.spokeContract) {
            return false;
        }

        try {
            const result = await this.callReadOnly(
                this.spokeContract.address,
                this.spokeContract.name,
                'is-paused',
                []
            );

            return result === true || result?.value === true;
        } catch {
            return false;
        }
    }

    /**
     * Get global identity count.
     */
    async getIdentityCount(): Promise<bigint> {
        if (!this.spokeContract) {
            return 0n;
        }

        try {
            const result = await this.callReadOnly(
                this.spokeContract.address,
                this.spokeContract.name,
                'get-identity-count',
                []
            );

            return BigInt(result?.value || result || 0);
        } catch {
            return 0n;
        }
    }

    /**
     * Get total STX deposited across all vaults.
     */
    async getTotalStxDeposited(): Promise<bigint> {
        if (!this.vaultContract) {
            return 0n;
        }

        try {
            const result = await this.callReadOnly(
                this.vaultContract.address,
                this.vaultContract.name,
                'get-total-stx-deposited',
                []
            );

            return BigInt(result?.value || result || 0);
        } catch {
            return 0n;
        }
    }

    // ========================================================================
    // Session Management (Issue #13)
    // ========================================================================

    /**
     * Register a session key on the Stacks spoke.
     * On Stacks, sessions are managed directly on the spoke contract
     * (unlike EVM spokes where sessions are on the Hub).
     */
    async registerSession(_params: RegisterSessionParams): Promise<void> {
        throw new Error(
            'Session registration on Stacks requires a Passkey signature. ' +
            'Build a register-session transaction with the Passkey signature, ' +
            'then submit via the relayer for sponsored execution.'
        );
    }

    /**
     * Revoke a session key on the Stacks spoke.
     */
    async revokeSession(_params: RevokeSessionParams): Promise<void> {
        throw new Error(
            'Session revocation on Stacks requires a Passkey signature. ' +
            'Build a revoke-session transaction with the Passkey signature, ' +
            'then submit via the relayer for sponsored execution.'
        );
    }

    /**
     * Check if a session is active.
     */
    async isSessionActive(
        userKeyHash: string,
        sessionKeyHash: string
    ): Promise<SessionValidationResult> {
        const active = await this.checkSessionActive(userKeyHash, sessionKeyHash);
        const session = await this.getSession(userKeyHash, sessionKeyHash);

        return {
            isActive: active,
            expiry: session ? Number(session.expiry) : 0,
            maxValue: session?.maxValue ?? 0n,
            chainScopes: [this.config.wormholeChainId],
        };
    }

    /**
     * Get all sessions for a user.
     * Note: Clarity maps don't support enumeration, so this requires
     * off-chain indexing or event log parsing.
     */
    async getUserSessions(_userKeyHash: string): Promise<SessionKey[]> {
        throw new Error(
            'Enumerating all sessions is not supported on Stacks (Clarity maps are not iterable). ' +
            'Use checkSessionActive() with a known session hash, or query the Stacks event log ' +
            'for "session-registered" print events via the Hiro API.'
        );
    }

    // ========================================================================
    // Stacks-Specific: Transaction Status
    // ========================================================================

    /**
     * Get the status of a Stacks transaction.
     */
    async getTransactionStatus(txId: string): Promise<{
        status: 'pending' | 'success' | 'failed' | 'not_found';
        blockHeight?: number;
        error?: string;
    }> {
        try {
            const cleanTxId = txId.startsWith('0x') ? txId : `0x${txId}`;
            const response = await fetch(
                `${this.rpcUrl}/extended/v1/tx/${cleanTxId}`
            );

            if (!response.ok) {
                return { status: 'not_found' };
            }

            const data = await response.json() as Record<string, unknown>;
            const txStatus = data.tx_status as string;

            if (txStatus === 'success') {
                return {
                    status: 'success',
                    blockHeight: data.block_height as number,
                };
            }

            if (txStatus === 'pending') {
                return { status: 'pending' };
            }

            if (txStatus === 'abort_by_response' || txStatus === 'abort_by_post_condition') {
                return {
                    status: 'failed',
                    error: `Transaction aborted: ${txStatus}`,
                };
            }

            return { status: 'pending' };
        } catch {
            return { status: 'not_found' };
        }
    }

    /**
     * Wait for a transaction to be confirmed.
     *
     * @param txId - Transaction ID
     * @param maxAttempts - Maximum polling attempts (default: 60)
     * @param pollIntervalMs - Polling interval in milliseconds (default: 5000)
     */
    async waitForConfirmation(
        txId: string,
        maxAttempts: number = 60,
        pollIntervalMs: number = 5000
    ): Promise<{ confirmed: boolean; blockHeight?: number }> {
        for (let i = 0; i < maxAttempts; i++) {
            const status = await this.getTransactionStatus(txId);

            if (status.status === 'success') {
                return { confirmed: true, blockHeight: status.blockHeight };
            }

            if (status.status === 'failed') {
                throw new Error(`Transaction failed: ${status.error}`);
            }

            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        return { confirmed: false };
    }

    // ========================================================================
    // Stacks-Specific: Network Info
    // ========================================================================

    /**
     * Get Stacks network info (block height, network version, etc.).
     */
    async getNetworkInfo(): Promise<{
        networkId: number;
        stacksBlockHeight: number;
        burnBlockHeight: number;
        serverVersion: string;
    }> {
        const response = await fetch(`${this.rpcUrl}/v2/info`);
        if (!response.ok) {
            throw new Error(`Failed to get Stacks network info: ${response.statusText}`);
        }

        const data = await response.json() as Record<string, unknown>;
        return {
            networkId: data.network_id as number,
            stacksBlockHeight: data.stacks_tip_height as number,
            burnBlockHeight: data.burn_block_height as number,
            serverVersion: data.server_version as string,
        };
    }

    /**
     * Get the current Stacks block height.
     * Used for session expiry calculations.
     */
    async getCurrentBlockHeight(): Promise<number> {
        const info = await this.getNetworkInfo();
        return info.stacksBlockHeight;
    }

    // ========================================================================
    // Internal: Read-Only Contract Calls via Hiro API
    // ========================================================================

    /**
     * Call a read-only Clarity function via the Hiro API.
     * Uses the /v2/contracts/call-read endpoint.
     */
    private async callReadOnly(
        contractAddress: string,
        contractName: string,
        functionName: string,
        args: string[]
    ): Promise<any> {
        const url = `${this.rpcUrl}/v2/contracts/call-read/${contractAddress}/${contractName}/${functionName}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sender: contractAddress,
                arguments: args,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(
                `Read-only call failed: ${contractAddress}.${contractName}::${functionName} - ` +
                `${response.status}: ${errorText}`
            );
        }

        const data = await response.json() as Record<string, unknown>;

        if (!data.okay) {
            throw new Error(
                `Read-only call returned error: ${contractAddress}.${contractName}::${functionName} - ` +
                `${data.cause || 'Unknown cause'}`
            );
        }

        // Parse the Clarity value from the hex result
        return this.parseClarityValue(data.result as string);
    }

    /**
     * Parse a hex-encoded Clarity value from the API response.
     * This is a simplified parser for common Clarity types.
     */
    private parseClarityValue(hex: string): any {
        if (!hex || hex === '0x') {
            return null;
        }

        const bytes = hexToBytes(hex);
        if (bytes.length === 0) {
            return null;
        }

        const typeId = bytes[0];

        switch (typeId) {
            // int (0x00)
            case 0x00: {
                let value = 0n;
                for (let i = 1; i < 17 && i < bytes.length; i++) {
                    value = (value << 8n) | BigInt(bytes[i]!);
                }
                return { value };
            }
            // uint (0x01)
            case 0x01: {
                let value = 0n;
                for (let i = 1; i < 17 && i < bytes.length; i++) {
                    value = (value << 8n) | BigInt(bytes[i]!);
                }
                return { value };
            }
            // buffer (0x02)
            case 0x02: {
                const len = (bytes[1]! << 24) | (bytes[2]! << 16) | (bytes[3]! << 8) | bytes[4]!;
                const bufValue = bytes.slice(5, 5 + len);
                return { value: '0x' + bytesToHex(bufValue) };
            }
            // bool true (0x03)
            case 0x03:
                return true;
            // bool false (0x04)
            case 0x04:
                return false;
            // optional none (0x09)
            case 0x09:
                return null;
            // optional some (0x0a)
            case 0x0a:
                return this.parseClarityValue('0x' + bytesToHex(bytes.slice(1)));
            // response ok (0x07)
            case 0x07:
                return this.parseClarityValue('0x' + bytesToHex(bytes.slice(1)));
            // response err (0x08)
            case 0x08: {
                const errVal = this.parseClarityValue('0x' + bytesToHex(bytes.slice(1)));
                throw new Error(`Clarity error: ${JSON.stringify(errVal)}`);
            }
            // tuple (0x0c)
            case 0x0c: {
                // Simplified tuple parsing - return raw for now
                return { value: hex };
            }
            default:
                return { value: hex };
        }
    }
}
