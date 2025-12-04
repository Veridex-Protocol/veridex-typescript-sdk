/**
 * Veridex Protocol SDK - Wormhole Utilities
 * 
 * Functions for fetching VAAs, parsing messages, and interacting with Wormhole
 */

import { ethers } from 'ethers';
import type { VAA, VAASignature, VeridexPayload } from './types.js';
import { WORMHOLE_API } from './constants.js';

// ============================================================================
// VAA Fetching
// ============================================================================

/**
 * Fetch a VAA from Wormhole guardians by sequence number
 */
export async function fetchVAA(
  emitterChain: number,
  emitterAddress: string,
  sequence: bigint,
  options: {
    testnet?: boolean;
    maxRetries?: number;
    retryDelayMs?: number;
    onRetry?: (attempt: number, maxRetries: number) => void;
  } = {}
): Promise<string> {
  const {
    testnet = true,
    maxRetries = 30,
    retryDelayMs = 2000,
    onRetry,
  } = options;

  const apiBase = testnet ? WORMHOLE_API.TESTNET : WORMHOLE_API.MAINNET;
  const normalizedEmitter = normalizeEmitterAddress(emitterAddress);
  const url = `${apiBase}/api/v1/vaas/${emitterChain}/${normalizedEmitter}/${sequence.toString()}`;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json() as { data?: { vaa?: string } };
        if (data.data?.vaa) {
          return data.data.vaa;
        }
      }

      if (i < maxRetries - 1) {
        onRetry?.(i + 1, maxRetries);
        await sleep(retryDelayMs);
      }
    } catch {
      if (i < maxRetries - 1) {
        onRetry?.(i + 1, maxRetries);
        await sleep(retryDelayMs);
      }
    }
  }

  throw new Error(`Failed to fetch VAA after ${maxRetries} attempts`);
}

/**
 * Fetch VAA by transaction hash
 */
export async function fetchVAAByTxHash(
  txHash: string,
  options: {
    testnet?: boolean;
    maxRetries?: number;
    retryDelayMs?: number;
    onRetry?: (attempt: number, maxRetries: number) => void;
  } = {}
): Promise<string> {
  const {
    testnet = true,
    maxRetries = 30,
    retryDelayMs = 2000,
    onRetry,
  } = options;

  const apiBase = testnet ? WORMHOLE_API.TESTNET : WORMHOLE_API.MAINNET;
  const url = `${apiBase}/api/v1/transactions/${txHash}`;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json() as { data?: { globalTx?: { originTx?: { vaaId?: string } } } };
        if (data.data?.globalTx?.originTx?.vaaId) {
          const vaaId = data.data.globalTx.originTx.vaaId;
          const vaaUrl = `${apiBase}/api/v1/vaas/${vaaId}`;
          const vaaResponse = await fetch(vaaUrl);

          if (vaaResponse.ok) {
            const vaaData = await vaaResponse.json() as { data?: { vaa?: string } };
            if (vaaData.data?.vaa) {
              return vaaData.data.vaa;
            }
          }
        }
      }

      if (i < maxRetries - 1) {
        onRetry?.(i + 1, maxRetries);
        await sleep(retryDelayMs);
      }
    } catch {
      if (i < maxRetries - 1) {
        onRetry?.(i + 1, maxRetries);
        await sleep(retryDelayMs);
      }
    }
  }

  throw new Error(`Failed to fetch VAA after ${maxRetries} attempts`);
}

// ============================================================================
// VAA Parsing
// ============================================================================

/**
 * Parse a base64-encoded VAA into its components
 */
export function parseVAA(vaaBase64: string): VAA {
  const vaaBytes = Buffer.from(vaaBase64, 'base64');
  return parseVAABytes(vaaBytes);
}

/**
 * Parse raw VAA bytes into its components
 */
