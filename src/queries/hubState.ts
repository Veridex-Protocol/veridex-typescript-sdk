import axios, { AxiosError } from 'axios';
import { Buffer } from 'buffer';
import { ethers } from 'ethers';
import {
  EthCallQueryRequest,
  EthCallQueryResponse,
  PerChainQueryRequest,
  QueryRequest,
  QueryResponse,
  hexToUint8Array,
  isValidHexString,
} from '@wormhole-foundation/wormhole-query-sdk';

import { MAINNET_CHAINS, TESTNET_CHAINS } from '../constants.js';
import { WORMHOLE_QUERY_PROXY_URLS } from './constants.js';

export type QueryHubStateNetwork = 'testnet' | 'mainnet';

export type QueryHubStateOptions = {
  /** Max response age in seconds (default: 60). */
  maxAge?: number;
  network?: QueryHubStateNetwork;
  /** Maximum attempts including the first try (default: 4). */
  maxAttempts?: number;
};

export type HubStateResult = {
  nonce: bigint;
  isRegistered: boolean;
  blockTime: number;
  proof: Uint8Array;
};

export type QueryHubStateErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED_NETWORK'
  | 'MISSING_HUB_ADDRESS'
  | 'PROXY_HTTP_ERROR'
  | 'PROXY_RESPONSE_INVALID'
  | 'ATTESTATION_STALE'
  | 'QUERY_RESPONSE_INVALID';

export class QueryHubStateError extends Error {
  code: QueryHubStateErrorCode;
  cause?: unknown;

  constructor(code: QueryHubStateErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'QueryHubStateError';
    this.code = code;
    this.cause = cause;
  }
}

function resolveNetwork(options?: QueryHubStateOptions): QueryHubStateNetwork {
  if (options?.network) return options.network;

  const envCandidates = [
    (globalThis as any)?.process?.env?.NEXT_PUBLIC_VERIDEX_NETWORK,
    (globalThis as any)?.process?.env?.VERIDEX_NETWORK,
    (globalThis as any)?.process?.env?.NEXT_PUBLIC_WORMHOLE_NETWORK,
    (globalThis as any)?.process?.env?.WORMHOLE_NETWORK,
  ].filter(Boolean);

  const env = (envCandidates[0] as string | undefined)?.toLowerCase();
  if (env === 'mainnet' || env === 'testnet') return env;

  // Default to testnet to support Base Sepolia out-of-the-box.
  return 'testnet';
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function signaturesToProofBytes(signatures: string[]): Uint8Array {
  const chunks: Uint8Array[] = [];

  for (const sig of signatures) {
    if (typeof sig !== 'string' || sig.length !== 132 || !/^[0-9a-fA-F]+$/.test(sig)) {
      throw new QueryHubStateError(
        'PROXY_RESPONSE_INVALID',
        `Invalid guardian signature format (expected 132 hex chars): ${String(sig)}`
      );
    }
    // Avoid Node Buffer-backed Uint8Array (can surface as SharedArrayBuffer in DTS types).
    chunks.push(hexToUint8Array(`0x${sig}`));
  }

  return concatBytes(chunks);
}

function decodeQueryBytes(bytes: string): Uint8Array {
  if (typeof bytes !== 'string' || bytes.length === 0) {
    throw new QueryHubStateError('PROXY_RESPONSE_INVALID', 'Missing query response bytes');
  }

  // Query Proxy commonly returns a 0x-prefixed hex string.
  if (isValidHexString(bytes)) {
    return hexToUint8Array(bytes);
  }

  // Fallback: attempt base64 decoding.
  try {
    if (typeof atob === 'function') {
      const raw = atob(bytes);
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      return arr;
    }
  } catch {
    // ignore
  }

  try {
    return new Uint8Array(Buffer.from(bytes, 'base64'));
  } catch (cause) {
    throw new QueryHubStateError('PROXY_RESPONSE_INVALID', 'Unrecognized query response bytes encoding', cause);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      attempt += 1;
      if (attempt >= maxAttempts) break;

      const baseMs = 250;
      const backoffMs = Math.min(5_000, baseMs * 2 ** (attempt - 1));
      const jitterMs = Math.floor(Math.random() * 100);
      await sleep(backoffMs + jitterMs);
    }
  }

  throw lastError;
}

