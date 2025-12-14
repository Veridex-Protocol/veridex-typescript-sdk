/**
 * Veridex Protocol SDK - Transaction Tracker
 * 
 * Tracks transaction status from pending to confirmed
 */

import { ethers } from 'ethers';

// ============================================================================
// Types
// ============================================================================

export type TransactionStatus = 
    | 'pending'
    | 'submitted'
    | 'confirming'
    | 'confirmed'
    | 'failed'
    | 'dropped';

export interface TransactionState {
    /** Transaction hash */
    hash: string;
    /** Current status */
    status: TransactionStatus;
    /** Wormhole chain ID where transaction was sent */
    wormholeChainId: number;
    /** Block number when confirmed */
    blockNumber?: number;
    /** Number of confirmations */
    confirmations: number;
    /** Required confirmations for finality */
    requiredConfirmations: number;
    /** Gas used (after confirmation) */
    gasUsed?: bigint;
    /** Effective gas price */
    effectiveGasPrice?: bigint;
    /** Error message if failed */
    error?: string;
    /** Timestamp when transaction was submitted */
    submittedAt: number;
    /** Timestamp when transaction was confirmed */
    confirmedAt?: number;
    /** VAA sequence number (for cross-chain txs) */
    vaaSequence?: bigint;
}

export interface TrackerConfig {
    /** Polling interval in ms (default: 2000) */
    pollingInterval?: number;
    /** Required confirmations for finality (default: 1) */
    requiredConfirmations?: number;
    /** Timeout in ms before marking as dropped (default: 300000 - 5 min) */
    timeout?: number;
    /** Custom RPC URLs by chain ID */
    customRpcUrls?: Record<number, string>;
}

export type TransactionCallback = (state: TransactionState) => void;

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_POLLING_INTERVAL = 2000;
const DEFAULT_REQUIRED_CONFIRMATIONS = 1;
const DEFAULT_TIMEOUT = 300_000; // 5 minutes

const DEFAULT_RPC_URLS: Record<number, string> = {
    10004: 'https://sepolia.base.org',
    10005: 'https://sepolia.optimism.io',
    10003: 'https://sepolia-rollup.arbitrum.io/rpc',
};

// ============================================================================
// Transaction Tracker Class
// ============================================================================

export class TransactionTracker {
    private config: Required<TrackerConfig>;
    private providers: Map<number, ethers.JsonRpcProvider> = new Map();
    private trackedTransactions: Map<string, TransactionState> = new Map();
    private callbacks: Map<string, TransactionCallback[]> = new Map();
    private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();

    constructor(config: TrackerConfig = {}) {
        this.config = {
            pollingInterval: config.pollingInterval ?? DEFAULT_POLLING_INTERVAL,
            requiredConfirmations: config.requiredConfirmations ?? DEFAULT_REQUIRED_CONFIRMATIONS,
            timeout: config.timeout ?? DEFAULT_TIMEOUT,
            customRpcUrls: config.customRpcUrls ?? {},
        };
    }

    // ========================================================================
    // Public Methods
    // ========================================================================

    /**
     * Track a transaction and receive status updates
     * 
     * @param hash - Transaction hash
     * @param wormholeChainId - Chain where transaction was sent
     * @param callback - Optional callback for status updates
     * @param vaaSequence - Optional VAA sequence for cross-chain transactions
     * @returns Initial transaction state
     */
    track(
        hash: string,
        wormholeChainId: number,
        callback?: TransactionCallback,
        vaaSequence?: bigint
    ): TransactionState {
        // Create initial state
        const state: TransactionState = {
            hash,
            status: 'pending',
            wormholeChainId,
            confirmations: 0,
            requiredConfirmations: this.config.requiredConfirmations,
            submittedAt: Date.now(),
            vaaSequence,
        };

        this.trackedTransactions.set(hash, state);
        
        if (callback) {
            this.addCallback(hash, callback);
        }

        // Start polling
        this.startPolling(hash, wormholeChainId);

        return state;
    }

