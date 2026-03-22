/**
 * Gas Sponsor Module
 * 
 * Handles sponsored (gasless) vault creation for Veridex users.
 * Uses a Veridex-owned wallet to pay gas fees on behalf of users.
 * 
 * This is a temporary solution until the full relayer is built.
 * In the future, this will be handled by:
 * - ERC-4337 Account Abstraction with Paymasters
 * - Dedicated Relayer service
 */

import { ethers } from 'ethers';

// ============================================================================
// Types
// ============================================================================

export interface ChainDeploymentConfig {
    name: string;
    chainId: number;
    wormholeChainId: number;
    rpcUrl: string;
    vaultFactory?: string;
    hubAddress?: string;
    isHub?: boolean;
}

export interface SponsoredVaultResult {
    success: boolean;
    chain: string;
    wormholeChainId: number;
    vaultAddress?: string;
    transactionHash?: string;
    error?: string;
    alreadyExists?: boolean;
}

export interface MultiChainVaultResult {
    keyHash: string;
    results: SponsoredVaultResult[];
    allSuccessful: boolean;
    vaultAddresses: Record<number, string>; // wormholeChainId -> address
}

export interface GasSponsorConfig {
    /** 
     * Private key for the sponsor wallet (from env or secure storage)
     * This is the fallback when relayer is not available
     */
    sponsorPrivateKey?: string;
    
    /**
     * Integrator-provided sponsor key (for platforms using Veridex SDK)
     * Takes priority over Veridex default sponsorship
     */
    integratorSponsorKey?: string;
    
    /** 
     * Relayer API endpoint for remote sponsorship (primary method)
     * When available, this takes priority over local wallet sponsorship
     */
    relayerUrl?: string;
    
    /** API key for relayer service authentication */
    relayerApiKey?: string;
    
    /** @deprecated Use relayerUrl instead */
    sponsorApiUrl?: string;
    /** @deprecated Use relayerApiKey instead */
    sponsorApiKey?: string;
    
    /** Whether to use testnet configurations */
    testnet?: boolean;
    /** Custom RPC URLs by wormhole chain ID */
    customRpcUrls?: Record<number, string>;
}

/** Sponsorship source type */
export type SponsorshipSource = 'relayer' | 'integrator' | 'veridex' | 'none';

// ============================================================================
// Constants
// ============================================================================

// Vault Factory ABI (minimal)
const VAULT_FACTORY_ABI = [
    'function createVault(bytes32 ownerKeyHash) external returns (address)',
    'function getVault(bytes32 ownerKeyHash) external view returns (address)',
    'function vaultExists(bytes32 ownerKeyHash) external view returns (bool)',
    'function computeVaultAddress(bytes32 ownerKeyHash) external view returns (address)',
    'event VaultCreated(address indexed vault, bytes32 indexed ownerKeyHash, address creator)',
];

// Testnet chain configurations
const TESTNET_CHAINS: ChainDeploymentConfig[] = [
    {
        name: 'Base Sepolia',
        chainId: 84532,
        wormholeChainId: 10004,
        rpcUrl: 'https://sepolia.base.org',
        hubAddress: '0x23a39c294891703146c3607e1FEEB5Fe78F7F28d',
        vaultFactory: '0x31e8dc9428575334739754Ab2bdB0E8b9Dc707FD',
        isHub: true,
    },
    {
        name: 'Optimism Sepolia',
        chainId: 11155420,
        wormholeChainId: 10005,
        rpcUrl: 'https://sepolia.optimism.io',
        vaultFactory: '0x347feeaBB5655a7a80b56D8D554DA30BE6c28225',
    },
    {
        name: 'Arbitrum Sepolia',
        chainId: 421614,
        wormholeChainId: 10003,
        rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
        vaultFactory: '0x708eEE22621A64CDF51d98d3e8D97902D7dF52dD',
    },
];

// Mainnet chain configurations (for future use)
const MAINNET_CHAINS: ChainDeploymentConfig[] = [
    // Will be populated when mainnet is ready
];

// ============================================================================
// GasSponsor Class
// ============================================================================

/**
 * Gas Sponsorship with layered fallback:
 * 1. Relayer (primary) - Remote relayer service handles gas
 * 2. Integrator wallet - Platform using SDK provides their own sponsor key
 * 3. Veridex wallet (fallback) - Veridex's default sponsor wallet
 */
export class GasSponsor {
    private config: GasSponsorConfig;
    private sponsorWallet?: ethers.Wallet;
    private integratorWallet?: ethers.Wallet;
    private chains: ChainDeploymentConfig[];

