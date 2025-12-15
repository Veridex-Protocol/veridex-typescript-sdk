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
import { ethers } from 'ethers';
import { authenticateAndPrepare } from '../auth/prepareAuth.js';
import { queryPortfolio } from '../queries/portfolio.js';
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
} from './types.js';

/** Expiration time for prepared transfers (5 minutes) */
const PREPARED_TRANSFER_TTL = 5 * 60 * 1000;

export class VeridexSDK {
    public readonly passkey: PasskeyManager;
    public readonly wallet: WalletManager;
    public readonly balance: BalanceManager;
    public readonly transactions: TransactionTracker;
    public readonly crossChain: CrossChainManager;
    public readonly sponsor: GasSponsor;
    private readonly chain: ChainClient;
    private readonly relayer?: RelayerClient;
    private readonly relayerApiKey?: string;
    private readonly queryApiKey?: string;
    private readonly testnet: boolean;
    private readonly sponsorPrivateKey?: string;
    private readonly chainRpcUrls?: Record<number, string>;
    private readonly chainDetector: ChainDetector;
    private unifiedIdentity: UnifiedIdentity | null = null;

    constructor(config: VeridexConfig) {
        this.chain = config.chain;
        this.testnet = config.testnet ?? true;
        this.sponsorPrivateKey = config.sponsorPrivateKey;
        this.chainRpcUrls = config.chainRpcUrls;
        this.relayerApiKey = config.relayerApiKey;
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
    }

    getChainConfig() {
        return this.chain.getConfig();
    }

    getChainClient(): ChainClient {
        return this.chain;
    }

