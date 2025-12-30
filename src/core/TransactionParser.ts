/**
 * Veridex Protocol SDK - Transaction Parser
 * 
 * Parses transaction payloads into human-readable summaries (Issue #26)
 * 
 * Security-critical: This module MUST accurately represent what users are signing.
 * Any mismatch between displayed information and actual transaction is a security vulnerability.
 */

import { ethers } from 'ethers';
import {
  ACTION_TRANSFER,
  ACTION_EXECUTE,
  ACTION_CONFIG,
  ACTION_BRIDGE,
} from '../constants.js';
import {
  decodeTransferAction,
  decodeBridgeAction,
} from '../payload.js';
import type { PreparedTransfer, PreparedBridge } from './types.js';
import type { BridgeParams, TransferParams } from '../types.js';
import type {
  TransactionSummary,
  TransactionParserConfig,
  TokenDisplay,
  RecipientDisplay,
  ChainDisplay,
  RiskWarning,
  TransferDetails,
  BridgeDetails,
  ExecuteDetails,
  ConfigDetails,
  TokenInfo,
} from './TransactionSummary.types.js';
import { getChainDisplay, getConfigTypeName } from './TransactionSummary.types.js';

// ============================================================================
// Default Token Registry
// ============================================================================

const DEFAULT_TOKENS: Map<string, TokenInfo> = new Map([
  // Native token placeholder
  ['0x0000000000000000000000000000000000000000', {
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    verified: true,
  }],
  ['native', {
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    verified: true,
  }],
  // Common stablecoins (Base Sepolia)
  ['0x036cbd53842c5426634e7929541ec2318f3dcf7e', {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    verified: true,
  }],
]);

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a bigint amount to human-readable string
 */
export function formatAmount(amount: bigint, decimals: number): string {
  if (amount === 0n) return '0';
  
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const remainder = amount % divisor;
  
  if (remainder === 0n) {
    return whole.toString();
  }
  
  // Format with decimal places
  const remainderStr = remainder.toString().padStart(decimals, '0');
  // Trim trailing zeros
  const trimmed = remainderStr.replace(/0+$/, '');
  
  return `${whole}.${trimmed}`;
}

/**
 * Truncate an address for display
 */
