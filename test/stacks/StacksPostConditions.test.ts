/**
 * Veridex Protocol SDK - Stacks Post-Conditions Tests
 */

import { describe, it, expect } from 'vitest';
import {
    buildStxWithdrawalPostConditions,
    buildStxDepositPostConditions,
    buildSbtcWithdrawalPostConditions,
    buildExecutePostConditions,
    validatePostConditions,
    principalForPostCondition,
} from '../../src/chains/stacks/StacksPostConditions.js';

// ============================================================================
// Test Data
// ============================================================================

const VAULT_CONTRACT = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.veridex-vault';
const SENDER_ADDRESS = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM';

// ============================================================================
// STX Withdrawal Post-Conditions
// ============================================================================

describe('buildStxWithdrawalPostConditions', () => {
    it('should create a single STX post-condition', () => {
        const pcs = buildStxWithdrawalPostConditions(VAULT_CONTRACT, 1000000n);
        expect(pcs).toHaveLength(1);
    });

    it('should set type to stx', () => {
        const pcs = buildStxWithdrawalPostConditions(VAULT_CONTRACT, 1000000n);
        expect(pcs[0]!.type).toBe('stx');
    });

    it('should set comparison to eq (exact match)', () => {
        const pcs = buildStxWithdrawalPostConditions(VAULT_CONTRACT, 1000000n);
        expect(pcs[0]!.comparison).toBe('eq');
    });

    it('should set correct amount', () => {
        const amount = 5000000n;
        const pcs = buildStxWithdrawalPostConditions(VAULT_CONTRACT, amount);
        expect(pcs[0]!.amount).toBe(amount);
    });

    it('should set correct principal', () => {
        const pcs = buildStxWithdrawalPostConditions(VAULT_CONTRACT, 1000000n);
        expect(pcs[0]!.principal).toBe(VAULT_CONTRACT);
    });
});

// ============================================================================
// STX Deposit Post-Conditions
// ============================================================================

describe('buildStxDepositPostConditions', () => {
    it('should create a single STX post-condition for sender', () => {
        const pcs = buildStxDepositPostConditions(SENDER_ADDRESS, 500000n);
        expect(pcs).toHaveLength(1);
        expect(pcs[0]!.principal).toBe(SENDER_ADDRESS);
        expect(pcs[0]!.amount).toBe(500000n);
        expect(pcs[0]!.comparison).toBe('eq');
    });
});

// ============================================================================
// sBTC Withdrawal Post-Conditions
// ============================================================================

describe('buildSbtcWithdrawalPostConditions', () => {
    it('should create a single FT post-condition', () => {
        const pcs = buildSbtcWithdrawalPostConditions(VAULT_CONTRACT, 100000n);
        expect(pcs).toHaveLength(1);
        expect(pcs[0]!.type).toBe('ft');
    });

    it('should set correct token info', () => {
        const pcs = buildSbtcWithdrawalPostConditions(VAULT_CONTRACT, 100000n);
        expect(pcs[0]!.tokenName).toBe('sbtc-token');
        expect(pcs[0]!.contractName).toBe('sbtc-token');
    });

    it('should use default sBTC contract address', () => {
        const pcs = buildSbtcWithdrawalPostConditions(VAULT_CONTRACT, 100000n);
        expect(pcs[0]!.contractAddress).toBe('SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4');
    });

    it('should accept custom sBTC contract address', () => {
        const customAddr = 'ST1CUSTOM';
        const pcs = buildSbtcWithdrawalPostConditions(VAULT_CONTRACT, 100000n, customAddr, 'custom-sbtc');
        expect(pcs[0]!.contractAddress).toBe(customAddr);
        expect(pcs[0]!.contractName).toBe('custom-sbtc');
    });
});

// ============================================================================
// Execute Post-Conditions
// ============================================================================

describe('buildExecutePostConditions', () => {
    it('should build STX post-conditions for action type 1', () => {
        const pcs = buildExecutePostConditions(1, VAULT_CONTRACT, 1000000n);
        expect(pcs).toHaveLength(1);
        expect(pcs[0]!.type).toBe('stx');
    });

    it('should build sBTC post-conditions for action type 2', () => {
        const pcs = buildExecutePostConditions(2, VAULT_CONTRACT, 100000n);
        expect(pcs).toHaveLength(1);
        expect(pcs[0]!.type).toBe('ft');
    });

    it('should return empty array for unknown action type', () => {
        const pcs = buildExecutePostConditions(99, VAULT_CONTRACT, 1000000n);
        expect(pcs).toHaveLength(0);
    });
});

// ============================================================================
// Validate Post-Conditions
// ============================================================================

describe('validatePostConditions', () => {
    it('should fail validation with empty post-conditions', () => {
        const result = validatePostConditions([], 1000000n);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('No post-conditions');
    });

    it('should pass validation with matching amount', () => {
        const pcs = buildStxWithdrawalPostConditions(VAULT_CONTRACT, 1000000n);
        const result = validatePostConditions(pcs, 1000000n);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
    });

    it('should fail validation with mismatched amount', () => {
        const pcs = buildStxWithdrawalPostConditions(VAULT_CONTRACT, 1000000n);
        const result = validatePostConditions(pcs, 2000000n);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('No post-condition matches');
    });
});

// ============================================================================
// Principal Parsing for Post-Conditions
// ============================================================================

describe('principalForPostCondition', () => {
    it('should parse contract principal', () => {
        const result = principalForPostCondition(VAULT_CONTRACT);
        expect(result.address).toBe('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
        expect(result.contractName).toBe('veridex-vault');
    });

    it('should handle standard principal', () => {
        const result = principalForPostCondition(SENDER_ADDRESS);
        expect(result.address).toBe(SENDER_ADDRESS);
        expect(result.contractName).toBeUndefined();
    });
});
