import axios, { AxiosError } from 'axios';
import { Buffer } from 'buffer';
import { ethers } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import {
  EthCallQueryRequest,
  EthCallQueryResponse,
  PerChainQueryRequest,
  QueryRequest,
  QueryResponse,
  SolanaAccountQueryRequest,
  SolanaAccountQueryResponse,
  hexToUint8Array,
  isValidHexString,
} from '@wormhole-foundation/wormhole-query-sdk';

import { MAINNET_CHAINS, TESTNET_CHAINS } from '../constants.js';
import { WalletManager } from '../core/WalletManager.js';
import { getAllTokens, isNativeToken } from '../constants/tokens.js';
import { WORMHOLE_QUERY_PROXY_URLS } from './constants.js';

export type QueryPortfolioNetwork = 'testnet' | 'mainnet';

export type QueryPortfolioOptions = {
  /** Max response age in seconds (default: 60). */
  maxAge?: number;
  network?: QueryPortfolioNetwork;
  /** Maximum attempts including the first try (default: 4). */
  maxAttempts?: number;
  /** Cache TTL in ms (default: 30_000). */
  cacheTtlMs?: number;
  /** Override Query Proxy endpoint. */
  endpoint?: string;
  /** Override per-chain RPC URLs used for block tag lookups. */
  rpcUrls?: Record<number, string>;
  /** Override derived vault addresses for specific Wormhole chain IDs. */
  vaultAddresses?: Record<number, string>;
  /** Override token lists (ERC20 only) for specific Wormhole chain IDs. */
  evmTokenAddresses?: Record<number, string[]>;
  /** Additional Solana accounts to include in the Solana account query (base58). */
  solanaAccounts?: string[];
  /** Optional USD prices by symbol/address for aggregation (e.g. { USDC: 1 }). */
  pricesUsd?: Record<string, number>;
};

export type PortfolioBalance = {
  assetId: string;
  amount: bigint;
  decimals?: number;
  symbol?: string;
  usdValue?: number;
};

export type PortfolioChainErrorCode =
  | 'UNSUPPORTED_CHAIN'
  | 'MISSING_VAULT'
  | 'MISSING_TOKENS'
  | 'ATTESTATION_STALE'
  | 'DECODE_ERROR';

export type PortfolioChainResult = {
  wormholeChainId: number;
  chainName?: string;
  vaultAddress?: string;
  blockTime?: number;
  balances: PortfolioBalance[];
  error?: {
    code: PortfolioChainErrorCode;
    message: string;
  };
};

export type PortfolioResult = {
  proof: Uint8Array;
  totalUsd?: number;
  chains: PortfolioChainResult[];
};

export type QueryPortfolioErrorCode =
  | 'INVALID_ARGUMENT'
  | 'PROXY_HTTP_ERROR'
  | 'PROXY_RESPONSE_INVALID'
  | 'QUERY_RESPONSE_INVALID';

export class QueryPortfolioError extends Error {
  code: QueryPortfolioErrorCode;
  cause?: unknown;

  constructor(code: QueryPortfolioErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'QueryPortfolioError';
    this.code = code;
    this.cause = cause;
  }
}

type CacheEntry = { expiresAt: number; value: PortfolioResult };
const PORTFOLIO_CACHE = new Map<string, CacheEntry>();

