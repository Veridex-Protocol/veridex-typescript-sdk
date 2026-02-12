/**
 * @packageDocumentation
 * @module erc8004/contracts
 * @description
 * Low-level ERC-8004 contract utilities shared across SDK layers.
 * 
 * Provides:
 * - Contract instance creation for Identity, Reputation, and Validation registries
 * - Address resolution by chain and network
 * - ABI references
 * 
 * This module lives in the core SDK (`@veridex/sdk`) so that both the agent-sdk
 * and relayer can share the same contract interaction utilities.
 * 
 * References:
 * - ADR-0029 §SDK Module Structure
 * - ERC8004_IMPLEMENTATION_PLAN.md Phase 1
 */

// ============================================================================
// Canonical Singleton Addresses (CREATE2 deterministic — same on every chain)
// ============================================================================

/** Identity Registry — same address on ALL EVM mainnets */
export const ERC8004_MAINNET_IDENTITY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

/** Reputation Registry — same address on ALL EVM mainnets */
export const ERC8004_MAINNET_REPUTATION = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';

/** Identity Registry — same address on ALL EVM testnets */
export const ERC8004_TESTNET_IDENTITY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';

/** Reputation Registry — same address on ALL EVM testnets */
export const ERC8004_TESTNET_REPUTATION = '0x8004B663056A597Dffe9eCcC1965A193B7388713';

// Validation Registry addresses not yet published (spec still under active update)

/**
 * Resolve canonical ERC-8004 registry addresses for a given network.
 */
export function getERC8004Addresses(testnet: boolean): {
  identityRegistry: string;
  reputationRegistry: string;
} {
  return {
    identityRegistry: testnet ? ERC8004_TESTNET_IDENTITY : ERC8004_MAINNET_IDENTITY,
    reputationRegistry: testnet ? ERC8004_TESTNET_REPUTATION : ERC8004_MAINNET_REPUTATION,
  };
}

/**
 * Check if a chain has ERC-8004 singletons deployed.
 */
export function isERC8004Chain(chainName: string): boolean {
  return (ERC8004_CHAINS.mainnet as readonly string[]).includes(chainName) ||
         (ERC8004_CHAINS.testnet as readonly string[]).includes(chainName);
}

/** Chains where ERC-8004 singletons are deployed */
export const ERC8004_CHAINS = {
  mainnet: [
    'ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'linea', 'megaeth', 'monad',
  ],
  testnet: [
    'ethereum-sepolia', 'base-sepolia', 'polygon-amoy', 'arbitrum-sepolia',
    'optimism-sepolia', 'monad-testnet',
  ],
} as const;

// ============================================================================
// ABIs — Minimal read-only interfaces for cross-package use
// ============================================================================

/** Minimal Identity Registry ABI for read operations */
export const IDENTITY_REGISTRY_READ_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function agentURI(uint256 agentId) view returns (string)',
  'function agentWallet(uint256 agentId) view returns (address)',
  'function getMetadata(uint256 agentId, string key) view returns (string)',
] as const;

/** Minimal Reputation Registry ABI for read operations */
export const REPUTATION_REGISTRY_READ_ABI = [
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint256 count, int128 summaryValue, uint8 summaryValueDecimals)',
  'function readFeedback(uint256 agentId, address clientAddress, uint256 feedbackIndex) view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)',
  'function getClients(uint256 agentId) view returns (address[])',
  'function getLastIndex(uint256 agentId, address clientAddress) view returns (uint256)',
] as const;

/** Full Identity Registry ABI (read + write) */
export const IDENTITY_REGISTRY_ABI = [
  // Registration
  'function register(string agentURI) returns (uint256)',
  'function register(string agentURI, tuple(string key, string value)[] metadata) returns (uint256)',

  // Read — ERC-721 standard
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',

  // Read — ERC-8004 specific
  'function agentURI(uint256 agentId) view returns (string)',
  'function agentWallet(uint256 agentId) view returns (address)',
  'function getMetadata(uint256 agentId, string key) view returns (string)',

  // Write — URI and wallet management
  'function setAgentURI(uint256 agentId, string newURI)',
  'function setAgentWallet(uint256 agentId, address wallet, uint256 deadline, bytes signature)',
  'function unsetAgentWallet(uint256 agentId)',
  'function setMetadata(uint256 agentId, string key, string value)',

  // Events
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event AgentURIUpdated(uint256 indexed agentId, string newURI)',
  'event AgentWalletSet(uint256 indexed agentId, address wallet)',
  'event AgentWalletUnset(uint256 indexed agentId)',
  'event MetadataUpdated(uint256 indexed agentId, string key, string value)',
] as const;

/** Full Reputation Registry ABI (read + write) */
export const REPUTATION_REGISTRY_ABI = [
  // Write
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2)',
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpointURI, string feedbackURI, bytes32 feedbackHash)',
  'function revokeFeedback(uint256 agentId, uint256 feedbackIndex)',
  'function appendResponse(uint256 agentId, address clientAddress, uint256 feedbackIndex, string responseURI, bytes32 responseHash)',

  // Read
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint256 count, int128 summaryValue, uint8 summaryValueDecimals)',
  'function readFeedback(uint256 agentId, address clientAddress, uint256 feedbackIndex) view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)',
  'function getClients(uint256 agentId) view returns (address[])',
  'function getLastIndex(uint256 agentId, address clientAddress) view returns (uint256)',

  // Events
  'event FeedbackGiven(uint256 indexed agentId, address indexed client, int128 value, uint8 valueDecimals)',
  'event FeedbackRevoked(uint256 indexed agentId, address indexed client, uint256 feedbackIndex)',
  'event ResponseAppended(uint256 indexed agentId, address indexed client, uint256 feedbackIndex)',
] as const;

/** Validation Registry ABI (Phase 3 — spec still under active update) */
export const VALIDATION_REGISTRY_ABI = [
  'function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash) returns (bytes32)',
  'function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)',
  'function getSummary(uint256 agentId, address[] validatorAddresses, string tag) view returns (uint256 count, uint256 averageResponse)',
  'function getAgentValidations(uint256 agentId) view returns (bytes32[])',
] as const;
