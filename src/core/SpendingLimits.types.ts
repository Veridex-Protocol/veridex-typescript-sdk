/**
 * Veridex Protocol SDK - Spending Limits Type Definitions (Issue #27)
 * 
 * Types for configuring, viewing, and enforcing spending limits on vaults.
 * Spending limits provide an additional security layer against:
 * - Compromised passkeys draining entire vault
 * - Accidental large transactions
 * - Malicious session key abuse
 * 
 * Security Model:
 * - Limits are enforced on-chain by the vault contract
 * - Limit changes require passkey signature (Hub authentication)
 * - Circuit breaker auto-pauses vault on limit violation
 * - Daily limits reset 24 hours from first spend
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Current spending limits and usage for a vault
 */
export interface SpendingLimits {
  /** Daily spending limit (0 = unlimited) */
  dailyLimit: bigint;
  
  /** Amount spent in current 24-hour period */
  dailySpent: bigint;
  
  /** Remaining daily allowance */
  dailyRemaining: bigint;
  
  /** When the daily counter resets (UTC timestamp) */
  dayResetTime: Date;
  
  /** Time remaining until daily reset (milliseconds) */
  timeUntilReset: number;
  
  /** Per-transaction limit (0 = unlimited) */
  transactionLimit: bigint;
  
  /** Whether the vault is currently paused */
  isPaused: boolean;
  
  /** Last updated timestamp */
  lastUpdated: Date;
  
  /** Chain where these limits are enforced */
  chainId: number;
}

/**
 * Formatted spending limits for UI display
 */
export interface FormattedSpendingLimits {
  /** Daily limit as human-readable string (e.g., "1,000 USDC") */
  dailyLimit: string;
  
  /** Daily limit as raw number for calculations */
  dailyLimitValue: number;
  
  /** Amount spent today as human-readable string */
  dailySpent: string;
  
  /** Amount spent as raw number */
  dailySpentValue: number;
  
  /** Remaining daily allowance as human-readable string */
  dailyRemaining: string;
  
  /** Remaining as raw number */
  dailyRemainingValue: number;
  
  /** Percentage of daily limit used (0-100) */
  dailyUsedPercentage: number;
  
  /** Time until reset as human-readable string (e.g., "6h 23m") */
  timeUntilReset: string;
  
  /** Transaction limit as human-readable string */
  transactionLimit: string;
  
  /** Transaction limit as raw number */
  transactionLimitValue: number;
  
  /** Whether the vault is paused */
  isPaused: boolean;
  
  /** Whether daily limit is set (false = unlimited) */
  hasDailyLimit: boolean;
  
  /** Whether transaction limit is set (false = unlimited) */
  hasTransactionLimit: boolean;
}

/**
 * Spending limit configuration during vault creation
 */
export interface SpendingLimitConfig {
  /** Daily spending limit (optional, 0 = unlimited) */
  dailyLimit?: bigint;
  
  /** Per-transaction limit (optional, 0 = unlimited) */
  transactionLimit?: bigint;
  
  /** Whether to require 2FA for transactions above threshold */
  requireMultiSigAbove?: bigint;
  
  /** Whitelisted recipients (unlimited transfers allowed) */
  whitelistedRecipients?: string[];
}

/**
 * Parameters for setting daily limit
 */
export interface SetDailyLimitParams {
  /** New daily limit in wei/lamports/base units */
  limit: bigint;
  
  /** Optional chain to configure (defaults to current chain) */
  chainId?: number;
}

/**
 * Parameters for setting transaction limit
 */
export interface SetTransactionLimitParams {
  /** New transaction limit in wei/lamports/base units */
  limit: bigint;
  
  /** Optional chain to configure (defaults to current chain) */
  chainId?: number;
}

// ============================================================================
// Limit Enforcement Types
// ============================================================================

/**
 * Result of checking if a transaction is within limits
 */
export interface LimitCheckResult {
  /** Whether the transaction is allowed */
  allowed: boolean;
  
  /** Reason code if not allowed */
  reason?: LimitViolationType;
  
  /** Human-readable message */
  message: string;
  
  /** Amount that would be allowed (if partially allowed) */
  allowedAmount?: bigint;
  
  /** Amount that exceeds limit */
  excessAmount?: bigint;
  
  /** Time to wait if daily limit reached */
  waitTime?: number;
  
  /** Suggested actions for the user */
  suggestions?: LimitViolationSuggestion[];
}

/**
 * Types of limit violations
 */
export type LimitViolationType =
  | 'daily_limit_exceeded'
  | 'transaction_limit_exceeded'
  | 'vault_paused'
  | 'insufficient_balance'
  | 'daily_limit_would_exceed';

/**
 * Suggestion for resolving a limit violation
 */
export interface LimitViolationSuggestion {
  /** Action type */
  action: 'send_partial' | 'increase_limit' | 'wait_for_reset' | 'unpause_vault';
  
  /** Human-readable label */
  label: string;
  
  /** Additional data for the action */
  data?: {
    amount?: bigint;
    waitTimeMs?: number;
    newLimit?: bigint;
  };
}

// ============================================================================
// Transaction History Types
// ============================================================================

/**
 * A spending transaction in the history
 */
export interface SpendingTransaction {
  /** Transaction hash */
  hash: string;
  
  /** Amount spent (in wei/lamports) */
  amount: bigint;
  
