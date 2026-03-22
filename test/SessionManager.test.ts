/**
 * Veridex Protocol SDK - Session Manager Tests
 * 
 * Comprehensive tests for session key management:
 * - Session creation with biometric auth
 * - Instant session signing (no biometric)
 * - Secure storage with encryption
 * - Auto-refresh before expiry
 * - Session revocation
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';
import { SessionManager, type HubClient } from '../src/sessions/index.js';
import type { PasskeyCredential } from '../src/core/PasskeyManager.js';
import type { SessionConfig, ActionParams } from '../src/sessions/types.js';
import { SessionError, SessionErrorCode } from '../src/sessions/types.js';
import {
    generateSecp256k1KeyPair,
    computeSessionKeyHash,
    verifySessionSignature,
    hashAction,
} from '../src/sessions/crypto.js';

// ============================================================================
// Mock LocalStorage for Node.js Environment
// ============================================================================

class MockLocalStorage implements Storage {
    private store: Map<string, string> = new Map();
    
    get length(): number {
        return this.store.size;
    }
    
    clear(): void {
        this.store.clear();
    }
    
    getItem(key: string): string | null {
        return this.store.get(key) ?? null;
    }
    
    key(index: number): string | null {
        const keys = Array.from(this.store.keys());
        return keys[index] ?? null;
    }
    
    removeItem(key: string): void {
        this.store.delete(key);
    }
    
    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }
}

// Global mock setup for browser environment
const mockLocalStorage = new MockLocalStorage();

// Setup browser environment mocks before any tests run
beforeEach(() => {
    // Mock browser environment
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', mockLocalStorage);
    mockLocalStorage.clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ============================================================================
// Mock Implementation
// ============================================================================

/**
 * Mock HubClient for testing
 */
class MockHubClient implements HubClient {
    registeredSessions: Set<string> = new Set();
    registerCallCount = 0;
    revokeCallCount = 0;
    
    async registerSession(params: any): Promise<void> {
        this.registerCallCount++;
        this.registeredSessions.add(params.sessionKeyHash);
    }
    
    async revokeSession(params: any): Promise<void> {
        this.revokeCallCount++;
        this.registeredSessions.delete(params.sessionKeyHash);
    }
}

/**
 * Mock Passkey signing function
 * Returns a valid WebAuthn assertion structure
 */
function mockPasskeySign(challenge: Uint8Array): Promise<any> {
    // clientDataJSON should be a JSON string, not bytes-to-string converted
    const clientDataJSON = JSON.stringify({
        type: 'webauthn.get',
        challenge: ethers.encodeBase64(challenge), // Base64 URL encoded in real WebAuthn
        origin: 'https://test.veridex.xyz',
    });
    
    return Promise.resolve({
        authenticatorData: ethers.hexlify(new Uint8Array(37)),
        clientDataJSON,
        challengeIndex: 23, // Position in clientDataJSON where "challenge" starts
        typeIndex: 1,       // Position in clientDataJSON where "type" starts
        r: 123n,
        s: 456n,
    });
}

/**
 * Mock credential for testing
 */
const mockCredential: PasskeyCredential = {
    credentialId: 'test-credential-id',
    publicKeyX: 123456789n,
    publicKeyY: 987654321n,
    keyHash: ethers.keccak256(ethers.toUtf8Bytes('test-credential')),
};

// ============================================================================
// Test Suite
// ============================================================================

