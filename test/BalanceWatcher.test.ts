import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BalanceWatcher } from '../src/core/BalanceWatcher.js';
import type { PortfolioBalance } from '../src/core/BalanceManager.js';

// ============================================================================
// Helpers
// ============================================================================

function makePortfolio(
    tokens: Array<{ address: string; symbol: string; balance: bigint }>,
    chainId = 10004,
): PortfolioBalance {
    return {
        wormholeChainId: chainId,
        chainName: 'Base Sepolia',
        address: '0xVault',
        tokens: tokens.map(t => ({
            token: {
                address: t.address,
                symbol: t.symbol,
                name: t.symbol,
                decimals: 6,
                chainId,
            },
            balance: t.balance,
            formatted: t.balance.toString(),
        })),
        totalUsdValue: 0,
        lastUpdated: Date.now(),
    };
}

describe('BalanceWatcher', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('creates watcher and returns unsubscribe function', () => {
        const fetchBalance = vi.fn();
        const watcher = new BalanceWatcher(fetchBalance);
        const unsub = watcher.watch(10004, '0xVault', vi.fn());
        expect(typeof unsub).toBe('function');
        unsub();
    });

    it('polls at the configured interval', async () => {
        const portfolio = makePortfolio([
            { address: '0xUSDC', symbol: 'USDC', balance: 1000000n },
        ]);
        const fetchBalance = vi.fn().mockResolvedValue(portfolio);
        const onChange = vi.fn();

        const watcher = new BalanceWatcher(fetchBalance);
        const unsub = watcher.watch(10004, '0xVault', onChange, { intervalMs: 10_000 });

        // Advance past first interval
        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetchBalance).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetchBalance).toHaveBeenCalledTimes(2);

        unsub();
    });

    it('emits initial event when emitInitial is true', async () => {
        const portfolio = makePortfolio([
            { address: '0xUSDC', symbol: 'USDC', balance: 1000000n },
        ]);
        const fetchBalance = vi.fn().mockResolvedValue(portfolio);
        const onChange = vi.fn();

        const watcher = new BalanceWatcher(fetchBalance);
        const unsub = watcher.watch(10004, '0xVault', onChange, {
            intervalMs: 15_000,
            emitInitial: true,
        });

        // Flush microtasks for the immediate poll
        await vi.advanceTimersByTimeAsync(0);

        expect(onChange).toHaveBeenCalledTimes(1);
        const event = onChange.mock.calls[0][0];
        expect(event.wormholeChainId).toBe(10004);
        expect(event.address).toBe('0xVault');
        expect(event.portfolio).toBe(portfolio);
        expect(event.changes).toEqual([]); // first poll — no previous to diff

        unsub();
    });

    it('does not emit when balance unchanged', async () => {
        const portfolio = makePortfolio([
            { address: '0xUSDC', symbol: 'USDC', balance: 1000000n },
        ]);
        const fetchBalance = vi.fn().mockResolvedValue(portfolio);
        const onChange = vi.fn();

        const watcher = new BalanceWatcher(fetchBalance);
        const unsub = watcher.watch(10004, '0xVault', onChange, { intervalMs: 5_000 });

        // First poll — sets baseline, no emit (emitInitial not set)
        await vi.advanceTimersByTimeAsync(5_000);
        // Second poll — same balance, should not emit
        await vi.advanceTimersByTimeAsync(5_000);

        expect(onChange).not.toHaveBeenCalled();

        unsub();
    });

    it('emits changes when balance increases', async () => {
        const p1 = makePortfolio([
            { address: '0xUSDC', symbol: 'USDC', balance: 1000000n },
        ]);
        const p2 = makePortfolio([
            { address: '0xUSDC', symbol: 'USDC', balance: 2000000n },
        ]);
        const fetchBalance = vi.fn()
            .mockResolvedValueOnce(p1)
            .mockResolvedValueOnce(p2);
        const onChange = vi.fn();

        const watcher = new BalanceWatcher(fetchBalance);
        const unsub = watcher.watch(10004, '0xVault', onChange, { intervalMs: 5_000 });

        // First poll — baseline
        await vi.advanceTimersByTimeAsync(5_000);
        // Second poll — balance changed
        await vi.advanceTimersByTimeAsync(5_000);

        expect(onChange).toHaveBeenCalledTimes(1);
        const event = onChange.mock.calls[0][0];
        expect(event.changes).toHaveLength(1);
        expect(event.changes[0].previousBalance).toBe(1000000n);
        expect(event.changes[0].currentBalance).toBe(2000000n);
        expect(event.changes[0].delta).toBe(1000000n);

        unsub();
    });

    it('emits negative delta when balance decreases', async () => {
        const p1 = makePortfolio([
            { address: '0xUSDC', symbol: 'USDC', balance: 5000000n },
        ]);
        const p2 = makePortfolio([
            { address: '0xUSDC', symbol: 'USDC', balance: 3000000n },
        ]);
        const fetchBalance = vi.fn()
            .mockResolvedValueOnce(p1)
            .mockResolvedValueOnce(p2);
        const onChange = vi.fn();

        const watcher = new BalanceWatcher(fetchBalance);
        const unsub = watcher.watch(10004, '0xVault', onChange, { intervalMs: 5_000 });

        await vi.advanceTimersByTimeAsync(5_000);
        await vi.advanceTimersByTimeAsync(5_000);

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0].changes[0].delta).toBe(-2000000n);

        unsub();
    });

    it('detects tokens that disappear', async () => {
        const p1 = makePortfolio([
            { address: '0xUSDC', symbol: 'USDC', balance: 1000000n },
            { address: '0xWETH', symbol: 'WETH', balance: 500000n },
        ]);
        const p2 = makePortfolio([
            { address: '0xUSDC', symbol: 'USDC', balance: 1000000n },
            // WETH disappeared
        ]);
        const fetchBalance = vi.fn()
            .mockResolvedValueOnce(p1)
            .mockResolvedValueOnce(p2);
        const onChange = vi.fn();

        const watcher = new BalanceWatcher(fetchBalance);
        const unsub = watcher.watch(10004, '0xVault', onChange, { intervalMs: 5_000 });

        await vi.advanceTimersByTimeAsync(5_000);
        await vi.advanceTimersByTimeAsync(5_000);

        expect(onChange).toHaveBeenCalledTimes(1);
        const event = onChange.mock.calls[0][0];
        const wethChange = event.changes.find((c: any) => c.token.symbol === 'WETH');
        expect(wethChange).toBeDefined();
        expect(wethChange.currentBalance).toBe(0n);
        expect(wethChange.delta).toBe(-500000n);

        unsub();
    });

    it('calls onError when fetchBalance rejects', async () => {
        const fetchBalance = vi.fn().mockRejectedValue(new Error('RPC down'));
        const onChange = vi.fn();
        const onError = vi.fn();

        const watcher = new BalanceWatcher(fetchBalance);
        const unsub = watcher.watch(10004, '0xVault', onChange, { intervalMs: 5_000 }, onError);

        await vi.advanceTimersByTimeAsync(5_000);

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0].message).toBe('RPC down');
        expect(onChange).not.toHaveBeenCalled();

        unsub();
    });

    it('does not crash poller if subscriber callback throws', async () => {
        const p1 = makePortfolio([{ address: '0xUSDC', symbol: 'USDC', balance: 1n }]);
        const p2 = makePortfolio([{ address: '0xUSDC', symbol: 'USDC', balance: 2n }]);
        const p3 = makePortfolio([{ address: '0xUSDC', symbol: 'USDC', balance: 3n }]);

        const fetchBalance = vi.fn()
            .mockResolvedValueOnce(p1)
            .mockResolvedValueOnce(p2)
            .mockResolvedValueOnce(p3);

        const onChange = vi.fn().mockImplementationOnce(() => {
            throw new Error('subscriber crashed');
        });

        const watcher = new BalanceWatcher(fetchBalance);
        const unsub = watcher.watch(10004, '0xVault', onChange, { intervalMs: 5_000 });

        // First poll — baseline
        await vi.advanceTimersByTimeAsync(5_000);
        // Second poll — change detected, subscriber throws
        await vi.advanceTimersByTimeAsync(5_000);
        // Third poll — should still work
        await vi.advanceTimersByTimeAsync(5_000);

        expect(onChange).toHaveBeenCalledTimes(2);
        unsub();
    });

    it('supports multiple subscribers on same vault', async () => {
        const p1 = makePortfolio([{ address: '0xUSDC', symbol: 'USDC', balance: 1n }]);
        const p2 = makePortfolio([{ address: '0xUSDC', symbol: 'USDC', balance: 2n }]);
        const fetchBalance = vi.fn()
            .mockResolvedValueOnce(p1)
            .mockResolvedValueOnce(p2);

        const cb1 = vi.fn();
        const cb2 = vi.fn();

        const watcher = new BalanceWatcher(fetchBalance);
        const unsub1 = watcher.watch(10004, '0xVault', cb1, { intervalMs: 5_000 });
        const unsub2 = watcher.watch(10004, '0xVault', cb2);

        await vi.advanceTimersByTimeAsync(5_000);
        await vi.advanceTimersByTimeAsync(5_000);

        expect(cb1).toHaveBeenCalledTimes(1);
        expect(cb2).toHaveBeenCalledTimes(1);

        unsub1();
        unsub2();
    });

    it('removes subscription when all callbacks unsubscribe', () => {
        const watcher = new BalanceWatcher(vi.fn());
        const unsub1 = watcher.watch(10004, '0xVault', vi.fn());
        const unsub2 = watcher.watch(10004, '0xVault', vi.fn());

        expect(watcher.activeCount).toBe(1);

        unsub1();
        expect(watcher.activeCount).toBe(1); // still one callback

        unsub2();
        expect(watcher.activeCount).toBe(0);
    });

    it('stopAll clears all subscriptions', () => {
        const watcher = new BalanceWatcher(vi.fn());
        watcher.watch(10004, '0xA', vi.fn());
        watcher.watch(10005, '0xB', vi.fn());

        expect(watcher.activeCount).toBe(2);
        watcher.stopAll();
        expect(watcher.activeCount).toBe(0);
    });

    it('enforces minimum interval (5s floor)', async () => {
        const fetchBalance = vi.fn().mockResolvedValue(
            makePortfolio([{ address: '0xUSDC', symbol: 'USDC', balance: 1n }]),
        );
        const watcher = new BalanceWatcher(fetchBalance);
        const unsub = watcher.watch(10004, '0xVault', vi.fn(), { intervalMs: 1_000 });

        // At 1s it should NOT have fired (floor is 5s)
        await vi.advanceTimersByTimeAsync(1_000);
        expect(fetchBalance).toHaveBeenCalledTimes(0);

        // At 5s it should fire
        await vi.advanceTimersByTimeAsync(4_000);
        expect(fetchBalance).toHaveBeenCalledTimes(1);

        unsub();
    });
});