export function truncateAddress(address: string, startChars = 6, endChars = 4): string {
  if (address.length <= startChars + endChars + 3) {
    return address;
  }
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Format time remaining until expiration
 */
export function formatTimeRemaining(expiresAt: number): string {
  const now = Date.now();
  const remaining = expiresAt - now;
  
  if (remaining <= 0) return 'Expired';
  
  const seconds = Math.floor(remaining / 1000);
  if (seconds < 60) return `${seconds} seconds`;
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Check if address is the zero address (native token)
 */
export function isNativeToken(address: string): boolean {
  return address === '0x0000000000000000000000000000000000000000' ||
         address === 'native' ||
         address === ethers.ZeroAddress;
}

// ============================================================================
// Transaction Parser Class
// ============================================================================

/**
 * Parses prepared transactions into human-readable summaries
 */
export class TransactionParser {
  private config: TransactionParserConfig;
  private tokenRegistry: Map<string, TokenInfo>;

  constructor(config: TransactionParserConfig = {}) {
    this.config = config;
    this.tokenRegistry = config.knownTokens ?? new Map(DEFAULT_TOKENS);
  }

  /**
   * Main entry point: parse a prepared transfer into a human-readable summary
   * 
   * This method determines the action type from the payload and delegates
   * to the appropriate specialized parser.
   * 
   * @param prepared - PreparedTransfer or PreparedBridge object from SDK
   * @param vaultAddress - Optional vault address (uses default if not provided)
   * @param vaultChainId - Optional vault chain ID (uses config default if not provided)
   */
  async parse(
    prepared: PreparedTransfer | PreparedBridge,
    vaultAddress?: string,
    vaultChainId?: number
  ): Promise<TransactionSummary> {
    const effectiveVaultAddress = vaultAddress ?? '0x0000000000000000000000000000000000000000';
    
    // Determine chain ID based on type - PreparedBridge uses destinationChain, PreparedTransfer uses params.targetChain
    const isBridgePrepared = 'destinationChain' in prepared;
    const defaultChainId = isBridgePrepared 
      ? (prepared as PreparedBridge).destinationChain 
      : (prepared as PreparedTransfer).params.targetChain;
    const effectiveChainId = vaultChainId ?? this.config.defaultChainId ?? defaultChainId;
    
    // Normalize to PreparedTransfer with defaults for missing fields
    // For PreparedBridge, we construct params from the bridge-specific fields
    const normalizedParams: TransferParams = isBridgePrepared 
      ? {
          targetChain: (prepared as PreparedBridge).destinationChain,
          token: (prepared as PreparedBridge).params.token,
          recipient: (prepared as PreparedBridge).params.recipient,
          amount: (prepared as PreparedBridge).params.amount,
        }
      : (prepared as PreparedTransfer).params;

    const normalized: PreparedTransfer = {
      params: normalizedParams,
      actionPayload: prepared.actionPayload,
      nonce: prepared.nonce,
      challenge: prepared.challenge,
      estimatedGas: (prepared as PreparedTransfer).estimatedGas ?? 0n,
      gasPrice: (prepared as PreparedTransfer).gasPrice ?? 0n,
      messageFee: (prepared as PreparedTransfer).messageFee ?? (isBridgePrepared ? (prepared as PreparedBridge).fees?.relayerFee ?? 0n : 0n),
      totalCost: (prepared as PreparedTransfer).totalCost ?? 0n,
      formattedCost: (prepared as PreparedTransfer).formattedCost ?? '0',
      preparedAt: prepared.preparedAt ?? Date.now(),
      expiresAt: prepared.expiresAt,
    };

    // Determine action type from payload
    const actionType = this.detectActionType(normalized.actionPayload);

    switch (actionType) {
      case ACTION_TRANSFER:
        return this.parseTransfer(normalized, effectiveVaultAddress, effectiveChainId);
      case ACTION_BRIDGE:
        return this.parseBridgeFromPrepared(normalized, effectiveVaultAddress, effectiveChainId);
      case ACTION_EXECUTE:
        return this.parseExecuteFromPayload(
          normalized.actionPayload,
          normalized.nonce,
          normalized.challenge,
          effectiveVaultAddress,
          effectiveChainId,
          normalized.expiresAt,
          normalized.formattedCost
        );
      case ACTION_CONFIG:
        return this.parseConfigFromPayload(
          normalized.actionPayload,
          normalized.nonce,
          normalized.challenge,
          effectiveVaultAddress,
          effectiveChainId,
          normalized.expiresAt,
          normalized.formattedCost
        );
      default:
        // Fallback for unknown action types
        return this.createUnknownActionSummary(normalized, effectiveVaultAddress, effectiveChainId);
    }
  }

  /**
   * Detect action type from payload
   */
  private detectActionType(payload: string): number {
    if (!payload || payload.length < 4) return 0;
    // Action type is typically first byte after 0x
    const typeHex = payload.slice(2, 4);
    return parseInt(typeHex, 16);
  }

  /**
   * Parse bridge action from PreparedTransfer
   */
  private async parseBridgeFromPrepared(
    prepared: PreparedTransfer,
    vaultAddress: string,
    vaultChainId: number
  ): Promise<TransactionSummary> {
    const { params, actionPayload, nonce, challenge, expiresAt, formattedCost } = prepared;
    const decoded = decodeBridgeAction(actionPayload);

    const token = await this.resolveToken(decoded.token, decoded.amount);
    const sourceChain = getChainDisplay(vaultChainId);
    const destinationChain = getChainDisplay(params.targetChain);
    const recipient = await this.resolveRecipient(decoded.recipient);

    const details: BridgeDetails = {
      token,
      sourceChain,
      destinationChain,
      recipient,
      estimatedTime: this.estimateBridgeTime(sourceChain.id, destinationChain.id),
    };

    const warnings = await this.assessBridgeRisks({
      sourceChain: vaultChainId,
      destinationChain: params.targetChain,
      token: decoded.token,
      recipient: decoded.recipient,
      amount: decoded.amount,
    }, token, sourceChain, destinationChain);

    return {
      action: 'bridge',
      title: `Bridge ${token.symbol}`,
      description: `Bridge ${token.amount} ${token.symbol} from ${sourceChain.name} to ${destinationChain.name}`,
      details,
      vault: {
        address: vaultAddress,
        truncated: truncateAddress(vaultAddress),
        chain: sourceChain,
      },
      fee: {
        gas: formattedCost,
        paidByRelayer: false,
        total: formattedCost,
      },
      warnings,
      raw: {
        actionType: ACTION_BRIDGE,
        actionPayload,
        nonce,
        challenge: ethers.hexlify(challenge),
        chainId: params.targetChain,
        expiresAt,
        expiresIn: formatTimeRemaining(expiresAt),
      },
      generatedAt: Date.now(),
    };
  }

  /**
   * Parse execute action from payload
   */
  private async parseExecuteFromPayload(
    actionPayload: string,
    nonce: bigint,
    challenge: Uint8Array,
    vaultAddress: string,
    chainId: number,
    expiresAt: number,
    formattedCost: string
  ): Promise<TransactionSummary> {
    // Decode execute action - basic structure
    const target = '0x' + actionPayload.slice(4, 44);
    const value = BigInt('0x' + actionPayload.slice(44, 108));
    const calldata = '0x' + actionPayload.slice(108);

    const targetDisplay = await this.resolveRecipient(target);
    const chain = getChainDisplay(chainId);
    const functionInfo = this.decodeFunctionCall(calldata);

    const details: ExecuteDetails = {
      target: targetDisplay,
      value: await this.resolveToken(ethers.ZeroAddress, value),
      chain,
      functionName: functionInfo?.name,
      decodedArgs: functionInfo?.args,
      calldata,
    };

    const warnings = await this.assessExecuteRisks(target, value, calldata, targetDisplay);

    return {
      action: 'execute',
      title: 'Contract Call',
      description: `Call ${functionInfo?.name ?? 'function'} on ${targetDisplay.ens ?? targetDisplay.truncated}`,
      details,
      vault: {
        address: vaultAddress,
        truncated: truncateAddress(vaultAddress),
        chain,
      },
      fee: {
        gas: formattedCost,
        paidByRelayer: false,
        total: formattedCost,
      },
      warnings,
      raw: {
        actionType: ACTION_EXECUTE,
        actionPayload,
        nonce,
        challenge: ethers.hexlify(challenge),
        chainId,
        expiresAt,
        expiresIn: formatTimeRemaining(expiresAt),
      },
      generatedAt: Date.now(),
    };
  }

  /**
   * Parse config action from payload
   */
  private async parseConfigFromPayload(
    actionPayload: string,
    nonce: bigint,
    challenge: Uint8Array,
    vaultAddress: string,
    chainId: number,
    expiresAt: number,
    formattedCost: string
  ): Promise<TransactionSummary> {
    // Decode config action - basic structure
    const configType = parseInt(actionPayload.slice(2, 4), 16);
    const configData = '0x' + actionPayload.slice(4);

    const chain = getChainDisplay(chainId);
    const configTypeName = getConfigTypeName(configType);

    const details: ConfigDetails = {
      configType,
      configTypeName,
      description: this.describeConfigChange(configType, configData),
      changes: this.parseConfigChanges(configType, configData),
    };

    const warnings: RiskWarning[] = [{
      level: 'high',
      type: 'config_change',
      message: 'This transaction will modify your vault settings',
      details: `Changing: ${configTypeName}`,
    }];

    return {
      action: 'config',
      title: 'Configuration Change',
      description: `Update vault configuration: ${configTypeName}`,
      details,
      vault: {
        address: vaultAddress,
        truncated: truncateAddress(vaultAddress),
        chain,
      },
      fee: {
        gas: formattedCost,
        paidByRelayer: false,
        total: formattedCost,
      },
      warnings,
      raw: {
        actionType: ACTION_CONFIG,
        actionPayload,
        nonce,
        challenge: ethers.hexlify(challenge),
        chainId,
        expiresAt,
        expiresIn: formatTimeRemaining(expiresAt),
      },
      generatedAt: Date.now(),
    };
  }

  /**
   * Create a fallback summary for unknown action types
   */
  private createUnknownActionSummary(
    prepared: PreparedTransfer,
    vaultAddress: string,
    chainId: number
  ): TransactionSummary {
    const chain = getChainDisplay(chainId);

    return {
      action: 'execute',
      title: 'Unknown Action',
      description: 'This transaction contains an unrecognized action type',
      details: null,
      vault: {
        address: vaultAddress,
        truncated: truncateAddress(vaultAddress),
        chain,
      },
      fee: {
        gas: prepared.formattedCost,
        paidByRelayer: false,
        total: prepared.formattedCost,
      },
      warnings: [{
        level: 'critical',
        type: 'unknown_token',
        message: 'Unknown action type - proceed with extreme caution',
        details: `Action type: ${this.detectActionType(prepared.actionPayload)}`,
      }],
      raw: {
        actionType: this.detectActionType(prepared.actionPayload),
        actionPayload: prepared.actionPayload,
        nonce: prepared.nonce,
        challenge: ethers.hexlify(prepared.challenge),
        chainId,
        expiresAt: prepared.expiresAt,
        expiresIn: formatTimeRemaining(prepared.expiresAt),
      },
      generatedAt: Date.now(),
    };
  }

  /**
   * Parse a prepared transfer into a human-readable summary
   */
  async parseTransfer(
    prepared: PreparedTransfer,
    vaultAddress: string,
    vaultChainId: number
  ): Promise<TransactionSummary> {
    const { params, actionPayload, nonce, challenge, expiresAt } = prepared;
    const decoded = decodeTransferAction(actionPayload);

    const token = await this.resolveToken(decoded.token, decoded.amount);
    const recipient = await this.resolveRecipient(decoded.recipient);
    const chain = getChainDisplay(params.targetChain);

    const details: TransferDetails = {
      token,
      recipient,
      chain,
    };

    const warnings = await this.assessTransferRisks(params, token, recipient);

    return {
      action: 'transfer',
      title: `Send ${token.symbol}`,
      description: `Send ${token.amount} ${token.symbol} to ${recipient.ens ?? recipient.truncated}`,
      details,
      vault: {
        address: vaultAddress,
        truncated: truncateAddress(vaultAddress),
        chain: getChainDisplay(vaultChainId),
      },
      fee: {
        gas: prepared.formattedCost,
        paidByRelayer: false, // Will be updated by caller if gasless
        total: prepared.formattedCost,
      },
      warnings,
      raw: {
        actionType: ACTION_TRANSFER,
        actionPayload,
        nonce,
        challenge: ethers.hexlify(challenge),
        chainId: params.targetChain,
        expiresAt,
        expiresIn: formatTimeRemaining(expiresAt),
      },
      generatedAt: Date.now(),
    };
  }

  /**
   * Parse a bridge operation into a human-readable summary
   */
  async parseBridge(
    params: BridgeParams,
    actionPayload: string,
    nonce: bigint,
    challenge: Uint8Array,
    vaultAddress: string,
    vaultChainId: number,
    expiresAt: number,
    formattedCost: string
  ): Promise<TransactionSummary> {
    const decoded = decodeBridgeAction(actionPayload);

    const token = await this.resolveToken(decoded.token, decoded.amount);
    const sourceChain = getChainDisplay(params.sourceChain);
    const destinationChain = getChainDisplay(params.destinationChain);
    const recipient = await this.resolveRecipient(decoded.recipient);

    const details: BridgeDetails = {
      token,
      sourceChain,
      destinationChain,
      recipient,
      estimatedTime: this.estimateBridgeTime(sourceChain.id, destinationChain.id),
    };

    const warnings = await this.assessBridgeRisks(params, token, sourceChain, destinationChain);

    return {
      action: 'bridge',
      title: `Bridge ${token.symbol}`,
      description: `Bridge ${token.amount} ${token.symbol} from ${sourceChain.name} to ${destinationChain.name}`,
      details,
      vault: {
        address: vaultAddress,
        truncated: truncateAddress(vaultAddress),
        chain: getChainDisplay(vaultChainId),
      },
      fee: {
        gas: formattedCost,
        paidByRelayer: false,
        total: formattedCost,
      },
      warnings,
      raw: {
        actionType: ACTION_BRIDGE,
        actionPayload,
        nonce,
        challenge: ethers.hexlify(challenge),
        chainId: params.sourceChain,
        expiresAt,
        expiresIn: formatTimeRemaining(expiresAt),
      },
      generatedAt: Date.now(),
    };
  }

  /**
   * Parse an execute (contract call) operation into a human-readable summary
   */
  async parseExecute(
    target: string,
    value: bigint,
    calldata: string,
    chainId: number,
    nonce: bigint,
    challenge: Uint8Array,
    vaultAddress: string,
    expiresAt: number,
    formattedCost: string
  ): Promise<TransactionSummary> {
    const targetRecipient = await this.resolveRecipient(target);
    const chain = getChainDisplay(chainId);
    const valueToken = await this.resolveToken(ethers.ZeroAddress, value);

    // Try to decode function signature
    const functionInfo = this.decodeFunctionCall(calldata);

    const details: ExecuteDetails = {
      target: targetRecipient,
      value: valueToken,
      chain,
      functionName: functionInfo?.name,
      decodedArgs: functionInfo?.args,
      calldata,
    };

    const warnings = await this.assessExecuteRisks(target, value, calldata, targetRecipient);

    const title = functionInfo?.name
      ? `Call ${functionInfo.name}`
      : 'Contract Interaction';

    return {
      action: 'execute',
      title,
      description: `Execute contract call on ${targetRecipient.ens ?? targetRecipient.truncated}`,
      details,
      vault: {
        address: vaultAddress,
        truncated: truncateAddress(vaultAddress),
        chain,
      },
      fee: {
        gas: formattedCost,
        paidByRelayer: false,
        total: formattedCost,
      },
      warnings,
      raw: {
        actionType: ACTION_EXECUTE,
        actionPayload: calldata,
        nonce,
        challenge: ethers.hexlify(challenge),
        chainId,
        expiresAt,
        expiresIn: formatTimeRemaining(expiresAt),
      },
      generatedAt: Date.now(),
    };
  }

  /**
   * Parse a config change operation
   */
  async parseConfig(
    configType: number,
    configData: string,
    chainId: number,
    nonce: bigint,
    challenge: Uint8Array,
    vaultAddress: string,
    expiresAt: number,
    formattedCost: string
  ): Promise<TransactionSummary> {
    const chain = getChainDisplay(chainId);
    const configTypeName = getConfigTypeName(configType);

    const details: ConfigDetails = {
      configType,
      configTypeName,
      description: this.describeConfigChange(configType, configData),
      changes: this.parseConfigChanges(configType, configData),
    };

    const warnings: RiskWarning[] = [{
      level: 'warning',
      type: 'config_change',
      message: 'This transaction will modify your vault settings',
    }];

    return {
      action: 'config',
      title: configTypeName,
      description: `Update vault configuration: ${configTypeName}`,
      details,
      vault: {
        address: vaultAddress,
        truncated: truncateAddress(vaultAddress),
        chain,
      },
      fee: {
        gas: formattedCost,
        paidByRelayer: false,
        total: formattedCost,
      },
      warnings,
      raw: {
        actionType: ACTION_CONFIG,
        actionPayload: configData,
        nonce,
        challenge: ethers.hexlify(challenge),
        chainId,
        expiresAt,
        expiresIn: formatTimeRemaining(expiresAt),
      },
      generatedAt: Date.now(),
    };
  }

  // ============================================================================
  // Resolution Methods
  // ============================================================================

  /**
   * Resolve token address to display info
   */
  private async resolveToken(address: string, amount: bigint): Promise<TokenDisplay> {
    const normalizedAddress = address.toLowerCase();
    const isNative = isNativeToken(address);

    // Check registry
    let tokenInfo = this.tokenRegistry.get(normalizedAddress);
    if (!tokenInfo && isNative) {
      tokenInfo = this.tokenRegistry.get('native');
    }

    const decimals = tokenInfo?.decimals ?? 18;
    const symbol = tokenInfo?.symbol ?? (isNative ? 'ETH' : 'UNKNOWN');
    const formattedAmount = formatAmount(amount, decimals);

    // Try to get USD value
    let usdValue: string | undefined;
    if (this.config.priceOracle) {
      try {
        const price = await this.config.priceOracle(address);
        if (price !== null) {
          const amountNum = parseFloat(formattedAmount);
          usdValue = `$${(amountNum * price).toFixed(2)}`;
        }
      } catch {
        // Price oracle failed, continue without USD value
      }
    }

    return {
      symbol,
      amount: formattedAmount,
      rawAmount: amount,
      address: isNative ? ethers.ZeroAddress : address,
      decimals,
      usdValue,
      isNative,
    };
  }

  /**
   * Resolve recipient address to display info
   */
  private async resolveRecipient(address: string): Promise<RecipientDisplay> {
    const truncated = truncateAddress(address);
    let ens: string | undefined;
    let isContract: boolean | undefined;
    let isNewRecipient: boolean | undefined;
    let label: string | undefined;

    // Check known recipients
    if (this.config.knownRecipients) {
      label = this.config.knownRecipients.get(address.toLowerCase());
    }

    // Try ENS resolution
    if (this.config.ensResolver) {
      try {
        const resolved = await this.config.ensResolver(address);
        if (resolved) {
          ens = resolved;
        }
      } catch {
        // ENS resolution failed, continue without
      }
    }

    // Check if contract
    if (this.config.contractDetector) {
      try {
        isContract = await this.config.contractDetector(address);
      } catch {
        // Contract detection failed
      }
    }

    // Check transaction history
    if (this.config.transactionHistory) {
      isNewRecipient = !this.config.transactionHistory.has(address.toLowerCase());
    }

    return {
      address,
      ens,
      truncated,
      isContract,
      isNewRecipient,
      label,
    };
  }

  // ============================================================================
  // Risk Assessment Methods
  // ============================================================================

  /**
   * Assess risks for a transfer transaction
   */
  private async assessTransferRisks(
    _params: TransferParams,
    token: TokenDisplay,
    recipient: RecipientDisplay
  ): Promise<RiskWarning[]> {
    const warnings: RiskWarning[] = [];

    // New recipient warning
    if (recipient.isNewRecipient) {
      warnings.push({
        level: 'warning',
        type: 'new_recipient',
        message: "You've never sent to this address before",
        details: 'Double-check the recipient address is correct',
      });
    }

    // Large transaction warning
    if (this.config.averageTransactionValue) {
      const threshold = this.config.averageTransactionValue * 10n; // 10x average
      if (token.rawAmount > threshold) {
        warnings.push({
          level: 'warning',
          type: 'large_transaction',
          message: 'This transaction is larger than your usual activity',
          details: `Amount: ${token.amount} ${token.symbol}`,
        });
      }
    }

    // Contract interaction warning
    if (recipient.isContract) {
      warnings.push({
        level: 'info',
        type: 'contract_interaction',
        message: 'Recipient is a smart contract',
      });
    }

    // Unknown token warning
    const tokenInfo = this.tokenRegistry.get(token.address.toLowerCase());
    if (!tokenInfo?.verified) {
      warnings.push({
        level: 'warning',
        type: 'unknown_token',
        message: 'This token is not in our verified list',
        details: 'Verify the token address is correct',
      });
    }

    return warnings;
  }

  /**
   * Assess risks for a bridge transaction
   */
  private async assessBridgeRisks(
    _params: BridgeParams,
    token: TokenDisplay,
    sourceChain: ChainDisplay,
    destinationChain: ChainDisplay
  ): Promise<RiskWarning[]> {
    const warnings: RiskWarning[] = [];

    // Cross-chain operation info
    warnings.push({
      level: 'info',
      type: 'cross_chain',
      message: `This is a cross-chain transfer from ${sourceChain.name} to ${destinationChain.name}`,
      details: 'Funds will be locked on the source chain and released on the destination',
    });

    // Large transaction warning
    if (this.config.averageTransactionValue) {
      const threshold = this.config.averageTransactionValue * 10n;
      if (token.rawAmount > threshold) {
        warnings.push({
          level: 'warning',
          type: 'large_transaction',
          message: 'This transaction is larger than your usual activity',
        });
      }
    }

    return warnings;
  }

  /**
   * Assess risks for an execute transaction
   */
  private async assessExecuteRisks(
    _target: string,
    value: bigint,
    _calldata: string,
    recipient: RecipientDisplay
  ): Promise<RiskWarning[]> {
    const warnings: RiskWarning[] = [];

    // Contract interaction is inherently risky
    warnings.push({
      level: 'warning',
      type: 'contract_interaction',
      message: 'This transaction calls an external contract',
      details: 'Review the contract and function being called',
    });

    // New recipient warning
    if (recipient.isNewRecipient) {
      warnings.push({
        level: 'warning',
        type: 'new_recipient',
        message: "You've never interacted with this contract before",
      });
    }

    // Value transfer with contract call
    if (value > 0n) {
      warnings.push({
        level: 'info',
        type: 'large_transaction',
        message: `This transaction sends ${formatAmount(value, 18)} ETH along with the contract call`,
      });
    }

    return warnings;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Estimate bridge completion time
   */
  private estimateBridgeTime(_sourceChain: number, _destChain: number): string {
    // Wormhole typically takes 2-15 minutes depending on chains
    // Query-based is faster (~5-7 seconds), VAA-based is slower (~2+ minutes)
    return '~2-5 minutes';
  }

  /**
   * Try to decode a function call from calldata
   */
  private decodeFunctionCall(calldata: string): { name: string; args: Record<string, unknown> } | null {
    if (calldata.length < 10) return null;

    // Common function selectors
    const KNOWN_SELECTORS: Record<string, string> = {
      '0xa9059cbb': 'transfer',
      '0x23b872dd': 'transferFrom',
      '0x095ea7b3': 'approve',
      '0x70a08231': 'balanceOf',
      '0x18160ddd': 'totalSupply',
      '0x313ce567': 'decimals',
      '0x06fdde03': 'name',
      '0x95d89b41': 'symbol',
    };

    const selector = calldata.slice(0, 10).toLowerCase();
    const name = KNOWN_SELECTORS[selector];

    if (name) {
      return { name, args: {} }; // Would need ABI to decode args
    }

    return null;
  }

  /**
   * Describe a config change in human-readable terms
   */
  private describeConfigChange(configType: number, _configData: string): string {
    const name = getConfigTypeName(configType);
    return `This will update your vault's ${name.toLowerCase()}`;
  }

  /**
   * Parse config changes into structured format
   */
  private parseConfigChanges(configType: number, configData: string): Array<{ field: string; newValue: string }> {
    // Basic parsing - would need more context for full implementation
    return [{
      field: getConfigTypeName(configType),
      newValue: configData.length > 66 ? `${configData.slice(0, 66)}...` : configData,
    }];
  }

  /**
   * Update parser configuration
   */
  updateConfig(config: Partial<TransactionParserConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.knownTokens) {
      this.tokenRegistry = config.knownTokens;
    }
  }

  /**
   * Add a known token to the registry
   */
  addKnownToken(address: string, info: TokenInfo): void {
    this.tokenRegistry.set(address.toLowerCase(), info);
  }

  /**
   * Add a known recipient label
   */
  addKnownRecipient(address: string, label: string): void {
    if (!this.config.knownRecipients) {
      this.config.knownRecipients = new Map();
    }
    this.config.knownRecipients.set(address.toLowerCase(), label);
  }
}

// ============================================================================
// Audit Logging Types and Functions
// ============================================================================

/**
 * Audit log entry for transaction summaries
 * Used for security audits and debugging
 */
export interface TransactionAuditEntry {
  /** Unique identifier matching the TransactionSummary.id */
  summaryId: string;
  /** ISO timestamp when summary was generated */
  timestamp: string;
  /** Action type that was parsed */
  actionType: string;
  /** Human-readable title shown to user */
  titleDisplayed: string;
  /** Human-readable description shown to user */
  descriptionDisplayed: string;
  /** Number of risk warnings shown */
  riskWarningCount: number;
  /** Highest risk level in warnings */
  highestRiskLevel: string | null;
  /** Whether technical details were available */
  hasTechnicalDetails: boolean;
  /** Hash of the raw payload for verification */
  payloadHash: string;
  /** Expiration time shown */
  expiresAt: number;
  /** Chain ID of the transaction */
  targetChain: number;
  /** Gas cost formatted as shown to user */
  gasCostDisplayed: string;
}

/**
 * Create an audit log entry from a transaction summary
 * 
 * @param summary - The transaction summary that was displayed
 * @returns Audit entry for logging
 */
export function createAuditEntry(summary: TransactionSummary): TransactionAuditEntry {
  const highestRisk = summary.warnings.reduce<string | null>((acc, r) => {
    const order: Record<string, number> = { critical: 0, high: 1, warning: 2, info: 3 };
    if (acc === null) return r.level;
    if (order[r.level] < order[acc]) {
      return r.level;
    }
    return acc;
  }, null);

  return {
    summaryId: `${summary.generatedAt}-${summary.action}`,
    timestamp: new Date().toISOString(),
    actionType: summary.action,
    titleDisplayed: summary.title,
    descriptionDisplayed: summary.description,
    riskWarningCount: summary.warnings.length,
    highestRiskLevel: highestRisk,
    hasTechnicalDetails: !!summary.raw,
    payloadHash: summary.raw?.actionPayload ? ethers.keccak256(summary.raw.actionPayload) : '',
    expiresAt: summary.raw?.expiresAt ?? 0,
    targetChain: summary.raw?.chainId ?? 0,
    gasCostDisplayed: summary.fee.total,
  };
}

/**
 * Log a transaction summary for audit purposes
 * 
 * @param summary - The transaction summary to log
 * @param logger - Optional custom logger (defaults to console.info)
 */
export function logTransactionSummary(
  summary: TransactionSummary,
  logger: (entry: TransactionAuditEntry) => void = (entry) => {
    // Default: structured console logging
    console.info('[VERIDEX_TX_AUDIT]', JSON.stringify(entry));
  }
): TransactionAuditEntry {
  const entry = createAuditEntry(summary);
  logger(entry);
  return entry;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a transaction parser with optional configuration
 */
export function createTransactionParser(config?: TransactionParserConfig): TransactionParser {
  return new TransactionParser(config);
}
