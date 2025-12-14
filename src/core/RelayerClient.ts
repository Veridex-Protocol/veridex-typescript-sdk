/**
 * Veridex Protocol SDK - Relayer Client
 * 
 * Client for interacting with the Veridex relayer service.
 * The relayer automatically submits VAAs to destination chains.
 * 
 * Features:
 * - Submit VAA for relay
 * - Check relay status
 * - Get supported routes
 * - Fee estimation
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Relay request status
 */
export type RelayStatus =
    | 'pending'
    | 'processing'
    | 'submitted'
    | 'confirmed'
    | 'failed';

/**
 * Relay request result
 */
export interface RelayRequest {
    /** Unique relay request ID */
    id: string;
    /** VAA sequence number */
    sequence: bigint;
    /** Source chain Wormhole ID */
    sourceChain: number;
    /** Destination chain Wormhole ID */
    destinationChain: number;
    /** Relay status */
    status: RelayStatus;
    /** Source transaction hash */
    sourceTxHash: string;
    /** Destination transaction hash (when completed) */
    destinationTxHash?: string;
    /** Timestamp when request was created */
    createdAt: number;
    /** Timestamp when request was last updated */
    updatedAt: number;
    /** Error message if failed */
    error?: string;
    /** Gas used on destination chain */
    gasUsed?: bigint;
    /** Fee paid */
    feePaid?: bigint;
}

/**
 * Supported route information
 */
export interface RelayRoute {
    /** Source chain Wormhole ID */
    sourceChain: number;
    /** Destination chain Wormhole ID */
    destinationChain: number;
    /** Whether the route is active */
    active: boolean;
    /** Estimated relay time in seconds */
    estimatedTimeSeconds: number;
    /** Base fee in destination chain native token */
    baseFee: bigint;
    /** Fee per gas unit */
    gasPrice: bigint;
    /** Maximum gas limit */
    maxGas: bigint;
}

/**
 * Relayer service info
 */
export interface RelayerInfo {
    /** Relayer name/identifier */
    name: string;
    /** Relayer version */
    version: string;
    /** Supported chains */
    supportedChains: number[];
    /** Available routes */
    routes: RelayRoute[];
    /** Whether the relayer is online */
    online: boolean;
    /** Current queue depth */
    queueDepth: number;
}

/**
 * Request body for submitting a signed action to the relayer (gasless)
 */
export interface SubmitSignedActionRequest {
    /** SHA-256 hash of the message that was signed */
    messageHash: string;
    /** P-256 signature r component (hex) */
    r: string;
    /** P-256 signature s component (hex) */
    s: string;
    /** P-256 public key X coordinate (hex) */
    publicKeyX: string;
    /** P-256 public key Y coordinate (hex) */
    publicKeyY: string;
    /** Target chain Wormhole ID */
    targetChain: number;
    /** Action payload (hex) */
    actionPayload: string;
    /** User nonce */
    nonce: number;
}

/**
 * Response from submitting a signed action
 */
export interface SubmitActionResult {
    /** Whether the submission was successful */
    success: boolean;
    /** Transaction hash on Hub chain */
    txHash?: string;
    /** Wormhole sequence number */
    sequence?: string;
    /** Error message if failed */
    error?: string;
    /** Human-readable message */
    message?: string;
}

/**
 * Fee quote for a relay
 */
export interface RelayFeeQuote {
    /** Source chain Wormhole ID */
    sourceChain: number;
    /** Destination chain Wormhole ID */
    destinationChain: number;
    /** Estimated fee in source chain native token */
    feeInSourceToken: bigint;
    /** Estimated fee in destination chain native token */
    feeInDestinationToken: bigint;
    /** Estimated gas on destination */
    estimatedGas: bigint;
    /** Quote expiration timestamp */
    expiresAt: number;
    /** Quote ID for submission */
    quoteId: string;
}

/**
 * Configuration for RelayerClient
 */
export interface RelayerClientConfig {
    /** Base URL of the relayer service */
    baseUrl: string;
    /** API key for authentication (optional) */
    apiKey?: string;
    /** Timeout for requests in ms */
    timeoutMs?: number;
    /** Max retries for failed requests */
    maxRetries?: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Required<Omit<RelayerClientConfig, 'baseUrl'>> = {
    apiKey: '',
    timeoutMs: 30_000,
    maxRetries: 3,
};

// ============================================================================
// RelayerClient Class
// ============================================================================

/**
 * Client for the Veridex relayer service
 */
export class RelayerClient {
    private baseUrl: string;
    private config: Required<Omit<RelayerClientConfig, 'baseUrl'>>;

