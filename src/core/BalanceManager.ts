/**
 * Veridex Protocol SDK - Balance Manager
 * 
 * Manages balance fetching for native tokens and ERC20s across chains
 */

import { ethers } from 'ethers';
import { 
    TokenInfo, 
    getTokenList, 
    getAllTokens, 
    isNativeToken, 
    NATIVE_TOKEN_ADDRESS 
} from '../constants/tokens.js';

// ============================================================================
// Types
// ============================================================================

export interface TokenBalance {
    /** Token information */
    token: TokenInfo;
    /** Raw balance in smallest units */
    balance: bigint;
    /** Formatted balance with decimals */
    formatted: string;
    /** USD value (if price available) */
    usdValue?: number;
}

export interface PortfolioBalance {
    /** Wormhole chain ID */
    wormholeChainId: number;
    /** Chain name */
    chainName: string;
    /** Address being queried */
    address: string;
    /** Individual token balances */
    tokens: TokenBalance[];
    /** Total USD value (if prices available) */
    totalUsdValue?: number;
    /** Timestamp of last update */
    lastUpdated: number;
}

export interface BalanceManagerConfig {
    /** Whether to cache balances */
    cacheBalances?: boolean;
    /** Cache TTL in milliseconds */
    cacheTtl?: number;
    /** Custom RPC URLs by chain ID */
    customRpcUrls?: Record<number, string>;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default RPC URLs for testnet chains
 */
const DEFAULT_RPC_URLS: Record<number, string> = {
    10002: 'https://ethereum-sepolia-rpc.publicnode.com',
    10003: 'https://sepolia-rollup.arbitrum.io/rpc',
    10004: 'https://sepolia.base.org',
    10005: 'https://sepolia.optimism.io',
};

/**
 * Testnet token prices (USD) for development/testing
 * These are static estimates since testnet tokens have no real value
 */
const TESTNET_TOKEN_PRICES: Record<string, number> = {
    ETH: 2500,
    WETH: 2500,
    'WETH.BASE': 2500, // Wormhole-wrapped Base WETH
    USDC: 1,
    USDT: 1,
    DAI: 1,
    WBTC: 60000,
    LINK: 15,
    UNI: 8,
};

/**
 * ERC20 ABI for balance checking
 */
const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function name() view returns (string)',
];

/**
 * Default cache TTL: 30 seconds
 */
const DEFAULT_CACHE_TTL = 30_000;

// ============================================================================
// Balance Cache
// ============================================================================

interface CachedBalance {
    balance: PortfolioBalance;
    expiresAt: number;
}

// ============================================================================
// Balance Manager Class
// ============================================================================

export class BalanceManager {
    private config: Required<BalanceManagerConfig>;
    private providers: Map<number, ethers.JsonRpcProvider> = new Map();
    private cache: Map<string, CachedBalance> = new Map();

    constructor(config: BalanceManagerConfig = {}) {
        this.config = {
            cacheBalances: config.cacheBalances ?? true,
            cacheTtl: config.cacheTtl ?? DEFAULT_CACHE_TTL,
            customRpcUrls: config.customRpcUrls ?? {},
        };
    }

    // ========================================================================
    // Public Methods
    // ========================================================================

    /**
     * Get balance for a specific token on a chain
     * 
     * @param wormholeChainId - The Wormhole chain ID
     * @param address - The address to check balance for
     * @param tokenAddress - Token address or 'native' for native token
     * @returns TokenBalance with raw and formatted amounts
     */
    async getBalance(
        wormholeChainId: number,
        address: string,
        tokenAddress: string
    ): Promise<TokenBalance> {
        const provider = this.getProvider(wormholeChainId);
        const tokenList = getTokenList(wormholeChainId);
        
        if (!tokenList) {
            throw new Error(`Chain ${wormholeChainId} not supported`);
        }

        const tokens = getAllTokens(wormholeChainId);
        let tokenInfo = tokens.find(
            t => t.address.toLowerCase() === tokenAddress.toLowerCase()
        );

        // Handle native token variations
        if (!tokenInfo && isNativeToken(tokenAddress)) {
            tokenInfo = tokenList.nativeToken;
        }

        // If still no token info, create a generic one
        if (!tokenInfo) {
            tokenInfo = await this.fetchTokenInfo(provider, tokenAddress);
        }

        const balance = await this.fetchBalance(provider, address, tokenAddress, tokenInfo);
        const formatted = ethers.formatUnits(balance, tokenInfo.decimals);
        // Calculate USD value using testnet prices
        const price = TESTNET_TOKEN_PRICES[tokenInfo.symbol.toUpperCase()];
        const usdValue = price ? parseFloat(formatted) * price : undefined;

        return {
            token: tokenInfo,
            balance,
            formatted,
            usdValue,
        };
    }

    /**
     * Get all token balances for an address on a chain
     * 
     * @param wormholeChainId - The Wormhole chain ID
     * @param address - The address to check balances for
     * @param includeZeroBalances - Whether to include tokens with 0 balance
     * @returns PortfolioBalance with all token balances
     */
    async getPortfolioBalance(
        wormholeChainId: number,
        address: string,
        includeZeroBalances: boolean = false
    ): Promise<PortfolioBalance> {
        // Check cache first
        const cacheKey = `${wormholeChainId}:${address.toLowerCase()}`;
        if (this.config.cacheBalances) {
            const cached = this.cache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) {
                return cached.balance;
            }
        }

