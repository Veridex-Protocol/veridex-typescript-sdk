/**
 * Veridex Protocol SDK - EVM Hub Client Adapter
 * 
 * Adapts EVMClient to work with SessionManager's HubClient interface.
 * Provides a clean integration layer between session management and chain clients.
 */

import type { HubClient } from '../../sessions/index.js';
import type { RegisterSessionParams, RevokeSessionParams } from '../../types.js';
import type { EVMClient } from './EVMClient.js';
import type { ethers } from 'ethers';

/**
 * Adapter that makes EVMClient compatible with SessionManager's HubClient interface
 * 
 * Usage:
 * ```typescript
 * const hubAdapter = new EVMHubClientAdapter(evmClient, signer);
 * const sessionManager = new SessionManager(
 *   credential,
 *   hubAdapter,
 *   config
 * );
 * ```
 */
export class EVMHubClientAdapter implements HubClient {
    constructor(
        private evmClient: EVMClient,
        private signer: ethers.Signer
    ) {}
    
    /**
     * Register a session on the Hub
     * 
     * @param params Registration parameters with Passkey signature
     * @returns Promise that resolves when registration completes
     */
    async registerSession(params: RegisterSessionParams): Promise<void> {
        // Call EVMClient's registerSession method
        await this.evmClient.registerSession(params, this.signer);
    }
    
    /**
     * Revoke a session on the Hub
     * 
     * @param params Revocation parameters with Passkey signature
     * @returns Promise that resolves when revocation completes
     */
    async revokeSession(params: RevokeSessionParams): Promise<void> {
        // Call EVMClient's revokeSession method
        await this.evmClient.revokeSession(params, this.signer);
    }

    /**
     * Revoke all sessions for an identity on the Hub.
     *
     * Currently delegates to the single-revoke path since the Hub contract
     * does not yet expose a batch-revoke entry point.  Subclasses or future
     * Hub versions can override this with a true batch call.
     * 
     * @param params Revocation parameters with Passkey signature
     * @returns Number of sessions revoked (always 1 for now)
     */
    async revokeAllSessions(params: RevokeSessionParams): Promise<number> {
        // TODO: Replace with a true batch-revoke Hub call when the contract
        //       supports it.  For now, revoke the session identified by the
        //       keyHash (or a sentinel-based wipe if the contract supports it).
        await this.evmClient.revokeSession(params, this.signer);
        return 1;
    }
    
    /**
     * Update the signer (e.g., when switching accounts)
     * 
     * @param signer New Ethereum signer
     */
    updateSigner(signer: ethers.Signer): void {
        this.signer = signer;
    }
}
