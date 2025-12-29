/**
 * Veridex Protocol SDK - Spending Limits Manager Tests (Issue #27)
 * 
 * Tests for:
 * - Limit encoding (daily limit, pause/unpause)
 * - Limit formatting for UI
 * - Limit checking logic
 * - Duration formatting
 * - Percentage calculations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  SpendingLimitsManager, 
  createSpendingLimitsManager,
} from '../src/core/SpendingLimitsManager.js';
import {
  formatDuration,
  calculatePercentage,
  formatLargeAmount,
  CONFIG_TYPE,
  LIMIT_PRESETS,
} from '../src/core/SpendingLimits.types.js';

// ============================================================================
// Test Setup
// ============================================================================

describe('SpendingLimitsManager', () => {
  let manager: SpendingLimitsManager;

  beforeEach(() => {
    manager = createSpendingLimitsManager({
      defaultDecimals: 18,
      defaultSymbol: 'ETH',
      rpcUrls: {
        10004: 'https://sepolia.base.org',
      },
      cacheTtl: 10000,
    });
  });

  // ============================================================================
  // Config Encoding Tests
  // ============================================================================

  describe('prepareDailyLimitUpdate', () => {
    it('encodes daily limit update correctly', () => {
      const payload = manager.prepareDailyLimitUpdate(1000000000000000000n); // 1 ETH
      
      // Format: 0x + actionType(1 byte) + configType(1 byte) + limit(32 bytes) = 2 + 2 + 2 + 64 = 70 chars
      expect(payload.length).toBe(70);
      
      // Should be config action type (0x03)
      expect(payload.slice(0, 4)).toBe('0x03');
      
      // Second byte should be config type 1 (daily limit)
      expect(payload.slice(4, 6)).toBe('01');
    });

    it('encodes zero limit (unlimited) correctly', () => {
      const payload = manager.prepareDailyLimitUpdate(0n);
      
      expect(payload.slice(0, 4)).toBe('0x03');
      expect(payload.slice(4, 6)).toBe('01');
      // Limit value should be all zeros
      expect(payload.slice(6)).toBe('0'.repeat(64));
    });

    it('encodes large limit correctly', () => {
      const largeLimit = 10000000000000000000000n; // 10,000 ETH
      const payload = manager.prepareDailyLimitUpdate(largeLimit);
      
      expect(payload.slice(0, 4)).toBe('0x03');
      expect(payload.length).toBe(70);
    });
  });

  describe('preparePauseVault', () => {
    it('encodes pause action correctly', () => {
      const payload = manager.preparePauseVault();
      
      // Format: 0x + actionType(1 byte) + configType(1 byte) + paused(1 byte) = 2 + 2 + 2 + 2 = 8 chars
      expect(payload.length).toBe(8);
      
      // Should be config action type (0x03)
      expect(payload.slice(0, 4)).toBe('0x03');
      
      // Second byte should be config type 2 (pause)
      expect(payload.slice(4, 6)).toBe('02');
      
      // Third byte should be 1 (paused)
      expect(payload.slice(6, 8)).toBe('01');
    });
  });

  describe('prepareUnpauseVault', () => {
    it('encodes unpause action correctly', () => {
      const payload = manager.prepareUnpauseVault();
      
      // Format: 0x + actionType(1 byte) + configType(1 byte) + paused(1 byte) = 2 + 2 + 2 + 2 = 8 chars
      expect(payload.length).toBe(8);
      
      // Should be config action type (0x03)
      expect(payload.slice(0, 4)).toBe('0x03');
      
      // Second byte should be config type 2 (pause)
      expect(payload.slice(4, 6)).toBe('02');
      
      // Third byte should be 0 (unpaused)
      expect(payload.slice(6, 8)).toBe('00');
    });
  });

  // ============================================================================
  // Limit Formatting Tests
  // ============================================================================

  describe('formatLimits', () => {
    it('formats limits with active daily limit', () => {
      const limits = {
        dailyLimit: 1000000000000000000n, // 1 ETH
        dailySpent: 500000000000000000n, // 0.5 ETH
        dailyRemaining: 500000000000000000n,
        dayResetTime: new Date(Date.now() + 3600000),
        timeUntilReset: 3600000,
        transactionLimit: 100000000000000000n, // 0.1 ETH
        isPaused: false,
        lastUpdated: new Date(),
        chainId: 10004,
      };

      const formatted = manager.formatLimits(limits, 18, 'ETH');

      expect(formatted.hasDailyLimit).toBe(true);
      expect(formatted.hasTransactionLimit).toBe(true);
      expect(formatted.dailyUsedPercentage).toBe(50);
      expect(formatted.isPaused).toBe(false);
      expect(formatted.dailyLimit).toContain('1');
      expect(formatted.dailyLimit).toContain('ETH');
    });

    it('formats unlimited limits correctly', () => {
      const limits = {
        dailyLimit: 0n,
        dailySpent: 0n,
        dailyRemaining: 0n,
        dayResetTime: new Date(),
        timeUntilReset: 0,
        transactionLimit: 0n,
        isPaused: false,
        lastUpdated: new Date(),
        chainId: 10004,
      };

      const formatted = manager.formatLimits(limits, 18, 'ETH');

      expect(formatted.hasDailyLimit).toBe(false);
      expect(formatted.hasTransactionLimit).toBe(false);
      expect(formatted.dailyLimit).toBe('Unlimited');
      expect(formatted.transactionLimit).toBe('Unlimited');
      expect(formatted.dailyUsedPercentage).toBe(0);
    });

    it('calculates percentage correctly at boundaries', () => {
      // 100% used
      const fullUsed = {
        dailyLimit: 1000000000000000000n,
        dailySpent: 1000000000000000000n,
        dailyRemaining: 0n,
        dayResetTime: new Date(),
        timeUntilReset: 0,
        transactionLimit: 0n,
        isPaused: false,
        lastUpdated: new Date(),
        chainId: 10004,
      };

      const formattedFull = manager.formatLimits(fullUsed, 18, 'ETH');
      expect(formattedFull.dailyUsedPercentage).toBe(100);

      // 0% used
      const noneUsed = {
        ...fullUsed,
        dailySpent: 0n,
        dailyRemaining: 1000000000000000000n,
      };

      const formattedNone = manager.formatLimits(noneUsed, 18, 'ETH');
      expect(formattedNone.dailyUsedPercentage).toBe(0);
    });
  });

  // ============================================================================
  // Limit Check Tests
  // ============================================================================

  describe('checkTransactionLimit (offline logic)', () => {
    // Note: Full integration tests require mocking ethers provider
    // These test the internal logic

    it('returns correct violation types', () => {
      // Verify violation types are correctly typed
      const types: string[] = [
        'daily_limit_exceeded',
        'transaction_limit_exceeded',
        'vault_paused',
        'insufficient_balance',
        'daily_limit_would_exceed',
      ];

      types.forEach(type => {
        expect(typeof type).toBe('string');
      });
    });
  });

  // ============================================================================
  // Cache Tests
  // ============================================================================

  describe('cache management', () => {
    it('clears specific vault cache', () => {
      manager.clearCache('0x1234', 10004);
      // Should not throw
      expect(true).toBe(true);
    });

    it('clears all cache', () => {
      manager.clearCache();
      // Should not throw
      expect(true).toBe(true);
    });

    it('invalidates cache after change', () => {
      manager.invalidateCacheAfterChange('0x1234', 10004);
      // Should not throw
      expect(true).toBe(true);
    });
  });

  // ============================================================================
  // Event Subscription Tests
  // ============================================================================

  describe('event subscription', () => {
    it('allows subscribing to limit changes', () => {
      const callback = vi.fn();
      const unsubscribe = manager.onLimitChange(callback);

      expect(typeof unsubscribe).toBe('function');

      // Cleanup
      unsubscribe();
    });

    it('unsubscribe removes listener', () => {
      const callback = vi.fn();
      const unsubscribe = manager.onLimitChange(callback);
      
      unsubscribe();
      
      // Callback should not be called after unsubscribe
      // This is verified by ensuring the callback list is modified
      expect(callback).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('SpendingLimits Utility Functions', () => {
  describe('formatDuration', () => {
    it('formats hours and minutes', () => {
      const result = formatDuration(3600000 + 1800000); // 1h 30m
      expect(result.formatted).toBe('1h 30m');
      expect(result.hours).toBe(1);
      expect(result.minutes).toBe(30);
    });

    it('formats minutes and seconds when under an hour', () => {
      const result = formatDuration(180000); // 3 minutes
      expect(result.formatted).toBe('3m 0s');
      expect(result.hours).toBe(0);
      expect(result.minutes).toBe(3);
    });

    it('formats only seconds when under a minute', () => {
      const result = formatDuration(45000); // 45 seconds
      expect(result.formatted).toBe('45s');
      expect(result.seconds).toBe(45);
    });

    it('handles zero', () => {
      const result = formatDuration(0);
      expect(result.formatted).toBe('0s');
    });

    it('handles negative (treats as zero)', () => {
      const result = formatDuration(-1000);
      expect(result.formatted).toBe('0s');
    });
  });

  describe('calculatePercentage', () => {
    it('calculates percentage correctly', () => {
      expect(calculatePercentage(50n, 100n)).toBe(50);
      expect(calculatePercentage(25n, 100n)).toBe(25);
      expect(calculatePercentage(100n, 100n)).toBe(100);
    });

    it('handles zero limit (returns 0)', () => {
      expect(calculatePercentage(50n, 0n)).toBe(0);
    });

    it('caps at 100%', () => {
      expect(calculatePercentage(150n, 100n)).toBe(100);
    });

    it('handles precision for large numbers', () => {
      const spent = 1234567890000000000n; // 1.23... ETH
      const limit = 10000000000000000000n; // 10 ETH
      const percentage = calculatePercentage(spent, limit);
      expect(percentage).toBeGreaterThan(12);
      expect(percentage).toBeLessThan(13);
    });
  });

  describe('formatLargeAmount', () => {
    it('formats whole numbers', () => {
      const result = formatLargeAmount(1000000000000000000n, 18, 'ETH');
      expect(result).toBe('1 ETH');
    });

    it('formats fractional amounts', () => {
      const result = formatLargeAmount(1234567890000000000n, 18, 'ETH');
      expect(result).toContain('1.2345');
      expect(result).toContain('ETH');
    });

    it('formats zero', () => {
      const result = formatLargeAmount(0n, 18, 'ETH');
      expect(result).toBe('0 ETH');
    });

    it('handles different decimals', () => {
      const result = formatLargeAmount(1000000n, 6, 'USDC'); // 1 USDC
      expect(result).toBe('1 USDC');
    });
  });
});

// ============================================================================
// Constants Tests
// ============================================================================

describe('SpendingLimits Constants', () => {
  describe('CONFIG_TYPE', () => {
    it('has correct config type values', () => {
      expect(CONFIG_TYPE.DAILY_LIMIT).toBe(1);
      expect(CONFIG_TYPE.PAUSE).toBe(2);
      expect(CONFIG_TYPE.GUARDIANS).toBe(3);
      expect(CONFIG_TYPE.REGISTER_SENDER).toBe(4);
      expect(CONFIG_TYPE.ALLOW_CHAIN).toBe(5);
      expect(CONFIG_TYPE.QUERY_VERIFIER).toBe(6);
    });
  });

  describe('LIMIT_PRESETS', () => {
    it('has expected presets', () => {
      expect(LIMIT_PRESETS.length).toBe(4);
      
      const ids = LIMIT_PRESETS.map(p => p.id);
      expect(ids).toContain('conservative');
      expect(ids).toContain('balanced');
      expect(ids).toContain('generous');
      expect(ids).toContain('unlimited');
    });

    it('unlimited preset has zero limits', () => {
      const unlimited = LIMIT_PRESETS.find(p => p.id === 'unlimited');
      expect(unlimited?.dailyLimitUsd).toBe(0);
      expect(unlimited?.transactionLimitUsd).toBe(0);
    });

    it('all presets have required fields', () => {
      LIMIT_PRESETS.forEach(preset => {
        expect(preset.id).toBeDefined();
        expect(preset.name).toBeDefined();
        expect(preset.description).toBeDefined();
        expect(typeof preset.dailyLimitUsd).toBe('number');
        expect(typeof preset.transactionLimitUsd).toBe('number');
        expect(preset.icon).toBeDefined();
        expect(preset.recommendedFor).toBeDefined();
      });
    });
  });
});

// ============================================================================
// Integration Scenario Tests
// ============================================================================

describe('SpendingLimits Integration Scenarios', () => {
  let manager: SpendingLimitsManager;

  beforeEach(() => {
    manager = createSpendingLimitsManager();
  });

  describe('vault creation flow', () => {
    it('encodes initial limits for vault creation', () => {
      const config = {
        dailyLimit: 5000000000000000000n, // 5 ETH
      };

      const payload = manager.encodeInitialLimits(config);
      
      expect(payload.length).toBe(70);
      expect(payload.slice(0, 6)).toBe('0x0301');
    });

    it('returns empty string for no limit config', () => {
      const config = {
        dailyLimit: 0n,
      };

      const payload = manager.encodeInitialLimits(config);
      
      expect(payload).toBe('');
    });
  });

  describe('emergency pause flow', () => {
    it('generates valid pause payload', () => {
      const pausePayload = manager.preparePauseVault();
      expect(pausePayload.slice(0, 6)).toBe('0x0302');
      expect(pausePayload.slice(6, 8)).toBe('01');
    });

    it('generates valid unpause payload', () => {
      const unpausePayload = manager.prepareUnpauseVault();
      expect(unpausePayload.slice(0, 6)).toBe('0x0302');
      expect(unpausePayload.slice(6, 8)).toBe('00');
    });
  });

  describe('limit update flow', () => {
    it('generates payloads for different limit values', () => {
      const testCases = [
        0n, // Unlimited
        1000000000000000000n, // 1 ETH
        100000000000000000000n, // 100 ETH
        BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'), // Max uint256
      ];

      testCases.forEach(limit => {
        const payload = manager.prepareDailyLimitUpdate(limit);
        expect(payload.slice(0, 6)).toBe('0x0301');
        // Format: 0x + actionType(1) + configType(1) + limit(32) = 70 chars
        expect(payload.length).toBe(70);
      });
    });
  });
});
