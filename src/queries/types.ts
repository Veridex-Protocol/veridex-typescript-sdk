import type {
  QueryRequest as WormholeQueryRequest,
  QueryResponse as WormholeQueryResponse,
} from '@wormhole-foundation/wormhole-query-sdk';

export type QueryNetwork = 'mainnet' | 'testnet';

/**
 * Configuration for calling the Wormhole Query Proxy.
 *
 * `apiKey` is required for hosted Query Proxy access.
 * `endpoint` may be overridden for custom proxy deployments.
 */
export interface QueryConfig {
  apiKey: string;
  endpoint?: string;
  timeoutMs?: number;
}

/**
 * Re-exported Wormhole Query SDK types (type-only).
 * These map directly to the request/response shapes expected by the Query Proxy.
 */
export type QueryRequest = WormholeQueryRequest;
export type QueryResponse = WormholeQueryResponse;

export type QueryOperationType = 'hubState' | 'portfolio';

export interface HubStateQuery {
  type: 'hubState';
  wormholeChainId: number;
  hubAddress: string;
}

export interface PortfolioQuery {
  type: 'portfolio';
  walletAddress: string;
  wormholeChainIds: readonly number[];
}

export type QueryOperation = HubStateQuery | PortfolioQuery;
