/**
 * Veridex Protocol SDK - VeridexSDK Unit Tests
 *
 * These tests focus on VeridexSDK orchestration logic (input validation,
 * challenge construction wiring, dispatch sequencing) and avoid network /
 * browser dependencies by mocking the SDK's internal managers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks: payload challenge builders (capture args for assertions)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../src/payload.js', () => {
    let lastBuildChallengeArgs: any[] | null = null;
    let lastBuildGaslessChallengeArgs: any[] | null = null;

    return {
        buildChallenge: (...args: any[]) => {
            lastBuildChallengeArgs = args;
            return new Uint8Array([0x01, 0x02, 0x03]);
        },
        buildGaslessChallenge: (...args: any[]) => {
            lastBuildGaslessChallengeArgs = args;
            return new Uint8Array([0xaa, 0xbb, 0xcc]);
        },
        __getLastBuildChallengeArgs: () => lastBuildChallengeArgs,
        __getLastBuildGaslessChallengeArgs: () => lastBuildGaslessChallengeArgs,
    };
});

// ─────────────────────────────────────────────────────────────────────────────
// Mocks: Core managers (avoid browser/network side effects)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../src/core/PasskeyManager.js', () => {
    let lastInstance: any = null;

    class PasskeyManager {
        private credential: any = null;
        public sign = vi.fn(async (_challenge: Uint8Array) => {
            return {
                authenticatorData: '0x00',
                clientDataJSON: '{"type":"webauthn.get"}',
                challengeIndex: 0,
                typeIndex: 0,
                r: 1n,
                s: 2n,
            };
        });

        constructor(_config: any) {
            lastInstance = this;
        }

        getCredential() {
            return this.credential;
        }

        setCredential(credential: any) {
            this.credential = credential;
        }

        clearCredential() {
            this.credential = null;
        }
    }

    return {
        PasskeyManager,
        __getLastPasskeyManager: () => lastInstance,
    };
});

vi.mock('../src/core/WalletManager.js', () => {
    class WalletManager {
        constructor(_config: any) {}
        loadIdentityFromStorage(_keyHash: string) {
            return null;
        }
    }
    return { WalletManager };
});

vi.mock('../src/core/BalanceManager.js', () => {
    let lastInstance: any = null;
    class BalanceManager {
        public invalidateCache = vi.fn();
        public getNativeBalance = vi.fn();
        public getPortfolioBalance = vi.fn();
        public getBalance = vi.fn();
        constructor(_config: any) {
            lastInstance = this;
        }
    }
    return { BalanceManager, __getLastBalanceManager: () => lastInstance };
});

vi.mock('../src/core/TransactionTracker.js', () => {
    let lastInstance: any = null;
    class TransactionTracker {
        public track = vi.fn();
        public waitForConfirmation = vi.fn();
        constructor(_config: any) {
            lastInstance = this;
        }
    }
    return { TransactionTracker, __getLastTransactionTracker: () => lastInstance };
});

vi.mock('../src/core/CrossChainManager.js', () => {
    let lastInstance: any = null;
    class CrossChainManager {
        public estimateFees = vi.fn();
        public trackTransfer = vi.fn();
        public fetchVAAByTxHash = vi.fn();
        public completeTransfer = vi.fn();
        public getAllPendingTransfers = vi.fn(() => []);
        public getWormholeExplorerUrl = vi.fn(() => 'https://example');
        constructor(_config: any) {
            lastInstance = this;
        }
    }
    return { CrossChainManager, __getLastCrossChainManager: () => lastInstance };
});

vi.mock('../src/core/GasSponsor.js', () => {
    class GasSponsor {
        constructor(_config: any) {}
        isConfigured() {
            return false;
        }
        getSponsorshipSource() {
            return 'none' as const;
        }
        getSupportedChains() {
            return [];
        }
    }
    return { GasSponsor };
});

vi.mock('../src/core/ChainDetector.js', () => {
    class ChainDetector {
        constructor(_config: any) {}
        getChainConfig(_wormholeChainId: number) {
            return null;
        }
        deriveVaultAddress(_credential: any, _wormholeChainId: number) {
            return null;
        }
        createClient(_wormholeChainId: number) {
            return null;
        }
        getNonEvmNativeTokenMeta(_wormholeChainId: number) {
            return null;
        }
    }
    return { ChainDetector };
});

vi.mock('../src/core/RelayerClient.js', () => {
    let lastCtorArgs: any = null;

    class RelayerClient {
        constructor(args: any) {
            lastCtorArgs = args;
        }
        submitSignedAction = vi.fn();
    }

    return { RelayerClient, __getLastRelayerClientArgs: () => lastCtorArgs };
});

// Import after mocks
import { VeridexSDK } from '../src/core/VeridexSDK.js';
import type { ChainClient, ChainConfig } from '../src/core/types.js';
import * as Payload from '../src/payload.js';
import * as PasskeyModule from '../src/core/PasskeyManager.js';
import * as RelayerModule from '../src/core/RelayerClient.js';
import * as CrossChainModule from '../src/core/CrossChainManager.js';
import * as TxModule from '../src/core/TransactionTracker.js';
import * as BalanceModule from '../src/core/BalanceManager.js';

function makeChainConfig(): ChainConfig {
    return {
        name: 'Base Sepolia',
        chainId: 84532,
        wormholeChainId: 30,
        rpcUrl: 'https://sepolia.base.org',
        explorerUrl: 'https://example',
        isEvm: true,
        contracts: {
            hub: '0x66D87dE68327f48A099c5B9bE97020Feab9a7c82',
            wormholeCoreBridge: '0x0000000000000000000000000000000000000001',
        },
    };
}

function makeMockChain(overrides: Partial<ChainClient & { getGasPrice?: () => Promise<bigint> }> = {}) {
    const config = makeChainConfig();

    const chain: any = {
        getConfig: vi.fn(() => config),
        getNonce: vi.fn(async (_keyHash: string) => 7n),
        getMessageFee: vi.fn(async () => 3n),
        buildTransferPayload: vi.fn(async () => '0xtransfer'),
        buildExecutePayload: vi.fn(async () => '0xexecute'),
        buildBridgePayload: vi.fn(async () => '0xbridge'),
        dispatch: vi.fn(async () => {
            return {
                transactionHash: '0xtx',
                sequence: 11n,
                userKeyHash: '0xkeyhash',
                targetChain: 30,
                blockNumber: 123,
            };
        }),
        computeVaultAddress: vi.fn((_keyHash: string) => '0xvault'),
        vaultExists: vi.fn(async (_keyHash: string) => false),
        getVaultAddress: vi.fn(async (_keyHash: string) => '0xvault'),
        estimateVaultCreationGas: vi.fn(async (_keyHash: string) => 0n),
        createVault: vi.fn(async (_keyHash: string, _signer: any) => {
            return {
                address: '0xvault',
                transactionHash: '0xcreate',
                blockNumber: 1,
                gasUsed: 1n,
                alreadyExisted: false,
            };
        }),
        ...overrides,
    };

    return { chain: chain as ChainClient, config };
}

const credential = {
    credentialId: 'cred',
    publicKeyX: 1n,
    publicKeyY: 2n,
    keyHash: '0xkeyhash',
};

describe('VeridexSDK', () => {
    beforeEach(() => {
        // Reset captured args from mocks
        (Payload as any).__getLastBuildChallengeArgs?.();
    });

    it('constructs without relayer by default', () => {
        const { chain } = makeMockChain();
        const sdk = new VeridexSDK({ chain });
        expect(sdk).toBeInstanceOf(VeridexSDK);
        expect((RelayerModule as any).__getLastRelayerClientArgs()).toBe(null);
    });

    it('constructs with relayer client when relayerUrl is provided', () => {
        const { chain } = makeMockChain();
        const sdk = new VeridexSDK({
            chain,
            relayerUrl: 'http://localhost:3001',
            relayerApiKey: 'k',
        });
        expect(sdk).toBeInstanceOf(VeridexSDK);
        expect((RelayerModule as any).__getLastRelayerClientArgs()).toEqual({
            baseUrl: 'http://localhost:3001',
            apiKey: 'k',
        });
    });

    it('getChainClient returns the configured chain', () => {
        const { chain } = makeMockChain();
        const sdk = new VeridexSDK({ chain });
        expect(sdk.getChainClient()).toBe(chain);
    });

    it('getNonce throws when no credential is set', async () => {
        const { chain } = makeMockChain();
        const sdk = new VeridexSDK({ chain });
        await expect(sdk.getNonce()).rejects.toThrow('No credential set');
    });

    it('transfer builds payload, builds challenge, signs, and dispatches', async () => {
        const { chain } = makeMockChain();
        const sdk = new VeridexSDK({ chain });

        const passkey = (PasskeyModule as any).__getLastPasskeyManager();
        passkey.setCredential(credential);

        const signer = { name: 'signer' };
        const result = await sdk.transfer(
            {
                targetChain: 30,
                token: 'native',
                recipient: '0xrecipient',
                amount: 1n,
            },
            signer
        );

        expect(chain.buildTransferPayload).toHaveBeenCalledTimes(1);
        expect(chain.getNonce).toHaveBeenCalledWith('0xkeyhash');

        const lastArgs = (Payload as any).__getLastBuildChallengeArgs();
        expect(lastArgs).toEqual(['0xkeyhash', 30, 7n, '0xtransfer']);

        expect(passkey.sign).toHaveBeenCalledWith(new Uint8Array([0x01, 0x02, 0x03]));
        expect(chain.dispatch).toHaveBeenCalledTimes(1);
        expect(result.transactionHash).toBe('0xtx');
    });

    it('bridge uses sourceChain when building challenge and dispatching', async () => {
        const { chain } = makeMockChain();
        const sdk = new VeridexSDK({ chain });

        const passkey = (PasskeyModule as any).__getLastPasskeyManager();
        passkey.setCredential(credential);

        await sdk.bridge(
            {
                sourceChain: 1,
                token: 'native',
                amount: 1n,
                destinationChain: 30,
                recipient: '0xrecipient',
            },
            { name: 'signer' }
        );

        const lastArgs = (Payload as any).__getLastBuildChallengeArgs();
        expect(lastArgs).toEqual(['0xkeyhash', 1, 7n, '0xbridge']);
        expect(chain.dispatch).toHaveBeenCalledWith(
            expect.any(Object),
            1n,
            2n,
            1,
            '0xbridge',
            7n,
            expect.any(Object)
        );
    });

    it('prepareTransfer returns deterministic cost fields and TTL', async () => {
        const { chain } = makeMockChain({
            getGasPrice: vi.fn(async () => 2n),
        });
        const sdk = new VeridexSDK({ chain });

        const passkey = (PasskeyModule as any).__getLastPasskeyManager();
        passkey.setCredential(credential);

        const prepared = await sdk.prepareTransfer({
            targetChain: 30,
            token: 'native',
            recipient: '0xrecipient',
            amount: 1n,
        });

        expect(prepared.actionPayload).toBe('0xtransfer');
        expect(prepared.nonce).toBe(7n);
        expect(prepared.expiresAt).toBeGreaterThan(prepared.preparedAt);
        expect(prepared.messageFee).toBe(3n);
        expect(prepared.gasPrice).toBe(2n);
    });

    it('getVaultAddress throws when no credential is set', () => {
        const { chain } = makeMockChain();
        const sdk = new VeridexSDK({ chain });
        expect(() => sdk.getVaultAddress()).toThrow('No credential set');
    });

    it('getVaultAddress computes from chain client with credential', () => {
        const { chain } = makeMockChain();
        const sdk = new VeridexSDK({ chain });

        const passkey = (PasskeyModule as any).__getLastPasskeyManager();
        passkey.setCredential(credential);

        expect(sdk.getVaultAddress()).toBe('0xvault');
        expect((chain as any).computeVaultAddress).toHaveBeenCalledWith('0xkeyhash');
    });

    it('executeBridge enforces expiry and tolerates VAA fetch failure', async () => {
        const { chain, config } = makeMockChain();
        const sdk = new VeridexSDK({ chain });

        const passkey = (PasskeyModule as any).__getLastPasskeyManager();
        passkey.setCredential(credential);

        const crossChain = (CrossChainModule as any).__getLastCrossChainManager();
        crossChain.fetchVAAByTxHash.mockRejectedValueOnce(new Error('wormhole down'));

        const tx = (TxModule as any).__getLastTransactionTracker();
        const balance = (BalanceModule as any).__getLastBalanceManager();

        const prepared = await sdk.prepareBridge({
            sourceChain: config.wormholeChainId,
            token: 'native',
            amount: 1n,
            destinationChain: 2,
            recipient: '0xrecipient',
        });

        // Force it to be valid and deterministic
        prepared.expiresAt = Date.now() + 60_000;

        const res = await sdk.executeBridge(prepared, { name: 'signer' });

        expect(res.transactionHash).toBe('0xtx');
        expect(crossChain.trackTransfer).toHaveBeenCalledTimes(1);
        expect(tx.track).toHaveBeenCalledTimes(1);
        expect(balance.invalidateCache).toHaveBeenCalledWith(config.wormholeChainId, '0xvault');
    });
});