function getHubConfig(network: QueryHubStateNetwork): {
  wormholeChainId: number;
  hubAddress: string;
  endpoint: string;
  rpcUrl: string;
} {
  if (network === 'testnet') {
    const baseSepolia = TESTNET_CHAINS.baseSepolia;
    if (!baseSepolia?.contracts?.hub) {
      throw new QueryHubStateError('MISSING_HUB_ADDRESS', 'Missing Base Sepolia hub address in SDK constants');
    }

    return {
      wormholeChainId: baseSepolia.wormholeChainId,
      hubAddress: baseSepolia.contracts.hub,
      endpoint: WORMHOLE_QUERY_PROXY_URLS.testnet,
      rpcUrl: baseSepolia.rpcUrl,
    };
  }

  if (network === 'mainnet') {
    const base = MAINNET_CHAINS.base;
    const hubAddress = (base?.contracts as any)?.hub as string | undefined;

    if (!hubAddress) {
      throw new QueryHubStateError(
        'MISSING_HUB_ADDRESS',
        'Missing mainnet hub address in SDK constants (MAINNET_CHAINS.base.contracts.hub)'
      );
    }

    return {
      wormholeChainId: base.wormholeChainId,
      hubAddress,
      endpoint: WORMHOLE_QUERY_PROXY_URLS.mainnet,
      rpcUrl: base.rpcUrl,
    };
  }

  throw new QueryHubStateError('UNSUPPORTED_NETWORK', `Unsupported network: ${network}`);
}

function encodeHubCalls(hubAddress: string, userKeyHash: string): { to: string; data: string }[] {
  // Support both the spec name and known on-chain variants.
  const nonceAbiCandidates = [
    'function getUserNonce(bytes32 userKeyHash) view returns (uint256)',
    'function userNonces(bytes32 userKeyHash) view returns (uint256)',
    'function getNonceByHash(bytes32 userKeyHash) view returns (uint256)',
  ];

  const registeredAbiCandidates = [
    'function registeredKeys(bytes32 userKeyHash) view returns (bool)',
    'function isKeyRegisteredByHash(bytes32 userKeyHash) view returns (bool)',
  ];

  // We encode *all* candidates; the proxy will execute each call, and we decode the first successful one.
  // This makes the client resilient to Hub ABI differences across deployments.
  const iface = new ethers.Interface([...nonceAbiCandidates, ...registeredAbiCandidates]);

  const nonceFnNames = ['getUserNonce', 'userNonces', 'getNonceByHash'] as const;
  const regFnNames = ['registeredKeys', 'isKeyRegisteredByHash'] as const;

  return [
    ...nonceFnNames.map((fn) => ({
      to: hubAddress,
      data: iface.encodeFunctionData(fn, [userKeyHash]),
    })),
    ...regFnNames.map((fn) => ({
      to: hubAddress,
      data: iface.encodeFunctionData(fn, [userKeyHash]),
    })),
  ];
}

function decodeFirstNonce(results: string[]): bigint {
  const candidates = [
    'function getUserNonce(bytes32 userKeyHash) view returns (uint256)',
    'function userNonces(bytes32 userKeyHash) view returns (uint256)',
    'function getNonceByHash(bytes32 userKeyHash) view returns (uint256)',
  ];
  const iface = new ethers.Interface(candidates);
  const fnNames = ['getUserNonce', 'userNonces', 'getNonceByHash'] as const;

  for (let idx = 0; idx < fnNames.length; idx++) {
    const fnName = fnNames[idx];
    try {
      const data = results[idx];
      if (!data || data === '0x') continue;
      const decoded = iface.decodeFunctionResult(fnName, data);
      return decoded[0] as bigint;
    } catch {
      // keep trying
    }
  }

  throw new QueryHubStateError('QUERY_RESPONSE_INVALID', 'Unable to decode user nonce from query response');
}

function decodeFirstIsRegistered(results: string[]): boolean {
  const nonceCandidateCount = 3;
  const candidates = [
    'function registeredKeys(bytes32 userKeyHash) view returns (bool)',
    'function isKeyRegisteredByHash(bytes32 userKeyHash) view returns (bool)',
  ];
  const iface = new ethers.Interface(candidates);
  const fnNames = ['registeredKeys', 'isKeyRegisteredByHash'] as const;

  for (let i = 0; i < fnNames.length; i++) {
    const fnName = fnNames[i];
    try {
      const data = results[nonceCandidateCount + i];
      if (!data || data === '0x') continue;
      const decoded = iface.decodeFunctionResult(fnName, data);
      return Boolean(decoded[0]);
    } catch {
      // keep trying
    }
  }

  // If the hub deployment doesn’t support registration, treat as false.
  return false;
}

