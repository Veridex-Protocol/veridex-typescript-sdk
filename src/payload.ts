/**
 * Veridex Protocol SDK - Payload Encoding/Decoding Utilities
 */

import { ethers } from 'ethers';
import {
  ACTION_TRANSFER,
  ACTION_EXECUTE,
  ACTION_CONFIG,
  ACTION_BRIDGE,
  PROTOCOL_VERSION,
} from './constants.js';
import type { TransferAction, BridgeAction, ExecuteAction, ActionPayload } from './types.js';

// ============================================================================
// Action Encoding
// ============================================================================

/**
 * Encode a transfer action payload
 * Format: [actionType(1)] [token(32)] [recipient(32)] [amount(32)]
 */
export function encodeTransferAction(
  token: string,
  recipient: string,
  amount: bigint
): string {
  const tokenPadded = padTo32Bytes(token);
  const recipientPadded = padTo32Bytes(recipient);
  const amountBytes = ethers.zeroPadValue(ethers.toBeHex(amount), 32);

  return ethers.concat([
    ethers.toBeHex(ACTION_TRANSFER, 1),
    tokenPadded,
    recipientPadded,
    amountBytes,
  ]);
}

/**
 * Encode a bridge action payload
 * Format: [actionType(1)] [token(32)] [amount(32)] [targetChain(2)] [recipient(32)]
 */
export function encodeBridgeAction(
  token: string,
  amount: bigint,
  targetChain: number,
  recipient: string
): string {
  const tokenPadded = padTo32Bytes(token);
  const amountBytes = ethers.zeroPadValue(ethers.toBeHex(amount), 32);
  const targetChainBytes = ethers.toBeHex(targetChain, 2);
  const recipientPadded = padTo32Bytes(recipient);

  return ethers.concat([
    ethers.toBeHex(ACTION_BRIDGE, 1),
    tokenPadded,
    amountBytes,
    targetChainBytes,
    recipientPadded,
  ]);
}

/**
 * Encode an execute action payload (arbitrary contract call)
 * Format: [actionType(1)] [target(32)] [value(32)] [dataLength(2)] [data(variable)]
 */
export function encodeExecuteAction(
  target: string,
  value: bigint,
  data: string
): string {
  const targetPadded = padTo32Bytes(target);
  const valueBytes = ethers.zeroPadValue(ethers.toBeHex(value), 32);
  const dataBytes = ethers.getBytes(data);
  const dataLengthBytes = ethers.toBeHex(dataBytes.length, 2);

  return ethers.concat([
    ethers.toBeHex(ACTION_EXECUTE, 1),
    targetPadded,
    valueBytes,
    dataLengthBytes,
    data,
  ]);
}

/**
 * Encode a config action payload
 * Format: [actionType(1)] [configType(1)] [configData(variable)]
 */
export function encodeConfigAction(configType: number, configData: string): string {
  return ethers.concat([
    ethers.toBeHex(ACTION_CONFIG, 1),
    ethers.toBeHex(configType, 1),
    configData,
  ]);
}

// ============================================================================
// Veridex Payload Encoding
// ============================================================================

/**
 * Encode the full Veridex message payload that gets published via Wormhole
 * Format: [version(1)] [userKeyHash(32)] [targetChain(2)] [nonce(32)] [pubKeyX(32)] [pubKeyY(32)] [actionPayload]
 */
export function encodeVeridexPayload(
  userKeyHash: string,
  targetChain: number,
  nonce: bigint,
  publicKeyX: bigint,
  publicKeyY: bigint,
  actionPayload: string
): string {
  return ethers.concat([
    ethers.toBeHex(PROTOCOL_VERSION, 1),
    userKeyHash,
    ethers.toBeHex(targetChain, 2),
    ethers.zeroPadValue(ethers.toBeHex(nonce), 32),
    ethers.zeroPadValue(ethers.toBeHex(publicKeyX), 32),
    ethers.zeroPadValue(ethers.toBeHex(publicKeyY), 32),
    actionPayload,
  ]);
}

// ============================================================================
// Action Decoding
// ============================================================================

/**
 * Decode an action payload to determine its type and contents
 */
export function decodeActionPayload(payload: string): ActionPayload {
  const data = ethers.getBytes(payload);
  const actionType = data[0];

  switch (actionType) {
    case ACTION_TRANSFER:
      return decodeTransferAction(payload);
    case ACTION_BRIDGE:
      return decodeBridgeAction(payload);
    case ACTION_EXECUTE:
      return decodeExecuteAction(payload);
    default:
      return { type: `unknown_${actionType}`, raw: payload };
  }
}

