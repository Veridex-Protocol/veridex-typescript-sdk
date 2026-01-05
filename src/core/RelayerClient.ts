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
 * Uses full WebAuthn data for authenticateAndDispatch
 */
export interface SubmitSignedActionRequest {
    /** WebAuthn authenticatorData (hex) */
    authenticatorData: string;
    /** WebAuthn clientDataJSON (raw string) */
    clientDataJSON: string;
    /** Index of "challenge":"..." in clientDataJSON */
    challengeIndex: number;
    /** Index of "type":"..." in clientDataJSON */
    typeIndex: number;
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
 * Query submission request (Issue #11/#12)
 * For optimistic execution via Wormhole Query proofs (~5-7s vs ~120s)
 */
export interface SubmitQueryRequest {
    /** Target spoke chain Wormhole ID */
    targetChain: number;
    /** User's key hash */
    userKeyHash: string;
    /** Serialized transaction for spoke chain */
    serializedTx: string; // hex
    /** Query proof with Guardian signatures */
    queryProof: {
        /** Raw query response bytes */
        queryResponse: string; // hex
        /** Guardian signatures */
        signatures: string; // hex
    };
    /** Whether to fallback to VAA if Query fails */
    fallbackToVaa?: boolean;
    /** Optional metadata */
    metadata?: {
        /** User's preferred execution path */
        preferredPath?: 'query' | 'vaa';
        /** Transaction value in USD (for routing decisions) */
        estimatedValueUSD?: number;
    };
}

/**
 * Query submission result (Issue #11/#12)
 */
export interface SubmitQueryResult {
    /** Whether submission succeeded */
    success: boolean;
    /** Transaction hash on spoke chain */
    txHash?: string;
    /** Execution path used */
    path: 'query' | 'vaa';
    /** Latency in milliseconds */
    latencyMs?: number;
    /** Error message if failed */
    error?: string;
    /** Whether fallback to VAA occurred */
    fellBack?: boolean;
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
        void vaaBase64;
        void sourceChain;
        void destinationChain;
        void sourceTxHash;
        void sequence;
        void feeQuoteId;
        throw new Error(
            'submitRelay() is not supported by the current Veridex relayer API. ' +
            'Use submitSignedAction() and let the relayer observe hub events to relay automatically.'
        );
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
        try {
            const response = await this.fetch('/api/v1/submit', {
                method: 'POST',
                body: JSON.stringify(request),
            });

            return {
                success: response.success,
                txHash: response.transactionHash ?? response.txHash,
                sequence: response.sequence,
                error: response.error,
                message: response.message,
            };
        } catch (err: any) {
            // Handle 400 errors gracefully - the relayer returns error details in the body
            if (err.status === 400 && err.body) {
                return {
                    success: false,
                    error: err.body.error ?? 'Relayer returned 400 Bad Request',
                    message: err.body.message,
                };
            }
            // Re-throw other errors
            throw err;
        }
    }

    /**
     * Submit a Query-based transaction for optimistic execution (Issue #11/#12)
     * 
     * Uses Wormhole Cross-Chain Queries (CCQ) to achieve ~5-7 second latency
     * vs ~120+ seconds for traditional VAA flow.
     * 
     * Flow:
     * 1. Client fetches Hub state via queryHubState() from SDK
     * 2. Client constructs and signs transaction
     * 3. Client submits Query proof + tx to this endpoint
     * 4. Relayer validates format and submits to spoke chain
     * 5. Spoke chain verifies Guardian signatures on-chain
     * 
     * @param request - Query submission with Guardian-signed proof
     * @returns Result including spoke tx hash and execution path
     */
    async submitQuery(request: SubmitQueryRequest): Promise<SubmitQueryResult> {
        try {
            const response = await this.fetch('/api/v1/submit-query', {
                method: 'POST',
                body: JSON.stringify(request),
            });

            return {
                success: response.success ?? false,
                txHash: response.txHash,
                path: response.path ?? 'query',
                latencyMs: response.latencyMs,
                error: response.error,
                fellBack: response.fellBack ?? false,
            };
        } catch (err: any) {
            // Handle errors gracefully
            if (err.status === 400 && err.body) {
                return {
                    success: false,
                    path: 'query',
                    error: err.body.error ?? 'Relayer returned 400 Bad Request',
                };
            }
            throw err;
        }
    }

    /**
     * Get relay request status
     */
    async getRelayStatus(requestId: string): Promise<RelayRequest> {
        void requestId;
        throw new Error('getRelayStatus() is not supported by the current Veridex relayer API.');
    }

    /**
     * Get relay status by source transaction hash
     */
    async getRelayBySourceTx(sourceTxHash: string): Promise<RelayRequest | null> {
        void sourceTxHash;
        return null;
    }

    /**
     * Get relay status by sequence number
     */
    async getRelayBySequence(
        sourceChain: number,
        sequence: bigint
    ): Promise<RelayRequest | null> {
        void sourceChain;
        void sequence;
        return null;
    }

    /**
     * Cancel a pending relay request
     */
    async cancelRelay(requestId: string): Promise<boolean> {
        void requestId;
        return false;
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
        void requestId;
        void timeoutMs;
        void pollingIntervalMs;
        void onProgress;
        throw new Error('waitForRelay() is not supported by the current Veridex relayer API.');
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
        void sourceChain;
        void estimatedGas;

        // The relayer currently returns a simple fee breakdown; we map it into the
        // existing RelayFeeQuote shape with best-effort defaults.
        const response = await this.fetch(`/api/v1/fee?targetChain=${destinationChain}`);
        const relayerFee = BigInt(response?.fees?.relayer ?? '0');
        const total = BigInt(response?.fees?.total ?? relayerFee.toString());

        return {
            sourceChain: sourceChain,
            destinationChain,
            feeInSourceToken: total,
            feeInDestinationToken: relayerFee,
            estimatedGas: 0n,
            expiresAt: Date.now() + 60_000,
            quoteId: '',
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
            name: 'veridex-relayer',
            version: response?.relayer?.version ?? response?.version ?? 'unknown',
            supportedChains: (response?.supportedChains || []).map((c: any) => c.wormholeChainId ?? c),
            routes: [],
            online: true,
            queueDepth: 0,
        };
    }

    /**
     * Get supported routes
     */
    async getRoutes(): Promise<RelayRoute[]> {
        throw new Error('getRoutes() is not supported by the current Veridex relayer API.');
    }

    /**
     * Check if a route is supported
     */
    async isRouteSupported(
        sourceChain: number,
        destinationChain: number
    ): Promise<boolean> {
        void sourceChain;
        void destinationChain;
        return false;
    }

    /**
     * Check relayer health
     */
    async healthCheck(): Promise<boolean> {
        try {
            const response = await this.fetch('/health');
            return response.status === 'healthy' || response.status === 'degraded' || response.healthy === true;
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
        void userKeyHash;
        return [];
    }

    /**
     * Get relay history for a user
     */
    async getRelayHistory(
        userKeyHash: string,
        limit: number = 50,
        offset: number = 0
    ): Promise<RelayRequest[]> {
        void userKeyHash;
        void limit;
        void offset;
        return [];
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * SDK version for telemetry
     */
    private static readonly SDK_VERSION = '1.0.0-beta.1';

    /**
     * Make an HTTP request to the relayer
     */
    private async fetch(
        path: string,
        options: RequestInit = {}
    ): Promise<any> {
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
            'User-Agent': `@veridex/sdk/${RelayerClient.SDK_VERSION}`,
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
