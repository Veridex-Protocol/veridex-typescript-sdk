/**
 * Veridex Solana Program Error Codes
 *
 * Error code constants for parsing and handling Veridex program errors.
 * These codes map directly to the Anchor error enum variants in the
 * Solana program.
 *
 * @packageDocumentation
 */

// ============================================================================
// Error Code Ranges
// ============================================================================

/**
 * Error code range boundaries.
 * Use these to categorize errors programmatically.
 */
export const ERROR_RANGES = {
  /** Core protocol errors (paused, unauthorized, limits, etc.) */
  CORE: { min: 6000, max: 6099 },
  /** Query execution errors */
  QUERY_EXECUTION: { min: 6100, max: 6149 },
  /** ABI decoding errors */
  ABI: { min: 6150, max: 6199 },
  /** Query parsing/validation errors */
  QUERY_PARSING: { min: 6200, max: 6299 },
} as const;

// ============================================================================
// Core Protocol Error Codes (6000-6099)
// ============================================================================

export const VERIDEX_ERRORS = {
  // Core Protocol Errors
  /** Protocol is globally paused */
  PROTOCOL_PAUSED: 6000,
  /** Vault is paused */
  VAULT_PAUSED: 6001,
  /** VAA already processed (replay protection) */
  VAA_ALREADY_PROCESSED: 6002,
  /** Invalid emitter chain */
  INVALID_EMITTER_CHAIN: 6003,
  /** Invalid emitter address */
  INVALID_EMITTER: 6004,
  /** Invalid owner */
  INVALID_OWNER: 6005,
  /** Invalid target chain */
  INVALID_TARGET_CHAIN: 6006,
  /** Invalid payload version */
  INVALID_PAYLOAD_VERSION: 6007,
  /** Invalid action payload */
  INVALID_ACTION_PAYLOAD: 6008,
  /** Invalid action type */
  INVALID_ACTION_TYPE: 6009,
  /** Daily limit exceeded */
  DAILY_LIMIT_EXCEEDED: 6010,
  /** Insufficient funds */
  INSUFFICIENT_FUNDS: 6011,
  /** Unauthorized */
  UNAUTHORIZED: 6012,
  /** Invalid VAA */
  INVALID_VAA: 6013,
  /** Token bridge not configured */
  TOKEN_BRIDGE_NOT_CONFIGURED: 6014,
  /** Invalid bridge parameters */
  INVALID_BRIDGE_PARAMS: 6015,

  // Query Execution Errors (6100-6149)
  /** Invalid query response format */
  INVALID_QUERY_RESPONSE: 6100,
  /** Query response expired (> 60 seconds old) */
  QUERY_EXPIRED: 6101,
  /** Query signature verification failed */
  QUERY_INVALID: 6102,
  /** Query result doesn't match expected state */
  QUERY_MISMATCH: 6103,
  /** Query block time is in the future */
  QUERY_FUTURE_BLOCK: 6104,
  /** Invalid nonce in query response */
  INVALID_QUERY_NONCE: 6105,
  /** Secp256k1 verification instruction missing */
  SECP256K1_INSTRUCTION_MISSING: 6106,
  /** Invalid secp256k1 instruction format */
  INVALID_SECP256K1_INSTRUCTION: 6107,
  /** Insufficient Guardian signatures on query */
  INSUFFICIENT_SIGNATURES: 6108,
  /** Chain ID mismatch in query response */
  CHAIN_ID_MISMATCH: 6109,
  /** Query result not found */
  QUERY_RESULT_NOT_FOUND: 6110,

  // ABI Decoding Errors (6150-6199)
  /** ABI decoding: insufficient data */
  ABI_INSUFFICIENT_DATA: 6150,
  /** ABI decoding: value overflow */
  ABI_OVERFLOW: 6151,
  /** ABI decoding: invalid encoding */
  ABI_INVALID_ENCODING: 6152,
  /** ABI decoding: general failure */
  ABI_DECODING_FAILED: 6153,

  // Query Parsing Errors (6200-6299)
  /** Invalid query response format (parsing) */
  QUERY_PARSE_INVALID_RESPONSE: 6200,
  /** Invalid query version */
  QUERY_PARSE_INVALID_VERSION: 6201,
  /** Unsupported query type */
  QUERY_PARSE_UNSUPPORTED_TYPE: 6202,
  /** Query response is stale (parsing) */
  QUERY_PARSE_STALE: 6203,
  /** Query block time is in the future (parsing) */
  QUERY_PARSE_FUTURE_BLOCK: 6204,
  /** Invalid Hub state data */
  QUERY_PARSE_INVALID_HUB_STATE: 6205,
  /** Invalid nonce (parsing) */
  QUERY_PARSE_INVALID_NONCE: 6206,
  /** Query result doesn't match expected (parsing) */
  QUERY_PARSE_MISMATCH: 6207,
  /** Secp256k1 instruction not found (parsing) */
  QUERY_PARSE_SECP256K1_MISSING: 6208,
  /** Invalid Secp256k1 instruction (parsing) */
  QUERY_PARSE_INVALID_SECP256K1: 6209,
  /** Insufficient Guardian signatures (parsing) */
  QUERY_PARSE_INSUFFICIENT_SIGS: 6210,
  /** Invalid Guardian signature (parsing) */
  QUERY_PARSE_INVALID_GUARDIAN_SIG: 6211,
  /** Chain ID mismatch (parsing) */
  QUERY_PARSE_CHAIN_ID_MISMATCH: 6212,
  /** Guardian index out of range */
  QUERY_PARSE_GUARDIAN_INDEX_OOB: 6213,
  /** Non-increasing Guardian index */
  QUERY_PARSE_NON_INCREASING_INDEX: 6214,
  /** Query signature verification failed (parsing) */
  QUERY_PARSE_INVALID_SIGNATURE: 6215,
  /** ABI decoding failed (parsing) */
  QUERY_PARSE_ABI_FAILED: 6216,
} as const;