export function parseVAABytes(vaaBytes: Buffer): VAA {
  let offset = 0;

  // Version (1 byte)
  const version = vaaBytes.readUInt8(offset);
  offset += 1;

  // Guardian set index (4 bytes)
  const guardianSetIndex = vaaBytes.readUInt32BE(offset);
  offset += 4;

  // Number of signatures (1 byte)
  const numSignatures = vaaBytes.readUInt8(offset);
  offset += 1;

  // Parse signatures (66 bytes each: 1 guardian index + 65 signature)
  const signatures: VAASignature[] = [];
  for (let i = 0; i < numSignatures; i++) {
    const guardianIndex = vaaBytes.readUInt8(offset);
    offset += 1;
    const signature = '0x' + vaaBytes.subarray(offset, offset + 65).toString('hex');
    offset += 65;
    signatures.push({ guardianIndex, signature });
  }

  // Mark the start of the body (for hash calculation)
  const bodyOffset = offset;

  // Timestamp (4 bytes)
  const timestamp = vaaBytes.readUInt32BE(offset);
  offset += 4;

  // Nonce (4 bytes)
  const nonce = vaaBytes.readUInt32BE(offset);
  offset += 4;

  // Emitter chain (2 bytes)
  const emitterChain = vaaBytes.readUInt16BE(offset);
  offset += 2;

  // Emitter address (32 bytes)
  const emitterAddress = '0x' + vaaBytes.subarray(offset, offset + 32).toString('hex');
  offset += 32;

  // Sequence (8 bytes)
  const sequence = vaaBytes.readBigUInt64BE(offset);
  offset += 8;

  // Consistency level (1 byte)
  const consistencyLevel = vaaBytes.readUInt8(offset);
  offset += 1;

  // Payload (remaining bytes)
  const payload = '0x' + vaaBytes.subarray(offset).toString('hex');

  // Calculate VAA body hash (used for verification on destination chains)
  const body = vaaBytes.subarray(bodyOffset);
  const hash = ethers.keccak256(ethers.keccak256(body));

  return {
    version,
    guardianSetIndex,
    signatures,
    timestamp,
    nonce,
    emitterChain,
    emitterAddress,
    sequence,
    consistencyLevel,
    payload,
    hash,
  };
}

/**
 * Parse a Veridex-specific payload from a VAA
 */
export function parseVeridexPayload(payloadHex: string): VeridexPayload {
  const payload = Buffer.from(payloadHex.replace('0x', ''), 'hex');
  let offset = 0;

  // Version (1 byte)
  const version = payload.readUInt8(offset);
  offset += 1;

  // User key hash (32 bytes)
  const userKeyHash = '0x' + payload.subarray(offset, offset + 32).toString('hex');
  offset += 32;

  // Target chain (2 bytes)
  const targetChain = payload.readUInt16BE(offset);
  offset += 2;

  // Nonce (32 bytes)
  const nonce = BigInt('0x' + payload.subarray(offset, offset + 32).toString('hex'));
  offset += 32;

  // Public key X (32 bytes)
  const publicKeyX = BigInt('0x' + payload.subarray(offset, offset + 32).toString('hex'));
  offset += 32;

  // Public key Y (32 bytes)
  const publicKeyY = BigInt('0x' + payload.subarray(offset, offset + 32).toString('hex'));
  offset += 32;

  // Action payload (remaining bytes)
  const actionPayload = '0x' + payload.subarray(offset).toString('hex');

  return {
    version,
    userKeyHash,
    targetChain,
    nonce,
    publicKeyX,
    publicKeyY,
    actionPayload,
  };
}

// ============================================================================
// VAA Encoding
// ============================================================================

/**
 * Encode a VAA back to bytes for on-chain submission
 */
export function encodeVAAToBytes(vaaBase64: string): string {
  const vaaBytes = Buffer.from(vaaBase64, 'base64');
  return '0x' + vaaBytes.toString('hex');
}

/**
 * Encode VAA to bytes for Solana (returns Uint8Array)
 */
export function encodeVAAForSolana(vaaBase64: string): Uint8Array {
  return new Uint8Array(Buffer.from(vaaBase64, 'base64'));
}

// ============================================================================
// Address Utilities
// ============================================================================

/**
 * Normalize an address to a 32-byte Wormhole emitter address format
 */
export function normalizeEmitterAddress(address: string): string {
  let hex = address.replace('0x', '');
  while (hex.length < 64) {
    hex = '0' + hex;
  }
  return hex;
}

