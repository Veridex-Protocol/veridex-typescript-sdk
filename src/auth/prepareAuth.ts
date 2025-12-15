import { ethers } from 'ethers';

import type { PasskeyCredential, TransferParams, ExecuteParams, BridgeParams } from '../core/types.js';
import { PasskeyManager } from '../core/PasskeyManager.js';
import { MAINNET_CHAINS, TESTNET_CHAINS } from '../constants.js';
import { buildGaslessChallenge, createGaslessMessageHash, encodeBridgeAction, encodeExecuteAction, encodeTransferAction } from '../payload.js';
import { queryHubState } from '../queries/hubState.js';

export type AuthenticateAndPrepareParams = {
  credential: PasskeyCredential;
  action: TransferParams | ExecuteParams | BridgeParams;
  targetChain: number;
};

export type AuthenticateAndPrepareResult = {
  serializedTx: Uint8Array;
  queryProof: Uint8Array<ArrayBufferLike>;
  estimatedLatency: number;
  fallbackAvailable: boolean;
};

function resolveNetwork(): 'testnet' | 'mainnet' {
  const envCandidates = [
    (globalThis as any)?.process?.env?.NEXT_PUBLIC_VERIDEX_NETWORK,
    (globalThis as any)?.process?.env?.VERIDEX_NETWORK,
    (globalThis as any)?.process?.env?.NEXT_PUBLIC_WORMHOLE_NETWORK,
    (globalThis as any)?.process?.env?.WORMHOLE_NETWORK,
  ].filter(Boolean);

  const env = (envCandidates[0] as string | undefined)?.toLowerCase();
  if (env === 'mainnet' || env === 'testnet') return env;
  return 'testnet';
}

function getHubChainId(network: 'testnet' | 'mainnet'): number {
  return network === 'testnet' ? TESTNET_CHAINS.baseSepolia.wormholeChainId : MAINNET_CHAINS.base.wormholeChainId;
}

function getHubRpcUrl(network: 'testnet' | 'mainnet'): string {
  return network === 'testnet' ? TESTNET_CHAINS.baseSepolia.rpcUrl : MAINNET_CHAINS.base.rpcUrl;
}

function getHubAddress(network: 'testnet' | 'mainnet'): string {
  const hub = network === 'testnet'
    ? TESTNET_CHAINS.baseSepolia.contracts.hub
    : (MAINNET_CHAINS.base.contracts as any)?.hub;
  if (!hub) {
    throw new Error('Hub address missing in SDK constants');
  }
  return hub;
}

function encodeActionPayload(action: TransferParams | ExecuteParams | BridgeParams, targetChain: number): string {
  if ((action as TransferParams).token !== undefined && (action as TransferParams).recipient !== undefined) {
    const a = action as TransferParams;
    return encodeTransferAction(a.token, a.recipient, a.amount);
  }

  if ((action as ExecuteParams).target !== undefined && (action as ExecuteParams).data !== undefined) {
    const a = action as ExecuteParams;
    return encodeExecuteAction(a.target, a.value, a.data);
  }

  const a = action as BridgeParams;
  return encodeBridgeAction(a.token, a.amount, targetChain, a.recipient);
}

async function fetchNonceViaRpc(userKeyHash: string, network: 'testnet' | 'mainnet'): Promise<bigint> {
  const rpcUrl = getHubRpcUrl(network);
  const hubAddress = getHubAddress(network);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const hubIface = new ethers.Interface([
    'function getNonce(bytes32 userKeyHash) external view returns (uint256)',
    'function userNonces(bytes32 userKeyHash) external view returns (uint256)',
  ]);

  const calls: Array<() => Promise<bigint>> = [
    async () => {
      const data = hubIface.encodeFunctionData('getNonce', [userKeyHash]);
      const res = await provider.call({ to: hubAddress, data });
      const decoded = hubIface.decodeFunctionResult('getNonce', res);
      return decoded[0] as bigint;
    },
    async () => {
      const data = hubIface.encodeFunctionData('userNonces', [userKeyHash]);
      const res = await provider.call({ to: hubAddress, data });
      const decoded = hubIface.decodeFunctionResult('userNonces', res);
      return decoded[0] as bigint;
    },
  ];

  let lastErr: unknown;
  for (const fn of calls) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function toHex32(value: bigint): string {
  return '0x' + value.toString(16).padStart(64, '0');
}

/**
 * Client-first authentication preparation:
 * - user signs locally (FaceID/TouchID)
 * - client queries Wormhole Query Proxy for Guardian-attested nonce/state
 * - client returns a ready-to-submit relayer payload (JSON bytes)
 * - falls back to RPC nonce if Queries fails
 */
export async function authenticateAndPrepare(
  userParams: AuthenticateAndPrepareParams,
  apiKey: string
): Promise<AuthenticateAndPrepareResult> {
  const network = resolveNetwork();
  const hubChainId = getHubChainId(network);

  const actionPayload = encodeActionPayload(userParams.action, userParams.targetChain);

  let nonce: bigint;
  let queryProof: Uint8Array<ArrayBufferLike> = new Uint8Array();
  let fallbackAvailable = true;

  const queryStart = Date.now();
  try {
    const state = await queryHubState(userParams.credential.keyHash, apiKey, {
      network,
      maxAge: 60,
    });

    if (!state.isRegistered) {
      // This is a hard failure: signing won’t help if the key isn’t registered.
      throw new Error('Passkey is not registered on Hub');
    }

    nonce = state.nonce;
    queryProof = state.proof;
  } catch {
    // Fallback: fetch nonce directly from hub RPC.
    nonce = await fetchNonceViaRpc(userParams.credential.keyHash, network);
    queryProof = new Uint8Array();
  }
  const queryLatencyMs = Date.now() - queryStart;

  const challenge = buildGaslessChallenge(userParams.targetChain, actionPayload, nonce, hubChainId);
  const passkey = new PasskeyManager();
  passkey.setCredential(userParams.credential);
  const signature = await passkey.sign(challenge);

  const messageHash = createGaslessMessageHash(userParams.targetChain, actionPayload, nonce, hubChainId);

  // Relayer request body (matches packages/relayer POST /api/v1/submit requirements)
  const requestBody: any = {
    messageHash,
    r: toHex32(signature.r),
    s: toHex32(signature.s),
    publicKeyX: toHex32(userParams.credential.publicKeyX),
    publicKeyY: toHex32(userParams.credential.publicKeyY),
    targetChain: userParams.targetChain,
    actionPayload,
    nonce: Number(nonce),
  };

  // Include proof as an optional field for callers to forward/store (relayer ignores extra fields).
  if (queryProof.length) {
    requestBody.queryProof = ethers.hexlify(queryProof);
  }

  const serializedTx = new TextEncoder().encode(JSON.stringify(requestBody));

  // Heuristic: Queries is sub-second; RPC nonce lookup is slower.
  const estimatedLatency = queryProof.length ? Math.max(250, queryLatencyMs) : Math.max(800, queryLatencyMs);

  return {
    serializedTx,
    queryProof,
    estimatedLatency,
    fallbackAvailable,
  };
}
