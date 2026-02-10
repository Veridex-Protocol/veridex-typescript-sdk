/**
 * Veridex Protocol SDK - Stacks Client Tests
 *
 * Tests for StacksClient configuration, vault management,
 * and ChainClient interface compliance.
 */

import { describe, it, expect } from 'vitest';
import { StacksClient, STACKS_ACTION_TYPES } from '../../src/chains/stacks/StacksClient.js';

// ============================================================================
// Test Data
// ============================================================================

const SPOKE_CONTRACT = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.veridex-spoke';
const VAULT_CONTRACT = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.veridex-vault';

function createTestClient(overrides: Partial<ConstructorParameters<typeof StacksClient>[0]> = {}): StacksClient {
    return new StacksClient({
        wormholeChainId: 60,
        rpcUrl: 'https://api.testnet.hiro.so',
        spokeContractAddress: SPOKE_CONTRACT,
        network: 'testnet',
        ...overrides,
    });
}

// ============================================================================
// Configuration Tests
// ============================================================================

describe('StacksClient Configuration', () => {
    it('should create client with correct chain config', () => {
        const client = createTestClient();
        const config = client.getConfig();

        expect(config.name).toContain('Stacks');
        expect(config.wormholeChainId).toBe(60);
        expect(config.isEvm).toBe(false);
    });

    it('should set testnet chain ID', () => {
        const client = createTestClient({ network: 'testnet' });
        const config = client.getConfig();
        expect(config.chainId).toBe(2147483648);
    });

    it('should set mainnet chain ID', () => {
        const client = createTestClient({ network: 'mainnet' });
        const config = client.getConfig();
        expect(config.chainId).toBe(1);
    });

    it('should set correct explorer URL for testnet', () => {
        const client = createTestClient({ network: 'testnet' });
        const config = client.getConfig();
        expect(config.explorerUrl).toContain('testnet');
    });

    it('should set correct explorer URL for mainnet', () => {
        const client = createTestClient({ network: 'mainnet' });
        const config = client.getConfig();
        expect(config.explorerUrl).not.toContain('testnet');
    });

    it('should auto-derive vault contract from spoke deployer', () => {
        const client = createTestClient({
            spokeContractAddress: SPOKE_CONTRACT,
            vaultContractAddress: undefined,
        });
        const vaultAddr = client.computeVaultAddress('0xdeadbeef');
        expect(vaultAddr).toBe(VAULT_CONTRACT);
    });

    it('should use custom vault contract when provided', () => {
        const customVault = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.custom-vault';
        const client = createTestClient({
            vaultContractAddress: customVault,
        });
        const vaultAddr = client.computeVaultAddress('0xdeadbeef');
        expect(vaultAddr).toBe(customVault);
    });

    it('should use default Hiro API URL when rpcUrl not provided', () => {
        const client = new StacksClient({
            wormholeChainId: 60,
            rpcUrl: '',
            network: 'testnet',
        });
        const config = client.getConfig();
        // Should fall back to Hiro API
        expect(config.rpcUrl).toBeTruthy();
    });

    it('should store spoke contract in hub field', () => {
        const client = createTestClient();
        const config = client.getConfig();
        expect(config.contracts.hub).toBe(SPOKE_CONTRACT);
    });
});

// ============================================================================
// ChainClient Interface Tests
// ============================================================================

