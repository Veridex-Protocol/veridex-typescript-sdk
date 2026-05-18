/**
 * Veridex Protocol SDK - Chain Presets
 * 
 * Pre-configured chain settings for easy SDK initialization.
 * Developers only need to specify chain name and network type.
 * 
 * @example
 * ```typescript
 * import { createSDK } from '@veridex/sdk';
 * 
 * // Simple initialization - testnet by default
 * const sdk = await createSDK('base');
 * 
 * // Or specify mainnet
 * const mainnetSdk = await createSDK('base', { network: 'mainnet' });
 * ```
 */

import type { ChainConfig } from './types.js';
import { isMultiHubEnabled, getEffectivePrimaryHub } from './featureFlags.js';

// ============================================================================
// Supported Chain Names
// ============================================================================

/**
 * All supported chain names for easy reference
 */
export const CHAIN_NAMES = {
  // EVM L2s (Hub-capable)
  BASE: 'base',
  OPTIMISM: 'optimism',
  ARBITRUM: 'arbitrum',
  SCROLL: 'scroll',
  BLAST: 'blast',
  MANTLE: 'mantle',
  
  // EVM L1s
  ETHEREUM: 'ethereum',
  POLYGON: 'polygon',
  BSC: 'bsc',
  AVALANCHE: 'avalanche',
  FANTOM: 'fantom',
  CELO: 'celo',
  MOONBEAM: 'moonbeam',
  
  // EVM L1s (High Performance)
  MONAD: 'monad',
  
  // Non-EVM
  SOLANA: 'solana',
  APTOS: 'aptos',
  SUI: 'sui',
  STARKNET: 'starknet',
  STACKS: 'stacks',
  NEAR: 'near',
  SEI: 'sei',
} as const;

export type ChainName = typeof CHAIN_NAMES[keyof typeof CHAIN_NAMES];
export type NetworkType = 'mainnet' | 'testnet';

// ============================================================================
// Chain Preset Interface
// ============================================================================

export interface ChainPreset {
  /** Human-readable chain name */
  displayName: string;
  /** Chain type for client selection */
  type: 'evm' | 'solana' | 'aptos' | 'sui' | 'starknet' | 'stacks' | 'near' | 'cosmos';
  /** Whether this chain can be a hub */
  canBeHub: boolean;
  /** Testnet configuration */
  testnet: ChainConfig;
  /** Mainnet configuration */
  mainnet: ChainConfig;
}

// ============================================================================
// EVM Chain Presets
// ============================================================================

