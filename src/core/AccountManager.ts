import type { PasskeyManager, PasskeyCredential } from './PasskeyManager.js';
import type { WalletManager, ChainAddressConfig } from './WalletManager.js';
import type { ChainAddress, ChainClient, UnifiedIdentity } from './types.js';
import type { SessionKey } from '../types.js';
import { CHAIN_PRESETS, type ChainName, type NetworkType } from '../presets.js';
import {
    RelayerClient,
    type CredentialMetadataRecord,
    type RegisteredAppDetail,
    type RegisteredAppStatus,
    type RegisteredAppSummary,
    type RegisteredAppTrustLevel,
    type RelayerAppSession,
} from './RelayerClient.js';

type RecoveryGuardiansResult = {
    guardians: string[];
    threshold: bigint;
    isConfigured: boolean;
};

type RecoveryStatusResult = {
    isActive: boolean;
    newOwnerKeyHash: string;
    initiatedAt: bigint;
    approvalCount: bigint;
    threshold: bigint;
    canExecuteAt: bigint;
    expiresAt: bigint;
};

type RecoveryCapableChain = ChainClient & {
    getGuardians(identityKeyHash: string): Promise<RecoveryGuardiansResult>;
    getRecoveryStatus(identityKeyHash: string): Promise<RecoveryStatusResult>;
};

type OnchainSessionCapableChain = ChainClient & {
    getUserSessions(userKeyHash: string): Promise<SessionKey[]>;
};

export interface PortabilityOverview {
    credential: PasskeyCredential;
    unifiedIdentity: UnifiedIdentity;
    supportedChainIdentity: UnifiedIdentity;
    localCredentialCount: number;
    remoteCredentials: CredentialMetadataRecord[];
    syncedCredentialCount: number;
    backupEligibleCount: number;
    backupBackedCount: number;
    rootCredentialCount: number;
    supportedChainCount: number;
    nonEvmAddressCount: number;
}

export interface RecoveryOverview {
    identityKeyHash: string;
    guardians: string[];
    threshold: bigint;
    isConfigured: boolean;
    recovery: RecoveryStatusResult;
}

export interface AccountManagerConfig {
    passkey: PasskeyManager;
    wallet: WalletManager;
    chain: ChainClient;
    relayer?: RelayerClient;
    testnet?: boolean;
    getUnifiedIdentity: () => Promise<UnifiedIdentity>;
}

function isRecoveryCapableChain(chain: ChainClient): chain is RecoveryCapableChain {
    return typeof (chain as RecoveryCapableChain).getGuardians === 'function'
        && typeof (chain as RecoveryCapableChain).getRecoveryStatus === 'function';
}

function isOnchainSessionCapableChain(chain: ChainClient): chain is OnchainSessionCapableChain {
    return typeof (chain as OnchainSessionCapableChain).getUserSessions === 'function';
}

export class AccountManager {
    private readonly passkey: PasskeyManager;
    private readonly wallet: WalletManager;
    private readonly chain: ChainClient;
    private readonly relayer?: RelayerClient;
    private readonly network: NetworkType;
    private readonly getUnifiedIdentityImpl: () => Promise<UnifiedIdentity>;

    constructor(config: AccountManagerConfig) {
        this.passkey = config.passkey;
        this.wallet = config.wallet;
        this.chain = config.chain;
        this.relayer = config.relayer;
        this.network = config.testnet === false ? 'mainnet' : 'testnet';
        this.getUnifiedIdentityImpl = config.getUnifiedIdentity;
    }

    private requireCredential(): PasskeyCredential {
        const credential = this.passkey.getCredential();
        if (!credential) {
            throw new Error('No credential set. Call passkey.register() or passkey.authenticate() first.');
        }
        return credential;
    }

    private requireRelayer(): RelayerClient {
        if (!this.relayer) {
            throw new Error('Relayer integration is not configured for this SDK instance.');
        }
        return this.relayer;
    }

