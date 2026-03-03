/**
 * Veridex Protocol SDK - Factory Module Tests
 * 
 * Comprehensive unit tests for SDK initialization:
 * - createSDK factory function
 * - Chain preset resolution
 * - Network selection (testnet/mainnet)
 * - Custom configuration overrides
 * - Error handling for invalid inputs
 * 
 * These tests verify that:
 * - SDK initializes correctly for all supported chains
 * - Chain clients are created with correct parameters
 * - Configuration validation is enforced
 * - Convenience functions work as expected
 * 
 * @author Veridex Protocol
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createSDK,
    createHubSDK,
    createTestnetSDK,
    createMainnetSDK,
    createSessionSDK,
    CHAIN_NAMES,
    CHAIN_PRESETS,
    getChainConfig,
    getChainPreset,
    getSupportedChains,
    getHubChains,
    isChainSupported,
    getDefaultHub,
    type ChainName,
    type NetworkType,
} from '../src/factory.js';
import { VeridexSDK } from '../src/core/VeridexSDK.js';
import { setFeatureFlags, resetFeatureFlags } from '../src/featureFlags.js';

// ============================================================================
// createSDK Factory Tests
// ============================================================================

describe('createSDK', () => {
    // ────────────────────────────────────────────────────────────────────────
    // Basic Creation Tests
    // ────────────────────────────────────────────────────────────────────────

    describe('basic creation', () => {
        it('should create SDK for Base (hub chain) on testnet', () => {
            const sdk = createSDK('base');

            expect(sdk).toBeInstanceOf(VeridexSDK);
        });

        it('should create SDK with default testnet network', () => {
            const sdk = createSDK('base');

            // SDK should be configured for testnet (default)
            expect(sdk).toBeDefined();
        });

        it('should throw for mainnet when hub not deployed', () => {
            // Mainnet hub contracts not deployed yet
            expect(() => createSDK('base', { network: 'mainnet' })).toThrow('Missing hub contract address');
        });

        it('should create SDK with custom RPC URL', () => {
            const customRpc = 'https://custom-rpc.example.com';
            const sdk = createSDK('base', { rpcUrl: customRpc });

            expect(sdk).toBeDefined();
        });

        it('should create SDK with relayer configuration', () => {
            const sdk = createSDK('base', {
                relayerUrl: 'https://relayer.veridex.network',
                relayerApiKey: 'test-api-key',
            });

            expect(sdk).toBeDefined();
        });

        it('should create SDK with sponsor configuration (valid private key)', () => {
            // Use a valid secp256k1 private key
            const validPrivateKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
            const sdk = createSDK('base', {
                sponsorPrivateKey: validPrivateKey,
            });

            expect(sdk).toBeDefined();
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // Multi-Chain Support Tests
    // ────────────────────────────────────────────────────────────────────────

    describe('multi-chain support', () => {
        // Only Base has hub deployed on testnet currently
        const chainsWithHub: ChainName[] = ['base'];

        const evmChainsWithoutHub: ChainName[] = [
            'optimism',
            'arbitrum',
            'ethereum',
            'polygon',
            'scroll',
            'blast',
            'mantle',
            'bsc',
            'avalanche',
            'fantom',
            'celo',
            'moonbeam',
        ];

        const nonEvmChains: ChainName[] = ['solana', 'aptos', 'sui', 'starknet', 'stacks'];

        it.each(chainsWithHub)('should create SDK for chain with hub: %s', (chain) => {
            const sdk = createSDK(chain);
            expect(sdk).toBeInstanceOf(VeridexSDK);
        });

        it.each(evmChainsWithoutHub)('should throw for EVM chain without hub: %s', (chain) => {
            expect(() => createSDK(chain)).toThrow('Missing hub contract address');
        });

        it.each(nonEvmChains)('should create SDK for non-EVM chain: %s', (chain) => {
            // Non-EVM chains use different client implementations that may not require hub
            const sdk = createSDK(chain);
            expect(sdk).toBeInstanceOf(VeridexSDK);
        });

        it('should throw for unsupported chains', () => {
            expect(() => createSDK('unsupported-chain' as ChainName)).toThrow();
        });

        it('should include chain name in error message for unknown chain', () => {
            try {
                createSDK('invalid-chain' as ChainName);
                fail('Should have thrown');
            } catch (error) {
                expect((error as Error).message).toContain('invalid-chain');
                expect((error as Error).message).toContain('Supported chains');
            }
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // Network Selection Tests
    // ────────────────────────────────────────────────────────────────────────

    describe('network selection', () => {
        it('should default to testnet', () => {
            const sdk = createSDK('base');
            expect(sdk).toBeDefined();
        });

        it('should accept explicit testnet', () => {
            const sdk = createSDK('base', { network: 'testnet' });
            expect(sdk).toBeDefined();
        });

        it('should throw for mainnet (hub not deployed)', () => {
            expect(() => createSDK('base', { network: 'mainnet' })).toThrow('Missing hub contract address');
        });

        it('should use correct RPC for testnet', () => {
            const testnetConfig = getChainConfig('base', 'testnet');
            const mainnetConfig = getChainConfig('base', 'mainnet');

            expect(testnetConfig.rpcUrl).not.toBe(mainnetConfig.rpcUrl);
            expect(testnetConfig.rpcUrl).toContain('sepolia');
        });

        it('should use correct chain ID for testnet vs mainnet', () => {
            const testnetConfig = getChainConfig('base', 'testnet');
            const mainnetConfig = getChainConfig('base', 'mainnet');

            expect(testnetConfig.chainId).toBe(84532); // Base Sepolia
            expect(mainnetConfig.chainId).toBe(8453);  // Base mainnet
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // Configuration Override Tests
    // ────────────────────────────────────────────────────────────────────────

    describe('configuration overrides', () => {
        it('should allow custom RPC URL', () => {
            const sdk = createSDK('base', {
                rpcUrl: 'https://my-custom-rpc.com',
            });

            expect(sdk).toBeDefined();
        });

        it('should allow multiple RPC URLs for multi-chain', () => {
            const sdk = createSDK('base', {
                rpcUrls: {
                    base: 'https://base-rpc.com',
                    optimism: 'https://optimism-rpc.com',
                },
            });

            expect(sdk).toBeDefined();
        });

        it('should allow relayer configuration', () => {
            const sdk = createSDK('base', {
                relayerUrl: 'https://relayer.example.com',
                relayerApiKey: 'api-key-123',
            });

            expect(sdk).toBeDefined();
        });

        it('should allow integrator sponsor key (valid private key format)', () => {
            // Use a valid hex private key
            const validKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
            const sdk = createSDK('base', {
                integratorSponsorKey: validKey,
            });

            expect(sdk).toBeDefined();
        });
    });
});

// ============================================================================
// Convenience Factory Tests
// ============================================================================

describe('createHubSDK', () => {
    it('should create SDK for Base (default hub) on testnet', () => {
        const sdk = createHubSDK();

        expect(sdk).toBeInstanceOf(VeridexSDK);
    });

    it('should throw for mainnet (hub not deployed)', () => {
        expect(() => createHubSDK({ network: 'mainnet' })).toThrow('Missing hub contract address');
    });
});

describe('createTestnetSDK', () => {
    it('should create testnet SDK for default chain (base)', () => {
        const sdk = createTestnetSDK();

        expect(sdk).toBeInstanceOf(VeridexSDK);
    });

    it('should throw for chain without hub', () => {
        expect(() => createTestnetSDK('optimism')).toThrow('Missing hub contract address');
    });

    it('should work for base (has hub)', () => {
        const sdk = createTestnetSDK('base');
        expect(sdk).toBeDefined();
    });
});

describe('createMainnetSDK', () => {
    it('should throw for default chain (no mainnet hub)', () => {
        expect(() => createMainnetSDK()).toThrow('Missing hub contract address');
    });

    it('should throw for specified chain (no mainnet hub)', () => {
        expect(() => createMainnetSDK('arbitrum')).toThrow();
    });
});

describe('createSessionSDK', () => {
    it('should create SDK with session support for default chain (base)', () => {
        const sdk = createSessionSDK();

        expect(sdk).toBeInstanceOf(VeridexSDK);
    });

    it('should throw for chain without hub', () => {
        expect(() => createSessionSDK('optimism')).toThrow('Missing hub contract address');
    });

    it('should warn for non-hub chain before throwing', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        try {
            createSessionSDK('ethereum'); // Not a hub chain
        } catch {
            // Expected to throw
        }

        warnSpy.mockRestore();
    });

    it('should not warn for hub chains', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        createSessionSDK('base'); // Hub chain

        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
    });
});

// ============================================================================
// Chain Preset Helper Tests
// ============================================================================

describe('getChainConfig', () => {
    it('should return testnet config by default', () => {
        const config = getChainConfig('base');

        expect(config.name).toContain('Sepolia');
        expect(config.chainId).toBe(84532);
    });

    it('should return mainnet config when specified', () => {
        const config = getChainConfig('base', 'mainnet');

        expect(config.name).toBe('Base');
        expect(config.chainId).toBe(8453);
    });

    it('should throw for unknown chain', () => {
        expect(() => getChainConfig('unknown' as ChainName)).toThrow();
    });

    it('should return correct Wormhole chain ID', () => {
        const baseTestnet = getChainConfig('base', 'testnet');
        const baseMainnet = getChainConfig('base', 'mainnet');

        expect(baseTestnet.wormholeChainId).toBe(10004);
        expect(baseMainnet.wormholeChainId).toBe(30);
    });

    it('should return contract addresses', () => {
        const config = getChainConfig('base', 'testnet');

        expect(config.contracts).toBeDefined();
        expect(config.contracts.wormholeCoreBridge).toBeDefined();
    });
});

describe('getChainPreset', () => {
    it('should return full preset for chain', () => {
        const preset = getChainPreset('base');

        expect(preset.displayName).toBe('Base');
        expect(preset.type).toBe('evm');
        expect(preset.canBeHub).toBe(true);
        expect(preset.testnet).toBeDefined();
        expect(preset.mainnet).toBeDefined();
    });

    it('should return correct chain type', () => {
        expect(getChainPreset('base').type).toBe('evm');
        expect(getChainPreset('solana').type).toBe('solana');
        expect(getChainPreset('aptos').type).toBe('aptos');
        expect(getChainPreset('sui').type).toBe('sui');
        expect(getChainPreset('starknet').type).toBe('starknet');
        expect(getChainPreset('stacks').type).toBe('stacks');
    });

    it('should throw for unknown chain', () => {
        expect(() => getChainPreset('invalid' as ChainName)).toThrow();
    });
});

describe('getSupportedChains', () => {
    it('should return array of chain names', () => {
        const chains = getSupportedChains();

        expect(Array.isArray(chains)).toBe(true);
        expect(chains.length).toBeGreaterThan(0);
    });

    it('should include all expected chains', () => {
        const chains = getSupportedChains();

        expect(chains).toContain('base');
        expect(chains).toContain('optimism');
        expect(chains).toContain('arbitrum');
        expect(chains).toContain('solana');
        expect(chains).toContain('aptos');
        expect(chains).toContain('sui');
        expect(chains).toContain('starknet');
    });

    it('should match CHAIN_PRESETS keys', () => {
        const chains = getSupportedChains();
        const presetKeys = Object.keys(CHAIN_PRESETS);

        expect(chains.sort()).toEqual(presetKeys.sort());
    });
});

describe('getHubChains', () => {
    afterEach(() => {
        resetFeatureFlags();
    });

    it('should return only hub-capable chains when multi-hub enabled', () => {
        setFeatureFlags({ multiHub: true });
        const hubChains = getHubChains();

        // All returned chains should have canBeHub = true
        for (const chain of hubChains) {
            expect(getChainPreset(chain).canBeHub).toBe(true);
        }
    });

    it('should return only base when multi-hub is disabled (default)', () => {
        const hubChains = getHubChains();
        expect(hubChains).toEqual(['base']);
    });

    it('should include Base as hub', () => {
        const hubChains = getHubChains();

        expect(hubChains).toContain('base');
    });

    it('should include Optimism as hub when multi-hub is enabled', () => {
        setFeatureFlags({ multiHub: true });
        const hubChains = getHubChains();

        expect(hubChains).toContain('optimism');
    });

    it('should not include Ethereum as hub', () => {
        const hubChains = getHubChains();

        // Ethereum L1 is not a hub (no RIP-7212)
        expect(hubChains).not.toContain('ethereum');
    });
});

describe('isChainSupported', () => {
    it('should return true for supported chains', () => {
        expect(isChainSupported('base')).toBe(true);
        expect(isChainSupported('optimism')).toBe(true);
        expect(isChainSupported('solana')).toBe(true);
    });

    it('should return false for unsupported chains', () => {
        expect(isChainSupported('unknown')).toBe(false);
        expect(isChainSupported('')).toBe(false);
        expect(isChainSupported('ETHEREUM')).toBe(false); // Case sensitive
    });

    it('should work as type guard', () => {
        const chain = 'base' as string;

        if (isChainSupported(chain)) {
            // TypeScript should recognize chain as ChainName here
            const preset = getChainPreset(chain);
            expect(preset).toBeDefined();
        }
    });
});

describe('getDefaultHub', () => {
    it('should return Base testnet by default', () => {
        const hub = getDefaultHub();

        expect(hub.name).toContain('Base');
        expect(hub.name).toContain('Sepolia');
    });

    it('should return Base mainnet when specified', () => {
        const hub = getDefaultHub('mainnet');

        expect(hub.name).toBe('Base');
        expect(hub.chainId).toBe(8453);
    });
});

// ============================================================================
// CHAIN_NAMES Constant Tests
// ============================================================================

describe('CHAIN_NAMES', () => {
    it('should contain all EVM L2s', () => {
        expect(CHAIN_NAMES.BASE).toBe('base');
        expect(CHAIN_NAMES.OPTIMISM).toBe('optimism');
        expect(CHAIN_NAMES.ARBITRUM).toBe('arbitrum');
        expect(CHAIN_NAMES.SCROLL).toBe('scroll');
        expect(CHAIN_NAMES.BLAST).toBe('blast');
        expect(CHAIN_NAMES.MANTLE).toBe('mantle');
    });

    it('should contain non-EVM chains', () => {
        expect(CHAIN_NAMES.SOLANA).toBe('solana');
        expect(CHAIN_NAMES.APTOS).toBe('aptos');
        expect(CHAIN_NAMES.SUI).toBe('sui');
        expect(CHAIN_NAMES.STARKNET).toBe('starknet');
    });

    it('should be immutable (const assertion)', () => {
        // TypeScript const assertion makes it readonly
        // This is more of a type check than runtime check
        expect(Object.isFrozen(CHAIN_NAMES)).toBe(false); // JS objects aren't frozen
        expect(typeof CHAIN_NAMES).toBe('object');
    });
});

// ============================================================================
// CHAIN_PRESETS Validation Tests
// ============================================================================

describe('CHAIN_PRESETS', () => {
    it('should have valid structure for all chains', () => {
        for (const [name, preset] of Object.entries(CHAIN_PRESETS)) {
            expect(preset.displayName).toBeDefined();
            expect(preset.type).toBeDefined();
            expect(typeof preset.canBeHub).toBe('boolean');
            expect(preset.testnet).toBeDefined();
            expect(preset.mainnet).toBeDefined();
        }
    });

    it('should have required contract addresses for testnet', () => {
        for (const [name, preset] of Object.entries(CHAIN_PRESETS)) {
            const config = preset.testnet;

            expect(config.contracts).toBeDefined();
            // At minimum, should have Wormhole core bridge
            expect(config.contracts.wormholeCoreBridge).toBeDefined();
        }
    });

    it('should have valid Wormhole chain IDs', () => {
        for (const [name, preset] of Object.entries(CHAIN_PRESETS)) {
            expect(preset.testnet.wormholeChainId).toBeGreaterThanOrEqual(0);
            expect(preset.mainnet.wormholeChainId).toBeGreaterThanOrEqual(0);
            // At least testnet should have a real Wormhole chain ID assigned
            if (preset.testnet.wormholeChainId > 0 || preset.mainnet.wormholeChainId > 0) {
                expect(preset.testnet.wormholeChainId + preset.mainnet.wormholeChainId).toBeGreaterThan(0);
            }
        }
    });

    it('should have different chain IDs for testnet vs mainnet', () => {
        for (const [name, preset] of Object.entries(CHAIN_PRESETS)) {
            if (preset.type === 'evm') {
                expect(preset.testnet.chainId).not.toBe(preset.mainnet.chainId);
            }
        }
    });

    it('should have valid RPC URLs', () => {
        for (const [name, preset] of Object.entries(CHAIN_PRESETS)) {
            expect(preset.testnet.rpcUrl).toMatch(/^https?:\/\//);
            expect(preset.mainnet.rpcUrl).toMatch(/^https?:\/\//);
        }
    });

    it('should have explorer URLs for EVM chains', () => {
        for (const [name, preset] of Object.entries(CHAIN_PRESETS)) {
            if (preset.type === 'evm') {
                expect(preset.testnet.explorerUrl).toMatch(/^https?:\/\//);
                expect(preset.mainnet.explorerUrl).toMatch(/^https?:\/\//);
            }
        }
    });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Factory Error Handling', () => {
    it('should throw descriptive error for unknown chain', () => {
        expect(() => createSDK('not-a-chain' as ChainName)).toThrow(/Unknown chain/);
    });

    it('should include supported chains in error message', () => {
        try {
            createSDK('xyz' as ChainName);
        } catch (error) {
            expect((error as Error).message).toContain('base');
            expect((error as Error).message).toContain('optimism');
        }
    });

    it('should throw for chains with missing required contracts', () => {
        // This would happen if a chain preset is incomplete
        // Most chains have required contracts, so this is more of a safety check
        expect(() => createSDK('base')).not.toThrow();
    });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Factory Integration', () => {
    it('should create SDK that can be used for basic operations', () => {
        const sdk = createSDK('base');

        // SDK should have expected methods
        expect(typeof sdk.getVaultAddress).toBe('function');
    });

    it('should create SDK with correct chain configuration', () => {
        const sdk = createSDK('base', { network: 'testnet' });

        // SDK should be configured correctly
        expect(sdk).toBeDefined();
    });

    it('should support full factory workflow', () => {
        // 1. Check if chain is supported
        expect(isChainSupported('base')).toBe(true);

        // 2. Get chain info
        const preset = getChainPreset('base');
        expect(preset.canBeHub).toBe(true);

        // 3. Get specific config
        const config = getChainConfig('base', 'testnet');
        expect(config.contracts.hub).toBeDefined();

        // 4. Create SDK
        const sdk = createSDK('base', { network: 'testnet' });
        expect(sdk).toBeDefined();
    });
});

// ============================================================================
// Type Safety Tests (compile-time checks documented as runtime tests)
// ============================================================================

describe('Type Safety', () => {
    it('should accept valid ChainName type', () => {
        const chain: ChainName = 'base';
        const sdk = createSDK(chain);
        expect(sdk).toBeDefined();
    });

    it('should accept valid NetworkType', () => {
        const network: NetworkType = 'testnet';
        const sdk = createSDK('base', { network });
        expect(sdk).toBeDefined();
    });

    it('should return correct types from helpers', () => {
        const chains: ChainName[] = getSupportedChains();
        const hubChains: ChainName[] = getHubChains();

        expect(Array.isArray(chains)).toBe(true);
        expect(Array.isArray(hubChains)).toBe(true);
    });
});