function resolveNetwork(options?: QueryPortfolioOptions): QueryPortfolioNetwork {
  if (options?.network) return options.network;

  const envCandidates = [
    (globalThis as any)?.process?.env?.NEXT_PUBLIC_VERIDEX_NETWORK,
    (globalThis as any)?.process?.env?.VERIDEX_NETWORK,
    (globalThis as any)?.process?.env?.NEXT_PUBLIC_WORMHOLE_NETWORK,
    (globalThis as any)?.process?.env?.WORMHOLE_NETWORK,
  ].filter(Boolean);

  const env = (envCandidates[0] as string | undefined)?.toLowerCase();
  if (env === 'mainnet' || env === 'testnet') return env;

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
      throw new QueryPortfolioError(
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
    throw new QueryPortfolioError('PROXY_RESPONSE_INVALID', 'Missing query response bytes');
  }

  if (isValidHexString(bytes)) {
    return hexToUint8Array(bytes);
  }

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
    throw new QueryPortfolioError('PROXY_RESPONSE_INVALID', 'Unrecognized query response bytes encoding', cause);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withExponentialBackoff<T>(fn: () => Promise<T>, maxAttempts: number): Promise<T> {
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

function getChainConfigs(network: QueryPortfolioNetwork) {
  return network === 'testnet' ? TESTNET_CHAINS : MAINNET_CHAINS;
}

function getProxyEndpoint(network: QueryPortfolioNetwork, options?: QueryPortfolioOptions): string {
  if (options?.endpoint) return options.endpoint;
  return network === 'testnet' ? WORMHOLE_QUERY_PROXY_URLS.testnet : WORMHOLE_QUERY_PROXY_URLS.mainnet;
}

function getDefaultPortfolioChains(network: QueryPortfolioNetwork): number[] {
  // Focus on the current spoke set mentioned in the request.
  return network === 'testnet' ? [10005, 10003, 1] : [24, 23, 1];
}

function normalizeHex32(hex: string): Uint8Array {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new QueryPortfolioError('INVALID_ARGUMENT', `Invalid userKeyHash (expected 0x + 32 bytes hex): ${hex}`);
  }
  return new Uint8Array(Buffer.from(hex.slice(2), 'hex'));
}

function deriveSolanaVaultAddress(programIdBase58: string, userKeyHash: string): string {
  const programId = new PublicKey(programIdBase58);
  const keyHashBytes = normalizeHex32(userKeyHash);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from('vault'), Buffer.from(keyHashBytes)], programId);
  return vaultPda.toBase58();
}

function makeCacheKey(userKeyHash: string, apiKey: string, options: QueryPortfolioOptions | undefined, chainIds: number[]) {
  // Do not include apiKey in the cache key; it should not affect the data.
  const payload = {
    userKeyHash,
    network: resolveNetwork(options),
    chainIds: [...chainIds].sort((a, b) => a - b),
    vaultAddresses: options?.vaultAddresses ?? null,
    evmTokenAddresses: options?.evmTokenAddresses ?? null,
    solanaAccounts: options?.solanaAccounts ?? null,
    endpoint: options?.endpoint ?? null,
  };

  void apiKey;
  return JSON.stringify(payload);
}

function safeNumberFromBigint(b: bigint): number {
  const n = Number(b);
  return Number.isFinite(n) ? n : 0;
}

function priceLookup(pricesUsd: Record<string, number> | undefined, symbol?: string, assetId?: string): number | undefined {
  if (!pricesUsd) return undefined;
  if (symbol && pricesUsd[symbol] != null) return pricesUsd[symbol];
  if (assetId && pricesUsd[assetId] != null) return pricesUsd[assetId];
  return undefined;
}

function sumUsd(balances: PortfolioBalance[], pricesUsd?: Record<string, number>): number | undefined {
  let total = 0;
  let any = false;

  for (const b of balances) {
    const p = priceLookup(pricesUsd, b.symbol, b.assetId);
    if (p == null) continue;
    if (b.decimals == null) continue;

    const denom = 10 ** b.decimals;
    const amount = Number(b.amount) / denom;
    if (!Number.isFinite(amount)) continue;
    total += amount * p;
    any = true;
  }

  return any ? total : undefined;
}

async function getRecentBlockTag(rpcUrl: string): Promise<number> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const latest = await provider.getBlockNumber();
  return Math.max(0, latest - 2);
}

function encodeErc20BalanceCalls(vaultAddress: string, tokenAddresses: string[]): { to: string; data: string }[] {
  const iface = new ethers.Interface(['function balanceOf(address owner) view returns (uint256)']);
  return tokenAddresses.map((token) => ({
    to: token,
    data: iface.encodeFunctionData('balanceOf', [vaultAddress]),
  }));
}

function decodeErc20Balances(results: string[], tokenAddresses: string[]): bigint[] {
  const iface = new ethers.Interface(['function balanceOf(address owner) view returns (uint256)']);
  const out: bigint[] = [];
  for (let i = 0; i < tokenAddresses.length; i++) {
    const data = results[i];
    if (!data || data === '0x') {
      out.push(0n);
      continue;
    }
    const decoded = iface.decodeFunctionResult('balanceOf', data);
    out.push(decoded[0] as bigint);
  }
  return out;
}

