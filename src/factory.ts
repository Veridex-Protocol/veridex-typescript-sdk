/**
 * Veridex Protocol SDK - Simplified Initialization
 * 
 * Factory functions for easy SDK creation with minimal configuration.
 * 
 * @example
 * ```typescript
 * import { createSDK } from '@veridex/sdk';
 * 
 * // Simplest usage - testnet by default
 * const sdk = await createSDK('base');
 * 
 * // Register passkey and start using
 * await sdk.passkey.register('user@example.com', 'My Wallet');
 * const vault = await sdk.getVaultAddress();
 * ```
 */

import { VeridexSDK } from './core/VeridexSDK.js';
import { EVMClient } from './chains/evm/EVMClient.js';
import { AvalancheClient } from './chains/avalanche/AvalancheClient.js';
import { SolanaClient } from './chains/solana/SolanaClient.js';
import { AptosClient } from './chains/aptos/AptosClient.js';
import { SuiClient } from './chains/sui/SuiClient.js';
import { StarknetClient } from './chains/starknet/StarknetClient.js';
import { StacksClient } from './chains/stacks/StacksClient.js';
import {
  CHAIN_PRESETS,
  getChainConfig,
  getChainPreset,
  isHubChain,
  type ChainName,
  type NetworkType,
} from './presets.js';
import { getEffectivePrimaryHub, isMultiHubEnabled } from './featureFlags.js';
import type { ChainClient } from './core/types.js';

// ============================================================================
// Simple Configuration Interface
// ============================================================================

/**
 * Simplified SDK configuration
 * Only specify what you need - everything else has sensible defaults
 */
export interface SimpleSDKConfig {
  /**
   * Network to connect to
   * @default 'testnet'
   */
  network?: NetworkType;

  /**
   * Custom RPC URL (optional - defaults to public endpoints)
   */
  rpcUrl?: string;

  /**
   * Relayer URL for gasless transactions (optional)
   */
  relayerUrl?: string;

  /**
   * Relayer API key (optional)
   */
  relayerApiKey?: string;

  /**
   * Sponsor private key for gasless vault creation (optional)
   * If not provided, users pay their own gas
   */
  sponsorPrivateKey?: string;

  /**
   * Integrator sponsor key (optional)
   * Allows platforms to pay for their users' transactions
   */
  integratorSponsorKey?: string;

  /**
   * Additional RPC URLs for multi-chain operations
   * Maps chain name to RPC URL
   */
  rpcUrls?: Partial<Record<ChainName, string>>;
}

/**
 * Session-specific configuration
 */
export interface SessionConfig {
  /**
   * Chain to use for sessions
   */
  chain: ChainName;

  /**
   * Network to connect to
   * @default 'testnet'
   */
  network?: NetworkType;

  /**
   * Session duration in seconds
   * @default 3600 (1 hour)
   */
  duration?: number;

  /**
   * Maximum value per transaction
   * @default BigInt(1e18) (1 token)
   */
  maxValue?: bigint;

  /**
   * Require user verification for session creation
   * @default true
   */
  requireUV?: boolean;
}

// ============================================================================
// Chain Client Factory
// ============================================================================

/**
 * Create the appropriate chain client based on chain type
 */
