/**
 * Veridex Protocol SDK — Unified Error Normalization
 *
 * Wraps chain-specific errors (ethers, Anchor, Clarity, Starknet felt, etc.)
 * into a single VeridexError class with a unified code, human-readable message,
 * and chain identifier.  Integrators can catch `VeridexError` consistently
 * regardless of which chain's SDK surfaced the underlying fault.
 */

// ============================================================================
// Unified Error Codes
// ============================================================================

/**
 * Language-agnostic error codes that map consistently across all chains.
 */
export enum VeridexErrorCode {
    // Wallet / identity errors
    NO_CREDENTIAL = 'NO_CREDENTIAL',
    UNAUTHORIZED = 'UNAUTHORIZED',
    INVALID_SIGNATURE = 'INVALID_SIGNATURE',

    // Vault state errors
    VAULT_NOT_FOUND = 'VAULT_NOT_FOUND',
    VAULT_PAUSED = 'VAULT_PAUSED',
    PROTOCOL_PAUSED = 'PROTOCOL_PAUSED',

    // Balance / limits errors
    INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
    DAILY_LIMIT_EXCEEDED = 'DAILY_LIMIT_EXCEEDED',

    // Payload / dispatch errors
    INVALID_PAYLOAD = 'INVALID_PAYLOAD',
    INVALID_ACTION = 'INVALID_ACTION',
    EXPIRED = 'EXPIRED',

    // Cross-chain / Wormhole errors
    VAA_ALREADY_PROCESSED = 'VAA_ALREADY_PROCESSED',
    INVALID_VAA = 'INVALID_VAA',
    INVALID_EMITTER = 'INVALID_EMITTER',
    BRIDGE_ERROR = 'BRIDGE_ERROR',

    // Network / RPC errors
    RPC_ERROR = 'RPC_ERROR',
    TIMEOUT = 'TIMEOUT',
    RELAYER_ERROR = 'RELAYER_ERROR',

    // Session errors
    SESSION_EXPIRED = 'SESSION_EXPIRED',
    SESSION_INVALID = 'SESSION_INVALID',

    // Capability errors
    UNSUPPORTED_FEATURE = 'UNSUPPORTED_FEATURE',

    // Catch-all
    UNKNOWN = 'UNKNOWN',
}

/**
 * Default human-readable messages for each unified error code.
 */
const DEFAULT_MESSAGES: Record<VeridexErrorCode, string> = {
    [VeridexErrorCode.NO_CREDENTIAL]: 'No credential set. Call passkey.register() or passkey.setCredential() first.',
    [VeridexErrorCode.UNAUTHORIZED]: 'Unauthorized: the signer is not an owner of this vault.',
    [VeridexErrorCode.INVALID_SIGNATURE]: 'Signature verification failed.',
    [VeridexErrorCode.VAULT_NOT_FOUND]: 'Vault does not exist. Call ensureVault() first.',
    [VeridexErrorCode.VAULT_PAUSED]: 'Vault is paused. Unpause before continuing.',
    [VeridexErrorCode.PROTOCOL_PAUSED]: 'Protocol is paused. Try again later.',
    [VeridexErrorCode.INSUFFICIENT_FUNDS]: 'Insufficient funds in vault.',
    [VeridexErrorCode.DAILY_LIMIT_EXCEEDED]: 'Daily spending limit exceeded. Try a smaller amount or wait for reset.',
    [VeridexErrorCode.INVALID_PAYLOAD]: 'Invalid action payload.',
    [VeridexErrorCode.INVALID_ACTION]: 'Unknown or invalid action type.',
    [VeridexErrorCode.EXPIRED]: 'Prepared transaction has expired. Please prepare again.',
    [VeridexErrorCode.VAA_ALREADY_PROCESSED]: 'This cross-chain message has already been processed (replay protection).',
    [VeridexErrorCode.INVALID_VAA]: 'Invalid VAA: verification failed.',
    [VeridexErrorCode.INVALID_EMITTER]: 'Invalid emitter: message source is not trusted.',
    [VeridexErrorCode.BRIDGE_ERROR]: 'Cross-chain bridge error.',
    [VeridexErrorCode.RPC_ERROR]: 'RPC call failed. The node may be unavailable.',
    [VeridexErrorCode.TIMEOUT]: 'Operation timed out.',
    [VeridexErrorCode.RELAYER_ERROR]: 'Relayer submission failed.',
    [VeridexErrorCode.SESSION_EXPIRED]: 'Session key has expired. Create a new session.',
    [VeridexErrorCode.SESSION_INVALID]: 'Session key is invalid or revoked.',
    [VeridexErrorCode.UNSUPPORTED_FEATURE]: 'This feature is not supported on the current chain.',
    [VeridexErrorCode.UNKNOWN]: 'An unknown error occurred.',
};

