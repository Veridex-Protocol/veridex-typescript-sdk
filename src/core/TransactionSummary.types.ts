/**
 * Veridex Protocol SDK - Transaction Summary Types
 * 
 * Human-readable transaction summary types for security and UX (Issue #26)
 * 
 * These types enable users to understand what they're signing before
 * providing biometric authentication, preventing phishing and social engineering.
 */

// ============================================================================
// Action Display Types
// ============================================================================

/**
 * Human-readable action type
 */
export type ActionDisplayType = 'transfer' | 'bridge' | 'config' | 'execute' | 'unknown';

/**
 * Token display information
 */
export interface TokenDisplay {
  /** Token symbol (e.g., "ETH", "USDC") */
  symbol: string;
  /** Human-readable amount (e.g., "1.5") */
  amount: string;
  /** Raw amount in smallest unit */
  rawAmount: bigint;
  /** Token contract address */
  address: string;
  /** Number of decimals */
  decimals: number;
  /** Estimated USD value (if available) */
  usdValue?: string;
  /** Whether this is the native token */
  isNative: boolean;
}

/**
 * Recipient display information
 */
export interface RecipientDisplay {
  /** Raw address (hex) */
  address: string;
  /** ENS name (if resolved) */
  ens?: string;
  /** Truncated address for display (e.g., "0x1234...5678") */
  truncated: string;
  /** Whether this is a contract address */
  isContract?: boolean;
  /** Whether this is a new recipient (never sent to before) */
  isNewRecipient?: boolean;
  /** Label if known (e.g., "My Wallet", "Exchange") */
  label?: string;
}

/**
 * Chain display information
 */
export interface ChainDisplay {
  /** Wormhole chain ID */
  id: number;
  /** Human-readable chain name */
  name: string;
  /** Chain icon URL (optional) */
  iconUrl?: string;
  /** Whether this is a testnet */
  isTestnet: boolean;
}

// ============================================================================
// Risk Warning Types
// ============================================================================

/**
 * Risk level for warnings
 */
export type RiskLevel = 'info' | 'warning' | 'high' | 'critical';

/**
 * Risk warning with message and metadata
 */
export interface RiskWarning {
  /** Severity level */
  level: RiskLevel;
  /** Human-readable warning message */
  message: string;
  /** Warning type for programmatic handling */
  type: RiskWarningType;
  /** Additional context/details */
  details?: string;
}

/**
 * Types of risk warnings
 */
export type RiskWarningType =
  | 'large_transaction'      // Amount exceeds usual activity
  | 'new_recipient'          // First time sending to this address
  | 'contract_interaction'   // Calling an external contract
  | 'full_balance'           // Transferring all assets
  | 'high_gas'               // Gas cost is unusually high
  | 'unknown_token'          // Token not in verified list
  | 'cross_chain'            // Cross-chain operation
  | 'config_change'          // Vault configuration change
  | 'all_tokens'             // Affects all tokens in vault
  | 'irreversible';          // Action cannot be undone

// ============================================================================
// Transaction Summary Types
// ============================================================================

/**
 * Transfer-specific details
 */
export interface TransferDetails {
  token: TokenDisplay;
  recipient: RecipientDisplay;
  chain: ChainDisplay;
}

/**
 * Bridge-specific details
 */
export interface BridgeDetails {
  token: TokenDisplay;
  sourceChain: ChainDisplay;
  destinationChain: ChainDisplay;
  recipient: RecipientDisplay;
  /** Estimated bridge fee */
  bridgeFee?: string;
  /** Estimated arrival time */
  estimatedTime?: string;
}

/**
 * Execute (contract call) details
 */
export interface ExecuteDetails {
  target: RecipientDisplay;
  value: TokenDisplay;
  chain: ChainDisplay;
  /** Function signature if decodable */
  functionName?: string;
  /** Decoded function arguments if available */
  decodedArgs?: Record<string, unknown>;
  /** Raw calldata (hex) */
  calldata: string;
}

/**
 * Config change details
 */
export interface ConfigDetails {
  configType: number;
  configTypeName: string;
  description: string;
  changes: Array<{
    field: string;
    oldValue?: string;
    newValue: string;
  }>;
}

/**
 * Union type for all action-specific details
 */
export type ActionDetails = TransferDetails | BridgeDetails | ExecuteDetails | ConfigDetails;

/**
 * Complete transaction summary for display
 */
export interface TransactionSummary {
  /** Action type for display */
  action: ActionDisplayType;

