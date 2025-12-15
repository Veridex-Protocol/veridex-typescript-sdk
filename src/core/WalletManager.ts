/**
 * Veridex Protocol SDK - Wallet Manager
 * 
 * Manages deterministic wallet addresses across multiple chains.
 * Vault addresses are computed using CREATE2 on EVM chains and chain-specific
 * derivation on non-EVM chains, all based on the user's passkey public key.
 */

import { ethers } from 'ethers';
import type { 
    PasskeyCredential,
    UnifiedIdentity,
    ChainAddress,
    WalletManagerConfig,
} from './types.js';
import { computeKeyHash } from '../utils.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * EIP-1167 minimal proxy bytecode prefix (before implementation address)
 * 3d602d80600a3d3981f3363d3d373d3d3d363d73
 */
const PROXY_BYTECODE_PREFIX = '0x3d602d80600a3d3981f3363d3d373d3d3d363d73';

/**
 * EIP-1167 minimal proxy bytecode suffix (after implementation address)
 * 5af43d82803e903d91602b57fd5bf3
 */
const PROXY_BYTECODE_SUFFIX = '5af43d82803e903d91602b57fd5bf3';

// ============================================================================
// WalletManager Class
// ============================================================================

/**
 * Manages wallet address derivation and storage for Veridex Protocol
 * 
 * @example
 * ```typescript
 * const manager = new WalletManager();
 * 
 * // Compute vault address for a credential
 * const address = await manager.computeVaultAddress(
 *   credential.keyHash,
 *   factoryAddress,
 *   implementationAddress
 * );
 * 
 * // Get unified identity with addresses on all chains
 * const identity = await manager.getUnifiedIdentity(credential, chainConfigs);
 * ```
 */
export class WalletManager {
    private config: WalletManagerConfig;
    private addressCache: Map<string, ChainAddress[]> = new Map();

    constructor(config: WalletManagerConfig = {}) {
        this.config = {
            cacheAddresses: config.cacheAddresses ?? true,
            persistToStorage: config.persistToStorage ?? false,
            storageKey: config.storageKey ?? 'veridex_wallet_addresses',
        };

        // Load cached addresses from storage if enabled
        if (this.config.persistToStorage && typeof window !== 'undefined') {
            this.loadFromStorage();
        }
    }

    // ========================================================================
    // Address Computation
    // ========================================================================

