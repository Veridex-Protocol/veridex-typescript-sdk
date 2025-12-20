/**
 * Veridex Protocol SDK - EVM Chain Client
 * 
 * Implementation of ChainClient interface for EVM-compatible chains
 */

import { ethers } from 'ethers';
import type {
    ChainClient,
    ChainConfig,
    TransferParams,
    ExecuteParams,
    BridgeParams,
    DispatchResult,
    WebAuthnSignature,
    VaultCreationResult,
} from '../../core/types.js';
import { encodeTransferAction, encodeExecuteAction, encodeBridgeAction } from '../../payload.js';

// ============================================================================
// Types
// ============================================================================

export interface EVMClientConfig {
    chainId: number;
    wormholeChainId: number;
    rpcUrl: string;
    hubContractAddress: string;
    wormholeCoreBridge: string;
    name?: string;
    explorerUrl?: string;
    vaultFactory?: string;
    vaultImplementation?: string;
    tokenBridge?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * EIP-1167 minimal proxy bytecode prefix (before implementation address)
 */
const PROXY_BYTECODE_PREFIX = '0x3d602d80600a3d3981f3363d3d373d3d3d363d73';

/**
 * EIP-1167 minimal proxy bytecode suffix (after implementation address)
 */
const PROXY_BYTECODE_SUFFIX = '5af43d82803e903d91602b57fd5bf3';

/**
 * ERC20 ABI for balance and transfer operations
 */
const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function name() view returns (string)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
];

// ============================================================================
// Hub Contract ABI (minimal)
// ============================================================================

const HUB_ABI = [
    'function dispatch(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) signature, uint256 publicKeyX, uint256 publicKeyY, uint16 targetChain, bytes actionPayload, uint256 nonce) payable returns (uint64 sequence)',
    'function getNonce(bytes32 userKeyHash) view returns (uint256)',
    'function getMessageFee() view returns (uint256)',
    'function getVaultAddress(bytes32 userKeyHash) view returns (address)',
    'function vaultExists(bytes32 userKeyHash) view returns (bool)',
    'function createVault(bytes32 userKeyHash) returns (address)',
    // Issue #9/#10: New Hub methods for Query-based execution
    'function getUserState(bytes32 userKeyHash) view returns (bytes32 keyHash, uint256 nonce, bytes32 lastActionHash)',
    'function getUserLastActionHash(bytes32 userKeyHash) view returns (bytes32)',
];

// ============================================================================
// Factory Contract ABI (minimal)
// ============================================================================

const FACTORY_ABI = [
    'function createVault(bytes32 ownerKeyHash) returns (address vault)',
    'function getVault(bytes32 ownerKeyHash) view returns (address)',
    'function computeVaultAddress(bytes32 ownerKeyHash) view returns (address vault)',
    'function vaultExists(bytes32 ownerKeyHash) view returns (bool)',
    'function implementation() view returns (address)',
];

// ============================================================================
// EVMClient Class
// ============================================================================

/**
 * EVM implementation of the ChainClient interface
 */
export class EVMClient implements ChainClient {
    private config: ChainConfig;
    private provider: ethers.JsonRpcProvider;
    private hubContract: ethers.Contract;
    private factoryContract: ethers.Contract | null = null;
    private cachedImplementation: string | null = null;

    constructor(config: EVMClientConfig) {
        this.config = {
            name: config.name ?? `EVM Chain ${config.chainId}`,
            chainId: config.chainId,
            wormholeChainId: config.wormholeChainId,
            rpcUrl: config.rpcUrl,
            explorerUrl: config.explorerUrl ?? '',
            isEvm: true,
            contracts: {
                hub: config.hubContractAddress,
                vaultFactory: config.vaultFactory,
                vaultImplementation: config.vaultImplementation,
                wormholeCoreBridge: config.wormholeCoreBridge,
                tokenBridge: config.tokenBridge,
            },
        };

        this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
        this.hubContract = new ethers.Contract(
            config.hubContractAddress,
            HUB_ABI,
            this.provider
        );

        // Initialize factory contract if address is provided
        if (config.vaultFactory) {
            this.factoryContract = new ethers.Contract(
                config.vaultFactory,
                FACTORY_ABI,
                this.provider
            );
        }

        // Cache implementation address if provided
        if (config.vaultImplementation) {
            this.cachedImplementation = config.vaultImplementation;
        }
    }

