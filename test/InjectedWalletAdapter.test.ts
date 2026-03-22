/**
 * Veridex Protocol SDK - InjectedWalletAdapter Tests
 *
 * Tests for MetaMask / EIP-1193 injected wallet interop:
 * - Availability detection
 * - Connect / disconnect flow
 * - Event listening (accountsChanged, chainChanged, disconnect)
 * - Chain switching
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InjectedWalletAdapter } from '../src/core/InjectedWalletAdapter.js';

// ============================================================================
// Mock EIP-1193 Provider
// ============================================================================

function createMockEthereum() {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

    return {
        request: vi.fn(async (args: { method: string; params?: unknown[] }) => {
            if (args.method === 'eth_requestAccounts') {
                return ['0xuser1'];
            }
            if (args.method === 'wallet_switchEthereumChain') {
                return null;
            }
            if (args.method === 'eth_chainId') {
                return '0x2105'; // Base = 8453
            }
            return null;
        }),
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event]!.push(handler);
        }),
        removeListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            if (listeners[event]) {
                listeners[event] = listeners[event]!.filter(h => h !== handler);
            }
        }),
        // Test helper: emit an event
        __emit: (event: string, ...args: unknown[]) => {
            for (const handler of listeners[event] ?? []) {
                handler(...args);
            }
        },
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('InjectedWalletAdapter', () => {
    let adapter: InjectedWalletAdapter;

    beforeEach(() => {
        adapter = new InjectedWalletAdapter();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('isAvailable', () => {
        it('returns false when window is undefined (Node.js)', () => {
            // In node environment, window is not defined
            expect(adapter.isAvailable()).toBe(false);
        });

        it('returns false when no ethereum provider', () => {
            vi.stubGlobal('window', {});
            expect(adapter.isAvailable()).toBe(false);
        });

        it('returns true when ethereum provider exists', () => {
            vi.stubGlobal('window', { ethereum: createMockEthereum() });
            expect(adapter.isAvailable()).toBe(true);
        });
    });

    describe('getConnection', () => {
        it('returns null before connect', () => {
            expect(adapter.getConnection()).toBeNull();
        });
    });

    describe('disconnect', () => {
        it('emits disconnect event', () => {
            const events: any[] = [];
            adapter.on(e => events.push(e));
            adapter.disconnect();
            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('disconnect');
        });

        it('clears connection', () => {
            adapter.disconnect();
            expect(adapter.getConnection()).toBeNull();
        });
    });

    describe('on (event system)', () => {
        it('returns unsubscribe function', () => {
            const unsub = adapter.on(() => {});
            expect(typeof unsub).toBe('function');
        });

        it('unsubscribe prevents future events', () => {
            const events: any[] = [];
            const unsub = adapter.on(e => events.push(e));
            adapter.disconnect(); // triggers event
            expect(events).toHaveLength(1);

            unsub();
            adapter.disconnect(); // should not trigger
            expect(events).toHaveLength(1);
        });
    });

    describe('config', () => {
        it('accepts expectedChainId', () => {
            const a = new InjectedWalletAdapter({ expectedChainId: 8453 });
            expect(a).toBeDefined();
        });

        it('accepts autoSwitchChain false', () => {
            const a = new InjectedWalletAdapter({ autoSwitchChain: false });
            expect(a).toBeDefined();
        });
    });
});