describe('StacksClient ChainClient Interface', () => {
    it('should implement getConfig()', () => {
        const client = createTestClient();
        const config = client.getConfig();
        expect(config).toBeDefined();
        expect(config.name).toBeDefined();
        expect(config.wormholeChainId).toBeDefined();
    });

    it('should implement getMessageFee() returning 0 (Phase 1)', async () => {
        const client = createTestClient();
        const fee = await client.getMessageFee();
        expect(fee).toBe(0n);
    });

    it('should implement buildTransferPayload()', async () => {
        const client = createTestClient();
        // Payload encoder uses chain-agnostic hex format (not Stacks c32 addresses)
        const payload = await client.buildTransferPayload({
            targetChain: 60,
            token: 'native',
            recipient: '0x0000000000000000000000000000000000000001',
            amount: 1000000n,
        });
        expect(payload).toBeDefined();
        expect(typeof payload).toBe('string');
    });

    it('should implement buildExecutePayload()', async () => {
        const client = createTestClient();
        // Payload encoder uses chain-agnostic hex format
        const payload = await client.buildExecutePayload({
            targetChain: 60,
            target: '0x0000000000000000000000000000000000000001',
            value: 0n,
            data: '0x',
        });
        expect(payload).toBeDefined();
    });

    it('should implement buildBridgePayload()', async () => {
        const client = createTestClient();
        const payload = await client.buildBridgePayload({
            sourceChain: 60,
            token: 'native',
            amount: 1000000n,
            destinationChain: 10004,
            recipient: '0x1234567890abcdef1234567890abcdef12345678',
        });
        expect(payload).toBeDefined();
    });

    it('should throw on direct dispatch (Phase 1)', async () => {
        const client = createTestClient();
        await expect(
            client.dispatch(
                { authenticatorData: '', clientDataJSON: '', challengeIndex: 0, typeIndex: 0, r: 0n, s: 0n },
                0n, 0n, 60, '0x', 0n, null
            )
        ).rejects.toThrow('Direct dispatch not supported');
    });

    it('should implement computeVaultAddress()', () => {
        const client = createTestClient();
        const addr = client.computeVaultAddress('0xdeadbeef');
        expect(addr).toBe(VAULT_CONTRACT);
    });

    it('should throw computeVaultAddress when no vault configured', () => {
        const client = new StacksClient({
            wormholeChainId: 60,
            rpcUrl: 'https://api.testnet.hiro.so',
            network: 'testnet',
        });
        expect(() => client.computeVaultAddress('0xdeadbeef')).toThrow('Vault contract not configured');
    });

    it('should implement createVault() throwing with instructions', async () => {
        const client = createTestClient();
        await expect(client.createVault('0xdeadbeef', null)).rejects.toThrow('Passkey signature verification');
    });

    it('should implement estimateVaultCreationGas()', async () => {
        const client = createTestClient();
        const gas = await client.estimateVaultCreationGas('0xdeadbeef');
        expect(gas).toBeGreaterThan(0n);
    });

    it('should return undefined for getFactoryAddress()', () => {
        const client = createTestClient();
        expect(client.getFactoryAddress()).toBeUndefined();
    });

    it('should return undefined for getImplementationAddress()', () => {
        const client = createTestClient();
        expect(client.getImplementationAddress()).toBeUndefined();
    });
});

// ============================================================================
// Session Management Tests
// ============================================================================

describe('StacksClient Session Management', () => {
    it('should throw on registerSession with instructions', async () => {
        const client = createTestClient();
        await expect(
            client.registerSession({
                sessionPublicKey: new Uint8Array(33),
                expiry: 1000,
                maxValue: 1000000n,
                chainScopes: [60],
            })
        ).rejects.toThrow('Passkey signature');
    });

    it('should throw on revokeSession with instructions', async () => {
        const client = createTestClient();
        await expect(
            client.revokeSession({ sessionKeyHash: '0xdeadbeef' })
        ).rejects.toThrow('Passkey signature');
    });

    it('should throw on getUserSessions (maps not iterable)', async () => {
        const client = createTestClient();
        await expect(
            client.getUserSessions('0xdeadbeef')
        ).rejects.toThrow('not supported on Stacks');
    });
});

// ============================================================================
// Constants Tests
// ============================================================================

describe('STACKS_ACTION_TYPES', () => {
    it('should have correct action type values', () => {
        expect(STACKS_ACTION_TYPES.TRANSFER_STX).toBe(1);
        expect(STACKS_ACTION_TYPES.TRANSFER_SBTC).toBe(2);
        expect(STACKS_ACTION_TYPES.CONTRACT_CALL).toBe(3);
    });
});

// ============================================================================
// Factory Integration Tests
// ============================================================================

describe('StacksClient Factory Integration', () => {
    it('should be creatable via factory pattern', async () => {
        // Import factory to verify integration
        const { createSDK, getChainPreset, isChainSupported } = await import('../../src/factory.js');

        expect(isChainSupported('stacks')).toBe(true);

        const preset = getChainPreset('stacks');
        expect(preset.type).toBe('stacks');
        expect(preset.displayName).toBe('Stacks');
        expect(preset.canBeHub).toBe(false);
    });

    it('should have correct Wormhole chain ID in preset', async () => {
        const { getChainConfig } = await import('../../src/factory.js');

        const testnetConfig = getChainConfig('stacks', 'testnet');
        expect(testnetConfig.wormholeChainId).toBe(60);

        const mainnetConfig = getChainConfig('stacks', 'mainnet');
        expect(mainnetConfig.wormholeChainId).toBe(60);
    });

    it('should have correct CAIP-2 chain IDs', async () => {
        const { getChainConfig } = await import('../../src/factory.js');

        const testnetConfig = getChainConfig('stacks', 'testnet');
        expect(testnetConfig.chainId).toBe(2147483648);

        const mainnetConfig = getChainConfig('stacks', 'mainnet');
        expect(mainnetConfig.chainId).toBe(1);
    });

    it('should create SDK instance for stacks', async () => {
        const { createSDK } = await import('../../src/factory.js');
        const { VeridexSDK } = await import('../../src/core/VeridexSDK.js');

        const sdk = createSDK('stacks');
        expect(sdk).toBeInstanceOf(VeridexSDK);
    });
});
