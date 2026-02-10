/**
 * Veridex Protocol SDK - Stacks Address Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
    isValidStacksPrincipal,
    isValidStandardPrincipal,
    isValidContractName,
    getNetworkFromAddress,
    getContractPrincipal,
    parseContractPrincipal,
    isContractPrincipal,
    getStacksExplorerTxUrl,
    getStacksExplorerAddressUrl,
    STACKS_MAINNET_PREFIX,
    STACKS_TESTNET_PREFIX,
} from '../../src/chains/stacks/StacksAddressUtils.js';

// ============================================================================
// Constants
// ============================================================================

const VALID_TESTNET_ADDRESS = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM';
const VALID_MAINNET_ADDRESS = 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7';
const VALID_CONTRACT_PRINCIPAL = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.veridex-spoke';

// ============================================================================
// isValidStacksPrincipal Tests
// ============================================================================

describe('isValidStacksPrincipal', () => {
    it('should accept valid testnet standard principal', () => {
        expect(isValidStacksPrincipal(VALID_TESTNET_ADDRESS)).toBe(true);
    });

    it('should accept valid mainnet standard principal', () => {
        expect(isValidStacksPrincipal(VALID_MAINNET_ADDRESS)).toBe(true);
    });

    it('should accept valid contract principal', () => {
        expect(isValidStacksPrincipal(VALID_CONTRACT_PRINCIPAL)).toBe(true);
    });

    it('should reject empty string', () => {
        expect(isValidStacksPrincipal('')).toBe(false);
    });

    it('should reject null/undefined', () => {
        expect(isValidStacksPrincipal(null as unknown as string)).toBe(false);
        expect(isValidStacksPrincipal(undefined as unknown as string)).toBe(false);
    });

    it('should reject addresses with wrong prefix', () => {
        expect(isValidStacksPrincipal('SX1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM')).toBe(false);
    });

    it('should reject addresses with multiple dots', () => {
        expect(isValidStacksPrincipal('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.foo.bar')).toBe(false);
    });

    it('should reject contract principal with invalid contract name', () => {
        expect(isValidStacksPrincipal('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.123invalid')).toBe(false);
    });
});

// ============================================================================
// isValidStandardPrincipal Tests
// ============================================================================

describe('isValidStandardPrincipal', () => {
    it('should accept valid testnet address', () => {
        expect(isValidStandardPrincipal(VALID_TESTNET_ADDRESS)).toBe(true);
    });

    it('should accept valid mainnet address', () => {
        expect(isValidStandardPrincipal(VALID_MAINNET_ADDRESS)).toBe(true);
    });

    it('should reject too-short addresses', () => {
        expect(isValidStandardPrincipal('ST1')).toBe(false);
    });

    it('should reject addresses with invalid characters', () => {
        expect(isValidStandardPrincipal('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZG!')).toBe(false);
    });

    it('should reject empty string', () => {
        expect(isValidStandardPrincipal('')).toBe(false);
    });
});

// ============================================================================
// isValidContractName Tests
// ============================================================================

describe('isValidContractName', () => {
    it('should accept valid contract names', () => {
        expect(isValidContractName('veridex-spoke')).toBe(true);
        expect(isValidContractName('veridex-vault')).toBe(true);
        expect(isValidContractName('my-contract')).toBe(true);
        expect(isValidContractName('token')).toBe(true);
    });

    it('should reject names starting with number', () => {
        expect(isValidContractName('123contract')).toBe(false);
    });

    it('should reject names starting with hyphen', () => {
        expect(isValidContractName('-contract')).toBe(false);
    });

    it('should reject empty string', () => {
        expect(isValidContractName('')).toBe(false);
    });

    it('should reject names with special characters', () => {
        expect(isValidContractName('my_contract')).toBe(false);
        expect(isValidContractName('my.contract')).toBe(false);
        expect(isValidContractName('my contract')).toBe(false);
    });

    it('should reject names longer than 128 chars', () => {
        const longName = 'a'.repeat(129);
        expect(isValidContractName(longName)).toBe(false);
    });

    it('should accept names exactly 128 chars', () => {
        const maxName = 'a'.repeat(128);
        expect(isValidContractName(maxName)).toBe(true);
    });
});

// ============================================================================
// getNetworkFromAddress Tests
// ============================================================================

describe('getNetworkFromAddress', () => {
    it('should return testnet for ST prefix', () => {
        expect(getNetworkFromAddress(VALID_TESTNET_ADDRESS)).toBe('testnet');
    });

    it('should return mainnet for SP prefix', () => {
        expect(getNetworkFromAddress(VALID_MAINNET_ADDRESS)).toBe('mainnet');
    });
});

// ============================================================================
// getContractPrincipal Tests
// ============================================================================

describe('getContractPrincipal', () => {
    it('should build contract principal from address and name', () => {
        const result = getContractPrincipal(VALID_TESTNET_ADDRESS, 'veridex-spoke');
        expect(result).toBe(`${VALID_TESTNET_ADDRESS}.veridex-spoke`);
    });

    it('should throw for invalid deployer address', () => {
        expect(() => getContractPrincipal('invalid', 'contract')).toThrow('Invalid deployer address');
    });

    it('should throw for invalid contract name', () => {
        expect(() => getContractPrincipal(VALID_TESTNET_ADDRESS, '123bad')).toThrow('Invalid contract name');
    });
});

// ============================================================================
// parseContractPrincipal Tests
// ============================================================================

describe('parseContractPrincipal', () => {
    it('should parse contract principal into address and name', () => {
        const result = parseContractPrincipal(VALID_CONTRACT_PRINCIPAL);
        expect(result.address).toBe(VALID_TESTNET_ADDRESS);
        expect(result.contractName).toBe('veridex-spoke');
    });

    it('should throw for standard principal (no dot)', () => {
        expect(() => parseContractPrincipal(VALID_TESTNET_ADDRESS)).toThrow('Not a contract principal');
    });
});

// ============================================================================
// isContractPrincipal Tests
// ============================================================================

describe('isContractPrincipal', () => {
    it('should return true for contract principals', () => {
        expect(isContractPrincipal(VALID_CONTRACT_PRINCIPAL)).toBe(true);
    });

    it('should return false for standard principals', () => {
        expect(isContractPrincipal(VALID_TESTNET_ADDRESS)).toBe(false);
    });
});

// ============================================================================
// Explorer URL Tests
// ============================================================================

describe('getStacksExplorerTxUrl', () => {
    it('should generate testnet tx URL', () => {
        const url = getStacksExplorerTxUrl('0xabc123', 'testnet');
        expect(url).toContain('explorer.hiro.so');
        expect(url).toContain('0xabc123');
        expect(url).toContain('testnet');
    });

    it('should generate mainnet tx URL', () => {
        const url = getStacksExplorerTxUrl('0xabc123', 'mainnet');
        expect(url).toContain('explorer.hiro.so');
        expect(url).toContain('0xabc123');
        expect(url).not.toContain('testnet');
    });

    it('should add 0x prefix if missing', () => {
        const url = getStacksExplorerTxUrl('abc123', 'testnet');
        expect(url).toContain('0xabc123');
    });
});

describe('getStacksExplorerAddressUrl', () => {
    it('should generate address URL', () => {
        const url = getStacksExplorerAddressUrl(VALID_TESTNET_ADDRESS, 'testnet');
        expect(url).toContain('explorer.hiro.so');
        expect(url).toContain(VALID_TESTNET_ADDRESS);
    });
});

// ============================================================================
// Constants Tests
// ============================================================================

describe('Constants', () => {
    it('should have correct prefix values', () => {
        expect(STACKS_MAINNET_PREFIX).toBe('SP');
        expect(STACKS_TESTNET_PREFIX).toBe('ST');
    });
});
