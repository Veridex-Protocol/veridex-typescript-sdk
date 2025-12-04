/**
 * Veridex Protocol SDK - Wormhole Utilities
 * 
 * Functions for fetching VAAs, parsing messages, and interacting with Wormhole
 * 
 * This module integrates with the official @wormhole-foundation/sdk patterns for
 * better chain abstraction and reliability, while providing Veridex-specific
 * utilities for payload handling and VAA management.
 */

import { ethers } from 'ethers';
import type { VAA, VAASignature, VeridexPayload } from './types.js';
import { WORMHOLE_API } from './constants.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Wormhole Consistency Levels
 * @see https://docs.wormhole.com/wormhole/reference/glossary#consistency-level
 */
export const CONSISTENCY_LEVELS = {
  /** Finalized - Wait for block finality (most secure) */
  FINALIZED: 200,
  /** Instant - No wait for finality (fastest, less secure) */
  INSTANT: 201,
  /** Safe - Standard finality (deprecated, use FINALIZED) */
  SAFE: 200,
} as const;

/**
 * Guardian network configuration
 */
export const GUARDIAN_CONFIG = {
  /** Total number of guardians in mainnet */
  MAINNET_GUARDIAN_COUNT: 19,
  /** Required signatures for mainnet quorum (13/19) */
  MAINNET_QUORUM: 13,
  /** Total number of guardians in testnet */
  TESTNET_GUARDIAN_COUNT: 1,
  /** Required signatures for testnet quorum */
  TESTNET_QUORUM: 1,
} as const;

// ============================================================================
// Types
// ============================================================================

export interface FetchVAAOptions {
  testnet?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
  onRetry?: (attempt: number, maxRetries: number) => void;
}

export interface WaitForSignaturesOptions {
  testnet?: boolean;
  requiredSignatures?: number;
  maxWaitMs?: number;
  checkIntervalMs?: number;
  onProgress?: (currentSignatures: number, required: number) => void;
}

// ============================================================================
// VAA Fetching
// ============================================================================

/**
 * Fetch a VAA from Wormhole guardians by sequence number
 * 
 * @example
 * ```ts
 * const vaa = await fetchVAA(
 *   WORMHOLE_CHAIN_IDS.TESTNET.BASE_SEPOLIA,
 *   '0x000...hubAddress',
 *   97n,
 *   { testnet: true }
 * );
 * ```
 */