    getConfig(): ChainConfig {
        return this.config;
    }

    async getNonce(userKeyHash: string): Promise<bigint> {
        const nonce = await this.hubContract.getNonce(userKeyHash);
        return BigInt(nonce.toString());
    }

    /**
     * Get user state from Hub (Issue #9/#10)
     * Returns comprehensive state including last action hash
     */
    async getUserState(userKeyHash: string): Promise<{
        keyHash: string;
        nonce: bigint;
        lastActionHash: string;
    }> {
        try {
            const result = await this.hubContract.getUserState(userKeyHash);
            return {
                keyHash: result[0],
                nonce: BigInt(result[1].toString()),
                lastActionHash: result[2],
            };
        } catch (error) {
            // Fallback for older Hub deployments without getUserState
            const nonce = await this.getNonce(userKeyHash);
            return {
                keyHash: userKeyHash,
                nonce,
                lastActionHash: ethers.ZeroHash,
            };
        }
    }

    /**
     * Get user's last action hash from Hub (Issue #9/#10)
     * Returns zero hash if user has no actions yet
     */
    async getUserLastActionHash(userKeyHash: string): Promise<string> {
        try {
            return await this.hubContract.getUserLastActionHash(userKeyHash);
        } catch (error) {
            // Fallback for older Hub deployments
            return ethers.ZeroHash;
        }
    }

    async getMessageFee(): Promise<bigint> {
        const fee = await this.hubContract.getMessageFee();
        return BigInt(fee.toString());
    }

    async buildTransferPayload(params: TransferParams): Promise<string> {
        return encodeTransferAction(
            params.token,
            params.recipient,
            params.amount
        );
    }

    async buildExecutePayload(params: ExecuteParams): Promise<string> {
        return encodeExecuteAction(
            params.target,
            params.value,
            params.data
        );
    }

    async buildBridgePayload(params: BridgeParams): Promise<string> {
        return encodeBridgeAction(
            params.token,
            params.amount,
            params.destinationChain,
            params.recipient
        );
    }