export const CHAIN_PRESETS: Record<ChainName, ChainPreset> = {
  // ────────────────────────────────────────────────────────────────────────
  // BASE - Primary Hub Chain
  // ────────────────────────────────────────────────────────────────────────
  base: {
    displayName: 'Base',
    type: 'evm',
    canBeHub: true,
    testnet: {
      name: 'Base Sepolia',
      chainId: 84532,
      wormholeChainId: 10004,
      rpcUrl: 'https://sepolia.base.org',
      explorerUrl: 'https://sepolia.basescan.org',
      isEvm: true,
      contracts: {
        hub: '0xD5D29b6EaeE6FF4b765e704298a7e48D22607059',
        vaultFactory: '0xb25b73D5FeD5693dcd1Bb78f8e33387B59A022EC',
        vaultImplementation: '0x2CB8397df988c1880d9e5cFfF65bfC22D7D90EE6',
        wormholeCoreBridge: '0x79A1027a6A159502049F10906D333EC57E95F083',
        tokenBridge: '0x86F55A04690fd7815A3D802bD587e83eA888B239',
      },
    },
    mainnet: {
      name: 'Base',
      chainId: 8453,
      wormholeChainId: 30,
      rpcUrl: 'https://mainnet.base.org',
      explorerUrl: 'https://basescan.org',
      isEvm: true,
      contracts: {
        // TODO: Deploy mainnet contracts
        wormholeCoreBridge: '0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6',
        tokenBridge: '0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // OPTIMISM - Secondary Hub / Spoke
  // ────────────────────────────────────────────────────────────────────────
  optimism: {
    displayName: 'Optimism',
    type: 'evm',
    canBeHub: true,
    testnet: {
      name: 'Optimism Sepolia',
      chainId: 11155420,
      wormholeChainId: 10005,
      rpcUrl: 'https://sepolia.optimism.io',
      explorerUrl: 'https://sepolia-optimism.etherscan.io',
      isEvm: true,
      contracts: {
        vaultFactory: '0x3c5e4aCdC8Cd53ae5ae603B4c511885191fBb868',
        vaultImplementation: '0xA45dBF322c5A3028687fEEB161603d3BCe02e119',
        wormholeCoreBridge: '0x31377888146f3253211EFEf5c676D41ECe7D58Fe',
        tokenBridge: '0x99737Ec4B815d816c49A385943baf0380e75c0Ac',
      },
    },
    mainnet: {
      name: 'Optimism',
      chainId: 10,
      wormholeChainId: 24,
      rpcUrl: 'https://mainnet.optimism.io',
      explorerUrl: 'https://optimistic.etherscan.io',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0xEe91C335eab126dF5fDB3797EA9d6aD93aeC9722',
        tokenBridge: '0x1D68124e65faFC907325e3EDbF8c4d84499DAa8b',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // ARBITRUM
  // ────────────────────────────────────────────────────────────────────────
  arbitrum: {
    displayName: 'Arbitrum',
    type: 'evm',
    canBeHub: true,
    testnet: {
      name: 'Arbitrum Sepolia',
      chainId: 421614,
      wormholeChainId: 10003,
      rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
      explorerUrl: 'https://sepolia.arbiscan.io',
      isEvm: true,
      contracts: {
        vaultFactory: '0xB9C3e6bad3c6f26956be4a4bb5a366376Fd3045D',
        vaultImplementation: '0x8601881b94B68B09b485f407317686103d3CB681',
        wormholeCoreBridge: '0x6b9C8671cdDC8dEab9c719bB87cBd3e782bA6a35',
        tokenBridge: '0xC7A204bDBFe983FCD8d8E61D02b475D4073fF97e',
      },
    },
    mainnet: {
      name: 'Arbitrum',
      chainId: 42161,
      wormholeChainId: 23,
      rpcUrl: 'https://arb1.arbitrum.io/rpc',
      explorerUrl: 'https://arbiscan.io',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0xa5f208e072434bC67592E4C49C1B991BA79BCA46',
        tokenBridge: '0x0b2402144Bb366A632D14B83F244D2e0e21bD39c',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // ETHEREUM
  // ────────────────────────────────────────────────────────────────────────
  ethereum: {
    displayName: 'Ethereum',
    type: 'evm',
    canBeHub: false,
    testnet: {
      name: 'Sepolia',
      chainId: 11155111,
      wormholeChainId: 10002,
      rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
      explorerUrl: 'https://sepolia.etherscan.io',
      isEvm: true,
      contracts: {
        vaultFactory: '0x265c10763B4d16AD970bC3d7670c645e37f63AF4',
        vaultImplementation: '0x942426C94652ebC48f4f404928016B95ADb1DA25',
        wormholeCoreBridge: '0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78',
        tokenBridge: '0xDB5492265f6038831E89f495670FF909aDe94bd9',
      },
    },
    mainnet: {
      name: 'Ethereum',
      chainId: 1,
      wormholeChainId: 2,
      rpcUrl: 'https://eth.llamarpc.com',
      explorerUrl: 'https://etherscan.io',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
        tokenBridge: '0x3ee18B2214AFF97000D974cf647E7C347E8fa585',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // POLYGON
  // ────────────────────────────────────────────────────────────────────────
  polygon: {
    displayName: 'Polygon',
    type: 'evm',
    canBeHub: false,
    testnet: {
      name: 'Polygon Amoy',
      chainId: 80002,
      wormholeChainId: 10007,
      rpcUrl: 'https://rpc-amoy.polygon.technology',
      explorerUrl: 'https://amoy.polygonscan.com',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0x0CBE91CF822c73C2315FB05100C2F714765d5c20',
        tokenBridge: '0x0290FB167208Af455bB137780163b7B7a9a10C16',
      },
    },
    mainnet: {
      name: 'Polygon',
      chainId: 137,
      wormholeChainId: 5,
      rpcUrl: 'https://polygon-rpc.com',
      explorerUrl: 'https://polygonscan.com',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0x7A4B5a56256163F07b2C80A7cA55aBE66c4ec4d7',
        tokenBridge: '0x5a58505a96D1dbf8dF91cB21B54419FC36e93fdE',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // BSC
  // ────────────────────────────────────────────────────────────────────────
  bsc: {
    displayName: 'BNB Chain',
    type: 'evm',
    canBeHub: false,
    testnet: {
      name: 'BSC Testnet',
      chainId: 97,
      wormholeChainId: 4,
      rpcUrl: 'https://data-seed-prebsc-1-s1.binance.org:8545',
      explorerUrl: 'https://testnet.bscscan.com',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0x68605AD7b15c732a30b1BbC62BE8F2A509D74b4D',
        tokenBridge: '0x9dcF9D205C9De35334D646BeE44b2D2859712A09',
      },
    },
    mainnet: {
      name: 'BNB Chain',
      chainId: 56,
      wormholeChainId: 4,
      rpcUrl: 'https://bsc-dataseed.binance.org',
      explorerUrl: 'https://bscscan.com',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
        tokenBridge: '0xB6F6D86a8f9879A9c87f643768d9efc38c1Da6E7',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AVALANCHE — ACP-204 Native P-256 + ICM Teleporter + Hub-Capable
  // ────────────────────────────────────────────────────────────────────────
  avalanche: {
    displayName: 'Avalanche',
    type: 'evm',
    canBeHub: true, // ACP-204 provides native P-256 at 0x0100 (6,900 gas)
    testnet: {
      name: 'Avalanche Fuji',
      chainId: 43113,
      wormholeChainId: 6,
      rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
      explorerUrl: 'https://testnet.snowtrace.io',
      isEvm: true,
      contracts: {
        // Veridex Hub (deployed via deploy-avalanche.ts)
        hub: '', // No Hub on Fuji — Hub is on Base Sepolia
        vaultFactory: '0x9e9716442e908A9b61F11432cC38024DD390cd2a',
        vaultImplementation: '0xE0b9919ffDf3415355Db369C8FfA5Dd4e000052c',
        // Wormhole bridges (canonical Fuji addresses)
        wormholeCoreBridge: '0x7bbcE28e64B3F8b84d876Ab298393c38ad7aac4C',
        tokenBridge: '0x61E44E506Ca5659E6c0bba9b678586fA2d729756',
        // Avalanche-specific: ACP-204 P-256 verifier wrapper
        p256Verifier: '0xB5d29EA1E2e90A24D6506E2a6a269506a12974CC',
        // Avalanche-specific: ICM Spoke for cross-L1 session bridging
        icmSpoke: '0x9fCFC608086539A69839EfA9628884dB75ac07D0',
        // Chainlink price feeds (Fuji testnet)
        chainlinkAvaxUsd: '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD',
        chainlinkUsdcUsd: '0x7898AcCC83587C3C55116c5230C17a6Cd9C71bad',
        chainlinkUsdtUsd: '0x7898AcCC83587C3C55116c5230C17a6Cd9C71bad',
      },
      hubChainId: 10004, // Base Sepolia (primary Hub)
    },
    mainnet: {
      name: 'Avalanche',
      chainId: 43114,
      wormholeChainId: 6,
      rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
      explorerUrl: 'https://snowtrace.io',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0x54a8e5f9c4CbA08F9943965859F6c34eAF03E26c',
        tokenBridge: '0x0e082F06FF657D94310cB8cE8B0D9a04541d8052',
        // Chainlink price feeds (Avalanche mainnet)
        chainlinkAvaxUsd: '0x0A77230d17318075983913bC2145DB16C7366156',
        chainlinkUsdcUsd: '0xF096872672F44d6EBA71458D74fe67F9a77a23B9',
        chainlinkUsdtUsd: '0xEBE676ee90Fe1112671f19b6B7459bC678B67e8a',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // SCROLL
  // ────────────────────────────────────────────────────────────────────────
  scroll: {
    displayName: 'Scroll',
    type: 'evm',
    canBeHub: false,
    testnet: {
      name: 'Scroll Sepolia',
      chainId: 534351,
      wormholeChainId: 34,
      rpcUrl: 'https://sepolia-rpc.scroll.io',
      explorerUrl: 'https://sepolia.scrollscan.com',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0x055F47F1250012C6B20c436570a76e52c17Af2D5',
        tokenBridge: '0x22427d90B7dA3fA4642F7025A854c7254E4e45BF',
      },
    },
    mainnet: {
      name: 'Scroll',
      chainId: 534352,
      wormholeChainId: 34,
      rpcUrl: 'https://rpc.scroll.io',
      explorerUrl: 'https://scrollscan.com',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6',
        tokenBridge: '0x24850c6f61C438823F01B7A3BF2B89B72174Fa9d',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // BLAST
  // ────────────────────────────────────────────────────────────────────────
  blast: {
    displayName: 'Blast',
    type: 'evm',
    canBeHub: false,
    testnet: {
      name: 'Blast Sepolia',
      chainId: 168587773,
      wormholeChainId: 36,
      rpcUrl: 'https://sepolia.blast.io',
      explorerUrl: 'https://sepolia.blastscan.io',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0x473e002D7add6fB67a4964F13bFd61280Ca46886',
        tokenBridge: '0x430855B4D43b8AEB9D2B9869B74d58dda79C0dB2',
      },
    },
    mainnet: {
      name: 'Blast',
      chainId: 81457,
      wormholeChainId: 36,
      rpcUrl: 'https://rpc.blast.io',
      explorerUrl: 'https://blastscan.io',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6',
        tokenBridge: '0x24850c6f61C438823F01B7A3BF2B89B72174Fa9d',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // MANTLE
  // ────────────────────────────────────────────────────────────────────────
  mantle: {
    displayName: 'Mantle',
    type: 'evm',
    canBeHub: false,
    testnet: {
      name: 'Mantle Sepolia',
      chainId: 5003,
      wormholeChainId: 35,
      rpcUrl: 'https://rpc.sepolia.mantle.xyz',
      explorerUrl: 'https://sepolia.mantlescan.xyz',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0x376428e7f26D5867e69201b275553C45B09EE090',
        tokenBridge: '0x75Bfa155a9D7A3714b0861c8a8aF0C4633c45b5D',
      },
    },
    mainnet: {
      name: 'Mantle',
      chainId: 5000,
      wormholeChainId: 35,
      rpcUrl: 'https://rpc.mantle.xyz',
      explorerUrl: 'https://mantlescan.xyz',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6',
        tokenBridge: '0x24850c6f61C438823F01B7A3BF2B89B72174Fa9d',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // FANTOM
  // ────────────────────────────────────────────────────────────────────────
  fantom: {
    displayName: 'Fantom',
    type: 'evm',
    canBeHub: false,
    testnet: {
      name: 'Fantom Testnet',
      chainId: 4002,
      wormholeChainId: 10,
      rpcUrl: 'https://rpc.testnet.fantom.network',
      explorerUrl: 'https://testnet.ftmscan.com',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0x1BB3B4119b7BA9dfad76B0545fb3F531383c3bB7',
        tokenBridge: '0x599CEa2204B4FaECd584Ab1F2b6aCA137a0afbE8',
      },
    },
    mainnet: {
      name: 'Fantom',
      chainId: 250,
      wormholeChainId: 10,
      rpcUrl: 'https://rpcapi.fantom.network',
      explorerUrl: 'https://ftmscan.com',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0x126783A6Cb203a3E35344528B26ca3a0489a1485',
        tokenBridge: '0x7C9Fc5741288cDFdD83CeB07f3ea7e22618D79D2',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // CELO
  // ────────────────────────────────────────────────────────────────────────
  celo: {
    displayName: 'Celo',
    type: 'evm',
    canBeHub: false,
    testnet: {
      name: 'Celo Alfajores',
      chainId: 44787,
      wormholeChainId: 14,
      rpcUrl: 'https://alfajores-forno.celo-testnet.org',
      explorerUrl: 'https://alfajores.celoscan.io',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0x88505117CA88e7dd2eC6EA1E13f0948db2D50D56',
        tokenBridge: '0x05ca6037eC51F8b712eD2E6Fa72219FEaE74E153',
      },
    },
    mainnet: {
      name: 'Celo',
      chainId: 42220,
      wormholeChainId: 14,
      rpcUrl: 'https://forno.celo.org',
      explorerUrl: 'https://celoscan.io',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0xa321448d90d4e5b0A732867c18eA198e75CAC48E',
        tokenBridge: '0x796Dff6D74F3E27060B71255Fe517BFb23C93eed',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // MOONBEAM
  // ────────────────────────────────────────────────────────────────────────
  moonbeam: {
    displayName: 'Moonbeam',
    type: 'evm',
    canBeHub: false,
    testnet: {
      name: 'Moonbase Alpha',
      chainId: 1287,
      wormholeChainId: 16,
      rpcUrl: 'https://rpc.api.moonbase.moonbeam.network',
      explorerUrl: 'https://moonbase.moonscan.io',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0xa5B7D85a8f27dd7907dc8FdC21FA5657D5E2F901',
        tokenBridge: '0xbc976D4b9D57E57c3cA52e1Fd136C45FF7955A96',
      },
    },
    mainnet: {
      name: 'Moonbeam',
      chainId: 1284,
      wormholeChainId: 16,
      rpcUrl: 'https://rpc.api.moonbeam.network',
      explorerUrl: 'https://moonscan.io',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0xC8e2b0cD52Cf01b0Ce87d389Daa3d414d4cE29f3',
        tokenBridge: '0xb1731c586ca89a23809861c6103F0b96B3F57D92',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // MONAD - High-Performance L1 with EIP-7951 P256 + Agent Gateway
  // ────────────────────────────────────────────────────────────────────────
  monad: {
    displayName: 'Monad',
    type: 'evm',
    canBeHub: true, // Has native P-256 precompile (EIP-7951)
    testnet: {
      name: 'Monad Testnet',
      chainId: 10143,
      wormholeChainId: 10048,
      rpcUrl: 'https://testnet-rpc.monad.xyz',
      explorerUrl: 'https://testnet.monadvision.com',
      isEvm: true,
      contracts: {
        vaultFactory: '0x50F2c37584823A6cc293bd0d7647D558d05CA4C1',
        vaultImplementation: '0x53d4D3943d0E524836f0B1955AbB216449F538fF',
        wormholeCoreBridge: '0xBB73cB66C26740F31d1FabDC6b7A46a038A300dd',
        // Agent Gateway contracts
        serviceDirectory: '0x2d20f29E1f5B24294B3F125B47f2a22a7012a35E',
      },
      hubChainId: 10004, // Base Sepolia
    },
    mainnet: {
      name: 'Monad',
      chainId: 143,
      wormholeChainId: 0, // TBD
      rpcUrl: 'https://rpc.monad.xyz',
      explorerUrl: 'https://monadscan.com',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0x194B123c5E96B9b2E49763619985790Dc241CAC0',
        tokenBridge: '0x0B2719cdA2F10595369e6673ceA3Ee2EDFa13BA7',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // SEI
  // ────────────────────────────────────────────────────────────────────────
  sei: {
    displayName: 'Sei',
    type: 'evm',
    canBeHub: false,
    testnet: {
      name: 'Sei Atlantic-2',
      chainId: 1328,
      wormholeChainId: 40,
      rpcUrl: 'https://evm-rpc-testnet.sei-apis.com',
      explorerUrl: 'https://seitrace.com/?chain=atlantic-2',
      isEvm: true,
      contracts: {
        vaultFactory: '0x07F608AFf6d63b68029488b726d895c4Bb593038',
        vaultImplementation: '0xD66153fccFB6731fB6c4944FbD607ba86A76a1f6',
        wormholeCoreBridge: '0x0000000000000000000000000000000000000000',
      },
    },
    mainnet: {
      name: 'Sei',
      chainId: 1329,
      wormholeChainId: 32,
      rpcUrl: 'https://evm-rpc.sei-apis.com',
      explorerUrl: 'https://seitrace.com',
      isEvm: true,
      contracts: {
        wormholeCoreBridge: '0x0000000000000000000000000000000000000000',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // SOLANA
  // ────────────────────────────────────────────────────────────────────────
  solana: {
    displayName: 'Solana',
    type: 'solana',
    canBeHub: false,
    testnet: {
      name: 'Solana Devnet',
      chainId: 0,
      wormholeChainId: 1,
      rpcUrl: 'https://api.devnet.solana.com',
      explorerUrl: 'https://explorer.solana.com',
      isEvm: false,
      contracts: {
        hub: '64ZZBdmGd1YT6Fok7PELvAdfoXyR4PHxHnRqHNqZHJ13',
        wormholeCoreBridge: '3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5',
        tokenBridge: 'DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe',
      },
    },
    mainnet: {
      name: 'Solana',
      chainId: 0,
      wormholeChainId: 1,
      rpcUrl: 'https://api.mainnet-beta.solana.com',
      explorerUrl: 'https://explorer.solana.com',
      isEvm: false,
      contracts: {
        wormholeCoreBridge: 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',
        tokenBridge: 'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // APTOS
  // ────────────────────────────────────────────────────────────────────────
  aptos: {
    displayName: 'Aptos',
    type: 'aptos',
    canBeHub: false,
    testnet: {
      name: 'Aptos Testnet',
      chainId: 0,
      wormholeChainId: 22,
      rpcUrl: 'https://fullnode.testnet.aptoslabs.com/v1',
      explorerUrl: 'https://explorer.aptoslabs.com',
      isEvm: false,
      contracts: {
        hub: '0x9e8641143245ab8b93af1417a1fbc698d40fd351a25f6c17e4210e59bf82c9c7',
        wormholeCoreBridge: '0x5bc11445584a763c1fa7ed39081f1b920954da14e04b32440cba863d03e19625',
        tokenBridge: '0x576410486a2da45eee6c949c995670112ddf2fbeedab20350d506328eefc9d4f',
      },
    },
    mainnet: {
      name: 'Aptos',
      chainId: 0,
      wormholeChainId: 22,
      rpcUrl: 'https://fullnode.mainnet.aptoslabs.com/v1',
      explorerUrl: 'https://explorer.aptoslabs.com',
      isEvm: false,
      contracts: {
        wormholeCoreBridge: '0x5bc11445584a763c1fa7ed39081f1b920954da14e04b32440cba863d03e19625',
        tokenBridge: '0x576410486a2da45eee6c949c995670112ddf2fbeedab20350d506328eefc9d4f',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // SUI
  // ────────────────────────────────────────────────────────────────────────
  sui: {
    displayName: 'Sui',
    type: 'sui',
    canBeHub: false,
    testnet: {
      name: 'Sui Testnet',
      chainId: 0,
      wormholeChainId: 21,
      rpcUrl: 'https://fullnode.testnet.sui.io:443',
      explorerUrl: 'https://suiscan.xyz/testnet',
      isEvm: false,
      contracts: {
        hub: '0xaf36d8bc349883b23e78b00a342a656c799319508600583eaee9121ffaa7f5f7',
        wormholeCoreBridge: '0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790',
      },
    },
    mainnet: {
      name: 'Sui',
      chainId: 0,
      wormholeChainId: 21,
      rpcUrl: 'https://fullnode.mainnet.sui.io:443',
      explorerUrl: 'https://suiscan.xyz/mainnet',
      isEvm: false,
      contracts: {
        wormholeCoreBridge: '0xaeab97f96cf9877fee2883315d459552b2b921edc16d7ceac6eab944dd88919c',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // STARKNET
  // ────────────────────────────────────────────────────────────────────────
  starknet: {
    displayName: 'Starknet',
    type: 'starknet',
    canBeHub: false,
    testnet: {
      name: 'Starknet Sepolia',
      chainId: 0,
      wormholeChainId: 50001, // Custom bridge (non-Wormhole)
      rpcUrl: 'https://starknet-sepolia-rpc.publicnode.com',
      explorerUrl: 'https://sepolia.starkscan.co',
      isEvm: false,
      contracts: {
        hub: '0x7bb7cbe7d82e910b296611b582035a207343431f98bdd7b692bddfdd6f28737',
        wormholeCoreBridge: '0x30d2e7f26dc75819cfddcd7caa26a76b681d5918f219c99060c42ce1e3f69e4',
      },
      hubChainId: 10004, // Base Sepolia
    },
    mainnet: {
      name: 'Starknet',
      chainId: 0,
      wormholeChainId: 50001,
      rpcUrl: 'https://starknet-mainnet.public.blastapi.io/rpc/v0_7',
      explorerUrl: 'https://starkscan.co',
      isEvm: false,
      contracts: {
        // TODO: Deploy mainnet contracts
        wormholeCoreBridge: '',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // STACKS
  // ────────────────────────────────────────────────────────────────────────
  stacks: {
    displayName: 'Stacks',
    type: 'stacks',
    canBeHub: false,
    testnet: {
      name: 'Stacks Testnet',
      chainId: 2147483648, // CAIP-2: stacks:2147483648
      wormholeChainId: 60, // Official Wormhole chain ID for Stacks
      rpcUrl: 'https://api.testnet.hiro.so',
      explorerUrl: 'https://explorer.hiro.so/?chain=testnet',
      isEvm: false,
      contracts: {
        // Spoke contract: identity + session management
        hub: 'STWJ9E8J5NPKB4MT1378G6XWNFGAKRY1E6D6PYSM.veridex-spoke',
        // Vault contract: STX/sBTC custody
        vaultFactory: 'STWJ9E8J5NPKB4MT1378G6XWNFGAKRY1E6D6PYSM.veridex-vault',
        wormholeCoreBridge: '',
        // Phase 2: Wormhole integration contracts
        wormholeVerifier: 'STWJ9E8J5NPKB4MT1378G6XWNFGAKRY1E6D6PYSM.veridex-wormhole-verifier',
        vaultVaa: 'STWJ9E8J5NPKB4MT1378G6XWNFGAKRY1E6D6PYSM.veridex-vault-vaa',
      },
      hubChainId: 10004, // Base Sepolia
    },
    mainnet: {
      name: 'Stacks',
      chainId: 1, // CAIP-2: stacks:1
      wormholeChainId: 60,
      rpcUrl: 'https://api.hiro.so',
      explorerUrl: 'https://explorer.hiro.so',
      isEvm: false,
      contracts: {
        // TODO: Deploy mainnet contracts
        wormholeCoreBridge: '',
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // NEAR
  // ────────────────────────────────────────────────────────────────────────
  near: {
    displayName: 'Near',
    type: 'near',
    canBeHub: false,
    testnet: {
      name: 'Near Testnet',
      chainId: 0,
      wormholeChainId: 15,
      rpcUrl: 'https://rpc.testnet.near.org',
      explorerUrl: 'https://explorer.testnet.near.org',
      isEvm: false,
      contracts: {
        wormholeCoreBridge: 'wormhole.wormhole.testnet',
        tokenBridge: 'token.wormhole.testnet',
      },
    },
    mainnet: {
      name: 'Near',
      chainId: 0,
      wormholeChainId: 15,
      rpcUrl: 'https://rpc.mainnet.near.org',
      explorerUrl: 'https://explorer.near.org',
      isEvm: false,
      contracts: {
        wormholeCoreBridge: 'contract.wormhole_crypto.near',
        tokenBridge: 'contract.portalbridge.near',
      },
    },
  },
};

// ============================================================================
// Custom RPC URL Overrides
// ============================================================================

/**
 * Global RPC URL overrides. Set once at app startup to avoid passing
 * custom URLs to every SDK / client constructor.
 *
 * @example
 * ```typescript
 * import { configureDefaultRpcUrls } from '@veridex/sdk';
 *
 * configureDefaultRpcUrls({
 *   starknet: { testnet: 'https://my-starknet-rpc.example.com' },
 *   base:     { mainnet: 'https://my-base-mainnet.example.com' },
 * });
 * ```
 */
const _rpcOverrides: Partial<Record<ChainName, Partial<Record<NetworkType, string>>>> = {};

/**
 * Configure global default RPC URL overrides.
 * These take precedence over the built-in public endpoints but are
 * themselves overridden by per-SDK `rpcUrl` / `rpcUrls` options.
 *
 * Call with an empty object to clear all overrides.
 */
export function configureDefaultRpcUrls(
  overrides: Partial<Record<ChainName, Partial<Record<NetworkType, string>>>>
): void {
  // Clear existing overrides
  for (const key of Object.keys(_rpcOverrides) as ChainName[]) {
    delete _rpcOverrides[key];
  }
  // Apply new overrides
  Object.assign(_rpcOverrides, overrides);
}

/**
 * Get the current global RPC URL override for a chain + network, if any.
 */
export function getRpcUrlOverride(
  chain: ChainName,
  network: NetworkType
): string | undefined {
  return _rpcOverrides[chain]?.[network];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get chain configuration by name and network.
 *
 * Returns a copy of the built-in config with any global RPC override applied.
 * Per-SDK overrides (`rpcUrl`, `rpcUrls`) still take priority in the factory.
 */
export function getChainConfig(
  chain: ChainName,
  network: NetworkType = 'testnet'
): ChainConfig {
  const preset = CHAIN_PRESETS[chain];
  if (!preset) {
    throw new Error(
      `Unknown chain: "${chain}". Supported chains: ${Object.keys(CHAIN_PRESETS).join(', ')}`
    );
  }
  const config = preset[network];
  const rpcOverride = getRpcUrlOverride(chain, network);
  if (rpcOverride) {
    return { ...config, rpcUrl: rpcOverride };
  }
  return config;
}

/**
 * Get chain preset by name
 */
export function getChainPreset(chain: ChainName): ChainPreset {
  const preset = CHAIN_PRESETS[chain];
  if (!preset) {
    throw new Error(
      `Unknown chain: "${chain}". Supported chains: ${Object.keys(CHAIN_PRESETS).join(', ')}`
    );
  }
  return preset;
}

/**
 * Get all supported chain names
 */
export function getSupportedChains(): ChainName[] {
  return Object.keys(CHAIN_PRESETS) as ChainName[];
}

/**
 * Get hub-capable chains.
 * 
 * When multi-hub feature flag is disabled, returns only the primary hub chain ('base').
 * When enabled, returns all chains with canBeHub: true.
 */
export function getHubChains(): ChainName[] {
  if (!isMultiHubEnabled()) {
    const primary = getEffectivePrimaryHub();
    return [primary];
  }
  return Object.entries(CHAIN_PRESETS)
    .filter(([_, preset]) => preset.canBeHub)
    .map(([name]) => name as ChainName);
}

/**
 * Check if chain is supported
 */
export function isChainSupported(chain: string): chain is ChainName {
  return chain in CHAIN_PRESETS;
}

/**
 * Check if a specific chain is currently acting as a hub.
 * 
 * When multi-hub is disabled, only the primary hub ('base') returns true.
 * When enabled, any chain with canBeHub: true returns true.
 */
export function isHubChain(chain: ChainName): boolean {
  if (!isMultiHubEnabled()) {
    return chain === getEffectivePrimaryHub();
  }
  const preset = CHAIN_PRESETS[chain];
  return preset?.canBeHub ?? false;
}

/**
 * Get default hub chain.
 * 
 * Returns the effective primary hub's config. When multi-hub is disabled,
 * this always returns Base. When enabled, it returns the configured primary hub.
 */
export function getDefaultHub(network: NetworkType = 'testnet'): ChainConfig {
  const primary = getEffectivePrimaryHub();
  return CHAIN_PRESETS[primary][network];
}
