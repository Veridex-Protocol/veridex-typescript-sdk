/**
 * Veridex Protocol SDK - Constants and Chain Configurations
 */

import type { ChainConfig } from './types.js';

// ============================================================================
// Action Type Constants
// ============================================================================

export const ACTION_TYPES = {
  TRANSFER: 1,
  EXECUTE: 2,
  CONFIG: 3,
  BRIDGE: 4,
} as const;

export const ACTION_TRANSFER = 1;
export const ACTION_EXECUTE = 2;
export const ACTION_CONFIG = 3;
export const ACTION_BRIDGE = 4;

// Protocol version
export const PROTOCOL_VERSION = 1;

// ============================================================================
// Wormhole Chain IDs
// ============================================================================

/**
 * Wormhole Chain IDs organized by network
 * @see https://docs.wormhole.com/wormhole/reference/constants
 */
export const WORMHOLE_CHAIN_IDS = {
  MAINNET: {
    SOLANA: 1,
    ETHEREUM: 2,
    TERRA: 3,
    BSC: 4,
    POLYGON: 5,
    AVALANCHE: 6,
    OASIS: 7,
    ALGORAND: 8,
    AURORA: 9,
    FANTOM: 10,
    KARURA: 11,
    ACALA: 12,
    KLAYTN: 13,
    CELO: 14,
    NEAR: 15,
    MOONBEAM: 16,
    NEON: 17,
    TERRA2: 18,
    INJECTIVE: 19,
    OSMOSIS: 20,
    SUI: 21,
    APTOS: 22,
    ARBITRUM: 23,
    OPTIMISM: 24,
    GNOSIS: 25,
    PYTHNET: 26,
    XPLA: 28,
    BASE: 30,
    SEI: 32,
    ROOTSTOCK: 33,
    SCROLL: 34,
    MANTLE: 35,
    BLAST: 36,
    XLAYER: 37,
    LINEA: 38,
    BERACHAIN: 39,
    SEIEVM: 40,
  },
  TESTNET: {
    SOLANA_DEVNET: 1,
    GOERLI: 2,
    BSC_TESTNET: 4,
    POLYGON_AMOY: 10007,
    AVALANCHE_FUJI: 6,
    FANTOM_TESTNET: 10,
    CELO_ALFAJORES: 14,
    MOONBASE_ALPHA: 16,
    SUI_TESTNET: 21,
    APTOS_TESTNET: 22,
    SEPOLIA: 10002,
    ARBITRUM_SEPOLIA: 10003,
    BASE_SEPOLIA: 10004,
    OPTIMISM_SEPOLIA: 10005,
    HOLESKY: 10006,
    POLYGON_SEPOLIA: 10007,
    SEI_ATLANTIC_2: 10066, // Sei Arctic-1 testnet (EVM)
    STARKNET_SEPOLIA: 50001, // Custom bridge (non-Wormhole, relayer-attested)
  },
} as const;

// Legacy flat exports for backward compatibility
export const WORMHOLE_CHAIN_IDS_FLAT = {
  // Mainnets
  SOLANA: 1,
  ETHEREUM: 2,
  TERRA: 3,
  BSC: 4,
  POLYGON: 5,
  AVALANCHE: 6,
  OASIS: 7,
  ALGORAND: 8,
  AURORA: 9,
  FANTOM: 10,
  KARURA: 11,
  ACALA: 12,
  KLAYTN: 13,
  CELO: 14,
  NEAR: 15,
  MOONBEAM: 16,
  NEON: 17,
  TERRA2: 18,
  INJECTIVE: 19,
  OSMOSIS: 20,
  SUI: 21,
  APTOS: 22,
  ARBITRUM: 23,
  OPTIMISM: 24,
  GNOSIS: 25,
  PYTHNET: 26,
  XPLA: 28,
  BASE: 30,
  SEI: 32,
  ROOTSTOCK: 33,
  SCROLL: 34,
  MANTLE: 35,
  BLAST: 36,
  XLAYER: 37,
  LINEA: 38,
  BERACHAIN: 39,
  SEIEVM: 40,

  // Testnets
  SOLANA_DEVNET: 1,
  GOERLI: 2,
  BSC_TESTNET: 4,
  POLYGON_AMOY: 10007,
  AVALANCHE_FUJI: 6,
  FANTOM_TESTNET: 10,
  CELO_ALFAJORES: 14,
  MOONBASE_ALPHA: 16,
  SUI_TESTNET: 21,
  APTOS_TESTNET: 22,
  ARBITRUM_SEPOLIA: 10003,
  BASE_SEPOLIA: 10004,
  OPTIMISM_SEPOLIA: 10005,
  POLYGON_SEPOLIA: 10007,
  HOLESKY: 10006,
  STARKNET_SEPOLIA: 50001, // Custom bridge (non-Wormhole)
} as const;

// ============================================================================
// Testnet Chain Configurations
// ============================================================================

