/**
 * Veridex Protocol SDK — Balance Watcher
 *
 * Provides a polling-based subscription API for vault balance changes.
 * Returns an unsubscribe function so integrators can react to incoming
 * transfers, outgoing withdrawals, or spending limit resets without
 * manually implementing polling.
 *
 * Where chains expose WebSocket endpoints in the future, this module
 * can be extended to use push-based notifications without changing the
 * public API surface.
 */

import type { PortfolioBalance, TokenBalance } from './BalanceManager.js';

// ============================================================================
// Types
// ============================================================================

/** Event types emitted by the balance watcher */
export type BalanceEventType = 'balanceChange' | 'error';

/** Callback signature for balance change events */
export type BalanceChangeCallback = (event: BalanceChangeEvent) => void;

/** Callback signature for error events */
export type BalanceErrorCallback = (error: Error) => void;

/** A balance change event delivered to subscribers */
export interface BalanceChangeEvent {
    /** Wormhole chain ID */
    wormholeChainId: number;
    /** Vault address */
    address: string;
    /** Updated portfolio snapshot */
    portfolio: PortfolioBalance;
    /** Individual tokens whose balance changed since last poll */
    changes: TokenBalanceChange[];
    /** Timestamp of this poll */
    timestamp: number;
}

/** Describes a single token balance that changed */
export interface TokenBalanceChange {
    token: TokenBalance['token'];
    previousBalance: bigint;
    currentBalance: bigint;
    /** Positive = received, negative = sent/withdrawn */
    delta: bigint;
}

/** Options for the watcher */
export interface BalanceWatcherOptions {
    /** Poll interval in milliseconds (default: 15_000 — 15 seconds) */
    intervalMs?: number;
    /** Minimum interval allowed (floor, to protect against aggressive polling) */
    minIntervalMs?: number;
    /** Whether to emit an initial event immediately with current balances */
    emitInitial?: boolean;
}

/** Function to stop watching */
export type Unsubscribe = () => void;

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_INTERVAL_MS = 15_000;
const MIN_INTERVAL_MS = 5_000;

// ============================================================================
// BalanceWatcher class
// ============================================================================

/**
 * Watch vault balances for changes via periodic polling.
 *
 * @example
 * ```typescript
 * const watcher = new BalanceWatcher(fetchBalance);
 *
 * const unsub = watcher.watch(
 *   10004, '0xVaultAddr',
 *   (event) => {
 *     for (const c of event.changes) {
 *       console.log(`${c.token.symbol}: ${c.delta > 0n ? '+' : ''}${c.delta}`);
 *     }
 *   },
 *   { intervalMs: 10_000 }
 * );
 *
 * // Later:
 * unsub();
 * ```
 */
export class BalanceWatcher {
    private subscriptions = new Map<string, Subscription>();

    /**
     * @param fetchBalance - Function that fetches the current portfolio balance.
     *   Typically bound to `BalanceManager.getPortfolioBalance` or the SDK's
     *   `getVaultBalances()`.
     */
    constructor(
        private readonly fetchBalance: (
            wormholeChainId: number,
            address: string,
        ) => Promise<PortfolioBalance>,
    ) {}

