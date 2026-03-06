/**
 * Veridex Protocol SDK — Avalanche Chain Client
 *
 * Extends the standard EVMClient with Avalanche-native capabilities:
 * - ACP-204 precompile detection (native secp256r1 at 0x0100, 6,900 gas)
 * - ICM / Teleporter routing awareness for intra-Avalanche L1 messaging
 * - Chainlink AVAX/USD price feeds for USD-denominated session limits
 *
 * @example
 * ```typescript
 * import { AvalancheClient } from '@veridex/sdk/chains/avalanche';
 *
 * const client = new AvalancheClient({
 *   chainId: 43113,
 *   wormholeChainId: 6,
 *   rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
 *   hubContractAddress: '0x...',
 *   wormholeCoreBridge: '0x7bbcE28e64B3F8b84d876Ab298393c38ad7aac4C',
 * });
 *
 * // Check ACP-204 precompile
 * const available = await client.isACP204Available();
 *
 * // Get AVAX price for budget calculations
 * const price = await client.getAvaxPriceUSD();
 * ```
 */

import { ethers } from 'ethers';
import { EVMClient, type EVMClientConfig } from '../evm/EVMClient.js';

// ============================================================================
// Types
// ============================================================================

export interface AvalancheClientConfig extends EVMClientConfig {
  /** ACP-204 P256 verifier wrapper contract address */
  p256VerifierAddress?: string;
  /** ICM Spoke contract address for cross-L1 session bridging */
  icmSpokeAddress?: string;
  /** Chainlink AVAX/USD price feed address */
  chainlinkAvaxUsdFeed?: string;
  /** Chainlink USDC/USD price feed address */
  chainlinkUsdcUsdFeed?: string;
  /** Chainlink USDT/USD price feed address */
  chainlinkUsdtUsdFeed?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** ACP-204 precompile address on Avalanche C-Chain */
const ACP204_PRECOMPILE = '0x0000000000000000000000000000000000000100';

/** Minimal Chainlink AggregatorV3 ABI */
const CHAINLINK_AGGREGATOR_ABI = [
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
];

/** Minimal ICM Spoke ABI for session/identity queries */
const ICM_SPOKE_ABI = [
  'function verifySession(bytes32 sessionKeyHash, uint256 amount) view returns (bool valid, uint256 remainingBudget)',
  'function getSession(bytes32 sessionKeyHash) view returns (bytes32 userKeyHash, uint256 expiry, uint256 maxValue, uint256 totalBudget, uint256 spent, bool active)',
  'function getStatus() view returns (bool paused, uint256 totalMessages, uint256 totalSessions, uint256 totalPayments)',
  'function isKeyAuthorized(bytes32 identityKeyHash, bytes32 keyHash) view returns (bool)',
];

/** Minimal AvalancheP256Verifier ABI */
const P256_VERIFIER_ABI = [
  'function isPrecompileAvailable() view returns (bool available)',
  'function computeKeyHash(uint256 x, uint256 y) view returns (bytes32)',
];

// ============================================================================
// AvalancheClient
// ============================================================================

/**
 * Avalanche-specific SDK chain client.
 *
 * Wraps the standard EVMClient and adds:
 * - ACP-204 precompile availability checks
 * - Chainlink AVAX/USD price queries (for USD-denominated budgets)
 * - ICM Spoke queries (cross-L1 session verification)
 * - ICM-aware message routing (Teleporter for intra-Avalanche, Wormhole for cross-ecosystem)
 */
export class AvalancheClient extends EVMClient {
  private avaxProvider: ethers.JsonRpcProvider;
  private p256VerifierAddress: string;
  private icmSpokeAddress: string;
  private chainlinkAvaxUsdFeed: string;
  private chainlinkUsdcUsdFeed: string;
  private chainlinkUsdtUsdFeed: string;

  // Price cache (avoid excessive RPC calls)
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 30_000; // 30 seconds

