/**
 * Veridex Protocol SDK - Starknet Chain Client
 *
 * Starknet is not supported by Wormhole today; Veridex uses a custom bridge.
 * This client implements the ChainClient interface for wallet identity and
 * basic chain utilities, but cross-chain dispatch remains Hub-driven.
 */

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
}

// ============================================================================
// StarknetClient
// ============================================================================

export class StarknetClient implements ChainClient {
    private config: ChainConfig;
    private provider: RpcProvider;

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
            'Starknet actions are executed via the Veridex Hub + custom bridge.'
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
        const keyHash = this.computeKeyHash(publicKeyX, publicKeyY);
        const messageHash = this.buildMessageHash(keyHash, targetChain, actionPayload, nonce);

        const request = {
            messageHash,
            r: '0x' + signature.r.toString(16).padStart(64, '0'),
            s: '0x' + signature.s.toString(16).padStart(64, '0'),
            publicKeyX: '0x' + publicKeyX.toString(16).padStart(64, '0'),
            publicKeyY: '0x' + publicKeyY.toString(16).padStart(64, '0'),
            targetChain,
            actionPayload,
            nonce: Number(nonce),
        };

        const response = await fetch(`${relayerUrl}/api/v1/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            throw new Error(`Relayer submission failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        return {
            transactionHash: result.transactionHash ?? result.txHash,
            sequence: BigInt(result.sequence || 0),
            userKeyHash: keyHash,
            targetChain,
        };
    }

    async getVaultAddress(userKeyHash: string): Promise<string | null> {
        return this.computeVaultAddress(userKeyHash);
    }

    computeVaultAddress(userKeyHash: string): string {
        // Starknet addresses are felt252; for SDK identity we use a 0x-prefixed hex string.
        // We derive a stable value from the passkey keyHash.
        const clean = userKeyHash.replace(/^0x/, '');
        return '0x' + clean;
    }

    async vaultExists(_userKeyHash: string): Promise<boolean> {
        return true;
    }

    async createVault(userKeyHash: string, signer: any): Promise<VaultCreationResult> {
        void signer;
        throw new Error(
            'Vault creation on Starknet must be done via the custom bridge from Hub. ' +
            `KeyHash=${userKeyHash}`
        );
    }

    async createVaultSponsored?(userKeyHash: string, sponsorPrivateKey: string, rpcUrl?: string): Promise<VaultCreationResult> {
        void userKeyHash;
        void sponsorPrivateKey;
        void rpcUrl;
        throw new Error('Vault creation on Starknet must be done via the custom bridge from Hub.');
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
}