export async function fetchVAA(
  emitterChain: number,
  emitterAddress: string,
  sequence: bigint,
  options: FetchVAAOptions = {}
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
 * Fetch VAA by transaction hash using operations API
 * This is more reliable than the transactions API when sequence numbers don't match
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
    maxRetries = 60,
    retryDelayMs = 3000,
    onRetry,
  } = options;

  const apiBase = testnet ? WORMHOLE_API.TESTNET : WORMHOLE_API.MAINNET;
  // Remove 0x prefix if present for the API
  const cleanTxHash = txHash.replace(/^0x/, '');
  const url = `${apiBase}/api/v1/operations?txHash=${cleanTxHash}`;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json() as { 
          operations?: Array<{ 
            vaa?: { raw?: string }; 
            sequence?: string;
          }>;
        };
        if (data.operations && data.operations.length > 0) {
          const operation = data.operations[0];
          if (operation.vaa?.raw) {
            return operation.vaa.raw;
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

/**
 * Fetch VAA by transaction hash using transactions API (fallback)
 */
export async function fetchVAAByTxHashFallback(
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
 * 
 * @example
 * ```ts
 * const vaa = await waitForGuardianSignatures(
 *   WORMHOLE_CHAIN_IDS.TESTNET.BASE_SEPOLIA,
 *   hubEmitter,
 *   97n,
 *   {
 *     testnet: true,
 *     onProgress: (current, required) => console.log(`${current}/${required} signatures`)
 *   }
 * );
 * ```
 */
export async function waitForGuardianSignatures(
  emitterChain: number,
  emitterAddress: string,
  sequence: bigint,
  options: WaitForSignaturesOptions = {}
): Promise<VAA> {
  const {
    testnet = true,
    requiredSignatures = testnet ? GUARDIAN_CONFIG.TESTNET_QUORUM : GUARDIAN_CONFIG.MAINNET_QUORUM,
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

/**
 * Get the Wormhole Token Bridge contract address for a chain
 */
export function getWormholeTokenBridge(wormholeChainId: number, testnet = true): string {
  const testnetBridges: Record<number, string> = {
    10004: '0x86F55A04690fd7815A3D802bD587e83eA888B239', // Base Sepolia
    10005: '0x99737Ec4B815d816c49A385943baf0380e75c0Ac', // Optimism Sepolia
    10003: '0xC7A204bDBFe983FCD8d8E61D02b475D4073fF97e', // Arbitrum Sepolia
  };

  const mainnetBridges: Record<number, string> = {
    2: '0x3ee18B2214AFF97000D974cf647E7C347E8fa585',  // Ethereum
    30: '0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627', // Base
    24: '0x1D68124e65faFC907325e3EDbF8c4d84499DAa8b', // Optimism
    23: '0x0b2402144Bb366A632D14B83F244D2e0e21bD39c', // Arbitrum
    5: '0x5a58505a96D1dbf8dF91cB21B54419FC36e93fdE',  // Polygon
  };

  const bridges = testnet ? testnetBridges : mainnetBridges;
  return bridges[wormholeChainId] ?? '';
}

/**
 * Get the Wormhole Relayer contract address for a chain
 */
export function getWormholeRelayer(wormholeChainId: number, testnet = true): string {
  const testnetRelayers: Record<number, string> = {
    10004: '0x93BAD53DDfB6132b0aC8E37f6029163E63372cEE', // Base Sepolia
    10005: '0x93BAD53DDfB6132b0aC8E37f6029163E63372cEE', // Optimism Sepolia
    10003: '0x7B1bD7a6b4E61c2a123AC6BC2cbfC614437D0470', // Arbitrum Sepolia
  };

  const mainnetRelayers: Record<number, string> = {
    2: '0x27428DD2d3DD32A4D7f7C497eAaa23130d894911',  // Ethereum
    30: '0x706F82e9bb5b0813501714Ab5974216704980e31', // Base
    24: '0x27428DD2d3DD32A4D7f7C497eAaa23130d894911', // Optimism
    23: '0x27428DD2d3DD32A4D7f7C497eAaa23130d894911', // Arbitrum
    5: '0x27428DD2d3DD32A4D7f7C497eAaa23130d894911',  // Polygon
  };

  const relayers = testnet ? testnetRelayers : mainnetRelayers;
  return relayers[wormholeChainId] ?? '';
}

/**
 * Check if a chain supports Wormhole Relayer
 */
export function supportsRelayer(wormholeChainId: number, testnet = true): boolean {
  return getWormholeRelayer(wormholeChainId, testnet) !== '';
}

/**
 * Get chain name from Wormhole chain ID
 */
export function getChainName(wormholeChainId: number): string {
  const names: Record<number, string> = {
    1: 'Solana',
    2: 'Ethereum',
    4: 'BSC',
    5: 'Polygon',
    6: 'Avalanche',
    10: 'Fantom',
    21: 'Sui',
    22: 'Aptos',
    23: 'Arbitrum',
    24: 'Optimism',
    30: 'Base',
    10002: 'Sepolia',
    10003: 'Arbitrum Sepolia',
    10004: 'Base Sepolia',
    10005: 'Optimism Sepolia',
  };
  return names[wormholeChainId] ?? `Chain ${wormholeChainId}`;
}

// ============================================================================
// VAA Validation
// ============================================================================

/**
 * Validate that a VAA has sufficient signatures for the given network
 */
export function hasQuorum(vaa: VAA, testnet = true): boolean {
  const required = testnet ? GUARDIAN_CONFIG.TESTNET_QUORUM : GUARDIAN_CONFIG.MAINNET_QUORUM;
  return vaa.signatures.length >= required;
}

/**
 * Validate VAA emitter matches expected source
 */
export function validateEmitter(
  vaa: VAA,
  expectedChain: number,
  expectedAddress: string
): boolean {
  const normalizedExpected = '0x' + normalizeEmitterAddress(expectedAddress);
  return (
    vaa.emitterChain === expectedChain &&
    vaa.emitterAddress.toLowerCase() === normalizedExpected.toLowerCase()
  );
}

/**
 * Convert an EVM address to bytes32 format (for Wormhole)
 */
export function evmAddressToBytes32(address: string): string {
  const hex = address.replace('0x', '').toLowerCase();
  return '0x' + hex.padStart(64, '0');
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