    /**
     * Add a callback for transaction updates
     */
    addCallback(hash: string, callback: TransactionCallback): void {
        const existing = this.callbacks.get(hash) ?? [];
        existing.push(callback);
        this.callbacks.set(hash, existing);
    }

    /**
     * Remove a callback
     */
    removeCallback(hash: string, callback: TransactionCallback): void {
        const existing = this.callbacks.get(hash) ?? [];
        const filtered = existing.filter(cb => cb !== callback);
        if (filtered.length > 0) {
            this.callbacks.set(hash, filtered);
        } else {
            this.callbacks.delete(hash);
        }
    }

    /**
     * Get current state of a tracked transaction
     */
    getState(hash: string): TransactionState | null {
        return this.trackedTransactions.get(hash) ?? null;
    }

    /**
     * Wait for a transaction to reach confirmed status
     * 
     * @param hash - Transaction hash
     * @param wormholeChainId - Chain where transaction was sent
     * @returns Promise that resolves when confirmed or rejects on failure
     */
    async waitForConfirmation(
        hash: string,
        wormholeChainId: number
    ): Promise<TransactionState> {
        // Check if already tracked
        let state = this.trackedTransactions.get(hash);
        
        if (!state) {
            state = this.track(hash, wormholeChainId);
        }

        // If already confirmed or failed, return immediately
        if (state.status === 'confirmed' || state.status === 'failed' || state.status === 'dropped') {
            return state;
        }

        // Wait for confirmation
        return new Promise((resolve, reject) => {
            const callback: TransactionCallback = (newState) => {
                if (newState.status === 'confirmed') {
                    this.removeCallback(hash, callback);
                    resolve(newState);
                } else if (newState.status === 'failed' || newState.status === 'dropped') {
                    this.removeCallback(hash, callback);
                    reject(new Error(newState.error ?? `Transaction ${newState.status}`));
                }
            };

            this.addCallback(hash, callback);
        });
    }

    /**
     * Stop tracking a transaction
     */
    stopTracking(hash: string): void {
        const interval = this.pollingIntervals.get(hash);
        if (interval) {
            clearInterval(interval);
            this.pollingIntervals.delete(hash);
        }
        this.trackedTransactions.delete(hash);
        this.callbacks.delete(hash);
    }

    /**
     * Stop tracking all transactions
     */
    stopAll(): void {
        for (const hash of this.pollingIntervals.keys()) {
            this.stopTracking(hash);
        }
    }

    /**
     * Get all tracked transactions
     */
    getAllTracked(): TransactionState[] {
        return Array.from(this.trackedTransactions.values());
    }

