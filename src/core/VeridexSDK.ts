/**
 * Veridex Protocol SDK - Main SDK Class
 */

import { PasskeyManager } from './PasskeyManager.js';
import { WalletManager } from './WalletManager.js';
import { BalanceManager, type TokenBalance, type PortfolioBalance } from './BalanceManager.js';
import { TransactionTracker, type TransactionState, type TransactionCallback } from './TransactionTracker.js';
import { 
    CrossChainManager, 
    type CrossChainResult,
    type CrossChainFees,
    type CrossChainProgressCallback,
} from './CrossChainManager.js';
import { RelayerClient, type SubmitSignedActionRequest } from './RelayerClient.js';
import { ChainDetector } from './ChainDetector.js';
import { TransactionParser } from './TransactionParser.js';
import type { TransactionSummary } from './TransactionSummary.types.js';
import { SpendingLimitsManager } from './SpendingLimitsManager.js';
import { AccountManager } from './AccountManager.js';
import { RecoveryManager } from './RecoveryManager.js';
import { MultisigManager } from './MultisigManager.js';
import { buildCapabilityMatrix, CHAIN_CAPABILITIES } from './PolicyEnforcement.js';
import type { PlatformCapabilityMatrix, ChainCapabilities } from './PolicyEnforcement.js';
import { normalizeError, VeridexError, VeridexErrorCode } from './VeridexError.js';
import { BalanceWatcher } from './BalanceWatcher.js';
import type { BalanceChangeCallback, BalanceErrorCallback, BalanceWatcherOptions, Unsubscribe } from './BalanceWatcher.js';
import type { SpendingLimits, FormattedSpendingLimits, LimitCheckResult } from './SpendingLimits.types.js';
import { ethers } from 'ethers';
// NOTE: authenticateAndPrepare and queryPortfolio are loaded via dynamic import()
// to avoid pulling @wormhole-foundation/wormhole-query-sdk into the static
// module graph, which causes a TDZ crash in browser/SSR bundles.
import { 
    GasSponsor, 
    type SponsoredVaultResult, 
    type MultiChainVaultResult,
    type ChainDeploymentConfig,
} from './GasSponsor.js';
import { buildChallenge, buildGaslessChallenge } from '../payload.js';
import { normalizeEmitterAddress } from '../wormhole.js';
import { 
    getAllTokens, 
    getTokenBySymbol, 
    isNativeToken,
    type TokenInfo 
} from '../constants/tokens.js';
import type {
    VeridexConfig,
    ChainClient,
    PasskeyCredential,
    TransferParams,
    ExecuteParams,
    BridgeParams,
    DispatchResult,
    VaultInfo,
    UnifiedIdentity,
    ChainAddress,
    VaultCreationResult,
    PreparedTransfer,
    TransferResult,
    ReceiveAddress,
    BridgeResult,
    PreparedBridge,
    IdentityState,
    AddBackupKeyResult,
    RemoveKeyResult,
    AuthorizedKey,
} from './types.js';

/** Default expiration time for prepared transfers (5 minutes) */
const DEFAULT_PREPARED_TRANSFER_TTL = 5 * 60 * 1000;
/** Maximum allowed TTL for prepared transfers (30 minutes) */
const MAX_PREPARED_TRANSFER_TTL = 30 * 60 * 1000;

export class VeridexSDK {
    public readonly passkey: PasskeyManager;
    public readonly wallet: WalletManager;
    public readonly account: AccountManager;
    public readonly balance: BalanceManager;
    public readonly transactions: TransactionTracker;
    public readonly crossChain: CrossChainManager;
    public readonly sponsor: GasSponsor;
    public readonly transactionParser: TransactionParser;
    public readonly spendingLimits: SpendingLimitsManager;
    public readonly recovery: RecoveryManager | null;
    public readonly multisig: MultisigManager | null;
    public readonly balanceWatcher: BalanceWatcher;
    private readonly chain: ChainClient;
    private readonly relayer?: RelayerClient;
    // TODO: Use relayerApiKey when relayer integration is complete (Issue #8)
    // private readonly relayerApiKey?: string;
    private readonly queryApiKey?: string;
    private readonly testnet: boolean;
    private readonly sponsorPrivateKey?: string;
    private readonly chainRpcUrls?: Record<number, string>;
    private readonly chainDetector: ChainDetector;
    private readonly preparedTransferTtl: number;
    private unifiedIdentity: UnifiedIdentity | null = null;

    constructor(config: VeridexConfig) {
        this.chain = config.chain;
        this.testnet = config.testnet ?? true;
        this.sponsorPrivateKey = config.sponsorPrivateKey;
        this.chainRpcUrls = config.chainRpcUrls;
        // TODO: Uncomment when relayerApiKey is used (Issue #8)
        // this.relayerApiKey = config.relayerApiKey;
        this.queryApiKey = config.queryApiKey ?? config.relayerApiKey;
        this.passkey = new PasskeyManager({
            relayerUrl: config.relayerUrl,
        });
        this.wallet = new WalletManager({
            cacheAddresses: true,
            persistToStorage: config.persistWallet ?? true,
        });
        this.balance = new BalanceManager({
            cacheBalances: true,
            cacheTtl: 30_000, // 30 seconds
            customRpcUrls: config.chainRpcUrls ?? {},
        });
        this.transactions = new TransactionTracker({
            pollingInterval: 2000,
            requiredConfirmations: 1,
        });

        this.chainDetector = new ChainDetector({
            testnet: this.testnet,
            rpcUrls: config.chainRpcUrls ?? {},
        });
        this.crossChain = new CrossChainManager({
            testnet: this.testnet,
            relayerUrl: config.relayerUrl,
            autoRelay: !!config.relayerUrl,
        });
        this.sponsor = new GasSponsor({
            // Veridex fallback sponsorship
            sponsorPrivateKey: config.sponsorPrivateKey,
            // Integrator-provided sponsorship (takes priority over Veridex)
            integratorSponsorKey: config.integratorSponsorKey,
            // Relayer for remote sponsorship (future primary method)
            relayerUrl: config.relayerUrl,
            relayerApiKey: config.relayerApiKey,
            // Chain configuration
            testnet: this.testnet,
            customRpcUrls: config.chainRpcUrls,
        });

        // Initialize relayer client if URL provided
        if (config.relayerUrl) {
            this.relayer = new RelayerClient({
                baseUrl: config.relayerUrl,
                apiKey: config.relayerApiKey,
            });
        }

        this.account = new AccountManager({
            passkey: this.passkey,
            wallet: this.wallet,
            chain: this.chain,
            relayer: this.relayer,
            testnet: this.testnet,
            getUnifiedIdentity: () => this.getUnifiedIdentity(),
        });

        // Initialize transaction parser for human-readable summaries (Issue #26)
        this.transactionParser = new TransactionParser({
            defaultChainId: this.chain.getConfig().wormholeChainId,
            // TODO: Integrate ENS resolution via relayer when available
            // resolveEnsName: async (address) => { ... }
            // TODO: Integrate price oracle when available
            // getTokenPrice: async (token, chainId) => { ... }
        });

        // Initialize recovery manager (ADR-0040) — only on recovery-capable chains
        try {
            this.recovery = new RecoveryManager({
                passkey: this.passkey,
                chain: this.chain,
            });
        } catch {
            this.recovery = null;
        }

        // Initialize multisig manager (ADR-0037) — only on multisig-capable chains
        try {
            this.multisig = new MultisigManager({
                passkey: this.passkey,
                chain: this.chain,
            });
        } catch {
            this.multisig = null;
        }

        // Initialize spending limits manager (Issue #27)
        this.spendingLimits = new SpendingLimitsManager({
            defaultDecimals: 18,
            defaultSymbol: this.chain.getConfig().name.includes('Solana') ? 'SOL' : 'ETH',
            rpcUrls: config.chainRpcUrls ?? {},
            cacheTtl: 10000, // 10 seconds
        });

        // Initialize balance watcher (polling-based subscription)
        this.balanceWatcher = new BalanceWatcher(
            async (chainId, address) => {
                return this.balance.getPortfolioBalance(chainId, address, false);
            },
        );

        // Configurable TTL for prepared transfers (clamped to MAX)
        this.preparedTransferTtl = Math.min(
            config.preparedTransferTtl ?? DEFAULT_PREPARED_TRANSFER_TTL,
            MAX_PREPARED_TRANSFER_TTL,
        );
    }

    getChainConfig() {
        return this.chain.getConfig();
    }

    getChainClient(): ChainClient {
        return this.chain;
    }

    /**
     * Returns a capability matrix for the current chain, useful for integrator
     * UIs to understand what operations the platform supports.
     */
    getCapabilityMatrix(platformInfo?: {
        webauthnSupported: boolean;
        conditionalUISupported: boolean;
        platformAuthenticatorAvailable: boolean;
    }): PlatformCapabilityMatrix {
        const config = this.chain.getConfig();
        const platform = platformInfo ?? {
            webauthnSupported: typeof globalThis !== 'undefined' && 'PublicKeyCredential' in globalThis,
            conditionalUISupported: false,
            platformAuthenticatorAvailable: false,
        };
        return buildCapabilityMatrix(config.name.toLowerCase(), platform, !!this.relayer);
    }

    /**
     * Check if a specific feature is supported on the current chain.
     *
     * Unlike `getCapabilityMatrix()` which returns the full matrix, this is a
     * simple boolean check for the most common per-chain capability queries.
     *
     * @param feature - Feature name to check
     * @returns `true` if fully or partially supported; `false` if unsupported
     *
     * @example
     * ```typescript
     * if (sdk.supportsFeature('recovery')) {
     *   // Show recovery UI
     * }
     * ```
     */
    supportsFeature(feature: keyof ChainCapabilities): boolean {
        const chainType = this.chain.getConfig().name.toLowerCase();
        // Resolve the canonical chain type string used in CHAIN_CAPABILITIES
        const type = this.resolveChainType(chainType);
        const caps = CHAIN_CAPABILITIES[type];
        if (!caps) return false;
        return caps[feature] !== 'unsupported';
    }

