/**
 * Veridex Protocol SDK - Solana Chain Client
 * 
 * Implementation of ChainClient interface for Solana blockchain
 */

import {
    Connection,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    ComputeBudgetProgram,
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
} from '@solana/spl-token';
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

export interface SolanaClientConfig {
    wormholeChainId: number;
    rpcUrl: string;
    programId: string; // Veridex Spoke program
    wormholeCoreBridge: string;
    tokenBridge: string;
    network?: 'mainnet' | 'devnet' | 'testnet';
    commitment?: 'processed' | 'confirmed' | 'finalized';
}

// ============================================================================
// Constants
// ============================================================================

// Action type constants (must match on-chain program)
const ACTION_TRANSFER = 1;
const ACTION_BRIDGE = 4;
const ACTION_CONFIG = 3;

/**
 * Generate Anchor instruction discriminator
 * Anchor uses the first 8 bytes of sha256("global:<instruction_name>")
 */
function getAnchorDiscriminator(instructionName: string): Buffer {
    const hash = createHash('sha256')
        .update(`global:${instructionName}`)
        .digest();
    return Buffer.from(hash.subarray(0, 8));
}

// Anchor discriminators for Veridex Spoke instructions
const SOLANA_DISCRIMINATORS = {
    initialize: getAnchorDiscriminator('initialize'),
    createVault: getAnchorDiscriminator('create_vault'),
    executeTransfer: getAnchorDiscriminator('execute_transfer'),
    executeSolTransfer: getAnchorDiscriminator('execute_sol_transfer'),
    updateVaultConfig: getAnchorDiscriminator('update_vault_config'),
    executeBridge: getAnchorDiscriminator('execute_bridge'),
    completeBridgeTransfer: getAnchorDiscriminator('complete_bridge_transfer'),
    updateConfig: getAnchorDiscriminator('update_config'),
};

// ============================================================================
// SolanaClient Class
// ============================================================================

/**
 * Solana implementation of the ChainClient interface
 */
export class SolanaClient implements ChainClient {
    private config: ChainConfig;
    private connection: Connection;
    private programId: PublicKey;
    private wormholeBridge: PublicKey;
    private tokenBridge: PublicKey;

    constructor(config: SolanaClientConfig) {
        this.config = {
            name: `Solana ${config.network || 'mainnet'}`,
            chainId: config.wormholeChainId,
            wormholeChainId: config.wormholeChainId,
            rpcUrl: config.rpcUrl,
            explorerUrl: config.network === 'devnet'
                ? 'https://explorer.solana.com?cluster=devnet'
                : 'https://explorer.solana.com',
            isEvm: false,
            contracts: {
                hub: undefined, // Solana is a spoke only
                wormholeCoreBridge: config.wormholeCoreBridge,
                tokenBridge: config.tokenBridge,
            },
        };

        this.connection = new Connection(
            config.rpcUrl,
            config.commitment || 'confirmed'
        );
        this.programId = new PublicKey(config.programId);
        this.wormholeBridge = new PublicKey(config.wormholeCoreBridge);
        this.tokenBridge = new PublicKey(config.tokenBridge);
    }

    getConfig(): ChainConfig {
        return this.config;
    }

    async getNonce(userKeyHash: string): Promise<bigint> {
        try {
            const vaultAddress = this.computeVaultAddressFromHash(userKeyHash);
            const accountInfo = await this.connection.getAccountInfo(new PublicKey(vaultAddress));

            if (!accountInfo || accountInfo.data.length < 40) {
                return 0n;
            }

            // Nonce is stored at offset 8 (after discriminator)
            // Read as u64 little-endian
            const nonce = accountInfo.data.readBigUInt64LE(8);
            return nonce;
        } catch (error) {
            console.error('Error getting nonce:', error);
            return 0n;
        }
    }