export const TESTNET_CHAINS: Record<string, ChainConfig> = {
  baseSepolia: {
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
  ethereumSepolia: {
    name: 'Ethereum Sepolia',
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
  optimismSepolia: {
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
  arbitrumSepolia: {
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
  monadTestnet: {
    name: 'Monad Testnet',
    chainId: 10143,
    wormholeChainId: 10048,
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    explorerUrl: 'https://testnet.monadexplorer.com',
    isEvm: true,
    contracts: {
      vaultFactory: '0xbE9B9c39956448DA75Ac97E5e3dE17e34171660A',
      vaultImplementation: '0x500853DCc54Fd1A707ec9d443032Bb7748f426d3',
      wormholeCoreBridge: '0xBB73cB66C26740F31d1FabDC6b7A46a038A300dd',
      tokenBridge: '0x0000000000000000000000000000000000000000',
    },
  },
  avalancheFuji: {
    name: 'Avalanche Fuji',
    chainId: 43113,
    wormholeChainId: 6,
    rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
    explorerUrl: 'https://testnet.snowtrace.io',
    isEvm: true,
    contracts: {
      vaultFactory: '0x9e9716442e908A9b61F11432cC38024DD390cd2a',
      vaultImplementation: '0xE0b9919ffDf3415355Db369C8FfA5Dd4e000052c',
      wormholeCoreBridge: '0x7bbcE28e64B3F8b84d876Ab298393c38ad7aac4C',
      tokenBridge: '0x61E44E506Ca5659E6c0bba9b678586fA2d729756',
    },
  },
  polygonAmoy: {
    name: 'Polygon Amoy',
    chainId: 80002,
    wormholeChainId: 10007,
    rpcUrl: 'https://rpc-amoy.polygon.technology',
    explorerUrl: 'https://amoy.polygonscan.com',
    isEvm: true,
    contracts: {
      vaultFactory: '0x07F608AFf6d63b68029488b726d895c4Bb593038',
      vaultImplementation: '0xD66153fccFB6731fB6c4944FbD607ba86A76a1f6',
      wormholeCoreBridge: '0x6b9C8671cdDC8dEab9c719bB87cBd3e782bA6a35',
      tokenBridge: '0xC7A204bDBFe983FCD8d8E61D02b475D4073fF97e',
    },
  },
  solanaDevnet: {
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
  aptosTestnet: {
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
  suiTestnet: {
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
  starknetSepolia: {
    name: 'Starknet Sepolia',
    chainId: 0,
    wormholeChainId: 50001,
    rpcUrl: 'https://starknet-sepolia-rpc.publicnode.com',
    explorerUrl: 'https://sepolia.starkscan.co',
    isEvm: false,
    contracts: {
      hub: '0x7bb7cbe7d82e910b296611b582035a207343431f98bdd7b692bddfdd6f28737',
      wormholeCoreBridge: '0x30d2e7f26dc75819cfddcd7caa26a76b681d5918f219c99060c42ce1e3f69e4',
    },
    hubChainId: 10004,
  },
};

// ============================================================================
// Mainnet Chain Configurations
// ============================================================================

export const MAINNET_CHAINS: Record<string, ChainConfig> = {
  ethereum: {
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
  base: {
    name: 'Base',
    chainId: 8453,
    wormholeChainId: 30,
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    isEvm: true,
    contracts: {
      wormholeCoreBridge: '0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6',
      tokenBridge: '0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627',
    },
  },
  optimism: {
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
  arbitrum: {
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
  polygon: {
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
  solana: {
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
  aptos: {
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
  sui: {
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
};

// ============================================================================
// Wormhole API Endpoints
// ============================================================================

export const WORMHOLE_API = {
  MAINNET: 'https://api.wormholescan.io',
  TESTNET: 'https://api.testnet.wormholescan.io',
  GUARDIAN_RPC_MAINNET: 'https://wormhole-v2-mainnet-api.certus.one',
  GUARDIAN_RPC_TESTNET: 'https://wormhole-v2-testnet-api.certus.one',
} as const;

// ============================================================================
// Hub Contract ABI (minimal)
// ============================================================================

export const HUB_ABI = [
  'function authenticateAndDispatch((bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, uint16 targetChain, bytes actionPayload) external payable returns (uint64 sequence)',
  'function authenticateRawAndDispatch(uint256 r, uint256 s, bytes32 messageHash, uint256 publicKeyX, uint256 publicKeyY, uint16 targetChain, bytes actionPayload, uint256 nonce) external payable returns (uint64 sequence)',
  'function userNonces(bytes32 userKeyHash) external view returns (uint256)',
  'function encodeTransferAction(address token, address recipient, uint256 amount) external pure returns (bytes)',
  'function encodeExecuteAction(address target, uint256 value, bytes data) external pure returns (bytes)',
  'function encodeBridgeAction(bytes32 token, uint256 amount, uint16 targetChain, bytes32 recipient) external pure returns (bytes)',
  'function messageFee() external view returns (uint256)',
  'event Dispatched(bytes32 indexed userKeyHash, uint16 targetChain, uint256 nonce, uint64 sequence, bytes actionPayload)',
] as const;

// ============================================================================
// Vault Factory ABI (minimal)
// ============================================================================

export const VAULT_FACTORY_ABI = [
  'function createVault(bytes32 userKeyHash) external returns (address)',
  'function getVault(bytes32 userKeyHash) external view returns (address)',
  'function vaultExists(bytes32 userKeyHash) external view returns (bool)',
  'event VaultCreated(bytes32 indexed userKeyHash, address vault)',
] as const;

// ============================================================================
// Vault ABI (minimal)
// ============================================================================

export const VAULT_ABI = [
  'function execute(address target, uint256 value, bytes data) external returns (bytes)',
  'function executeFromHub(bytes32 vaaHash, uint16 emitterChain, bytes32 emitterAddress, bytes payload) external',
  'function owner() external view returns (bytes32)',
  'function hub() external view returns (address)',
  'receive() external payable',
] as const;