  constructor(config: AvalancheClientConfig) {
    super(config);
    this.avaxProvider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.p256VerifierAddress = config.p256VerifierAddress || '';
    this.icmSpokeAddress = config.icmSpokeAddress || '';
    this.chainlinkAvaxUsdFeed = config.chainlinkAvaxUsdFeed || '';
    this.chainlinkUsdcUsdFeed = config.chainlinkUsdcUsdFeed || '';
    this.chainlinkUsdtUsdFeed = config.chainlinkUsdtUsdFeed || '';
  }

  // ========================================================================
  // ACP-204 Precompile Utilities
  // ========================================================================

  /**
   * Check if the ACP-204 secp256r1 precompile is live on this chain.
   * Returns true on Avalanche C-Chain (mainnet + Fuji), false elsewhere.
   */
  async isACP204Available(): Promise<boolean> {
    // Try via wrapper contract first (more reliable answer)
    if (this.p256VerifierAddress) {
      try {
        const verifier = new ethers.Contract(
          this.p256VerifierAddress,
          P256_VERIFIER_ABI,
          this.avaxProvider,
        );
        return await verifier.isPrecompileAvailable();
      } catch {
        // Fall through to raw check
      }
    }

    // Direct precompile probe
    try {
      const zeroInput = new Uint8Array(160);
      const result = await this.avaxProvider.call({
        to: ACP204_PRECOMPILE,
        data: ethers.hexlify(zeroInput),
      });
      return result.length === 66; // 32 bytes = 0x + 64 hex chars
    } catch {
      return false;
    }
  }

  /**
   * Get the estimated gas cost (in wei) for a single P-256 verification.
   * Deterministic on Avalanche: 6,900 gas for precompile + ~300 staticcall overhead.
   */
  async estimatePasskeyVerificationGas(): Promise<bigint> {
    const feeData = await this.avaxProvider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('25', 'gwei');
    return 7_200n * gasPrice;
  }

  /**
   * Get estimated USD cost for a passkey verification.
   */
  async estimatePasskeyVerificationCostUSD(): Promise<number> {
    const gasCostWei = await this.estimatePasskeyVerificationGas();
    return this.convertAvaxToUsd(gasCostWei);
  }

  // ========================================================================
  // Chainlink Price Feeds
  // ========================================================================

  /**
   * Get current AVAX/USD price from Chainlink.
   * Cached for 30 seconds to avoid excessive RPC calls.
   */
  async getAvaxPriceUSD(): Promise<number> {
    return this._getChainlinkPrice(this.chainlinkAvaxUsdFeed, 'avax-usd');
  }

  /**
   * Get USDC/USD price (for stablecoin verification).
   */
  async getUsdcPriceUSD(): Promise<number> {
    if (!this.chainlinkUsdcUsdFeed) return 1.0;
    return this._getChainlinkPrice(this.chainlinkUsdcUsdFeed, 'usdc-usd');
  }

  /**
   * Get USDT/USD price.
   */
  async getUsdtPriceUSD(): Promise<number> {
    if (!this.chainlinkUsdtUsdFeed) return 1.0;
    return this._getChainlinkPrice(this.chainlinkUsdtUsdFeed, 'usdt-usd');
  }

  /**
   * Convert a USD amount to AVAX wei using live Chainlink prices.
   */
  async convertUsdToAvax(usdAmount: number): Promise<bigint> {
    const avaxPrice = await this.getAvaxPriceUSD();
    if (avaxPrice <= 0) throw new Error('Invalid AVAX price from Chainlink');
    const avaxAmount = usdAmount / avaxPrice;
    return ethers.parseEther(avaxAmount.toFixed(18));
  }

  /**
   * Convert AVAX wei to USD using live Chainlink prices.
   */
  async convertAvaxToUsd(avaxWei: bigint): Promise<number> {
    const avaxPrice = await this.getAvaxPriceUSD();
    return Number(ethers.formatEther(avaxWei)) * avaxPrice;
  }

  // ========================================================================
  // ICM Spoke Queries
  // ========================================================================

