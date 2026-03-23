import { describe, it, expect } from 'vitest';
import {
    VeridexError,
    VeridexErrorCode,
    normalizeError,
} from '../src/core/VeridexError.js';

// ============================================================================
// VeridexError class
// ============================================================================

describe('VeridexError', () => {
    it('creates error with code and default message', () => {
        const err = new VeridexError(VeridexErrorCode.NO_CREDENTIAL);
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(VeridexError);
        expect(err.name).toBe('VeridexError');
        expect(err.code).toBe('NO_CREDENTIAL');
        expect(err.message).toContain('No credential set');
    });

    it('accepts custom message', () => {
        const err = new VeridexError(VeridexErrorCode.RPC_ERROR, 'custom msg');
        expect(err.message).toBe('custom msg');
        expect(err.code).toBe('RPC_ERROR');
    });

    it('preserves chain and cause', () => {
        const cause = new Error('eth call reverted');
        const err = new VeridexError(VeridexErrorCode.INSUFFICIENT_FUNDS, undefined, {
            chain: 'base',
            cause,
        });
        expect(err.chain).toBe('base');
        expect(err.cause).toBe(cause);
    });

    it('marks RPC_ERROR, TIMEOUT, RELAYER_ERROR as retryable by default', () => {
        expect(new VeridexError(VeridexErrorCode.RPC_ERROR).retryable).toBe(true);
        expect(new VeridexError(VeridexErrorCode.TIMEOUT).retryable).toBe(true);
        expect(new VeridexError(VeridexErrorCode.RELAYER_ERROR).retryable).toBe(true);
    });

    it('marks non-transient codes as not retryable by default', () => {
        expect(new VeridexError(VeridexErrorCode.NO_CREDENTIAL).retryable).toBe(false);
        expect(new VeridexError(VeridexErrorCode.UNAUTHORIZED).retryable).toBe(false);
        expect(new VeridexError(VeridexErrorCode.INSUFFICIENT_FUNDS).retryable).toBe(false);
        expect(new VeridexError(VeridexErrorCode.VAULT_NOT_FOUND).retryable).toBe(false);
    });

    it('allows overriding retryable', () => {
        const err = new VeridexError(VeridexErrorCode.INSUFFICIENT_FUNDS, undefined, {
            retryable: true,
        });
        expect(err.retryable).toBe(true);
    });

    it('has correct name for stack traces', () => {
        const err = new VeridexError(VeridexErrorCode.UNKNOWN);
        expect(err.stack).toContain('VeridexError');
    });

    describe('every VeridexErrorCode has a default message', () => {
        const codes = Object.values(VeridexErrorCode);
        for (const code of codes) {
            it(`${code} has a non-empty default message`, () => {
                const err = new VeridexError(code);
                expect(err.message.length).toBeGreaterThan(0);
            });
        }
    });
});

// ============================================================================
// normalizeError
// ============================================================================