/**
 * Convert a 32-byte emitter address back to a 20-byte EVM address
 */
export function emitterToEvmAddress(emitterHex: string): string {
  const hex = emitterHex.replace('0x', '');
  return '0x' + hex.slice(-40);
}

// ============================================================================
// Transaction Utilities
// ============================================================================

/**
 * Extract the VAA sequence from a transaction receipt
 */
export async function getSequenceFromTxReceipt(
  provider: ethers.Provider,
  txHash: string,
  wormholeCoreBridge: string
): Promise<bigint> {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error(`Transaction receipt not found: ${txHash}`);
  }

  const LOG_MESSAGE_PUBLISHED_TOPIC = ethers.id(
    'LogMessagePublished(address,uint64,uint32,bytes,uint8)'
  );

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === wormholeCoreBridge.toLowerCase()) {
      if (log.topics[0] === LOG_MESSAGE_PUBLISHED_TOPIC && log.topics[1]) {
        const sequence = BigInt(log.topics[1]);
        return sequence;
      }
    }
  }

  throw new Error('LogMessagePublished event not found in transaction');
}

/**
 * Wait for a Wormhole message to be signed by guardians
 */
export async function waitForGuardianSignatures(
  emitterChain: number,
  emitterAddress: string,
  sequence: bigint,
  options: {
    testnet?: boolean;
    requiredSignatures?: number;
    maxWaitMs?: number;
    checkIntervalMs?: number;
    onProgress?: (currentSignatures: number, required: number) => void;
  } = {}
): Promise<VAA> {
  const {
    testnet = true,
    requiredSignatures = 13,
    maxWaitMs = 120000,
    checkIntervalMs = 5000,
    onProgress,
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const vaaBase64 = await fetchVAA(emitterChain, emitterAddress, sequence, {
        testnet,
        maxRetries: 1,
        retryDelayMs: 0,
      });
      const vaa = parseVAA(vaaBase64);

      onProgress?.(vaa.signatures.length, requiredSignatures);

      if (vaa.signatures.length >= requiredSignatures) {
        return vaa;
      }
    } catch {
      // VAA not available yet, continue waiting
    }

    await sleep(checkIntervalMs);
  }

  throw new Error(`Timeout waiting for guardian signatures after ${maxWaitMs / 1000}s`);
}

// ============================================================================
// Wormhole Core Bridge Addresses
// ============================================================================

/**
 * Get the Wormhole Core Bridge contract address for a chain
 */
export function getWormholeCoreBridge(wormholeChainId: number, testnet = true): string {
  const testnetBridges: Record<number, string> = {
    10004: '0x79A1027a6A159502049F10906D333EC57E95F083', // Base Sepolia
    10005: '0x31377888146f3253211EFEf5c676D41ECe7D58Fe', // Optimism Sepolia
    10003: '0x6b9C8671cdDC8dEab9c719bB87cBd3e782bA6a35', // Arbitrum Sepolia
    1: '3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5',   // Solana Devnet
    22: '0x5bc11445584a763c1fa7ed39081f1b920954da14e04b32440cba863d03e19625', // Aptos Testnet
    21: '0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790', // Sui Testnet
  };

  const mainnetBridges: Record<number, string> = {
    2: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',  // Ethereum
    30: '0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6', // Base
    24: '0xEe91C335eab126dF5fDB3797EA9d6aD93aeC9722', // Optimism
    23: '0xa5f208e072434bC67592E4C49C1B991BA79BCA46', // Arbitrum
    5: '0x7A4B5a56256163F07b2C80A7cA55aBE66c4ec4d7',  // Polygon
    1: 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',  // Solana
    22: '0x5bc11445584a763c1fa7ed39081f1b920954da14e04b32440cba863d03e19625', // Aptos
    21: '0xaeab97f96cf9877fee2883315d459552b2b921edc16d7ceac6eab944dd88919c', // Sui
  };

  const bridges = testnet ? testnetBridges : mainnetBridges;
  return bridges[wormholeChainId] ?? '';
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
