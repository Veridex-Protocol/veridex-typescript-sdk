/**
 * @packageDocumentation
 * @module erc8004
 * @description
 * Low-level ERC-8004 contract utilities shared across SDK layers.
 * 
 * This module provides canonical addresses, ABIs, and helper functions
 * for interacting with ERC-8004 singleton registries on any EVM chain.
 */
export {
  // Addresses
  ERC8004_MAINNET_IDENTITY,
  ERC8004_MAINNET_REPUTATION,
  ERC8004_TESTNET_IDENTITY,
  ERC8004_TESTNET_REPUTATION,
  getERC8004Addresses,
  isERC8004Chain,
  ERC8004_CHAINS,

  // ABIs
  IDENTITY_REGISTRY_READ_ABI,
  REPUTATION_REGISTRY_READ_ABI,
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
} from './contracts';

export type {
  ERC8004AgentRegistration,
  ERC8004MetadataEntry,
  ERC8004FeedbackEntry,
  ERC8004FeedbackSummary,
  ERC8004ValidationStatus,
  UniversalAgentIdentifier,
} from './types';
