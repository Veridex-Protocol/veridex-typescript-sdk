/**
 * Veridex Protocol SDK - Utility Functions
 */

import { ethers } from 'ethers';
import type { ChainConfig } from './types.js';
import { TESTNET_CHAINS, MAINNET_CHAINS } from './constants.js';

// ============================================================================
// Base64URL Encoding/Decoding (WebAuthn compatible)
// ============================================================================

/**
 * Base64URL encode a buffer
 */
export function base64URLEncode(buffer: Uint8Array): string {
  // Convert Uint8Array to base64 using browser APIs
  const bytes = Array.from(buffer);
  const binary = String.fromCharCode(...bytes);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64URL decode a string
 */
export function base64URLDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  // Use browser's atob for base64 decoding
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================================
// Signature Utilities
// ============================================================================

/**
 * Parse DER-encoded ECDSA signature to r and s values
 */
export function parseDERSignature(signature: Uint8Array): { r: Uint8Array; s: Uint8Array } {
  let offset = 0;

  if (signature[offset++] !== 0x30) {
    throw new Error('Invalid signature format');
  }

  // Skip total length
  offset++;

  if (signature[offset++] !== 0x02) {
    throw new Error('Invalid signature format');
  }

  const rLength = signature[offset++];
  if (rLength === undefined) {
    throw new Error('Invalid signature format: missing r length');
  }
  let r = signature.slice(offset, offset + rLength);
  offset += rLength;

  // Remove leading zero if present (for positive number representation)
  if (r[0] === 0x00 && r.length > 32) {
    r = r.slice(1);
  }
  // Pad to 32 bytes if needed
  if (r.length < 32) {
    const padded = new Uint8Array(32);
    padded.set(r, 32 - r.length);
    r = padded;
  }

  if (signature[offset++] !== 0x02) {
    throw new Error('Invalid signature format');
  }

  const sLength = signature[offset++];
  if (sLength === undefined) {
    throw new Error('Invalid signature format: missing s length');
  }
  let s = signature.slice(offset, offset + sLength);

  // Remove leading zero if present
  if (s[0] === 0x00 && s.length > 32) {
    s = s.slice(1);
  }
  // Pad to 32 bytes if needed
  if (s.length < 32) {
    const padded = new Uint8Array(32);
    padded.set(s, 32 - s.length);
    s = padded;
  }

  return { r, s };
}

/**
 * Encode signature for Solidity verification
 */
export function encodeSignatureForSolidity(r: bigint, s: bigint): string {
  return ethers.solidityPacked(['uint256', 'uint256'], [r, s]);
}

// ============================================================================
// Key Hash Utilities
// ============================================================================

/**
 * Compute key hash from public key coordinates
 */
export function computeKeyHash(publicKeyX: bigint, publicKeyY: bigint): string {
  return ethers.keccak256(
    ethers.solidityPacked(['uint256', 'uint256'], [publicKeyX, publicKeyY])
  );
}

// ============================================================================
// Chain Utilities
// ============================================================================

/**
 * Get chain config by name
 */
export function getChainConfig(chainName: string, testnet = true): ChainConfig | undefined {
  const chains = testnet ? TESTNET_CHAINS : MAINNET_CHAINS;
  return chains[chainName];
}

/**
 * Get chain config by Wormhole chain ID
 */
export function getChainByWormholeId(wormholeChainId: number, testnet = true): ChainConfig | undefined {
  const chains = testnet ? TESTNET_CHAINS : MAINNET_CHAINS;
  return Object.values(chains).find(chain => chain.wormholeChainId === wormholeChainId);
}

/**
 * Get chain config by EVM chain ID
 */
export function getChainByEvmId(evmChainId: number, testnet = true): ChainConfig | undefined {
  const chains = testnet ? TESTNET_CHAINS : MAINNET_CHAINS;
  return Object.values(chains).find(chain => chain.chainId === evmChainId);
}

/**
 * Check if a chain is EVM-compatible
 */
export function isEvmChain(wormholeChainId: number): boolean {
  // Non-EVM chains
  const nonEvmChains = new Set([1, 8, 15, 21, 22]); // Solana, Algorand, NEAR, Sui, Aptos
  return !nonEvmChains.has(wormholeChainId);
}

/**
 * Get all supported chains
 */
export function getSupportedChains(testnet = true): ChainConfig[] {
  const chains = testnet ? TESTNET_CHAINS : MAINNET_CHAINS;
  return Object.values(chains);
}

// ============================================================================
// Explorer URL Utilities
// ============================================================================

/**
 * Get transaction explorer URL
 */
export function getTxExplorerUrl(chain: ChainConfig, txHash: string): string {
  if (chain.isEvm) {
    return `${chain.explorerUrl}/tx/${txHash}`;
  }

  // Non-EVM chains have different URL patterns
  switch (chain.wormholeChainId) {
    case 1: // Solana
      return `${chain.explorerUrl}/tx/${txHash}?cluster=devnet`;
    case 21: // Sui
      return `${chain.explorerUrl}/tx/${txHash}`;
    case 22: // Aptos
      return `${chain.explorerUrl}/txn/${txHash}?network=testnet`;
    default:
      return `${chain.explorerUrl}/tx/${txHash}`;
  }
}

/**
 * Get address explorer URL
 */
export function getAddressExplorerUrl(chain: ChainConfig, address: string): string {
  if (chain.isEvm) {
    return `${chain.explorerUrl}/address/${address}`;
  }

  switch (chain.wormholeChainId) {
    case 1: // Solana
      return `${chain.explorerUrl}/address/${address}?cluster=devnet`;
    case 21: // Sui
      return `${chain.explorerUrl}/account/${address}`;
    case 22: // Aptos
      return `${chain.explorerUrl}/account/${address}?network=testnet`;
    default:
      return `${chain.explorerUrl}/address/${address}`;
  }
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate an EVM address
 */
export function isValidEvmAddress(address: string): boolean {
  return ethers.isAddress(address);
}

/**
 * Validate a bytes32 hex string
 */
export function isValidBytes32(hex: string): boolean {
  const clean = hex.replace('0x', '');
  return /^[0-9a-fA-F]{64}$/.test(clean);
}

/**
 * Validate a Wormhole chain ID
 */
export function isValidWormholeChainId(chainId: number): boolean {
  // Valid Wormhole chain IDs range from 1 to ~10007 (testnets)
  return chainId >= 1 && chainId <= 50000;
}

// ============================================================================
// Retry Utilities
// ============================================================================

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 5,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    onRetry,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        onRetry?.(attempt, lastError);
        await sleep(delay);
        delay = Math.min(delay * backoffMultiplier, maxDelayMs);
      }
    }
  }

  throw lastError ?? new Error('Retry failed');
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
