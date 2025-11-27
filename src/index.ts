/**
 * Veridex Protocol SDK
 * 
 * Client library for interacting with the Veridex Protocol.
 * Provides WebAuthn/Passkey integration and cross-chain transaction building.
 */

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/browser";
import { ethers } from "ethers";

// ============================================================================
// Types
// ============================================================================

export interface VeridexConfig {
  hubChainId: number;
  hubRpcUrl: string;
  hubContractAddress: string;
  relayerUrl?: string;
}

export interface PasskeyCredential {
  credentialId: string;
  publicKeyX: bigint;
  publicKeyY: bigint;
  keyHash: string;
}

export interface TransferParams {
  targetChain: number;
  token: string; // address or "native"
  recipient: string;
  amount: bigint;
}

export interface ExecuteParams {
  targetChain: number;
  target: string;
  value: bigint;
  data: string;
}

export interface WebAuthnSignature {
  authenticatorData: string;
  clientDataJSON: string;
  challengeIndex: number;
  typeIndex: number;
  r: bigint;
  s: bigint;
}

export interface DispatchResult {
  transactionHash: string;
  sequence: bigint;
  userKeyHash: string;
  targetChain: number;
}

// ============================================================================
// Constants
// ============================================================================

export const WORMHOLE_CHAIN_IDS = {
  SOLANA: 1,
  ETHEREUM: 2,
  POLYGON: 5,
  BSC: 4,
  AVALANCHE: 6,
  APTOS: 22,
  ARBITRUM: 23,
  OPTIMISM: 24,
  BASE: 30,
} as const;

export const ACTION_TYPES = {
  TRANSFER: 1,
  EXECUTE: 2,
  CONFIG: 3,
} as const;

// Hub Contract ABI (minimal)
const HUB_ABI = [
  "function authenticateAndDispatch((bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth, uint256 publicKeyX, uint256 publicKeyY, uint16 targetChain, bytes actionPayload) external payable returns (uint64 sequence)",
  "function getNonce(bytes32 userKeyHash) external view returns (uint256)",
  "function encodeTransferAction(address token, address recipient, uint256 amount) external pure returns (bytes)",
  "function encodeExecuteAction(address target, uint256 value, bytes data) external pure returns (bytes)",
  "function messageFee() external view returns (uint256)",
  "event Dispatched(bytes32 indexed userKeyHash, uint16 targetChain, uint256 nonce, uint64 sequence, bytes actionPayload)",
];

// ============================================================================
// Veridex Client
// ============================================================================

export class VeridexClient {
  private config: VeridexConfig;
  private provider: ethers.JsonRpcProvider;
  private hubContract: ethers.Contract;
  private credential: PasskeyCredential | null = null;