    constructor(config: GasSponsorConfig = {}) {
        this.config = config;
        this.chains = config.testnet !== false ? TESTNET_CHAINS : MAINNET_CHAINS;

        // Initialize integrator wallet if provided (takes priority)
        if (config.integratorSponsorKey) {
            this.integratorWallet = new ethers.Wallet(config.integratorSponsorKey);
        }

        // Initialize Veridex sponsor wallet as fallback
        if (config.sponsorPrivateKey) {
            this.sponsorWallet = new ethers.Wallet(config.sponsorPrivateKey);
        }
    }

    /**
     * Determine which sponsorship source is available
     * Priority: Relayer > Integrator > Veridex > None
     */
    getSponsorshipSource(): SponsorshipSource {
        // 1. Check relayer first (future primary method)
        if (this.config.relayerUrl || this.config.sponsorApiUrl) {
            return 'relayer';
        }
        
        // 2. Check integrator-provided wallet
        if (this.integratorWallet) {
            return 'integrator';
        }
        
        // 3. Check Veridex fallback wallet
        if (this.sponsorWallet) {
            return 'veridex';
        }
        
        return 'none';
    }

    /**
     * Get the active sponsor wallet (integrator takes priority)
     */
    private getActiveWallet(): ethers.Wallet | undefined {
        return this.integratorWallet || this.sponsorWallet;
    }

    /**
     * Get supported chains for vault deployment
     */
    getSupportedChains(): ChainDeploymentConfig[] {
        return this.chains.filter(c => c.vaultFactory);
    }

    /**
     * Get the hub chain configuration
     */
    getHubChain(): ChainDeploymentConfig | undefined {
        return this.chains.find(c => c.isHub);
    }

    /**
     * Check if sponsor is configured (has relayer, integrator key, or Veridex key)
     */
    isConfigured(): boolean {
        return this.getSponsorshipSource() !== 'none';
    }

    /**
     * Get sponsor wallet balance on a specific chain
     */
    async getSponsorBalance(wormholeChainId: number): Promise<bigint> {
        const chain = this.chains.find(c => c.wormholeChainId === wormholeChainId);
        const wallet = this.getActiveWallet();
        if (!chain || !wallet) {
            return BigInt(0);
        }

        const rpcUrl = this.config.customRpcUrls?.[wormholeChainId] || chain.rpcUrl;
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        return await provider.getBalance(wallet.address);
    }

    /**
     * Check if a vault exists for a given key hash on a chain
     */
    async checkVaultExists(
        keyHash: string,
        wormholeChainId: number
    ): Promise<{ exists: boolean; address: string }> {
        const chain = this.chains.find(c => c.wormholeChainId === wormholeChainId);
        if (!chain || !chain.vaultFactory) {
            return { exists: false, address: ethers.ZeroAddress };
        }

        const rpcUrl = this.config.customRpcUrls?.[wormholeChainId] || chain.rpcUrl;
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const factory = new ethers.Contract(chain.vaultFactory, VAULT_FACTORY_ABI, provider);

        try {
            const address = await factory.getVault(keyHash);
            const exists = address !== ethers.ZeroAddress;
            return { exists, address };
        } catch (error) {
            console.error(`Error checking vault on ${chain.name}:`, error);
            return { exists: false, address: ethers.ZeroAddress };
        }
    }

    /**
     * Get predicted vault address for a key hash on a chain
     */
    async computeVaultAddress(
        keyHash: string,
        wormholeChainId: number
    ): Promise<string | null> {
        const chain = this.chains.find(c => c.wormholeChainId === wormholeChainId);
        if (!chain || !chain.vaultFactory) {
            return null;
        }

        const rpcUrl = this.config.customRpcUrls?.[wormholeChainId] || chain.rpcUrl;
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const factory = new ethers.Contract(chain.vaultFactory, VAULT_FACTORY_ABI, provider);

        try {
            return await factory.computeVaultAddress(keyHash);
        } catch (error) {
            console.error(`Error computing vault address on ${chain.name}:`, error);
            return null;
        }
    }

