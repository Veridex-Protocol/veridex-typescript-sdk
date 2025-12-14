/**
 * Veridex Protocol SDK - Aptos Chain Client
 * 
 * Implementation of ChainClient interface for Aptos blockchain
 */

import { AptosClient as AptosSDK, AptosAccount, Types } from 'aptos';
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

export interface AptosClientConfig {
    wormholeChainId: number;
    rpcUrl: string;
    moduleAddress: string; // Veridex Spoke module address
    wormholeCoreBridge: string;
    tokenBridge: string;
    network?: 'mainnet' | 'testnet' | 'devnet';
}

// ============================================================================
// Constants
// ============================================================================

// Action type constants (must match on-chain module)
const ACTION_TRANSFER = 1;
const ACTION_BRIDGE = 4;
const ACTION_CONFIG = 3;

// ============================================================================
// AptosClient Class
// ============================================================================

/**
 * Aptos implementation of the ChainClient interface
 */
export class AptosClient implements ChainClient {
    private config: ChainConfig;
    private client: AptosSDK;
    private moduleAddress: string;
    private wormholeBridge: string;
    private tokenBridge: string;

    constructor(config: AptosClientConfig) {
        this.config = {
            name: `Aptos ${config.network || 'mainnet'}`,
            chainId: config.wormholeChainId,
            wormholeChainId: config.wormholeChainId,
            rpcUrl: config.rpcUrl,
            explorerUrl: config.network === 'testnet'
                ? 'https://explorer.aptoslabs.com?network=testnet'
                : 'https://explorer.aptoslabs.com',
            isEvm: false,
            contracts: {
                hub: undefined, // Aptos is a spoke only
                wormholeCoreBridge: config.wormholeCoreBridge,
                tokenBridge: config.tokenBridge,
            },
        };

        this.client = new AptosSDK(config.rpcUrl);
        this.moduleAddress = config.moduleAddress;
        this.wormholeBridge = config.wormholeCoreBridge;
        this.tokenBridge = config.tokenBridge;
    }

    getConfig(): ChainConfig {
        return this.config;
    }

    async getNonce(userKeyHash: string): Promise<bigint> {
        try {
            const vaultAddress = this.computeVaultAddressFromHash(userKeyHash);

            // Query vault resource
            const resource = await this.client.getAccountResource(
                vaultAddress,
                `${this.moduleAddress}::vault::Vault`
            );

            if (resource && resource.data) {
                const data = resource.data as any;
                return BigInt(data.nonce || 0);
            }

            return 0n;
        } catch (error) {
            console.error('Error getting nonce:', error);
            return 0n;
        }
    }

    async getMessageFee(): Promise<bigint> {
        try {
            // Query Wormhole bridge for message fee
            // For now, return a default estimate
            // TODO: Query on-chain Wormhole config
            return 0n; // Aptos doesn't charge a Wormhole fee in the same way
        } catch (error) {
            console.error('Error getting message fee:', error);
            return 0n;
        }
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
        signer: any // Aptos AptosAccount
    ): Promise<DispatchResult> {
        throw new Error(
            'Direct dispatch not supported on Aptos spoke chains. ' +
            'Actions must be dispatched from the Hub (EVM) chain. ' +
            'This client is for receiving cross-chain messages only.'
        );
    }

    /**
     * Dispatch an action via relayer (gasless)
     * Note: On Aptos, this still goes through the Hub chain
     * Aptos is a spoke-only chain in Veridex architecture
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
        // Compute key hash
        const keyHash = this.computeKeyHash(publicKeyX, publicKeyY);

        // Build the message that was signed (matches Hub chain format)
        const message = this.buildMessage(keyHash, targetChain, actionPayload, nonce);

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
            const vaultAddress = this.computeVaultAddressFromHash(userKeyHash);

            // Check if account exists
            const account = await this.client.getAccount(vaultAddress);

            if (account) {
                return vaultAddress;
            }

            return null;
        } catch (error) {
            if ((error as any)?.status === 404) {
                return null; // Account doesn't exist
            }
            console.error('Error getting vault address:', error);
            return null;
        }
    }

    /**
     * Compute vault address using resource account derivation
     * On Aptos, vaults are derived from the module address + user key hash
     */
    computeVaultAddress(userKeyHash: string): string {
        return this.computeVaultAddressFromHash(userKeyHash);
    }

    private computeVaultAddressFromHash(userKeyHash: string): string {
        // Resource account address derivation on Aptos:
        // address = sha3_256(source_address || seed || AUTH_KEY_DERIVATION_SCHEME)

        const sourceAddress = Buffer.from(this.moduleAddress.replace('0x', ''), 'hex');
        const seed = Buffer.from(userKeyHash.replace('0x', ''), 'hex');
        const scheme = Buffer.from([0xFE]); // Resource account scheme

        const combined = Buffer.concat([sourceAddress, seed, scheme]);
        const hash = createHash('sha3-256').update(combined).digest();

        return '0x' + hash.toString('hex');
    }

    async vaultExists(userKeyHash: string): Promise<boolean> {
        const address = await this.getVaultAddress(userKeyHash);
        return address !== null;
    }

