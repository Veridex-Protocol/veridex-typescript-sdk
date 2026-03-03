/**
 * Veridex Protocol SDK - Feature Flags
 * 
 * Centralized feature flag management for toggling SDK capabilities.
 * These flags allow operators to enable/disable features at runtime,
 * which is critical for:
 * - Hackathon demos (Avalanche Build Games: single hub for simplicity)
 * - Enterprise deployments (controlled rollout of multi-hub)
 * - Compliance (restrict routing to audited chains only)
 * 
 * ## Multi-Hub Feature
 * 
 * When `multiHub` is **disabled** (default):
 * - Only the primary hub chain (Base) is used for identity and session management
 * - `getHubChains()` returns only `['base']`
 * - `getDefaultHub()` returns Base config
 * - Avalanche operates as a spoke chain (payments only, identity on Base)
 * 
 * When `multiHub` is **enabled**:
 * - All chains marked `canBeHub: true` are available as hubs
 * - `getHubChains()` returns all hub-capable chains
 * - `getDefaultHub()` can be overridden to point at any hub chain
 * - Avalanche can operate as a secondary hub with its own identity registry
 * 
 * ## Enterprise Risk Alignment
 * 
 * Feature flags enable the "Enterprise Trust Firewall" narrative:
 * - Single hub = single source of truth = simpler audit trail
 * - Multi-hub = horizontal scaling for enterprise multi-region deployments
 * - Trace logging integration points are hub-aware
 * 
 * @example
 * ```typescript
 * import { setFeatureFlags, getFeatureFlags } from '@veridex/sdk';
 * 
 * // Disable multi-hub (default for hackathon demos)
 * setFeatureFlags({ multiHub: false });
 * 
 * // Enable multi-hub for enterprise deployment
 * setFeatureFlags({ multiHub: true });
 * 
 * // Check current flags
 * const flags = getFeatureFlags();
 * console.log(flags.multiHub); // false
 * ```
 */

import type { ChainName } from './presets.js';

// ============================================================================
// Feature Flag Types
// ============================================================================

export interface FeatureFlags {
  /**
   * Enable multi-hub architecture.
   * 
   * When false (default), only 'base' is treated as a hub chain.
   * When true, all chains with `canBeHub: true` in presets are available.
   * 
   * @default false
   */
  multiHub: boolean;

  /**
   * Primary hub chain override.
   * 
   * When multiHub is false, this is ignored (always 'base').
   * When multiHub is true, this sets the preferred hub chain.
   * 
   * @default 'base'
   */
  primaryHub: ChainName;
}

// ============================================================================
// Default Flags
// ============================================================================

const DEFAULT_FLAGS: FeatureFlags = {
  multiHub: false,
  primaryHub: 'base' as ChainName,
};

// ============================================================================
// Global State
// ============================================================================

let _flags: FeatureFlags = { ...DEFAULT_FLAGS };

// ============================================================================
// Public API
// ============================================================================

/**
 * Get current feature flags (immutable copy).
 */
export function getFeatureFlags(): Readonly<FeatureFlags> {
  return { ..._flags };
}

/**
 * Set feature flags. Merges with current flags.
 * 
 * @param flags - Partial flags to merge
 * 
 * @example
 * ```typescript
 * // Enable multi-hub
 * setFeatureFlags({ multiHub: true });
 * 
 * // Set Avalanche as primary hub
 * setFeatureFlags({ multiHub: true, primaryHub: 'avalanche' });
 * ```
 */
export function setFeatureFlags(flags: Partial<FeatureFlags>): void {
  _flags = { ..._flags, ...flags };
}

/**
 * Reset feature flags to defaults.
 * Useful for testing and cleanup.
 */
export function resetFeatureFlags(): void {
  _flags = { ...DEFAULT_FLAGS };
}

/**
 * Check if multi-hub is enabled.
 * Convenience function used throughout the SDK.
 */
export function isMultiHubEnabled(): boolean {
  return _flags.multiHub;
}

/**
 * Get the effective primary hub chain name.
 * 
 * When multiHub is false, always returns 'base'.
 * When multiHub is true, returns the configured primaryHub.
 */
export function getEffectivePrimaryHub(): ChainName {
  if (!_flags.multiHub) {
    return 'base' as ChainName;
  }
  return _flags.primaryHub;
}