  /** Human-readable title (e.g., "Send ETH", "Bridge USDC") */
  title: string;

  /** Human-readable description */
  description: string;

  /** Action-specific details */
  details: TransferDetails | BridgeDetails | ExecuteDetails | ConfigDetails | null;

  /** Source vault information */
  vault: {
    address: string;
    truncated: string;
    chain: ChainDisplay;
  };

  /** Fee information */
  fee: {
    /** Estimated gas fee */
    gas: string;
    /** Gas in USD (if available) */
    gasUsd?: string;
    /** Whether fee is paid by relayer */
    paidByRelayer: boolean;
    /** Relayer fee (if applicable) */
    relayerFee?: string;
    /** Total fee */
    total: string;
  };

  /** Risk warnings */
  warnings: RiskWarning[];

  /** Raw technical details for advanced users */
  raw: {
    actionType: number;
    actionPayload: string;
    nonce: bigint;
    challenge: string;
    chainId: number;
    /** Expiration timestamp */
    expiresAt: number;
    /** Time until expiration in human readable form */
    expiresIn: string;
  };

  /** Timestamp when summary was generated */
  generatedAt: number;
}

// ============================================================================
// Parser Configuration
// ============================================================================

/**
 * Configuration for the transaction parser
 */
export interface TransactionParserConfig {
  /** Default chain ID for vault operations */
  defaultChainId?: number;
  /** Known token registry (address -> info) */
  knownTokens?: Map<string, TokenInfo>;
  /** Known recipient labels (address -> label) */
  knownRecipients?: Map<string, string>;
  /** ENS resolver function */
  ensResolver?: (address: string) => Promise<string | null>;
  /** Contract detector function */
  contractDetector?: (address: string) => Promise<boolean>;
  /** Price oracle for USD values */
  priceOracle?: (tokenAddress: string) => Promise<number | null>;
  /** User's transaction history for new recipient detection */
  transactionHistory?: Set<string>;
  /** User's average transaction value for large tx detection */
  averageTransactionValue?: bigint;
}

/**
 * Token info for registry
 */
export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
  verified: boolean;
}

// ============================================================================
// Chain Name Mapping
// ============================================================================

/**
 * Get chain display info from Wormhole chain ID
 */
export const CHAIN_DISPLAY_INFO: Record<number, Omit<ChainDisplay, 'id'>> = {
  // Mainnets
  1: { name: 'Solana', isTestnet: false },
  2: { name: 'Ethereum', isTestnet: false },
  4: { name: 'BSC', isTestnet: false },
  5: { name: 'Polygon', isTestnet: false },
  6: { name: 'Avalanche', isTestnet: false },
  21: { name: 'Sui', isTestnet: false },
  22: { name: 'Aptos', isTestnet: false },
  23: { name: 'Arbitrum', isTestnet: false },
  24: { name: 'Optimism', isTestnet: false },
  30: { name: 'Base', isTestnet: false },

  // Testnets
  10002: { name: 'Sepolia', isTestnet: true },
  10003: { name: 'Arbitrum Sepolia', isTestnet: true },
  10004: { name: 'Base Sepolia', isTestnet: true },
  10005: { name: 'Optimism Sepolia', isTestnet: true },
  50001: { name: 'Starknet Sepolia', isTestnet: true },
  // Note: Avalanche Fuji also uses Wormhole chain ID 6 — same as mainnet.
  // The isTestnet flag on mainnet entry (6) is set to false; frontends should
  // detect testnet via EVM chainId (43113 vs 43114) rather than Wormhole chain ID.
};

/**
 * Get chain display info with fallback
 */
export function getChainDisplay(chainId: number): ChainDisplay {
  const info = CHAIN_DISPLAY_INFO[chainId];
  if (info) {
    return { id: chainId, ...info };
  }
  return {
    id: chainId,
    name: `Chain ${chainId}`,
    isTestnet: chainId >= 10000,
  };
}

// ============================================================================
// Config Type Names
// ============================================================================

export const CONFIG_TYPE_NAMES: Record<number, string> = {
  1: 'Update Spending Limits',
  2: 'Add Guardian',
  3: 'Remove Guardian',
  4: 'Update Recovery Threshold',
  5: 'Add Session Key',
  6: 'Revoke Session Key',
  7: 'Update Emergency Contact',
};

/**
 * Get config type name with fallback
 */
export function getConfigTypeName(configType: number): string {
  return CONFIG_TYPE_NAMES[configType] ?? `Config Update (Type ${configType})`;
}
