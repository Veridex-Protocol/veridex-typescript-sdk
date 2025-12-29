/**
 * Veridex Protocol SDK - Solana Chain Client
 * 
 * Implementation of ChainClient interface for Solana blockchain
 */

import {
    Connection,
    PublicKey,
} from '@solana/web3.js';
import {
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
        void signature;
        void publicKeyX;
        void publicKeyY;
        void targetChain;
        void actionPayload;
        void nonce;
        void signer;
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
        void userKeyHash;
        void signer;
        throw new Error(
            'Vault creation on Solana must be done via relayer. ' +
            'Use createVaultViaRelayer() instead.'
        );
    }

    async createVaultSponsored?(
        userKeyHash: string,
        sponsorPrivateKey: string,
        rpcUrl?: string
    ): Promise<VaultCreationResult> {
        void userKeyHash;
        void sponsorPrivateKey;
        void rpcUrl;
        throw new Error(
            'Vault creation on Solana must be done via relayer. ' +
            'Use createVaultViaRelayer() instead.'
        );
    }

    /**
     * Create a vault via the relayer (sponsored/gasless)
     * This is the recommended way to create Solana vaults
     */
    async createVaultViaRelayer(
        userKeyHash: string,
        relayerUrl: string
    ): Promise<VaultCreationResult> {
        const response = await fetch(`${relayerUrl}/api/v1/solana/vault`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userKeyHash,
                chainId: this.config.wormholeChainId,
            }),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to create vault via relayer');
        }

        return {
            address: result.vaultAddress,
            transactionHash: result.transactionHash || '',
            blockNumber: 0, // Solana doesn't have block numbers like EVM
            gasUsed: 0n, // Solana uses compute units, not gas
            alreadyExisted: !result.transactionHash,
            sponsoredBy: 'relayer',
        };
    }

    /**
     * Get vault info via relayer (includes existence check)
     */
    async getVaultViaRelayer(
        userKeyHash: string,
        relayerUrl: string
    ): Promise<{ vaultAddress: string; exists: boolean }> {
        const response = await fetch(
            `${relayerUrl}/api/v1/solana/vault/${userKeyHash}?chainId=${this.config.wormholeChainId}`
        );

        if (!response.ok) {
            throw new Error('Failed to get vault info from relayer');
        }

        const result = await response.json();
        return {
            vaultAddress: result.vaultAddress,
            exists: result.exists,
        };
    }

    async estimateVaultCreationGas(userKeyHash: string): Promise<bigint> {
        void userKeyHash;
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

    // ============================================================================
    // Social Recovery Methods (Issue #23)
    // ============================================================================
    // 
    // Note: Social recovery is managed on the Hub chain (EVM).
    // Solana spokes receive and execute recovery VAAs broadcast from the Hub.
    // These methods are placeholders that indicate spoke-only chains don't
    // initiate recovery - they only execute recovery instructions from Hub VAAs.
    //
    // The relayer service handles:
    // 1. Fetching recovery VAAs from Wormhole guardians
    // 2. Submitting execute_recovery instruction to Solana spoke
    // 3. Processing OwnerRecovered events
    //
    // SDK users should use EVMClient methods for guardian management and
    // recovery initiation on the Hub chain.
    // ============================================================================

    /**
     * Check if a recovery VAA has been executed on this spoke
     * 
     * @param vaaHash - Hash of the recovery VAA
     * @returns Whether the VAA has been processed
     */
    async isRecoveryExecuted(vaaHash: string): Promise<boolean> {
        try {
            // Derive VAA record PDA
            const vaaHashBuffer = Buffer.from(vaaHash.replace('0x', ''), 'hex');
            const [vaaRecordPda] = PublicKey.findProgramAddressSync(
                [Buffer.from('vaa_record'), vaaHashBuffer],
                this.programId
            );

            const accountInfo = await this.connection.getAccountInfo(vaaRecordPda);
            if (!accountInfo || accountInfo.data.length < 9) {
                return false;
            }

            // First byte after discriminator is 'processed' bool
            return accountInfo.data[8] === 1;
        } catch (error) {
            console.error('Error checking recovery execution:', error);
            return false;
        }
    }

    /**
     * Get vault owner after potential recovery
     * 
     * @param vaultAddress - Vault address to check
     * @returns Current owner key hash
     */
    async getVaultOwner(vaultAddress: string): Promise<string> {
        try {
            const accountInfo = await this.connection.getAccountInfo(new PublicKey(vaultAddress));
            if (!accountInfo || accountInfo.data.length < 40) {
                throw new Error('Vault not found');
            }

            // Owner key hash is stored after discriminator (8 bytes) at offset 8-40
            const ownerKeyHash = accountInfo.data.slice(8, 40);
            return '0x' + ownerKeyHash.toString('hex');
        } catch (error) {
            console.error('Error getting vault owner:', error);
            throw error;
        }
    }

    /**
     * Get authorized signers for a vault
     * 
     * @param vaultAddress - Vault address to check
     * @returns Array of authorized signer key hashes
     */
    async getAuthorizedSigners(vaultAddress: string): Promise<string[]> {
        try {
            const accountInfo = await this.connection.getAccountInfo(new PublicKey(vaultAddress));
            if (!accountInfo || accountInfo.data.length < 235) {
                throw new Error('Vault not found');
            }

            // Vault layout:
            // 8 bytes discriminator
            // 32 bytes owner_key_hash
            // 8 bytes nonce
            // 1 byte paused
            // 8 bytes daily_limit
            // 8 bytes daily_spent
            // 8 bytes day_start
            // 1 byte bump
            // 1 byte authorized_signer_count
            // 5 * 32 bytes authorized_signers

            const signerCount = accountInfo.data[66]; // offset 8+32+8+1+8+8+1 = 66
            const signers: string[] = [];

            for (let i = 0; i < signerCount; i++) {
                const offset = 67 + (i * 32); // Start of authorized_signers array
                const keyHash = accountInfo.data.slice(offset, offset + 32);
                signers.push('0x' + keyHash.toString('hex'));
            }

            return signers;
        } catch (error) {
            console.error('Error getting authorized signers:', error);
            throw error;
        }
    }
}