// ============================================================================
// VeridexError class
// ============================================================================

/**
 * Unified error class for all Veridex SDK operations.
 *
 * @example
 * ```typescript
 * try {
 *   await sdk.executeTransfer(prepared, signer);
 * } catch (err) {
 *   if (err instanceof VeridexError) {
 *     console.log(err.code);   // 'INSUFFICIENT_FUNDS'
 *     console.log(err.chain);  // 'base'
 *     console.log(err.cause);  // original ethers error
 *   }
 * }
 * ```
 */
export class VeridexError extends Error {
    /** Unified error code */
    public readonly code: VeridexErrorCode;
    /** Chain name where the error originated (e.g. 'base', 'solana') */
    public readonly chain: string | undefined;
    /** Original chain-specific error */
    public override readonly cause: unknown;
    /** Whether the operation could succeed if retried */
    public readonly retryable: boolean;

    constructor(
        code: VeridexErrorCode,
        message?: string,
        options?: {
            chain?: string;
            cause?: unknown;
            retryable?: boolean;
        },
    ) {
        super(message ?? DEFAULT_MESSAGES[code]);
        this.name = 'VeridexError';
        this.code = code;
        this.chain = options?.chain;
        this.cause = options?.cause;
        this.retryable = options?.retryable ?? RETRYABLE_CODES.has(code);
    }
}

/** Codes that are inherently retryable (transient failures) */
const RETRYABLE_CODES = new Set<VeridexErrorCode>([
    VeridexErrorCode.RPC_ERROR,
    VeridexErrorCode.TIMEOUT,
    VeridexErrorCode.RELAYER_ERROR,
]);

// ============================================================================
// Chain-specific error normalization
// ============================================================================

// Regex / string patterns used to detect common chain errors
const EVM_PATTERNS: Array<[RegExp | string, VeridexErrorCode]> = [
    [/insufficient funds/i, VeridexErrorCode.INSUFFICIENT_FUNDS],
    [/execution reverted.*paused/i, VeridexErrorCode.VAULT_PAUSED],
    [/execution reverted.*unauthorized|not\s*owner/i, VeridexErrorCode.UNAUTHORIZED],
    [/daily.*limit/i, VeridexErrorCode.DAILY_LIMIT_EXCEEDED],
    [/nonce.*expired|nonce.*too\s*low/i, VeridexErrorCode.EXPIRED],
    [/already.*processed|already\s*known/i, VeridexErrorCode.VAA_ALREADY_PROCESSED],
    [/invalid.*signature|ECDSA/i, VeridexErrorCode.INVALID_SIGNATURE],
    [/timeout|ETIMEDOUT|ECONNREFUSED/i, VeridexErrorCode.TIMEOUT],
    [/could not detect network|failed to fetch|network/i, VeridexErrorCode.RPC_ERROR],
];

const SOLANA_CODE_MAP: Record<number, VeridexErrorCode> = {
    6000: VeridexErrorCode.PROTOCOL_PAUSED,
    6001: VeridexErrorCode.VAULT_PAUSED,
    6002: VeridexErrorCode.VAA_ALREADY_PROCESSED,
    6003: VeridexErrorCode.INVALID_EMITTER,
    6004: VeridexErrorCode.INVALID_EMITTER,
    6005: VeridexErrorCode.UNAUTHORIZED,
    6006: VeridexErrorCode.BRIDGE_ERROR,
    6007: VeridexErrorCode.INVALID_PAYLOAD,
    6008: VeridexErrorCode.INVALID_PAYLOAD,
    6009: VeridexErrorCode.INVALID_ACTION,
    6010: VeridexErrorCode.DAILY_LIMIT_EXCEEDED,
    6011: VeridexErrorCode.INSUFFICIENT_FUNDS,
    6012: VeridexErrorCode.UNAUTHORIZED,
    6013: VeridexErrorCode.INVALID_VAA,
};

const STARKNET_PATTERNS: Array<[RegExp | string, VeridexErrorCode]> = [
    [/insufficient.*balance|not enough/i, VeridexErrorCode.INSUFFICIENT_FUNDS],
    [/PAUSED|is paused/i, VeridexErrorCode.VAULT_PAUSED],
    [/UNAUTHORIZED|not.*authorized/i, VeridexErrorCode.UNAUTHORIZED],
    [/already.*processed/i, VeridexErrorCode.VAA_ALREADY_PROCESSED],
    [/invalid.*signature/i, VeridexErrorCode.INVALID_SIGNATURE],
];