/**
 * Fetch Guardian-attested Hub state directly from the Wormhole Query Proxy.
 *
 * Client-side only: this avoids relayer API costs and produces a Guardian-signed proof
 * that can be forwarded to the relayer for on-chain verification/submission.
 */
export async function queryHubState(
  userKeyHash: string,
  apiKey: string,
  options?: QueryHubStateOptions
): Promise<HubStateResult> {
  if (typeof userKeyHash !== 'string' || userKeyHash.length === 0) {
    throw new QueryHubStateError('INVALID_ARGUMENT', 'userKeyHash is required');
  }
  if (!isValidHexString(userKeyHash) || hexToUint8Array(userKeyHash).length !== 32) {
    throw new QueryHubStateError('INVALID_ARGUMENT', 'userKeyHash must be a 32-byte hex string');
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new QueryHubStateError('INVALID_ARGUMENT', 'apiKey is required');
  }

  const network = resolveNetwork(options);
  const maxAgeSeconds = options?.maxAge ?? 60;
  const maxAttempts = options?.maxAttempts ?? 4;

  const { wormholeChainId, hubAddress, endpoint, rpcUrl } = getHubConfig(network);

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const callData = encodeHubCalls(hubAddress, userKeyHash);

  const doFetch = async () => {
    try {
      const latestBlock = await provider.getBlockNumber();
      const blockTag = Math.max(0, latestBlock - 2);

      const request = new QueryRequest(Date.now() & 0xffffffff, [
        new PerChainQueryRequest(wormholeChainId, new EthCallQueryRequest(blockTag, callData)),
      ]);

      // Wormhole Query Proxy expects raw hex WITHOUT 0x prefix
      const requestHex = Buffer.from(request.serialize()).toString('hex');

      const response = await axios.post(
        endpoint,
        { bytes: requestHex },
        {
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
        }
      );

      const data = response.data as any;
      const signatures = data?.signatures as string[] | undefined;
      const bytes = data?.bytes as string | undefined;

      if (!Array.isArray(signatures) || typeof bytes !== 'string') {
        throw new QueryHubStateError('PROXY_RESPONSE_INVALID', 'Query Proxy response missing signatures/bytes');
      }

      const proof = signaturesToProofBytes(signatures);
      const queryBytes = decodeQueryBytes(bytes);
      const parsed = QueryResponse.from(queryBytes);

      const perChain = parsed.responses.find((r) => r.chainId === wormholeChainId);
      if (!perChain) {
        throw new QueryHubStateError('QUERY_RESPONSE_INVALID', 'Missing per-chain response for hub chain');
      }

      // The SDK provides a parser for the chain-specific response.
      const chainResp = EthCallQueryResponse.from(perChain.response.serialize());
      const blockTime = Number(chainResp.blockTime);

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds - blockTime > maxAgeSeconds) {
        throw new QueryHubStateError(
          'ATTESTATION_STALE',
          `Guardian attestation is stale (blockTime=${blockTime}, now=${nowSeconds}, maxAge=${maxAgeSeconds}s)`
        );
      }

      const nonce = decodeFirstNonce(chainResp.results);
      const isRegistered = decodeFirstIsRegistered(chainResp.results);

      return {
        nonce,
        isRegistered,
        blockTime,
        proof,
      } satisfies HubStateResult;
    } catch (err) {
      if (err instanceof QueryHubStateError) throw err;
      if (axios.isAxiosError(err)) {
        const ax = err as AxiosError;
        const status = ax.response?.status;
        const statusText = ax.response?.statusText;
        const details = typeof ax.response?.data === 'string' ? ax.response?.data : undefined;

        throw new QueryHubStateError(
          'PROXY_HTTP_ERROR',
          `Query Proxy request failed${status ? ` (${status} ${statusText ?? ''})` : ''}${details ? `: ${details}` : ''}`,
          err
        );
      }

      throw new QueryHubStateError('PROXY_HTTP_ERROR', 'Query Proxy request failed', err);
    }
  };

  return await withExponentialBackoff(doFetch, maxAttempts);
}
