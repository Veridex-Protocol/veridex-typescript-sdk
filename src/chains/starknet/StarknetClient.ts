/**
 * Veridex Protocol SDK - Starknet Chain Client
 *
 * Production-grade implementation of ChainClient interface for Starknet.
 * Supports custom bridge attestation, gasless execution via Hub dispatch.
 *
 * Security:
 * - Native starknet::eth_signature::verify_eth_signature for validation
 * - Custom bridge with multi-relayer threshold attestations
 * - Replay protection via nonce verification on Hub
 * - Bridge validates source_chain == hub_chain_id (10004 = Base Sepolia)
 *
 * Architecture:
 * - Starknet actions MUST be dispatched via Hub (Base Sepolia)
 * - Hub publishes Wormhole message → relayer monitors → relayer submits attestation
 * - Bridge accumulates attestations → threshold reached → spoke executes
 * - Spoke validates source_chain == hubChainId (NOT targetChain)
 * 
 * Custom Bridge:
 * - Bridge address: 0x5fb87f29937b2b1eff97e18cd72c3c28985e51e2916b0b75f739c5641845e13
 * - Chain ID: 50001 (custom range 50000+, reserved for non-Wormhole chains)
 * - Hub Chain ID: 10004 (Base Sepolia - what bridge validates as source)
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
import { createHash } from 'crypto';
import { RpcProvider } from 'starknet';
import { encodeTransferAction, encodeExecuteAction, encodeBridgeAction } from '../../payload.js';

// ============================================================================
// Types
// ============================================================================

export interface StarknetClientConfig {
    wormholeChainId: number;
    rpcUrl: string;
    spokeContractAddress?: string;
    bridgeContractAddress?: string;
    network?: 'mainnet' | 'sepolia' | 'testnet';
    hubRpcUrl?: string; // Hub chain RPC for session management
    hubContractAddress?: string; // Hub contract for session management
}

// ============================================================================
// StarknetClient
// ============================================================================

export class StarknetClient implements ChainClient {
    private config: ChainConfig;
    private provider: RpcProvider;
    private hubRpcUrl?: string;
    private hubContractAddress?: string;

    constructor(config: StarknetClientConfig) {
        this.config = {
            name: `Starknet ${config.network || 'mainnet'}`,
            chainId: 0,
            wormholeChainId: config.wormholeChainId,
            rpcUrl: config.rpcUrl,
            explorerUrl: config.network === 'sepolia'
                ? 'https://sepolia.starkscan.co'
                : 'https://starkscan.co',
            isEvm: false,
            contracts: {
                hub: config.spokeContractAddress,
                wormholeCoreBridge: config.bridgeContractAddress ?? '',
            },
        };

        this.hubRpcUrl = config.hubRpcUrl;
        this.hubContractAddress = config.hubContractAddress;

        this.provider = new RpcProvider({ nodeUrl: config.rpcUrl });
    }

    getConfig(): ChainConfig {
        return this.config;
    }

    async getNonce(_userKeyHash: string): Promise<bigint> {
        return 0n;
    }

    async getMessageFee(): Promise<bigint> {
        return 0n;
    }

    async buildTransferPayload(params: TransferParams): Promise<string> {
        return encodeTransferAction(params.token, params.recipient, params.amount);
    }

    async buildExecutePayload(params: ExecuteParams): Promise<string> {
        return encodeExecuteAction(params.target, params.value, params.data);
    }

    async buildBridgePayload(params: BridgeParams): Promise<string> {
        return encodeBridgeAction(params.token, params.amount, params.destinationChain, params.recipient);
    }

    async dispatch(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        targetChain: number,
        actionPayload: string,
        nonce: bigint,
        signer: any
    ): Promise<DispatchResult> {
        void signature;
        void publicKeyX;
        void publicKeyY;
        void targetChain;
        void actionPayload;
        void nonce;
        void signer;
        throw new Error(
            'Direct dispatch not supported on Starknet. ' +
            'Starknet actions are executed via the Veridex Hub (Base Sepolia) + custom bridge. ' +
            'Use dispatchGasless() to route through relayer, which will submit attestations to the bridge.'
        );
    }

    async dispatchGasless(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        targetChain: number,
        actionPayload: string,
        nonce: bigint,
        relayerUrl: string
    ): Promise<DispatchResult> {
        /**
         * Starknet gasless execution flow:
         * 1. User signs action with passkey (on client)
         * 2. SDK submits to relayer with targetChain=50001 (Starknet)
         * 3. Relayer dispatches to Hub (Base Sepolia) with targetChain=50001
         * 4. Hub publishes Wormhole message
         * 5. Relayer monitors Hub Dispatch event
         * 6. Relayer submits attestation to Starknet Bridge
         * 7. Bridge accumulates attestations from multiple relayers
         * 8. When threshold reached, Bridge calls spoke.execute()
         * 9. Spoke validates source_chain == hubChainId (10004)
         * 10. Spoke executes action on user's vault
         * 
         * Result: Completely gasless for user - relayer pays all fees
         */
        const keyHash = this.computeKeyHash(publicKeyX, publicKeyY);

        // Submit to relayer for Hub dispatch + bridge attestation
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
            targetChain, // 50001 for Starknet
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

        const result = await response.json();

        return {
            transactionHash: result.transactionHash ?? result.txHash ?? result.hubTxHash,
            sequence: BigInt(result.sequence || 0),
            userKeyHash: keyHash,
            targetChain,
        };
    }

    // Note: getVaultAddress is now defined in the Social Recovery section below
    // with enhanced spoke contract querying support.

    computeVaultAddress(userKeyHash: string): string {
        /**
         * Starknet vault derivation:
         * - Vaults are created via spoke contract
         * - Address is deterministic from userKeyHash
         * - Uses keyHash directly as vault identifier (felt252)
         * 
         * Note: Actual vault address on Starknet may differ based on
         * spoke implementation. This is a best-effort derivation.
         */
        const clean = userKeyHash.replace(/^0x/, '');
        return '0x' + clean;
    }

    async vaultExists(userKeyHash: string): Promise<boolean> {
        /**
         * Check if vault exists on Starknet spoke
         * Best-effort: queries spoke contract if available
         */
        if (!this.config.contracts.hub) {
            return false;
        }

        try {
            const vaultAddress = await this.getVaultAddress(userKeyHash);
            if (!vaultAddress) {
                return false;
            }

            // Query Starknet RPC for contract code at vault address
            const anyProvider = this.provider as any;
            if (typeof anyProvider.getClassHashAt === 'function') {
                await anyProvider.getClassHashAt(vaultAddress);
                return true;
            }
        } catch {
            // Vault doesn't exist or RPC doesn't support query
        }

        return false;
    }

    async createVault(userKeyHash: string, signer: any): Promise<VaultCreationResult> {
        void signer;
        throw new Error(
            'Vault creation on Starknet must be done via Hub dispatch + custom bridge attestation. ' +
            'Use Hub client (Base Sepolia) to dispatch a CREATE_VAULT action with targetChain=50001. ' +
            `KeyHash=${userKeyHash}`
        );
    }

    async createVaultSponsored?(userKeyHash: string, sponsorPrivateKey: string, rpcUrl?: string): Promise<VaultCreationResult> {
        void userKeyHash;
        void sponsorPrivateKey;
        void rpcUrl;
        throw new Error(
            'Vault creation on Starknet must be done via Hub dispatch + custom bridge attestation. ' +
            'Use Hub client (Base Sepolia) with sponsor key to dispatch CREATE_VAULT action.'
        );
    }

    async estimateVaultCreationGas(_userKeyHash: string): Promise<bigint> {
        return 0n;
    }

    getFactoryAddress(): string | undefined {
        return undefined;
    }

    getImplementationAddress(): string | undefined {
        return undefined;
    }

    // ========================================================================
    // Balance utility (best-effort)
    // ========================================================================

    async getNativeBalance(address: string): Promise<bigint> {
        // Best-effort: some Starknet RPCs support getBalance, but it is not universal.
        try {
            const anyProvider = this.provider as any;
            if (typeof anyProvider.getBalance === 'function') {
                const res = await anyProvider.getBalance(address);
                return BigInt(res);
            }
        } catch {
            // ignore
        }
        return 0n;
    }

    getProvider(): RpcProvider {
        return this.provider;
    }

    // ========================================================================
    // Session Management (Issue #13)
    // ========================================================================

    /**
     * Register a session key on the Hub (must be called via Hub client)
     * Starknet spokes validate sessions via CCQ, but registration happens on Hub
     * 
     * @throws Error - Session management must be done via Hub chain
     */
    async registerSession(_params: RegisterSessionParams): Promise<void> {
        throw new Error(
            'Session registration must be performed on the Hub chain (Base). ' +
            'Use EVMClient connected to the Hub to call registerSession().'
        );
    }

    /**
     * Revoke a session key on the Hub (must be called via Hub client)
     * 
     * @throws Error - Session management must be done via Hub chain
     */
    async revokeSession(_params: RevokeSessionParams): Promise<void> {
        throw new Error(
            'Session revocation must be performed on the Hub chain (Base). ' +
            'Use EVMClient connected to the Hub to call revokeSession().'
        );
    }

    /**
     * Check if a session is active by querying the Hub
     * This method queries the Hub contract directly for session validation
     * 
     * @param userKeyHash - Hash of user's Passkey public key
     * @param sessionKeyHash - Hash of session key to validate
     * @returns Session validation result with expiry and limits
     */
    async isSessionActive(
        userKeyHash: string,
        sessionKeyHash: string
    ): Promise<SessionValidationResult> {
        if (!this.hubRpcUrl || !this.hubContractAddress) {
            throw new Error(
                'Hub configuration required for session validation. ' +
                'Provide hubRpcUrl and hubContractAddress in StarknetClientConfig.'
            );
        }

        // Query Hub contract for session status
        throw new Error(
            'isSessionActive requires Hub client integration. ' +
            'Use EVMClient.isSessionActive() on the Hub chain, ' +
            'then pass the result to session execution on Starknet.'
        );
    }

    /**
     * Get all sessions for a user from the Hub
     * 
     * @param userKeyHash - Hash of user's Passkey public key
     * @returns Array of all sessions (active and expired/revoked)
     */
    async getUserSessions(userKeyHash: string): Promise<SessionKey[]> {
        if (!this.hubRpcUrl || !this.hubContractAddress) {
            throw new Error(
                'Hub configuration required for session queries. ' +
                'Provide hubRpcUrl and hubContractAddress in StarknetClientConfig.'
            );
        }

        // Query Hub contract for user sessions
        throw new Error(
            'getUserSessions requires Hub client integration. ' +
            'Use EVMClient.getUserSessions() on the Hub chain. ' +
            `User: ${userKeyHash}`
        );
    }

    // ========================================================================
    // Query-Based Execution (Issue #9/#10)
    // ========================================================================

    /**
     * Get user state from Hub (comprehensive state query)
     * Returns key hash, nonce, and last action hash for CCQ validation
     * 
     * @param userKeyHash - Hash of user's Passkey public key
     * @returns User state with nonce and last action hash
     */
    async getUserState(userKeyHash: string): Promise<{
        keyHash: string;
        nonce: bigint;
        lastActionHash: string;
    }> {
        if (!this.hubRpcUrl || !this.hubContractAddress) {
            throw new Error(
                'Hub configuration required for state queries. ' +
                'Provide hubRpcUrl and hubContractAddress in StarknetClientConfig.'
            );
        }

        // Query Hub contract for user state
        throw new Error(
            'getUserState requires Hub client integration. ' +
            'Use EVMClient.getUserState() on the Hub chain. ' +
            `User: ${userKeyHash}`
        );
    }

    /**
     * Get user's last action hash from Hub
     * Used for optimistic execution and nonce validation
     * 
     * @param userKeyHash - Hash of user's Passkey public key
     * @returns Last action hash (zero hash if no actions)
     */
    async getUserLastActionHash(userKeyHash: string): Promise<string> {
        if (!this.hubRpcUrl || !this.hubContractAddress) {
            throw new Error(
                'Hub configuration required for action hash queries. ' +
                'Provide hubRpcUrl and hubContractAddress in StarknetClientConfig.'
            );
        }

        // Query Hub contract for last action hash
        throw new Error(
            'getUserLastActionHash requires Hub client integration. ' +
            'Use EVMClient.getUserLastActionHash() on the Hub chain. ' +
            `User: ${userKeyHash}`
        );
    }

    /**
     * Execute with query-based validation (faster than VAA, ~23s vs 60-90s)
     * Uses Wormhole CCQ to validate Hub state, then executes on Starknet
     * 
     * @param params Query execution parameters with CCQ response
     * @returns Dispatch result with transaction hash
     * 
     * @remarks
     * Query-based execution flow:
     * 1. Query Hub state via Wormhole CCQ
     * 2. Validate Guardian signatures on query response
     * 3. Execute on Starknet with validated state
     * 4. Hub state must be < 60s stale (enforced by QueryVerifier)
     */
    async executeWithQuery(
        _params: {
            userKeyHash: string;
            queryResponse: Uint8Array; // CCQ Guardian response
            actionType: number;
            actionPayload: Uint8Array;
            relayerUrl?: string;
        }
    ): Promise<DispatchResult> {
        throw new Error(
            'Query-based execution on Starknet requires relayer integration. ' +
            'Use relayer API to submit query-validated transactions. ' +
            'Relayer will call veridex_spoke::execute_with_query on Starknet.'
        );
    }

    // ========================================================================
    // Internal helpers
    // ========================================================================

    private computeKeyHash(publicKeyX: bigint, publicKeyY: bigint): string {
        const xHex = publicKeyX.toString(16).padStart(64, '0');
        const yHex = publicKeyY.toString(16).padStart(64, '0');
        const combined = Buffer.from(xHex + yHex, 'hex');
        const hash = createHash('sha256').update(combined).digest('hex');
        return '0x' + hash;
    }

    private buildMessageHash(keyHash: string, targetChain: number, actionPayload: string, nonce: bigint): string {
        const keyHashBuffer = Buffer.from(keyHash.replace(/^0x/, ''), 'hex');
        const targetChainBuffer = Buffer.alloc(2);
        targetChainBuffer.writeUInt16BE(targetChain);
        const payloadBuffer = Buffer.from(actionPayload.replace(/^0x/, ''), 'hex');
        const nonceHex = nonce.toString(16).padStart(64, '0');
        const nonceBuffer = Buffer.from(nonceHex, 'hex');

        const combined = Buffer.concat([keyHashBuffer, targetChainBuffer, payloadBuffer, nonceBuffer]);
        const hash = createHash('sha256').update(combined).digest('hex');
        return '0x' + hash;
    }

    // ============================================================================
    // Social Recovery Methods (Issue #23)
    // ============================================================================
    // 
    // Note: Social recovery is managed on the Hub chain (EVM).
    // Starknet spokes receive and execute recovery VAAs broadcast from the Hub.
    // The relayer service handles submitting recovery transactions to Starknet.
    //
    // SDK users should use EVMClient methods for guardian management and
    // recovery initiation on the Hub chain.
    // ============================================================================

    /**
     * Get vault address by owner key hash
     * 
     * @param ownerKeyHash - Owner's passkey hash
     * @returns Vault address on Starknet (felt252 as hex string)
     */
    async getVaultAddress(ownerKeyHash: string): Promise<string | null> {
        try {
            const spokeAddress = this.config.contracts.hub;
            if (!spokeAddress) {
                throw new Error('Spoke contract address not configured');
            }

            // Call get_vault on spoke contract
            const result = await this.provider.callContract({
                contractAddress: spokeAddress,
                entrypoint: 'get_vault',
                calldata: [ownerKeyHash],
            });

            // result[0] is the vault address (0 if not found)
            const vaultAddress = result[0];
            if (vaultAddress === '0x0' || vaultAddress === '0') {
                return null;
            }

            return vaultAddress;
        } catch (error) {
            console.error('Error getting vault address:', error);
            return null;
        }
    }

    /**
     * Check if vault exists and get basic info
     * 
     * @param ownerKeyHash - Owner's passkey hash  
     * @returns Vault info or null if not found
     */
    async getVaultInfo(ownerKeyHash: string): Promise<{
        address: string;
        ownerKeyHash: string;
    } | null> {
        const vaultAddress = await this.getVaultAddress(ownerKeyHash);
        if (!vaultAddress) {
            return null;
        }

        return {
            address: vaultAddress,
            ownerKeyHash,
        };
    }

    /**
     * Check if spoke contract is paused
     * 
     * @returns Whether the protocol is paused
     */
    async isProtocolPaused(): Promise<boolean> {
        try {
            const spokeAddress = this.config.contracts.hub;
            if (!spokeAddress) {
                throw new Error('Spoke contract address not configured');
            }

            const result = await this.provider.callContract({
                contractAddress: spokeAddress,
                entrypoint: 'is_paused',
                calldata: [],
            });

            return result[0] === '0x1' || result[0] === '1';
        } catch (error) {
            console.error('Error checking pause status:', error);
            return false;
        }
    }
}