        const tokenList = getTokenList(wormholeChainId);
        if (!tokenList) {
            throw new Error(`Chain ${wormholeChainId} not supported`);
        }

        const provider = this.getProvider(wormholeChainId);
        const tokens = getAllTokens(wormholeChainId);
        const balances: TokenBalance[] = [];

        // Fetch all balances in parallel
        const balancePromises = tokens.map(async (token) => {
            try {
                const balance = await this.fetchBalance(
                    provider,
                    address,
                    token.address,
                    token
                );
                const formatted = ethers.formatUnits(balance, token.decimals);
                // Calculate USD value using testnet prices
                const price = TESTNET_TOKEN_PRICES[token.symbol.toUpperCase()];
                const usdValue = price ? parseFloat(formatted) * price : undefined;
                return { token, balance, formatted, usdValue };
            } catch (error) {
                console.warn(`Failed to fetch ${token.symbol} balance:`, error);
                return { token, balance: 0n, formatted: '0', usdValue: undefined };
            }
        });

        const results = await Promise.all(balancePromises);

        for (const result of results) {
            if (includeZeroBalances || result.balance > 0n) {
                balances.push(result);
            }
        }

        // Calculate total USD value
        const totalUsdValue = balances.reduce((sum, b) => sum + (b.usdValue ?? 0), 0);

        const portfolio: PortfolioBalance = {
            wormholeChainId,
            chainName: tokenList.chainName,
            address,
            tokens: balances,
            totalUsdValue: totalUsdValue > 0 ? totalUsdValue : undefined,
            lastUpdated: Date.now(),
        };

        // Cache the result
        if (this.config.cacheBalances) {
            this.cache.set(cacheKey, {
                balance: portfolio,
                expiresAt: Date.now() + this.config.cacheTtl,
            });
        }

        return portfolio;
    }

    /**
     * Get native token balance
     * 
     * @param wormholeChainId - The Wormhole chain ID
     * @param address - The address to check
     * @returns TokenBalance for native token
     */
    async getNativeBalance(
        wormholeChainId: number,
        address: string
    ): Promise<TokenBalance> {
        return this.getBalance(wormholeChainId, address, NATIVE_TOKEN_ADDRESS);
    }

    /**
     * Get balances across multiple chains for an address
     * 
     * @param address - The address to check
     * @param chainIds - Array of Wormhole chain IDs to check
     * @returns Array of PortfolioBalance for each chain
     */
    async getMultiChainBalances(
        address: string,
        chainIds: number[]
    ): Promise<PortfolioBalance[]> {
        const promises = chainIds.map(chainId =>
            this.getPortfolioBalance(chainId, address).catch(error => {
                console.warn(`Failed to fetch balances for chain ${chainId}:`, error);
                return null;
            })
        );

        const results = await Promise.all(promises);
        return results.filter((r): r is PortfolioBalance => r !== null);
    }

    /**
     * Clear the balance cache
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * Invalidate cache for a specific address
     */
    invalidateCache(wormholeChainId: number, address: string): void {
        const cacheKey = `${wormholeChainId}:${address.toLowerCase()}`;
        this.cache.delete(cacheKey);
    }

    /**
     * Add or update RPC URL for a chain
     */
    setRpcUrl(wormholeChainId: number, rpcUrl: string): void {
        this.config.customRpcUrls[wormholeChainId] = rpcUrl;
        // Clear existing provider to force recreation
        this.providers.delete(wormholeChainId);
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    /**
     * Get or create a provider for a chain
     */
    private getProvider(wormholeChainId: number): ethers.JsonRpcProvider {
        let provider = this.providers.get(wormholeChainId);
        if (provider) {
            return provider;
        }

        const rpcUrl = this.config.customRpcUrls[wormholeChainId] ?? 
                       DEFAULT_RPC_URLS[wormholeChainId];
        
        if (!rpcUrl) {
            throw new Error(`No RPC URL configured for chain ${wormholeChainId}`);
        }

        provider = new ethers.JsonRpcProvider(rpcUrl);
        this.providers.set(wormholeChainId, provider);
        return provider;
    }

    /**
     * Fetch balance for a token
     */
    private async fetchBalance(
        provider: ethers.JsonRpcProvider,
        address: string,
        tokenAddress: string,
        _tokenInfo: TokenInfo
    ): Promise<bigint> {
        if (isNativeToken(tokenAddress)) {
            return await provider.getBalance(address);
        }

        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        return await contract.balanceOf(address);
    }

    /**
     * Fetch token info from contract
     */
    private async fetchTokenInfo(
        provider: ethers.JsonRpcProvider,
        tokenAddress: string
    ): Promise<TokenInfo> {
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        
        const [symbol, name, decimals] = await Promise.all([
            contract.symbol().catch(() => 'UNKNOWN'),
            contract.name().catch(() => 'Unknown Token'),
            contract.decimals().catch(() => 18),
        ]);

        return {
            symbol,
            name,
            address: tokenAddress,
            decimals: Number(decimals),
            isNative: false,
        };
    }
}
