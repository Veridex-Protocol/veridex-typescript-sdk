/**
 * Veridex Protocol SDK — Enterprise Manager
 *
 * Bundles the operations that enterprise / integrator back-ends need:
 *   - Batch vault creation across chains
 *   - Admin spending limit management for multiple vaults
 *   - Server-side signing helpers (non-WebAuthn path)
 *   - Pre-built webhook-style event subscription
 *
 * All features delegate to existing SDK primitives — this is an
 * orchestration layer, not a divergent code path.
 */

import type { VeridexSDK } from './VeridexSDK.js';
import type { MultiChainVaultResult, ChainDeploymentConfig } from './GasSponsor.js';
import type { SpendingLimits } from './SpendingLimits.types.js';
import type { PortfolioBalance } from './BalanceManager.js';
import type { TransferParams, TransferResult } from './types.js';
import type { BalanceChangeCallback, BalanceErrorCallback, BalanceWatcherOptions, Unsubscribe } from './BalanceWatcher.js';
import { BalanceWatcher } from './BalanceWatcher.js';

// ============================================================================
// Types
// ============================================================================

export interface EnterpriseManagerConfig {
    /**
     * The VeridexSDK instance (typically created via `createSDK` or
     * `createEnterpriseSDK` with a sponsor key).
     */
    sdk: VeridexSDK;
    /**
     * Maximum concurrent operations for batch methods (default: 3).
     */
    maxConcurrency?: number;
}

export interface BatchVaultRequest {
    /** Key hashes to create vaults for */
    keyHashes: string[];
    /** Optional: specific chain IDs to create vaults on (defaults to all sponsored chains) */
    chainIds?: number[];
    /** Maximum concurrent vault creations (overrides config default) */
    maxConcurrency?: number;
}

export interface BatchVaultResult {
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{
        keyHash: string;
        result: MultiChainVaultResult | null;
        error?: string;
    }>;
}

export interface BatchTransferRequest {
    /** Transfers to execute */
    transfers: TransferParams[];
    /** Signer to pay for gas */
    signer: any;
    /** Maximum concurrent transfers (overrides config default) */
    maxConcurrency?: number;
}

export interface BatchTransferResult {
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{
        params: TransferParams;
        result: TransferResult | null;
        error?: string;
    }>;
}

export interface BatchSpendingLimitRequest {
    /** Vault addresses and their new daily limit */
    updates: Array<{
        /** New daily limit in wei/base units (0 = unlimited) */
        newLimit: bigint;
    }>;
    /** Signer to pay for gas */
    signer: any;
}

export interface BatchSpendingLimitResult {
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{
        newLimit: bigint;
        result: TransferResult | null;
        error?: string;
    }>;
}

/** Lifecycle event types for batch operations */
export type BatchLifecycleEvent =
    | { type: 'started'; total: number }
    | { type: 'item_started'; index: number; total: number }
    | { type: 'item_completed'; index: number; total: number; success: boolean; error?: string }
    | { type: 'completed'; succeeded: number; failed: number; total: number };

/** Callback for batch operation lifecycle events */
export type BatchLifecycleCallback = (event: BatchLifecycleEvent) => void;

export interface VaultOverview {
    keyHash: string;
    vaultAddress: string;
    wormholeChainId: number;
    exists: boolean;
    balance?: PortfolioBalance;
    limits?: SpendingLimits;
}

// ============================================================================
// EnterpriseManager class
// ============================================================================

/**
 * High-level orchestration for enterprise / integrator use cases.
 *
 * @example
 * ```typescript
 * import { createEnterpriseSDK, EnterpriseManager } from '@veridex/sdk';
 *
 * const sdk = createEnterpriseSDK({
 *   sponsorPrivateKey: process.env.SPONSOR_KEY!,
 *   relayerUrl: 'https://relayer.veridex.network',
 *   relayerApiKey: 'key',
 * });
 *
 * const enterprise = new EnterpriseManager({ sdk });
 *
 * // Batch create vaults for 50 users
 * const result = await enterprise.batchCreateVaults({
 *   keyHashes: userKeyHashes,
 * });
 *
 * // Watch all vaults for balance changes
 * const unsub = enterprise.watchVaultBalance(
 *   10004, vaultAddress,
 *   (event) => callWebhook(event),
 * );
 * ```
 */