    constructor(config: RelayerClientConfig) {
        this.baseUrl = config.baseUrl.replace(/\/+$/, ''); // Remove trailing slashes
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // ========================================================================
    // Relay Operations
    // ========================================================================

    /**
     * Submit a VAA for relay to destination chain
     */
    async submitRelay(
        vaaBase64: string,
        sourceChain: number,
        destinationChain: number,
        sourceTxHash: string,
        sequence: bigint,
        feeQuoteId?: string
    ): Promise<RelayRequest> {
        const response = await this.fetch('/api/v1/relay', {
            method: 'POST',
            body: JSON.stringify({
                vaa: vaaBase64,
                sourceChain,
                destinationChain,
                sourceTxHash,
                sequence: sequence.toString(),
                feeQuoteId,
            }),
        });

        return this.parseRelayRequest(response);
    }

    /**
     * Submit a signed action to the relayer for gasless execution
     * 
     * This allows users to execute transfers without paying gas themselves.
     * The relayer will submit the transaction to the Hub chain and pay the gas.
     * The relayer then automatically relays the VAA to the destination spoke chain.
     * 
     * @param request - The signed action request with passkey signature
     * @returns Result including Hub tx hash and Wormhole sequence
     */
    async submitSignedAction(request: SubmitSignedActionRequest): Promise<SubmitActionResult> {
        const response = await this.fetch('/api/v1/submit', {
            method: 'POST',
            body: JSON.stringify(request),
        });

        return {
            success: response.success,
            txHash: response.txHash,
            sequence: response.sequence,
            error: response.error,
            message: response.message,
        };
    }

    /**
     * Get relay request status
     */
    async getRelayStatus(requestId: string): Promise<RelayRequest> {
        const response = await this.fetch(`/api/v1/relay/${requestId}`);
        return this.parseRelayRequest(response);
    }

    /**
     * Get relay status by source transaction hash
     */
    async getRelayBySourceTx(sourceTxHash: string): Promise<RelayRequest | null> {
        try {
            const response = await this.fetch(`/api/v1/relay/tx/${sourceTxHash}`);
            return this.parseRelayRequest(response);
        } catch (error: any) {
            if (error.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Get relay status by sequence number
     */
    async getRelayBySequence(
        sourceChain: number,
        sequence: bigint
    ): Promise<RelayRequest | null> {
        try {
            const response = await this.fetch(
                `/api/v1/relay/sequence/${sourceChain}/${sequence.toString()}`
            );
            return this.parseRelayRequest(response);
        } catch (error: any) {
            if (error.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Cancel a pending relay request
     */
    async cancelRelay(requestId: string): Promise<boolean> {
        try {
            await this.fetch(`/api/v1/relay/${requestId}`, {
                method: 'DELETE',
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Poll for relay completion
     */
    async waitForRelay(
        requestId: string,
        timeoutMs: number = 120_000,
        pollingIntervalMs: number = 3_000,
        onProgress?: (status: RelayStatus) => void
    ): Promise<RelayRequest> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            const request = await this.getRelayStatus(requestId);

            onProgress?.(request.status);

            if (request.status === 'confirmed') {
                return request;
            }

            if (request.status === 'failed') {
                throw new Error(`Relay failed: ${request.error}`);
            }

            await this.sleep(pollingIntervalMs);
        }

        throw new Error('Relay timeout: Request did not complete in time');
    }

    // ========================================================================
    // Fee Estimation
    // ========================================================================

    /**
     * Get fee quote for a relay
     */
    async getFeeQuote(
        sourceChain: number,
        destinationChain: number,
        estimatedGas?: bigint
    ): Promise<RelayFeeQuote> {
        const params = new URLSearchParams({
            sourceChain: sourceChain.toString(),
            destinationChain: destinationChain.toString(),
        });

        if (estimatedGas !== undefined) {
            params.set('estimatedGas', estimatedGas.toString());
        }

        const response = await this.fetch(`/api/v1/fee?${params.toString()}`);

        return {
            sourceChain: response.sourceChain,
            destinationChain: response.destinationChain,
            feeInSourceToken: BigInt(response.feeInSourceToken || '0'),
            feeInDestinationToken: BigInt(response.feeInDestinationToken || '0'),
            estimatedGas: BigInt(response.estimatedGas || '0'),
            expiresAt: response.expiresAt,
            quoteId: response.quoteId,
        };
    }

    // ========================================================================
    // Service Info
    // ========================================================================

    /**
     * Get relayer service info
     */
    async getInfo(): Promise<RelayerInfo> {
        const response = await this.fetch('/api/v1/info');

        return {
            name: response.name,
            version: response.version,
            supportedChains: response.supportedChains || [],
            routes: (response.routes || []).map(this.parseRoute),
            online: response.online ?? true,
            queueDepth: response.queueDepth ?? 0,
        };
    }

    /**
     * Get supported routes
     */
    async getRoutes(): Promise<RelayRoute[]> {
        const response = await this.fetch('/api/v1/routes');
        return (response.routes || []).map(this.parseRoute);
    }

    /**
     * Check if a route is supported
     */
    async isRouteSupported(
        sourceChain: number,
        destinationChain: number
    ): Promise<boolean> {
        const routes = await this.getRoutes();
        return routes.some(
            r => r.sourceChain === sourceChain &&
                 r.destinationChain === destinationChain &&
                 r.active
        );
    }

    /**
     * Check relayer health
     */
    async healthCheck(): Promise<boolean> {
        try {
            const response = await this.fetch('/health');
            return response.status === 'ok' || response.healthy === true;
        } catch {
            return false;
        }
    }

    // ========================================================================
    // Pending Relays
    // ========================================================================

    /**
     * Get all pending relay requests for a user
     */
    async getPendingRelays(userKeyHash: string): Promise<RelayRequest[]> {
        const response = await this.fetch(`/api/v1/relay/pending/${userKeyHash}`);
        return (response.requests || []).map(this.parseRelayRequest.bind(this));
    }

    /**
     * Get relay history for a user
     */
    async getRelayHistory(
        userKeyHash: string,
        limit: number = 50,
        offset: number = 0
    ): Promise<RelayRequest[]> {
        const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString(),
        });

        const response = await this.fetch(
            `/api/v1/relay/history/${userKeyHash}?${params.toString()}`
        );
        return (response.requests || []).map(this.parseRelayRequest.bind(this));
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Make an HTTP request to the relayer
     */
    private async fetch(
        path: string,
        options: RequestInit = {}
    ): Promise<any> {
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        };

        if (this.config.apiKey) {
            (headers as Record<string, string>)['X-API-Key'] = this.config.apiKey;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            try {
                const response = await fetch(`${this.baseUrl}${path}`, {
                    ...options,
                    headers,
                    signal: controller.signal,
                });

                clearTimeout(timeout);

                if (!response.ok) {
                    const error: any = new Error(
                        `Relayer request failed: ${response.status} ${response.statusText}`
                    );
                    error.status = response.status;
                    try {
                        error.body = await response.json();
                    } catch {
                        // Ignore JSON parse errors
                    }
                    throw error;
                }

                return await response.json();
            } catch (error: any) {
                lastError = error;

                // Don't retry on client errors (4xx)
                if (error.status && error.status >= 400 && error.status < 500) {
                    throw error;
                }

                // Don't retry on abort
                if (error.name === 'AbortError') {
                    throw new Error('Request timeout');
                }

                // Wait before retry
                if (attempt < this.config.maxRetries) {
                    await this.sleep(1000 * (attempt + 1));
                }
            }
        }

        throw lastError || new Error('Request failed after all retries');
    }

    /**
     * Parse relay request response
     */
    private parseRelayRequest(data: any): RelayRequest {
        return {
            id: data.id,
            sequence: BigInt(data.sequence || '0'),
            sourceChain: data.sourceChain,
            destinationChain: data.destinationChain,
            status: data.status as RelayStatus,
            sourceTxHash: data.sourceTxHash,
            destinationTxHash: data.destinationTxHash,
            createdAt: data.createdAt || Date.now(),
            updatedAt: data.updatedAt || Date.now(),
            error: data.error,
            gasUsed: data.gasUsed ? BigInt(data.gasUsed) : undefined,
            feePaid: data.feePaid ? BigInt(data.feePaid) : undefined,
        };
    }

    /**
     * Parse route response
     */
    private parseRoute(data: any): RelayRoute {
        return {
            sourceChain: data.sourceChain,
            destinationChain: data.destinationChain,
            active: data.active ?? true,
            estimatedTimeSeconds: data.estimatedTimeSeconds ?? 60,
            baseFee: BigInt(data.baseFee || '0'),
            gasPrice: BigInt(data.gasPrice || '0'),
            maxGas: BigInt(data.maxGas || '500000'),
        };
    }

    /**
     * Sleep helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * Create a RelayerClient instance
 */
export function createRelayerClient(config: RelayerClientConfig): RelayerClient {
    return new RelayerClient(config);
}