function createChainClient(
  chain: ChainName,
  network: NetworkType,
  customRpcUrl?: string
): ChainClient {
  const preset = getChainPreset(chain);
  const config = preset[network];
  const rpcUrl = customRpcUrl || config.rpcUrl;

  const requireString = (value: string | undefined, label: string): string => {
    if (!value) {
      throw new Error(`Missing ${label} for chain "${chain}" on network "${network}"`);
    }
    return value;
  };

  // Avalanche gets its own client with ACP-204 + ICM + Chainlink support
  if ((chain as string) === 'avalanche') {
    return new AvalancheClient({
      chainId: config.chainId,
      wormholeChainId: config.wormholeChainId,
      rpcUrl,
      hubContractAddress: requireString(config.contracts.hub, 'hub contract address'),
      wormholeCoreBridge: requireString(config.contracts.wormholeCoreBridge, 'Wormhole core bridge address'),
      vaultFactory: config.contracts.vaultFactory,
      vaultImplementation: config.contracts.vaultImplementation,
      tokenBridge: config.contracts.tokenBridge,
      name: config.name,
      explorerUrl: config.explorerUrl,
      p256VerifierAddress: (config.contracts as any).p256Verifier,
      icmSpokeAddress: (config.contracts as any).icmSpoke,
      chainlinkAvaxUsdFeed: (config.contracts as any).chainlinkAvaxUsd,
      chainlinkUsdcUsdFeed: (config.contracts as any).chainlinkUsdcUsd,
      chainlinkUsdtUsdFeed: (config.contracts as any).chainlinkUsdtUsd,
    });
  }

  switch (preset.type) {
    case 'evm':
      return new EVMClient({
        chainId: config.chainId,
        wormholeChainId: config.wormholeChainId,
        rpcUrl,
        hubContractAddress: requireString(config.contracts.hub, 'hub contract address'),
        wormholeCoreBridge: requireString(config.contracts.wormholeCoreBridge, 'Wormhole core bridge address'),
        vaultFactory: config.contracts.vaultFactory,
        vaultImplementation: config.contracts.vaultImplementation,
        tokenBridge: config.contracts.tokenBridge,
        name: config.name,
        explorerUrl: config.explorerUrl,
      });

    case 'solana':
      return new SolanaClient({
        rpcUrl,
        programId: requireString(config.contracts.hub, 'programId'),
        wormholeCoreBridge: requireString(config.contracts.wormholeCoreBridge, 'Wormhole core bridge address'),
        tokenBridge: requireString(config.contracts.tokenBridge, 'token bridge address'),
        wormholeChainId: config.wormholeChainId,
        network: network === 'testnet' ? 'devnet' : 'mainnet',
      });

    case 'aptos':
      return new AptosClient({
        rpcUrl,
        moduleAddress: requireString(config.contracts.hub, 'moduleAddress'),
        wormholeCoreBridge: requireString(config.contracts.wormholeCoreBridge, 'Wormhole core bridge address'),
        tokenBridge: requireString(config.contracts.tokenBridge, 'token bridge address'),
        wormholeChainId: config.wormholeChainId,
        network: network,
      });

    case 'sui':
      return new SuiClient({
        rpcUrl,
        packageId: requireString(config.contracts.hub, 'packageId'),
        wormholeCoreBridge: requireString(config.contracts.wormholeCoreBridge, 'Wormhole core bridge address'),
        wormholeChainId: config.wormholeChainId,
        network: network,
      });

    case 'starknet':
      return new StarknetClient({
        rpcUrl,
        spokeContractAddress: config.contracts.hub,
        bridgeContractAddress: config.contracts.wormholeCoreBridge,
        wormholeChainId: config.wormholeChainId,
        network: network === 'testnet' ? 'sepolia' : 'mainnet',
      });

    case 'stacks':
      return new StacksClient({
        rpcUrl,
        spokeContractAddress: config.contracts.hub || undefined,
        wormholeChainId: config.wormholeChainId,
        network: network,
      });

    case 'near':
    case 'cosmos':
      throw new Error(`Chain type "${preset.type}" is not yet supported. Coming soon!`);

    default:
      throw new Error(`Unknown chain type: ${preset.type}`);
  }
}

// ============================================================================
// SDK Factory Functions
// ============================================================================

/**
 * Create a Veridex SDK instance with minimal configuration
 * 
 * @param chain - Chain name (e.g., 'base', 'optimism', 'solana')
 * @param config - Optional configuration overrides
 * @returns Configured VeridexSDK instance
 * 
 * @example
 * ```typescript
 * // Simplest usage - testnet by default
 * const sdk = await createSDK('base');
 * 
 * // Use mainnet
 * const mainnetSdk = await createSDK('base', { network: 'mainnet' });
 * 
 * // With custom RPC
 * const customSdk = await createSDK('base', { 
 *   rpcUrl: 'https://my-rpc.example.com' 
 * });
 * 
 * // With relayer for gasless transactions
 * const gaslessSdk = await createSDK('base', {
 *   relayerUrl: 'https://relayer.veridex.network',
 *   relayerApiKey: 'your-api-key',
 * });
 * ```
 */