export type VeridexErrorCode = (typeof VERIDEX_ERRORS)[keyof typeof VERIDEX_ERRORS];

// ============================================================================
// Error Messages
// ============================================================================

/**
 * Human-readable error messages for each error code.
 */
export const ERROR_MESSAGES: Record<VeridexErrorCode, string> = {
  // Core Protocol Errors
  [VERIDEX_ERRORS.PROTOCOL_PAUSED]: "Protocol is paused",
  [VERIDEX_ERRORS.VAULT_PAUSED]: "Vault is paused",
  [VERIDEX_ERRORS.VAA_ALREADY_PROCESSED]:
    "This transaction has already been processed",
  [VERIDEX_ERRORS.INVALID_EMITTER_CHAIN]: "Invalid emitter chain",
  [VERIDEX_ERRORS.INVALID_EMITTER]: "Invalid emitter address",
  [VERIDEX_ERRORS.INVALID_OWNER]: "Invalid owner",
  [VERIDEX_ERRORS.INVALID_TARGET_CHAIN]: "Invalid target chain",
  [VERIDEX_ERRORS.INVALID_PAYLOAD_VERSION]: "Unsupported payload version",
  [VERIDEX_ERRORS.INVALID_ACTION_PAYLOAD]: "Invalid action payload",
  [VERIDEX_ERRORS.INVALID_ACTION_TYPE]: "Unknown action type",
  [VERIDEX_ERRORS.DAILY_LIMIT_EXCEEDED]: "Daily spending limit exceeded",
  [VERIDEX_ERRORS.INSUFFICIENT_FUNDS]: "Insufficient funds in vault",
  [VERIDEX_ERRORS.UNAUTHORIZED]: "Unauthorized",
  [VERIDEX_ERRORS.INVALID_VAA]: "Invalid VAA",
  [VERIDEX_ERRORS.TOKEN_BRIDGE_NOT_CONFIGURED]: "Token bridge not configured",
  [VERIDEX_ERRORS.INVALID_BRIDGE_PARAMS]: "Invalid bridge parameters",

  // Query Execution Errors
  [VERIDEX_ERRORS.INVALID_QUERY_RESPONSE]: "Invalid query response format",
  [VERIDEX_ERRORS.QUERY_EXPIRED]:
    "Query has expired. Please refresh and try again.",
  [VERIDEX_ERRORS.QUERY_INVALID]: "Query signature verification failed",
  [VERIDEX_ERRORS.QUERY_MISMATCH]: "Query result does not match expected state",
  [VERIDEX_ERRORS.QUERY_FUTURE_BLOCK]:
    "Query block time is in the future. Possible clock skew.",
  [VERIDEX_ERRORS.INVALID_QUERY_NONCE]: "Invalid nonce in query response",
  [VERIDEX_ERRORS.SECP256K1_INSTRUCTION_MISSING]:
    "Secp256k1 verification instruction missing",
  [VERIDEX_ERRORS.INVALID_SECP256K1_INSTRUCTION]:
    "Invalid secp256k1 instruction format",
  [VERIDEX_ERRORS.INSUFFICIENT_SIGNATURES]:
    "Insufficient Guardian signatures on query",
  [VERIDEX_ERRORS.CHAIN_ID_MISMATCH]: "Chain ID mismatch in query response",
  [VERIDEX_ERRORS.QUERY_RESULT_NOT_FOUND]: "Query result not found",

  // ABI Decoding Errors
  [VERIDEX_ERRORS.ABI_INSUFFICIENT_DATA]: "ABI decoding failed: insufficient data",
  [VERIDEX_ERRORS.ABI_OVERFLOW]: "ABI decoding failed: value overflow",
  [VERIDEX_ERRORS.ABI_INVALID_ENCODING]: "ABI decoding failed: invalid encoding",
  [VERIDEX_ERRORS.ABI_DECODING_FAILED]: "Failed to decode data from Hub",

  // Query Parsing Errors
  [VERIDEX_ERRORS.QUERY_PARSE_INVALID_RESPONSE]: "Invalid query response format",
  [VERIDEX_ERRORS.QUERY_PARSE_INVALID_VERSION]: "Invalid query version",
  [VERIDEX_ERRORS.QUERY_PARSE_UNSUPPORTED_TYPE]: "Unsupported query type",
  [VERIDEX_ERRORS.QUERY_PARSE_STALE]: "Query response is stale",
  [VERIDEX_ERRORS.QUERY_PARSE_FUTURE_BLOCK]: "Query block time is in the future",
  [VERIDEX_ERRORS.QUERY_PARSE_INVALID_HUB_STATE]: "Invalid Hub state data",
  [VERIDEX_ERRORS.QUERY_PARSE_INVALID_NONCE]: "Invalid nonce in query",
  [VERIDEX_ERRORS.QUERY_PARSE_MISMATCH]: "Query result mismatch",
  [VERIDEX_ERRORS.QUERY_PARSE_SECP256K1_MISSING]: "Secp256k1 instruction not found",
  [VERIDEX_ERRORS.QUERY_PARSE_INVALID_SECP256K1]: "Invalid Secp256k1 instruction",
  [VERIDEX_ERRORS.QUERY_PARSE_INSUFFICIENT_SIGS]:
    "Insufficient Guardian signatures",
  [VERIDEX_ERRORS.QUERY_PARSE_INVALID_GUARDIAN_SIG]: "Invalid Guardian signature",
  [VERIDEX_ERRORS.QUERY_PARSE_CHAIN_ID_MISMATCH]: "Chain ID mismatch",
  [VERIDEX_ERRORS.QUERY_PARSE_GUARDIAN_INDEX_OOB]: "Guardian index out of range",
  [VERIDEX_ERRORS.QUERY_PARSE_NON_INCREASING_INDEX]:
    "Non-increasing Guardian index",
  [VERIDEX_ERRORS.QUERY_PARSE_INVALID_SIGNATURE]:
    "Query signature verification failed",
  [VERIDEX_ERRORS.QUERY_PARSE_ABI_FAILED]: "ABI decoding failed",
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an error code is in the core protocol range.
 */
export function isCoreError(code: number): boolean {
  return code >= ERROR_RANGES.CORE.min && code <= ERROR_RANGES.CORE.max;
}

/**
 * Check if an error code is a query execution error.
 */
export function isQueryExecutionError(code: number): boolean {
  return (
    code >= ERROR_RANGES.QUERY_EXECUTION.min &&
    code <= ERROR_RANGES.QUERY_EXECUTION.max
  );
}

/**
 * Check if an error code is an ABI decoding error.
 */
export function isAbiError(code: number): boolean {
  return code >= ERROR_RANGES.ABI.min && code <= ERROR_RANGES.ABI.max;
}

/**
 * Check if an error code is a query parsing error.
 */
export function isQueryParsingError(code: number): boolean {
  return (
    code >= ERROR_RANGES.QUERY_PARSING.min &&
    code <= ERROR_RANGES.QUERY_PARSING.max
  );
}

/**
 * Check if an error is related to query operations (execution or parsing).
 */
export function isQueryError(code: number): boolean {
  return isQueryExecutionError(code) || isQueryParsingError(code);
}

/**
 * Get the error category as a human-readable string.
 */
export function getErrorCategory(code: number): string {
  if (isCoreError(code)) return "Core Protocol";
  if (isQueryExecutionError(code)) return "Query Execution";
  if (isAbiError(code)) return "ABI Decoding";
  if (isQueryParsingError(code)) return "Query Parsing";
  return "Unknown";
}

/**
 * Get the human-readable message for an error code.
 */
export function getErrorMessage(code: number): string {
  return ERROR_MESSAGES[code as VeridexErrorCode] ?? `Unknown error: ${code}`;
}

/**
 * Parse an Anchor program error to extract the Veridex error code.
 *
 * @param error - The error object from a failed transaction
 * @returns The error code if found, undefined otherwise
 */
export function parseVeridexError(error: unknown): VeridexErrorCode | undefined {
  if (!error || typeof error !== "object") return undefined;

  // Handle Anchor ProgramError
  const anchorError = error as {
    code?: number;
    error?: { errorCode?: { code?: string; number?: number } };
  };

  // Try direct code property
  if (typeof anchorError.code === "number") {
    if (anchorError.code in ERROR_MESSAGES) {
      return anchorError.code as VeridexErrorCode;
    }
  }

  // Try Anchor v0.30+ error format
  if (anchorError.error?.errorCode?.number !== undefined) {
    const code = anchorError.error.errorCode.number;
    if (code in ERROR_MESSAGES) {
      return code as VeridexErrorCode;
    }
  }

  return undefined;
}

/**
 * Check if the error is a retryable error (e.g., expired query can be refreshed).
 */
export function isRetryableError(code: number): boolean {
  const retryableCodes: number[] = [
    VERIDEX_ERRORS.QUERY_EXPIRED,
    VERIDEX_ERRORS.QUERY_PARSE_STALE,
    VERIDEX_ERRORS.QUERY_FUTURE_BLOCK,
    VERIDEX_ERRORS.QUERY_PARSE_FUTURE_BLOCK,
    VERIDEX_ERRORS.QUERY_MISMATCH,
    VERIDEX_ERRORS.QUERY_PARSE_MISMATCH,
  ];
  return retryableCodes.includes(code);
}

/**
 * Suggested user action for common errors.
 */
export function getSuggestedAction(code: number): string {
  switch (code) {
    case VERIDEX_ERRORS.QUERY_EXPIRED:
    case VERIDEX_ERRORS.QUERY_PARSE_STALE:
      return "The query data has expired. Please refresh and try again.";
    case VERIDEX_ERRORS.QUERY_FUTURE_BLOCK:
    case VERIDEX_ERRORS.QUERY_PARSE_FUTURE_BLOCK:
      return "Clock synchronization issue detected. Please wait a moment and retry.";
    case VERIDEX_ERRORS.INSUFFICIENT_FUNDS:
      return "Add more funds to your vault before attempting this operation.";
    case VERIDEX_ERRORS.DAILY_LIMIT_EXCEEDED:
      return "Daily spending limit exceeded. Wait until tomorrow or increase your limit.";
    case VERIDEX_ERRORS.PROTOCOL_PAUSED:
      return "The protocol is temporarily paused. Please try again later.";
    case VERIDEX_ERRORS.VAULT_PAUSED:
      return "Your vault is paused. Contact support if this is unexpected.";
    case VERIDEX_ERRORS.INSUFFICIENT_SIGNATURES:
    case VERIDEX_ERRORS.QUERY_PARSE_INSUFFICIENT_SIGS:
      return "Waiting for Guardian consensus. Please try again in a few seconds.";
    default:
      return "An error occurred. Please try again or contact support.";
  }
}