    async getPortabilityOverview(): Promise<PortabilityOverview> {
        const credential = this.requireCredential();
        const localCredentials = this.passkey.getAllStoredCredentials();
        const unifiedIdentity = await this.getUnifiedIdentityImpl();
        const supportedChainIdentity = await this.getSupportedChainIdentity();
        const remoteCredentials = this.relayer
            ? await this.relayer.listCredentialMetadata(credential.keyHash)
            : [];

        return {
            credential,
            unifiedIdentity,
            supportedChainIdentity,
            localCredentialCount: localCredentials.length,
            remoteCredentials,
            syncedCredentialCount: remoteCredentials.filter((item) => item.backupState === true).length,
            backupEligibleCount: remoteCredentials.filter((item) => item.backupEligible === true).length,
            backupBackedCount: remoteCredentials.filter((item) => item.backupState === true).length,
            rootCredentialCount: remoteCredentials.filter((item) => item.isRoot).length,
            supportedChainCount: supportedChainIdentity.addresses.length,
            nonEvmAddressCount: supportedChainIdentity.addresses.filter((item) => item.isEvm === false).length,
        };
    }

    async getSupportedChainIdentity(chainNames?: ChainName[]): Promise<UnifiedIdentity> {
        const credential = this.requireCredential();
        return this.wallet.getUnifiedIdentity(credential, this.buildChainAddressConfigMap(chainNames));
    }

    async getSupportedChainAddresses(chainNames?: ChainName[]): Promise<ChainAddress[]> {
        const identity = await this.getSupportedChainIdentity(chainNames);
        return identity.addresses;
    }

    async listCredentialMetadata(keyHash?: string): Promise<CredentialMetadataRecord[]> {
        const relayer = this.requireRelayer();
        const resolvedKeyHash = keyHash ?? this.requireCredential().keyHash;
        return relayer.listCredentialMetadata(resolvedKeyHash);
    }

    async getRecoveryOverview(identityKeyHash?: string): Promise<RecoveryOverview> {
        if (!isRecoveryCapableChain(this.chain)) {
            throw new Error('The configured chain client does not support recovery queries.');
        }

        const resolvedKeyHash = identityKeyHash ?? this.requireCredential().keyHash;
        const [guardians, recovery] = await Promise.all([
            this.chain.getGuardians(resolvedKeyHash),
            this.chain.getRecoveryStatus(resolvedKeyHash),
        ]);

        return {
            identityKeyHash: resolvedKeyHash,
            guardians: guardians.guardians,
            threshold: guardians.threshold,
            isConfigured: guardians.isConfigured,
            recovery,
        };
    }

    async getOnchainSessions(identityKeyHash?: string): Promise<SessionKey[]> {
        if (!isOnchainSessionCapableChain(this.chain)) {
            throw new Error('The configured chain client does not support on-chain session queries.');
        }

        const resolvedKeyHash = identityKeyHash ?? this.requireCredential().keyHash;
        return this.chain.getUserSessions(resolvedKeyHash);
    }

    async listApps(): Promise<RegisteredAppSummary[]> {
        return this.requireRelayer().listApps();
    }

    async getApp(appId: string): Promise<RegisteredAppDetail> {
        return this.requireRelayer().getApp(appId);
    }

    async updateAppStatus(appId: string, status: RegisteredAppStatus): Promise<void> {
        await this.requireRelayer().updateAppStatus(appId, status);
    }

    async updateAppTrustLevel(appId: string, trustLevel: RegisteredAppTrustLevel): Promise<void> {
        await this.requireRelayer().updateAppTrustLevel(appId, trustLevel);
    }

    async listAppSessions(appId: string, options?: { includeRevoked?: boolean }): Promise<RelayerAppSession[]> {
        return this.requireRelayer().listAppSessions(appId, options);
    }

    async revokeAppSession(appId: string, sessionId: string): Promise<number> {
        return this.requireRelayer().revokeAppSessions(appId, sessionId);
    }

    async revokeAllAppSessions(appId: string): Promise<number> {
        return this.requireRelayer().revokeAppSessions(appId);
    }

    private buildChainAddressConfigMap(chainNames?: ChainName[]): Map<number, ChainAddressConfig> {
        const names = chainNames ?? (Object.keys(CHAIN_PRESETS) as ChainName[]);
        const chainConfigs = new Map<number, ChainAddressConfig>();

        for (const chainName of names) {
            const preset = CHAIN_PRESETS[chainName];
            const networkConfig = preset[this.network];

            chainConfigs.set(networkConfig.wormholeChainId, {
                chainName: preset.displayName,
                isEvm: preset.type === 'evm',
                factoryAddress: networkConfig.contracts?.vaultFactory,
                implementationAddress: networkConfig.contracts?.vaultImplementation,
            });
        }

        return chainConfigs;
    }
}