/**
 * Fetch Guardian-attested vault balances across multiple chains in one Query Proxy request.
 *
 * Notes:
 * - EVM balances are ERC20-only via `eth_call` (native ETH is not queryable via this query type).
 * - Solana balance uses lamports of the Veridex vault PDA (plus optional extra accounts).
 * - Aptos is included only if/when Wormhole Queries adds Aptos query types (currently returned as unsupported).
 */
export async function queryPortfolio(
  userKeyHash: string,
  apiKey: string,
  options?: QueryPortfolioOptions
): Promise<PortfolioResult> {
  const network = resolveNetwork(options);
  const maxAgeSeconds = options?.maxAge ?? 60;
  const maxAttempts = options?.maxAttempts ?? 4;
  const cacheTtlMs = options?.cacheTtlMs ?? 30_000;
  const endpoint = getProxyEndpoint(network, options);

  const chainIds = options?.rpcUrls ? Object.keys(options.rpcUrls).map(Number) : undefined;
  void chainIds;

  const requestedChains = options?.vaultAddresses
    ? Object.keys(options.vaultAddresses).map(Number)
    : undefined;

  const defaultChains = getDefaultPortfolioChains(network);
  const wormholeChainIds = options?.evmTokenAddresses
    ? Array.from(new Set([...defaultChains, ...Object.keys(options.evmTokenAddresses).map(Number)]))
    : defaultChains;

  // If the caller provided explicit vault overrides, include those chain IDs even if not in defaults.
  const finalChainIds = requestedChains
    ? Array.from(new Set([...wormholeChainIds, ...requestedChains]))
    : wormholeChainIds;

  if (!apiKey || typeof apiKey !== 'string') {
    throw new QueryPortfolioError('INVALID_ARGUMENT', 'Missing Query Proxy apiKey');
  }

  const cacheKey = makeCacheKey(userKeyHash, apiKey, options, finalChainIds);
  const cached = PORTFOLIO_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const chains = getChainConfigs(network);
  const walletManager = new WalletManager({ cacheAddresses: true, persistToStorage: false });

  const pricesUsd: Record<string, number> | undefined = {
    USDC: 1,
    ...(options?.pricesUsd ?? {}),
  };

  const doFetch = async (): Promise<PortfolioResult> => {
    try {
      const perChainRequests: PerChainQueryRequest[] = [];
      const chainMeta: Record<number, { vaultAddress?: string; chainName?: string; kind: 'evm' | 'solana' | 'unsupported' }> = {};

      // Precompute any EVM block tags in parallel to keep total latency down.
      const evmChainIds = finalChainIds.filter((id) => {
        const cfg = Object.values(chains).find((c) => c.wormholeChainId === id);
        return cfg?.isEvm;
      });

      const blockTagsByChainId = new Map<number, number>();
      await Promise.all(
        evmChainIds.map(async (wormholeChainId) => {
          const cfg = Object.values(chains).find((c) => c.wormholeChainId === wormholeChainId);
          if (!cfg) return;
          const rpcUrl = options?.rpcUrls?.[wormholeChainId] ?? cfg.rpcUrl;
          const blockTag = await getRecentBlockTag(rpcUrl);
          blockTagsByChainId.set(wormholeChainId, blockTag);
        })
      );

      for (const wormholeChainId of finalChainIds) {
        const cfg = Object.values(chains).find((c) => c.wormholeChainId === wormholeChainId);

        if (wormholeChainId === 22) {
          chainMeta[wormholeChainId] = { kind: 'unsupported', chainName: cfg?.name };
          continue;
        }

        if (!cfg) {
          chainMeta[wormholeChainId] = { kind: 'unsupported' };
          continue;
        }

        if (cfg.isEvm) {
          const vaultAddress = options?.vaultAddresses?.[wormholeChainId]
            ?? (cfg.contracts.vaultFactory && cfg.contracts.vaultImplementation
              ? walletManager.computeVaultAddress(userKeyHash, cfg.contracts.vaultFactory, cfg.contracts.vaultImplementation)
              : undefined);

          chainMeta[wormholeChainId] = { kind: 'evm', vaultAddress, chainName: cfg.name };

          if (!vaultAddress) {
            continue;
          }

          const tokenAddresses = options?.evmTokenAddresses?.[wormholeChainId]
            ?? getAllTokens(wormholeChainId).filter((t) => !isNativeToken(t.address)).map((t) => t.address);

          if (!tokenAddresses.length) {
            continue;
          }

          const blockTag = blockTagsByChainId.get(wormholeChainId);
          if (blockTag == null) {
            continue;
          }

          const calls = encodeErc20BalanceCalls(vaultAddress, tokenAddresses);
          perChainRequests.push(new PerChainQueryRequest(wormholeChainId, new EthCallQueryRequest(blockTag, calls)));
          continue;
        }

        // Solana
        if (wormholeChainId === 1) {
          const programId = options?.vaultAddresses?.[wormholeChainId] ?? cfg.contracts.hub;
          chainMeta[wormholeChainId] = { kind: 'solana', chainName: cfg.name };

          if (!programId) {
            continue;
          }

          const vaultAddress = deriveSolanaVaultAddress(programId, userKeyHash);
          chainMeta[wormholeChainId] = { kind: 'solana', chainName: cfg.name, vaultAddress };

          const accounts = [vaultAddress, ...(options?.solanaAccounts ?? [])];
          perChainRequests.push(
            new PerChainQueryRequest(
              wormholeChainId,
              new SolanaAccountQueryRequest('finalized', accounts, undefined, 0n, 0n)
            )
          );
          continue;
        }

        chainMeta[wormholeChainId] = { kind: 'unsupported', chainName: cfg.name };
      }

      if (perChainRequests.length > 255) {
        throw new QueryPortfolioError(
          'INVALID_ARGUMENT',
          `Too many per-chain requests (${perChainRequests.length}); max is 255 per Query Proxy request`
        );
      }

      const request = new QueryRequest(Date.now() & 0xffffffff, perChainRequests);
      const requestHex = `0x${Buffer.from(request.serialize()).toString('hex')}`;

      const response = await axios.post(
        endpoint,
        { bytes: requestHex },
        {
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
          },
          timeout: options?.cacheTtlMs ? Math.min(10_000, Math.max(2_000, options.cacheTtlMs)) : 10_000,
        }
      );

      const data = response.data as any;
      const signatures = data?.signatures as string[] | undefined;
      const bytes = data?.bytes as string | undefined;

      if (!Array.isArray(signatures) || typeof bytes !== 'string') {
        throw new QueryPortfolioError('PROXY_RESPONSE_INVALID', 'Query Proxy response missing signatures/bytes');
      }

      const proof = signaturesToProofBytes(signatures);
      const queryBytes = decodeQueryBytes(bytes);
      const parsed = QueryResponse.from(queryBytes);

      const nowSeconds = Math.floor(Date.now() / 1000);
      const chainsOut: PortfolioChainResult[] = [];

      for (const wormholeChainId of finalChainIds) {
        const meta = chainMeta[wormholeChainId] ?? { kind: 'unsupported' as const };

        if (meta.kind === 'unsupported') {
          const msg = wormholeChainId === 22
            ? 'Aptos Queries are not supported by the Wormhole Query SDK yet'
            : 'Chain is not supported by this portfolio query implementation';
          chainsOut.push({
            wormholeChainId,
            chainName: meta.chainName,
            balances: [],
            error: { code: 'UNSUPPORTED_CHAIN', message: msg },
          });
          continue;
        }

        if (!meta.vaultAddress) {
          chainsOut.push({
            wormholeChainId,
            chainName: meta.chainName,
            balances: [],
            error: { code: 'MISSING_VAULT', message: 'Unable to derive vault address for chain' },
          });
          continue;
        }

        const perChain = parsed.responses.find((r) => r.chainId === wormholeChainId);
        if (!perChain) {
          chainsOut.push({
            wormholeChainId,
            chainName: meta.chainName,
            vaultAddress: meta.vaultAddress,
            balances: [],
            error: { code: 'DECODE_ERROR', message: 'Missing per-chain response from Query Proxy' },
          });
          continue;
        }

        try {
          if (meta.kind === 'evm') {
            const cfg = Object.values(chains).find((c) => c.wormholeChainId === wormholeChainId);
            const tokenAddresses = options?.evmTokenAddresses?.[wormholeChainId]
              ?? getAllTokens(wormholeChainId).filter((t) => !isNativeToken(t.address)).map((t) => t.address);

            if (!tokenAddresses.length) {
              chainsOut.push({
                wormholeChainId,
                chainName: meta.chainName,
                vaultAddress: meta.vaultAddress,
                balances: [],
                error: { code: 'MISSING_TOKENS', message: 'No ERC20 tokens configured for EVM portfolio query' },
              });
              continue;
            }

            const chainResp = EthCallQueryResponse.from(perChain.response.serialize());
            const blockTime = Number(chainResp.blockTime);
            const age = nowSeconds - blockTime;
            if (age > maxAgeSeconds) {
              chainsOut.push({
                wormholeChainId,
                chainName: meta.chainName,
                vaultAddress: meta.vaultAddress,
                blockTime,
                balances: [],
                error: { code: 'ATTESTATION_STALE', message: `Attestation stale by ${age}s (maxAge=${maxAgeSeconds}s)` },
              });
              continue;
            }

            const amounts = decodeErc20Balances(chainResp.results, tokenAddresses);
            const tokenInfos = getAllTokens(wormholeChainId).filter((t) => !isNativeToken(t.address));

            const balances: PortfolioBalance[] = tokenAddresses.map((addr, i) => {
              const info = tokenInfos.find((t) => t.address.toLowerCase() === addr.toLowerCase());
              const symbol = info?.symbol;
              const decimals = info?.decimals;
              const usdPrice = priceLookup(pricesUsd, symbol, addr);
              const usdValue = usdPrice != null && decimals != null
                ? (Number(amounts[i]) / 10 ** decimals) * usdPrice
                : undefined;

              return {
                assetId: addr,
                amount: amounts[i],
                symbol,
                decimals,
                usdValue: Number.isFinite(usdValue ?? NaN) ? usdValue : undefined,
              };
            });

            void cfg;
            chainsOut.push({
              wormholeChainId,
              chainName: meta.chainName,
              vaultAddress: meta.vaultAddress,
              blockTime,
              balances,
            });
            continue;
          }

          // Solana
          const chainResp = SolanaAccountQueryResponse.from(perChain.response.serialize());
          const blockTime = safeNumberFromBigint(chainResp.blockTime);
          const age = nowSeconds - blockTime;
          if (age > maxAgeSeconds) {
            chainsOut.push({
              wormholeChainId,
              chainName: meta.chainName,
              vaultAddress: meta.vaultAddress,
              blockTime,
              balances: [],
              error: { code: 'ATTESTATION_STALE', message: `Attestation stale by ${age}s (maxAge=${maxAgeSeconds}s)` },
            });
            continue;
          }

          const vaultResult = chainResp.results[0];
          const lamports = vaultResult?.lamports ?? 0n;

          const balances: PortfolioBalance[] = [
            {
              assetId: 'SOL',
              amount: lamports,
              decimals: 9,
              symbol: 'SOL',
              usdValue: priceLookup(pricesUsd, 'SOL', 'SOL') != null
                ? (Number(lamports) / 1e9) * (priceLookup(pricesUsd, 'SOL', 'SOL') as number)
                : undefined,
            },
          ];

          chainsOut.push({
            wormholeChainId,
            chainName: meta.chainName,
            vaultAddress: meta.vaultAddress,
            blockTime,
            balances,
          });
        } catch (cause) {
          chainsOut.push({
            wormholeChainId,
            chainName: meta.chainName,
            vaultAddress: meta.vaultAddress,
            balances: [],
            error: { code: 'DECODE_ERROR', message: `Failed to decode chain response: ${String((cause as any)?.message ?? cause)}` },
          });
        }
      }

      const allBalances = chainsOut.flatMap((c) => c.balances);
      const totalUsd = sumUsd(allBalances, pricesUsd);

      const result: PortfolioResult = { proof, totalUsd, chains: chainsOut };

      PORTFOLIO_CACHE.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, value: result });
      return result;
    } catch (err) {
      if (err instanceof QueryPortfolioError) throw err;
      if (axios.isAxiosError(err)) {
        const ax = err as AxiosError;
        const status = ax.response?.status;
        const statusText = ax.response?.statusText;
        const details = typeof ax.response?.data === 'string' ? ax.response?.data : undefined;

        throw new QueryPortfolioError(
          'PROXY_HTTP_ERROR',
          `Query Proxy request failed${status ? ` (${status} ${statusText ?? ''})` : ''}${details ? `: ${details}` : ''}`,
          err
        );
      }

      throw new QueryPortfolioError('PROXY_HTTP_ERROR', 'Query Proxy request failed', err);
    }
  };

  const result = await withExponentialBackoff(doFetch, maxAttempts);
  PORTFOLIO_CACHE.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, value: result });
  return result;
}