    /**
     * Create a vault on a specific chain (sponsored)
     * 
     * Sponsorship priority:
     * 1. Relayer API (future - not yet implemented)
     * 2. Integrator wallet (if provided)
     * 3. Veridex sponsor wallet (fallback)
     */
    async createVaultOnChain(
        keyHash: string,
        wormholeChainId: number
    ): Promise<SponsoredVaultResult> {
        const chain = this.chains.find(c => c.wormholeChainId === wormholeChainId);
        
        if (!chain) {
            return {
                success: false,
                chain: 'Unknown',
                wormholeChainId,
                error: `Chain ${wormholeChainId} not found`,
            };
        }

        if (!chain.vaultFactory) {
            return {
                success: false,
                chain: chain.name,
                wormholeChainId,
                error: `No vault factory configured for ${chain.name}`,
            };
        }

        const source = this.getSponsorshipSource();

        // 1. Check if using relayer API (future primary method)
        if (source === 'relayer') {
            const relayerUrl = this.config.relayerUrl || this.config.sponsorApiUrl;
            if (relayerUrl) {
                return await this.createVaultViaRelayer(keyHash, chain, relayerUrl);
            }
        }

        // 2. Use local wallet (integrator or Veridex)
        const wallet = this.getActiveWallet();
        if (!wallet) {
            return {
                success: false,
                chain: chain.name,
                wormholeChainId,
                error: 'No sponsor configured. Set VERIDEX_SPONSOR_KEY or provide integratorSponsorKey.',
            };
        }

        const sponsorType = source === 'integrator' ? 'Integrator' : 'Veridex';

        try {
            const rpcUrl = this.config.customRpcUrls?.[wormholeChainId] || chain.rpcUrl;
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const signer = wallet.connect(provider);
            const factory = new ethers.Contract(chain.vaultFactory, VAULT_FACTORY_ABI, signer);

            // Check if vault already exists
            const existingVault = await factory.getVault(keyHash);
            if (existingVault !== ethers.ZeroAddress) {
                return {
                    success: true,
                    chain: chain.name,
                    wormholeChainId,
                    vaultAddress: existingVault,
                    alreadyExists: true,
                };
            }

            // Check sponsor balance
            const balance = await provider.getBalance(signer.address);
            if (balance < ethers.parseEther('0.001')) {
                return {
                    success: false,
                    chain: chain.name,
                    wormholeChainId,
                    error: `Insufficient ${sponsorType} sponsor balance on ${chain.name}`,
                };
            }

            // Create vault
            console.log(`[GasSponsor] Creating vault on ${chain.name} (${sponsorType} sponsored)...`);
            const tx = await factory.createVault(keyHash);
            const receipt = await tx.wait();

            // Get vault address from event or direct query
            const vaultAddress = await factory.getVault(keyHash);

            console.log(`[GasSponsor] OK Vault created on ${chain.name}: ${vaultAddress}`);

            return {
                success: true,
                chain: chain.name,
                wormholeChainId,
                vaultAddress,
                transactionHash: receipt.hash,
            };
        } catch (error: any) {
            console.error(`[GasSponsor] Error creating vault on ${chain.name}:`, error);
            return {
                success: false,
                chain: chain.name,
                wormholeChainId,
                error: error.message || 'Unknown error',
            };
        }
    }

    /**
     * Create vault via relayer service (future primary method)
     * 
     * The relayer handles:
     * - Gas payment on behalf of users
     * - Transaction submission and monitoring
     * - Rate limiting and abuse prevention
     */
    private async createVaultViaRelayer(
        keyHash: string,
        chain: ChainDeploymentConfig,
        relayerUrl: string
    ): Promise<SponsoredVaultResult> {
        try {
            const apiKey = this.config.relayerApiKey || this.config.sponsorApiKey;
            
            const response = await fetch(`${relayerUrl}/create-vault`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(apiKey && {
                        'Authorization': `Bearer ${apiKey}`,
                    }),
                },
                body: JSON.stringify({
                    keyHash,
                    wormholeChainId: chain.wormholeChainId,
                }),
            });

            if (!response.ok) {
                const error = await response.text();
                
                // If relayer fails, try fallback to local wallet
                console.warn(`[GasSponsor] Relayer failed, trying local wallet fallback...`);
                const wallet = this.getActiveWallet();
                if (wallet) {
                    return await this.createVaultWithWallet(keyHash, chain, wallet);
                }
                
                throw new Error(`Relayer error: ${error}`);
            }

