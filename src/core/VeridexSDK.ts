/**
 * Veridex Protocol SDK - Main SDK Class
 */

import { PasskeyManager } from './PasskeyManager.js';
import { WalletManager, type ChainAddressConfig } from './WalletManager.js';
import { BalanceManager, type TokenBalance, type PortfolioBalance } from './BalanceManager.js';
import { TransactionTracker, type TransactionState, type TransactionCallback } from './TransactionTracker.js';
import { 
    CrossChainManager, 
    type CrossChainConfig, 
    type CrossChainProgress, 
    type CrossChainResult,
    type CrossChainFees,
    type CrossChainProgressCallback,
} from './CrossChainManager.js';
import { RelayerClient, type RelayerClientConfig } from './RelayerClient.js';
import { buildChallenge } from '../payload.js';
import { normalizeEmitterAddress } from '../wormhole.js';
import { 
    getTokenList, 
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
    private readonly chain: ChainClient;
    private readonly relayerUrl?: string;
    private readonly relayer?: RelayerClient;
    private readonly testnet: boolean;
    private unifiedIdentity: UnifiedIdentity | null = null;

    constructor(config: VeridexConfig) {
        this.chain = config.chain;
        this.relayerUrl = config.relayerUrl;
        this.testnet = config.testnet ?? true;
        this.passkey = new PasskeyManager();
        this.wallet = new WalletManager({
            cacheAddresses: true,
            persistToStorage: config.persistWallet ?? true,
        });
        this.balance = new BalanceManager({
            cacheBalances: true,
            cacheTtl: 30_000, // 30 seconds
        });
        this.transactions = new TransactionTracker({
            pollingInterval: 2000,
            requiredConfirmations: 1,
        });
        this.crossChain = new CrossChainManager({
            testnet: this.testnet,
            relayerUrl: config.relayerUrl,
            autoRelay: !!config.relayerUrl,
        });

        // Initialize relayer client if URL provided
        if (config.relayerUrl) {
            this.relayer = new RelayerClient({
                baseUrl: config.relayerUrl,
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
        const crossChainResult = this.crossChain.trackTransfer(
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
        let destinationTxHash: string | undefined;
        if (vaa && this.relayer) {
            onProgress?.({
                status: 'relaying',
                step: 6,
                totalSteps: 6,
                message: 'Relaying to destination chain...',
            });

            try {
                const relayRequest = await this.relayer.submitRelay(
                    vaa,
                    prepared.sourceChain,
                    prepared.destinationChain,
                    dispatchResult.transactionHash,
                    dispatchResult.sequence
                );

                // Wait for relay completion
                const completedRelay = await this.relayer.waitForRelay(
                    relayRequest.id,
                    60_000, // 1 minute timeout
                    3_000
                );

                destinationTxHash = completedRelay.destinationTxHash;
            } catch (error) {
                console.warn('Relay failed:', error);
            }
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
        return await this.balance.getPortfolioBalance(
            chainConfig.wormholeChainId,
            vaultAddress,
            includeZeroBalances
        );
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

        // For now, use the primary chain's vault address
        // In a full implementation, each chain would have its own vault address computation
        const vaultAddress = this.getVaultAddress();
        return await this.balance.getMultiChainBalances(vaultAddress, chainIds);
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
