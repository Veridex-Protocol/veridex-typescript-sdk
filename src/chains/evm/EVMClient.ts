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
// Hub Contract ABI (minimal)
// ============================================================================

const HUB_ABI = [
    'function dispatch(tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) signature, uint256 publicKeyX, uint256 publicKeyY, uint16 targetChain, bytes actionPayload, uint256 nonce) payable returns (uint64 sequence)',
    'function getNonce(bytes32 userKeyHash) view returns (uint256)',
    'function getMessageFee() view returns (uint256)',
    'function getVaultAddress(bytes32 userKeyHash) view returns (address)',
    'function vaultExists(bytes32 userKeyHash) view returns (bool)',
    'function createVault(bytes32 userKeyHash) returns (address)',
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
    }

    getConfig(): ChainConfig {
        return this.config;
    }

    async getNonce(userKeyHash: string): Promise<bigint> {
        const nonce = await this.hubContract.getNonce(userKeyHash);
        return BigInt(nonce.toString());
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

    async getVaultAddress(userKeyHash: string): Promise<string | null> {
        try {
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

    async vaultExists(userKeyHash: string): Promise<boolean> {
        try {
            return await this.hubContract.vaultExists(userKeyHash);
        } catch (error) {
            console.error('Error checking vault existence:', error);
            return false;
        }
    }

    async createVault(userKeyHash: string, signer: ethers.Signer): Promise<string> {
        const hubWithSigner = this.hubContract.connect(signer) as any;
        const tx = await hubWithSigner.createVault(userKeyHash);
        await tx.wait();

        const vaultAddress = await this.getVaultAddress(userKeyHash);
        if (!vaultAddress) {
            throw new Error('Failed to create vault');
        }

        return vaultAddress;
    }
}
