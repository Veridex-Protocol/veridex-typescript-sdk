/**
 * Veridex Protocol SDK
 * 
 * Client library for interacting with the Veridex Protocol.
 * Provides WebAuthn/Passkey integration, cross-chain transaction building,
 * and Wormhole VAA handling.
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
} from "@simplewebauthn/types";
import { ethers } from "ethers";

// ============================================================================
// Re-export all modules
// ============================================================================

export * from './types.js';
export * from './constants.js';
export * from './wormhole.js';
export * from './payload.js';
export * from './utils.js';

// ============================================================================
// Import types for internal use
// ============================================================================

import type {
  VeridexConfig,
  PasskeyCredential,
  TransferParams,
  ExecuteParams,
  BridgeParams,
  WebAuthnSignature,
  DispatchResult,
} from './types.js';

import { HUB_ABI } from './constants.js';
import { base64URLEncode, base64URLDecode, parseDERSignature, computeKeyHash } from './utils';
import { buildChallenge } from './payload.js';

// ============================================================================
// Veridex Client
// ============================================================================

export class VeridexClient {
  private readonly _config: VeridexConfig;
  private provider: ethers.JsonRpcProvider;
  private hubContract: ethers.Contract;
  private credential: PasskeyCredential | null = null;

  constructor(config: VeridexConfig) {
    this._config = config;
    this.provider = new ethers.JsonRpcProvider(config.hubRpcUrl);
    this.hubContract = new ethers.Contract(
      config.hubContractAddress,
      HUB_ABI,
      this.provider
    );
  }

  /**
   * Get the current configuration
   */
  get config(): VeridexConfig {
    return this._config;
  }

  /**
   * Get the provider instance
   */
  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  /**
   * Get the hub contract instance
   */
  getHubContract(): ethers.Contract {
    return this.hubContract;
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
    const response = await startRegistration(options);

    // Extract public key from attestation
    const publicKey = extractPublicKeyFromAttestation(response);

    // Compute key hash using the imported utility
    const keyHash = computeKeyHash(publicKey.x, publicKey.y);

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

  /**
   * Create a credential from public key coordinates
   */
  createCredentialFromPublicKey(
    credentialId: string,
    publicKeyX: bigint,
    publicKeyY: bigint
  ): PasskeyCredential {
    const keyHash = computeKeyHash(publicKeyX, publicKeyY);
    this.credential = {
      credentialId,
      publicKeyX,
      publicKeyY,
      keyHash,
    };
    return this.credential;
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
    const getNonceFn = this.hubContract.getFunction("getNonce");
    return await getNonceFn(this.credential.keyHash);
  }

  /**
   * Get the Wormhole message fee
   */
  async getMessageFee(): Promise<bigint> {
    const messageFeeFn = this.hubContract.getFunction("messageFee");
    return await messageFeeFn();
  }

  /**
   * Build a transfer action payload
   */
  async buildTransferPayload(params: TransferParams): Promise<string> {
    const token =
      params.token === "native" ? ethers.ZeroAddress : params.token;
    const encodeTransferActionFn = this.hubContract.getFunction("encodeTransferAction");
    return await encodeTransferActionFn(
      token,
      params.recipient,
      params.amount
    );
  }

  /**
   * Build an execute action payload
   */
  async buildExecutePayload(params: ExecuteParams): Promise<string> {
    const encodeExecuteActionFn = this.hubContract.getFunction("encodeExecuteAction");
    return await encodeExecuteActionFn(
      params.target,
      params.value,
      params.data
    );
  }

  /**
   * Build a bridge action payload for cross-chain token transfers
   */
  async buildBridgePayload(params: BridgeParams): Promise<string> {
    // Convert token address to bytes32
    const tokenBytes32 = params.token === "native" 
      ? ethers.zeroPadValue(ethers.ZeroAddress, 32)
      : ethers.zeroPadValue(params.token, 32);
    
    // Ensure recipient is bytes32
    const recipientBytes32 = ethers.zeroPadValue(params.recipient, 32);
    
    const encodeBridgeActionFn = this.hubContract.getFunction("encodeBridgeAction");
    return await encodeBridgeActionFn(
      tokenBytes32,
      params.amount,
      params.destinationChain,
      recipientBytes32
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
    const authenticateAndDispatchFn = hubWithSigner.getFunction("authenticateAndDispatch");
    const tx = await authenticateAndDispatchFn(
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
    const authenticateAndDispatchFn = hubWithSigner.getFunction("authenticateAndDispatch");
    const tx = await authenticateAndDispatchFn(
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

  /**
   * Sign and dispatch a cross-chain bridge transaction
   * This initiates a token bridge from the source chain to the destination chain
   */
  async bridge(
    params: BridgeParams,
    signer: ethers.Signer
  ): Promise<DispatchResult> {
    if (!this.credential) {
      throw new Error("No credential set");
    }

    const actionPayload = await this.buildBridgePayload(params);
    const nonce = await this.getNonce();
    
    // The target chain for the VAA is the source chain where the vault is
    const challenge = buildChallenge(
      this.credential.keyHash,
      params.sourceChain,
      nonce,
      actionPayload
    );

    const signature = await this.signWithPasskey(challenge);
    const messageFee = await this.getMessageFee();

    const hubWithSigner = this.hubContract.connect(signer) as ethers.Contract;
    const authenticateAndDispatchFn = hubWithSigner.getFunction("authenticateAndDispatch");
    const tx = await authenticateAndDispatchFn(
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
      params.sourceChain, // Target the vault's chain
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
      targetChain: params.sourceChain,
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

    const response = await startAuthentication(options);

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
// Helper Functions (internal only)
// ============================================================================

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
  const _authData = attestationObject.slice(0, attestationObject.length);
  void _authData; // Used for CBOR parsing in production
  
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

// ============================================================================
// Default Export
// ============================================================================

export default VeridexClient;