  constructor(config: VeridexConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.hubRpcUrl);
    this.hubContract = new ethers.Contract(
      config.hubContractAddress,
      HUB_ABI,
      this.provider
    );
  }

  // ==========================================================================
  // WebAuthn / Passkey Methods
  // ==========================================================================

  /**
   * Check if WebAuthn is supported in the current browser
   */
  static isSupported(): boolean {
    return browserSupportsWebAuthn();
  }

  /**
   * Register a new Passkey credential
   */
  async registerPasskey(
    username: string,
    displayName: string
  ): Promise<PasskeyCredential> {
    // Generate registration options
    const challenge = ethers.randomBytes(32);
    const challengeBase64 = base64URLEncode(challenge);

    const options: PublicKeyCredentialCreationOptionsJSON = {
      challenge: challengeBase64,
      rp: {
        name: "Veridex Protocol",
        id: window.location.hostname,
      },
      user: {
        id: base64URLEncode(ethers.toUtf8Bytes(username)),
        name: username,
        displayName: displayName,
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" }, // ES256 (P-256)
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "required",
        requireResidentKey: true,
      },
      timeout: 60000,
      attestation: "none",
    };

    // Perform registration
    const response = await startRegistration({ optionsJSON: options });

    // Extract public key from attestation
    const publicKey = extractPublicKeyFromAttestation(response);

    // Compute key hash
    const keyHash = ethers.keccak256(
      ethers.solidityPacked(["uint256", "uint256"], [publicKey.x, publicKey.y])
    );

    this.credential = {
      credentialId: response.id,
      publicKeyX: publicKey.x,
      publicKeyY: publicKey.y,
      keyHash,
    };

    return this.credential;
  }

  /**
   * Get the current credential
   */
  getCredential(): PasskeyCredential | null {
    return this.credential;
  }

  /**
   * Set an existing credential
   */
  setCredential(credential: PasskeyCredential): void {
    this.credential = credential;
  }

  // ==========================================================================
  // Transaction Methods
  // ==========================================================================

  /**
   * Get the current nonce for the user
   */
  async getNonce(): Promise<bigint> {
    if (!this.credential) {
      throw new Error("No credential set");
    }
    return await this.hubContract.getNonce(this.credential.keyHash);
  }

  /**
   * Get the Wormhole message fee
   */
  async getMessageFee(): Promise<bigint> {
    return await this.hubContract.messageFee();
  }

  /**
   * Build a transfer action payload
   */
  async buildTransferPayload(params: TransferParams): Promise<string> {
    const token =
      params.token === "native" ? ethers.ZeroAddress : params.token;
    return await this.hubContract.encodeTransferAction(
      token,
      params.recipient,
      params.amount
    );
  }

  /**
   * Build an execute action payload
   */
  async buildExecutePayload(params: ExecuteParams): Promise<string> {
    return await this.hubContract.encodeExecuteAction(
      params.target,
      params.value,
      params.data
    );
  }

  /**
   * Sign and dispatch a transfer transaction
   */
  async transfer(
    params: TransferParams,
    signer: ethers.Signer
  ): Promise<DispatchResult> {
    if (!this.credential) {
      throw new Error("No credential set");
    }

    // Build action payload
    const actionPayload = await this.buildTransferPayload(params);

    // Get nonce
    const nonce = await this.getNonce();

    // Build challenge
    const challenge = buildChallenge(
      this.credential.keyHash,
      params.targetChain,
      nonce,
      actionPayload
    );

    // Sign with Passkey
    const signature = await this.signWithPasskey(challenge);

    // Get message fee
    const messageFee = await this.getMessageFee();

    // Submit transaction
    const hubWithSigner = this.hubContract.connect(signer) as ethers.Contract;
    const tx = await hubWithSigner.authenticateAndDispatch(
      {
        authenticatorData: signature.authenticatorData,
        clientDataJSON: signature.clientDataJSON,
        challengeIndex: signature.challengeIndex,
        typeIndex: signature.typeIndex,
        r: signature.r,
        s: signature.s,
      },
      this.credential.publicKeyX,
      this.credential.publicKeyY,
      params.targetChain,
      actionPayload,
      { value: messageFee }
    );

    const receipt = await tx.wait();

    // Parse Dispatched event
    const dispatchedEvent = receipt.logs.find(
      (log: any) => log.topics[0] === ethers.id("Dispatched(bytes32,uint16,uint256,uint64,bytes)")
    );

    return {
      transactionHash: receipt.hash,
      sequence: dispatchedEvent ? BigInt(dispatchedEvent.data.slice(0, 66)) : 0n,
      userKeyHash: this.credential.keyHash,
      targetChain: params.targetChain,
    };
  }

  /**
   * Sign and dispatch an execute transaction
   */
  async execute(
    params: ExecuteParams,
    signer: ethers.Signer
  ): Promise<DispatchResult> {
    if (!this.credential) {
      throw new Error("No credential set");
    }

    const actionPayload = await this.buildExecutePayload(params);
    const nonce = await this.getNonce();
    const challenge = buildChallenge(
      this.credential.keyHash,
      params.targetChain,
      nonce,
      actionPayload
    );

    const signature = await this.signWithPasskey(challenge);
    const messageFee = await this.getMessageFee();

    const hubWithSigner = this.hubContract.connect(signer) as ethers.Contract;
    const tx = await hubWithSigner.authenticateAndDispatch(
      {
        authenticatorData: signature.authenticatorData,
        clientDataJSON: signature.clientDataJSON,
        challengeIndex: signature.challengeIndex,
        typeIndex: signature.typeIndex,
        r: signature.r,
        s: signature.s,
      },
      this.credential.publicKeyX,
      this.credential.publicKeyY,
      params.targetChain,
      actionPayload,
      { value: messageFee }
    );

    const receipt = await tx.wait();

    return {
      transactionHash: receipt.hash,
      sequence: 0n, // Parse from event
      userKeyHash: this.credential.keyHash,
      targetChain: params.targetChain,
    };
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  /**
   * Sign a challenge with the Passkey
   */
  private async signWithPasskey(challenge: Uint8Array): Promise<WebAuthnSignature> {
    if (!this.credential) {
      throw new Error("No credential set");
    }

    const challengeBase64 = base64URLEncode(challenge);

    const options: PublicKeyCredentialRequestOptionsJSON = {
      challenge: challengeBase64,
      rpId: window.location.hostname,
      allowCredentials: [
        {
          id: this.credential.credentialId,
          type: "public-key",
          transports: ["internal"],
        },
      ],
      userVerification: "required",
      timeout: 60000,
    };

    const response = await startAuthentication({ optionsJSON: options });

    // Parse response
    const authenticatorData = base64URLDecode(response.response.authenticatorData);
    const clientDataJSON = response.response.clientDataJSON;
    const signature = base64URLDecode(response.response.signature);

    // Parse signature (DER format -> r, s)
    const { r, s } = parseDERSignature(signature);

    // Find challenge and type indices in clientDataJSON
    const clientDataStr = new TextDecoder().decode(base64URLDecode(clientDataJSON));
    const challengeIndex = clientDataStr.indexOf('"challenge"');
    const typeIndex = clientDataStr.indexOf('"type"');

    return {
      authenticatorData: ethers.hexlify(authenticatorData),
      clientDataJSON: clientDataStr,
      challengeIndex,
      typeIndex,
      r: BigInt("0x" + Buffer.from(r).toString("hex")),
      s: BigInt("0x" + Buffer.from(s).toString("hex")),
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build the challenge bytes for signing
 */
function buildChallenge(
  userKeyHash: string,
  targetChain: number,
  nonce: bigint,
  actionPayload: string
): Uint8Array {
  const encoded = ethers.solidityPacked(
    ["bytes32", "uint16", "uint256", "bytes"],
    [userKeyHash, targetChain, nonce, actionPayload]
  );
  return ethers.getBytes(ethers.keccak256(encoded));
}

/**
 * Base64URL encode
 */
function base64URLEncode(buffer: Uint8Array): string {
  const base64 = Buffer.from(buffer).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Base64URL decode
 */
function base64URLDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return new Uint8Array(Buffer.from(padded, "base64"));
}

/**
 * Extract public key from WebAuthn attestation response
 */
function extractPublicKeyFromAttestation(
  response: RegistrationResponseJSON
): { x: bigint; y: bigint } {
  // The public key is in the attestationObject's authData
  const attestationObject = base64URLDecode(response.response.attestationObject);
  
  // Parse CBOR (simplified - in production use a proper CBOR library)
  // AuthData format: rpIdHash(32) || flags(1) || signCount(4) || attestedCredentialData
  // attestedCredentialData: aaguid(16) || credIdLen(2) || credId(credIdLen) || credentialPublicKey(COSE)
  
  // For now, we'll use a placeholder - in production, properly parse COSE key
  // The COSE key for P-256 contains x and y coordinates
  
  // This is a simplified extraction - real implementation needs CBOR parsing
  const authData = attestationObject.slice(0, attestationObject.length);
  
  // Find the COSE key (after rpIdHash + flags + signCount + aaguid + credIdLen + credId)
  // COSE key for EC2 (P-256):
  // {1: 2, 3: -7, -1: 1, -2: x, -3: y}
  
  // Placeholder - extract actual coordinates from COSE key
  // In production, use @simplewebauthn/server or cbor library
  
  return {
    x: 0n, // Parse from COSE key
    y: 0n, // Parse from COSE key
  };
}

/**
 * Parse DER-encoded ECDSA signature to r and s values
 */
function parseDERSignature(signature: Uint8Array): { r: Uint8Array; s: Uint8Array } {
  // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  let offset = 0;

  if (signature[offset++] !== 0x30) {
    throw new Error("Invalid signature format");
  }

  const totalLength = signature[offset++];
  
  if (signature[offset++] !== 0x02) {
    throw new Error("Invalid signature format");
  }

  const rLength = signature[offset++];
  let r = signature.slice(offset, offset + rLength);
  offset += rLength;

  // Remove leading zero if present (for positive number representation)
  if (r[0] === 0x00 && r.length > 32) {
    r = r.slice(1);
  }
  // Pad to 32 bytes if needed
  if (r.length < 32) {
    const padded = new Uint8Array(32);
    padded.set(r, 32 - r.length);
    r = padded;
  }

  if (signature[offset++] !== 0x02) {
    throw new Error("Invalid signature format");
  }

  const sLength = signature[offset++];
  let s = signature.slice(offset, offset + sLength);

  // Remove leading zero if present
  if (s[0] === 0x00 && s.length > 32) {
    s = s.slice(1);
  }
  // Pad to 32 bytes if needed
  if (s.length < 32) {
    const padded = new Uint8Array(32);
    padded.set(s, 32 - s.length);
    s = padded;
  }

  return { r, s };
}

// ============================================================================
// Exports
// ============================================================================

export {
  buildChallenge,
  base64URLEncode,
  base64URLDecode,
  parseDERSignature,
};
