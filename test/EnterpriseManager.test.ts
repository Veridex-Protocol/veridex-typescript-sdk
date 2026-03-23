import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnterpriseManager } from '../src/core/EnterpriseManager.js';
import type { BatchLifecycleEvent } from '../src/core/EnterpriseManager.js';

// ============================================================================
// Mock SDK
// ============================================================================

function makeMockSDK() {
    return {
        sponsor: {
            createVaultsOnAllChains: vi.fn(),
            checkVaultsOnAllChains: vi.fn(),
            getSupportedChains: vi.fn().mockReturnValue([
                { wormholeChainId: 10004, name: 'Base Sepolia' },
                { wormholeChainId: 10005, name: 'Optimism Sepolia' },
            ]),
        },
        balance: {
            getPortfolioBalance: vi.fn(),
        },
        prepareTransfer: vi.fn(),
        executeTransfer: vi.fn(),
        prepareSetDailyLimit: vi.fn(),
        spendingLimits: {
            getSpendingLimits: vi.fn(),
        },
        getChainConfig: vi.fn().mockReturnValue({
            wormholeChainId: 10004,
            rpcUrl: 'https://sepolia.base.org',
        }),
    } as any;
}

describe('EnterpriseManager', () => {
    let sdk: ReturnType<typeof makeMockSDK>;
    let enterprise: EnterpriseManager;

    beforeEach(() => {
        sdk = makeMockSDK();
        enterprise = new EnterpriseManager({ sdk, maxConcurrency: 2 });
    });

    // ========================================================================
    // Construction
    // ========================================================================

    it('constructs with SDK instance', () => {
        expect(enterprise).toBeInstanceOf(EnterpriseManager);
    });

    // ========================================================================
    // getSponsoredChains
    // ========================================================================

    it('delegates getSponsoredChains to sdk.sponsor', () => {
        const chains = enterprise.getSponsoredChains();
        expect(chains).toHaveLength(2);
        expect(sdk.sponsor.getSupportedChains).toHaveBeenCalled();
    });

    // ========================================================================
    // batchCreateVaults
    // ========================================================================

    describe('batchCreateVaults', () => {
        it('creates vaults for all key hashes', async () => {
            sdk.sponsor.createVaultsOnAllChains.mockResolvedValue({
                allSuccessful: true,
                results: {},
            });

            const result = await enterprise.batchCreateVaults({
                keyHashes: ['0xkey1', '0xkey2', '0xkey3'],
            });

            expect(result.total).toBe(3);
            expect(result.succeeded).toBe(3);
            expect(result.failed).toBe(0);
            expect(sdk.sponsor.createVaultsOnAllChains).toHaveBeenCalledTimes(3);
        });

        it('captures individual failures without stopping the batch', async () => {
            sdk.sponsor.createVaultsOnAllChains
                .mockResolvedValueOnce({ allSuccessful: true, results: {} })
                .mockRejectedValueOnce(new Error('sponsorship failed'))
                .mockResolvedValueOnce({ allSuccessful: true, results: {} });

            const result = await enterprise.batchCreateVaults({
                keyHashes: ['0xkey1', '0xkey2', '0xkey3'],
            });

            expect(result.total).toBe(3);
            expect(result.succeeded).toBe(2);
            expect(result.failed).toBe(1);
            expect(result.results[1].error).toBe('sponsorship failed');
        });

        it('respects maxConcurrency', async () => {
            let concurrentCount = 0;
            let maxObservedConcurrency = 0;

            sdk.sponsor.createVaultsOnAllChains.mockImplementation(async () => {
                concurrentCount++;
                maxObservedConcurrency = Math.max(maxObservedConcurrency, concurrentCount);
                await new Promise(r => setTimeout(r, 10));
                concurrentCount--;
                return { allSuccessful: true, results: {} };
            });

            await enterprise.batchCreateVaults({
                keyHashes: ['0xa', '0xb', '0xc', '0xd', '0xe'],
            });

            // Config maxConcurrency = 2
            expect(maxObservedConcurrency).toBeLessThanOrEqual(2);
        });

        it('fires lifecycle callbacks in order', async () => {
            sdk.sponsor.createVaultsOnAllChains.mockResolvedValue({
                allSuccessful: true,
                results: {},
            });

            const events: BatchLifecycleEvent[] = [];
            await enterprise.batchCreateVaults(
                { keyHashes: ['0xkey1', '0xkey2'] },
                (event) => events.push(event),
            );

            expect(events[0]).toEqual({ type: 'started', total: 2 });
            expect(events.filter(e => e.type === 'item_started')).toHaveLength(2);
            expect(events.filter(e => e.type === 'item_completed')).toHaveLength(2);
            expect(events[events.length - 1]).toEqual({
                type: 'completed',
                succeeded: 2,
                failed: 0,
                total: 2,
            });
        });
    });

    // ========================================================================
    // checkVaults
    // ========================================================================

    it('delegates checkVaults to sdk.sponsor', async () => {
        const expected = { 10004: { exists: true, address: '0xv' } };
        sdk.sponsor.checkVaultsOnAllChains.mockResolvedValue(expected);

        const result = await enterprise.checkVaults('0xkey1');
        expect(result).toBe(expected);
    });

    // ========================================================================
    // batchTransfer
    // ========================================================================

    describe('batchTransfer', () => {
        const signer = { name: 'test-signer' };
        const transfers = [
            { targetChain: 10004, token: '0xUSDC', recipient: '0xAlice', amount: 1000000n },
            { targetChain: 10004, token: '0xUSDC', recipient: '0xBob', amount: 2000000n },
        ];

        it('prepares and executes each transfer', async () => {
            const prepared = { actionPayload: '0x...', nonce: 1n };
            const txResult = { transactionHash: '0xtx', params: transfers[0], timestamp: Date.now() };

            sdk.prepareTransfer.mockResolvedValue(prepared);
            sdk.executeTransfer.mockResolvedValue(txResult);

            const result = await enterprise.batchTransfer({ transfers, signer });

            expect(result.total).toBe(2);
            expect(result.succeeded).toBe(2);
            expect(result.failed).toBe(0);
            expect(sdk.prepareTransfer).toHaveBeenCalledTimes(2);
            expect(sdk.executeTransfer).toHaveBeenCalledTimes(2);
        });

        it('captures individual transfer failures', async () => {
            sdk.prepareTransfer
                .mockResolvedValueOnce({ actionPayload: '0x' })
                .mockRejectedValueOnce(new Error('gas estimation failed'));
            sdk.executeTransfer.mockResolvedValue({
                transactionHash: '0xtx',
                params: transfers[0],
                timestamp: Date.now(),
            });

            const result = await enterprise.batchTransfer({ transfers, signer });

            expect(result.succeeded).toBe(1);
            expect(result.failed).toBe(1);
            expect(result.results[1].error).toBe('gas estimation failed');
        });

        it('fires lifecycle callbacks for transfers', async () => {
            sdk.prepareTransfer.mockResolvedValue({ actionPayload: '0x' });
            sdk.executeTransfer.mockResolvedValue({
                transactionHash: '0xtx',
                params: transfers[0],
                timestamp: Date.now(),
            });

            const events: BatchLifecycleEvent[] = [];
            await enterprise.batchTransfer(
                { transfers, signer },
                (event) => events.push(event),
            );

            expect(events[0].type).toBe('started');
            const completed = events[events.length - 1];
            expect(completed.type).toBe('completed');
            if (completed.type === 'completed') {
                expect(completed.succeeded).toBe(2);
            }
        });

        it('respects maxConcurrency override in request', async () => {
            let concurrentCount = 0;
            let maxObserved = 0;

            sdk.prepareTransfer.mockImplementation(async () => {
                concurrentCount++;
                maxObserved = Math.max(maxObserved, concurrentCount);
                await new Promise(r => setTimeout(r, 10));
                concurrentCount--;
                return { actionPayload: '0x' };
            });
            sdk.executeTransfer.mockResolvedValue({
                transactionHash: '0xtx',
                timestamp: Date.now(),
            });

            const manyTransfers = Array.from({ length: 6 }, (_, i) => ({
                targetChain: 10004,
                token: '0xUSDC',
                recipient: `0xUser${i}`,
                amount: BigInt(i + 1) * 1000000n,
            }));

            await enterprise.batchTransfer({
                transfers: manyTransfers,
                signer,
                maxConcurrency: 3,
            });

            expect(maxObserved).toBeLessThanOrEqual(3);
        });
    });

    // ========================================================================
    // batchSetSpendingLimits
    // ========================================================================

    describe('batchSetSpendingLimits', () => {
        const signer = { name: 'test-signer' };

        it('updates limits sequentially', async () => {
            const prepared = { actionPayload: '0x' };
            sdk.prepareSetDailyLimit.mockResolvedValue(prepared);
            sdk.executeTransfer.mockResolvedValue({
                transactionHash: '0xtx',
                timestamp: Date.now(),
            });

            const result = await enterprise.batchSetSpendingLimits({
                updates: [
                    { newLimit: 5000000000000000000n },
                    { newLimit: 10000000000000000000n },
                ],
                signer,
            });

            expect(result.total).toBe(2);
            expect(result.succeeded).toBe(2);
            expect(result.failed).toBe(0);
            expect(sdk.prepareSetDailyLimit).toHaveBeenCalledWith(5000000000000000000n);
            expect(sdk.prepareSetDailyLimit).toHaveBeenCalledWith(10000000000000000000n);
        });

        it('captures limit update failures', async () => {
            sdk.prepareSetDailyLimit
                .mockResolvedValueOnce({ actionPayload: '0x' })
                .mockRejectedValueOnce(new Error('limit too high'));
            sdk.executeTransfer.mockResolvedValue({
                transactionHash: '0xtx',
                timestamp: Date.now(),
            });

            const result = await enterprise.batchSetSpendingLimits({
                updates: [
                    { newLimit: 5000000000000000000n },
                    { newLimit: 999999999999999999999n },
                ],
                signer,
            });

            expect(result.succeeded).toBe(1);
            expect(result.failed).toBe(1);
            expect(result.results[1].error).toBe('limit too high');
        });

        it('fires lifecycle callbacks', async () => {
            sdk.prepareSetDailyLimit.mockResolvedValue({ actionPayload: '0x' });
            sdk.executeTransfer.mockResolvedValue({
                transactionHash: '0xtx',
                timestamp: Date.now(),
            });

            const events: BatchLifecycleEvent[] = [];
            await enterprise.batchSetSpendingLimits(
                {
                    updates: [{ newLimit: 1n }],
                    signer,
                },
                (event) => events.push(event),
            );

            expect(events).toEqual([
                { type: 'started', total: 1 },
                { type: 'item_started', index: 0, total: 1 },
                { type: 'item_completed', index: 0, total: 1, success: true },
                { type: 'completed', succeeded: 1, failed: 0, total: 1 },
            ]);
        });
    });

    // ========================================================================
    // Admin spending limits
    // ========================================================================

    describe('getSpendingLimitsForVault', () => {
        it('delegates to sdk.spendingLimits', async () => {
            const limits = { daily: 1000n, perTransaction: 500n };
            sdk.spendingLimits.getSpendingLimits.mockResolvedValue(limits);

            const result = await enterprise.getSpendingLimitsForVault('0xVault');
            expect(result).toBe(limits);
            expect(sdk.spendingLimits.getSpendingLimits).toHaveBeenCalledWith(
                '0xVault',
                10004,
                'https://sepolia.base.org',
            );
        });
    });

    // ========================================================================
    // Balance watching
    // ========================================================================

    describe('watchVaultBalance', () => {
        it('returns unsubscribe function', () => {
            const unsub = enterprise.watchVaultBalance(10004, '0xVault', vi.fn());
            expect(typeof unsub).toBe('function');
            unsub();
        });
    });
});