    /**
     * Resolve a chain name to its CHAIN_CAPABILITIES key.
     */
    private resolveChainType(chainName: string): string {
        // Direct match
        if (CHAIN_CAPABILITIES[chainName]) return chainName;
        // Common renames
        if (chainName.includes('base') || chainName.includes('optimism') || chainName.includes('arbitrum') || chainName.includes('ethereum') || chainName.includes('polygon') || chainName.includes('celo')) return 'evm';
        if (chainName.includes('avalanche') || chainName.includes('fuji')) return 'avalanche';
        if (chainName.includes('solana')) return 'solana';
        if (chainName.includes('aptos')) return 'aptos';
        if (chainName.includes('sui')) return 'sui';
        if (chainName.includes('starknet')) return 'starknet';
        if (chainName.includes('stacks')) return 'stacks';
        return 'evm'; // safe default
    }

    /**
     * Watch for balance changes on a vault.
     *
     * Uses polling under the hood; the returned function stops the watcher.
     *
     * @example
     * ```typescript
     * const unsub = sdk.watchBalance(
     *   (event) => console.log('Balance changed:', event.changes),
     *   { intervalMs: 10_000 },
     * );
     *
     * // later
     * unsub();
     * ```
     */
    watchBalance(
        onChange: BalanceChangeCallback,
        options?: BalanceWatcherOptions,
        onError?: BalanceErrorCallback,
    ): Unsubscribe {
        const chainConfig = this.chain.getConfig();
        const vaultAddress = this.getVaultAddress();
        return this.balanceWatcher.watch(
            chainConfig.wormholeChainId,
            vaultAddress,
            onChange,
            options,
            onError,
        );
    }