  /** Human-readable amount */
  formattedAmount: string;
  
  /** Token symbol */
  tokenSymbol: string;
  
  /** Recipient address */
  recipient: string;
  
  /** Recipient display name (ENS, label, or truncated) */
  recipientDisplay: string;
  
  /** When the transaction occurred */
  timestamp: Date;
  
  /** Relative time (e.g., "2h ago") */
  relativeTime: string;
  
  /** Transaction type */
  type: 'transfer' | 'bridge' | 'execute';
  
  /** Whether this counted against daily limit */
  countedAgainstLimit: boolean;
}

/**
 * Daily spending summary
 */
export interface DailySpendingSummary {
  /** Date for this summary */
  date: Date;
  
  /** Total amount spent */
  totalSpent: bigint;
  
  /** Formatted total */
  formattedTotal: string;
  
  /** Number of transactions */
  transactionCount: number;
  
  /** Individual transactions */
  transactions: SpendingTransaction[];
}

// ============================================================================
// Config Action Encoding
// ============================================================================

/**
 * Config types matching VeridexVault.sol
 */
export const CONFIG_TYPE = {
  /** Update daily limit */
  DAILY_LIMIT: 1,
  /** Pause/unpause vault */
  PAUSE: 2,
  /** Update guardians */
  GUARDIANS: 3,
  /** Register sender */
  REGISTER_SENDER: 4,
  /** Allow source chain */
  ALLOW_CHAIN: 5,
  /** Set query verifier */
  QUERY_VERIFIER: 6,
} as const;

export type ConfigType = (typeof CONFIG_TYPE)[keyof typeof CONFIG_TYPE];

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event emitted when spending limits change
 */
export interface SpendingLimitChangedEvent {
  /** Event type */
  type: 'daily_limit_changed' | 'transaction_limit_changed' | 'vault_paused' | 'vault_unpaused';
  
  /** Previous value */
  previousValue: bigint | boolean;
  
  /** New value */
  newValue: bigint | boolean;
  
  /** Transaction hash */
  txHash: string;
  
  /** Block timestamp */
  timestamp: Date;
}

/**
 * Callback for spending limit events
 */
export type SpendingLimitEventCallback = (event: SpendingLimitChangedEvent) => void;

// ============================================================================
// Preset Configurations
// ============================================================================

/**
 * Predefined spending limit configurations
 */
export interface LimitPreset {
  /** Preset identifier */
  id: string;
  
  /** Display name */
  name: string;
  
  /** Description */
  description: string;
  
  /** Daily limit suggestion (in USD equivalent) */
  dailyLimitUsd: number;
  
  /** Transaction limit suggestion (in USD equivalent) */
  transactionLimitUsd: number;
  
  /** Icon for UI */
  icon: string;
  
  /** Recommended for user type */
  recommendedFor: string;
}

/**
 * Standard limit presets
 */
export const LIMIT_PRESETS: LimitPreset[] = [
  {
    id: 'conservative',
    name: 'Conservative',
    description: 'Low limits for maximum security',
    dailyLimitUsd: 500,
    transactionLimitUsd: 100,
    icon: '🔒',
    recommendedFor: 'New users or high-value vaults',
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Moderate limits for everyday use',
    dailyLimitUsd: 2500,
    transactionLimitUsd: 500,
    icon: '⚖️',
    recommendedFor: 'Regular users',
  },
  {
    id: 'generous',
    name: 'Generous',
    description: 'Higher limits for active traders',
    dailyLimitUsd: 10000,
    transactionLimitUsd: 2500,
    icon: '🚀',
    recommendedFor: 'Active traders and power users',
  },
  {
    id: 'unlimited',
    name: 'No Limits',
    description: 'No spending restrictions (not recommended)',
    dailyLimitUsd: 0, // 0 = unlimited
    transactionLimitUsd: 0,
    icon: '⚠️',
    recommendedFor: 'Advanced users who accept full risk',
  },
];

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Duration display for reset countdown
 */
export interface DurationDisplay {
  hours: number;
  minutes: number;
  seconds: number;
  formatted: string; // e.g., "6h 23m"
}

/**
 * Calculate duration display from milliseconds
 */
export function formatDuration(ms: number): DurationDisplay {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  let formatted: string;
  if (hours > 0) {
    formatted = `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    formatted = `${minutes}m ${seconds}s`;
  } else {
    formatted = `${seconds}s`;
  }
  
  return { hours, minutes, seconds, formatted };
}

/**
 * Calculate percentage safely (handles zero division)
 */
export function calculatePercentage(spent: bigint, limit: bigint): number {
  if (limit === 0n) return 0;
  // Use fixed-point math to avoid precision loss
  const percentage = Number((spent * 10000n) / limit) / 100;
  return Math.min(100, Math.max(0, percentage));
}

/**
 * Format large numbers with appropriate units
 */
export function formatLargeAmount(
  amount: bigint,
  decimals: number = 18,
  symbol: string = 'ETH'
): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  
  // Format with up to 4 decimal places
  const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, 4);
  const trimmedFraction = fractionStr.replace(/0+$/, '');
  
  const numStr = trimmedFraction 
    ? `${whole.toLocaleString()}.${trimmedFraction}`
    : whole.toLocaleString();
    
  return `${numStr} ${symbol}`;
}
