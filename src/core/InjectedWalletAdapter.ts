/**
 * Veridex Protocol SDK — Injected Wallet Adapter
 *
 * Provides a standardized adapter for browser-injected EIP-1193 wallets
 * (MetaMask, Rabby, Coinbase Wallet, etc.).  Used as the on-chain signer
 * for Veridex SDK operations that require a funded EOA for gas payment.
 *
 * Capabilities beyond basic connect:
 *   - EIP-1193 event forwarding (accountsChanged, chainChanged, disconnect)
 *   - Connection state tracking
 *   - Clean disconnect with listener teardown
 *   - Static availability detection
 *
 * ADR-0040 compliance: This adapter never touches passkey material.
 * It only provides an ethers.Signer for on-chain transaction submission.
 *
 * @module InjectedWalletAdapter
 */

import { ethers } from 'ethers';

type Eip1193Provider = {
    request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
    on?(event: string, handler: (...args: unknown[]) => void): void;
    removeListener?(event: string, handler: (...args: unknown[]) => void): void;
};

type WindowWithEthereum = Window & {
    ethereum?: Eip1193Provider;
};

export interface InjectedWalletConnection {
    provider: ethers.BrowserProvider;
    signer: ethers.JsonRpcSigner;
    address: string;
    chainId: number;
}

export type WalletEvent =
    | { type: 'accountsChanged'; accounts: string[] }
    | { type: 'chainChanged'; chainId: number }
    | { type: 'disconnect'; error?: unknown };

export type WalletEventCallback = (event: WalletEvent) => void;

export interface InjectedWalletAdapterConfig {
    expectedChainId?: number;
    autoSwitchChain?: boolean;
}

export class InjectedWalletAdapter {
    private readonly config: InjectedWalletAdapterConfig;
    private eventCallbacks: WalletEventCallback[] = [];
    private ethereum: Eip1193Provider | null = null;
    private boundAccountsChanged: ((accounts: unknown) => void) | null = null;
    private boundChainChanged: ((chainId: unknown) => void) | null = null;
    private boundDisconnect: ((error: unknown) => void) | null = null;
    private connection: InjectedWalletConnection | null = null;

    constructor(config: InjectedWalletAdapterConfig = {}) {
        this.config = {
            autoSwitchChain: config.autoSwitchChain ?? true,
            expectedChainId: config.expectedChainId,
        };
    }

    private getEthereum(): Eip1193Provider {
        if (typeof window === 'undefined') {
            throw new Error('Injected wallet access is only available in the browser.');
        }

        const { ethereum } = window as WindowWithEthereum;
        if (!ethereum) {
            throw new Error('No injected EIP-1193 wallet found.');
        }

        return ethereum;
    }

    isAvailable(): boolean {
        if (typeof window === 'undefined') {
            return false;
        }

        return Boolean((window as WindowWithEthereum).ethereum);
    }

    /** Returns the current active connection, or null. */
    getConnection(): InjectedWalletConnection | null {
        return this.connection;
    }

    async connect(expectedChainId = this.config.expectedChainId): Promise<InjectedWalletConnection> {
        const ethereum = this.getEthereum();
        this.ethereum = ethereum;
        const provider = new ethers.BrowserProvider(ethereum);

        await ethereum.request({ method: 'eth_requestAccounts' });

        if (expectedChainId && this.config.autoSwitchChain) {
            await this.switchChain(expectedChainId);
        }

        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        const network = await provider.getNetwork();

        this.connection = {
            provider,
            signer,
            address,
            chainId: Number(network.chainId),
        };

        // Start listening for wallet events
        this.attachEventListeners(ethereum);

        return this.connection;
    }

    /** Disconnect: clears local state and removes event listeners. */
    disconnect(): void {
        this.detachEventListeners();
        this.connection = null;
        this.ethereum = null;
        this.emit({ type: 'disconnect' });
    }

    async switchChain(chainId: number): Promise<void> {
        const ethereum = this.getEthereum();
        await ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${chainId.toString(16)}` }],
        });
    }

    async getCurrentChainId(): Promise<number> {
        const provider = new ethers.BrowserProvider(this.getEthereum());
        const network = await provider.getNetwork();
        return Number(network.chainId);
    }

    // ========================================================================
    // Event system
    // ========================================================================

    /** Subscribe to wallet events (accountsChanged, chainChanged, disconnect). */
    on(callback: WalletEventCallback): () => void {
        this.eventCallbacks.push(callback);
        return () => {
            this.eventCallbacks = this.eventCallbacks.filter(cb => cb !== callback);
        };
    }

    private emit(event: WalletEvent): void {
        for (const cb of this.eventCallbacks) {
            try { cb(event); } catch { /* consumer error — swallow */ }
        }
    }

    private attachEventListeners(ethereum: Eip1193Provider): void {
        if (!ethereum.on) return;

        this.boundAccountsChanged = (accounts: unknown) => {
            const accts = accounts as string[];
            this.emit({ type: 'accountsChanged', accounts: accts });
            // If accounts empty, the user disconnected inside the wallet
            if (accts.length === 0) {
                this.connection = null;
            }
        };

        this.boundChainChanged = (chainId: unknown) => {
            const id = typeof chainId === 'string' ? parseInt(chainId, 16) : Number(chainId);
            if (this.connection) {
                this.connection.chainId = id;
            }
            this.emit({ type: 'chainChanged', chainId: id });
        };

        this.boundDisconnect = (error: unknown) => {
            this.connection = null;
            this.emit({ type: 'disconnect', error });
        };

        ethereum.on('accountsChanged', this.boundAccountsChanged);
        ethereum.on('chainChanged', this.boundChainChanged);
        ethereum.on('disconnect', this.boundDisconnect);
    }

    private detachEventListeners(): void {
        const ethereum = this.ethereum;
        if (!ethereum?.removeListener) return;

        if (this.boundAccountsChanged) {
            ethereum.removeListener('accountsChanged', this.boundAccountsChanged);
        }
        if (this.boundChainChanged) {
            ethereum.removeListener('chainChanged', this.boundChainChanged);
        }
        if (this.boundDisconnect) {
            ethereum.removeListener('disconnect', this.boundDisconnect);
        }

        this.boundAccountsChanged = null;
        this.boundChainChanged = null;
        this.boundDisconnect = null;
    }
}

export function createInjectedWalletAdapter(config?: InjectedWalletAdapterConfig): InjectedWalletAdapter {
    return new InjectedWalletAdapter(config);
}