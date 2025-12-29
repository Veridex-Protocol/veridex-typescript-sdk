/**
 * Veridex Protocol SDK - Spending Limits Manager (Issue #27)
 * 
 * Manages vault spending limits including:
 * - Reading current limits and usage from on-chain state
 * - Preparing limit update transactions (requires passkey signature)
 * - Checking transactions against limits before signing
 * - Formatting limits for UI display
 * 
 * Security Considerations:
 * - All limit changes require Hub authentication (passkey signature)
 * - Changes are propagated via VAA to spoke chains
 * - Local checks are advisory; on-chain enforcement is authoritative
 */

import { ethers } from 'ethers';
import {
  type SpendingLimits,
  type FormattedSpendingLimits,
  type LimitCheckResult,
  type LimitViolationSuggestion,
  type SpendingTransaction,
  type DailySpendingSummary,
  type DurationDisplay,
  type SpendingLimitConfig,
  type SpendingLimitChangedEvent,
  type SpendingLimitEventCallback,
  CONFIG_TYPE,
  formatDuration,
  calculatePercentage,
  formatLargeAmount,
} from './SpendingLimits.types.js';
import { encodeConfigAction } from '../payload.js';

// ============================================================================
// Vault ABI Fragment (spending limit related functions)
// ============================================================================

const VAULT_ABI = [
  'function dailyLimit() view returns (uint256)',
  'function dailyWithdrawn() view returns (uint256)',
  'function dayStart() view returns (uint256)',
  'function paused() view returns (bool)',
  'function getRemainingDailyLimit() view returns (uint256)',
  'event Paused(bool paused)',
  'event DailyLimitUpdated(uint256 newLimit)',
];

// ============================================================================
// Constants
// ============================================================================

/** One day in seconds */
const DAY_SECONDS = 86400;

/** One day in milliseconds */
const DAY_MS = DAY_SECONDS * 1000;

// ============================================================================
// Configuration
// ============================================================================

export interface SpendingLimitsManagerConfig {
  /** Default token decimals for formatting */
  defaultDecimals?: number;
  
  /** Default token symbol for formatting */
  defaultSymbol?: string;
  
  /** Custom RPC URLs by chain ID */
  rpcUrls?: Record<number, string>;
  
  /** Cache TTL in milliseconds */
  cacheTtl?: number;
  
  /** Event callback for limit changes */
  onLimitChange?: SpendingLimitEventCallback;
}

// ============================================================================
// Main Class
// ============================================================================

export class SpendingLimitsManager {
  private config: Required<SpendingLimitsManagerConfig>;
  private cache: Map<string, { data: SpendingLimits; expiry: number }> = new Map();
  private eventListeners: SpendingLimitEventCallback[] = [];
  
  constructor(config: SpendingLimitsManagerConfig = {}) {
    this.config = {
      defaultDecimals: config.defaultDecimals ?? 18,
      defaultSymbol: config.defaultSymbol ?? 'ETH',
      rpcUrls: config.rpcUrls ?? {},
      cacheTtl: config.cacheTtl ?? 10000, // 10 seconds
      onLimitChange: config.onLimitChange ?? (() => {}),
    };
    
    if (config.onLimitChange) {
      this.eventListeners.push(config.onLimitChange);
    }
  }
  
  // ============================================================================
  // Read Spending Limits
  // ============================================================================
  