    /**
     * Start watching a vault's balances.
     *
     * @returns An unsubscribe function that stops polling.
     */
    watch(
        wormholeChainId: number,
        address: string,
        onChange: BalanceChangeCallback,
        options?: BalanceWatcherOptions,
        onError?: BalanceErrorCallback,
    ): Unsubscribe {
        const key = `${wormholeChainId}:${address}`;
        const interval = Math.max(
            options?.minIntervalMs ?? MIN_INTERVAL_MS,
            options?.intervalMs ?? DEFAULT_INTERVAL_MS,
        );

        // If there's already a subscription for this combo, add the callback
        const existing = this.subscriptions.get(key);
        if (existing) {
            existing.onChangeCallbacks.push(onChange);
            if (onError) existing.onErrorCallbacks.push(onError);
            return () => this.removeCallback(key, onChange, onError);
        }

        const sub: Subscription = {
            wormholeChainId,
            address,
            intervalMs: interval,
            onChangeCallbacks: [onChange],
            onErrorCallbacks: onError ? [onError] : [],
            lastSnapshot: null,
            timer: null,
        };

        this.subscriptions.set(key, sub);

        // Start polling
        const poll = async () => {
            try {
                const portfolio = await this.fetchBalance(wormholeChainId, address);
                const changes = this.diffBalances(sub.lastSnapshot, portfolio);

                const isInitial = sub.lastSnapshot === null;
                sub.lastSnapshot = portfolio;

                // Only emit if there are actual changes, or if emitInitial is set
                if (changes.length > 0 || (isInitial && options?.emitInitial)) {
                    const event: BalanceChangeEvent = {
                        wormholeChainId,
                        address,
                        portfolio,
                        changes,
                        timestamp: Date.now(),
                    };
                    for (const cb of sub.onChangeCallbacks) {
                        try { cb(event); } catch { /* subscriber error — don't crash poller */ }
                    }
                }
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                for (const cb of sub.onErrorCallbacks) {
                    try { cb(error); } catch { /* ignore */ }
                }
            }
        };

        // Immediate first poll if requested
        if (options?.emitInitial) {
            void poll();
        }

        sub.timer = setInterval(poll, interval) as unknown as number;

        return () => this.removeCallback(key, onChange, onError);
    }

    /**
     * Stop all watchers.
     */
    stopAll(): void {
        for (const [key, sub] of this.subscriptions) {
            if (sub.timer !== null) {
                clearInterval(sub.timer);
            }
            this.subscriptions.delete(key);
        }
    }

    /**
     * Get the number of active subscriptions.
     */
    get activeCount(): number {
        return this.subscriptions.size;
    }

    // --- Internal helpers ---

    private removeCallback(
        key: string,
        onChange: BalanceChangeCallback,
        onError?: BalanceErrorCallback,
    ): void {
        const sub = this.subscriptions.get(key);
        if (!sub) return;

        sub.onChangeCallbacks = sub.onChangeCallbacks.filter(cb => cb !== onChange);
        if (onError) {
            sub.onErrorCallbacks = sub.onErrorCallbacks.filter(cb => cb !== onError);
        }

        // If no more callbacks, tear down the subscription
        if (sub.onChangeCallbacks.length === 0) {
            if (sub.timer !== null) {
                clearInterval(sub.timer);
            }
            this.subscriptions.delete(key);
        }
    }

    private diffBalances(
        previous: PortfolioBalance | null,
        current: PortfolioBalance,
    ): TokenBalanceChange[] {
        if (!previous) return [];

        const prevMap = new Map(
            previous.tokens.map(t => [t.token.address.toLowerCase(), t]),
        );

        const changes: TokenBalanceChange[] = [];

        for (const curr of current.tokens) {
            const key = curr.token.address.toLowerCase();
            const prev = prevMap.get(key);
            const previousBalance = prev?.balance ?? 0n;

            if (curr.balance !== previousBalance) {
                changes.push({
                    token: curr.token,
                    previousBalance,
                    currentBalance: curr.balance,
                    delta: curr.balance - previousBalance,
                });
            }
        }

        // Check for tokens that disappeared (balance went to 0 or token removed)
        for (const [key, prev] of prevMap) {
            const inCurrent = current.tokens.some(
                t => t.token.address.toLowerCase() === key,
            );
            if (!inCurrent && prev.balance > 0n) {
                changes.push({
                    token: prev.token,
                    previousBalance: prev.balance,
                    currentBalance: 0n,
                    delta: -prev.balance,
                });
            }
        }

        return changes;
    }
}

// ============================================================================
// Internal types
// ============================================================================

interface Subscription {
    wormholeChainId: number;
    address: string;
    intervalMs: number;
    onChangeCallbacks: BalanceChangeCallback[];
    onErrorCallbacks: BalanceErrorCallback[];
    lastSnapshot: PortfolioBalance | null;
    timer: number | null;
}
