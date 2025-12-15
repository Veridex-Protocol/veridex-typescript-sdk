/**
 * Veridex Protocol SDK - Sui Chain Client
 *
 * Implementation of ChainClient interface for Sui.
 *
 * Notes:
 * - Sui is a spoke chain in the Veridex architecture.
 * - Actions are dispatched from the Hub (EVM). This client focuses on
 *   address derivation and basic balance utilities.
 */

import { SuiClient as MystenSuiClient } from '@mysten/sui/client';
import { createHash } from 'crypto';
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

export interface SuiClientConfig {
    wormholeChainId: number;
    rpcUrl: string;
    packageId: string; // Veridex Spoke package ID
    wormholeCoreBridge: string;
    tokenBridge?: string;
    network?: 'mainnet' | 'testnet' | 'devnet';
}

// ============================================================================
// SuiClient
// ============================================================================

export class SuiClient implements ChainClient {
    private config: ChainConfig;
    private client: MystenSuiClient;
    private packageId: string;

    constructor(config: SuiClientConfig) {
        this.config = {
            name: `Sui ${config.network || 'mainnet'}`,
            chainId: 0,
            wormholeChainId: config.wormholeChainId,
            rpcUrl: config.rpcUrl,
            explorerUrl: config.network === 'testnet'
                ? 'https://suiscan.xyz/testnet'
                : config.network === 'devnet'
                    ? 'https://suiscan.xyz/devnet'
                    : 'https://suiscan.xyz/mainnet',
            isEvm: false,
            contracts: {
                hub: config.packageId,
                wormholeCoreBridge: config.wormholeCoreBridge,
                tokenBridge: config.tokenBridge,
            },
        };

        this.client = new MystenSuiClient({ url: config.rpcUrl });
        this.packageId = config.packageId;
    }

    getConfig(): ChainConfig {
        return this.config;
    }

    async getNonce(_userKeyHash: string): Promise<bigint> {
        // Nonce is managed on the Hub for cross-chain actions.
        return 0n;
    }

    async getMessageFee(): Promise<bigint> {
        // Wormhole fees for Sui are generally handled by relayer submission.
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
            'Direct dispatch not supported on Sui spoke chains. ' +
            'Actions must be dispatched from the Hub (EVM) chain. '
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
        // Sui vaults may be represented as shared objects on-chain; without registry object IDs,
        // we return the deterministic address used by the SDK for receiving and balance display.
        return this.computeVaultAddress(userKeyHash);
    }

    computeVaultAddress(userKeyHash: string): string {
        // SDK convention: Sui addresses are 32-byte hex with 0x prefix.
        const clean = userKeyHash.replace(/^0x/, '').padStart(64, '0');
        return '0x' + clean;
    }

    async vaultExists(_userKeyHash: string): Promise<boolean> {
        // Account addresses on Sui are implicit; treat as existing.
        return true;
    }

    async createVault(userKeyHash: string, signer: any): Promise<VaultCreationResult> {
        void signer;
        throw new Error(
            'Vault creation on Sui must be done via cross-chain message from Hub. ' +
            `Use the Hub client to dispatch a vault creation action targeting Sui (chain ${this.config.wormholeChainId}). KeyHash=${userKeyHash}`
        );
    }

    async createVaultSponsored?(userKeyHash: string, sponsorPrivateKey: string, rpcUrl?: string): Promise<VaultCreationResult> {
        void userKeyHash;
        void sponsorPrivateKey;
        void rpcUrl;
        throw new Error(
            'Vault creation on Sui must be done via cross-chain message from Hub. ' +
            'Use relayer gasless submission to create vault.'
        );
    }

    async estimateVaultCreationGas(_userKeyHash: string): Promise<bigint> {
        // Best-effort placeholder.
        return 5_000n;
    }

    getFactoryAddress(): string | undefined {
        return undefined;
    }

    getImplementationAddress(): string | undefined {
        return undefined;
    }

    // ========================================================================
    // Balance utilities (used by VeridexSDK multichain)
    // ========================================================================

    async getNativeBalance(address: string): Promise<bigint> {
        const balance = await this.client.getBalance({ owner: address });
        return BigInt(balance.totalBalance);
    }

    async getTokenBalance(coinType: string, ownerAddress: string): Promise<bigint> {
        const balance = await this.client.getBalance({ owner: ownerAddress, coinType });
        return BigInt(balance.totalBalance);
    }

    getClient(): MystenSuiClient {
        return this.client;
    }

    getPackageId(): string {
        return this.packageId;
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