  /**
   * Get current spending limits for a vault
   * @param vaultAddress - Vault contract address
   * @param chainId - Chain ID where the vault is deployed
   * @param rpcUrl - Optional RPC URL override
   */
  async getSpendingLimits(
    vaultAddress: string,
    chainId: number,
    rpcUrl?: string
  ): Promise<SpendingLimits> {
    // Check cache first
    const cacheKey = `${chainId}:${vaultAddress.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
      return cached.data;
    }
    
    const provider = this.getProvider(chainId, rpcUrl);
    const vault = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
    
    // Fetch all values in parallel
    const [dailyLimit, dailyWithdrawn, dayStart, paused] = await Promise.all([
      vault.dailyLimit() as Promise<bigint>,
      vault.dailyWithdrawn() as Promise<bigint>,
      vault.dayStart() as Promise<bigint>,
      vault.paused() as Promise<boolean>,
    ]);
    
    const now = Date.now();
    const dayStartMs = Number(dayStart) * 1000;
    const dayEndMs = dayStartMs + DAY_MS;
    
    // Calculate effective values (handle day rollover)
    let effectiveSpent = dailyWithdrawn;
    let effectiveResetTime = new Date(dayEndMs);
    let timeUntilReset = dayEndMs - now;
    
    if (now >= dayEndMs) {
      // New day has started, spent resets to 0
      effectiveSpent = 0n;
      // Calculate next reset time
      const daysSinceStart = Math.floor((now - dayStartMs) / DAY_MS);
      const nextDayStart = dayStartMs + (daysSinceStart + 1) * DAY_MS;
      effectiveResetTime = new Date(nextDayStart);
      timeUntilReset = nextDayStart - now;
    }
    
    const dailyRemaining = dailyLimit === 0n 
      ? BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff') // max uint256
      : dailyLimit > effectiveSpent 
        ? dailyLimit - effectiveSpent 
        : 0n;
    
    const limits: SpendingLimits = {
      dailyLimit,
      dailySpent: effectiveSpent,
      dailyRemaining,
      dayResetTime: effectiveResetTime,
      timeUntilReset: Math.max(0, timeUntilReset),
      transactionLimit: 0n, // Per-tx limits are in SpendingLimitModule, not base vault
      isPaused: paused,
      lastUpdated: new Date(),
      chainId,
    };
    
    // Cache the result
    this.cache.set(cacheKey, {
      data: limits,
      expiry: now + this.config.cacheTtl,
    });
    
    return limits;
  }
  
  /**
   * Get spending limits formatted for UI display
   */
  async getFormattedSpendingLimits(
    vaultAddress: string,
    chainId: number,
    options?: {
      rpcUrl?: string;
      decimals?: number;
      symbol?: string;
    }
  ): Promise<FormattedSpendingLimits> {
    const limits = await this.getSpendingLimits(vaultAddress, chainId, options?.rpcUrl);
    const decimals = options?.decimals ?? this.config.defaultDecimals;
    const symbol = options?.symbol ?? this.config.defaultSymbol;
    
    return this.formatLimits(limits, decimals, symbol);
  }
  
  /**
   * Format raw limits for display
   */
  formatLimits(
    limits: SpendingLimits,
    decimals: number = 18,
    symbol: string = 'ETH'
  ): FormattedSpendingLimits {
    const hasDailyLimit = limits.dailyLimit > 0n;
    
    // Convert to number for display (safe for typical amounts)
    const toNumber = (val: bigint): number => {
      const divisor = 10n ** BigInt(decimals);
      return Number(val * 10000n / divisor) / 10000;
    };
    
    return {
      dailyLimit: hasDailyLimit 
        ? formatLargeAmount(limits.dailyLimit, decimals, symbol)
        : 'Unlimited',
      dailyLimitValue: toNumber(limits.dailyLimit),
      dailySpent: formatLargeAmount(limits.dailySpent, decimals, symbol),
      dailySpentValue: toNumber(limits.dailySpent),
      dailyRemaining: hasDailyLimit 
        ? formatLargeAmount(limits.dailyRemaining, decimals, symbol)
        : 'Unlimited',
      dailyRemainingValue: toNumber(limits.dailyRemaining),
      dailyUsedPercentage: hasDailyLimit 
        ? calculatePercentage(limits.dailySpent, limits.dailyLimit)
        : 0,
      timeUntilReset: formatDuration(limits.timeUntilReset).formatted,
      transactionLimit: limits.transactionLimit > 0n
        ? formatLargeAmount(limits.transactionLimit, decimals, symbol)
        : 'Unlimited',
      transactionLimitValue: toNumber(limits.transactionLimit),
      isPaused: limits.isPaused,
      hasDailyLimit,
      hasTransactionLimit: limits.transactionLimit > 0n,
    };
  }
  
  // ============================================================================
  // Limit Checks
  // ============================================================================
  
  /**
   * Check if a transaction amount is within limits
   * @param vaultAddress - Vault to check
   * @param chainId - Chain ID
   * @param amount - Amount to transfer (in base units)
   * @returns Result indicating if transfer is allowed
   */
  async checkTransactionLimit(
    vaultAddress: string,
    chainId: number,
    amount: bigint,
    options?: { rpcUrl?: string }
  ): Promise<LimitCheckResult> {
    const limits = await this.getSpendingLimits(vaultAddress, chainId, options?.rpcUrl);
    
    // Check if paused first
    if (limits.isPaused) {
      return {
        allowed: false,
        reason: 'vault_paused',
        message: 'Vault is paused. Unpause to continue.',
        suggestions: [
          {
            action: 'unpause_vault',
            label: 'Unpause Vault',
          },
        ],
      };
    }
    
    // Check per-transaction limit
    if (limits.transactionLimit > 0n && amount > limits.transactionLimit) {
      return {
        allowed: false,
        reason: 'transaction_limit_exceeded',
        message: `Transaction exceeds per-transaction limit of ${formatLargeAmount(limits.transactionLimit, this.config.defaultDecimals, this.config.defaultSymbol)}`,
        allowedAmount: limits.transactionLimit,
        excessAmount: amount - limits.transactionLimit,
        suggestions: [
          {
            action: 'send_partial',
            label: `Send ${formatLargeAmount(limits.transactionLimit, this.config.defaultDecimals, this.config.defaultSymbol)} (within limit)`,
            data: { amount: limits.transactionLimit },
          },
          {
            action: 'increase_limit',
            label: 'Increase Transaction Limit',
          },
        ],
      };
    }
    
    // Check daily limit
    if (limits.dailyLimit > 0n) {
      const wouldSpend = limits.dailySpent + amount;
      
      if (wouldSpend > limits.dailyLimit) {
        const excessAmount = wouldSpend - limits.dailyLimit;
        const suggestions: LimitViolationSuggestion[] = [];
        
        // Suggest partial transfer if some amount is available
        if (limits.dailyRemaining > 0n) {
          suggestions.push({
            action: 'send_partial',
            label: `Send ${formatLargeAmount(limits.dailyRemaining, this.config.defaultDecimals, this.config.defaultSymbol)} (within limit)`,
            data: { amount: limits.dailyRemaining },
          });
        }
        
        suggestions.push({
          action: 'increase_limit',
          label: 'Increase Daily Limit',
          data: { newLimit: wouldSpend },
        });
        
        suggestions.push({
          action: 'wait_for_reset',
          label: `Wait ${formatDuration(limits.timeUntilReset).formatted} for limit reset`,
          data: { waitTimeMs: limits.timeUntilReset },
        });
        
        return {
          allowed: false,
          reason: 'daily_limit_exceeded',
          message: `Transaction would exceed daily limit. Already spent ${formatLargeAmount(limits.dailySpent, this.config.defaultDecimals, this.config.defaultSymbol)} of ${formatLargeAmount(limits.dailyLimit, this.config.defaultDecimals, this.config.defaultSymbol)} today.`,
          allowedAmount: limits.dailyRemaining,
          excessAmount,
          waitTime: limits.timeUntilReset,
          suggestions,
        };
      }
    }
    
    return {
      allowed: true,
      message: 'Transaction is within limits',
    };
  }
  
  // ============================================================================
  // Limit Configuration (Prepare for Signing)
  // ============================================================================
  
  /**
   * Prepare a transaction to update the daily spending limit
   * Returns the config action payload that needs to be signed via passkey
   * 
   * @param newLimit - New daily limit in base units (0 = unlimited)
   * @returns Config action payload for signing
   */
  prepareDailyLimitUpdate(newLimit: bigint): string {
    // Config type 1 = daily limit update
    // Config data format: [limit(32)]
    const limitBytes = ethers.zeroPadValue(ethers.toBeHex(newLimit), 32);
    return encodeConfigAction(CONFIG_TYPE.DAILY_LIMIT, limitBytes);
  }
  
  /**
   * Prepare a transaction to pause the vault
   * @returns Config action payload for signing
   */
  preparePauseVault(): string {
    // Config type 2 = pause, config data: [paused(1)] where 1 = paused
    const pausedByte = ethers.toBeHex(1, 1);
    return encodeConfigAction(CONFIG_TYPE.PAUSE, pausedByte);
  }
  
  /**
   * Prepare a transaction to unpause the vault
   * @returns Config action payload for signing
   */
  prepareUnpauseVault(): string {
    // Config type 2 = pause, config data: [paused(1)] where 0 = unpaused
    const unpausedByte = ethers.toBeHex(0, 1);
    return encodeConfigAction(CONFIG_TYPE.PAUSE, unpausedByte);
  }
  
  /**
   * Get the full spending limit configuration encoded as config payload
   * Used during vault creation to set initial limits
   */
  encodeInitialLimits(config: SpendingLimitConfig): string {
    if (!config.dailyLimit || config.dailyLimit === 0n) {
      // No limit configuration needed
      return '';
    }
    return this.prepareDailyLimitUpdate(config.dailyLimit);
  }
  
  // ============================================================================
  // Transaction History
  // ============================================================================
  
  /**
   * Get recent spending transactions for a vault
   * Note: This requires indexer integration for full history
   * @param vaultAddress - Vault to query
   * @param chainId - Chain ID
   * @param limit - Maximum number of transactions to return
   */
  async getRecentTransactions(
    vaultAddress: string,
    chainId: number,
    limit: number = 10
  ): Promise<SpendingTransaction[]> {
    // Note: Full implementation requires indexer/subgraph integration
    // For now, return empty array - UI should handle gracefully
    // In production, this would query a subgraph or indexer API
    console.log(`[SpendingLimitsManager] getRecentTransactions not fully implemented. Vault: ${vaultAddress}, Chain: ${chainId}, Limit: ${limit}`);
    return [];
  }
  
  /**
   * Get daily spending summary
   */
  async getDailySpendingSummary(
    vaultAddress: string,
    chainId: number,
    date?: Date
  ): Promise<DailySpendingSummary> {
    const targetDate = date ?? new Date();
    const transactions = await this.getRecentTransactions(vaultAddress, chainId, 100);
    
    // Filter transactions from the target date
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    
    const dayTransactions = transactions.filter(
      tx => tx.timestamp >= startOfDay && tx.timestamp < endOfDay
    );
    
    const totalSpent = dayTransactions.reduce(
      (sum, tx) => sum + tx.amount,
      0n
    );
    
    return {
      date: targetDate,
      totalSpent,
      formattedTotal: formatLargeAmount(totalSpent, this.config.defaultDecimals, this.config.defaultSymbol),
      transactionCount: dayTransactions.length,
      transactions: dayTransactions,
    };
  }
  
  // ============================================================================
  // Event Subscription
  // ============================================================================
  
  /**
   * Subscribe to spending limit change events
   */
  onLimitChange(callback: SpendingLimitEventCallback): () => void {
    this.eventListeners.push(callback);
    return () => {
      const index = this.eventListeners.indexOf(callback);
      if (index >= 0) {
        this.eventListeners.splice(index, 1);
      }
    };
  }
  
  /**
   * Emit a limit change event to all listeners
   */
  private emitLimitChange(event: SpendingLimitChangedEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[SpendingLimitsManager] Event listener error:', error);
      }
    }
  }
  
  // ============================================================================
  // Countdown Timer
  // ============================================================================
  
  /**
   * Get a live countdown to daily limit reset
   * Returns an object with current time remaining that updates
   */
  async getResetCountdown(
    vaultAddress: string,
    chainId: number,
    options?: { rpcUrl?: string }
  ): Promise<{
    getCurrentTimeRemaining: () => DurationDisplay;
    timeUntilResetMs: number;
    resetTime: Date;
  }> {
    const limits = await this.getSpendingLimits(vaultAddress, chainId, options?.rpcUrl);
    const fetchTime = Date.now();
    
    return {
      getCurrentTimeRemaining: () => {
        const elapsed = Date.now() - fetchTime;
        const remaining = Math.max(0, limits.timeUntilReset - elapsed);
        return formatDuration(remaining);
      },
      timeUntilResetMs: limits.timeUntilReset,
      resetTime: limits.dayResetTime,
    };
  }
  
  // ============================================================================
  // Cache Management
  // ============================================================================
  
  /**
   * Clear the cache for a specific vault or all vaults
   */
  clearCache(vaultAddress?: string, chainId?: number): void {
    if (vaultAddress && chainId) {
      this.cache.delete(`${chainId}:${vaultAddress.toLowerCase()}`);
    } else {
      this.cache.clear();
    }
  }
  
  /**
   * Invalidate cache after a limit change
   */
  invalidateCacheAfterChange(vaultAddress: string, chainId: number): void {
    this.clearCache(vaultAddress, chainId);
  }
  
  // ============================================================================
  // Helpers
  // ============================================================================
  
  /**
   * Get a provider for the specified chain
   */
  private getProvider(chainId: number, rpcUrl?: string): ethers.Provider {
    const url = rpcUrl ?? this.config.rpcUrls[chainId];
    if (!url) {
      throw new Error(`No RPC URL configured for chain ${chainId}`);
    }
    return new ethers.JsonRpcProvider(url);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a SpendingLimitsManager instance
 */
export function createSpendingLimitsManager(
  config?: SpendingLimitsManagerConfig
): SpendingLimitsManager {
  return new SpendingLimitsManager(config);
}