  /**
   * Verify a session is valid on the ICM Spoke (cross-L1 verification).
   */
  async verifyICMSession(
    sessionKeyHash: string,
    amount: bigint,
  ): Promise<{ valid: boolean; remainingBudget: bigint }> {
    if (!this.icmSpokeAddress) {
      throw new Error('ICM Spoke address not configured');
    }
    const spoke = new ethers.Contract(this.icmSpokeAddress, ICM_SPOKE_ABI, this.avaxProvider);
    const [valid, remainingBudget] = await spoke.verifySession(sessionKeyHash, amount);
    return { valid, remainingBudget: BigInt(remainingBudget) };
  }

  /**
   * Get status of the ICM Spoke (paused, message count, session count).
   */
  async getICMSpokeStatus(): Promise<{
    paused: boolean;
    totalMessages: bigint;
    totalSessions: bigint;
    totalPayments: bigint;
  }> {
    if (!this.icmSpokeAddress) {
      throw new Error('ICM Spoke address not configured');
    }
    const spoke = new ethers.Contract(this.icmSpokeAddress, ICM_SPOKE_ABI, this.avaxProvider);
    const [paused, totalMessages, totalSessions, totalPayments] = await spoke.getStatus();
    return {
      paused,
      totalMessages: BigInt(totalMessages),
      totalSessions: BigInt(totalSessions),
      totalPayments: BigInt(totalPayments),
    };
  }

  /**
   * Check if a key is authorized for an identity on the ICM Spoke.
   */
  async isKeyAuthorizedOnSpoke(identityKeyHash: string, keyHash: string): Promise<boolean> {
    if (!this.icmSpokeAddress) return false;
    const spoke = new ethers.Contract(this.icmSpokeAddress, ICM_SPOKE_ABI, this.avaxProvider);
    return spoke.isKeyAuthorized(identityKeyHash, keyHash);
  }

  // ========================================================================
  // ICM-Aware Routing
  // ========================================================================

  /**
   * Determine whether a cross-chain message should use Teleporter (ICM) or Wormhole.
   *
   * Rule: If the target chain is within the Avalanche ecosystem (C-Chain ID or
   * an Avalanche L1), use ICM/Teleporter for lower latency and no guardian overhead.
   * Otherwise, fall back to Wormhole VAAs for cross-ecosystem messaging.
   *
   * @param targetWormholeChainId Wormhole chain ID of the destination
   * @returns 'icm' | 'wormhole'
   */
  getRoutingStrategy(targetWormholeChainId: number): 'icm' | 'wormhole' {
    // Avalanche C-Chain Wormhole chain ID is 6 on both mainnet and testnet.
    // For Avalanche L1s routed over Teleporter, they share the same ecosystem.
    // Currently only the C-Chain (6) is a known ICM target.
    const avalancheEcosystemChainIds = new Set([6]);
    return avalancheEcosystemChainIds.has(targetWormholeChainId) ? 'icm' : 'wormhole';
  }

  // ========================================================================
  // Accessors
  // ========================================================================

  getP256VerifierAddress(): string {
    return this.p256VerifierAddress;
  }

  getICMSpokeAddress(): string {
    return this.icmSpokeAddress;
  }

  getChainlinkAvaxUsdFeed(): string {
    return this.chainlinkAvaxUsdFeed;
  }

  // ========================================================================
  // Private Helpers
  // ========================================================================

  private async _getChainlinkPrice(feedAddress: string, cacheKey: string): Promise<number> {
    if (!feedAddress) throw new Error(`Chainlink feed not configured for ${cacheKey}`);

    const cached = this.priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.price;
    }

    const aggregator = new ethers.Contract(feedAddress, CHAINLINK_AGGREGATOR_ABI, this.avaxProvider);
    const [, answer] = await aggregator.latestRoundData();
    const decimals = await aggregator.decimals();
    const price = Number(answer) / 10 ** Number(decimals);

    this.priceCache.set(cacheKey, { price, timestamp: Date.now() });
    return price;
  }
}