    async getNonce(): Promise<bigint> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }
        return await this.chain.getNonce(credential.keyHash);
    }

    async getMessageFee(): Promise<bigint> {
        return await this.chain.getMessageFee();
    }

    async buildTransferPayload(params: TransferParams): Promise<string> {
        return await this.chain.buildTransferPayload(params);
    }

    async buildExecutePayload(params: ExecuteParams): Promise<string> {
        return await this.chain.buildExecutePayload(params);
    }

    async buildBridgePayload(params: BridgeParams): Promise<string> {
        return await this.chain.buildBridgePayload(params);
    }

    async transfer(params: TransferParams, signer: any): Promise<DispatchResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // ADR-0037: Block direct dispatch if multisig policy protects transfers
        await this.multisig?.assertDirectDispatchAllowed('transfer');

        try {
            const actionPayload = await this.buildTransferPayload(params);
            const nonce = await this.getNonce();
            const challenge = buildChallenge(
                credential.keyHash,
                params.targetChain,
                nonce,
                actionPayload
            );

            const signature = await this.passkey.sign(challenge);

            return await this.chain.dispatch(
                signature,
                credential.publicKeyX,
                credential.publicKeyY,
                params.targetChain,
                actionPayload,
                nonce,
                signer
            );
        } catch (err) {
            throw normalizeError(err, this.chain.getConfig().name);
        }
    }

    async execute(params: ExecuteParams, signer: any): Promise<DispatchResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // ADR-0037: Block direct dispatch if multisig policy protects executions
        await this.multisig?.assertDirectDispatchAllowed('execute');

        try {
            const actionPayload = await this.buildExecutePayload(params);
            const nonce = await this.getNonce();
            const challenge = buildChallenge(
                credential.keyHash,
                params.targetChain,
                nonce,
                actionPayload
            );

            const signature = await this.passkey.sign(challenge);

            return await this.chain.dispatch(
                signature,
                credential.publicKeyX,
                credential.publicKeyY,
                params.targetChain,
                actionPayload,
                nonce,
                signer
            );
        } catch (err) {
            throw normalizeError(err, this.chain.getConfig().name);
        }
    }

    async bridge(params: BridgeParams, signer: any): Promise<DispatchResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // ADR-0037: Block direct dispatch if multisig policy protects bridge operations
        await this.multisig?.assertDirectDispatchAllowed('bridge');

        try {
            const actionPayload = await this.buildBridgePayload(params);
            const nonce = await this.getNonce();

            const challenge = buildChallenge(
                credential.keyHash,
                params.sourceChain,
                nonce,
                actionPayload
            );

            const signature = await this.passkey.sign(challenge);

            return await this.chain.dispatch(
                signature,
                credential.publicKeyX,
                credential.publicKeyY,
                params.sourceChain,
                actionPayload,
                nonce,
                signer
            );
        } catch (err) {
            throw normalizeError(err, this.chain.getConfig().name);
        }
    }

    // ========================================================================
    // Phase 3: Cross-Chain Transfers
    // ========================================================================

    /**
     * Prepare a bridge/cross-chain transfer with fee estimation
     * 
     * @param params - Bridge parameters
     * @returns PreparedBridge with fee estimates
     */
    async prepareBridge(params: BridgeParams): Promise<PreparedBridge> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // Build payload and get nonce
        const actionPayload = await this.buildBridgePayload(params);
        const nonce = await this.getNonce();
        
        // Build challenge
        const challenge = buildChallenge(
            credential.keyHash,
            params.sourceChain,
            nonce,
            actionPayload
        );

        // Get chain config
        const chainConfig = this.chain.getConfig();

        // Estimate fees using CrossChainManager
        const evmClient = this.chain as any;
        const provider = evmClient.provider ?? evmClient.getProvider?.();
        
        let fees: CrossChainFees = {
            sourceGas: 300_000n * 1_000_000_000n, // Default estimate
            messageFee: 0n,
            relayerFee: 0n,
            totalCost: 300_000n * 1_000_000_000n,
            formattedTotal: '0.0003 ETH',
            currency: 'ETH',
        };

        if (provider) {
            try {
                fees = await this.crossChain.estimateFees(params, chainConfig, provider);
            } catch (e) {
                console.warn('Fee estimation failed, using defaults:', e);
            }
        }

        return {
            params,
            actionPayload,
            nonce,
            challenge,
            fees,
            sourceChain: params.sourceChain,
            destinationChain: params.destinationChain,
            preparedAt: Date.now(),
            expiresAt: Date.now() + this.preparedTransferTtl,
        };
    }

    /**
     * Execute a prepared bridge with full cross-chain tracking
     * 
     * @param prepared - PreparedBridge from prepareBridge()
     * @param signer - Signer to pay for gas
     * @param onProgress - Optional callback for progress updates
     * @returns BridgeResult with cross-chain tracking info
     */
    async executeBridge(
        prepared: PreparedBridge,
        signer: any,
        onProgress?: CrossChainProgressCallback
    ): Promise<BridgeResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // ADR-0037: Block direct dispatch if multisig policy protects bridge operations
        await this.multisig?.assertDirectDispatchAllowed('bridge');

        // Check expiration
        if (Date.now() > prepared.expiresAt) {
            throw new VeridexError(VeridexErrorCode.EXPIRED);
        }

        const startTime = Date.now();
        const chainConfig = this.chain.getConfig();
        const hubEmitter = normalizeEmitterAddress(chainConfig.contracts.hub ?? '');

        // Step 1: Sign with passkey
        onProgress?.({
            status: 'signing',
            step: 1,
            totalSteps: 6,
            message: 'Sign with your passkey...',
        });

        const signature = await this.passkey.sign(prepared.challenge);

        // Step 2: Dispatch transaction
        onProgress?.({
            status: 'dispatching',
            step: 2,
            totalSteps: 6,
            message: 'Submitting transaction to blockchain...',
        });

        const dispatchResult = await this.chain.dispatch(
            signature,
            credential.publicKeyX,
            credential.publicKeyY,
            prepared.params.sourceChain,
            prepared.actionPayload,
            prepared.nonce,
            signer
        );

        // Step 3: Wait for confirmations
        onProgress?.({
            status: 'waiting_confirmations',
            step: 3,
            totalSteps: 6,
            message: 'Waiting for block confirmations...',
            details: { txHash: dispatchResult.transactionHash },
        });

        // Track the cross-chain transfer
        this.crossChain.trackTransfer(
            dispatchResult.transactionHash,
            prepared.sourceChain,
            prepared.destinationChain,
            dispatchResult.sequence,
            hubEmitter
        );

        // Track in transaction tracker too
        this.transactions.track(
            dispatchResult.transactionHash,
            chainConfig.wormholeChainId,
            undefined,
            dispatchResult.sequence
        );

        // Step 4-5: Fetch VAA (CrossChainManager handles this)
        let vaa: string | undefined;
        try {
            vaa = await this.crossChain.fetchVAAByTxHash(
                dispatchResult.transactionHash,
                onProgress
            );
            
            this.crossChain.completeTransfer(
                dispatchResult.transactionHash,
                vaa
            );
        } catch (error) {
            // VAA fetch failed, but transaction was successful
            // User can retry VAA fetch later
            console.warn('VAA fetch failed:', error);
        }

        // Step 6: Submit to relayer (if configured)
        // The relayer auto-relays by observing hub Dispatch events; there is
        // currently no relay-job API to poll for destination tx hashes.
        let destinationTxHash: string | undefined;
        if (vaa && this.relayer) {
            onProgress?.({
                status: 'relaying',
                step: 6,
                totalSteps: 6,
                message: 'Relayer will submit to destination chain automatically...',
            });
        }

        onProgress?.({
            status: 'completed',
            step: 6,
            totalSteps: 6,
            message: 'Cross-chain transfer complete!',
            details: {
                txHash: dispatchResult.transactionHash,
                sequence: dispatchResult.sequence,
                vaaReady: !!vaa,
                destinationTxHash,
            },
        });

        // Schedule balance cache invalidation on confirmation
        const vaultAddress = this.getVaultAddress();
        this.transactions.track(
            dispatchResult.transactionHash,
            chainConfig.wormholeChainId,
            (state) => {
                if (state.status === 'confirmed' || state.status === 'failed') {
                    this.balance.invalidateCache(chainConfig.wormholeChainId, vaultAddress);
                }
            },
            dispatchResult.sequence
        );

        return {
            ...dispatchResult,
            params: prepared.params,
            sourceChain: prepared.sourceChain,
            destinationChain: prepared.destinationChain,
            vaa,
            destinationTxHash,
            duration: Date.now() - startTime,
            timestamp: Date.now(),
        };
    }

    /**
     * Execute a gasless bridge using the relayer
     *
     * The relayer pays for the Hub transaction (and Wormhole fee), then observes
     * the resulting Dispatch event and relays the VAA to the destination spoke.
     */
    async bridgeViaRelayer(
        params: BridgeParams,
        onProgress?: CrossChainProgressCallback
    ): Promise<BridgeResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // ADR-0037: Block direct dispatch if multisig policy protects bridge operations
        await this.multisig?.assertDirectDispatchAllowed('bridge');

        if (!this.relayer) {
            throw new VeridexError(VeridexErrorCode.RELAYER_ERROR, 'Relayer not configured. Please provide relayerUrl in SDK config.');
        }

        const startTime = Date.now();

        onProgress?.({
            status: 'preparing',
            step: 0,
            totalSteps: 6,
            message: 'Preparing gasless bridge...',
        });

        // Bridge actions target the *sourceChain* (where the vault holds funds)
        const actionPayload = await this.buildBridgePayload(params);
        const nonce = await this.getNonce();
        const chainConfig = this.chain.getConfig();
        const hubChainId = chainConfig.hubChainId ?? chainConfig.wormholeChainId;

        onProgress?.({
            status: 'signing',
            step: 1,
            totalSteps: 6,
            message: 'Sign with your passkey...',
        });

        // BRIDGE actions target sourceChain (where funds are held)
        // The destinationChain is encoded in the actionPayload itself
        // The VAA will be executed on the SOURCE vault to initiate Token Bridge transfer
        const challenge = buildGaslessChallenge(
            params.sourceChain,
            actionPayload,
            nonce,
            hubChainId
        );
        const signature = await this.passkey.sign(challenge);

        onProgress?.({
            status: 'dispatching',
            step: 2,
            totalSteps: 6,
            message: 'Submitting gasless bridge to relayer...',
        });

        // Use full WebAuthn data for authenticateAndDispatch
        // For BRIDGE: targetChain = sourceChain (where funds are)
        // The destination is in the actionPayload
        const submitRequest: SubmitSignedActionRequest = {
            authenticatorData: signature.authenticatorData,
            clientDataJSON: signature.clientDataJSON,
            challengeIndex: signature.challengeIndex,
            typeIndex: signature.typeIndex,
            r: '0x' + signature.r.toString(16).padStart(64, '0'),
            s: '0x' + signature.s.toString(16).padStart(64, '0'),
            publicKeyX: '0x' + credential.publicKeyX.toString(16).padStart(64, '0'),
            publicKeyY: '0x' + credential.publicKeyY.toString(16).padStart(64, '0'),
            targetChain: params.sourceChain,
            actionPayload,
            nonce: Number(nonce),
        };

        const relayerResult = await this.relayer.submitSignedAction(submitRequest);
        if (!relayerResult.success) {
            throw new VeridexError(VeridexErrorCode.RELAYER_ERROR, `Relayer submission failed: ${relayerResult.error}`);
        }

        const txHash = relayerResult.txHash ?? '';
        const sequence = relayerResult.sequence ? BigInt(relayerResult.sequence) : 0n;

        if (txHash) {
            this.transactions.track(txHash, hubChainId, undefined, sequence || undefined);
        }

        // Try to fetch VAA for UI feedback (relayer will still execute even if this fails)
        let vaa: string | undefined;
        try {
            vaa = await this.crossChain.fetchVAAByTxHash(txHash, onProgress);
        } catch {
            // ignore: user can retry fetch later
        }

        onProgress?.({
            status: 'completed',
            step: 6,
            totalSteps: 6,
            message: 'Gasless bridge submitted. Relayer will complete execution.',
            details: {
                txHash,
                sequence,
                vaaReady: !!vaa,
            },
        });

        // For BRIDGE: targetChain (where VAA is executed) = sourceChain
        // The actual destination for funds is in destinationChain
        return {
            transactionHash: txHash,
            sequence,
            userKeyHash: credential.keyHash,
            targetChain: params.sourceChain,
            blockNumber: 0,
            params,
            sourceChain: params.sourceChain,
            destinationChain: params.destinationChain,
            vaa,
            destinationTxHash: undefined,
            duration: Date.now() - startTime,
            timestamp: Date.now(),
        };
    }

    /**
     * Execute a full bridge with automatic preparation
     * 
     * @param params - Bridge parameters
     * @param signer - Signer to pay for gas
     * @param onProgress - Optional callback for progress updates
     * @returns BridgeResult with cross-chain tracking info
     */
    async bridgeWithTracking(
        params: BridgeParams,
        signer: any,
        onProgress?: CrossChainProgressCallback
    ): Promise<BridgeResult> {
        onProgress?.({
            status: 'preparing',
            step: 0,
            totalSteps: 6,
            message: 'Preparing cross-chain transfer...',
        });

        const prepared = await this.prepareBridge(params);
        return await this.executeBridge(prepared, signer, onProgress);
    }

    /**
     * Fetch VAA for a completed transaction
     * Use this if VAA fetch failed during bridge execution
     * 
     * @param txHash - Source chain transaction hash
     * @returns VAA base64 string
     */
    async fetchVAAForTransaction(txHash: string): Promise<string> {
        return await this.crossChain.fetchVAAByTxHash(txHash);
    }

    /**
     * Get cross-chain transfer fees
     * 
     * @param params - Bridge parameters
     * @returns CrossChainFees with breakdown
     */
    async getBridgeFees(params: BridgeParams): Promise<CrossChainFees> {
        const chainConfig = this.chain.getConfig();
        const evmClient = this.chain as any;
        const provider = evmClient.provider ?? evmClient.getProvider?.();

        if (!provider) {
            throw new VeridexError(VeridexErrorCode.RPC_ERROR, 'Provider not available');
        }

        return await this.crossChain.estimateFees(params, chainConfig, provider);
    }

    /**
     * Get all pending cross-chain transfers
     */
    getPendingBridges(): CrossChainResult[] {
        return this.crossChain.getAllPendingTransfers();
    }

    /**
     * Get Wormholescan explorer URL for a cross-chain transfer
     */
    getWormholeExplorerUrl(sequence: bigint): string {
        const chainConfig = this.chain.getConfig();
        const hubEmitter = chainConfig.contracts.hub ?? '';
        return this.crossChain.getWormholeExplorerUrl(
            chainConfig.wormholeChainId,
            hubEmitter,
            sequence
        );
    }

    // ========================================================================
    // Phase 2: Send & Receive Funds
    // ========================================================================

    /**
     * Prepare a transfer with gas estimation
     * Call this before transfer() to show user the cost
     * 
     * @param params - Transfer parameters
     * @returns PreparedTransfer with gas estimates and challenge
     */
    async prepareTransfer(params: TransferParams): Promise<PreparedTransfer> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // Build payload and get nonce
        const actionPayload = await this.buildTransferPayload(params);
        const nonce = await this.getNonce();
        
        // Build challenge
        const challenge = buildChallenge(
            credential.keyHash,
            params.targetChain,
            nonce,
            actionPayload
        );

        // Get gas estimates - need to type cast for EVM-specific methods
        const evmClient = this.chain as any;
        let estimatedGas = 500000n; // Default
        let gasPrice = 0n;
        
        if (typeof evmClient.getGasPrice === 'function') {
            gasPrice = await evmClient.getGasPrice();
        }

        // Get message fee
        const messageFee = await this.getMessageFee();

        // Calculate total cost
        const gasCost = estimatedGas * gasPrice;
        const totalCost = gasCost + messageFee;
        const formattedCost = this.formatWei(totalCost);

        return {
            params,
            actionPayload,
            nonce,
            challenge,
            estimatedGas,
            gasPrice,
            messageFee,
            totalCost,
            formattedCost,
            preparedAt: Date.now(),
            expiresAt: Date.now() + this.preparedTransferTtl,
        };
    }

    /**
     * Get a human-readable summary of a prepared transfer (Issue #26)
     * 
     * Use this to show users what they're signing before biometric authentication.
     * The summary includes:
     * - Action type (transfer, bridge, execute, config)
     * - Human-readable amounts (not wei)
     * - Recipient display (truncated address, ENS if available)
     * - Chain information
     * - Risk warnings for unusual transactions
     * - Gas cost breakdown
     * - Expiration countdown
     * 
     * @example
     * ```typescript
     * const prepared = await sdk.prepareTransfer({
     *   recipient: '0x123...',
     *   amount: '1000000000000000000', // 1 ETH in wei
     *   tokenAddress: NATIVE_TOKEN_ADDRESS,
     *   targetChain: 10004, // Base Sepolia
     * });
     * 
     * const summary = await sdk.getTransactionSummary(prepared);
     * console.log(summary.title); // "Transfer"
     * console.log(summary.description); // "Send 1.0 ETH to 0x123...abc"
     * console.log(summary.details.formattedAmount); // "1.0"
     * console.log(summary.risks); // [{ type: 'large_transaction', level: 'high', ... }]
     * ```
     * 
     * @param prepared - PreparedTransfer or PreparedBridge from prepare methods
     * @returns Promise<TransactionSummary> with human-readable details
     */
    async getTransactionSummary(prepared: PreparedTransfer | PreparedBridge): Promise<TransactionSummary> {
        return this.transactionParser.parse(prepared);
    }

    // ============================================================================
    // Spending Limits (Issue #27)
    // ============================================================================

    /**
     * Get current spending limits for your vault
     * 
     * @example
     * ```typescript
     * const limits = await sdk.getSpendingLimits();
     * console.log(`Daily remaining: ${limits.dailyRemaining}`);
     * console.log(`Resets in: ${limits.timeUntilReset}ms`);
     * ```
     * 
     * @param chainId - Optional chain ID (defaults to current chain)
     * @returns Promise<SpendingLimits> with current limits and usage
     */
    async getSpendingLimits(chainId?: number): Promise<SpendingLimits> {
        const vaultAddress = this.getVaultAddress();
        const effectiveChainId = chainId ?? this.chain.getConfig().wormholeChainId;
        const rpcUrl = this.chainRpcUrls?.[effectiveChainId] ?? this.chain.getConfig().rpcUrl;
        
        return this.spendingLimits.getSpendingLimits(vaultAddress, effectiveChainId, rpcUrl);
    }

    /**
     * Get spending limits formatted for UI display
     * 
     * @example
     * ```typescript
     * const formatted = await sdk.getFormattedSpendingLimits();
     * console.log(`${formatted.dailyUsedPercentage}% of daily limit used`);
     * console.log(`Resets in: ${formatted.timeUntilReset}`);
     * ```
     */
    async getFormattedSpendingLimits(chainId?: number): Promise<FormattedSpendingLimits> {
        const vaultAddress = this.getVaultAddress();
        const effectiveChainId = chainId ?? this.chain.getConfig().wormholeChainId;
        const rpcUrl = this.chainRpcUrls?.[effectiveChainId] ?? this.chain.getConfig().rpcUrl;
        
        return this.spendingLimits.getFormattedSpendingLimits(vaultAddress, effectiveChainId, { rpcUrl });
    }

    /**
     * Check if a transaction amount is within spending limits
     * 
     * @example
     * ```typescript
     * const check = await sdk.checkSpendingLimit(ethers.parseEther("1.0"));
     * if (!check.allowed) {
     *   console.log(check.message);
     *   console.log('Suggestions:', check.suggestions);
     * }
     * ```
     * 
     * @param amount - Amount to check (in wei/base units)
     * @param chainId - Optional chain ID
     * @returns LimitCheckResult with allowed status and suggestions
     */
    async checkSpendingLimit(amount: bigint, chainId?: number): Promise<LimitCheckResult> {
        const vaultAddress = this.getVaultAddress();
        const effectiveChainId = chainId ?? this.chain.getConfig().wormholeChainId;
        const rpcUrl = this.chainRpcUrls?.[effectiveChainId] ?? this.chain.getConfig().rpcUrl;
        
        return this.spendingLimits.checkTransactionLimit(vaultAddress, effectiveChainId, amount, { rpcUrl });
    }

    /**
     * Prepare a transaction to update the daily spending limit
     * Returns a PreparedTransfer that can be signed and executed
     * 
     * @example
     * ```typescript
     * // Set daily limit to 5 ETH
     * const prepared = await sdk.prepareSetDailyLimit(ethers.parseEther("5.0"));
     * const result = await sdk.executeTransfer(prepared, signer);
     * ```
     * 
     * @param newLimit - New daily limit (0 = unlimited)
     * @returns PreparedTransfer for signing
     */
    async prepareSetDailyLimit(newLimit: bigint): Promise<PreparedTransfer> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        const actionPayload = this.spendingLimits.prepareDailyLimitUpdate(newLimit);
        const nonce = await this.getNonce();
        const targetChain = this.chain.getConfig().wormholeChainId;
        const challenge = buildChallenge(credential.keyHash, targetChain, nonce, actionPayload);
        const messageFee = await this.getMessageFee();
        
        return {
            params: {
                targetChain,
                token: 'native',
                recipient: this.getVaultAddress(),
                amount: 0n,
            },
            actionPayload,
            nonce,
            challenge,
            estimatedGas: 0n,
            gasPrice: 0n,
            messageFee,
            totalCost: messageFee,
            formattedCost: '0',
            preparedAt: Date.now(),
            expiresAt: Date.now() + this.preparedTransferTtl,
        };
    }

    /**
     * Prepare a transaction to pause the vault (emergency stop)
     * Pausing prevents all withdrawals until unpaused
     * 
     * @example
     * ```typescript
     * const prepared = await sdk.preparePauseVault();
     * const result = await sdk.executeTransfer(prepared, signer);
     * ```
     */
    async preparePauseVault(): Promise<PreparedTransfer> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        const actionPayload = this.spendingLimits.preparePauseVault();
        const nonce = await this.getNonce();
        const targetChain = this.chain.getConfig().wormholeChainId;
        const challenge = buildChallenge(credential.keyHash, targetChain, nonce, actionPayload);
        const messageFee = await this.getMessageFee();
        
        return {
            params: {
                targetChain,
                token: 'native',
                recipient: this.getVaultAddress(),
                amount: 0n,
            },
            actionPayload,
            nonce,
            challenge,
            estimatedGas: 0n,
            gasPrice: 0n,
            messageFee,
            totalCost: messageFee,
            formattedCost: '0',
            preparedAt: Date.now(),
            expiresAt: Date.now() + this.preparedTransferTtl,
        };
    }

    /**
     * Prepare a transaction to unpause the vault
     * 
     * @example
     * ```typescript
     * const prepared = await sdk.prepareUnpauseVault();
     * const result = await sdk.executeTransfer(prepared, signer);
     * ```
     */
    async prepareUnpauseVault(): Promise<PreparedTransfer> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        const actionPayload = this.spendingLimits.prepareUnpauseVault();
        const nonce = await this.getNonce();
        const targetChain = this.chain.getConfig().wormholeChainId;
        const challenge = buildChallenge(credential.keyHash, targetChain, nonce, actionPayload);
        const messageFee = await this.getMessageFee();
        
        return {
            params: {
                targetChain,
                token: 'native',
                recipient: this.getVaultAddress(),
                amount: 0n,
            },
            actionPayload,
            nonce,
            challenge,
            estimatedGas: 0n,
            gasPrice: 0n,
            messageFee,
            totalCost: messageFee,
            formattedCost: '0',
            preparedAt: Date.now(),
            expiresAt: Date.now() + this.preparedTransferTtl,
        };
    }

    /**
     * Execute a prepared transfer
     * Use this after prepareTransfer() for better UX
     * 
     * @param prepared - PreparedTransfer from prepareTransfer()
     * @param signer - Signer to pay for gas
     * @returns TransferResult with tracking info
     */
    async executeTransfer(
        prepared: PreparedTransfer, 
        signer: any
    ): Promise<TransferResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // ADR-0037: Block direct dispatch if multisig policy protects transfers
        await this.multisig?.assertDirectDispatchAllowed('transfer');

        // Check if prepared transfer has expired
        if (Date.now() > prepared.expiresAt) {
            throw new VeridexError(VeridexErrorCode.EXPIRED);
        }

        try {
            // Sign with passkey
            const signature = await this.passkey.sign(prepared.challenge);

            // Dispatch the transaction
            const result = await this.chain.dispatch(
                signature,
                credential.publicKeyX,
                credential.publicKeyY,
                prepared.params.targetChain,
                prepared.actionPayload,
                prepared.nonce,
                signer
            );

            // Track the transaction with cache invalidation on confirmation
            const vaultAddress = this.getVaultAddress();
            const chainConfig = this.chain.getConfig();
            if (result.transactionHash) {
                this.transactions.track(
                    result.transactionHash,
                    chainConfig.wormholeChainId,
                    (state) => {
                        if (state.status === 'confirmed' || state.status === 'failed') {
                            this.balance.invalidateCache(chainConfig.wormholeChainId, vaultAddress);
                        }
                    },
                    result.sequence
                );
            }

            return {
                ...result,
                params: prepared.params,
                timestamp: Date.now(),
            };
        } catch (err) {
            throw normalizeError(err, this.chain.getConfig().name);
        }
    }

    /**
     * Enhanced transfer with automatic tracking
     * 
     * @param params - Transfer parameters
     * @param signer - Signer to pay for gas
     * @param onStatusChange - Optional callback for transaction status updates
     * @returns TransferResult with tracking info
     */
    async transferWithTracking(
        params: TransferParams,
        signer: any,
        onStatusChange?: TransactionCallback
    ): Promise<TransferResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // ADR-0037: Block direct dispatch if multisig policy protects transfers
        await this.multisig?.assertDirectDispatchAllowed('transfer');

        try {
        // Execute the transfer
        const actionPayload = await this.buildTransferPayload(params);
        const nonce = await this.getNonce();
        const challenge = buildChallenge(
            credential.keyHash,
            params.targetChain,
            nonce,
            actionPayload
        );

        const signature = await this.passkey.sign(challenge);

        const result = await this.chain.dispatch(
            signature,
            credential.publicKeyX,
            credential.publicKeyY,
            params.targetChain,
            actionPayload,
            nonce,
            signer
        );

        // Track the transaction with cache invalidation on confirmation
        const vaultAddress = this.getVaultAddress();
        const chainConfig = this.chain.getConfig();
        if (result.transactionHash) {
            this.transactions.track(
                result.transactionHash,
                chainConfig.wormholeChainId,
                (state) => {
                    if (state.status === 'confirmed' || state.status === 'failed') {
                        this.balance.invalidateCache(chainConfig.wormholeChainId, vaultAddress);
                    }
                    onStatusChange?.(state);
                },
                result.sequence
            );
        }

        return {
            ...result,
            params,
            timestamp: Date.now(),
        };
        } catch (err) {
            throw normalizeError(err, this.chain.getConfig().name);
        }
    }

    /**
     * Execute a gasless transfer using the relayer
     * 
     * This method allows users to send funds without paying gas themselves.
     * The relayer service submits the transaction to the Hub and pays the gas.
     * The relayer then automatically relays the VAA to the destination spoke chain.
     * 
     * @param params - Transfer parameters (to, amount, token, targetChain)
     * @param onStatusChange - Optional callback for transaction status updates
     * @returns TransferResult with Hub tx hash and tracking info
     */
    async transferViaRelayer(
        params: TransferParams,
        onStatusChange?: TransactionCallback
    ): Promise<TransferResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // ADR-0037: Block direct dispatch if multisig policy protects transfers
        await this.multisig?.assertDirectDispatchAllowed('transfer');

        // Ensure relayer is available
        if (!this.relayer) {
            throw new VeridexError(VeridexErrorCode.RELAYER_ERROR, 'Relayer not configured. Please provide relayerUrl in SDK config.');
        }

        const chainConfig = this.chain.getConfig();

        // Build the action payload (canonical encoding from the active chain client)
        const actionPayload = await this.buildTransferPayload(params);

        // Client-first preparation:
        // - fetch Guardian-attested nonce via Wormhole Queries when possible
        // - fall back to hub RPC nonce lookup
        // - prompt user to sign once
        const { authenticateAndPrepare } = await import('../auth/prepareAuth.js');
        const prepared = await authenticateAndPrepare(
            {
                credential,
                targetChain: params.targetChain,
                actionPayload,
            },
            this.queryApiKey ?? ''
        );

        const submitRequest = JSON.parse(new TextDecoder().decode(prepared.serializedTx)) as SubmitSignedActionRequest;

        // Ensure the request body uses our canonical payload (defensive)
        (submitRequest as any).actionPayload = actionPayload;

        const relayerResult = await this.relayer.submitSignedAction(submitRequest);

        if (!relayerResult.success) {
            throw new VeridexError(VeridexErrorCode.RELAYER_ERROR, `Relayer submission failed: ${relayerResult.error}`);
        }

        // Track the Hub transaction with cache invalidation on confirmation
        const vaultAddress = this.getVaultAddress();
        if (relayerResult.txHash) {
            const hubChainId = chainConfig.hubChainId ?? chainConfig.wormholeChainId;
            this.transactions.track(
                relayerResult.txHash,
                hubChainId,
                (state) => {
                    if (state.status === 'confirmed' || state.status === 'failed') {
                        this.balance.invalidateCache(chainConfig.wormholeChainId, vaultAddress);
                    }
                    onStatusChange?.(state);
                },
                relayerResult.sequence ? BigInt(relayerResult.sequence) : undefined
            );
        }

        return {
            transactionHash: relayerResult.txHash ?? '',
            sequence: relayerResult.sequence ? BigInt(relayerResult.sequence) : 0n,
            userKeyHash: credential.keyHash,
            targetChain: params.targetChain,
            blockNumber: 0, // Hub tx block number not returned by relayer
            params,
            timestamp: Date.now(),
        };
    }

    /**
     * Wait for a transaction to confirm
     * 
     * @param hash - Transaction hash
     * @returns TransactionState when confirmed
     */
    async waitForTransaction(hash: string): Promise<TransactionState> {
        const chainConfig = this.chain.getConfig();
        return await this.transactions.waitForConfirmation(hash, chainConfig.wormholeChainId);
    }

    // ========================================================================
    // Balance Methods
    // ========================================================================

    /**
     * Get native token balance for the current vault
     * 
     * @returns TokenBalance with native token balance
     */
    async getVaultNativeBalance(): Promise<TokenBalance> {
        const vaultAddress = this.getVaultAddress();
        const chainConfig = this.chain.getConfig();
        return await this.balance.getNativeBalance(chainConfig.wormholeChainId, vaultAddress);
    }

    /**
     * Get all token balances for the current vault
     * 
     * @param includeZeroBalances - Whether to include tokens with 0 balance
     * @returns PortfolioBalance with all token balances
     */
    async getVaultBalances(includeZeroBalances: boolean = false): Promise<PortfolioBalance> {
        const vaultAddress = this.getVaultAddress();
        const chainConfig = this.chain.getConfig();

        // Prefer Wormhole Queries when possible (faster, Guardian-attested), but preserve
        // existing behavior as a fallback.
        const credential = this.passkey.getCredential();
        if (credential && this.queryApiKey) {
            try {
                const wormholeChainId = chainConfig.wormholeChainId;
                const tokenList = getAllTokens(wormholeChainId);
                const erc20Tokens = tokenList
                    .filter((t) => !isNativeToken(t.address))
                    .map((t) => t.address);

                const { queryPortfolio } = await import('../queries/portfolio.js');
                const result = await queryPortfolio(credential.keyHash, this.queryApiKey, {
                    network: this.testnet ? 'testnet' : 'mainnet',
                    vaultAddresses: { [wormholeChainId]: vaultAddress },
                    evmTokenAddresses: { [wormholeChainId]: erc20Tokens },
                    rpcUrls: { [wormholeChainId]: chainConfig.rpcUrl },
                    maxAge: 60,
                    // Testnet Query Proxy can be slow; use a more forgiving timeout.
                    timeout: this.testnet ? 15_000 : 10_000,
                    maxAttempts: this.testnet ? 3 : 2,
                });

                const chain = result.chains.find((c) => c.wormholeChainId === wormholeChainId);
                if (chain && !chain.error) {
                    const byAssetId = new Map(chain.balances.map((b) => [b.assetId.toLowerCase(), b] as const));
                    const tokens = tokenList.map((t) => {
                        if (isNativeToken(t.address)) {
                            return null;
                        }
                        const found = byAssetId.get(t.address.toLowerCase());
                        const amount = found?.amount ?? 0n;
                        const formatted = ethers.formatUnits(amount, t.decimals);
                        return {
                            token: t,
                            balance: amount,
                            formatted,
                            usdValue: found?.usdValue,
                        };
                    }).filter((t): t is NonNullable<typeof t> => !!t);

                    // Add native token via RPC (Queries don't support native ETH balance).
                    const native = await this.balance.getNativeBalance(wormholeChainId, vaultAddress);
                    const merged = [native, ...tokens];

                    const filtered = includeZeroBalances ? merged : merged.filter((t) => t.balance > 0n);
                    const totalUsdValue = filtered.reduce((sum, t) => sum + (t.usdValue ?? 0), 0);

                    return {
                        wormholeChainId,
                        chainName: chainConfig.name,
                        address: vaultAddress,
                        tokens: filtered,
                        totalUsdValue: totalUsdValue || undefined,
                        lastUpdated: Date.now(),
                    };
                }
            } catch {
                // Fall back to the existing RPC-based balance logic.
            }
        }

        return await this.balance.getPortfolioBalance(chainConfig.wormholeChainId, vaultAddress, includeZeroBalances);
    }

    /**
     * Get token balance for a specific token
     * 
     * @param tokenAddress - Token contract address or 'native'
     * @returns TokenBalance for the specified token
     */
    async getVaultTokenBalance(tokenAddress: string): Promise<TokenBalance> {
        const vaultAddress = this.getVaultAddress();
        const chainConfig = this.chain.getConfig();
        return await this.balance.getBalance(
            chainConfig.wormholeChainId,
            vaultAddress,
            tokenAddress
        );
    }

    /**
     * Get balances across multiple chains
     * 
     * @param chainIds - Array of Wormhole chain IDs to check
     * @returns Array of PortfolioBalance for each chain
     */
    async getMultiChainBalances(chainIds: number[]): Promise<PortfolioBalance[]> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // Derive an address per chain and query balances accordingly.
        const results: PortfolioBalance[] = [];

        for (const wormholeChainId of chainIds) {
            const chainConfig = this.chainDetector.getChainConfig(wormholeChainId);

            // If unknown, skip with a warning.
            if (!chainConfig) {
                // eslint-disable-next-line no-console
                console.warn(`Unknown chainId for balances: ${wormholeChainId}`);
                continue;
            }

            // Resolve vault address
            const derived = this.chainDetector.deriveVaultAddress(credential, wormholeChainId);
            const address = derived?.address ?? (wormholeChainId === this.chain.getConfig().wormholeChainId
                ? this.getVaultAddress()
                : credential.keyHash);

            if (chainConfig.isEvm) {
                try {
                    const portfolio = await this.balance.getPortfolioBalance(wormholeChainId, address, false);
                    results.push(portfolio);
                } catch (error) {
                    // eslint-disable-next-line no-console
                    console.warn(`Failed to fetch EVM balances for chain ${wormholeChainId}:`, error);
                }
                continue;
            }

            // Non-EVM: fetch native balance via chain-specific client
            try {
                const client: any = this.chainDetector.createClient(wormholeChainId);
                if (typeof client.getNativeBalance !== 'function') {
                    // eslint-disable-next-line no-console
                    console.warn(`No native balance support for chain ${wormholeChainId}`);
                    continue;
                }

                const native = await client.getNativeBalance(address);
                const meta = this.chainDetector.getNonEvmNativeTokenMeta(wormholeChainId);

                const decimals = meta?.decimals ?? 0;
                const formatted = decimals > 0 ? ethers.formatUnits(native, decimals) : native.toString();

                results.push({
                    wormholeChainId,
                    chainName: chainConfig.name,
                    address,
                    tokens: [
                        {
                            token: {
                                symbol: meta?.symbol ?? 'NATIVE',
                                name: meta?.name ?? 'Native Token',
                                address: 'native',
                                decimals,
                                isNative: true,
                            },
                            balance: native,
                            formatted,
                        },
                    ],
                    lastUpdated: Date.now(),
                });
            } catch (error) {
                // eslint-disable-next-line no-console
                console.warn(`Failed to fetch non-EVM balances for chain ${wormholeChainId}:`, error);
            }
        }

        return results;
    }

    /**
     * Get token list for a chain
     */
    getTokenList(wormholeChainId?: number): TokenInfo[] {
        const chainId = wormholeChainId ?? this.chain.getConfig().wormholeChainId;
        return getAllTokens(chainId);
    }

    /**
     * Get token by symbol
     */
    getTokenBySymbol(symbol: string, wormholeChainId?: number): TokenInfo | null {
        const chainId = wormholeChainId ?? this.chain.getConfig().wormholeChainId;
        return getTokenBySymbol(chainId, symbol);
    }

    // ========================================================================
    // Multi-Chain Convenience Methods
    // ========================================================================

    /**
     * Get vault addresses across all supported chains at once.
     *
     * Unlike calling `getVaultAddressForChain()` in a loop, this returns a
     * structured map that frontends can render directly.
     *
     * @example
     * ```typescript
     * const addresses = sdk.getMultiChainAddresses();
     * for (const [chainId, addr] of Object.entries(addresses)) {
     *   console.log(`Chain ${chainId}: ${addr}`);
     * }
     * ```
     */
    getMultiChainAddresses(): Record<number, string> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        const supportedChains = this.sponsor.getSupportedChains();
        const addresses: Record<number, string> = {};

        // Always include the current chain
        const currentChainId = this.chain.getConfig().wormholeChainId;
        addresses[currentChainId] = this.chain.computeVaultAddress(credential.keyHash);

        for (const chain of supportedChains) {
            if (addresses[chain.wormholeChainId]) continue;
            const addr = this.getVaultAddressForChain(chain.wormholeChainId, credential.keyHash);
            if (addr) {
                addresses[chain.wormholeChainId] = addr;
            }
        }

        return addresses;
    }

    /**
     * Get a combined portfolio view across multiple chains.
     *
     * Returns vault address + balances per chain, suitable for a dashboard or
     * portfolio summary screen.
     *
     * @example
     * ```typescript
     * const portfolio = await sdk.getMultiChainPortfolio();
     * for (const entry of portfolio) {
     *   console.log(`${entry.chainName}: ${entry.tokens.length} tokens`);
     * }
     * ```
     *
     * @param chainIds - Optional array of Wormhole chain IDs. Defaults to all sponsored chains.
     */
    async getMultiChainPortfolio(chainIds?: number[]): Promise<PortfolioBalance[]> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // Default to all sponsored chains plus the current chain
        const ids = chainIds ?? [
            this.chain.getConfig().wormholeChainId,
            ...this.sponsor.getSupportedChains()
                .map(c => c.wormholeChainId)
                .filter(id => id !== this.chain.getConfig().wormholeChainId),
        ];

        return this.getMultiChainBalances(ids);
    }

    // ========================================================================
    // Receive Address Methods
    // ========================================================================

    /**
     * Get receive address information for sharing
     * Use this to generate QR codes or share your vault address
     * 
     * @returns ReceiveAddress with address and sharing info
     */
    getReceiveAddress(): ReceiveAddress {
        const vaultAddress = this.getVaultAddress();
        const chainConfig = this.chain.getConfig();
        
        // Create a deep link for wallet apps (EIP-681 format for EVM)
        const deepLink = chainConfig.isEvm 
            ? `ethereum:${vaultAddress}@${chainConfig.chainId}`
            : undefined;

        // Create copy-friendly text
        const copyText = `${vaultAddress}`;

        return {
            address: vaultAddress,
            chainName: chainConfig.name,
            wormholeChainId: chainConfig.wormholeChainId,
            deepLink,
            copyText,
        };
    }

    /**
     * Generate receive address with amount (for payment requests)
     * 
     * @param amount - Amount to request
     * @param tokenAddress - Token address or 'native'
     * @param tokenDecimals - Token decimals
     * @returns ReceiveAddress with payment request info
     */
    getPaymentRequest(
        amount: bigint,
        tokenAddress: string = 'native',
        tokenDecimals: number = 18
    ): ReceiveAddress {
        const vaultAddress = this.getVaultAddress();
        const chainConfig = this.chain.getConfig();
        
        // Format amount
        const formattedAmount = this.formatUnits(amount, tokenDecimals);
        
        // Create EIP-681 payment request for EVM
        let deepLink: string | undefined;
        if (chainConfig.isEvm) {
            if (isNativeToken(tokenAddress)) {
                deepLink = `ethereum:${vaultAddress}@${chainConfig.chainId}?value=${amount.toString()}`;
            } else {
                // ERC20 transfer
                deepLink = `ethereum:${tokenAddress}@${chainConfig.chainId}/transfer?address=${vaultAddress}&uint256=${amount.toString()}`;
            }
        }

        return {
            address: vaultAddress,
            chainName: chainConfig.name,
            wormholeChainId: chainConfig.wormholeChainId,
            deepLink,
            copyText: `${vaultAddress} (${formattedAmount})`,
        };
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Format wei to ether string
     */
    private formatWei(wei: bigint): string {
        // Simple formatter - 18 decimals
        const ether = Number(wei) / 1e18;
        return `${ether.toFixed(6)} ETH`;
    }

    /**
     * Format units based on decimals
     */
    private formatUnits(amount: bigint, decimals: number): string {
        const divisor = BigInt(10 ** decimals);
        const whole = amount / divisor;
        const remainder = amount % divisor;
        const remainderStr = remainder.toString().padStart(decimals, '0');
        const trimmed = remainderStr.slice(0, 4).replace(/0+$/, '') || '0';
        return `${whole}.${trimmed}`;
    }


    async getVaultInfo(targetChainId?: number): Promise<VaultInfo | null> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        const chainConfig = this.chain.getConfig();
        const checkChainId = targetChainId ?? chainConfig.wormholeChainId;

        if (checkChainId !== chainConfig.wormholeChainId) {
            throw new VeridexError(VeridexErrorCode.UNSUPPORTED_FEATURE, 'Cross-chain vault queries not yet supported. Please create a client for the target chain.');
        }

        const vaultAddress = await this.chain.getVaultAddress(credential.keyHash);
        const exists = await this.chain.vaultExists(credential.keyHash);

        if (!vaultAddress || !exists) {
            return null;
        }

        return {
            address: vaultAddress,
            ownerKeyHash: credential.keyHash,
            chain: chainConfig.name,
            wormholeChainId: chainConfig.wormholeChainId,
            exists,
        };
    }

    // ========================================================================
    // Wallet & Identity Methods
    // ========================================================================

    /**
     * Get the deterministic vault address for the current credential
     * This computes the address off-chain without requiring the vault to exist
     * 
     * @returns The vault address that will be used when vault is created
     */
    getVaultAddress(): string {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        return this.chain.computeVaultAddress(credential.keyHash);
    }

    /**
     * Get the vault address for a specific key hash
     * 
     * @param keyHash - The user's key hash
     * @returns The deterministic vault address
     */
    getVaultAddressForKeyHash(keyHash: string): string {
        return this.chain.computeVaultAddress(keyHash);
    }

    /**
     * Get the vault address for a specific chain
     * Each EVM chain has its own factory contract, so vault addresses are chain-specific.
     * 
     * @param wormholeChainId - The Wormhole chain ID
     * @param keyHash - Optional key hash (defaults to current credential)
     * @returns The deterministic vault address for that chain, or null if chain not supported
     */
    getVaultAddressForChain(wormholeChainId: number, keyHash?: string): string | null {
        const hash = keyHash ?? this.passkey.getCredential()?.keyHash;
        if (!hash) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL, 'No credential set and no keyHash provided');
        }

        const credential = { keyHash: hash } as PasskeyCredential;
        const derived = this.chainDetector.deriveVaultAddress(credential, wormholeChainId);
        return derived?.address ?? null;
    }

    /**
     * Get vault balances for a specific chain
     * Unlike getVaultBalances() which uses the hub chain, this fetches for any EVM chain.
     * 
     * @param wormholeChainId - The Wormhole chain ID
     * @param includeZeroBalances - Whether to include tokens with 0 balance
     * @returns PortfolioBalance with all token balances for that chain
     */
    async getVaultBalancesForChain(
        wormholeChainId: number,
        includeZeroBalances: boolean = false
    ): Promise<PortfolioBalance> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // Get the correct vault address for this chain
        const vaultAddress = this.getVaultAddressForChain(wormholeChainId, credential.keyHash);
        if (!vaultAddress) {
            throw new VeridexError(VeridexErrorCode.VAULT_NOT_FOUND, `Cannot derive vault address for chain ${wormholeChainId}`);
        }

        const chainConfig = this.chainDetector.getChainConfig(wormholeChainId);
        if (!chainConfig) {
            throw new VeridexError(VeridexErrorCode.UNSUPPORTED_FEATURE, `Unknown chain ${wormholeChainId}`);
        }

        // Try Wormhole Queries first for faster, attested results
        if (this.queryApiKey) {
            try {
                const tokenList = getAllTokens(wormholeChainId);
                const erc20Tokens = tokenList
                    .filter((t) => !isNativeToken(t.address))
                    .map((t) => t.address);

                const rpcUrl = this.chainRpcUrls?.[wormholeChainId] ?? chainConfig.rpcUrl;
                
                const { queryPortfolio } = await import('../queries/portfolio.js');
                const result = await queryPortfolio(credential.keyHash, this.queryApiKey, {
                    network: this.testnet ? 'testnet' : 'mainnet',
                    vaultAddresses: { [wormholeChainId]: vaultAddress },
                    evmTokenAddresses: { [wormholeChainId]: erc20Tokens },
                    rpcUrls: { [wormholeChainId]: rpcUrl },
                    maxAge: 60,
                    timeout: this.testnet ? 15_000 : 10_000,
                    maxAttempts: this.testnet ? 3 : 2,
                });

                const chain = result.chains.find((c) => c.wormholeChainId === wormholeChainId);
                if (chain && !chain.error) {
                    const byAssetId = new Map(chain.balances.map((b) => [b.assetId.toLowerCase(), b] as const));
                    const tokens = tokenList.map((t) => {
                        if (isNativeToken(t.address)) {
                            return null;
                        }
                        const found = byAssetId.get(t.address.toLowerCase());
                        const amount = found?.amount ?? 0n;
                        const formatted = ethers.formatUnits(amount, t.decimals);
                        return {
                            token: t,
                            balance: amount,
                            formatted,
                            usdValue: found?.usdValue,
                        };
                    }).filter((t): t is NonNullable<typeof t> => !!t);

                    // Add native token via RPC
                    const native = await this.balance.getNativeBalance(wormholeChainId, vaultAddress);
                    const merged = [native, ...tokens];

                    const filtered = includeZeroBalances ? merged : merged.filter((t) => t.balance > 0n);
                    const totalUsdValue = filtered.reduce((sum, t) => sum + (t.usdValue ?? 0), 0);

                    return {
                        wormholeChainId,
                        chainName: chainConfig.name,
                        address: vaultAddress,
                        tokens: filtered,
                        totalUsdValue: totalUsdValue || undefined,
                        lastUpdated: Date.now(),
                    };
                }
            } catch {
                // Fall back to RPC-based balance fetching
            }
        }

        // Fallback to RPC-based balance fetching
        return await this.balance.getPortfolioBalance(wormholeChainId, vaultAddress, includeZeroBalances);
    }

    /**
     * Get unified identity with addresses across chains
     * 
     * @returns UnifiedIdentity containing credential info and chain addresses
     */
    async getUnifiedIdentity(): Promise<UnifiedIdentity> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // Check if we have cached identity
        if (this.unifiedIdentity && this.unifiedIdentity.keyHash === credential.keyHash) {
            return this.unifiedIdentity;
        }

        // Try to load from storage first
        const storedIdentity = this.wallet.loadIdentityFromStorage(credential.keyHash);
        if (storedIdentity) {
            this.unifiedIdentity = storedIdentity;
            // Update deployment status from chain
            await this.updateDeploymentStatus();
            return this.unifiedIdentity;
        }

        // Build new identity
        const chainConfig = this.chain.getConfig();
        const addresses: ChainAddress[] = [];

        // Compute address for current chain
        try {
            const address = this.chain.computeVaultAddress(credential.keyHash);
            const deployed = await this.chain.vaultExists(credential.keyHash);
            
            addresses.push({
                wormholeChainId: chainConfig.wormholeChainId,
                chainName: chainConfig.name,
                address,
                isEvm: chainConfig.isEvm,
                deployed,
                derivationType: 'create2',
            });
        } catch (error) {
            console.warn('Could not compute vault address for current chain:', error);
        }

        this.unifiedIdentity = {
            keyHash: credential.keyHash,
            publicKeyX: credential.publicKeyX,
            publicKeyY: credential.publicKeyY,
            credentialId: credential.credentialId,
            addresses,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        return this.unifiedIdentity;
    }

    /**
     * Get the current chain address from unified identity
     */
    async getCurrentChainAddress(): Promise<ChainAddress | null> {
        const identity = await this.getUnifiedIdentity();
        const chainConfig = this.chain.getConfig();
        
        return identity.addresses.find(
            a => a.wormholeChainId === chainConfig.wormholeChainId
        ) ?? null;
    }

    /**
     * Update deployment status for cached identity
     */
    private async updateDeploymentStatus(): Promise<void> {
        if (!this.unifiedIdentity) return;

        const chainConfig = this.chain.getConfig();
        const address = this.unifiedIdentity.addresses.find(
            a => a.wormholeChainId === chainConfig.wormholeChainId
        );

        if (address) {
            try {
                const deployed = await this.chain.vaultExists(this.unifiedIdentity.keyHash);
                address.deployed = deployed;
                this.unifiedIdentity.updatedAt = Date.now();
            } catch (error) {
                console.warn('Could not update deployment status:', error);
            }
        }
    }

    /**
     * Add a chain address to the unified identity
     * Used when configuring multiple chains
     */
    addChainAddress(address: ChainAddress): void {
        if (!this.unifiedIdentity) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL, 'No identity loaded. Call getUnifiedIdentity() first.');
        }

        const existing = this.unifiedIdentity.addresses.findIndex(
            a => a.wormholeChainId === address.wormholeChainId
        );

        if (existing >= 0) {
            this.unifiedIdentity.addresses[existing] = address;
        } else {
            this.unifiedIdentity.addresses.push(address);
        }

        this.unifiedIdentity.updatedAt = Date.now();
    }

    // ========================================================================
    // Vault Creation Methods
    // ========================================================================

    /**
     * Create a vault for the current credential
     * 
     * @param signer - The signer to pay for gas
     * @returns VaultCreationResult with address and transaction details
     */
    async createVault(signer: any): Promise<VaultCreationResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        const result = await this.chain.createVault(credential.keyHash, signer);

        // Update cached identity if available
        if (this.unifiedIdentity) {
            const chainConfig = this.chain.getConfig();
            const address = this.unifiedIdentity.addresses.find(
                a => a.wormholeChainId === chainConfig.wormholeChainId
            );

            if (address) {
                address.deployed = true;
                address.deploymentTxHash = result.transactionHash;
            } else {
                this.unifiedIdentity.addresses.push({
                    wormholeChainId: chainConfig.wormholeChainId,
                    chainName: chainConfig.name,
                    address: result.address,
                    isEvm: chainConfig.isEvm,
                    deployed: true,
                    deploymentTxHash: result.transactionHash,
                    derivationType: 'create2',
                });
            }

            this.unifiedIdentity.updatedAt = Date.now();
        }

        return result;
    }

    /**
     * Create a vault with sponsored gas (Veridex pays for gas)
     * 
     * Uses the sponsor wallet configured in SDK initialization.
     * If no sponsor is configured, throws an error.
     * 
     * @param wormholeChainId - Optional chain ID for multi-chain creation
     * @returns VaultCreationResult with address and transaction details
     */
    async createVaultSponsored(wormholeChainId?: number): Promise<VaultCreationResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        if (!this.sponsorPrivateKey) {
            throw new VeridexError(VeridexErrorCode.UNSUPPORTED_FEATURE, 'No sponsor wallet configured. Set sponsorPrivateKey in SDK config.');
        }

        // Check if chain client supports sponsored creation
        if (!this.chain.createVaultSponsored) {
            throw new VeridexError(VeridexErrorCode.UNSUPPORTED_FEATURE, 'Current chain client does not support sponsored vault creation');
        }

        // Get the appropriate RPC URL for the chain
        const chainConfig = this.chain.getConfig();
        const targetChainId = wormholeChainId ?? chainConfig.wormholeChainId;
        const rpcUrl = this.chainRpcUrls?.[targetChainId] ?? chainConfig.rpcUrl;

        const result = await this.chain.createVaultSponsored(
            credential.keyHash,
            this.sponsorPrivateKey,
            rpcUrl
        );

        // Update cached identity if available
        if (this.unifiedIdentity) {
            const address = this.unifiedIdentity.addresses.find(
                a => a.wormholeChainId === targetChainId
            );

            if (address) {
                address.deployed = true;
                address.deploymentTxHash = result.transactionHash;
            } else {
                this.unifiedIdentity.addresses.push({
                    wormholeChainId: targetChainId,
                    chainName: chainConfig.name,
                    address: result.address,
                    isEvm: chainConfig.isEvm,
                    deployed: true,
                    deploymentTxHash: result.transactionHash,
                    derivationType: 'create2',
                });
            }

            this.unifiedIdentity.updatedAt = Date.now();
        }

        return result;
    }

    /**
     * Check if sponsored vault creation is available
     */
    hasSponsoredVaultCreation(): boolean {
        return !!this.sponsorPrivateKey && !!this.chain.createVaultSponsored;
    }

    /**
     * Ensure vault exists, creating with sponsor if available
     * Falls back to requiring a signer if no sponsor configured
     * 
     * @param signer - Optional signer (only required if no sponsor configured)
     * @returns The vault address
     */
    async ensureVaultAuto(signer?: any): Promise<string> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        const exists = await this.chain.vaultExists(credential.keyHash);
        if (exists) {
            return this.getVaultAddress();
        }

        // Try sponsored creation first
        if (this.hasSponsoredVaultCreation()) {
            const result = await this.createVaultSponsored();
            return result.address;
        }

        // Fall back to signer-based creation
        if (!signer) {
            throw new VeridexError(VeridexErrorCode.UNSUPPORTED_FEATURE, 'No sponsor configured and no signer provided for vault creation');
        }

        const result = await this.createVault(signer);
        return result.address;
    }

    /**
     * Ensure vault exists, creating if necessary
     * 
     * @param signer - The signer to pay for gas (only used if creation needed)
     * @returns The vault address
     */
    async ensureVault(signer: any): Promise<string> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        const exists = await this.chain.vaultExists(credential.keyHash);
        if (exists) {
            return this.getVaultAddress();
        }

        const result = await this.createVault(signer);
        return result.address;
    }

    /**
     * Estimate gas for vault creation
     */
    async estimateVaultCreationGas(): Promise<bigint> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        return await this.chain.estimateVaultCreationGas(credential.keyHash);
    }

    async vaultExists(): Promise<boolean> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        return await this.chain.vaultExists(credential.keyHash);
    }

    // ========================================================================
    // Sponsored Vault Creation (Gasless)
    // ========================================================================

    /**
     * Check if gas sponsorship is configured
     * 
     * @returns true if a sponsor is configured (relayer, integrator, or Veridex)
     */
    isSponsorshipAvailable(): boolean {
        return this.sponsor.isConfigured();
    }

    /**
     * Get the active sponsorship source
     * 
     * Priority order:
     * 1. 'relayer' - Remote relayer service (future primary)
     * 2. 'integrator' - Platform-provided sponsor key
     * 3. 'veridex' - Veridex default sponsor (fallback)
     * 4. 'none' - No sponsorship available
     * 
     * @returns The active sponsorship source
     */
    getSponsorshipSource(): 'relayer' | 'integrator' | 'veridex' | 'none' {
        return this.sponsor.getSponsorshipSource();
    }

    /**
     * Get supported chains for sponsored vault creation
     * 
     * @returns Array of chain configurations
     */
    getSponsoredChains(): ChainDeploymentConfig[] {
        return this.sponsor.getSupportedChains();
    }

    /**
     * Create a vault on a specific chain using gas sponsorship
     * User doesn't need to pay gas - Veridex pays
     * 
     * @param wormholeChainId - The Wormhole chain ID to create vault on
     * @returns Result with vault address
     */
    async createSponsoredVault(wormholeChainId: number): Promise<SponsoredVaultResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        if (!this.sponsor.isConfigured()) {
            throw new VeridexError(VeridexErrorCode.UNSUPPORTED_FEATURE, 'Gas sponsorship not configured. Set sponsorPrivateKey in SDK config.');
        }

        const result = await this.sponsor.createVaultOnChain(credential.keyHash, wormholeChainId);

        // Update cached identity if successful
        if (result.success && result.vaultAddress && this.unifiedIdentity) {
            const existingAddress = this.unifiedIdentity.addresses.find(
                a => a.wormholeChainId === wormholeChainId
            );

            if (existingAddress) {
                existingAddress.deployed = true;
                existingAddress.deploymentTxHash = result.transactionHash;
                existingAddress.address = result.vaultAddress;
            } else {
                this.unifiedIdentity.addresses.push({
                    wormholeChainId,
                    chainName: result.chain,
                    address: result.vaultAddress,
                    isEvm: true,
                    deployed: true,
                    deploymentTxHash: result.transactionHash,
                    derivationType: 'create2',
                });
            }

            this.unifiedIdentity.updatedAt = Date.now();
        }

        return result;
    }

    /**
     * Create vaults on all supported chains using gas sponsorship
     * User doesn't need to pay gas - Veridex pays
     * 
     * @returns Multi-chain result with all vault addresses
     */
    async createSponsoredVaultsOnAllChains(): Promise<MultiChainVaultResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        if (!this.sponsor.isConfigured()) {
            throw new VeridexError(VeridexErrorCode.UNSUPPORTED_FEATURE, 'Gas sponsorship not configured. Set sponsorPrivateKey in SDK config.');
        }

        const result = await this.sponsor.createVaultsOnAllChains(credential.keyHash);

        // Update cached identity with all successful vaults
        if (this.unifiedIdentity) {
            for (const vaultResult of result.results) {
                if (vaultResult.success && vaultResult.vaultAddress) {
                    const existingAddress = this.unifiedIdentity.addresses.find(
                        a => a.wormholeChainId === vaultResult.wormholeChainId
                    );

                    if (existingAddress) {
                        existingAddress.deployed = true;
                        existingAddress.deploymentTxHash = vaultResult.transactionHash;
                        existingAddress.address = vaultResult.vaultAddress;
                    } else {
                        this.unifiedIdentity.addresses.push({
                            wormholeChainId: vaultResult.wormholeChainId,
                            chainName: vaultResult.chain,
                            address: vaultResult.vaultAddress,
                            isEvm: true,
                            deployed: true,
                            deploymentTxHash: vaultResult.transactionHash,
                            derivationType: 'create2',
                        });
                    }
                }
            }

            this.unifiedIdentity.updatedAt = Date.now();
        }

        return result;
    }

    /**
     * Check if vaults exist on all supported chains
     * 
     * @returns Map of chain ID to vault status
     */
    async checkVaultsOnAllChains(): Promise<Record<number, { exists: boolean; address: string }>> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        return await this.sponsor.checkVaultsOnAllChains(credential.keyHash);
    }

    /**
     * Ensure vaults exist on all chains, creating if necessary (sponsored)
     * 
     * @returns Result with all vault addresses
     */
    async ensureSponsoredVaultsOnAllChains(): Promise<MultiChainVaultResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        // First check which vaults exist
        const existing = await this.checkVaultsOnAllChains();
        
        // Find chains that need vault creation
        const supportedChains = this.sponsor.getSupportedChains();
        const needsCreation = supportedChains.filter(
            chain => !existing[chain.wormholeChainId]?.exists
        );

        if (needsCreation.length === 0) {
            // All vaults exist
            const vaultAddresses: Record<number, string> = {};
            const results: SponsoredVaultResult[] = [];

            for (const chain of supportedChains) {
                const status = existing[chain.wormholeChainId];
                vaultAddresses[chain.wormholeChainId] = status?.address || '';
                results.push({
                    success: true,
                    chain: chain.name,
                    wormholeChainId: chain.wormholeChainId,
                    vaultAddress: status?.address,
                    alreadyExists: true,
                });
            }

            return {
                keyHash: credential.keyHash,
                results,
                allSuccessful: true,
                vaultAddresses,
            };
        }

        // Create missing vaults
        return await this.createSponsoredVaultsOnAllChains();
    }

    // ==========================================================================
    // Backup Passkey / Multi-Key Identity Methods (Issue #22)
    // ==========================================================================

    /**
     * Get the identity state for the current passkey
     * Returns information about the identity including key count and root status
     * 
     * @returns Identity state or null if no credential set
     */
    async getIdentityState(): Promise<IdentityState | null> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            return null;
        }

        const evmClient = this.chain as any;
        if (typeof evmClient.getIdentityState !== 'function') {
            throw new VeridexError(VeridexErrorCode.UNSUPPORTED_FEATURE, 'Identity management not supported on this chain client');
        }

        return await evmClient.getIdentityState(credential.keyHash);
    }

    /**
     * Get all authorized passkeys for the current identity
     * 
     * @returns Array of authorized keys with root status, or null if no credential
     */
    async listAuthorizedPasskeys(): Promise<AuthorizedKey[] | null> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            return null;
        }

        const evmClient = this.chain as any;
        if (typeof evmClient.getIdentityState !== 'function') {
            throw new VeridexError(VeridexErrorCode.UNSUPPORTED_FEATURE, 'Identity management not supported on this chain client');
        }

        // Get the identity for this key
        const state = await evmClient.getIdentityState(credential.keyHash);
        if (!state.identity || state.identity === ethers.ZeroHash) {
            // Key not registered, return just this key as pending
            return [];
        }

        // Get all authorized keys for this identity
        const keyHashes: string[] = await evmClient.getAuthorizedKeys(state.identity);
        
        // Map to AuthorizedKey with root status
        return keyHashes.map(keyHash => ({
            keyHash,
            isRoot: keyHash === state.identity,
        }));
    }

    /**
     * Check if the current identity has backup passkeys registered
     * Returns false if only one passkey (the root) is registered
     * 
     * @returns True if backup passkeys exist, false otherwise
     */
    async hasBackupPasskeys(): Promise<boolean> {
        const state = await this.getIdentityState();
        if (!state || state.keyCount === 0) {
            return false;
        }
        return state.keyCount > 1;
    }

    /**
     * Register a backup passkey for the current identity
     * The backup passkey can be used to recover access if the primary is lost
     * 
     * @param newCredential The new passkey credential to add as backup
     * @param signer Ethereum signer to pay gas (optional, uses relayer if not provided)
     * @returns Result with transaction hash and sequence for cross-chain sync
     */
    async addBackupPasskey(
        newCredential: PasskeyCredential,
        signer?: any
    ): Promise<AddBackupKeyResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        const evmClient = this.chain as any;
        if (typeof evmClient.addBackupKey !== 'function') {
            throw new VeridexError(VeridexErrorCode.UNSUPPORTED_FEATURE, 'Backup passkey management not supported on this chain client');
        }

        // Get identity state to ensure we're within limits
        const state = await evmClient.getIdentityState(credential.keyHash);
        if (state.keyCount >= state.maxKeys) {
            throw new VeridexError(VeridexErrorCode.UNAUTHORIZED, `Maximum keys (${state.maxKeys}) already registered for this identity`);
        }

        // Check if the new key is already authorized
        const isAlreadyAuthorized = await evmClient.isAuthorizedForIdentity(
            state.identity,
            newCredential.keyHash
        );
        if (isAlreadyAuthorized) {
            throw new VeridexError(VeridexErrorCode.INVALID_ACTION, 'This passkey is already authorized for this identity');
        }

        if (!state.identity || state.identity === ethers.ZeroHash) {
            throw new VeridexError(VeridexErrorCode.VAULT_NOT_FOUND, 'Identity not registered. Call registerIdentity() first.');
        }

        // Nonce for key-management is stored on the *identity* (not necessarily the signing key)
        const nonce = await this.chain.getNonce(state.identity);

        // Challenge = abi.encodePacked("VERIDEX_ADD_KEY", identityKeyHash, newKeyHash, nonce)
        const packedChallenge = ethers.solidityPacked(
            ['string', 'bytes32', 'bytes32', 'uint256'],
            ['VERIDEX_ADD_KEY', state.identity, newCredential.keyHash, nonce]
        );

        const signature = await this.passkey.sign(ethers.getBytes(packedChallenge));

        if (!signer) {
            throw new VeridexError(VeridexErrorCode.INVALID_ACTION, 'Signer required for backup key registration');
        }

        // Call Hub contract to add backup key
        const { receipt, sequence } = await evmClient.addBackupKey(
            signature,
            credential.publicKeyX,
            credential.publicKeyY,
            newCredential.publicKeyX,
            newCredential.publicKeyY,
            nonce,
            signer
        );

        // Get updated key count
        const updatedState = await evmClient.getIdentityState(credential.keyHash);

        return {
            transactionHash: receipt.hash,
            sequence,
            identity: state.identity,
            newKeyHash: newCredential.keyHash,
            keyCount: updatedState.keyCount,
        };
    }

    /**
     * Remove a passkey from the current identity
     * Cannot remove the last remaining passkey
     * 
     * @param keyToRemove Hash of the passkey to remove
     * @param signer Ethereum signer to pay gas
     * @returns Result with transaction hash and sequence for cross-chain sync
     */
    async removePasskey(
        keyToRemove: string,
        signer: any
    ): Promise<RemoveKeyResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        }

        const evmClient = this.chain as any;
        if (typeof evmClient.removeKey !== 'function') {
            throw new VeridexError(VeridexErrorCode.UNSUPPORTED_FEATURE, 'Backup passkey management not supported on this chain client');
        }

        // Get identity state
        const state = await evmClient.getIdentityState(credential.keyHash);
        if (state.keyCount <= 1) {
            throw new VeridexError(VeridexErrorCode.INVALID_ACTION, 'Cannot remove the last passkey. At least one must remain.');
        }

        // Check if the key to remove is actually authorized
        const isAuthorized = await evmClient.isAuthorizedForIdentity(
            state.identity,
            keyToRemove
        );
        if (!isAuthorized) {
            throw new VeridexError(VeridexErrorCode.UNAUTHORIZED, 'The specified passkey is not authorized for this identity');
        }

        if (!state.identity || state.identity === ethers.ZeroHash) {
            throw new VeridexError(VeridexErrorCode.VAULT_NOT_FOUND, 'Identity not registered. Call registerIdentity() first.');
        }

        // Nonce for key-management is stored on the *identity*
        const nonce = await this.chain.getNonce(state.identity);

        // Challenge = abi.encodePacked("VERIDEX_REMOVE_KEY", identityKeyHash, keyToRemove, nonce)
        const packedChallenge = ethers.solidityPacked(
            ['string', 'bytes32', 'bytes32', 'uint256'],
            ['VERIDEX_REMOVE_KEY', state.identity, keyToRemove, nonce]
        );

        const signature = await this.passkey.sign(ethers.getBytes(packedChallenge));

        // Call Hub contract to remove key
        const { receipt, sequence } = await evmClient.removeKey(
            signature,
            credential.publicKeyX,
            credential.publicKeyY,
            keyToRemove,
            nonce,
            signer
        );

        // Get updated key count
        const updatedState = await evmClient.getIdentityState(credential.keyHash);

        return {
            transactionHash: receipt.hash,
            sequence,
            identity: state.identity,
            removedKeyHash: keyToRemove,
            keyCount: updatedState.keyCount,
        };
    }

    /**
     * Check if a specific passkey is authorized for the current identity
     * 
     * @param keyHash Hash of the passkey to check
     * @returns True if authorized, false otherwise
     */
    async isPasskeyAuthorized(keyHash: string): Promise<boolean> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            return false;
        }

        const evmClient = this.chain as any;
        if (typeof evmClient.getIdentityState !== 'function') {
            throw new VeridexError(VeridexErrorCode.UNSUPPORTED_FEATURE, 'Identity management not supported on this chain client');
        }

        const state = await evmClient.getIdentityState(credential.keyHash);
        if (!state.identity || state.identity === ethers.ZeroHash) {
            return false;
        }

        return await evmClient.isAuthorizedForIdentity(state.identity, keyHash);
    }

    /**
     * Get the identity hash for the current passkey
     * This is the keyHash of the first/root passkey registered
     * 
     * @returns Identity hash or null if no credential/identity
     */
    async getIdentity(): Promise<string | null> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            return null;
        }

        const evmClient = this.chain as any;
        if (typeof evmClient.getIdentityForKey !== 'function') {
            // Fallback: return keyHash as identity (single-key mode)
            return credential.keyHash;
        }

        const identity = await evmClient.getIdentityForKey(credential.keyHash);
        if (identity === ethers.ZeroHash) {
            // Not registered yet, return current keyHash
            return credential.keyHash;
        }

        return identity;
    }

    getCredential(): PasskeyCredential | null {
        return this.passkey.getCredential();
    }

    setCredential(credential: PasskeyCredential): void {
        this.passkey.setCredential(credential);
    }

    hasCredential(): boolean {
        return this.passkey.getCredential() !== null;
    }

    clearCredential(): void {
        this.passkey.clearCredential();
    }
}
