/**
 * Veridex Protocol SDK - Main SDK Class
 */

import { PasskeyManager } from './PasskeyManager.js';
import { buildChallenge } from '../payload.js';
import type {
    VeridexConfig,
    ChainClient,
    PasskeyCredential,
    TransferParams,
    ExecuteParams,
    BridgeParams,
    DispatchResult,
    VaultInfo,
} from './types.js';

export class VeridexSDK {
    public readonly passkey: PasskeyManager;
    private readonly chain: ChainClient;
    private readonly relayerUrl?: string;

    constructor(config: VeridexConfig) {
        this.chain = config.chain;
        this.relayerUrl = config.relayerUrl;
        this.passkey = new PasskeyManager();
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

    async createVault(signer: any): Promise<string> {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new Error('No credential set');
        }

        return await this.chain.createVault(credential.keyHash, signer);
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
