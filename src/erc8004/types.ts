/**
 * @packageDocumentation
 * @module erc8004/types
 * @description
 * On-chain types for ERC-8004 registries.
 * These are the low-level types that map directly to contract return values.
 * 
 * Higher-level SDK config types live in `@veridex/agent-sdk/identity/types`.
 */

/** Agent registration as stored on-chain in the ERC-8004 Identity Registry */
export interface ERC8004AgentRegistration {
  agentId: bigint;
  owner: string;
  agentURI: string;
  agentWallet: string;
}

/** Key-value metadata entry */
export interface ERC8004MetadataEntry {
  key: string;
  value: string;
}

/** Individual feedback entry from the Reputation Registry */
export interface ERC8004FeedbackEntry {
  value: bigint;          // int128
  valueDecimals: number;  // uint8
  tag1: string;
  tag2: string;
  isRevoked: boolean;
}

/** Aggregated feedback summary from the Reputation Registry */
export interface ERC8004FeedbackSummary {
  count: bigint;
  summaryValue: bigint;
  summaryValueDecimals: number;
}

/** Validation status from the Validation Registry */
export interface ERC8004ValidationStatus {
  validatorAddress: string;
  agentId: bigint;
  response: number;
  responseHash: string;
  tag: string;
  lastUpdate: bigint;
}

/** CAIP-2 universal agent identifier format */
export type UniversalAgentIdentifier = string;