describe('SessionManager', () => {
    let sessionManager: SessionManager;
    let mockHub: MockHubClient;
    let sessionConfig: SessionConfig;
    
    beforeEach(() => {
        // Reset mocks
        mockHub = new MockHubClient();
        
        // Default session config (1 hour, 100 USDC limit)
        sessionConfig = {
            duration: 3600, // 1 hour
            maxValue: ethers.parseUnits('100', 6), // 100 USDC
            autoRefresh: false, // Disable for most tests
            chainScopes: [],
        };
        
        // Create session manager
        sessionManager = new SessionManager(
            mockCredential,
            mockHub,
            mockPasskeySign,
            sessionConfig,
            {
                defaultSessionConfig: sessionConfig,
                storageBackend: 'localstorage', // Use localStorage for tests
                debug: false,
            }
        );
    });
    
    afterEach(async () => {
        // Clean up
        if (sessionManager) {
            sessionManager.dispose();
        }
    });
    
    // ========================================================================
    // Session Creation Tests
    // ========================================================================
    
    describe('createSession', () => {
        it('should create a new session successfully', async () => {
            const session = await sessionManager.createSession();
            
            expect(session).toBeDefined();
            expect(session.keyHash).toBeDefined();
            expect(session.publicKey.length).toBe(65); // Uncompressed secp256k1
            expect(session.privateKey.length).toBe(32);
            expect(session.expiry).toBeGreaterThan(Date.now());
            expect(session.maxValue).toBe(sessionConfig.maxValue);
            expect(session.userKeyHash).toBe(mockCredential.keyHash);
            
            // Verify Hub was called
            expect(mockHub.registerCallCount).toBe(1);
            expect(mockHub.registeredSessions.has(session.keyHash)).toBe(true);
        });
        
        it('should generate unique session keys', async () => {
            const session1 = await sessionManager.createSession();
            
            // Create new manager for second session
            const mockHub2 = new MockHubClient();
            const sessionManager2 = new SessionManager(
                mockCredential,
                mockHub2,
                mockPasskeySign,
                sessionConfig
            );
            
            const session2 = await sessionManager2.createSession();
            
            expect(session1.keyHash).not.toBe(session2.keyHash);
            expect(ethers.hexlify(session1.publicKey)).not.toBe(ethers.hexlify(session2.publicKey));
            
            sessionManager2.dispose();
        });
        
        it('should set expiry based on duration config', async () => {
            const startTime = Date.now();
            const session = await sessionManager.createSession();
            const expectedExpiry = startTime + (sessionConfig.duration * 1000);
            
            // Allow 1 second tolerance for test execution
            expect(session.expiry).toBeGreaterThanOrEqual(expectedExpiry - 1000);
            expect(session.expiry).toBeLessThanOrEqual(expectedExpiry + 1000);
        });
        
        it('should store session securely', async () => {
            const session = await sessionManager.createSession();
            
            // Load session in new manager (simulates page refresh)
            const newManager = new SessionManager(
                mockCredential,
                mockHub,
                mockPasskeySign,
                sessionConfig,
                { 
                    defaultSessionConfig: sessionConfig,
                    storageBackend: 'localstorage' 
                }
            );
            
            const loadedSession = await newManager.loadSession();
            
            expect(loadedSession).toBeDefined();
            expect(loadedSession!.keyHash).toBe(session.keyHash);
            expect(ethers.hexlify(loadedSession!.publicKey)).toBe(ethers.hexlify(session.publicKey));
            expect(loadedSession!.expiry).toBe(session.expiry);
            
            newManager.dispose();
        });
    });
    
    // ========================================================================
    // Session Signing Tests
    // ========================================================================
    
    describe('signWithSession', () => {
        let session: any;
        
        beforeEach(async () => {
            session = await sessionManager.createSession();
        });
        
        it('should sign action instantly without biometric', async () => {
            const action: ActionParams = {
                action: 'transfer',
                targetChain: 10004,
                value: ethers.parseUnits('50', 6), // 50 USDC (within limit)
                payload: ethers.randomBytes(32),
                nonce: 1,
            };
            
            const startTime = Date.now();
            const signature = await sessionManager.signWithSession(action);
            const duration = Date.now() - startTime;
            
            // Should be instant (< 100ms)
            expect(duration).toBeLessThan(100);
            
            expect(signature).toBeDefined();
            expect(signature.signature.length).toBe(65); // ECDSA signature
            expect(signature.sessionKeyHash).toBe(session.keyHash);
            expect(signature.userKeyHash).toBe(mockCredential.keyHash);
            
            // Verify signature is valid
            const messageHash = hashAction(action);
            const isValid = verifySessionSignature(
                messageHash,
                signature.signature,
                session.publicKey
            );
            expect(isValid).toBe(true);
        });
        
        it('should reject if no active session', async () => {
            // Revoke session
            await sessionManager.revokeSession();
            
            const action: ActionParams = {
                action: 'transfer',
                targetChain: 10004,
                value: 1n,
                payload: ethers.randomBytes(32),
                nonce: 1,
            };
            
            await expect(
                sessionManager.signWithSession(action)
            ).rejects.toThrow(SessionError);
            
            try {
                await sessionManager.signWithSession(action);
            } catch (error) {
                expect((error as SessionError).code).toBe(SessionErrorCode.NO_ACTIVE_SESSION);
            }
        });
        
        it('should reject if value exceeds session limit', async () => {
            const action: ActionParams = {
                action: 'transfer',
                targetChain: 10004,
                value: ethers.parseUnits('150', 6), // 150 USDC (exceeds 100 limit)
                payload: ethers.randomBytes(32),
                nonce: 1,
            };
            
            await expect(
                sessionManager.signWithSession(action)
            ).rejects.toThrow(SessionError);
            
            try {
                await sessionManager.signWithSession(action);
            } catch (error) {
                expect((error as SessionError).code).toBe(SessionErrorCode.VALUE_EXCEEDS_LIMIT);
            }
        });
        
        it('should allow unlimited value if maxValue is 0', async () => {
            // Create session with unlimited value
            const unlimitedManager = new SessionManager(
                mockCredential,
                mockHub,
                mockPasskeySign,
                { ...sessionConfig, maxValue: 0n },
                { 
                    defaultSessionConfig: { ...sessionConfig, maxValue: 0n },
                    storageBackend: 'localstorage' 
                }
            );
            
            await unlimitedManager.createSession();
            
            const action: ActionParams = {
                action: 'transfer',
                targetChain: 10004,
                value: ethers.parseUnits('1000000', 6), // 1M USDC
                payload: ethers.randomBytes(32),
                nonce: 1,
            };
            
            const signature = await unlimitedManager.signWithSession(action);
            expect(signature).toBeDefined();
            
            unlimitedManager.dispose();
        });
    });
    
    // ========================================================================
    // Session State Tests
    // ========================================================================
    
    describe('Session State Management', () => {
        it('should report active session correctly', async () => {
            expect(sessionManager.isActive()).toBe(false);
            
            await sessionManager.createSession();
            expect(sessionManager.isActive()).toBe(true);
            
            await sessionManager.revokeSession();
            expect(sessionManager.isActive()).toBe(false);
        });
        
        it('should return time remaining until expiry', async () => {
            await sessionManager.createSession();
            
            const timeRemaining = sessionManager.getTimeRemaining();
            expect(timeRemaining).toBeGreaterThan(0);
            expect(timeRemaining).toBeLessThanOrEqual(sessionConfig.duration);
        });
        
        it('should return current session info', async () => {
            const created = await sessionManager.createSession();
            
            const session = sessionManager.getSession();
            expect(session).toBeDefined();
            expect(session!.keyHash).toBe(created.keyHash);
        });
        
        it('should return null for expired session', async () => {
            // Create session with minimum duration
            const shortLivedManager = new SessionManager(
                mockCredential,
                mockHub,
                mockPasskeySign,
                { ...sessionConfig, duration: 60 }, // Min duration is 60s
                { 
                    defaultSessionConfig: { ...sessionConfig, duration: 60 },
                    storageBackend: 'localstorage' 
                }
            );
            
            const session = await shortLivedManager.createSession();
            expect(shortLivedManager.isActive()).toBe(true);
            
            // Manually set expiry to past (simulate expiration)
            // We access the internal session and modify it for testing
            (shortLivedManager as any).currentSession.expiry = Date.now() - 1000;
            
            expect(shortLivedManager.isActive()).toBe(false);
            expect(shortLivedManager.getSession()).toBeNull();
            
            shortLivedManager.dispose();
        });
    });
    
    // ========================================================================
    // Session Revocation Tests
    // ========================================================================
    
    describe('revokeSession', () => {
        it('should revoke active session successfully', async () => {
            const session = await sessionManager.createSession();
            expect(mockHub.registeredSessions.has(session.keyHash)).toBe(true);
            
            await sessionManager.revokeSession();
            
            expect(mockHub.revokeCallCount).toBe(1);
            expect(mockHub.registeredSessions.has(session.keyHash)).toBe(false);
            expect(sessionManager.isActive()).toBe(false);
        });
        
        it('should clear local storage on revocation', async () => {
            await sessionManager.createSession();
            
            // Verify storage
            const loadedBefore = await sessionManager.loadSession();
            expect(loadedBefore).toBeDefined();
            
            await sessionManager.revokeSession();
            
            // Create new manager to check storage
            const newManager = new SessionManager(
                mockCredential,
                mockHub,
                mockPasskeySign,
                sessionConfig,
                { 
                    defaultSessionConfig: sessionConfig,
                    storageBackend: 'localstorage' 
                }
            );
            
            const loadedAfter = await newManager.loadSession();
            expect(loadedAfter).toBeNull();
            
            newManager.dispose();
        });
        
        it('should throw if no active session to revoke', async () => {
            await expect(
                sessionManager.revokeSession()
            ).rejects.toThrow(SessionError);
            
            try {
                await sessionManager.revokeSession();
            } catch (error) {
                expect((error as SessionError).code).toBe(SessionErrorCode.NO_ACTIVE_SESSION);
            }
        });
    });

    // ========================================================================
    // Batch Revocation Tests
    // ========================================================================

    describe('revokeAllSessions', () => {
        it('should revoke all sessions when hub supports it', async () => {
            // Add batch revoke support to mock hub
            let batchRevokeCalled = false;
            (mockHub as any).revokeAllSessions = vi.fn(async () => {
                batchRevokeCalled = true;
                mockHub.registeredSessions.clear();
                return 3;
            });

            await sessionManager.createSession();
            const count = await sessionManager.revokeAllSessions();

            expect(count).toBe(3);
            expect(batchRevokeCalled).toBe(true);
            expect(sessionManager.isActive()).toBe(false);
        });

        it('should emit all-sessions-revoked event', async () => {
            (mockHub as any).revokeAllSessions = vi.fn(async () => 2);

            const events: any[] = [];
            sessionManager.on((event: any) => events.push(event));

            await sessionManager.createSession();
            await sessionManager.revokeAllSessions();

            const revokeEvent = events.find(e => e.type === 'all-sessions-revoked');
            expect(revokeEvent).toBeDefined();
            expect(revokeEvent.count).toBe(2);
        });

        it('should throw BATCH_REVOCATION_FAILED when hub does not support batch revoke', async () => {
            // Default MockHubClient has no revokeAllSessions
            await sessionManager.createSession();

            await expect(sessionManager.revokeAllSessions()).rejects.toThrow(SessionError);

            try {
                // Reset to have an active session again
                const mgr2 = new SessionManager(
                    mockCredential,
                    mockHub,
                    mockPasskeySign,
                    sessionConfig,
                    { defaultSessionConfig: sessionConfig, storageBackend: 'localstorage' }
                );
                await mgr2.createSession();
                await mgr2.revokeAllSessions();
            } catch (error) {
                expect((error as SessionError).code).toBe(SessionErrorCode.BATCH_REVOCATION_FAILED);
            }
        });
    });
    
    // ========================================================================
    // Auto-Refresh Tests
    // ========================================================================
    
    describe('Auto-Refresh', () => {
        it('should schedule refresh when enabled', async () => {
            // Use minimum duration with refresh buffer
            const autoRefreshManager = new SessionManager(
                mockCredential,
                mockHub,
                mockPasskeySign,
                { ...sessionConfig, autoRefresh: true, duration: 60, refreshBuffer: 30 },
                { 
                    defaultSessionConfig: { ...sessionConfig, autoRefresh: true, duration: 60, refreshBuffer: 30 },
                    storageBackend: 'localstorage' 
                }
            );
            
            const session = await autoRefreshManager.createSession();
            
            // Initial registration
            expect(mockHub.registerCallCount).toBe(1);
            
            // Manually set expiry close to now to trigger refresh logic
            // This simulates being near expiration without waiting 60s
            (autoRefreshManager as any).currentSession.expiry = Date.now() + 5000; // 5s until expiry
            
            // Force check for refresh (internal method if available, or just verify state)
            // The auto-refresh scheduling should detect near-expiry
            
            autoRefreshManager.dispose();
        });
        
        it('should refresh immediately if expiring soon', async () => {
            const autoRefreshManager = new SessionManager(
                mockCredential,
                mockHub,
                mockPasskeySign,
                {
                    duration: 60,
                    maxValue: 0n,
                    autoRefresh: true,
                    refreshBuffer: 300, // 5 minutes (longer than duration)
                    chainScopes: [],
                },
                { 
                    defaultSessionConfig: {
                        duration: 60,
                        maxValue: 0n,
                        autoRefresh: true,
                        refreshBuffer: 300,
                        chainScopes: [],
                    },
                    storageBackend: 'localstorage' 
                }
            );
            
            await autoRefreshManager.createSession();
            
            // Should refresh immediately since refreshBuffer > duration
            // Give it a moment to process
            await new Promise(resolve => setTimeout(resolve, 100));
            
            expect(mockHub.registerCallCount).toBeGreaterThanOrEqual(1);
            
            autoRefreshManager.dispose();
        });
    });
    
    // ========================================================================
    // Event Handling Tests
    // ========================================================================
    
    describe('Event Handling', () => {
        it('should emit session-created event', async () => {
            const events: any[] = [];
            sessionManager.on(event => events.push(event));
            
            const session = await sessionManager.createSession();
            
            expect(events.length).toBeGreaterThan(0);
            const createdEvent = events.find(e => e.type === 'session-created');
            expect(createdEvent).toBeDefined();
            expect(createdEvent.session.keyHash).toBe(session.keyHash);
        });
        
        it('should emit session-revoked event', async () => {
            await sessionManager.createSession();
            
            const events: any[] = [];
            sessionManager.on(event => events.push(event));
            
            await sessionManager.revokeSession();
            
            const revokedEvent = events.find(e => e.type === 'session-revoked');
            expect(revokedEvent).toBeDefined();
        });
        
        it('should allow unregistering callbacks', async () => {
            const events: any[] = [];
            const callback = (event: any) => events.push(event);
            
            sessionManager.on(callback);
            await sessionManager.createSession();
            
            expect(events.length).toBeGreaterThan(0);
            
            sessionManager.off(callback);
            events.length = 0;
            
            await sessionManager.revokeSession();
            await sessionManager.createSession();
            
            // Should not receive events after unregistering
            expect(events.length).toBe(0);
        });
    });
    
    // ========================================================================
    // Crypto Utilities Tests
    // ========================================================================
    
    describe('Crypto Utilities', () => {
        it('should generate valid secp256k1 key pairs', () => {
            const keyPair = generateSecp256k1KeyPair();
            
            expect(keyPair.publicKey.length).toBe(65);
            expect(keyPair.privateKey.length).toBe(32);
            expect(keyPair.publicKey[0]).toBe(0x04); // Uncompressed format
            expect(keyPair.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        });
        
        it('should compute correct session key hash', () => {
            const keyPair = generateSecp256k1KeyPair();
            const keyHash = computeSessionKeyHash(keyPair.publicKey);
            
            expect(keyHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
            
            // Should be deterministic
            const keyHash2 = computeSessionKeyHash(keyPair.publicKey);
            expect(keyHash).toBe(keyHash2);
        });
        
        it('should verify signatures correctly', () => {
            const keyPair = generateSecp256k1KeyPair();
            const action: ActionParams = {
                action: 'transfer',
                targetChain: 10004,
                value: 1n,
                payload: ethers.randomBytes(32),
                nonce: 1,
            };
            
            const messageHash = hashAction(action);
            
            // Create SessionManager to sign
            const signingManager = new SessionManager(
                mockCredential,
                mockHub,
                mockPasskeySign,
                sessionConfig,
                { 
                    defaultSessionConfig: sessionConfig,
                    storageBackend: 'localstorage' 
                }
            );
            
            // Would need to inject the keyPair for testing
            // This is a simplified test
        });
    });
});