    /**
     * Compute the deterministic vault address for an EVM chain
     * 
     * Uses CREATE2 with EIP-1167 minimal proxy pattern:
     * - Salt = keccak256(factoryAddress, ownerKeyHash)
     * - InitCode = EIP-1167 proxy bytecode with implementation address
     * 
     * @param keyHash - The owner's key hash (keccak256 of public key coordinates)
     * @param factoryAddress - The vault factory contract address
     * @param implementationAddress - The vault implementation contract address
     * @returns The deterministic vault address
     */
    computeVaultAddress(
        keyHash: string,
        factoryAddress: string,
        implementationAddress: string
    ): string {
        // Compute salt: keccak256(abi.encodePacked(factory, keyHash))
        const salt = ethers.keccak256(
            ethers.solidityPacked(
                ['address', 'bytes32'],
                [factoryAddress, keyHash]
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
     * Compute vault address from public key coordinates
     * 
     * @param publicKeyX - P-256 public key X coordinate
     * @param publicKeyY - P-256 public key Y coordinate
     * @param factoryAddress - The vault factory contract address
     * @param implementationAddress - The vault implementation contract address
     * @returns The deterministic vault address
     */
    computeVaultAddressFromPublicKey(
        publicKeyX: bigint,
        publicKeyY: bigint,
        factoryAddress: string,
        implementationAddress: string
    ): string {
        const keyHash = computeKeyHash(publicKeyX, publicKeyY);
        return this.computeVaultAddress(keyHash, factoryAddress, implementationAddress);
    }

    /**
     * Build EIP-1167 minimal proxy initcode
     */
    private buildProxyInitCode(implementationAddress: string): string {
        // Remove 0x prefix if present and lowercase
        const impl = implementationAddress.toLowerCase().replace('0x', '');
        
        // EIP-1167 bytecode format
        return PROXY_BYTECODE_PREFIX + impl + PROXY_BYTECODE_SUFFIX;
    }

    // ========================================================================
    // Unified Identity
    // ========================================================================

    /**
     * Get unified identity with addresses across all configured chains
     * 
     * @param credential - The passkey credential
     * @param chainConfigs - Map of chain configurations with factory/implementation addresses
     * @returns Unified identity with addresses on each chain
     */
    async getUnifiedIdentity(
        credential: PasskeyCredential,
        chainConfigs: Map<number, ChainAddressConfig>
    ): Promise<UnifiedIdentity> {
        const addresses: ChainAddress[] = [];

        for (const [wormholeChainId, config] of chainConfigs) {
            const address = await this.deriveAddressForChain(
                credential,
                wormholeChainId,
                config
            );
            
            if (address) {
                addresses.push(address);
            }
        }

        const identity: UnifiedIdentity = {
            keyHash: credential.keyHash,
            publicKeyX: credential.publicKeyX,
            publicKeyY: credential.publicKeyY,
            credentialId: credential.credentialId,
            addresses,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        // Cache the identity
        if (this.config.cacheAddresses) {
            this.addressCache.set(credential.keyHash, addresses);
        }

        // Persist to storage if enabled
        if (this.config.persistToStorage) {
            this.saveToStorage(identity);
        }

        return identity;
    }

    /**
     * Derive address for a specific chain
     */
    private async deriveAddressForChain(
        credential: PasskeyCredential,
        wormholeChainId: number,
        config: ChainAddressConfig
    ): Promise<ChainAddress | null> {
        if (config.isEvm) {
            // EVM chains use CREATE2
            if (!config.factoryAddress || !config.implementationAddress) {
                return null;
            }

            const address = this.computeVaultAddress(
                credential.keyHash,
                config.factoryAddress,
                config.implementationAddress
            );

            return {
                wormholeChainId,
                chainName: config.chainName,
                address,
                isEvm: true,
                deployed: false, // Will be checked separately
            };
        } else {
            // Non-EVM chains have chain-specific address derivation
            return this.deriveNonEvmAddress(credential, wormholeChainId, config);
        }
    }

    /**
     * Derive address for non-EVM chains
     * 
     * Each chain has its own address format:
     * - Solana: Base58 encoded public key hash
     * - Aptos: 32-byte hex address
     * - Sui: 32-byte hex address with 0x prefix
     */
    private deriveNonEvmAddress(
        credential: PasskeyCredential,
        wormholeChainId: number,
        _config: ChainAddressConfig
    ): ChainAddress | null {
        switch (wormholeChainId) {
            case 1: // Solana
                // Solana uses the key hash directly as a seed for PDA derivation
                // The actual address depends on the program ID
                return {
                    wormholeChainId: 1,
                    chainName: 'Solana',
                    address: credential.keyHash, // PDA will be derived from this
                    isEvm: false,
                    derivationType: 'pda',
                    deployed: false,
                };

            case 22: // Aptos
                // Aptos uses the key hash as the resource account address
                return {
                    wormholeChainId: 22,
                    chainName: 'Aptos',
                    address: credential.keyHash,
                    isEvm: false,
                    derivationType: 'resource_account',
                    deployed: false,
                };

            case 21: // Sui
                // Sui uses the key hash with 0x prefix
                return {
                    wormholeChainId: 21,
                    chainName: 'Sui',
                    address: credential.keyHash,
                    isEvm: false,
                    derivationType: 'object',
                    deployed: false,
                };

            default:
                // Unknown chain
                return null;
        }
    }

    // ========================================================================
    // Address Lookup
    // ========================================================================

    /**
     * Get cached address for a chain
     */
    getAddressForChain(keyHash: string, wormholeChainId: number): ChainAddress | undefined {
        const addresses = this.addressCache.get(keyHash);
        return addresses?.find(a => a.wormholeChainId === wormholeChainId);
    }

    /**
     * Get all cached addresses for a key hash
     */
    getAddresses(keyHash: string): ChainAddress[] {
        return this.addressCache.get(keyHash) ?? [];
    }

    /**
     * Update deployment status for an address
     */
    updateDeploymentStatus(
        keyHash: string,
        wormholeChainId: number,
        deployed: boolean,
        deploymentTxHash?: string
    ): void {
        const addresses = this.addressCache.get(keyHash);
        if (!addresses) return;

        const address = addresses.find(a => a.wormholeChainId === wormholeChainId);
        if (address) {
            address.deployed = deployed;
            address.deploymentTxHash = deploymentTxHash;
        }

        // Persist update if enabled
        if (this.config.persistToStorage) {
            this.saveAddressesToStorage(keyHash, addresses);
        }
    }

    // ========================================================================
    // Storage
    // ========================================================================

    /**
     * Load addresses from localStorage
     */
    private loadFromStorage(): void {
        if (typeof window === 'undefined') return;

        try {
            const stored = localStorage.getItem(this.config.storageKey!);
            if (!stored) return;

            const data = JSON.parse(stored) as StoredWalletData;
            
            for (const [keyHash, addresses] of Object.entries(data.addresses)) {
                this.addressCache.set(keyHash, addresses);
            }
        } catch (error) {
            console.warn('Failed to load wallet addresses from storage:', error);
        }
    }

    /**
     * Save identity to localStorage
     */
    private saveToStorage(identity: UnifiedIdentity): void {
        if (typeof window === 'undefined') return;

        try {
            const stored = localStorage.getItem(this.config.storageKey!) ?? '{}';
            const data = JSON.parse(stored) as StoredWalletData;

            if (!data.addresses) {
                data.addresses = {};
            }

            // Store identity with serialized bigints
            data.addresses[identity.keyHash] = identity.addresses;
            data.identities = data.identities ?? {};
            data.identities[identity.keyHash] = {
                keyHash: identity.keyHash,
                publicKeyX: identity.publicKeyX.toString(),
                publicKeyY: identity.publicKeyY.toString(),
                credentialId: identity.credentialId,
                createdAt: identity.createdAt,
                updatedAt: identity.updatedAt,
            };

            localStorage.setItem(this.config.storageKey!, JSON.stringify(data));
        } catch (error) {
            console.warn('Failed to save wallet addresses to storage:', error);
        }
    }

    /**
     * Save addresses to localStorage
     */
    private saveAddressesToStorage(keyHash: string, addresses: ChainAddress[]): void {
        if (typeof window === 'undefined') return;

        try {
            const stored = localStorage.getItem(this.config.storageKey!) ?? '{}';
            const data = JSON.parse(stored) as StoredWalletData;

            if (!data.addresses) {
                data.addresses = {};
            }

            data.addresses[keyHash] = addresses;
            localStorage.setItem(this.config.storageKey!, JSON.stringify(data));
        } catch (error) {
            console.warn('Failed to save wallet addresses to storage:', error);
        }
    }

    /**
     * Clear all cached data
     */
    clearCache(): void {
        this.addressCache.clear();
        
        if (this.config.persistToStorage && typeof window !== 'undefined') {
            localStorage.removeItem(this.config.storageKey!);
        }
    }

    /**
     * Load identity from storage
     */
    loadIdentityFromStorage(keyHash: string): UnifiedIdentity | null {
        if (typeof window === 'undefined') return null;

        try {
            const stored = localStorage.getItem(this.config.storageKey!);
            if (!stored) return null;

            const data = JSON.parse(stored) as StoredWalletData;
            const storedIdentity = data.identities?.[keyHash];
            const addresses = data.addresses?.[keyHash];

            if (!storedIdentity || !addresses) return null;

            return {
                keyHash: storedIdentity.keyHash,
                publicKeyX: BigInt(storedIdentity.publicKeyX),
                publicKeyY: BigInt(storedIdentity.publicKeyY),
                credentialId: storedIdentity.credentialId,
                addresses,
                createdAt: storedIdentity.createdAt,
                updatedAt: storedIdentity.updatedAt,
            };
        } catch (error) {
            console.warn('Failed to load identity from storage:', error);
            return null;
        }
    }
}

// ============================================================================
// Helper Types (Internal)
// ============================================================================

interface ChainAddressConfig {
    chainName: string;
    isEvm: boolean;
    factoryAddress?: string;
    implementationAddress?: string;
}

interface StoredWalletData {
    addresses: Record<string, ChainAddress[]>;
    identities?: Record<string, {
        keyHash: string;
        publicKeyX: string;
        publicKeyY: string;
        credentialId: string;
        createdAt: number;
        updatedAt: number;
    }>;
}

// Export the helper type for external use
export type { ChainAddressConfig };