/**
 * Decode a transfer action payload
 */
export function decodeTransferAction(payload: string): TransferAction {
  const data = ethers.getBytes(payload);

  const tokenBytes = data.slice(1, 33);
  const recipientBytes = data.slice(33, 65);
  const amountBytes = data.slice(65, 97);

  return {
    type: 'transfer',
    token: trimTo20Bytes(ethers.hexlify(tokenBytes)),
    recipient: trimTo20Bytes(ethers.hexlify(recipientBytes)),
    amount: BigInt(ethers.hexlify(amountBytes)),
  };
}

/**
 * Decode a bridge action payload
 */
export function decodeBridgeAction(payload: string): BridgeAction {
  const data = ethers.getBytes(payload);

  const tokenBytes = data.slice(1, 33);
  const amountBytes = data.slice(33, 65);
  const targetChainByte0 = data[65];
  const targetChainByte1 = data[66];
  const recipientBytes = data.slice(67, 99);

  const targetChain = ((targetChainByte0 ?? 0) << 8) | (targetChainByte1 ?? 0);

  return {
    type: 'bridge',
    token: trimTo20Bytes(ethers.hexlify(tokenBytes)),
    amount: BigInt(ethers.hexlify(amountBytes)),
    targetChain,
    recipient: ethers.hexlify(recipientBytes),
  };
}

/**
 * Decode an execute action payload
 */
export function decodeExecuteAction(payload: string): ExecuteAction {
  const data = ethers.getBytes(payload);

  const targetBytes = data.slice(1, 33);
  const valueBytes = data.slice(33, 65);
  const dataLengthByte0 = data[65];
  const dataLengthByte1 = data[66];
  const dataLength = ((dataLengthByte0 ?? 0) << 8) | (dataLengthByte1 ?? 0);
  const callData = data.slice(67, 67 + dataLength);

  return {
    type: 'execute',
    target: trimTo20Bytes(ethers.hexlify(targetBytes)),
    value: BigInt(ethers.hexlify(valueBytes)),
    data: ethers.hexlify(callData),
  };
}

// ============================================================================
// Chain-Specific Encodings
// ============================================================================

/**
 * Encode a Solana-compatible transfer action
 * Solana uses: [actionType(1)] [amount(8 LE)] [recipient(32)]
 */
export function encodeSolanaTransferAction(
  amount: bigint,
  recipient: string
): string {
  const amountBytes = Buffer.alloc(8);
  amountBytes.writeBigUInt64LE(amount);

  const recipientBytes = ethers.getBytes(recipient);

  return ethers.hexlify(
    Buffer.concat([
      Buffer.from([ACTION_TRANSFER]),
      amountBytes,
      Buffer.from(recipientBytes),
    ])
  );
}

/**
 * Encode an Aptos-compatible transfer action
 * Aptos uses: [actionType(1)] [amount(8 LE)] [recipient(32)]
 */
export function encodeAptosTransferAction(
  amount: bigint,
  recipient: string
): string {
  const amountBytes = Buffer.alloc(8);
  amountBytes.writeBigUInt64LE(amount);

  const recipientPadded = padTo32Bytes(recipient);

  return ethers.hexlify(
    Buffer.concat([
      Buffer.from([ACTION_TRANSFER]),
      amountBytes,
      Buffer.from(ethers.getBytes(recipientPadded)),
    ])
  );
}

/**
 * Encode a Sui-compatible transfer action
 * Sui uses: [actionType(1)] [amount(8 LE)] [recipient(32)]
 */
export function encodeSuiTransferAction(
  amount: bigint,
  recipient: string
): string {
  const amountBytes = Buffer.alloc(8);
  amountBytes.writeBigUInt64LE(amount);

  const recipientPadded = padTo32Bytes(recipient);

  return ethers.hexlify(
    Buffer.concat([
      Buffer.from([ACTION_TRANSFER]),
      amountBytes,
      Buffer.from(ethers.getBytes(recipientPadded)),
    ])
  );
}

// ============================================================================
// Address Utilities
// ============================================================================

/**
 * Pad an address to 32 bytes (Wormhole standard)
 */
export function padTo32Bytes(address: string): string {
  // Handle native token - convert to zero address
  if (address.toLowerCase() === 'native') {
    return '0x' + '0'.repeat(64);
  }
  const hex = address.replace('0x', '');
  // Validate that hex only contains valid hex characters
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`Invalid address: ${address}. Expected hex string or 'native'.`);
  }
  return '0x' + hex.padStart(64, '0');
}

/**
 * Trim a 32-byte hex to a 20-byte EVM address
 */