export function createSDK(
  chain: ChainName,
  config: SimpleSDKConfig = {}
): VeridexSDK {
  const network = config.network ?? 'testnet';

  // Validate chain exists
  if (!CHAIN_PRESETS[chain]) {
    const supportedChains = Object.keys(CHAIN_PRESETS).join(', ');
    throw new Error(
      `Unknown chain: "${chain}". Supported chains: ${supportedChains}`
    );
  }

  // Create chain client
  const chainClient = createChainClient(chain, network, config.rpcUrl);

  // Build RPC URLs map for multi-chain operations
  const chainRpcUrls: Record<number, string> = {};
  if (config.rpcUrls) {
    for (const [chainName, rpcUrl] of Object.entries(config.rpcUrls)) {
      if (rpcUrl && CHAIN_PRESETS[chainName as ChainName]) {
        const chainConfig = getChainConfig(chainName as ChainName, network);
        chainRpcUrls[chainConfig.wormholeChainId] = rpcUrl;
      }
    }
  }

  // Create SDK
  return new VeridexSDK({
    chain: chainClient,
    testnet: network === 'testnet',
    relayerUrl: config.relayerUrl,
    relayerApiKey: config.relayerApiKey,
    sponsorPrivateKey: config.sponsorPrivateKey,
    integratorSponsorKey: config.integratorSponsorKey,
    chainRpcUrls: Object.keys(chainRpcUrls).length > 0 ? chainRpcUrls : undefined,
  });
}

/**
 * Create SDK for the default hub chain.
 * 
 * When multi-hub is disabled, always creates SDK for Base.
 * When enabled, uses the configured primary hub chain.
 * 
 * @param config - Optional configuration
 * @returns SDK configured for the primary hub chain
 * 
 * @example
 * ```typescript
 * const sdk = createHubSDK();
 * await sdk.passkey.register('user', 'My Wallet');
 * ```
 */
export function createHubSDK(config: SimpleSDKConfig = {}): VeridexSDK {
  const hubChain = getEffectivePrimaryHub();
  return createSDK(hubChain, config);
}

/**
 * Create SDK for testnet (convenience function)
 * 
 * @param chain - Chain name
 * @param config - Optional configuration (network is forced to testnet)
 * @returns SDK configured for testnet
 */
export function createTestnetSDK(
  chain: ChainName = 'base',
  config: Omit<SimpleSDKConfig, 'network'> = {}
): VeridexSDK {
  return createSDK(chain, { ...config, network: 'testnet' });
}

/**
 * Create SDK for mainnet (convenience function)
 * 
 * @param chain - Chain name
 * @param config - Optional configuration (network is forced to mainnet)
 * @returns SDK configured for mainnet
 */
export function createMainnetSDK(
  chain: ChainName = 'base',
  config: Omit<SimpleSDKConfig, 'network'> = {}
): VeridexSDK {
  return createSDK(chain, { ...config, network: 'mainnet' });
}

// ============================================================================
// Session Factory (for Session Keys)
// ============================================================================

/**
 * Create a session-enabled SDK
 * 
 * @param chain - Chain name
 * @param config - Session configuration
 * @returns SDK configured for session key usage
 * 
 * @example
 * ```typescript
 * import { createSessionSDK, SessionManager } from '@veridex/sdk';
 * 
 * const sdk = createSessionSDK('base');
 * const sessionManager = new SessionManager({ sdk });
 * 
 * // Create a session (one passkey auth)
 * const session = await sessionManager.createSession({
 *   duration: 3600,
 *   maxValue: BigInt(1e18),
 * });
 * 
 * // Execute multiple transactions without prompts
 * await sessionManager.executeWithSession(params, session);
 * ```
 */
export function createSessionSDK(
  chain: ChainName = 'base',
  config: SimpleSDKConfig = {}
): VeridexSDK {
  // Sessions require hub chain with session key support
  if (!isHubChain(chain)) {
    const hubChain = getEffectivePrimaryHub();
    console.warn(
      `Chain "${chain}" is not an active hub chain. ` +
      `Consider using "${hubChain}" for full session capabilities.` +
      (isMultiHubEnabled() ? '' : ' Enable multi-hub to use other hub-capable chains.')
    );
  }

  return createSDK(chain, config);
}

// ============================================================================
// Type Exports
// ============================================================================

export type { ChainName, NetworkType } from './presets.js';
export {
  CHAIN_NAMES,
  CHAIN_PRESETS,
  getChainConfig,
  getChainPreset,
  getSupportedChains,
  getHubChains,
  isChainSupported,
  isHubChain,
  getDefaultHub,
} from './presets.js';

// Feature Flags
export {
  getFeatureFlags,
  setFeatureFlags,
  resetFeatureFlags,
  isMultiHubEnabled,
  getEffectivePrimaryHub,
} from './featureFlags.js';
export type { FeatureFlags } from './featureFlags.js';