export class EnterpriseManager {
    private readonly sdk: VeridexSDK;
    private readonly balanceWatcher: BalanceWatcher;
    private readonly maxConcurrency: number;

    constructor(config: EnterpriseManagerConfig) {
        this.sdk = config.sdk;
        this.maxConcurrency = config.maxConcurrency ?? 3;

        // Build a balance fetcher that delegates to the SDK's balance manager
        this.balanceWatcher = new BalanceWatcher(
            async (chainId, address) => {
                return this.sdk.balance.getPortfolioBalance(chainId, address, false);
            },
        );
    }

    // ========================================================================
    // Concurrency Helper
    // ========================================================================

    /**
     * Run tasks with bounded concurrency.
     */
    private async runWithConcurrency<T>(
        tasks: Array<() => Promise<T>>,
        maxConcurrency: number,
    ): Promise<T[]> {
        const results: T[] = new Array(tasks.length);
        let nextIndex = 0;

        async function worker() {
            while (nextIndex < tasks.length) {
                const idx = nextIndex++;
                results[idx] = await tasks[idx]();
            }
        }

        const workers = Array.from(
            { length: Math.min(maxConcurrency, tasks.length) },
            () => worker(),
        );
        await Promise.all(workers);
        return results;
    }

    // ========================================================================
    // Batch Vault Operations
    // ========================================================================

    /**
     * Create sponsored vaults for multiple users with concurrency control.
     *
     * Uses the SDK's GasSponsor under the hood.  Errors for individual
     * key hashes are captured, not thrown — the batch continues.
     */
    async batchCreateVaults(
        request: BatchVaultRequest,
        onLifecycle?: BatchLifecycleCallback,
    ): Promise<BatchVaultResult> {
        const concurrency = request.maxConcurrency ?? this.maxConcurrency;
        const results: BatchVaultResult['results'] = new Array(request.keyHashes.length);

        onLifecycle?.({ type: 'started', total: request.keyHashes.length });

        const tasks = request.keyHashes.map((keyHash, index) => async () => {
            onLifecycle?.({ type: 'item_started', index, total: request.keyHashes.length });
            try {
                const result = await this.sdk.sponsor.createVaultsOnAllChains(keyHash);
                results[index] = { keyHash, result };
                onLifecycle?.({ type: 'item_completed', index, total: request.keyHashes.length, success: true });
            } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                results[index] = { keyHash, result: null, error };
                onLifecycle?.({ type: 'item_completed', index, total: request.keyHashes.length, success: false, error });
            }
        });

        await this.runWithConcurrency(tasks, concurrency);

        const succeeded = results.filter(r => r.result?.allSuccessful).length;
        const failed = request.keyHashes.length - succeeded;
        onLifecycle?.({ type: 'completed', succeeded, failed, total: request.keyHashes.length });