    async createVault(userKeyHash: string, signer: any): Promise<VaultCreationResult> {
        throw new Error(
            'Vault creation on Aptos must be done via cross-chain message from Hub. ' +
            'Use the Hub chain client to dispatch a vault creation action targeting Aptos.'
        );
    }

    async createVaultSponsored?(
        userKeyHash: string,
        sponsorPrivateKey: string,
        rpcUrl?: string
    ): Promise<VaultCreationResult> {
        throw new Error(
            'Vault creation on Aptos must be done via cross-chain message from Hub. ' +
            'Use relayer gasless submission to create vault.'
        );
    }

    async estimateVaultCreationGas(userKeyHash: string): Promise<bigint> {
        // Return APT estimate for vault creation
        // ~0.001 APT for account creation + gas
        return 100_000n; // 0.001 APT in octas (1 APT = 100M octas)
    }

    getFactoryAddress(): string | undefined {
        // Aptos uses module addresses, not factory pattern
        return undefined;
    }

    getImplementationAddress(): string | undefined {
        // Aptos uses module addresses, not implementation pattern
        return undefined;
    }

    // ========================================================================
    // Balance Methods
    // ========================================================================

    /**
     * Get native APT balance
     */
    async getNativeBalance(address: string): Promise<bigint> {
        try {
            const resource = await this.client.getAccountResource(
                address,
                '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
            );

            if (resource && resource.data) {
                const data = resource.data as any;
                return BigInt(data.coin?.value || 0);
            }

            return 0n;
        } catch (error) {
            console.error('Error getting native balance:', error);
            return 0n;
        }
    }

    /**
     * Get fungible asset (FA) or coin balance
     */
    async getTokenBalance(tokenAddress: string, ownerAddress: string): Promise<bigint> {
        try {
            // Try as Coin type first
            const coinType = tokenAddress.includes('::')
                ? tokenAddress
                : `${tokenAddress}::coin::Coin`;

            const resource = await this.client.getAccountResource(
                ownerAddress,
                `0x1::coin::CoinStore<${coinType}>`
            );

            if (resource && resource.data) {
                const data = resource.data as any;
                return BigInt(data.coin?.value || 0);
            }

            return 0n;
        } catch (error) {
            // If Coin query fails, try Fungible Asset (FA) format
            try {
                // FA balances are stored differently
                // Would need to query the FA resource
                console.warn('FA balance query not fully implemented yet');
                return 0n;
            } catch (faError) {
                console.error('Error getting token balance:', error);
                return 0n;
            }
        }
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Compute key hash from public key coordinates
     * Matches EVM keccak256(abi.encode(publicKeyX, publicKeyY))
     */
    private computeKeyHash(publicKeyX: bigint, publicKeyY: bigint): string {
        const xBuffer = Buffer.alloc(32);
        const yBuffer = Buffer.alloc(32);

        // Write as big-endian to match EVM encoding
        const xHex = publicKeyX.toString(16).padStart(64, '0');
        const yHex = publicKeyY.toString(16).padStart(64, '0');

        Buffer.from(xHex, 'hex').copy(xBuffer);
        Buffer.from(yHex, 'hex').copy(yBuffer);

        // Use SHA3-256 for Aptos (which is what Aptos uses natively)
        // For cross-chain compatibility, this should match the EVM hash
        const combined = Buffer.concat([xBuffer, yBuffer]);
        const hash = createHash('sha3-256').update(combined).digest();

        return '0x' + hash.toString('hex');
    }

    /**
     * Build message for signing (matches Hub chain format)
     */
    private buildMessage(
        keyHash: string,
        targetChain: number,
        actionPayload: string,
        nonce: bigint
    ): string {
        const keyHashBuffer = Buffer.from(keyHash.replace('0x', ''), 'hex');
        const targetChainBuffer = Buffer.alloc(2);
        targetChainBuffer.writeUInt16BE(targetChain);
        const payloadBuffer = Buffer.from(actionPayload.replace('0x', ''), 'hex');
        const nonceBuffer = Buffer.alloc(32);
        const nonceHex = nonce.toString(16).padStart(64, '0');
        Buffer.from(nonceHex, 'hex').copy(nonceBuffer);

        const combined = Buffer.concat([
            keyHashBuffer,
            targetChainBuffer,
            payloadBuffer,
            nonceBuffer,
        ]);

        const hash = createHash('sha3-256').update(combined).digest();
        return '0x' + hash.toString('hex');
    }

    /**
     * Get Aptos client instance for advanced usage
     */
    getClient(): AptosSDK {
        return this.client;
    }

    /**
     * Get module address
     */
    getModuleAddress(): string {
        return this.moduleAddress;
    }

    /**
     * Get current ledger version
     */
    async getLedgerVersion(): Promise<bigint> {
        const ledgerInfo = await this.client.getLedgerInfo();
        return BigInt(ledgerInfo.ledger_version);
    }

    /**
     * Get transaction by hash
     */
    async getTransaction(txHash: string): Promise<Types.Transaction> {
        return await this.client.getTransactionByHash(txHash);
    }

    /**
     * Wait for transaction confirmation
     */
    async waitForTransaction(txHash: string, timeoutSecs: number = 30): Promise<Types.Transaction> {
        return await this.client.waitForTransactionWithResult(txHash, {
            timeoutSecs,
            checkSuccess: true,
        });
    }
}