export function trimTo20Bytes(hex32: string): string {
  const clean = hex32.replace('0x', '');
  return '0x' + clean.slice(-40);
}

/**
 * Convert a Solana public key (base58) to bytes32
 * Note: For production, use proper base58 decoding
 */
export function solanaAddressToBytes32(base58Address: string): string {
  if (base58Address.startsWith('0x')) {
    return padTo32Bytes(base58Address);
  }

  // For proper base58 decoding, use @solana/web3.js
  // This is a simplified version for SDK use
  console.warn('Note: Use @solana/web3.js for proper base58 decoding in production');
  return padTo32Bytes('0x' + Buffer.from(base58Address).toString('hex').slice(0, 40));
}

// ============================================================================
// Amount Utilities
// ============================================================================

/**
 * Format an amount with decimals for display
 */
export function formatAmount(amount: bigint, decimals = 18): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;

  if (fraction === 0n) {
    return whole.toString();
  }

  const fractionStr = fraction.toString().padStart(decimals, '0');
  const trimmedFraction = fractionStr.replace(/0+$/, '');

  return `${whole}.${trimmedFraction}`;
}

/**
 * Parse an amount string with decimals to bigint
 */
export function parseAmount(amountStr: string, decimals = 18): bigint {
  const parts = amountStr.split('.');
  const whole = BigInt(parts[0] ?? '0');

  if (parts.length === 1 || !parts[1]) {
    return whole * (10n ** BigInt(decimals));
  }

  const fractionStr = parts[1].slice(0, decimals).padEnd(decimals, '0');
  const fraction = BigInt(fractionStr);

  return whole * (10n ** BigInt(decimals)) + fraction;
}

// ============================================================================
// Nonce Utilities
// ============================================================================

/**
 * Generate a unique nonce for a transaction
 */
export function generateNonce(): bigint {
  const timestamp = BigInt(Date.now());
  const random = BigInt(Math.floor(Math.random() * 1000000));
  return (timestamp << 20n) | random;
}

/**
 * Create a message hash for signing (used in authenticateRawAndDispatch)
 */
export function createMessageHash(
  targetChain: number,
  actionPayload: string,
  nonce: bigint
): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['uint16', 'bytes', 'uint256'],
      [targetChain, actionPayload, nonce]
    )
  );
}

/**
 * Create the challenge bytes for gasless dispatch (matches Hub's authenticateAndDispatch)
 * 
 * The Hub contract passes raw packed bytes to WebAuthn.verify():
 * abi.encodePacked(targetChain, actionPayload, userNonce, hubChainId)
 * 
 * The WebAuthn library then base64url-encodes these bytes to match against clientDataJSON.
 * We do NOT hash here - the challenge is the raw packed bytes.
 * 
 * @param targetChain - Wormhole chain ID of the destination
 * @param actionPayload - The action payload (hex string)
 * @param nonce - User's current nonce
 * @param hubChainId - Wormhole chain ID of the Hub (e.g., 30 for Base)
 * @returns The packed bytes as hex string (NOT hashed)
 */
export function createGaslessMessageHash(
  targetChain: number,
  actionPayload: string,
  nonce: bigint,
  hubChainId: number
): string {
  // Return raw packed bytes - NO sha256 hash
  // The contract passes these bytes directly to WebAuthn.verify()
  return ethers.solidityPacked(
    ['uint16', 'bytes', 'uint256', 'uint16'],
    [targetChain, actionPayload, nonce, hubChainId]
  );
}

/**
 * Build the challenge bytes for WebAuthn signing (gasless flow)
 * Returns raw packed bytes that match what the Hub contract expects
 * 
 * @param targetChain - Wormhole chain ID of the destination
 * @param actionPayload - The action payload (hex string)
 * @param nonce - User's current nonce
 * @param hubChainId - Wormhole chain ID of the Hub
 * @returns Challenge bytes for WebAuthn signing (raw packed, not hashed)
 */
export function buildGaslessChallenge(
  targetChain: number,
  actionPayload: string,
  nonce: bigint,
  hubChainId: number
): Uint8Array {
  const packed = createGaslessMessageHash(targetChain, actionPayload, nonce, hubChainId);
  return ethers.getBytes(packed);
}

/**
 * Build the challenge bytes for WebAuthn signing
 */
export function buildChallenge(
  userKeyHash: string,
  targetChain: number,
  nonce: bigint,
  actionPayload: string
): Uint8Array {
  const encoded = ethers.solidityPacked(
    ['bytes32', 'uint16', 'uint256', 'bytes'],
    [userKeyHash, targetChain, nonce, actionPayload]
  );
  return ethers.getBytes(ethers.keccak256(encoded));
}
