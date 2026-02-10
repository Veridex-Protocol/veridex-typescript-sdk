/**
 * Veridex Protocol SDK - Stacks Chain Module
 */

export { StacksClient, STACKS_ACTION_TYPES } from './StacksClient.js';
export type { StacksClientConfig } from './StacksClient.js';

export {
    compressPublicKey,
    rsToCompactSignature,
    derToCompactSignature,
    parseDERSignature,
    computeKeyHash,
    computeKeyHashFromCoords,
    buildRegistrationHash,
    buildSessionRegistrationHash,
    buildRevocationHash,
    buildExecuteHash,
    buildWithdrawalHash,
    bytesToHex,
    hexToBytes,
} from './StacksSigner.js';

export {
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
} from './StacksAddressUtils.js';

export {
    buildStxWithdrawalPostConditions,
    buildStxDepositPostConditions,
    buildSbtcWithdrawalPostConditions,
    buildExecutePostConditions,
    validatePostConditions,
    principalForPostCondition,
} from './StacksPostConditions.js';
export type {
    PostConditionComparison,
    StxPostCondition,
    FtPostCondition,
    NftPostCondition,
    PostCondition,
} from './StacksPostConditions.js';
