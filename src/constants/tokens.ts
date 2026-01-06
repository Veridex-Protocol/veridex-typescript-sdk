/**
 * Veridex Protocol SDK - Token Constants
 * 
 * Known tokens per chain for balance fetching and transfers
 */

// ============================================================================
// Types
// ============================================================================

export interface TokenInfo {
    /** Token symbol (e.g., 'USDC', 'ETH') */
    symbol: string;
    /** Token name (e.g., 'USD Coin') */
    name: string;
    /** Token address (use 'native' for native token) */
    address: string;
    /** Number of decimals */
    decimals: number;
    /** Optional logo URL */
    logoUrl?: string;
    /** Whether this is the native token */
    isNative: boolean;
    /** Wormhole-wrapped token address on other chains (by wormhole chain ID) */
    wrappedAddresses?: Record<number, string>;
}

export interface ChainTokenList {
    /** Wormhole chain ID */
    wormholeChainId: number;
    /** Chain name */
    chainName: string;
    /** Native token info */
    nativeToken: TokenInfo;
    /** ERC20/SPL/etc tokens */
    tokens: TokenInfo[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Native token address constant
 */
export const NATIVE_TOKEN_ADDRESS = 'native';

/**
 * Zero address for EVM chains
 */
export const EVM_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ============================================================================
// Base Sepolia (Hub Chain) - Wormhole Chain ID 10004
// ============================================================================

export const BASE_SEPOLIA_TOKENS: ChainTokenList = {
    wormholeChainId: 10004,
    chainName: 'Base Sepolia',
    nativeToken: {
        symbol: 'ETH',
        name: 'Ether',
        address: NATIVE_TOKEN_ADDRESS,
        decimals: 18,
        isNative: true,
    },
    tokens: [
        {
            symbol: 'USDC',
            name: 'USD Coin (Test)',
            address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Circle test USDC
            decimals: 6,
            isNative: false,
        },
        {
            symbol: 'WETH',
            name: 'Wrapped Ether',
            address: '0x4200000000000000000000000000000000000006',
            decimals: 18,
            isNative: false,
        },
    ],
};

// ============================================================================
// Optimism Sepolia (Spoke Chain) - Wormhole Chain ID 10005
// ============================================================================

export const OPTIMISM_SEPOLIA_TOKENS: ChainTokenList = {
    wormholeChainId: 10005,
    chainName: 'Optimism Sepolia',
    nativeToken: {
        symbol: 'ETH',
        name: 'Ether',
        address: NATIVE_TOKEN_ADDRESS,
        decimals: 18,
        isNative: true,
    },
    tokens: [
        {
            symbol: 'USDC',
            name: 'USD Coin (Test)',
            address: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', // Test USDC
            decimals: 6,
            isNative: false,
        },
        {
            symbol: 'WETH',
            name: 'Wrapped Ether',
            address: '0x4200000000000000000000000000000000000006',
            decimals: 18,
            isNative: false,
        },
        {
            symbol: 'WETH.base',
            name: 'Wrapped WETH (Base via Wormhole)',
            address: '0xD408f6498f48aE11BcAb518dA39cF7940eE3271d', // Wormhole-wrapped Base WETH
            decimals: 18,
            isNative: false,
        },
    ],
};

// ============================================================================
// Arbitrum Sepolia (Spoke Chain) - Wormhole Chain ID 10003
// ============================================================================

export const ARBITRUM_SEPOLIA_TOKENS: ChainTokenList = {
    wormholeChainId: 10003,
    chainName: 'Arbitrum Sepolia',
    nativeToken: {
        symbol: 'ETH',
        name: 'Ether',
        address: NATIVE_TOKEN_ADDRESS,
        decimals: 18,
        isNative: true,
    },
    tokens: [
        {
            symbol: 'USDC',
            name: 'USD Coin (Test)',
            address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // Circle USDC Arbitrum Sepolia
            decimals: 6,
            isNative: false,
        },
        {
            symbol: 'WETH',
            name: 'Wrapped Ether',
            address: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
            decimals: 18,
            isNative: false,
        },
    ],
};

// ============================================================================
// Token Registry
// ============================================================================

/**
 * All token lists indexed by Wormhole chain ID
 */
export const TOKEN_REGISTRY: Record<number, ChainTokenList> = {
    10004: BASE_SEPOLIA_TOKENS,
    10005: OPTIMISM_SEPOLIA_TOKENS,
    10003: ARBITRUM_SEPOLIA_TOKENS,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get token list for a chain
 */
export function getTokenList(wormholeChainId: number): ChainTokenList | null {
    return TOKEN_REGISTRY[wormholeChainId] ?? null;
}

/**
 * Get all tokens for a chain (native + ERC20)
 */
export function getAllTokens(wormholeChainId: number): TokenInfo[] {
    const list = getTokenList(wormholeChainId);
    if (!list) return [];
    return [list.nativeToken, ...list.tokens];
}

/**
 * Get token info by symbol
 */
export function getTokenBySymbol(wormholeChainId: number, symbol: string): TokenInfo | null {
    const tokens = getAllTokens(wormholeChainId);
    return tokens.find(t => t.symbol.toLowerCase() === symbol.toLowerCase()) ?? null;
}

/**
 * Get token info by address
 */
export function getTokenByAddress(wormholeChainId: number, address: string): TokenInfo | null {
    const tokens = getAllTokens(wormholeChainId);
    const normalizedAddress = address.toLowerCase();
    return tokens.find(t => t.address.toLowerCase() === normalizedAddress) ?? null;
}

/**
 * Check if an address is the native token
 */
export function isNativeToken(address: string): boolean {
    return address.toLowerCase() === NATIVE_TOKEN_ADDRESS || 
           address === EVM_ZERO_ADDRESS;
}

/**
 * Get supported chain IDs
 */
export function getSupportedChainIds(): number[] {
    return Object.keys(TOKEN_REGISTRY).map(Number);
}

/**
 * Get chain name by Wormhole chain ID
 */
export function getChainName(wormholeChainId: number): string | null {
    return TOKEN_REGISTRY[wormholeChainId]?.chainName ?? null;
}