        return {
            total: request.keyHashes.length,
            succeeded,
            failed,
            results,
        };
    }

    /**
     * Check vault existence across all sponsored chains for a key hash.
     */
    async checkVaults(keyHash: string): Promise<Record<number, { exists: boolean; address: string }>> {
        return this.sdk.sponsor.checkVaultsOnAllChains(keyHash);
    }

    /**
     * List all chains where sponsorship is available.
     */
    getSponsoredChains(): ChainDeploymentConfig[] {
        return this.sdk.sponsor.getSupportedChains();
    }

    // ========================================================================
    // Batch Transfers
    // ========================================================================

    /**
     * Execute multiple transfers with concurrency control.
     *
     * Each transfer is prepared and executed independently. Errors are
     * captured per-transfer so the batch continues on individual failures.
     *
     * @example
     * ```typescript
     * const result = await enterprise.batchTransfer({
     *   transfers: [
     *     { targetChain: 10004, token: '0x...', recipient: '0xAlice', amount: 1000000n },
     *     { targetChain: 10004, token: '0x...', recipient: '0xBob',   amount: 2000000n },
     *   ],
     *   signer,
     *   maxConcurrency: 2,
     * }, (event) => console.log(event.type, event));
     * ```
     */
    async batchTransfer(
        request: BatchTransferRequest,
        onLifecycle?: BatchLifecycleCallback,
    ): Promise<BatchTransferResult> {
        const concurrency = request.maxConcurrency ?? this.maxConcurrency;
        const results: BatchTransferResult['results'] = new Array(request.transfers.length);

        onLifecycle?.({ type: 'started', total: request.transfers.length });

        const tasks = request.transfers.map((params, index) => async () => {
            onLifecycle?.({ type: 'item_started', index, total: request.transfers.length });
            try {
                const prepared = await this.sdk.prepareTransfer(params);
                const result = await this.sdk.executeTransfer(prepared, request.signer);
                results[index] = { params, result };
                onLifecycle?.({ type: 'item_completed', index, total: request.transfers.length, success: true });
            } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                results[index] = { params, result: null, error };
                onLifecycle?.({ type: 'item_completed', index, total: request.transfers.length, success: false, error });
            }
        });

        await this.runWithConcurrency(tasks, concurrency);

        const succeeded = results.filter(r => r.result !== null).length;
        const failed = request.transfers.length - succeeded;
        onLifecycle?.({ type: 'completed', succeeded, failed, total: request.transfers.length });

        return {
            total: request.transfers.length,
            succeeded,
            failed,
            results,
        };
    }

    // ========================================================================
    // Batch Spending Limits
    // ========================================================================

    /**
     * Update daily spending limits for the current vault in sequence.
     *
     * Each limit update requires a passkey signature, so these are executed
     * one-at-a-time (signing cannot be parallelized).
     *
     * @example
     * ```typescript
     * const result = await enterprise.batchSetSpendingLimits({
     *   updates: [
     *     { newLimit: ethers.parseEther('5.0') },
     *     { newLimit: ethers.parseEther('10.0') },
     *   ],
     *   signer,
     * });
     * ```
     */
    async batchSetSpendingLimits(
        request: BatchSpendingLimitRequest,
        onLifecycle?: BatchLifecycleCallback,
    ): Promise<BatchSpendingLimitResult> {
        const results: BatchSpendingLimitResult['results'] = [];

        onLifecycle?.({ type: 'started', total: request.updates.length });

        for (let i = 0; i < request.updates.length; i++) {
            const update = request.updates[i];
            onLifecycle?.({ type: 'item_started', index: i, total: request.updates.length });
            try {
                const prepared = await this.sdk.prepareSetDailyLimit(update.newLimit);
                const result = await this.sdk.executeTransfer(prepared, request.signer);
                results.push({ newLimit: update.newLimit, result });
                onLifecycle?.({ type: 'item_completed', index: i, total: request.updates.length, success: true });
            } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                results.push({ newLimit: update.newLimit, result: null, error });
                onLifecycle?.({ type: 'item_completed', index: i, total: request.updates.length, success: false, error });
            }
        }

        const succeeded = results.filter(r => r.result !== null).length;
        const failed = request.updates.length - succeeded;
        onLifecycle?.({ type: 'completed', succeeded, failed, total: request.updates.length });

        return {
            total: request.updates.length,
            succeeded,
            failed,
            results,
        };
    }

    // ========================================================================
    // Admin Spending Limits
    // ========================================================================

    /**
     * Read spending limits for any vault address on the current chain.
     * Useful for admin dashboards that need to inspect user vaults.
     */
    async getSpendingLimitsForVault(
        vaultAddress: string,
        wormholeChainId?: number,
    ): Promise<SpendingLimits> {
        const chainId = wormholeChainId ?? this.sdk.getChainConfig().wormholeChainId;
        const rpcUrl = this.sdk.getChainConfig().rpcUrl;
        return this.sdk.spendingLimits.getSpendingLimits(vaultAddress, chainId, rpcUrl);
    }

    /**
     * Read spending limits for multiple vaults in parallel.
     */
    async getSpendingLimitsForVaults(
        vaultAddresses: string[],
        wormholeChainId?: number,
    ): Promise<Map<string, SpendingLimits | Error>> {
        const chainId = wormholeChainId ?? this.sdk.getChainConfig().wormholeChainId;
        const rpcUrl = this.sdk.getChainConfig().rpcUrl;

        const entries = await Promise.allSettled(
            vaultAddresses.map(async addr => {
                const limits = await this.sdk.spendingLimits.getSpendingLimits(addr, chainId, rpcUrl);
                return [addr, limits] as const;
            }),
        );

        const map = new Map<string, SpendingLimits | Error>();
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const addr = vaultAddresses[i];
            if (entry.status === 'fulfilled') {
                map.set(addr, entry.value[1]);
            } else {
                map.set(addr, entry.reason instanceof Error ? entry.reason : new Error(String(entry.reason)));
            }
        }
        return map;
    }

    // ========================================================================
    // Balance Watching (Subscription / Webhook-style)
    // ========================================================================

    /**
     * Watch a vault's balance for changes.
     *
     * The callback fires whenever the polling interval detects a difference.
     * Returns an unsubscribe function.
     *
     * @example
     * ```typescript
     * const unsub = enterprise.watchVaultBalance(
     *   10004,
     *   '0xVaultAddr',
     *   (event) => {
     *     // Push to webhook, update dashboard, etc.
     *     fetch(webhookUrl, { method: 'POST', body: JSON.stringify(event) });
     *   },
     *   { intervalMs: 10_000 },
     * );
     * ```
     */
    watchVaultBalance(
        wormholeChainId: number,
        address: string,
        onChange: BalanceChangeCallback,
        options?: BalanceWatcherOptions,
        onError?: BalanceErrorCallback,
    ): Unsubscribe {
        return this.balanceWatcher.watch(wormholeChainId, address, onChange, options, onError);
    }

    /**
     * Stop all active balance watchers.
     */
    stopAllWatchers(): void {
        this.balanceWatcher.stopAll();
    }

    /**
     * Get number of active balance watchers.
     */
    get activeWatcherCount(): number {
        return this.balanceWatcher.activeCount;
    }

    // ========================================================================
    // Vault Overview (Dashboard)
    // ========================================================================

    /**
     * Get a combined overview for a vault: existence, balances, limits.
     *
     * Useful for rendering an admin dashboard row.
     */
    async getVaultOverview(
        keyHash: string,
        wormholeChainId?: number,
    ): Promise<VaultOverview> {
        const chainId = wormholeChainId ?? this.sdk.getChainConfig().wormholeChainId;
        const chainClient = this.sdk.getChainClient();
        const vaultAddress = chainClient.computeVaultAddress(keyHash);
        const exists = await chainClient.vaultExists(keyHash);

        let balance: PortfolioBalance | undefined;
        let limits: SpendingLimits | undefined;

        if (exists) {
            try {
                balance = await this.sdk.balance.getPortfolioBalance(chainId, vaultAddress, false);
            } catch { /* swallow — non-critical */ }

            try {
                limits = await this.getSpendingLimitsForVault(vaultAddress, chainId);
            } catch { /* swallow — non-critical */ }
        }

        return {
            keyHash,
            vaultAddress,
            wormholeChainId: chainId,
            exists,
            balance,
            limits,
        };
    }
}
