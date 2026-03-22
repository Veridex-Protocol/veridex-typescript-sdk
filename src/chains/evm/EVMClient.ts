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
    'function userNonces(bytes32 userKeyHash) view returns (uint256)',
    'function getMessageFee() view returns (uint256)',
    'function getVaultAddress(bytes32 userKeyHash) view returns (address)',
    'function vaultExists(bytes32 userKeyHash) view returns (bool)',
    'function createVault(bytes32 userKeyHash) returns (address)',
    // Issue #9/#10: New Hub methods for Query-based execution
    'function getUserState(bytes32 userKeyHash) view returns (bytes32 keyHash, uint256 nonce, bytes32 lastActionHash)',
    'function getUserLastActionHash(bytes32 userKeyHash) view returns (bytes32)',
    // Issue #13: Session key management
    'function registerSession(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, bytes32 sessionKeyHash, uint256 duration, uint256 maxValue, bool requireUV) external',
    'function isSessionActive(bytes32 userKeyHash, bytes32 sessionKeyHash) view returns (bool active, uint256 expiry, uint256 maxValue, uint256 sessionIndex)',
    'function revokeSession(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, bytes32 sessionKeyHash, bool requireUV) external',
    'function getUserSessions(bytes32 userKeyHash) view returns (tuple(bytes32 sessionKeyHash, uint256 expiry, uint256 maxValue, bool revoked)[])',
    'function getUserSessionCount(bytes32 userKeyHash) view returns (uint256)',
    // Issue #22: Backup Passkey / Multi-Key Identity management
    'function registerIdentity(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY) external',
    'function addBackupKey(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, uint256 newPublicKeyX, uint256 newPublicKeyY, uint256 nonce) external payable returns (uint64 sequence)',
    'function removeKey(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, bytes32 keyToRemove, uint256 nonce) external payable returns (uint64 sequence)',
    'function getIdentityForKey(bytes32 keyHash) view returns (bytes32)',
    'function getAuthorizedKeys(bytes32 identity) view returns (bytes32[])',
    'function getAuthorizedKeyCount(bytes32 identity) view returns (uint256)',
    'function isAuthorizedForIdentity(bytes32 identity, bytes32 keyHash) view returns (bool)',
    'function isIdentityRoot(bytes32 keyHash) view returns (bool)',
    'function getIdentityState(bytes32 keyHash) view returns (bytes32 identity, uint256 keyCount, uint256 maxKeys, bool isRoot)',
    
    // Issue #23: Social Recovery / Guardian Management
    'function setupGuardians(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, bytes32[] guardians, uint256 threshold) external payable returns (uint64 sequence)',
    'function addGuardian(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, bytes32 guardianKeyHash) external payable returns (uint64 sequence)',
    'function removeGuardian(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, bytes32 guardianKeyHash) external payable returns (uint64 sequence)',
    'function initiateRecovery(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, bytes32 identityToRecover, bytes32 newOwnerKeyHash) external payable returns (uint64 sequence)',
    'function approveRecovery(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, bytes32 identityToRecover) external payable returns (uint64 sequence)',
    'function executeRecovery(bytes32 identityToRecover, uint256 newPublicKeyX, uint256 newPublicKeyY) external payable returns (uint64 sequence)',
    'function cancelRecovery(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY) external payable returns (uint64 sequence)',
    'function getGuardians(bytes32 identityKeyHash) view returns (bytes32[] guardians, uint256 threshold, bool isConfigured)',
    'function getRecoveryStatus(bytes32 identityKeyHash) view returns (bool isActive, bytes32 newOwnerKeyHash, uint256 initiatedAt, uint256 approvalCount, uint256 threshold, uint256 canExecuteAt, uint256 expiresAt)',
    'function hasGuardianApproved(bytes32 identityKeyHash, bytes32 guardianKeyHash) view returns (bool hasApproved)',
    
    // ADR-0037: Threshold Multisig
    'function configureTransactionPolicy(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, uint256 threshold, uint256 protectedActionMask, uint256 proposalTtl, bool disableSessions) external',
    'function createTransactionProposal(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, uint16 targetChain, bytes actionPayload) external returns (bytes32 proposalId)',
    'function approveTransactionProposal(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, bytes32 proposalId) external returns (uint256 approvalCount, bool thresholdReached)',
    'function cancelTransactionProposal(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, bytes32 proposalId) external',
    'function executeTransactionProposal(bytes32 proposalId) external payable returns (uint64 sequence)',
    'function getTransactionPolicy(bytes32 identityKeyHash) view returns (bool enabled, uint256 threshold, uint256 protectedActionMask, uint256 proposalTtl, bool disableSessions)',
    'function getTransactionProposal(bytes32 proposalId) view returns (bytes32 identityKeyHash, bytes32 proposerKeyHash, uint16 targetChain, uint8 actionType, bytes32 actionHash, uint256 createdAt, uint256 expiresAt, uint256 approvalCount, uint256 requiredThreshold, uint8 state)',
    'function hasApprovedTransactionProposal(bytes32 proposalId, bytes32 keyHash) view returns (bool)',
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
        const nonce = await this.hubContract.userNonces(userKeyHash);
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

    // ==========================================================================
    // Session Management Methods (Issue #13)
    // ==========================================================================

    /**
     * Register a new session key for temporary authentication
     * Enables native L1 speed for repeat transactions without biometric auth
     * 
     * @param params Session registration parameters
     * @param signer Ethereum signer to pay gas
     * @returns Transaction receipt
     */
    async registerSession(
        params: import('../../types.js').RegisterSessionParams,
        signer: ethers.Signer
    ): Promise<ethers.TransactionReceipt> {
        const hubWithSigner = this.hubContract.connect(signer) as any;

        const authTuple = {
            authenticatorData: params.signature.authenticatorData,
            clientDataJSON: params.signature.clientDataJSON,
            challengeIndex: params.signature.challengeIndex,
            typeIndex: params.signature.typeIndex,
            r: params.signature.r,
            s: params.signature.s,
        };

        const tx = await hubWithSigner.registerSession(
            authTuple,
            params.publicKeyX,
            params.publicKeyY,
            params.sessionKeyHash,
            params.duration,
            params.maxValue,
            params.requireUV
        );

        return await tx.wait();
    }

    /**
     * Check if a session is currently active (queryable via Wormhole CCQ)
     * 
     * @param userKeyHash Hash of the user's Passkey public key
     * @param sessionKeyHash Hash of the session key to check
     * @returns Session validation result
     */
    async isSessionActive(
        userKeyHash: string,
        sessionKeyHash: string
    ): Promise<import('../../types.js').SessionValidationResult> {
        const result = await this.hubContract.isSessionActive(userKeyHash, sessionKeyHash);
        
        return {
            active: result[0],
            expiry: Number(result[1]),
            maxValue: BigInt(result[2].toString()),
            sessionIndex: Number(result[3]),
        };
    }

    /**
     * Revoke a session key immediately
     * 
     * @param params Session revocation parameters
     * @param signer Ethereum signer to pay gas
     * @returns Transaction receipt
     */
    async revokeSession(
        params: import('../../types.js').RevokeSessionParams,
        signer: ethers.Signer
    ): Promise<ethers.TransactionReceipt> {
        const hubWithSigner = this.hubContract.connect(signer) as any;

        const authTuple = {
            authenticatorData: params.signature.authenticatorData,
            clientDataJSON: params.signature.clientDataJSON,
            challengeIndex: params.signature.challengeIndex,
            typeIndex: params.signature.typeIndex,
            r: params.signature.r,
            s: params.signature.s,
        };

        const tx = await hubWithSigner.revokeSession(
            authTuple,
            params.publicKeyX,
            params.publicKeyY,
            params.sessionKeyHash,
            params.requireUV
        );

        return await tx.wait();
    }

    /**
     * Get all sessions for a user
     * 
     * @param userKeyHash Hash of the user's Passkey public key
     * @returns Array of all sessions (active and expired/revoked)
     */
    async getUserSessions(userKeyHash: string): Promise<import('../../types.js').SessionKey[]> {
        const sessions = await this.hubContract.getUserSessions(userKeyHash);
        
        return sessions.map((s: any) => ({
            sessionKeyHash: s.sessionKeyHash,
            expiry: Number(s.expiry),
            maxValue: BigInt(s.maxValue.toString()),
            revoked: s.revoked,
        }));
    }

    /**
     * Get the number of sessions for a user
     * 
     * @param userKeyHash Hash of the user's Passkey public key
     * @returns Number of sessions
     */
    async getUserSessionCount(userKeyHash: string): Promise<number> {
        const count = await this.hubContract.getUserSessionCount(userKeyHash);
        return Number(count);
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

    // ==========================================================================
    // Backup Passkey / Multi-Key Identity Methods (Issue #22)
    // ==========================================================================

    /**
     * Get the identity for a given key hash
     * Returns zero hash if key is not registered to any identity
     * 
     * @param keyHash Hash of the passkey to look up
     * @returns Identity (first passkey's keyHash) or zero hash
     */
    async getIdentityForKey(keyHash: string): Promise<string> {
        try {
            return await this.hubContract.getIdentityForKey(keyHash);
        } catch (error) {
            return ethers.ZeroHash;
        }
    }

    /**
     * Get all authorized keys for an identity
     * 
     * @param identity The identity key hash (first passkey's keyHash)
     * @returns Array of authorized key hashes
     */
    async getAuthorizedKeys(identity: string): Promise<string[]> {
        try {
            return await this.hubContract.getAuthorizedKeys(identity);
        } catch (error) {
            return [];
        }
    }

    /**
     * Get count of authorized keys for an identity
     * 
     * @param identity The identity key hash
     * @returns Number of authorized keys
     */
    async getAuthorizedKeyCount(identity: string): Promise<number> {
        try {
            const count = await this.hubContract.getAuthorizedKeyCount(identity);
            return Number(count);
        } catch (error) {
            return 0;
        }
    }

    /**
     * Check if a key is authorized for an identity
     * 
     * @param identity The identity key hash
     * @param keyHash The key hash to check
     * @returns Whether the key is authorized
     */
    async isAuthorizedForIdentity(identity: string, keyHash: string): Promise<boolean> {
        try {
            return await this.hubContract.isAuthorizedForIdentity(identity, keyHash);
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if a key is the root identity key
     * 
     * @param keyHash The key hash to check
     * @returns Whether the key is a root identity
     */
    async isIdentityRootKey(keyHash: string): Promise<boolean> {
        try {
            return await this.hubContract.isIdentityRoot(keyHash);
        } catch (error) {
            return false;
        }
    }

    /**
     * Get comprehensive identity state for a key
     * 
     * @param keyHash Hash of any key in the identity
     * @returns Identity state including count, max, and root status
     */
    async getIdentityState(keyHash: string): Promise<import('../../types.js').IdentityState> {
        try {
            const result = await this.hubContract.getIdentityState(keyHash);
            return {
                identity: result[0],
                keyCount: Number(result[1]),
                maxKeys: Number(result[2]),
                isRoot: result[3],
            };
        } catch (error) {
            // Fallback for keys not registered
            return {
                identity: ethers.ZeroHash,
                keyCount: 0,
                maxKeys: 5,
                isRoot: false,
            };
        }
    }

    /**
     * Register a new identity with the first passkey
     * This makes the passkey the root identity key
     * 
     * @param signature WebAuthn signature
     * @param publicKeyX Passkey public key X coordinate
     * @param publicKeyY Passkey public key Y coordinate
     * @param signer Ethereum signer to pay gas
     * @returns Transaction receipt and identity hash
     */
    async registerIdentity(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        signer: ethers.Signer
    ): Promise<{ receipt: ethers.TransactionReceipt; identity: string }> {
        const hubWithSigner = this.hubContract.connect(signer) as any;

        const authTuple = {
            authenticatorData: signature.authenticatorData,
            clientDataJSON: signature.clientDataJSON,
            challengeIndex: signature.challengeIndex,
            typeIndex: signature.typeIndex,
            r: signature.r,
            s: signature.s,
        };

        const tx = await hubWithSigner.registerIdentity(
            authTuple,
            publicKeyX,
            publicKeyY
        );

        const receipt = await tx.wait();
        
        // Compute identity (keyHash of the registered key)
        const keyHash = ethers.keccak256(
            ethers.solidityPacked(['uint256', 'uint256'], [publicKeyX, publicKeyY])
        );

        return { receipt, identity: keyHash };
    }

    /**
     * Add a backup passkey to an existing identity
     * Requires WebAuthn signature from an authorized key
     * 
     * @param signature WebAuthn signature from existing authorized key
     * @param publicKeyX Existing key's X coordinate
     * @param publicKeyY Existing key's Y coordinate
     * @param newPublicKeyX New backup key's X coordinate
     * @param newPublicKeyY New backup key's Y coordinate
     * @param nonce Current nonce for the signing key
     * @param signer Ethereum signer to pay gas
     * @returns Transaction receipt and sequence number
     */
    async addBackupKey(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        newPublicKeyX: bigint,
        newPublicKeyY: bigint,
        nonce: bigint,
        signer: ethers.Signer
    ): Promise<{ receipt: ethers.TransactionReceipt; sequence: bigint }> {
        const hubWithSigner = this.hubContract.connect(signer) as any;

        const authTuple = {
            authenticatorData: signature.authenticatorData,
            clientDataJSON: signature.clientDataJSON,
            challengeIndex: signature.challengeIndex,
            typeIndex: signature.typeIndex,
            r: signature.r,
            s: signature.s,
        };

        const messageFee = await this.getMessageFee();

        const tx = await hubWithSigner.addBackupKey(
            authTuple,
            publicKeyX,
            publicKeyY,
            newPublicKeyX,
            newPublicKeyY,
            nonce,
            { value: messageFee }
        );

        const receipt = await tx.wait();

        // Extract sequence from Dispatch event
        let sequence = 0n;
        for (const log of receipt.logs) {
            try {
                const parsed = this.hubContract.interface.parseLog({
                    topics: log.topics as string[],
                    data: log.data,
                });
                if (parsed?.name === 'Dispatched') {
                    sequence = BigInt(parsed.args[3]); // sequence is 4th arg
                    break;
                }
            } catch {
                // Not a Hub event, skip
            }
        }

        return { receipt, sequence };
    }

    /**
     * Remove a passkey from an identity
     * Cannot remove the last remaining key
     * 
     * @param signature WebAuthn signature from an authorized key
     * @param publicKeyX Signing key's X coordinate
     * @param publicKeyY Signing key's Y coordinate
     * @param keyToRemove Hash of the key to remove
     * @param nonce Current nonce for the signing key
     * @param signer Ethereum signer to pay gas
     * @returns Transaction receipt and sequence number
     */
    async removeKey(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        keyToRemove: string,
        nonce: bigint,
        signer: ethers.Signer
    ): Promise<{ receipt: ethers.TransactionReceipt; sequence: bigint }> {
        const hubWithSigner = this.hubContract.connect(signer) as any;

        const authTuple = {
            authenticatorData: signature.authenticatorData,
            clientDataJSON: signature.clientDataJSON,
            challengeIndex: signature.challengeIndex,
            typeIndex: signature.typeIndex,
            r: signature.r,
            s: signature.s,
        };

        const messageFee = await this.getMessageFee();

        const tx = await hubWithSigner.removeKey(
            authTuple,
            publicKeyX,
            publicKeyY,
            keyToRemove,
            nonce,
            { value: messageFee }
        );

        const receipt = await tx.wait();

        // Extract sequence from Dispatch event
        let sequence = 0n;
        for (const log of receipt.logs) {
            try {
                const parsed = this.hubContract.interface.parseLog({
                    topics: log.topics as string[],
                    data: log.data,
                });
                if (parsed?.name === 'Dispatched') {
                    sequence = BigInt(parsed.args[3]);
                    break;
                }
            } catch {
                // Not a Hub event, skip
            }
        }

        return { receipt, sequence };
    }

    // =========================================================================
    //                      SOCIAL RECOVERY METHODS (Issue #23)
    // =========================================================================

    /**
     * Setup guardians for an identity
     * @param signature WebAuthn signature from owner
     * @param publicKeyX Owner's public key X coordinate
     * @param publicKeyY Owner's public key Y coordinate
     * @param guardians Array of guardian key hashes
     * @param threshold Required approvals for recovery
     * @param signer Ethers signer for transaction
     */
    async setupGuardians(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        guardians: string[],
        threshold: bigint,
        signer: ethers.Signer
    ): Promise<{ receipt: ethers.TransactionReceipt; sequence: bigint }> {
        const hubWithSigner = this.hubContract.connect(signer) as any;

        const authTuple = {
            authenticatorData: signature.authenticatorData,
            clientDataJSON: signature.clientDataJSON,
            challengeIndex: signature.challengeIndex,
            typeIndex: signature.typeIndex,
            r: signature.r,
            s: signature.s,
        };

        const messageFee = await this.getMessageFee();

        const tx = await hubWithSigner.setupGuardians(
            authTuple,
            publicKeyX,
            publicKeyY,
            guardians,
            threshold,
            { value: messageFee }
        );

        const receipt = await tx.wait();
        const sequence = this._extractSequenceFromReceipt(receipt);

        return { receipt, sequence };
    }

    /**
     * Add a guardian to an identity
     */
    async addGuardian(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        guardianKeyHash: string,
        signer: ethers.Signer
    ): Promise<{ receipt: ethers.TransactionReceipt; sequence: bigint }> {
        const hubWithSigner = this.hubContract.connect(signer) as any;

        const authTuple = {
            authenticatorData: signature.authenticatorData,
            clientDataJSON: signature.clientDataJSON,
            challengeIndex: signature.challengeIndex,
            typeIndex: signature.typeIndex,
            r: signature.r,
            s: signature.s,
        };

        const messageFee = await this.getMessageFee();

        const tx = await hubWithSigner.addGuardian(
            authTuple,
            publicKeyX,
            publicKeyY,
            guardianKeyHash,
            { value: messageFee }
        );

        const receipt = await tx.wait();
        const sequence = this._extractSequenceFromReceipt(receipt);

        return { receipt, sequence };
    }

    /**
     * Remove a guardian from an identity
     */
    async removeGuardian(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        guardianKeyHash: string,
        signer: ethers.Signer
    ): Promise<{ receipt: ethers.TransactionReceipt; sequence: bigint }> {
        const hubWithSigner = this.hubContract.connect(signer) as any;

        const authTuple = {
            authenticatorData: signature.authenticatorData,
            clientDataJSON: signature.clientDataJSON,
            challengeIndex: signature.challengeIndex,
            typeIndex: signature.typeIndex,
            r: signature.r,
            s: signature.s,
        };

        const messageFee = await this.getMessageFee();

        const tx = await hubWithSigner.removeGuardian(
            authTuple,
            publicKeyX,
            publicKeyY,
            guardianKeyHash,
            { value: messageFee }
        );

        const receipt = await tx.wait();
        const sequence = this._extractSequenceFromReceipt(receipt);

        return { receipt, sequence };
    }

    /**
     * Initiate recovery as a guardian
     */
    async initiateRecovery(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        identityToRecover: string,
        newOwnerKeyHash: string,
        signer: ethers.Signer
    ): Promise<{ receipt: ethers.TransactionReceipt; sequence: bigint }> {
        const hubWithSigner = this.hubContract.connect(signer) as any;

        const authTuple = {
            authenticatorData: signature.authenticatorData,
            clientDataJSON: signature.clientDataJSON,
            challengeIndex: signature.challengeIndex,
            typeIndex: signature.typeIndex,
            r: signature.r,
            s: signature.s,
        };

        const messageFee = await this.getMessageFee();

        const tx = await hubWithSigner.initiateRecovery(
            authTuple,
            publicKeyX,
            publicKeyY,
            identityToRecover,
            newOwnerKeyHash,
            { value: messageFee }
        );

        const receipt = await tx.wait();
        const sequence = this._extractSequenceFromReceipt(receipt);

        return { receipt, sequence };
    }

    /**
     * Approve recovery as a guardian
     */
    async approveRecovery(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        identityToRecover: string,
        signer: ethers.Signer
    ): Promise<{ receipt: ethers.TransactionReceipt; sequence: bigint }> {
        const hubWithSigner = this.hubContract.connect(signer) as any;

        const authTuple = {
            authenticatorData: signature.authenticatorData,
            clientDataJSON: signature.clientDataJSON,
            challengeIndex: signature.challengeIndex,
            typeIndex: signature.typeIndex,
            r: signature.r,
            s: signature.s,
        };

        const messageFee = await this.getMessageFee();

        const tx = await hubWithSigner.approveRecovery(
            authTuple,
            publicKeyX,
            publicKeyY,
            identityToRecover,
            { value: messageFee }
        );

        const receipt = await tx.wait();
        const sequence = this._extractSequenceFromReceipt(receipt);

        return { receipt, sequence };
    }

    /**
     * Execute recovery after timelock (anyone can call)
     */
    async executeRecovery(
        identityToRecover: string,
        newPublicKeyX: bigint,
        newPublicKeyY: bigint,
        signer: ethers.Signer
    ): Promise<{ receipt: ethers.TransactionReceipt; sequence: bigint }> {
        const hubWithSigner = this.hubContract.connect(signer) as any;

        const messageFee = await this.getMessageFee();

        const tx = await hubWithSigner.executeRecovery(
            identityToRecover,
            newPublicKeyX,
            newPublicKeyY,
            { value: messageFee }
        );

        const receipt = await tx.wait();
        const sequence = this._extractSequenceFromReceipt(receipt);

        return { receipt, sequence };
    }

    /**
     * Cancel recovery as owner
     */
    async cancelRecovery(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        signer: ethers.Signer
    ): Promise<{ receipt: ethers.TransactionReceipt; sequence: bigint }> {
        const hubWithSigner = this.hubContract.connect(signer) as any;

        const authTuple = {
            authenticatorData: signature.authenticatorData,
            clientDataJSON: signature.clientDataJSON,
            challengeIndex: signature.challengeIndex,
            typeIndex: signature.typeIndex,
            r: signature.r,
            s: signature.s,
        };

        const messageFee = await this.getMessageFee();

        const tx = await hubWithSigner.cancelRecovery(
            authTuple,
            publicKeyX,
            publicKeyY,
            { value: messageFee }
        );

        const receipt = await tx.wait();
        const sequence = this._extractSequenceFromReceipt(receipt);

        return { receipt, sequence };
    }

    /**
     * Get guardians for an identity
     */
    async getGuardians(identityKeyHash: string): Promise<{
        guardians: string[];
        threshold: bigint;
        isConfigured: boolean;
    }> {
        const result = await this.hubContract.getGuardians(identityKeyHash);
        return {
            guardians: result.guardians,
            threshold: result.threshold,
            isConfigured: result.isConfigured,
        };
    }

    /**
     * Get recovery status for an identity
     */
    async getRecoveryStatus(identityKeyHash: string): Promise<{
        isActive: boolean;
        newOwnerKeyHash: string;
        initiatedAt: bigint;
        approvalCount: bigint;
        threshold: bigint;
        canExecuteAt: bigint;
        expiresAt: bigint;
    }> {
        const result = await this.hubContract.getRecoveryStatus(identityKeyHash);
        return {
            isActive: result.isActive,
            newOwnerKeyHash: result.newOwnerKeyHash,
            initiatedAt: result.initiatedAt,
            approvalCount: result.approvalCount,
            threshold: result.threshold,
            canExecuteAt: result.canExecuteAt,
            expiresAt: result.expiresAt,
        };
    }

    /**
     * Check if a guardian has approved recovery
     */
    async hasGuardianApproved(
        identityKeyHash: string,
        guardianKeyHash: string
    ): Promise<boolean> {
        return this.hubContract.hasGuardianApproved(identityKeyHash, guardianKeyHash);
    }

    // ========================================================================
    // Threshold Multisig (ADR-0037)
    // ========================================================================

    async configureTransactionPolicy(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        threshold: number,
        protectedActionMask: number,
        proposalTtl: number,
        disableSessions: boolean,
        signer: unknown,
    ): Promise<{ receipt: unknown }> {
        const s = signer as ethers.Signer;
        const hub = this.hubContract.connect(s) as ethers.Contract;
        const authTuple = this._toAuthTuple(signature);
        const tx = await hub.configureTransactionPolicy(
            authTuple,
            publicKeyX,
            publicKeyY,
            threshold,
            protectedActionMask,
            proposalTtl,
            disableSessions,
        );
        const receipt = await tx.wait();
        return { receipt };
    }

    async getTransactionPolicy(identityKeyHash: string): Promise<{
        enabled: boolean;
        threshold: number;
        protectedActionMask: number;
        proposalTtl: number;
        disableSessions: boolean;
    }> {
        const result = await this.hubContract.getTransactionPolicy(identityKeyHash);
        return {
            enabled: result.enabled,
            threshold: Number(result.threshold),
            protectedActionMask: Number(result.protectedActionMask),
            proposalTtl: Number(result.proposalTtl),
            disableSessions: result.disableSessions,
        };
    }

    async createTransactionProposal(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        targetChain: number,
        actionPayload: string,
        signer: unknown,
    ): Promise<{ proposalId: string; receipt: unknown; sequence: bigint }> {
        const s = signer as ethers.Signer;
        const hub = this.hubContract.connect(s) as ethers.Contract;
        const authTuple = this._toAuthTuple(signature);
        const tx = await hub.createTransactionProposal(
            authTuple,
            publicKeyX,
            publicKeyY,
            targetChain,
            actionPayload,
        );
        const receipt = await tx.wait();

        // Extract proposalId from logs
        let proposalId = ethers.ZeroHash;
        for (const log of receipt.logs) {
            try {
                const parsed = this.hubContract.interface.parseLog({
                    topics: log.topics as string[],
                    data: log.data,
                });
                if (parsed?.name === 'ProposalCreated') {
                    proposalId = parsed.args.proposalId;
                    break;
                }
            } catch {
                // Not our event
            }
        }

        return { proposalId, receipt, sequence: 0n };
    }

    async approveTransactionProposal(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        proposalId: string,
        signer: unknown,
    ): Promise<{ receipt: unknown; approvalCount: number; thresholdReached: boolean }> {
        const s = signer as ethers.Signer;
        const hub = this.hubContract.connect(s) as ethers.Contract;
        const authTuple = this._toAuthTuple(signature);
        const tx = await hub.approveTransactionProposal(
            authTuple,
            publicKeyX,
            publicKeyY,
            proposalId,
        );
        const receipt = await tx.wait();

        // Extract approval info from logs
        let approvalCount = 0;
        let thresholdReached = false;
        for (const log of receipt.logs) {
            try {
                const parsed = this.hubContract.interface.parseLog({
                    topics: log.topics as string[],
                    data: log.data,
                });
                if (parsed?.name === 'ProposalApproved') {
                    approvalCount = Number(parsed.args.currentApprovals);
                    thresholdReached = Number(parsed.args.currentApprovals) >= Number(parsed.args.requiredThreshold);
                    break;
                }
            } catch {
                // Not our event
            }
        }

        return { receipt, approvalCount, thresholdReached };
    }

    async cancelTransactionProposal(
        signature: WebAuthnSignature,
        publicKeyX: bigint,
        publicKeyY: bigint,
        proposalId: string,
        signer: unknown,
    ): Promise<{ receipt: unknown }> {
        const s = signer as ethers.Signer;
        const hub = this.hubContract.connect(s) as ethers.Contract;
        const authTuple = this._toAuthTuple(signature);
        const tx = await hub.cancelTransactionProposal(
            authTuple,
            publicKeyX,
            publicKeyY,
            proposalId,
        );
        const receipt = await tx.wait();
        return { receipt };
    }

    async executeTransactionProposal(
        proposalId: string,
        signer: unknown,
    ): Promise<{ receipt: unknown; sequence: bigint }> {
        const s = signer as ethers.Signer;
        const hub = this.hubContract.connect(s) as ethers.Contract;
        const fee = await this.hubContract.getMessageFee();
        const tx = await hub.executeTransactionProposal(proposalId, { value: fee });
        const receipt = await tx.wait();
        const sequence = this._extractSequenceFromReceipt(receipt);
        return { receipt, sequence };
    }

    async getTransactionProposal(proposalId: string): Promise<{
        identityKeyHash: string;
        proposerKeyHash: string;
        targetChain: number;
        actionType: number;
        actionHash: string;
        createdAt: bigint;
        expiresAt: bigint;
        approvalCount: number;
        requiredThreshold: number;
        state: number;
    }> {
        const result = await this.hubContract.getTransactionProposal(proposalId);
        return {
            identityKeyHash: result.identityKeyHash,
            proposerKeyHash: result.proposerKeyHash,
            targetChain: Number(result.targetChain),
            actionType: Number(result.actionType),
            actionHash: result.actionHash,
            createdAt: result.createdAt,
            expiresAt: result.expiresAt,
            approvalCount: Number(result.approvalCount),
            requiredThreshold: Number(result.requiredThreshold),
            state: Number(result.state),
        };
    }

    async hasApprovedTransactionProposal(
        proposalId: string,
        keyHash: string,
    ): Promise<boolean> {
        return this.hubContract.hasApprovedTransactionProposal(proposalId, keyHash);
    }

    /**
     * Convert a WebAuthnSignature to the struct tuple expected by the Hub contract
     */
    private _toAuthTuple(sig: WebAuthnSignature) {
        return {
            authenticatorData: sig.authenticatorData,
            clientDataJSON: sig.clientDataJSON,
            challengeIndex: sig.challengeIndex,
            typeIndex: sig.typeIndex,
            r: sig.r,
            s: sig.s,
        };
    }

    /**
     * Helper to extract sequence from transaction receipt
     */
    private _extractSequenceFromReceipt(receipt: ethers.TransactionReceipt): bigint {
        for (const log of receipt.logs) {
            try {
                const parsed = this.hubContract.interface.parseLog({
                    topics: log.topics as string[],
                    data: log.data,
                });
                if (parsed?.name === 'Dispatch') {
                    return BigInt(parsed.args.sequence);
                }
            } catch {
                // Not a Hub event, skip
            }
        }
        return 0n;
    }
}