    async dispatch(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        targetChain: number,
        actionPayload: string,
        nonce: bigint,
        signer: ethers.Signer
    ): Promise<DispatchResult> {
        const hubWithSigner = this.hubContract.connect(signer) as any;

        const signatureTuple = {
            authenticatorData: signature.authenticatorData,
            clientDataJSON: signature.clientDataJSON,
            challengeIndex: signature.challengeIndex,
            typeIndex: signature.typeIndex,
            r: signature.r,
            s: signature.s,
        };

        const messageFee = await this.getMessageFee();

        const tx = await hubWithSigner.dispatch(
            signatureTuple,
            publicKeyX,
            publicKeyY,
            targetChain,
            actionPayload,
            nonce,
            { value: messageFee }
        );

        const receipt = await tx.wait();

        // Extract sequence from event logs
        const dispatchEvent = receipt.logs.find((log: any) => {
            try {
                const parsed = hubWithSigner.interface.parseLog(log);
                return parsed?.name === 'ActionDispatched';
            } catch {
                return false;
            }
        });

        let sequence = 0n;
        if (dispatchEvent) {
            const parsed = hubWithSigner.interface.parseLog(dispatchEvent);
            sequence = BigInt(parsed?.args?.sequence?.toString() ?? '0');
        }

        const keyHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['uint256', 'uint256'],
                [publicKeyX, publicKeyY]
            )
        );

        return {
            transactionHash: receipt.hash,
            sequence,
            userKeyHash: keyHash,
            targetChain,
            blockNumber: receipt.blockNumber,
        };
    }

    /**
     * Dispatch an action to the Hub via relayer (gasless)
     * The relayer pays for gas and submits the transaction on behalf of the user
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
        // Compute message hash that was signed
        // This should match how the WebAuthn signature was generated
        const keyHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['uint256', 'uint256'],
                [publicKeyX, publicKeyY]
            )
        );

        // Build the message that was signed
        const message = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['bytes32', 'uint16', 'bytes', 'uint256'],
                [keyHash, targetChain, actionPayload, nonce]
            )
        );

        // Prepare request for relayer
        const request = {
            messageHash: message,
            r: '0x' + signature.r.toString(16).padStart(64, '0'),
            s: '0x' + signature.s.toString(16).padStart(64, '0'),
            publicKeyX: '0x' + publicKeyX.toString(16).padStart(64, '0'),
            publicKeyY: '0x' + publicKeyY.toString(16).padStart(64, '0'),
            targetChain,
            actionPayload,
            nonce: Number(nonce),
        };

        // Submit to relayer
        const response = await fetch(`${relayerUrl}/api/v1/submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(`Relayer submission failed: ${error.error || response.statusText}`);
        }

        const result = await response.json();

        if (!result.success) {
            throw new Error(`Relayer submission failed: ${result.error}`);
        }

        return {
            transactionHash: result.txHash,
            sequence: BigInt(result.sequence || '0'),
            userKeyHash: keyHash,
            targetChain,
        };
    }

    async getVaultAddress(userKeyHash: string): Promise<string | null> {
        try {
            // Try factory first if available
            if (this.factoryContract) {
                const address = await this.factoryContract.getVault(userKeyHash);
                if (address !== ethers.ZeroAddress) {
                    return address;
                }
            }

            // Fallback to hub contract
            const address = await this.hubContract.getVaultAddress(userKeyHash);
            if (address === ethers.ZeroAddress) {
                return null;
            }
            return address;
        } catch (error) {
            console.error('Error getting vault address:', error);
            return null;
        }
    }

    /**
     * Compute vault address deterministically without querying the chain
     * Uses CREATE2 with EIP-1167 minimal proxy pattern
     */
    computeVaultAddress(userKeyHash: string): string {
        const factoryAddress = this.getFactoryAddress();
        const implementationAddress = this.getImplementationAddress();

        if (!factoryAddress || !implementationAddress) {
            throw new Error('Factory and implementation addresses required for address computation');
        }

        // Compute salt: keccak256(abi.encodePacked(factory, keyHash))
        const salt = ethers.keccak256(
            ethers.solidityPacked(
                ['address', 'bytes32'],
                [factoryAddress, userKeyHash]
            )
        );

        // Build EIP-1167 initcode
        const initCode = this.buildProxyInitCode(implementationAddress);
        const initCodeHash = ethers.keccak256(initCode);

        // CREATE2 address computation:
        // address = keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12:]
        const create2Data = ethers.solidityPacked(
            ['bytes1', 'address', 'bytes32', 'bytes32'],
            ['0xff', factoryAddress, salt, initCodeHash]
        );

        const hash = ethers.keccak256(create2Data);
        // Take last 20 bytes as address
        return ethers.getAddress('0x' + hash.slice(26));
    }

    /**
     * Build EIP-1167 minimal proxy initcode
     */
    private buildProxyInitCode(implementationAddress: string): string {
        const impl = implementationAddress.toLowerCase().replace('0x', '');
        return PROXY_BYTECODE_PREFIX + impl + PROXY_BYTECODE_SUFFIX;
    }

    async vaultExists(userKeyHash: string): Promise<boolean> {
        try {
            // Try factory first if available
            if (this.factoryContract) {
                return await this.factoryContract.vaultExists(userKeyHash);
            }
            // Hub chains may not have vaultExists, silently return false
            if (this.hubContract.vaultExists) {
                try {
                    return await this.hubContract.vaultExists(userKeyHash);
                } catch {
                    // Hub contract doesn't have vaultExists - this is expected on hub-only chains
                    return false;
                }
            }
            return false;
        } catch {
            // Silently return false - vault existence check is non-critical
            return false;
        }
    }

    async createVault(userKeyHash: string, signer: ethers.Signer): Promise<VaultCreationResult> {
        // Check if vault already exists
        const exists = await this.vaultExists(userKeyHash);
        if (exists) {
            const address = await this.getVaultAddress(userKeyHash);
            if (address) {
                return {
                    address,
                    transactionHash: '',
                    blockNumber: 0,
                    gasUsed: 0n,
                    alreadyExisted: true,
                };
            }
        }

        // Create vault using factory or hub
        let tx: ethers.TransactionResponse;

        if (this.factoryContract) {
            const factoryWithSigner = this.factoryContract.connect(signer) as ethers.Contract;
            tx = await factoryWithSigner.createVault(userKeyHash);
        } else {
            const hubWithSigner = this.hubContract.connect(signer) as ethers.Contract;
            tx = await hubWithSigner.createVault(userKeyHash);
        }

        const receipt = await tx.wait();
        if (!receipt) {
            throw new Error('Transaction failed - no receipt');
        }

        const vaultAddress = await this.getVaultAddress(userKeyHash);
        if (!vaultAddress) {
            throw new Error('Failed to create vault - address not found after creation');
        }

        return {
            address: vaultAddress,
            transactionHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed,
            alreadyExisted: false,
        };
    }

    /**
     * Create a vault with a sponsor wallet paying for gas
     * 
     * @param userKeyHash - The user's passkey hash
     * @param sponsorPrivateKey - Private key of the wallet that will pay gas
     * @param rpcUrl - Optional RPC URL to use (defaults to client's RPC)
     * @returns VaultCreationResult with address and transaction details
     */
    async createVaultSponsored(
        userKeyHash: string,
        sponsorPrivateKey: string,
        rpcUrl?: string
    ): Promise<VaultCreationResult> {
        // Check if vault already exists
        const exists = await this.vaultExists(userKeyHash);
        if (exists) {
            const address = await this.getVaultAddress(userKeyHash);
            if (address) {
                return {
                    address,
                    transactionHash: '',
                    blockNumber: 0,
                    gasUsed: 0n,
                    alreadyExisted: true,
                };
            }
        }

        // Create sponsor signer
        const provider = rpcUrl
            ? new ethers.JsonRpcProvider(rpcUrl)
            : this.provider;
        const sponsorWallet = new ethers.Wallet(sponsorPrivateKey, provider);

        // Check sponsor balance
        const sponsorBalance = await provider.getBalance(sponsorWallet.address);
        const estimatedGas = await this.estimateVaultCreationGas(userKeyHash);
        const feeData = await provider.getFeeData();
        const estimatedCost = estimatedGas * (feeData.gasPrice ?? 1000000000n);

        if (sponsorBalance < estimatedCost) {
            throw new Error(
                `Sponsor wallet has insufficient funds. ` +
                `Balance: ${ethers.formatEther(sponsorBalance)} ETH, ` +
                `Estimated cost: ${ethers.formatEther(estimatedCost)} ETH`
            );
        }

        // Create vault using factory or hub with sponsor wallet
        let tx: ethers.TransactionResponse;

        if (this.factoryContract) {
            const factoryWithSponsor = this.factoryContract.connect(sponsorWallet) as ethers.Contract;
            tx = await factoryWithSponsor.createVault(userKeyHash);
        } else {
            const hubWithSponsor = this.hubContract.connect(sponsorWallet) as ethers.Contract;
            tx = await hubWithSponsor.createVault(userKeyHash);
        }

        const receipt = await tx.wait();
        if (!receipt) {
            throw new Error('Transaction failed - no receipt');
        }

        const vaultAddress = await this.getVaultAddress(userKeyHash);
        if (!vaultAddress) {
            throw new Error('Failed to create vault - address not found after creation');
        }

        return {
            address: vaultAddress,
            transactionHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed,
            alreadyExisted: false,
            sponsoredBy: sponsorWallet.address,
        };
    }

    async estimateVaultCreationGas(userKeyHash: string): Promise<bigint> {
        try {
            if (this.factoryContract) {
                return await this.factoryContract.createVault.estimateGas(userKeyHash);
            }
            return await this.hubContract.createVault.estimateGas(userKeyHash);
        } catch (error) {
            // Return a default estimate if estimation fails (vault might already exist)
            console.warn('Gas estimation failed, returning default:', error);
            return 150000n; // Default estimate for vault creation
        }
    }

    getFactoryAddress(): string | undefined {
        return this.config.contracts.vaultFactory;
    }

    getImplementationAddress(): string | undefined {
        return this.config.contracts.vaultImplementation ?? this.cachedImplementation ?? undefined;
    }

    /**
     * Fetch implementation address from factory contract
     */
    async fetchImplementationAddress(): Promise<string | null> {
        if (this.cachedImplementation) {
            return this.cachedImplementation;
        }

        if (!this.factoryContract) {
            return null;
        }

        try {
            this.cachedImplementation = await this.factoryContract.implementation();
            return this.cachedImplementation;
        } catch (error) {
            console.error('Error fetching implementation address:', error);
            return null;
        }
    }

    /**
     * Get the provider instance
     */
    getProvider(): ethers.JsonRpcProvider {
        return this.provider;
    }

    // ========================================================================
    // Balance Methods (Phase 2)
    // ========================================================================

    /**
     * Get native token balance for an address
     */
    async getNativeBalance(address: string): Promise<bigint> {
        return await this.provider.getBalance(address);
    }

    /**
     * Get ERC20 token balance for an address
     */
    async getTokenBalance(tokenAddress: string, ownerAddress: string): Promise<bigint> {
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
        return await contract.balanceOf(ownerAddress);
    }

    /**
     * Get token allowance
     */
    async getTokenAllowance(
        tokenAddress: string,
        ownerAddress: string,
        spenderAddress: string
    ): Promise<bigint> {
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
        return await contract.allowance(ownerAddress, spenderAddress);
    }

    /**
     * Estimate gas for a dispatch transaction
     */
    async estimateDispatchGas(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        targetChain: number,
        actionPayload: string,
        nonce: bigint
    ): Promise<bigint> {
        const signatureTuple = {
            authenticatorData: signature.authenticatorData,
            clientDataJSON: signature.clientDataJSON,
            challengeIndex: signature.challengeIndex,
            typeIndex: signature.typeIndex,
            r: signature.r,
            s: signature.s,
        };

        const messageFee = await this.getMessageFee();

        try {
            const gasEstimate = await this.hubContract.dispatch.estimateGas(
                signatureTuple,
                publicKeyX,
                publicKeyY,
                targetChain,
                actionPayload,
                nonce,
                { value: messageFee }
            );
            return gasEstimate;
        } catch (error) {
            console.warn('Gas estimation failed, using default:', error);
            return 500000n; // Default estimate for dispatch
        }
    }

    /**
     * Get current gas price
     */
    async getGasPrice(): Promise<bigint> {
        const feeData = await this.provider.getFeeData();
        return feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
    }

    /**
     * Get current block number
     */
    async getBlockNumber(): Promise<number> {
        return await this.provider.getBlockNumber();
    }

    /**
     * Get transaction receipt
     */
    async getTransactionReceipt(hash: string): Promise<ethers.TransactionReceipt | null> {
        return await this.provider.getTransactionReceipt(hash);
    }

    /**
     * Wait for transaction confirmation
     */
    async waitForTransaction(
        hash: string,
        confirmations: number = 1
    ): Promise<ethers.TransactionReceipt | null> {
        return await this.provider.waitForTransaction(hash, confirmations);
    }
}

