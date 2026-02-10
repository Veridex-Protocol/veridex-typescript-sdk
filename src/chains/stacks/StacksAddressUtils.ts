/**
 * Veridex Protocol SDK - Stacks Address Utilities
 *
 * Validates and manipulates Stacks principal addresses.
 * Stacks uses c32check encoding for addresses.
 *
 * Address formats:
 * - Standard principal: SP/ST + 33 chars (mainnet/testnet)
 * - Contract principal: SP/ST + 33 chars + "." + contract-name
 */

// ============================================================================
// Constants
// ============================================================================

/** Stacks mainnet address prefix */
export const STACKS_MAINNET_PREFIX = 'SP';

/** Stacks testnet address prefix */
export const STACKS_TESTNET_PREFIX = 'ST';

/** c32 character set used by Stacks addresses */
const C32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a Stacks principal address (standard or contract).
 *
 * @param address - Address to validate
 * @returns true if the address is a valid Stacks principal
 */
export function isValidStacksPrincipal(address: string): boolean {
    if (!address || typeof address !== 'string') {
        return false;
    }

    // Check for contract principal (address.contract-name)
    const parts = address.split('.');
    if (parts.length > 2) {
        return false;
    }

    const standardPart = parts[0]!;
    const contractName = parts[1];

    // Validate standard principal part
    if (!isValidStandardPrincipal(standardPart)) {
        return false;
    }

    // Validate contract name if present
    if (contractName !== undefined) {
        if (!isValidContractName(contractName)) {
            return false;
        }
    }

    return true;
}

/**
 * Validate a standard Stacks principal (not contract).
 *
 * @param address - Standard principal address
 * @returns true if valid
 */
export function isValidStandardPrincipal(address: string): boolean {
    if (!address || address.length < 5) {
        return false;
    }

    // Must start with SP (mainnet) or ST (testnet)
    const prefix = address.slice(0, 2);
    if (prefix !== STACKS_MAINNET_PREFIX && prefix !== STACKS_TESTNET_PREFIX) {
        return false;
    }

    // Standard principals are typically 41 characters (SP/ST + 39 c32 chars)
    // but can vary slightly. Check reasonable bounds.
    if (address.length < 38 || address.length > 42) {
        return false;
    }

    // Verify all characters after prefix are valid c32
    const body = address.slice(1).toUpperCase();
    for (const char of body) {
        if (!C32_ALPHABET.includes(char)) {
            return false;
        }
    }

    return true;
}

/**
 * Validate a Clarity contract name.
 * Contract names must be 1-128 chars, alphanumeric + hyphens, starting with alpha.
 *
 * @param name - Contract name to validate
 * @returns true if valid
 */
export function isValidContractName(name: string): boolean {
    if (!name || name.length === 0 || name.length > 128) {
        return false;
    }

    // Must start with a letter
    if (!/^[a-zA-Z]/.test(name)) {
        return false;
    }

    // Only alphanumeric and hyphens
    if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name)) {
        return false;
    }

    return true;
}

// ============================================================================
// Address Utilities
// ============================================================================

/**
 * Get the network type from a Stacks address.
 *
 * @param address - Stacks principal address
 * @returns 'mainnet' or 'testnet'
 */
export function getNetworkFromAddress(address: string): 'mainnet' | 'testnet' {
    const prefix = address.slice(0, 2);
    if (prefix === STACKS_MAINNET_PREFIX) {
        return 'mainnet';
    }
    return 'testnet';
}

/**
 * Build a contract principal from deployer address and contract name.
 *
 * @param deployerAddress - Standard principal of the deployer
 * @param contractName - Name of the contract
 * @returns Contract principal in "address.contract-name" format
 */
export function getContractPrincipal(
    deployerAddress: string,
    contractName: string
): string {
    if (!isValidStandardPrincipal(deployerAddress)) {
        throw new Error(`Invalid deployer address: ${deployerAddress}`);
    }
    if (!isValidContractName(contractName)) {
        throw new Error(`Invalid contract name: ${contractName}`);
    }
    return `${deployerAddress}.${contractName}`;
}

/**
 * Parse a contract principal into deployer address and contract name.
 *
 * @param contractPrincipal - Full contract principal (e.g., "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.veridex-spoke")
 * @returns Object with address and contractName
 */
export function parseContractPrincipal(contractPrincipal: string): {
    address: string;
    contractName: string;
} {
    const dotIndex = contractPrincipal.indexOf('.');
    if (dotIndex === -1) {
        throw new Error(
            `Not a contract principal: ${contractPrincipal}. Expected format: address.contract-name`
        );
    }

    return {
        address: contractPrincipal.slice(0, dotIndex),
        contractName: contractPrincipal.slice(dotIndex + 1),
    };
}

/**
 * Check if an address is a contract principal.
 *
 * @param address - Address to check
 * @returns true if the address contains a contract name
 */
export function isContractPrincipal(address: string): boolean {
    return address.includes('.');
}

/**
 * Get the explorer URL for a Stacks transaction.
 *
 * @param txId - Transaction ID (hex string)
 * @param network - 'mainnet' or 'testnet'
 * @returns Full explorer URL
 */
export function getStacksExplorerTxUrl(
    txId: string,
    network: 'mainnet' | 'testnet' = 'testnet'
): string {
    const cleanTxId = txId.startsWith('0x') ? txId : `0x${txId}`;
    const chainParam = network === 'testnet' ? '&chain=testnet' : '';
    return `https://explorer.hiro.so/txid/${cleanTxId}?${chainParam}`;
}

/**
 * Get the explorer URL for a Stacks address.
 *
 * @param address - Stacks principal address
 * @param network - 'mainnet' or 'testnet'
 * @returns Full explorer URL
 */
export function getStacksExplorerAddressUrl(
    address: string,
    network: 'mainnet' | 'testnet' = 'testnet'
): string {
    const chainParam = network === 'testnet' ? '?chain=testnet' : '';
    return `https://explorer.hiro.so/address/${address}${chainParam}`;
}