            const result = await response.json();
            return {
                success: true,
                chain: chain.name,
                wormholeChainId: chain.wormholeChainId,
                vaultAddress: result.vaultAddress,
                transactionHash: result.transactionHash,
                alreadyExists: result.alreadyExists,
            };
        } catch (error: any) {
            // Fallback to local wallet if relayer fails
            console.warn(`[GasSponsor] Relayer unavailable: ${error.message}`);
            const wallet = this.getActiveWallet();
            if (wallet) {
                console.log(`[GasSponsor] Falling back to local wallet sponsorship...`);
                return await this.createVaultWithWallet(keyHash, chain, wallet);
            }
            
            return {
                success: false,
                chain: chain.name,
                wormholeChainId: chain.wormholeChainId,
                error: error.message || 'Relayer request failed and no fallback available',
            };
        }
    }

    /**
     * Create vault with a specific wallet (internal helper)
     */
    private async createVaultWithWallet(
        keyHash: string,
        chain: ChainDeploymentConfig,
        wallet: ethers.Wallet
    ): Promise<SponsoredVaultResult> {
        if (!chain.vaultFactory) {
            return {
                success: false,
                chain: chain.name,
                wormholeChainId: chain.wormholeChainId,
                error: `No vault factory for ${chain.name}`,
            };
        }

        try {
            const rpcUrl = this.config.customRpcUrls?.[chain.wormholeChainId] || chain.rpcUrl;
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const signer = wallet.connect(provider);
            const factory = new ethers.Contract(chain.vaultFactory, VAULT_FACTORY_ABI, signer);

            // Check if vault already exists
            const existingVault = await factory.getVault(keyHash);
            if (existingVault !== ethers.ZeroAddress) {
                return {
                    success: true,
                    chain: chain.name,
                    wormholeChainId: chain.wormholeChainId,
                    vaultAddress: existingVault,
                    alreadyExists: true,
                };
            }

            // Check balance
            const balance = await provider.getBalance(signer.address);
            if (balance < ethers.parseEther('0.001')) {
                return {
                    success: false,
                    chain: chain.name,
                    wormholeChainId: chain.wormholeChainId,
                    error: `Insufficient sponsor balance on ${chain.name}`,
                };
            }

            // Create vault
            const tx = await factory.createVault(keyHash);
            const receipt = await tx.wait();
            const vaultAddress = await factory.getVault(keyHash);

            return {
                success: true,
                chain: chain.name,
                wormholeChainId: chain.wormholeChainId,
                vaultAddress,
                transactionHash: receipt.hash,
            };
        } catch (error: any) {
            return {
                success: false,
                chain: chain.name,
                wormholeChainId: chain.wormholeChainId,
                error: error.message || 'Wallet creation failed',
            };
        }
    }

    /**
     * Create vaults on all supported chains (sponsored)
     */
    async createVaultsOnAllChains(keyHash: string): Promise<MultiChainVaultResult> {
        const supportedChains = this.getSupportedChains();
        const results: SponsoredVaultResult[] = [];
        const vaultAddresses: Record<number, string> = {};

        console.log(`[GasSponsor] Creating vaults on ${supportedChains.length} chains...`);

        // Create vaults in parallel (or sequentially for rate limiting)
        for (const chain of supportedChains) {
            const result = await this.createVaultOnChain(keyHash, chain.wormholeChainId);
            results.push(result);

            if (result.success && result.vaultAddress) {
                vaultAddresses[chain.wormholeChainId] = result.vaultAddress;
            }
        }

        const allSuccessful = results.every(r => r.success);

        return {
            keyHash,
            results,
            allSuccessful,
            vaultAddresses,
        };
    }

    /**
     * Check vault status on all chains
     */
    async checkVaultsOnAllChains(keyHash: string): Promise<Record<number, { exists: boolean; address: string }>> {
        const supportedChains = this.getSupportedChains();
        const results: Record<number, { exists: boolean; address: string }> = {};

        for (const chain of supportedChains) {
            results[chain.wormholeChainId] = await this.checkVaultExists(keyHash, chain.wormholeChainId);
        }

        return results;
    }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a GasSponsor instance
 * 
 * @example
 * ```ts
 * // With environment variable
 * const sponsor = createGasSponsor({
 *   sponsorPrivateKey: process.env.VERIDEX_SPONSOR_KEY,
 *   testnet: true,
 * });
 * 
 * // Create vaults for a user
 * const result = await sponsor.createVaultsOnAllChains(userKeyHash);
 * ```
 */
export function createGasSponsor(config: GasSponsorConfig = {}): GasSponsor {
    return new GasSponsor(config);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick check if gas sponsorship is available
 */
export function isSponsorshipAvailable(): boolean {
    return !!(
        typeof process !== 'undefined' &&
        (process.env?.VERIDEX_SPONSOR_KEY || process.env?.NEXT_PUBLIC_SPONSOR_API_URL)
    );
}

/**
 * Get chain configurations for display
 */
export function getSupportedChainConfigs(testnet: boolean = true): ChainDeploymentConfig[] {
    return (testnet ? TESTNET_CHAINS : MAINNET_CHAINS).filter(c => c.vaultFactory);
}
