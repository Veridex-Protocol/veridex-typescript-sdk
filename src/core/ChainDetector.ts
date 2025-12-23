/**
 * Veridex Protocol SDK - Chain Detector
 *
 * Phase 4: Multi-chain client support helper.
 *
 * Provides:
 * - Chain config lookup (testnet/mainnet)
 * - Auto-configuration for non-EVM ChainClient instances
 */

import type { ChainClient, ChainConfig, PasskeyCredential, ChainAddress } from './types.js';
import { TESTNET_CHAINS, MAINNET_CHAINS } from '../constants.js';
import { WalletManager } from './WalletManager.js';
import { SolanaClient } from '../chains/solana/SolanaClient.js';
import { AptosClient } from '../chains/aptos/AptosClient.js';
import { SuiClient } from '../chains/sui/SuiClient.js';
import { StarknetClient } from '../chains/starknet/StarknetClient.js';

export interface ChainDetectorConfig {
    testnet?: boolean;
    rpcUrls?: Record<number, string>;
}

export interface NativeBalanceCapable {
    getNativeBalance(address: string): Promise<bigint>;
}

const NON_EVM_NATIVE_META: Record<number, { symbol: string; name: string; decimals: number }> = {
    1: { symbol: 'SOL', name: 'Solana', decimals: 9 },
    21: { symbol: 'SUI', name: 'Sui', decimals: 9 },
    22: { symbol: 'APT', name: 'Aptos', decimals: 8 },
};

export class ChainDetector {
    private readonly testnet: boolean;
    private readonly rpcUrls: Record<number, string>;
    private readonly walletManager: WalletManager;

    constructor(config: ChainDetectorConfig = {}) {
        this.testnet = config.testnet ?? true;
        this.rpcUrls = config.rpcUrls ?? {};
        this.walletManager = new WalletManager({ cacheAddresses: true, persistToStorage: false });
    }

    getChainConfig(wormholeChainId: number): ChainConfig | undefined {
        const chains = this.testnet ? TESTNET_CHAINS : MAINNET_CHAINS;
        return Object.values(chains).find(c => c.wormholeChainId === wormholeChainId);
    }

    /**
     * Create a chain client for non-EVM chains using repo constants.
     * For EVM, callers should instantiate EVMClient directly (Hub-driven).
     */
    createClient(wormholeChainId: number): ChainClient {
        const chain = this.getChainConfig(wormholeChainId);
        if (!chain) {
            throw new Error(`Unknown chain (wormholeChainId=${wormholeChainId})`);
        }

        const rpcUrl = this.rpcUrls[wormholeChainId] ?? chain.rpcUrl;

        if (chain.isEvm) {
            throw new Error(
                `EVM chain auto-detection is not supported here (wormholeChainId=${wormholeChainId}). ` +
                'Instantiate EVMClient with hubContractAddress/vaultFactory/vaultImplementation explicitly.'
            );
        }

        switch (wormholeChainId) {
            case 1: {
                const programId = chain.contracts.hub;
                if (!programId || !chain.contracts.tokenBridge) {
                    throw new Error('Solana config missing programId/tokenBridge in constants');
                }
                return new SolanaClient({
                    wormholeChainId,
                    rpcUrl,
                    programId,
                    wormholeCoreBridge: chain.contracts.wormholeCoreBridge,
                    tokenBridge: chain.contracts.tokenBridge,
                    network: this.testnet ? 'devnet' : 'mainnet',
                });
            }
            case 22: {
                const moduleAddress = chain.contracts.hub;
                if (!moduleAddress || !chain.contracts.tokenBridge) {
                    throw new Error('Aptos config missing moduleAddress/tokenBridge in constants');
                }
                return new AptosClient({
                    wormholeChainId,
                    rpcUrl,
                    moduleAddress,
                    wormholeCoreBridge: chain.contracts.wormholeCoreBridge,
                    tokenBridge: chain.contracts.tokenBridge,
                    network: this.testnet ? 'testnet' : 'mainnet',
                });
            }
            case 21: {
                const packageId = chain.contracts.hub;
                return new SuiClient({
                    wormholeChainId,
                    rpcUrl,
                    packageId: packageId ?? '',
                    wormholeCoreBridge: chain.contracts.wormholeCoreBridge,
                    tokenBridge: chain.contracts.tokenBridge,
                    network: this.testnet ? 'testnet' : 'mainnet',
                });
            }
            case 50001: {
                // Starknet Sepolia with custom bridge
                const spokeAddress = chain.contracts.hub;
                const bridgeAddress = chain.contracts.wormholeCoreBridge;
                if (!spokeAddress || !bridgeAddress) {
                    throw new Error('Starknet config missing spoke/bridge addresses in constants');
                }
                return new StarknetClient({
                    wormholeChainId,
                    rpcUrl,
                    spokeContractAddress: spokeAddress,
                    bridgeContractAddress: bridgeAddress,
                    network: this.testnet ? 'sepolia' : 'mainnet',
                });
            }
            default:
                throw new Error(
                    `Unsupported non-EVM chain (wormholeChainId=${wormholeChainId}). ` +
                    'Add configuration in ChainDetector.createClient().'
                );
        }
    }

    /**
     * Derive a best-effort vault address for a chain from the passkey credential.
     *
     * - EVM chains: requires vaultFactory/vaultImplementation in constants.
     * - Non-EVM chains: uses WalletManager chain-specific derivation.
     */
    deriveVaultAddress(credential: PasskeyCredential, wormholeChainId: number): ChainAddress | null {
        const chain = this.getChainConfig(wormholeChainId);
        if (!chain) {
            return null;
        }

        if (chain.isEvm) {
            const factory = chain.contracts.vaultFactory;
            const implementation = chain.contracts.vaultImplementation;
            if (!factory || !implementation) {
                return null;
            }

            const address = this.walletManager.computeVaultAddress(credential.keyHash, factory, implementation);
            return {
                wormholeChainId,
                chainName: chain.name,
                address,
                isEvm: true,
                deployed: false,
                derivationType: 'create2',
            };
        }

        // Non-EVM: WalletManager derives using keyHash conventions.
        return {
            wormholeChainId,
            chainName: chain.name,
            address: wormholeChainId === 21 
                ? this.normalizeSuiAddress(credential.keyHash)
                : wormholeChainId === 50001
                ? credential.keyHash  // Starknet uses keyHash directly (felt252)
                : credential.keyHash,
            isEvm: false,
            deployed: false,
            derivationType: wormholeChainId === 1 
                ? 'pda' 
                : wormholeChainId === 22 
                ? 'resource_account' 
                : wormholeChainId === 50001
                ? 'keyHash'
                : 'object',
        };
    }

    getNonEvmNativeTokenMeta(wormholeChainId: number): { symbol: string; name: string; decimals: number } | null {
        return NON_EVM_NATIVE_META[wormholeChainId] ?? null;
    }

    private normalizeSuiAddress(value: string): string {
        const clean = value.replace(/^0x/, '').padStart(64, '0');
        return '0x' + clean;
    }
}

export function createChainDetector(config: ChainDetectorConfig = {}): ChainDetector {
    return new ChainDetector(config);
}
