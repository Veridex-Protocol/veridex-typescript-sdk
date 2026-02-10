/**
 * Veridex Protocol SDK - Stacks Post-Condition Builder
 *
 * Stacks Post-Conditions are a unique protocol-level safety feature.
 * They enforce spending constraints at the blockchain level, independent
 * of smart contract logic. This provides a third layer of protection:
 *
 * 1. SDK-level spending limits (off-chain, first check)
 * 2. Contract-level spending limits (on-chain, enforced in veridex-spoke sessions)
 * 3. Protocol-level Post-Conditions (Stacks-native, attached by SDK at tx broadcast)
 *
 * Post-conditions are attached to transactions before broadcast and are
 * validated by the Stacks node itself — they cannot be bypassed by contracts.
 */

import { isContractPrincipal, parseContractPrincipal } from './StacksAddressUtils.js';

// ============================================================================
// Types
// ============================================================================

/** Post-condition comparison type */
export type PostConditionComparison =
    | 'eq'    // Exactly equal
    | 'gte'   // Greater than or equal
    | 'lte'   // Less than or equal
    | 'gt'    // Greater than
    | 'lt';   // Less than

/** STX post-condition */
export interface StxPostCondition {
    type: 'stx';
    principal: string;
    comparison: PostConditionComparison;
    amount: bigint;
}

/** Fungible token post-condition */
export interface FtPostCondition {
    type: 'ft';
    principal: string;
    comparison: PostConditionComparison;
    amount: bigint;
    contractAddress: string;
    contractName: string;
    tokenName: string;
}

/** Non-fungible token post-condition */
export interface NftPostCondition {
    type: 'nft';
    principal: string;
    contractAddress: string;
    contractName: string;
    tokenName: string;
    assetId: string;
    owns: boolean;
}

export type PostCondition = StxPostCondition | FtPostCondition | NftPostCondition;

// ============================================================================
// Builder
// ============================================================================

/**
 * Build STX transfer post-conditions for vault withdrawals.
 * Ensures the contract sends exactly the specified amount.
 *
 * @param contractPrincipal - The vault contract principal (e.g., "ST1PQHQKV...veridex-vault")
 * @param amount - Exact amount in microSTX
 * @returns Array of post-conditions to attach to the transaction
 */
export function buildStxWithdrawalPostConditions(
    contractPrincipal: string,
    amount: bigint
): StxPostCondition[] {
    return [
        {
            type: 'stx',
            principal: contractPrincipal,
            comparison: 'eq',
            amount,
        },
    ];
}

/**
 * Build STX deposit post-conditions.
 * Ensures the sender sends exactly the specified amount to the vault.
 *
 * @param senderPrincipal - The depositor's principal address
 * @param amount - Exact amount in microSTX
 * @returns Array of post-conditions
 */
export function buildStxDepositPostConditions(
    senderPrincipal: string,
    amount: bigint
): StxPostCondition[] {
    return [
        {
            type: 'stx',
            principal: senderPrincipal,
            comparison: 'eq',
            amount,
        },
    ];
}

/**
 * Build sBTC transfer post-conditions for vault withdrawals.
 *
 * @param contractPrincipal - The vault contract principal
 * @param amount - Exact amount in satoshis
 * @param sbtcContractAddress - sBTC token contract deployer address
 * @param sbtcContractName - sBTC token contract name (default: 'sbtc-token')
 * @returns Array of post-conditions
 */
export function buildSbtcWithdrawalPostConditions(
    contractPrincipal: string,
    amount: bigint,
    sbtcContractAddress: string = 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
    sbtcContractName: string = 'sbtc-token'
): FtPostCondition[] {
    return [
        {
            type: 'ft',
            principal: contractPrincipal,
            comparison: 'eq',
            amount,
            contractAddress: sbtcContractAddress,
            contractName: sbtcContractName,
            tokenName: 'sbtc-token',
        },
    ];
}

/**
 * Build post-conditions for a session-authorized execute action.
 * Combines STX or sBTC post-conditions based on action type.
 *
 * @param actionType - 1 = STX transfer, 2 = sBTC transfer
 * @param contractPrincipal - The spoke/vault contract principal
 * @param amount - Amount in base units
 * @returns Array of post-conditions
 */
export function buildExecutePostConditions(
    actionType: number,
    contractPrincipal: string,
    amount: bigint
): PostCondition[] {
    switch (actionType) {
        case 1: // ACTION-TRANSFER-STX
            return buildStxWithdrawalPostConditions(contractPrincipal, amount);
        case 2: // ACTION-TRANSFER-SBTC
            return buildSbtcWithdrawalPostConditions(contractPrincipal, amount);
        default:
            return [];
    }
}

/**
 * Validate that a set of post-conditions is present and reasonable.
 * Used to reject transactions that lack post-conditions for asset transfers.
 *
 * @param postConditions - Array of post-conditions to validate
 * @param expectedAmount - Expected transfer amount
 * @returns Validation result with error message if invalid
 */
export function validatePostConditions(
    postConditions: PostCondition[],
    expectedAmount: bigint
): { valid: boolean; error?: string } {
    if (postConditions.length === 0) {
        return {
            valid: false,
            error: 'No post-conditions attached. Asset transfers require post-conditions for safety.',
        };
    }

    // Check that at least one post-condition matches the expected amount
    const hasMatchingAmount = postConditions.some((pc) => {
        if (pc.type === 'stx' || pc.type === 'ft') {
            return pc.amount === expectedAmount && pc.comparison === 'eq';
        }
        return false;
    });

    if (!hasMatchingAmount) {
        return {
            valid: false,
            error: `No post-condition matches expected amount ${expectedAmount}. Ensure exact-match post-conditions are attached.`,
        };
    }

    return { valid: true };
}

/**
 * Get the contract address and name from a principal for post-condition construction.
 * Handles both standard and contract principals.
 *
 * @param principal - Stacks principal (standard or contract)
 * @returns Object with address and optional contractName
 */
export function principalForPostCondition(principal: string): {
    address: string;
    contractName?: string;
} {
    if (isContractPrincipal(principal)) {
        const parsed = parseContractPrincipal(principal);
        return { address: parsed.address, contractName: parsed.contractName };
    }
    return { address: principal };
}
