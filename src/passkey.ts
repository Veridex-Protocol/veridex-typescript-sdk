/**
 * Standalone passkey subpath export.
 * 
 * This module re-exports ONLY the PasskeyManager and its types,
 * avoiding the heavy barrel export that pulls in Wormhole/query dependencies.
 *
 * Usage: import { PasskeyManager } from '@veridex/sdk/passkey';
 */
export { PasskeyManager, detectRpId, VERIDEX_RP_ID, supportsRelatedOrigins } from './core/PasskeyManager.js';
export type { PasskeyCredential, PasskeyManagerConfig, WebAuthnSignature } from './core/PasskeyManager.js';
