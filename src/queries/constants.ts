export const WORMHOLE_QUERY_PROXY_URLS = {
  mainnet: 'https://query.wormhole.com/v1/query',
  testnet: 'https://testnet.query.wormhole.com/v1/query',
} as const;

/**
 * Convenience set of Wormhole chain IDs commonly supported by Queries.
 * This is not an exhaustive list of all Wormhole chains.
 */
export const WORMHOLE_QUERY_CHAIN_IDS = {
  ETHEREUM: 2,
  POLYGON: 5,
  ARBITRUM: 23,
  OPTIMISM: 24,
  BASE: 30,
} as const;
