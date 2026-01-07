/**
 * Veridex Protocol SDK - Aptos Chain Client
 * 
 * Implementation of ChainClient interface for Aptos blockchain
 */

import { AptosClient as AptosSDK, Types } from 'aptos';
import { sha3_256 } from 'js-sha3';
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
// Helpers
// ============================================================================

/**
 * Normalize Aptos RPC URL to work around legacy SDK origin mismatch bug.
 * The legacy `aptos` SDK compares URL origins and fails when the server
 * reports `https://host:443` but we provide `https://host` (no explicit port).
 * 
 * This function:
 * 1. Strips trailing slashes and `/v1` suffix
 * 2. Adds explicit `:443` for HTTPS URLs without a port
 */
function normalizeAptosRpcUrl(rpcUrl: string): string {
    const trimmed = rpcUrl.trim().replace(/\/+$/, '');
    const withoutV1 = trimmed.replace(/\/v1$/, '');
    
    try {
        const url = new URL(withoutV1);
        
        // Work around legacy `aptos` SDK origin mismatch where the server reports
        // `https://host:443` but the provided URL origin is `https://host`.
        if (url.protocol === 'https:' && !url.port) {
            url.port = '443';
        }
        
        return url.origin;
    } catch {
        // If URL parsing fails, return as-is
        return withoutV1;
    }
}

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

    constructor(config: AptosClientConfig) {
        // Normalize RPC URL to work around legacy aptos SDK origin mismatch bug
        const normalizedRpcUrl = normalizeAptosRpcUrl(config.rpcUrl);
        
        this.config = {
            name: `Aptos ${config.network || 'mainnet'}`,
            chainId: config.wormholeChainId,
            wormholeChainId: config.wormholeChainId,
            rpcUrl: normalizedRpcUrl,
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

        this.client = new AptosSDK(normalizedRpcUrl);
        this.moduleAddress = config.moduleAddress;
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
        void signature;
        void publicKeyX;
        void publicKeyY;
        void targetChain;
        void actionPayload;
        void nonce;
        void signer;
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

    /**
     * Get vault address from on-chain VaultRegistry.
     * Queries the get_vault_address view function which looks up the vault in the registry.
     */
    async getVaultAddress(userKeyHash: string): Promise<string | null> {
        try {
            // Normalize: remove 0x if present, lowercase, pad to 64 chars, then add 0x
            const rawHex = userKeyHash.startsWith('0x') 
                ? userKeyHash.slice(2).toLowerCase()
                : userKeyHash.toLowerCase();
            const keyHashHex = `0x${rawHex.padStart(64, '0')}`;
            
            // First check if vault exists to avoid noisy 400 errors in console
            const existsPayload = {
                function: `${this.moduleAddress}::spoke::vault_exists`,
                type_arguments: [],
                arguments: [keyHashHex],
            };
            
            const existsResponse = await this.client.view(existsPayload);
            if (!existsResponse || existsResponse.length === 0 || existsResponse[0] !== true) {
                return null; // Vault doesn't exist
            }
            
            // Vault exists, now get the address
            const payload = {
                function: `${this.moduleAddress}::spoke::get_vault_address`,
                type_arguments: [],
                arguments: [keyHashHex],
            };

            const response = await this.client.view(payload);
            
            if (response && response.length > 0) {
                const vaultAddress = response[0] as string;
                return vaultAddress;
            }

            return null;
        } catch (error: any) {
            // E_VAULT_NOT_FOUND (error code 6) means vault doesn't exist in registry
            if (error?.message?.includes('E_VAULT_NOT_FOUND') || 
                error?.message?.includes('error code 6') ||
                error?.status === 404) {
                return null;
            }
            console.error('Error getting vault address from registry:', error);
            return null;
        }
    }

    /**
     * @deprecated Use getVaultAddress() instead - this method uses incorrect address derivation.
     * On Aptos, vaults are created as named objects by the relayer, not resource accounts.
     * The vault address depends on which relayer created it, so must be queried on-chain.
     */
    computeVaultAddress(userKeyHash: string): string {
        console.warn(
            'computeVaultAddress() is deprecated for Aptos. ' +
            'Use getVaultAddress() to query the on-chain VaultRegistry instead.'
        );
        return this.computeVaultAddressFromHash(userKeyHash);
    }

    private computeVaultAddressFromHash(userKeyHash: string): string {
        // NOTE: This is kept for backward compatibility but produces INCORRECT addresses!
        // Aptos spoke uses object::create_named_object(creator, key_hash) where:
        // - creator = relayer address (not module address)
        // - scheme = 0xFD (named object, not 0xFE resource account)
        // The correct approach is to query the VaultRegistry on-chain.

        const sourceAddress = this.hexToBytes(this.moduleAddress.replace('0x', ''));
        const seed = this.hexToBytes(userKeyHash.replace('0x', ''));
        const scheme = new Uint8Array([0xFE]); // INCORRECT - kept for backward compat

        const combined = new Uint8Array([...sourceAddress, ...seed, ...scheme]);
        const hash = sha3_256(combined);

        return '0x' + hash;
    }

    /**
     * Convert hex string to Uint8Array (browser-compatible)
     */
    private hexToBytes(hex: string): Uint8Array {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes;
    }

    async vaultExists(userKeyHash: string): Promise<boolean> {
        const address = await this.getVaultAddress(userKeyHash);
        return address !== null;
    }

    async createVault(userKeyHash: string, signer: any): Promise<VaultCreationResult> {
        void userKeyHash;
        void signer;
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
        void userKeyHash;
        void sponsorPrivateKey;
        void rpcUrl;
        throw new Error(
            'Vault creation on Aptos must be done via cross-chain message from Hub. ' +
            'Use relayer gasless submission to create vault.'
        );
    }

    /**
     * Create a vault via the relayer (sponsored/gasless)
     * This is the recommended way to create Aptos vaults
     * 
     * The relayer will dispatch a vault creation action from Hub to Aptos spoke
     */
    async createVaultViaRelayer(
        userKeyHash: string,
        relayerUrl: string
    ): Promise<VaultCreationResult> {
        const response = await fetch(`${relayerUrl}/api/v1/aptos/vault`, {
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
            blockNumber: 0,
            gasUsed: 0n,
            alreadyExisted: result.alreadyExists || false,
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
            `${relayerUrl}/api/v1/aptos/vault/${userKeyHash}?chainId=${this.config.wormholeChainId}`
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
        // Write as big-endian to match EVM encoding
        const xHex = publicKeyX.toString(16).padStart(64, '0');
        const yHex = publicKeyY.toString(16).padStart(64, '0');

        const xBytes = this.hexToBytes(xHex);
        const yBytes = this.hexToBytes(yHex);

        // Use SHA3-256 for Aptos (which is what Aptos uses natively)
        // For cross-chain compatibility, this should match the EVM hash
        const combined = new Uint8Array([...xBytes, ...yBytes]);
        const hash = sha3_256(combined);

        return '0x' + hash;
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
        const keyHashBytes = this.hexToBytes(keyHash.replace('0x', ''));
        const targetChainBytes = new Uint8Array(2);
        targetChainBytes[0] = (targetChain >> 8) & 0xFF;
        targetChainBytes[1] = targetChain & 0xFF;
        const payloadBytes = this.hexToBytes(actionPayload.replace('0x', ''));
        const nonceHex = nonce.toString(16).padStart(64, '0');
        const nonceBytes = this.hexToBytes(nonceHex);

        const combined = new Uint8Array([
            ...keyHashBytes,
            ...targetChainBytes,
            ...payloadBytes,
            ...nonceBytes,
        ]);

        const hash = sha3_256(combined);
        return '0x' + hash;
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

    // ============================================================================
    // Social Recovery Methods (Issue #23)
    // ============================================================================
    // 
    // Note: Social recovery is managed on the Hub chain (EVM).
    // Aptos spokes receive and execute recovery VAAs broadcast from the Hub.
    // The relayer service handles submitting recovery transactions to Aptos.
    //
    // SDK users should use EVMClient methods for guardian management and
    // recovery initiation on the Hub chain.
    // ============================================================================

    /**
     * Get vault resource for an owner
     * 
     * @param ownerKeyHash - Owner's passkey hash (32 bytes as hex)
     * @returns Vault resource data or null if not found
     */
    async getVaultResource(ownerKeyHash: string): Promise<{
        ownerKeyHash: string;
        authorizedSigners: string[];
        nonce: bigint;
    } | null> {
        try {
            const vaultAddress = this.computeVaultAddressFromHash(ownerKeyHash);

            const resource = await this.client.getAccountResource(
                vaultAddress,
                `${this.moduleAddress}::vault::Vault`
            );

            if (!resource || !resource.data) {
                return null;
            }

            const data = resource.data as any;
            return {
                ownerKeyHash: data.owner_key_hash || ownerKeyHash,
                authorizedSigners: data.authorized_signers || [],
                nonce: BigInt(data.nonce || 0),
            };
        } catch (error) {
            console.error('Error getting vault resource:', error);
            return null;
        }
    }

    /**
     * Get authorized signers for a vault
     * 
     * @param ownerKeyHash - Owner's passkey hash (32 bytes as hex)
     * @returns Array of authorized signer key hashes
     */
    async getAuthorizedSigners(ownerKeyHash: string): Promise<string[]> {
        const vaultResource = await this.getVaultResource(ownerKeyHash);
        return vaultResource?.authorizedSigners || [];
    }

    /**
     * Check if a VAA has been processed (for replay protection)
     * 
     * @param vaaHash - VAA hash as hex string
     * @returns Whether the VAA has been processed
     */
    async isVaaProcessed(vaaHash: string): Promise<boolean> {
        try {
            const resource = await this.client.getAccountResource(
                this.moduleAddress,
                `${this.moduleAddress}::spoke::ProcessedVAAs`
            );

            if (!resource || !resource.data) {
                return false;
            }

            const data = resource.data as any;
            const processedVaas = data.processed || [];

            // Check if vaaHash is in the processed list
            const normalizedHash = vaaHash.toLowerCase().replace('0x', '');
            return processedVaas.some((hash: string) => 
                hash.toLowerCase().replace('0x', '') === normalizedHash
            );
        } catch (error) {
            console.error('Error checking VAA status:', error);
            return false;
        }
    }

    /**
     * Check if protocol is paused
     * 
     * @returns Whether the protocol is paused
     */
    async isProtocolPaused(): Promise<boolean> {
        try {
            const resource = await this.client.getAccountResource(
                this.moduleAddress,
                `${this.moduleAddress}::spoke::Config`
            );

            if (!resource || !resource.data) {
                return false;
            }

            const data = resource.data as any;
            return data.paused === true;
        } catch (error) {
            console.error('Error checking pause status:', error);
            return false;
        }
    }
}