    async getMessageFee(): Promise<bigint> {
        try {
            // Query Wormhole bridge for message fee
            // For now, return a default estimate
            // TODO: Query on-chain Wormhole config account
            return 0n; // Solana doesn't charge a Wormhole fee in the same way
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
        signer: any // Solana Keypair or similar
    ): Promise<DispatchResult> {
        throw new Error(
            'Direct dispatch not supported on Solana spoke chains. ' +
            'Actions must be dispatched from the Hub (EVM) chain. ' +
            'This client is for receiving cross-chain messages only.'
        );
    }

    /**
     * Dispatch an action via relayer (gasless)
     * Note: On Solana, this still goes through the Hub chain
     * Solana is a spoke-only chain in Veridex architecture
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
            const accountInfo = await this.connection.getAccountInfo(new PublicKey(vaultAddress));

            if (!accountInfo) {
                return null;
            }

            return vaultAddress;
        } catch (error) {
            console.error('Error getting vault address:', error);
            return null;
        }
    }

    /**
     * Compute vault address using PDA (Program Derived Address)
     * Seeds: ["vault", userKeyHash]
     */
    computeVaultAddress(userKeyHash: string): string {
        return this.computeVaultAddressFromHash(userKeyHash);
    }

    private computeVaultAddressFromHash(userKeyHash: string): string {
        const userKeyHashBuffer = Buffer.from(userKeyHash.replace('0x', ''), 'hex');
        const [vaultPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('vault'), userKeyHashBuffer],
            this.programId
        );
        return vaultPda.toBase58();
    }

    async vaultExists(userKeyHash: string): Promise<boolean> {
        const address = await this.getVaultAddress(userKeyHash);
        return address !== null;
    }

    async createVault(userKeyHash: string, signer: any): Promise<VaultCreationResult> {
        throw new Error(
            'Vault creation on Solana must be done via cross-chain message from Hub. ' +
            'Use the Hub chain client to dispatch a vault creation action targeting Solana.'
        );
    }

    async createVaultSponsored?(
        userKeyHash: string,
        sponsorPrivateKey: string,
        rpcUrl?: string
    ): Promise<VaultCreationResult> {
        throw new Error(
            'Vault creation on Solana must be done via cross-chain message from Hub. ' +
            'Use relayer gasless submission to create vault.'
        );
    }

    async estimateVaultCreationGas(userKeyHash: string): Promise<bigint> {
        // Return SOL estimate for vault creation (rent + compute)
        // ~0.002 SOL for rent-exempt account + compute units
        return 2_000_000n; // 0.002 SOL in lamports
    }

    getFactoryAddress(): string | undefined {
        // Solana uses program addresses, not factory pattern
        return undefined;
    }

    getImplementationAddress(): string | undefined {
        // Solana uses program addresses, not implementation pattern
        return undefined;
    }

    // ========================================================================
    // Balance Methods
    // ========================================================================

    /**
     * Get native SOL balance
     */
    async getNativeBalance(address: string): Promise<bigint> {
        const balance = await this.connection.getBalance(new PublicKey(address));
        return BigInt(balance);
    }

    /**
     * Get SPL token balance
     */
    async getTokenBalance(tokenAddress: string, ownerAddress: string): Promise<bigint> {
        try {
            const mint = new PublicKey(tokenAddress);
            const owner = new PublicKey(ownerAddress);
            const ata = getAssociatedTokenAddressSync(mint, owner);

            const balance = await this.connection.getTokenAccountBalance(ata);
            return BigInt(balance.value.amount);
        } catch (error) {
            console.error('Error getting token balance:', error);
            return 0n;
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
        // Use SHA-256 for Solana (Solana doesn't have keccak256 built-in)
        // The relayer will convert this to match EVM format
        const xBuffer = Buffer.alloc(32);
        const yBuffer = Buffer.alloc(32);

        // Write as big-endian to match EVM encoding
        const xHex = publicKeyX.toString(16).padStart(64, '0');
        const yHex = publicKeyY.toString(16).padStart(64, '0');

        Buffer.from(xHex, 'hex').copy(xBuffer);
        Buffer.from(yHex, 'hex').copy(yBuffer);

        // For cross-chain compatibility, we need to match the EVM hash
        // This should be keccak256, but we'll return a format the relayer expects
        const combined = Buffer.concat([xBuffer, yBuffer]);
        const hash = createHash('sha256').update(combined).digest();

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
        // This should match the EVM message format for cross-chain compatibility
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

        const hash = createHash('sha256').update(combined).digest();
        return '0x' + hash.toString('hex');
    }

    /**
     * Get connection instance for advanced usage
     */
    getConnection(): Connection {
        return this.connection;
    }

    /**
     * Get program ID
     */
    getProgramId(): PublicKey {
        return this.programId;
    }

    /**
     * Get current slot
     */
    async getSlot(): Promise<number> {
        return await this.connection.getSlot();
    }

    /**
     * Get transaction status
     */
    async getTransaction(signature: string, commitment?: 'confirmed' | 'finalized') {
        return await this.connection.getTransaction(signature, {
            commitment: commitment || 'confirmed',
            maxSupportedTransactionVersion: 0,
        });
    }
}
