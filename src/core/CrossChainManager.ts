/**
 * Veridex Protocol SDK - Cross-Chain Manager
 * 
 * Orchestrates cross-chain transfers including:
 * - VAA fetching and parsing
 * - Fee estimation (message + relayer fees)
 * - Transaction status tracking across chains
 * - Lifecycle callbacks for UI updates
 */

import { ethers } from 'ethers';
import {
    fetchVAA,
    fetchVAAByTxHash,
    parseVAA,
    parseVeridexPayload,
    encodeVAAToBytes,
    getSequenceFromTxReceipt,
    waitForGuardianSignatures,
    normalizeEmitterAddress,
    GUARDIAN_CONFIG,
} from '../wormhole.js';
import type {
    BridgeParams,
    VAA,
    VeridexPayload,
    ChainConfig,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Cross-chain transfer lifecycle states
 */
export type CrossChainStatus =
    | 'preparing'
    | 'signing'
    | 'dispatching'
    | 'waiting_confirmations'
    | 'waiting_guardians'
    | 'vaa_ready'
    | 'relaying'
    | 'executing'
    | 'completed'
    | 'failed';

/**
 * Progress callback for cross-chain operations
 */
export interface CrossChainProgress {
    status: CrossChainStatus;
    step: number;
    totalSteps: number;
    message: string;
    details?: {
        txHash?: string;
        sequence?: bigint;
        guardianSignatures?: number;
        requiredSignatures?: number;
        vaaReady?: boolean;
        destinationTxHash?: string;
    };
}

/**
 * Cross-chain transfer result
 */
export interface CrossChainResult {
    /** Source chain transaction hash */
    sourceTxHash: string;
    /** Wormhole message sequence number */
    sequence: bigint;
    /** Emitter address (Hub contract) */
    emitterAddress: string;
    /** Source chain Wormhole ID */
    sourceChain: number;
    /** Destination chain Wormhole ID */
    destinationChain: number;
    /** VAA base64 (once ready) */
    vaa?: string;
    /** Parsed VAA */
    parsedVaa?: VAA;
    /** Destination chain transaction hash */
    destinationTxHash?: string;
    /** Total time taken in ms */
    duration: number;
    /** Final status */
    status: CrossChainStatus;
    /** Error message if failed */
    error?: string;
}

/**
 * Fee breakdown for cross-chain transfers
 */
export interface CrossChainFees {
    /** Gas cost on source chain */
    sourceGas: bigint;
    /** Wormhole message fee */
    messageFee: bigint;
    /** Relayer fee (if using automatic relay) */
    relayerFee: bigint;
    /** Total estimated cost in source chain native token */
    totalCost: bigint;
    /** Formatted total cost */
    formattedTotal: string;
    /** Currency symbol */
    currency: string;
}

/**
 * Configuration for CrossChainManager
 */
export interface CrossChainConfig {
    /** Use testnet APIs (default: true) */
    testnet?: boolean;
    /** Relayer service URL (optional) */
    relayerUrl?: string;
    /** Max time to wait for VAA (ms) */
    vaaTimeoutMs?: number;
    /** Interval to poll for VAA (ms) */
    vaaPollingIntervalMs?: number;
    /** Required block confirmations before fetching VAA */
    confirmationsRequired?: number;
    /** Auto-relay VAA to destination (requires relayer) */
    autoRelay?: boolean;
}

/**
 * Callback type for progress updates
 */
export type CrossChainProgressCallback = (progress: CrossChainProgress) => void;

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Required<CrossChainConfig> = {
    testnet: true,
    relayerUrl: '',
    vaaTimeoutMs: 120_000, // 2 minutes
    vaaPollingIntervalMs: 3_000, // 3 seconds
    confirmationsRequired: 1,
    autoRelay: false,
};

// ============================================================================
// CrossChainManager Class
// ============================================================================

/**
 * Manages cross-chain transfer lifecycle
 */
export class CrossChainManager {
    private config: Required<CrossChainConfig>;
    private pendingTransfers: Map<string, CrossChainResult> = new Map();

    constructor(config: CrossChainConfig = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // ========================================================================
    // Configuration
    // ========================================================================

    /**
     * Update configuration
     */
    setConfig(config: Partial<CrossChainConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current configuration
     */
    getConfig(): CrossChainConfig {
        return { ...this.config };
    }

    // ========================================================================
    // Fee Estimation
    // ========================================================================

    /**
     * Estimate fees for a cross-chain transfer
     */
    async estimateFees(
        params: BridgeParams,
        sourceChainConfig: ChainConfig,
        provider: ethers.Provider
    ): Promise<CrossChainFees> {
        // Get current gas price
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice ?? 0n;
        
        // Estimate gas for dispatch (Hub chain)
        // This is an approximation - actual gas depends on payload size
        const estimatedGas = 300_000n;
        const sourceGas = estimatedGas * gasPrice;

        // Get Wormhole message fee
        let messageFee = 0n;
        try {
            const wormholeAbi = ['function messageFee() view returns (uint256)'];
            const wormhole = new ethers.Contract(
                sourceChainConfig.contracts.wormholeCoreBridge,
                wormholeAbi,
                provider
            );
            messageFee = await wormhole.messageFee();
        } catch {
            // Default to 0 if bridge doesn't have messageFee
        }

        // Get relayer fee if using automatic relay
        let relayerFee = 0n;
        if (this.config.autoRelay && this.config.relayerUrl) {
            try {
                relayerFee = await this.fetchRelayerFee(
                    params.destinationChain,
                    sourceChainConfig.wormholeChainId
                );
            } catch {
                // Relayer fee fetch failed, continue with 0
            }
        }

        const totalCost = sourceGas + messageFee + relayerFee;

        return {
            sourceGas,
            messageFee,
            relayerFee,
            totalCost,
            formattedTotal: this.formatWei(totalCost),
            currency: 'ETH',
        };
    }

    /**
     * Fetch relayer fee from relayer service
     */
    private async fetchRelayerFee(
        destinationChain: number,
        _sourceChain: number
    ): Promise<bigint> {
        if (!this.config.relayerUrl) {
            return 0n;
        }

        // The current Veridex relayer exposes a simplified fee endpoint.
        // Source chain is accepted here for future-proofing but not required by the API today.
        const response = await fetch(
            `${this.config.relayerUrl}/api/v1/fee?targetChain=${destinationChain}`
        );

        if (!response.ok) {
            throw new Error('Failed to fetch relayer fee');
        }

        const data = await response.json() as {
            fees?: {
                wormhole?: string;
                relayer?: string;
                total?: string;
            };
        };

        return BigInt(data.fees?.relayer ?? '0');
    }

    // ========================================================================
    // VAA Operations
    // ========================================================================

    /**
     * Fetch VAA by sequence number
     */
    async fetchVAA(
        emitterChain: number,
        emitterAddress: string,
        sequence: bigint,
        onProgress?: CrossChainProgressCallback
    ): Promise<string> {
        onProgress?.({
            status: 'waiting_guardians',
            step: 4,
            totalSteps: 6,
            message: 'Waiting for Wormhole guardians to sign...',
            details: { sequence },
        });

        const vaaBase64 = await fetchVAA(emitterChain, emitterAddress, sequence, {
            testnet: this.config.testnet,
            maxRetries: Math.ceil(this.config.vaaTimeoutMs / this.config.vaaPollingIntervalMs),
            retryDelayMs: this.config.vaaPollingIntervalMs,
            onRetry: (attempt, max) => {
                onProgress?.({
                    status: 'waiting_guardians',
                    step: 4,
                    totalSteps: 6,
                    message: `Waiting for guardians (attempt ${attempt}/${max})...`,
                    details: { sequence },
                });
            },
        });

        onProgress?.({
            status: 'vaa_ready',
            step: 5,
            totalSteps: 6,
            message: 'VAA signed and ready!',
            details: { sequence, vaaReady: true },
        });

        return vaaBase64;
    }

    /**
     * Fetch VAA by transaction hash (more reliable)
     */
    async fetchVAAByTxHash(
        txHash: string,
        onProgress?: CrossChainProgressCallback
    ): Promise<string> {
        onProgress?.({
            status: 'waiting_guardians',
            step: 4,
            totalSteps: 6,
            message: 'Waiting for Wormhole guardians to sign...',
            details: { txHash },
        });

        const vaaBase64 = await fetchVAAByTxHash(txHash, {
            testnet: this.config.testnet,
            maxRetries: Math.ceil(this.config.vaaTimeoutMs / this.config.vaaPollingIntervalMs),
            retryDelayMs: this.config.vaaPollingIntervalMs,
            onRetry: (attempt, max) => {
                onProgress?.({
                    status: 'waiting_guardians',
                    step: 4,
                    totalSteps: 6,
                    message: `Waiting for guardians (attempt ${attempt}/${max})...`,
                    details: { txHash },
                });
            },
        });

        onProgress?.({
            status: 'vaa_ready',
            step: 5,
            totalSteps: 6,
            message: 'VAA signed and ready!',
            details: { txHash, vaaReady: true },
        });

        return vaaBase64;
    }

    /**
     * Wait for guardians to sign a message with progress tracking
     */
    async waitForGuardians(
        emitterChain: number,
        emitterAddress: string,
        sequence: bigint,
        onProgress?: CrossChainProgressCallback
    ): Promise<VAA> {
        const requiredSignatures = this.config.testnet
            ? GUARDIAN_CONFIG.TESTNET_QUORUM
            : GUARDIAN_CONFIG.MAINNET_QUORUM;

        return await waitForGuardianSignatures(
            emitterChain,
            emitterAddress,
            sequence,
            {
                testnet: this.config.testnet,
                requiredSignatures,
                maxWaitMs: this.config.vaaTimeoutMs,
                checkIntervalMs: this.config.vaaPollingIntervalMs,
                onProgress: (current, required) => {
                    onProgress?.({
                        status: 'waiting_guardians',
                        step: 4,
                        totalSteps: 6,
                        message: `Collecting signatures (${current}/${required})...`,
                        details: {
                            sequence,
                            guardianSignatures: current,
                            requiredSignatures: required,
                        },
                    });
                },
            }
        );
    }

    /**
     * Parse a VAA and extract Veridex payload
     */
    parseVAA(vaaBase64: string): { vaa: VAA; payload: VeridexPayload } {
        const vaa = parseVAA(vaaBase64);
        const payload = parseVeridexPayload(vaa.payload);
        return { vaa, payload };
    }

    /**
     * Encode VAA for on-chain submission
     */
    encodeVAAForSubmission(vaaBase64: string): string {
        return encodeVAAToBytes(vaaBase64);
    }

    // ========================================================================
    // Transfer Lifecycle
    // ========================================================================

    /**
     * Track a cross-chain transfer
     */
    trackTransfer(
        sourceTxHash: string,
        sourceChain: number,
        destinationChain: number,
        sequence: bigint,
        emitterAddress: string
    ): CrossChainResult {
        const result: CrossChainResult = {
            sourceTxHash,
            sequence,
            emitterAddress,
            sourceChain,
            destinationChain,
            duration: 0,
            status: 'waiting_guardians',
        };

        this.pendingTransfers.set(sourceTxHash, result);
        return result;
    }

    /**
     * Get pending transfer by source tx hash
     */
    getPendingTransfer(sourceTxHash: string): CrossChainResult | undefined {
        return this.pendingTransfers.get(sourceTxHash);
    }

    /**
     * Get all pending transfers
     */
    getAllPendingTransfers(): CrossChainResult[] {
        return Array.from(this.pendingTransfers.values()).filter(
            t => t.status !== 'completed' && t.status !== 'failed'
        );
    }

    /**
     * Update transfer status
     */
    updateTransfer(
        sourceTxHash: string,
        updates: Partial<CrossChainResult>
    ): CrossChainResult | undefined {
        const transfer = this.pendingTransfers.get(sourceTxHash);
        if (!transfer) return undefined;

        Object.assign(transfer, updates);
        return transfer;
    }

    /**
     * Complete transfer with VAA
     */
    completeTransfer(
        sourceTxHash: string,
        vaa: string,
        destinationTxHash?: string
    ): CrossChainResult | undefined {
        const transfer = this.pendingTransfers.get(sourceTxHash);
        if (!transfer) return undefined;

        transfer.vaa = vaa;
        transfer.parsedVaa = parseVAA(vaa);
        transfer.destinationTxHash = destinationTxHash;
        transfer.status = 'completed';

        return transfer;
    }

    /**
     * Mark transfer as failed
     */
    failTransfer(sourceTxHash: string, error: string): CrossChainResult | undefined {
        const transfer = this.pendingTransfers.get(sourceTxHash);
        if (!transfer) return undefined;

        transfer.status = 'failed';
        transfer.error = error;

        return transfer;
    }

    /**
     * Clear completed/failed transfers
     */
    clearFinishedTransfers(): void {
        for (const [hash, transfer] of this.pendingTransfers.entries()) {
            if (transfer.status === 'completed' || transfer.status === 'failed') {
                this.pendingTransfers.delete(hash);
            }
        }
    }

    // ========================================================================
    // Utilities
    // ========================================================================

    /**
     * Extract sequence from transaction receipt
     */
    async getSequenceFromTx(
        provider: ethers.Provider,
        txHash: string,
        wormholeCoreBridge: string
    ): Promise<bigint> {
        return await getSequenceFromTxReceipt(provider, txHash, wormholeCoreBridge);
    }

    /**
     * Normalize address to emitter format
     */
    normalizeAddress(address: string): string {
        return normalizeEmitterAddress(address);
    }

    /**
     * Get explorer URL for a cross-chain transfer
     */
    getExplorerUrl(
        txHash: string,
        _chain: 'source' | 'destination',
        explorerBaseUrl: string
    ): string {
        return `${explorerBaseUrl}/tx/${txHash}`;
    }

    /**
     * Get Wormholescan URL for VAA
     */
    getWormholeExplorerUrl(
        emitterChain: number,
        emitterAddress: string,
        sequence: bigint
    ): string {
        const base = this.config.testnet
            ? 'https://wormholescan.io/#/tx'
            : 'https://wormholescan.io/#/tx';
        
        const normalizedEmitter = normalizeEmitterAddress(emitterAddress);
        return `${base}/${emitterChain}/${normalizedEmitter}/${sequence.toString()}`;
    }

    /**
     * Format wei to human-readable string
     */
    private formatWei(wei: bigint): string {
        const eth = Number(wei) / 1e18;
        if (eth < 0.0001) {
            return `${(Number(wei) / 1e9).toFixed(4)} gwei`;
        }
        return `${eth.toFixed(6)} ETH`;
    }
}

// ============================================================================
// Export singleton for convenience
// ============================================================================

export const crossChainManager = new CrossChainManager();