    async getNonce(): Promise<bigint> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new Error('No credential set. Call passkey.register() or passkey.setCredential() first.');
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
            throw new Error('No credential set. Call passkey.register() or passkey.setCredential() first.');
        }

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
    }

    async execute(params: ExecuteParams, signer: any): Promise<DispatchResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new Error('No credential set');
        }

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
    }

    async bridge(params: BridgeParams, signer: any): Promise<DispatchResult> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new Error('No credential set');
        }

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
            throw new Error('No credential set. Call passkey.register() or passkey.setCredential() first.');
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
            expiresAt: Date.now() + PREPARED_TRANSFER_TTL,
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
            throw new Error('No credential set');
        }

        // Check expiration
        if (Date.now() > prepared.expiresAt) {
            throw new Error('Prepared bridge has expired. Please call prepareBridge() again.');
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

        // Invalidate balance cache
        const vaultAddress = this.getVaultAddress();
        this.balance.invalidateCache(chainConfig.wormholeChainId, vaultAddress);

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
            throw new Error('No credential set. Call passkey.register() or passkey.setCredential() first.');
        }

        if (!this.relayer) {
            throw new Error('Relayer not configured. Please provide relayerUrl in SDK config.');
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
            throw new Error(`Relayer submission failed: ${relayerResult.error}`);
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
            throw new Error('Provider not available');
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
            throw new Error('No credential set. Call passkey.register() or passkey.setCredential() first.');
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
            expiresAt: Date.now() + PREPARED_TRANSFER_TTL,
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
            throw new Error('No credential set');
        }

        // Check if prepared transfer has expired
        if (Date.now() > prepared.expiresAt) {
            throw new Error('Prepared transfer has expired. Please call prepareTransfer() again.');
        }

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

        // Track the transaction
        if (result.transactionHash) {
            const chainConfig = this.chain.getConfig();
            this.transactions.track(
                result.transactionHash,
                chainConfig.wormholeChainId,
                undefined,
                result.sequence
            );
        }

        // Invalidate balance cache for sender
        const vaultAddress = this.getVaultAddress();
        const chainConfig = this.chain.getConfig();
        this.balance.invalidateCache(chainConfig.wormholeChainId, vaultAddress);

        return {
            ...result,
            params: prepared.params,
            timestamp: Date.now(),
        };
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
            throw new Error('No credential set');
        }

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

        // Track the transaction
        if (result.transactionHash) {
            const chainConfig = this.chain.getConfig();
            this.transactions.track(
                result.transactionHash,
                chainConfig.wormholeChainId,
                onStatusChange,
                result.sequence
            );
        }

        // Invalidate balance cache
        const vaultAddress = this.getVaultAddress();
        const chainConfig = this.chain.getConfig();
        this.balance.invalidateCache(chainConfig.wormholeChainId, vaultAddress);

        return {
            ...result,
            params,
            timestamp: Date.now(),
        };
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
            throw new Error('No credential set. Call passkey.register() or passkey.setCredential() first.');
        }

        // Ensure relayer is available
        if (!this.relayer) {
            throw new Error('Relayer not configured. Please provide relayerUrl in SDK config.');
        }

        const chainConfig = this.chain.getConfig();

        // Build the action payload (canonical encoding from the active chain client)
        const actionPayload = await this.buildTransferPayload(params);

        // Client-first preparation:
        // - fetch Guardian-attested nonce via Wormhole Queries when possible
        // - fall back to hub RPC nonce lookup
        // - prompt user to sign once
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
            throw new Error(`Relayer submission failed: ${relayerResult.error}`);
        }

        // Track the Hub transaction
        if (relayerResult.txHash) {
            const hubChainId = chainConfig.hubChainId ?? chainConfig.wormholeChainId;
            this.transactions.track(
                relayerResult.txHash,
                hubChainId,
                onStatusChange,
                relayerResult.sequence ? BigInt(relayerResult.sequence) : undefined
            );
        }

        // Invalidate balance cache for sender
        const vaultAddress = this.getVaultAddress();
        this.balance.invalidateCache(chainConfig.wormholeChainId, vaultAddress);

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
            throw new Error('No credential set');
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
            throw new Error('No credential set');
        }

        const chainConfig = this.chain.getConfig();
        const checkChainId = targetChainId ?? chainConfig.wormholeChainId;

        if (checkChainId !== chainConfig.wormholeChainId) {
            throw new Error('Cross-chain vault queries not yet supported. Please create a client for the target chain.');
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
            throw new Error('No credential set. Call passkey.register() or passkey.setCredential() first.');
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
     * Get unified identity with addresses across chains
     * 
     * @returns UnifiedIdentity containing credential info and chain addresses
     */
    async getUnifiedIdentity(): Promise<UnifiedIdentity> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new Error('No credential set. Call passkey.register() or passkey.setCredential() first.');
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
            throw new Error('No identity loaded. Call getUnifiedIdentity() first.');
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
            throw new Error('No credential set');
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
            throw new Error('No credential set');
        }

        if (!this.sponsorPrivateKey) {
            throw new Error('No sponsor wallet configured. Set sponsorPrivateKey in SDK config.');
        }

        // Check if chain client supports sponsored creation
        if (!this.chain.createVaultSponsored) {
            throw new Error('Current chain client does not support sponsored vault creation');
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
            throw new Error('No credential set');
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
            throw new Error('No sponsor configured and no signer provided for vault creation');
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
            throw new Error('No credential set');
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
            throw new Error('No credential set');
        }

        return await this.chain.estimateVaultCreationGas(credential.keyHash);
    }

    async vaultExists(): Promise<boolean> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new Error('No credential set');
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
            throw new Error('No credential set. Call passkey.register() or passkey.setCredential() first.');
        }

        if (!this.sponsor.isConfigured()) {
            throw new Error('Gas sponsorship not configured. Set sponsorPrivateKey in SDK config.');
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
            throw new Error('No credential set. Call passkey.register() or passkey.setCredential() first.');
        }

        if (!this.sponsor.isConfigured()) {
            throw new Error('Gas sponsorship not configured. Set sponsorPrivateKey in SDK config.');
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
            throw new Error('No credential set');
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
            throw new Error('No credential set');
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
