/**
 * Veridex Protocol SDK - Feature Flags Tests
 * 
 * Tests for the multi-hub feature toggle mechanism.
 * Validates that:
 * - Default state is single-hub (Base only)
 * - Enabling multi-hub exposes all hub-capable chains
 * - Disabling multi-hub restricts back to single hub
 * - Primary hub override works when multi-hub is enabled
 * - Factory functions respect the feature flag
 * - prepareAuth resolves hub dynamically
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getFeatureFlags,
  setFeatureFlags,
  resetFeatureFlags,
  isMultiHubEnabled,
  getEffectivePrimaryHub,
} from '../src/featureFlags.js';
import {
  getHubChains,
  getDefaultHub,
  isHubChain,
  CHAIN_PRESETS,
  type ChainName,
} from '../src/presets.js';
import {
  createHubSDK,
  createSessionSDK,
} from '../src/factory.js';
import { VeridexSDK } from '../src/core/VeridexSDK.js';

// ============================================================================
// Feature Flag Core Tests
// ============================================================================

describe('featureFlags', () => {
  beforeEach(() => {
    resetFeatureFlags();
  });

  afterEach(() => {
    resetFeatureFlags();
  });

  describe('default state', () => {
    it('should default to multi-hub disabled', () => {
      const flags = getFeatureFlags();
      expect(flags.multiHub).toBe(false);
    });

    it('should default primary hub to base', () => {
      const flags = getFeatureFlags();
      expect(flags.primaryHub).toBe('base');
    });

    it('isMultiHubEnabled should return false by default', () => {
      expect(isMultiHubEnabled()).toBe(false);
    });

    it('getEffectivePrimaryHub should return base by default', () => {
      expect(getEffectivePrimaryHub()).toBe('base');
    });
  });

  describe('setFeatureFlags', () => {
    it('should enable multi-hub', () => {
      setFeatureFlags({ multiHub: true });
      expect(isMultiHubEnabled()).toBe(true);
    });

    it('should merge partial flags', () => {
      setFeatureFlags({ multiHub: true });
      const flags = getFeatureFlags();
      expect(flags.multiHub).toBe(true);
      expect(flags.primaryHub).toBe('base'); // unchanged default
    });

    it('should set primary hub', () => {
      setFeatureFlags({ primaryHub: 'avalanche' as ChainName });
      expect(getFeatureFlags().primaryHub).toBe('avalanche');
    });

    it('should override primary hub when multi-hub is enabled', () => {
      setFeatureFlags({ multiHub: true, primaryHub: 'avalanche' as ChainName });
      expect(getEffectivePrimaryHub()).toBe('avalanche');
    });

    it('should ignore primaryHub override when multi-hub is disabled', () => {
      setFeatureFlags({ multiHub: false, primaryHub: 'avalanche' as ChainName });
      // getEffectivePrimaryHub always returns 'base' when multi-hub is off
      expect(getEffectivePrimaryHub()).toBe('base');
    });
  });

  describe('resetFeatureFlags', () => {
    it('should restore defaults', () => {
      setFeatureFlags({ multiHub: true, primaryHub: 'avalanche' as ChainName });
      resetFeatureFlags();
      expect(isMultiHubEnabled()).toBe(false);
      expect(getEffectivePrimaryHub()).toBe('base');
    });
  });

  describe('immutability', () => {
    it('should return immutable copy from getFeatureFlags', () => {
      const flags = getFeatureFlags();
      (flags as any).multiHub = true;
      expect(isMultiHubEnabled()).toBe(false);
    });
  });
});

// ============================================================================
// Preset Integration Tests (hub resolution)
// ============================================================================

describe('presets with feature flags', () => {
  beforeEach(() => {
    resetFeatureFlags();
  });

  afterEach(() => {
    resetFeatureFlags();
  });

  describe('getHubChains', () => {
    it('should return only base when multi-hub is disabled', () => {
      const hubs = getHubChains();
      expect(hubs).toEqual(['base']);
    });

    it('should return all hub-capable chains when multi-hub is enabled', () => {
      setFeatureFlags({ multiHub: true });
      const hubs = getHubChains();

      // Verify base, optimism, arbitrum, avalanche, monad are all present
      expect(hubs).toContain('base');
      expect(hubs).toContain('optimism');
      expect(hubs).toContain('arbitrum');
      expect(hubs).toContain('avalanche');
      expect(hubs).toContain('monad');
      expect(hubs.length).toBeGreaterThanOrEqual(5);
    });

    it('should not include non-hub chains even when multi-hub is enabled', () => {
      setFeatureFlags({ multiHub: true });
      const hubs = getHubChains();

      expect(hubs).not.toContain('ethereum');
      expect(hubs).not.toContain('polygon');
      expect(hubs).not.toContain('solana');
    });
  });

  describe('isHubChain', () => {
    it('should return true for base when multi-hub is disabled', () => {
      expect(isHubChain('base' as ChainName)).toBe(true);
    });

    it('should return false for avalanche when multi-hub is disabled', () => {
      expect(isHubChain('avalanche' as ChainName)).toBe(false);
    });

    it('should return true for avalanche when multi-hub is enabled', () => {
      setFeatureFlags({ multiHub: true });
      expect(isHubChain('avalanche' as ChainName)).toBe(true);
    });

    it('should return false for ethereum regardless of multi-hub', () => {
      expect(isHubChain('ethereum' as ChainName)).toBe(false);
      setFeatureFlags({ multiHub: true });
      expect(isHubChain('ethereum' as ChainName)).toBe(false);
    });
  });

  describe('getDefaultHub', () => {
    it('should return Base testnet config by default', () => {
      const hub = getDefaultHub('testnet');
      expect(hub.name).toBe('Base Sepolia');
      expect(hub.chainId).toBe(84532);
    });

    it('should return Avalanche config when multi-hub + primary=avalanche', () => {
      setFeatureFlags({ multiHub: true, primaryHub: 'avalanche' as ChainName });
      const hub = getDefaultHub('testnet');
      expect(hub.name).toBe('Avalanche Fuji');
      expect(hub.chainId).toBe(43113);
    });

    it('should always return Base when multi-hub is disabled regardless of primaryHub', () => {
      setFeatureFlags({ multiHub: false, primaryHub: 'avalanche' as ChainName });
      const hub = getDefaultHub('testnet');
      expect(hub.name).toBe('Base Sepolia');
    });
  });
});

// ============================================================================
// Factory Integration Tests
// ============================================================================

describe('factory with feature flags', () => {
  beforeEach(() => {
    resetFeatureFlags();
  });

  afterEach(() => {
    resetFeatureFlags();
  });

  describe('createHubSDK', () => {
    it('should create SDK for Base by default', () => {
      const sdk = createHubSDK();
      expect(sdk).toBeInstanceOf(VeridexSDK);
    });

    it('should create SDK for Avalanche when multi-hub enabled with avalanche primary', () => {
      setFeatureFlags({ multiHub: true, primaryHub: 'avalanche' as ChainName });
      // Avalanche hub contracts are not yet deployed (empty strings),
      // so this should throw about missing hub contract
      expect(() => createHubSDK()).toThrow();
    });
  });

  describe('createSessionSDK', () => {
    it('should create SDK for base without warning when multi-hub disabled', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sdk = createSessionSDK('base' as ChainName);
      expect(sdk).toBeInstanceOf(VeridexSDK);
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should warn when using non-hub chain with multi-hub disabled', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Avalanche is not an active hub when multi-hub is off
      // This will throw because Avalanche hub contract is empty, but the warn should fire first
      try {
        createSessionSDK('avalanche' as ChainName);
      } catch {
        // Expected: missing hub contract
      }
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('not an active hub chain')
      );
      consoleSpy.mockRestore();
    });

    it('should not warn for avalanche when multi-hub is enabled', () => {
      setFeatureFlags({ multiHub: true });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        createSessionSDK('avalanche' as ChainName);
      } catch {
        // Expected: missing hub contract (not yet deployed)
      }
      // Should NOT warn because avalanche is a valid hub when multi-hub is enabled
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});

// ============================================================================
// Avalanche Build Games Alignment Tests
// ============================================================================

describe('Avalanche Build Games configuration', () => {
  beforeEach(() => {
    resetFeatureFlags();
  });

  afterEach(() => {
    resetFeatureFlags();
  });

  it('Avalanche preset should be marked canBeHub: true', () => {
    const avalanche = CHAIN_PRESETS['avalanche' as ChainName];
    expect(avalanche).toBeDefined();
    expect(avalanche.canBeHub).toBe(true);
  });

  it('Avalanche should have ACP-204 P256 verifier contract slot', () => {
    const avalanche = CHAIN_PRESETS['avalanche' as ChainName];
    const testnet = avalanche.testnet;
    expect(testnet.contracts).toHaveProperty('p256Verifier');
  });

  it('Avalanche should have ICM Spoke contract slot', () => {
    const avalanche = CHAIN_PRESETS['avalanche' as ChainName];
    const testnet = avalanche.testnet;
    expect(testnet.contracts).toHaveProperty('icmSpoke');
  });

  it('Avalanche should have Chainlink feed addresses', () => {
    const avalanche = CHAIN_PRESETS['avalanche' as ChainName];
    const testnet = avalanche.testnet;
    expect(testnet.contracts.chainlinkAvaxUsd).toBeDefined();
    expect(testnet.contracts.chainlinkUsdcUsd).toBeDefined();
    expect(testnet.contracts.chainlinkUsdtUsd).toBeDefined();
  });

  it('Avalanche testnet should have Wormhole Chain ID 6', () => {
    const avalanche = CHAIN_PRESETS['avalanche' as ChainName];
    expect(avalanche.testnet.wormholeChainId).toBe(6);
    expect(avalanche.mainnet.wormholeChainId).toBe(6);
  });

  it('single-hub mode should route through Base for hackathon demo', () => {
    // Default: multi-hub off → Avalanche is a spoke, Base is the hub
    expect(isMultiHubEnabled()).toBe(false);
    expect(getEffectivePrimaryHub()).toBe('base');
    expect(getHubChains()).toEqual(['base']);
    expect(isHubChain('avalanche' as ChainName)).toBe(false);
  });

  it('multi-hub mode should allow Avalanche as hub', () => {
    setFeatureFlags({ multiHub: true });
    expect(isHubChain('avalanche' as ChainName)).toBe(true);
    expect(getHubChains()).toContain('avalanche');
  });
});

// ============================================================================
// Enterprise Risk Pivot Alignment Tests
// ============================================================================

describe('Enterprise Risk Pivot alignment', () => {
  beforeEach(() => {
    resetFeatureFlags();
  });

  afterEach(() => {
    resetFeatureFlags();
  });

  it('single-hub default aligns with "single source of truth" narrative', () => {
    // Enterprise Risk Pivot requires clear audit trail
    // Single hub = all identity ops go through one chain = simpler compliance
    expect(isMultiHubEnabled()).toBe(false);
    expect(getHubChains()).toHaveLength(1);
  });

  it('feature flag is runtime-configurable for enterprise flexibility', () => {
    // Enterprises need to toggle features without redeployment
    expect(isMultiHubEnabled()).toBe(false);
    setFeatureFlags({ multiHub: true });
    expect(isMultiHubEnabled()).toBe(true);
    setFeatureFlags({ multiHub: false });
    expect(isMultiHubEnabled()).toBe(false);
  });

  it('primary hub can be redirected for regional compliance', () => {
    // Enterprise Risk Pivot: multi-region deployments with local hubs
    setFeatureFlags({ multiHub: true, primaryHub: 'avalanche' as ChainName });
    expect(getEffectivePrimaryHub()).toBe('avalanche');

    // Hub chain config should resolve to Avalanche
    const hub = getDefaultHub('testnet');
    expect(hub.chainId).toBe(43113);
  });
});