    /**
     * Get pending transactions
     */
    getPending(): TransactionState[] {
        return this.getAllTracked().filter(
            tx => tx.status === 'pending' || tx.status === 'submitted' || tx.status === 'confirming'
        );
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    /**
     * Get or create provider for a chain
     */
    private getProvider(wormholeChainId: number): ethers.JsonRpcProvider {
        let provider = this.providers.get(wormholeChainId);
        if (provider) {
            return provider;
        }

        const rpcUrl = this.config.customRpcUrls[wormholeChainId] ?? 
                       DEFAULT_RPC_URLS[wormholeChainId];
        
        if (!rpcUrl) {
            throw new Error(`No RPC URL configured for chain ${wormholeChainId}`);
        }

        provider = new ethers.JsonRpcProvider(rpcUrl);
        this.providers.set(wormholeChainId, provider);
        return provider;
    }

    /**
     * Start polling for transaction status
     */
    private startPolling(hash: string, wormholeChainId: number): void {
        // Initial check
        this.checkTransaction(hash, wormholeChainId);

        // Set up interval
        const interval = setInterval(() => {
            this.checkTransaction(hash, wormholeChainId);
        }, this.config.pollingInterval);

        this.pollingIntervals.set(hash, interval);
    }

    /**
     * Check transaction status
     */
    private async checkTransaction(hash: string, wormholeChainId: number): Promise<void> {
        const state = this.trackedTransactions.get(hash);
        if (!state) {
            this.stopTracking(hash);
            return;
        }

        // Check timeout
        if (Date.now() - state.submittedAt > this.config.timeout) {
            this.updateState(hash, {
                status: 'dropped',
                error: 'Transaction timeout - possibly dropped from mempool',
            });
            this.stopTracking(hash);
            return;
        }

        try {
            const provider = this.getProvider(wormholeChainId);
            const receipt = await provider.getTransactionReceipt(hash);

            if (!receipt) {
                // Transaction not yet mined
                if (state.status === 'pending') {
                    this.updateState(hash, { status: 'submitted' });
                }
                return;
            }

            // Transaction is mined
            const currentBlock = await provider.getBlockNumber();
            const confirmations = currentBlock - receipt.blockNumber + 1;

            if (receipt.status === 0) {
                // Transaction failed
                this.updateState(hash, {
                    status: 'failed',
                    blockNumber: receipt.blockNumber,
                    confirmations,
                    gasUsed: receipt.gasUsed,
                    effectiveGasPrice: receipt.gasPrice,
                    error: 'Transaction reverted',
                });
                this.stopTracking(hash);
                return;
            }

            if (confirmations >= this.config.requiredConfirmations) {
                // Fully confirmed
                this.updateState(hash, {
                    status: 'confirmed',
                    blockNumber: receipt.blockNumber,
                    confirmations,
                    gasUsed: receipt.gasUsed,
                    effectiveGasPrice: receipt.gasPrice,
                    confirmedAt: Date.now(),
                });
                this.stopTracking(hash);
            } else {
                // Still confirming
                this.updateState(hash, {
                    status: 'confirming',
                    blockNumber: receipt.blockNumber,
                    confirmations,
                    gasUsed: receipt.gasUsed,
                    effectiveGasPrice: receipt.gasPrice,
                });
            }
        } catch (error) {
            console.warn(`Error checking transaction ${hash}:`, error);
            // Don't update state on transient errors
        }
    }

    /**
     * Update transaction state and notify callbacks
     */
    private updateState(hash: string, updates: Partial<TransactionState>): void {
        const current = this.trackedTransactions.get(hash);
        if (!current) return;

        const newState: TransactionState = { ...current, ...updates };
        this.trackedTransactions.set(hash, newState);

        // Notify callbacks
        const callbacks = this.callbacks.get(hash) ?? [];
        for (const callback of callbacks) {
            try {
                callback(newState);
            } catch (error) {
                console.error('Error in transaction callback:', error);
            }
        }
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a formatted transaction explorer URL
 */
export function getExplorerUrl(
    wormholeChainId: number,
    hash: string
): string | null {
    const explorers: Record<number, string> = {
        10004: 'https://sepolia.basescan.org/tx/',
        10005: 'https://sepolia-optimism.etherscan.io/tx/',
        10003: 'https://sepolia.arbiscan.io/tx/',
    };

    const baseUrl = explorers[wormholeChainId];
    return baseUrl ? `${baseUrl}${hash}` : null;
}

/**
 * Format transaction state for display
 */
export function formatTransactionState(state: TransactionState): string {
    switch (state.status) {
        case 'pending':
            return 'Transaction pending...';
        case 'submitted':
            return 'Transaction submitted, waiting for confirmation...';
        case 'confirming':
            return `Confirming (${state.confirmations}/${state.requiredConfirmations})...`;
        case 'confirmed':
            return 'Transaction confirmed!';
        case 'failed':
            return `Transaction failed: ${state.error ?? 'Unknown error'}`;
        case 'dropped':
            return 'Transaction dropped from mempool';
        default:
            return 'Unknown status';
    }
}