const STACKS_CLARITY_MAP: Record<number, VeridexErrorCode> = {
    100: VeridexErrorCode.UNAUTHORIZED,       // err-unauthorized
    101: VeridexErrorCode.VAULT_PAUSED,       // err-paused
    102: VeridexErrorCode.INVALID_PAYLOAD,    // err-invalid-payload
    103: VeridexErrorCode.INSUFFICIENT_FUNDS, // err-insufficient-funds
    104: VeridexErrorCode.DAILY_LIMIT_EXCEEDED, // err-limit-exceeded
    105: VeridexErrorCode.VAULT_NOT_FOUND,    // err-not-found
    106: VeridexErrorCode.INVALID_SIGNATURE,  // err-invalid-signature
    200: VeridexErrorCode.VAA_ALREADY_PROCESSED, // err-already-processed
    201: VeridexErrorCode.INVALID_VAA,        // err-invalid-vaa
    202: VeridexErrorCode.INVALID_EMITTER,    // err-invalid-emitter
};

/**
 * Normalize any chain-specific error into a VeridexError.
 *
 * Call this at SDK boundaries (dispatch, balance fetch, vault creation) to
 * give integrators a consistent error surface.
 *
 * @param error  - The original error from chain client / RPC / Anchor / etc.
 * @param chain  - Chain identifier string (e.g. 'base', 'solana', 'starknet')
 * @returns A VeridexError wrapping the original
 */
export function normalizeError(error: unknown, chain?: string): VeridexError {
    // Already normalized
    if (error instanceof VeridexError) {
        return error;
    }

    const msg = error instanceof Error ? error.message : String(error);

    // --- Solana / Anchor numeric codes ---
    const anchorMatch = msg.match(/custom program error:\s*0x([0-9a-fA-F]+)/i)
        ?? msg.match(/Error Code:\s*(\w+)\.\s*Error Number:\s*(\d+)/i);
    if (anchorMatch) {
        const code = anchorMatch[2]
            ? parseInt(anchorMatch[2], 10)
            : parseInt(anchorMatch[1], 16);
        const mapped = SOLANA_CODE_MAP[code];
        if (mapped) {
            return new VeridexError(mapped, undefined, { chain: chain ?? 'solana', cause: error });
        }
    }

    // --- Stacks Clarity error codes ---
    const clarityMatch = msg.match(/\(err\s+u(\d+)\)/i);
    if (clarityMatch) {
        const code = parseInt(clarityMatch[1], 10);
        const mapped = STACKS_CLARITY_MAP[code];
        if (mapped) {
            return new VeridexError(mapped, undefined, { chain: chain ?? 'stacks', cause: error });
        }
    }

    // --- Starknet patterns ---
    if (chain === 'starknet' || /felt|starknet|cairo/i.test(msg)) {
        for (const [pattern, code] of STARKNET_PATTERNS) {
            if (typeof pattern === 'string' ? msg.includes(pattern) : pattern.test(msg)) {
                return new VeridexError(code, undefined, { chain: chain ?? 'starknet', cause: error });
            }
        }
    }

    // --- EVM patterns (including ethers error codes) ---
    for (const [pattern, code] of EVM_PATTERNS) {
        if (typeof pattern === 'string' ? msg.includes(pattern) : pattern.test(msg)) {
            return new VeridexError(code, undefined, { chain, cause: error });
        }
    }

    // --- ethers specific error codes ---
    const ethersError = error as any;
    if (ethersError?.code === 'INSUFFICIENT_FUNDS') {
        return new VeridexError(VeridexErrorCode.INSUFFICIENT_FUNDS, undefined, { chain, cause: error });
    }
    if (ethersError?.code === 'CALL_EXCEPTION') {
        return new VeridexError(VeridexErrorCode.RPC_ERROR, `Contract call failed: ${msg}`, { chain, cause: error });
    }
    if (ethersError?.code === 'NETWORK_ERROR' || ethersError?.code === 'SERVER_ERROR') {
        return new VeridexError(VeridexErrorCode.RPC_ERROR, undefined, { chain, cause: error, retryable: true });
    }
    if (ethersError?.code === 'TIMEOUT') {
        return new VeridexError(VeridexErrorCode.TIMEOUT, undefined, { chain, cause: error, retryable: true });
    }

    // --- Generic fallback ---
    return new VeridexError(VeridexErrorCode.UNKNOWN, msg, { chain, cause: error });
}