describe('normalizeError', () => {
    it('returns VeridexError unchanged', () => {
        const original = new VeridexError(VeridexErrorCode.VAULT_PAUSED);
        const result = normalizeError(original);
        expect(result).toBe(original);
    });

    it('wraps plain string as UNKNOWN', () => {
        const result = normalizeError('something broke');
        expect(result).toBeInstanceOf(VeridexError);
        expect(result.code).toBe(VeridexErrorCode.UNKNOWN);
        expect(result.message).toBe('something broke');
    });

    it('wraps non-Error object as UNKNOWN', () => {
        const result = normalizeError(42);
        expect(result).toBeInstanceOf(VeridexError);
        expect(result.code).toBe(VeridexErrorCode.UNKNOWN);
    });

    // --- EVM patterns ---

    it('maps "insufficient funds" to INSUFFICIENT_FUNDS', () => {
        const result = normalizeError(new Error('insufficient funds for gas'));
        expect(result.code).toBe(VeridexErrorCode.INSUFFICIENT_FUNDS);
    });

    it('maps "execution reverted...paused" to VAULT_PAUSED', () => {
        const result = normalizeError(new Error('execution reverted: contract is paused'));
        expect(result.code).toBe(VeridexErrorCode.VAULT_PAUSED);
    });

    it('maps "execution reverted...unauthorized" to UNAUTHORIZED', () => {
        const result = normalizeError(new Error('execution reverted: unauthorized caller'));
        expect(result.code).toBe(VeridexErrorCode.UNAUTHORIZED);
    });

    it('maps "not owner" to UNAUTHORIZED', () => {
        const result = normalizeError(new Error('execution reverted: not owner'));
        expect(result.code).toBe(VeridexErrorCode.UNAUTHORIZED);
    });

    it('maps "daily limit" to DAILY_LIMIT_EXCEEDED', () => {
        const result = normalizeError(new Error('daily limit exceeded'));
        expect(result.code).toBe(VeridexErrorCode.DAILY_LIMIT_EXCEEDED);
    });

    it('maps "nonce expired" to EXPIRED', () => {
        const result = normalizeError(new Error('nonce expired'));
        expect(result.code).toBe(VeridexErrorCode.EXPIRED);
    });

    it('maps "nonce too low" to EXPIRED', () => {
        const result = normalizeError(new Error('nonce too low'));
        expect(result.code).toBe(VeridexErrorCode.EXPIRED);
    });

    it('maps "already processed" to VAA_ALREADY_PROCESSED', () => {
        const result = normalizeError(new Error('message already processed'));
        expect(result.code).toBe(VeridexErrorCode.VAA_ALREADY_PROCESSED);
    });

    it('maps "invalid signature" to INVALID_SIGNATURE', () => {
        const result = normalizeError(new Error('invalid signature / ECDSA'));
        expect(result.code).toBe(VeridexErrorCode.INVALID_SIGNATURE);
    });

    it('maps "timeout" / "ETIMEDOUT" to TIMEOUT', () => {
        expect(normalizeError(new Error('request timeout')).code).toBe(VeridexErrorCode.TIMEOUT);
        expect(normalizeError(new Error('ETIMEDOUT')).code).toBe(VeridexErrorCode.TIMEOUT);
        expect(normalizeError(new Error('ECONNREFUSED')).code).toBe(VeridexErrorCode.TIMEOUT);
    });

    it('maps "could not detect network" to RPC_ERROR', () => {
        const result = normalizeError(new Error('could not detect network'));
        expect(result.code).toBe(VeridexErrorCode.RPC_ERROR);
    });

    it('maps "failed to fetch" to RPC_ERROR', () => {
        const result = normalizeError(new Error('failed to fetch'));
        expect(result.code).toBe(VeridexErrorCode.RPC_ERROR);
    });

    // --- Solana / Anchor program errors ---

    it('maps Solana custom program error 0x1770 (6000) to PROTOCOL_PAUSED', () => {
        const result = normalizeError(new Error('custom program error: 0x1770'));
        expect(result.code).toBe(VeridexErrorCode.PROTOCOL_PAUSED);
        expect(result.chain).toBe('solana');
    });

    it('maps Solana error 6001 to VAULT_PAUSED', () => {
        const result = normalizeError(new Error('custom program error: 0x1771'));
        expect(result.code).toBe(VeridexErrorCode.VAULT_PAUSED);
    });

    it('maps Solana error 6011 to INSUFFICIENT_FUNDS', () => {
        const result = normalizeError(new Error('custom program error: 0x177b'));
        expect(result.code).toBe(VeridexErrorCode.INSUFFICIENT_FUNDS);
    });

    it('maps Solana error 6005 to UNAUTHORIZED', () => {
        const result = normalizeError(new Error('custom program error: 0x1775'));
        expect(result.code).toBe(VeridexErrorCode.UNAUTHORIZED);
    });

    it('maps Anchor Error Number format', () => {
        const result = normalizeError(
            new Error('Error Code: SomeError. Error Number: 6002'),
        );
        expect(result.code).toBe(VeridexErrorCode.VAA_ALREADY_PROCESSED);
    });

    // --- Stacks Clarity errors ---

    it('maps Clarity (err u100) to UNAUTHORIZED', () => {
        const result = normalizeError(new Error('(err u100)'));
        expect(result.code).toBe(VeridexErrorCode.UNAUTHORIZED);
        expect(result.chain).toBe('stacks');
    });

    it('maps Clarity (err u103) to INSUFFICIENT_FUNDS', () => {
        const result = normalizeError(new Error('(err u103)'));
        expect(result.code).toBe(VeridexErrorCode.INSUFFICIENT_FUNDS);
    });

    it('maps Clarity (err u104) to DAILY_LIMIT_EXCEEDED', () => {
        const result = normalizeError(new Error('(err u104)'));
        expect(result.code).toBe(VeridexErrorCode.DAILY_LIMIT_EXCEEDED);
    });

    it('maps Clarity (err u200) to VAA_ALREADY_PROCESSED', () => {
        const result = normalizeError(new Error('(err u200)'));
        expect(result.code).toBe(VeridexErrorCode.VAA_ALREADY_PROCESSED);
    });

    it('maps Clarity (err u201) to INVALID_VAA', () => {
        const result = normalizeError(new Error('(err u201)'));
        expect(result.code).toBe(VeridexErrorCode.INVALID_VAA);
    });

    // --- Starknet patterns ---

    it('maps Starknet "insufficient balance" to INSUFFICIENT_FUNDS', () => {
        const result = normalizeError(
            new Error('starknet felt conversion: insufficient balance'),
            'starknet',
        );
        expect(result.code).toBe(VeridexErrorCode.INSUFFICIENT_FUNDS);
        expect(result.chain).toBe('starknet');
    });

    it('maps Starknet "PAUSED" to VAULT_PAUSED', () => {
        const result = normalizeError(new Error('cairo error: PAUSED'), 'starknet');
        expect(result.code).toBe(VeridexErrorCode.VAULT_PAUSED);
    });

    it('maps Starknet "not authorized" to UNAUTHORIZED', () => {
        const result = normalizeError(new Error('not authorized'), 'starknet');
        expect(result.code).toBe(VeridexErrorCode.UNAUTHORIZED);
    });

    // --- ethers-specific error codes ---

    it('maps ethers INSUFFICIENT_FUNDS code', () => {
        const err: any = new Error('insufficient funds');
        err.code = 'INSUFFICIENT_FUNDS';
        const result = normalizeError(err);
        expect(result.code).toBe(VeridexErrorCode.INSUFFICIENT_FUNDS);
    });

    it('maps ethers CALL_EXCEPTION to RPC_ERROR', () => {
        const err: any = new Error('call reverted');
        err.code = 'CALL_EXCEPTION';
        const result = normalizeError(err);
        expect(result.code).toBe(VeridexErrorCode.RPC_ERROR);
    });

    it('maps ethers NETWORK_ERROR to RPC_ERROR (retryable)', () => {
        const err: any = new Error('network error');
        err.code = 'NETWORK_ERROR';
        const result = normalizeError(err);
        expect(result.code).toBe(VeridexErrorCode.RPC_ERROR);
        expect(result.retryable).toBe(true);
    });

    it('maps ethers TIMEOUT to TIMEOUT (retryable)', () => {
        const err: any = new Error('operation timed out');
        err.code = 'TIMEOUT';
        const result = normalizeError(err);
        expect(result.code).toBe(VeridexErrorCode.TIMEOUT);
        expect(result.retryable).toBe(true);
    });

    // --- Chain context preservation ---

    it('preserves chain when provided', () => {
        const result = normalizeError(new Error('insufficient funds'), 'optimism');
        expect(result.chain).toBe('optimism');
    });

    it('preserves original error as cause', () => {
        const original = new Error('RPC failed');
        const result = normalizeError(original);
        expect(result.cause).toBe(original);
    });

    it('falls back to UNKNOWN for unrecognized errors', () => {
        const result = normalizeError(new Error('something completely unexpected'));
        expect(result.code).toBe(VeridexErrorCode.UNKNOWN);
    });
});
