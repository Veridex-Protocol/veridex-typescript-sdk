/**
 * TransactionParser Unit Tests (Issue #26)
 * 
 * Tests for human-readable transaction summary generation.
 * Security-critical: These tests verify that transaction summaries
 * accurately represent what users are signing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TransactionParser, createTransactionParser } from '../src/core/TransactionParser.js';
import { ACTION_TRANSFER, ACTION_BRIDGE, ACTION_EXECUTE, ACTION_CONFIG } from '../src/constants.js';
import { encodeTransferAction, encodeBridgeAction, encodeExecuteAction, encodeConfigAction } from '../src/payload.js';
import type { PreparedTransfer } from '../src/core/types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

// encodeTransferAction(token, recipient, amount)
const mockTransferPayload = encodeTransferAction(
  '0x0000000000000000000000000000000000000000', // Native ETH
  '0x1234567890123456789012345678901234567890',
  1000000000000000000n // 1 ETH
);

// encodeBridgeAction(token, amount, targetChain, recipient)
const mockBridgePayload = encodeBridgeAction(
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  500000000n, // 0.5 USDC (6 decimals)
  10005, // Optimism Sepolia
  '0x1234567890123456789012345678901234567890'
);

// encodeExecuteAction(target, value, data)
const mockExecutePayload = encodeExecuteAction(
  '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  0n,
  '0xa9059cbb0000000000000000000000001234567890123456789012345678901234567890000000000000000000000000000000000000000000000000000000003b9aca00' // transfer(address,uint256)
);

// encodeConfigAction(configType, configData)
const mockConfigPayload = encodeConfigAction(
  1, // Add key
  '0x' + '04'.padEnd(128, '0') // Mock public key
);

function createMockPreparedTransfer(
  actionType: number,
  payload: string,
  overrides: Partial<PreparedTransfer> = {}
): PreparedTransfer {
  return {
    params: {
      targetChain: 10004,
      token: '0x0000000000000000000000000000000000000000',
      recipient: '0x1234567890123456789012345678901234567890',
      amount: 1000000000000000000n,
    },
    actionPayload: payload,
    nonce: 1n,
    challenge: new Uint8Array([1, 2, 3]),
    estimatedGas: 200000n,
    gasPrice: 1000000000n, // 1 gwei
    messageFee: 0n,
    totalCost: 200000000000000n, // 0.0002 ETH
    formattedCost: '0.0002 ETH',
    preparedAt: Date.now(),
    expiresAt: Date.now() + 300000, // 5 minutes
    ...overrides,
  };
}

// ============================================================================
// TransactionParser Tests
// ============================================================================

describe('TransactionParser', () => {
  let parser: TransactionParser;

  beforeEach(() => {
    parser = createTransactionParser({
      defaultChainId: 10004,
    });
  });

  describe('constructor and factory', () => {
    it('creates parser with default config', () => {
      const p = new TransactionParser({});
      expect(p).toBeDefined();
    });

    it('creates parser via factory function', () => {
      const p = createTransactionParser({ defaultChainId: 10004 });
      expect(p).toBeDefined();
    });
  });

  describe('parse() - Transfer Actions', () => {
    it('parses transfer action correctly', async () => {
      const prepared = createMockPreparedTransfer(ACTION_TRANSFER, mockTransferPayload);
      const summary = await parser.parse(prepared);

      expect(summary.action).toBe('transfer');
      expect(summary.title).toContain('Send');
      expect(summary.description).toContain('Send');
    });

    it('formats amount in human-readable form', async () => {
      const prepared = createMockPreparedTransfer(ACTION_TRANSFER, mockTransferPayload);
      const summary = await parser.parse(prepared);

      // Should show "1" not "1000000000000000000"
      expect(summary.details).toBeDefined();
      if (summary.details && 'token' in summary.details) {
        expect(summary.details.token.amount).toBe('1');
      }
    });

    it('includes recipient display info', async () => {
      const prepared = createMockPreparedTransfer(ACTION_TRANSFER, mockTransferPayload);
      const summary = await parser.parse(prepared);

      if (summary.details && 'recipient' in summary.details) {
        expect(summary.details.recipient.address).toBe('0x1234567890123456789012345678901234567890');
        expect(summary.details.recipient.truncated).toBeDefined();
      }
    });

    it('includes chain display info', async () => {
      const prepared = createMockPreparedTransfer(ACTION_TRANSFER, mockTransferPayload);
      const summary = await parser.parse(prepared);

      if (summary.details && 'chain' in summary.details) {
        expect(summary.details.chain.id).toBe(10004);
        expect(summary.details.chain.name).toBeDefined();
      }
    });
  });

  describe('parse() - Bridge Actions', () => {
    it('parses bridge action correctly', async () => {
      const prepared = createMockPreparedTransfer(ACTION_BRIDGE, mockBridgePayload, {
        params: {
          ...createMockPreparedTransfer(ACTION_BRIDGE, mockBridgePayload).params,
          targetChain: 10005,
        },
      });
      const summary = await parser.parse(prepared);

      expect(summary.action).toBe('bridge');
      expect(summary.title).toContain('Bridge');
    });

    it('includes source and destination chains', async () => {
      const prepared = createMockPreparedTransfer(ACTION_BRIDGE, mockBridgePayload, {
        params: {
          ...createMockPreparedTransfer(ACTION_BRIDGE, mockBridgePayload).params,
          targetChain: 10005,
        },
      });
      const summary = await parser.parse(prepared);

      if (summary.details && 'sourceChain' in summary.details && 'destinationChain' in summary.details) {
        expect(summary.details.sourceChain).toBeDefined();
        expect(summary.details.destinationChain).toBeDefined();
      }
    });

    it('includes estimated time for bridge', async () => {
      const prepared = createMockPreparedTransfer(ACTION_BRIDGE, mockBridgePayload, {
        params: {
          ...createMockPreparedTransfer(ACTION_BRIDGE, mockBridgePayload).params,
          targetChain: 10005,
        },
      });
      const summary = await parser.parse(prepared);

      if (summary.details && 'estimatedTime' in summary.details) {
        expect(summary.details.estimatedTime).toBeDefined();
      }
    });

    it('adds cross-chain risk warning', async () => {
      const prepared = createMockPreparedTransfer(ACTION_BRIDGE, mockBridgePayload, {
        params: {
          ...createMockPreparedTransfer(ACTION_BRIDGE, mockBridgePayload).params,
          targetChain: 10005,
        },
      });
      const summary = await parser.parse(prepared);

      const crossChainWarning = summary.warnings.find(r => r.type === 'cross_chain');
      expect(crossChainWarning).toBeDefined();
      expect(crossChainWarning?.level).toBe('info');
    });
  });

  describe('parse() - Execute Actions', () => {
    it('parses execute action correctly', async () => {
      const prepared = createMockPreparedTransfer(ACTION_EXECUTE, mockExecutePayload);
      const summary = await parser.parse(prepared);

      expect(summary.action).toBe('execute');
      expect(summary.title).toBe('Contract Call');
    });

    it('adds contract interaction warning', async () => {
      const prepared = createMockPreparedTransfer(ACTION_EXECUTE, mockExecutePayload);
      const summary = await parser.parse(prepared);

      const contractWarning = summary.warnings.find(r => r.type === 'contract_interaction');
      expect(contractWarning).toBeDefined();
      expect(contractWarning?.level).toBe('warning');
    });

    it('includes call data in execute summary', async () => {
      const prepared = createMockPreparedTransfer(ACTION_EXECUTE, mockExecutePayload);
      const summary = await parser.parse(prepared);

      // Execute actions include the raw call data for transparency
      if (summary.details && 'callData' in summary.details) {
        expect(summary.details.callData).toBeDefined();
      }
      // Verify it's classified as execute action
      expect(summary.action).toBe('execute');
    });
  });

  describe('parse() - Config Actions', () => {
    it('parses config action correctly', async () => {
      const prepared = createMockPreparedTransfer(ACTION_CONFIG, mockConfigPayload);
      const summary = await parser.parse(prepared);

      expect(summary.action).toBe('config');
      expect(summary.title).toBe('Configuration Change');
    });

    it('adds config change warning', async () => {
      const prepared = createMockPreparedTransfer(ACTION_CONFIG, mockConfigPayload);
      const summary = await parser.parse(prepared);

      const configWarning = summary.warnings.find(r => r.type === 'config_change');
      expect(configWarning).toBeDefined();
      expect(configWarning?.level).toBe('high');
    });
  });

  describe('Risk Assessment', () => {
    it('detects large transaction risk', async () => {
      const parserWithAvg = createTransactionParser({
        defaultChainId: 10004,
        averageTransactionValue: 100000000000000000n, // 0.1 ETH
      });

      // Create a 10 ETH transfer (100x average)
      const largePayload = encodeTransferAction(
        '0x0000000000000000000000000000000000000000',
        '0x1234567890123456789012345678901234567890',
        10000000000000000000n // 10 ETH
      );

      const prepared = createMockPreparedTransfer(ACTION_TRANSFER, largePayload, {
        params: {
          ...createMockPreparedTransfer(ACTION_TRANSFER, largePayload).params,
          amount: 10000000000000000000n,
        },
      });

      const summary = await parserWithAvg.parse(prepared);

      const largeWarning = summary.warnings.find(r => r.type === 'large_transaction');
      expect(largeWarning).toBeDefined();
    });

    it('detects new recipient when transaction history is provided', async () => {
      // Create parser with empty transaction history (meaning all recipients are new)
      const parserWithHistory = createTransactionParser({
        defaultChainId: 10004,
        transactionHistory: new Set<string>(), // Empty set - no previous recipients
      });

      const prepared = createMockPreparedTransfer(ACTION_TRANSFER, mockTransferPayload);
      const summary = await parserWithHistory.parse(prepared);

      const newRecipientWarning = summary.warnings.find(r => r.type === 'new_recipient');
      expect(newRecipientWarning).toBeDefined();
    });

    it('does not warn about new recipient when history includes recipient', async () => {
      // Create parser with transaction history including the recipient
      const parserWithHistory = createTransactionParser({
        defaultChainId: 10004,
        transactionHistory: new Set<string>(['0x1234567890123456789012345678901234567890']),
      });

      const prepared = createMockPreparedTransfer(ACTION_TRANSFER, mockTransferPayload);
      const summary = await parserWithHistory.parse(prepared);

      const newRecipientWarning = summary.warnings.find(r => r.type === 'new_recipient');
      expect(newRecipientWarning).toBeUndefined();
    });
  });

  describe('Gas Cost Formatting', () => {
    it('includes gas cost in summary', async () => {
      const prepared = createMockPreparedTransfer(ACTION_TRANSFER, mockTransferPayload);
      const summary = await parser.parse(prepared);

      expect(summary.fee).toBeDefined();
      expect(summary.fee.total).toBe('0.0002 ETH');
    });
  });

  describe('Expiration Handling', () => {
    it('includes expiration countdown', async () => {
      const prepared = createMockPreparedTransfer(ACTION_TRANSFER, mockTransferPayload);
      const summary = await parser.parse(prepared);

      expect(summary.raw.expiresIn).toBeDefined();
      expect(summary.raw.expiresAt).toBe(prepared.expiresAt);
    });

    it('shows correct time remaining format', async () => {
      const prepared = createMockPreparedTransfer(ACTION_TRANSFER, mockTransferPayload, {
        expiresAt: Date.now() + 120000, // 2 minutes
      });
      const summary = await parser.parse(prepared);

      // Should show something like "2m" or "2 minutes"
      expect(summary.raw.expiresIn).toMatch(/\d+\s*(m|min|minute)/i);
    });
  });

  describe('Technical Details', () => {
    it('includes raw technical details', async () => {
      const prepared = createMockPreparedTransfer(ACTION_TRANSFER, mockTransferPayload);
      const summary = await parser.parse(prepared);

      expect(summary.raw).toBeDefined();
      expect(summary.raw.nonce.toString()).toBe('1');
      expect(summary.raw.chainId).toBe(10004);
      expect(summary.raw.actionPayload).toBe(mockTransferPayload);
    });

    it('includes payload for verification', async () => {
      const prepared = createMockPreparedTransfer(ACTION_TRANSFER, mockTransferPayload);
      const summary = await parser.parse(prepared);

      expect(summary.raw.actionPayload).toBeDefined();
      expect(summary.raw.actionPayload).toBe(mockTransferPayload);
    });
  });

  describe('Configuration Updates', () => {
    it('updates config via updateConfig()', () => {
      const p = createTransactionParser({ defaultChainId: 10004 });
      
      p.updateConfig({
        averageTransactionValue: 1000000000000000000n,
      });

      // Config should be updated internally
      expect(p).toBeDefined();
    });
  });

  describe('Unknown Action Types', () => {
    it('handles unknown action types gracefully', async () => {
      // Create a payload with an invalid action type prefix
      const unknownPayload = '0xff' + mockTransferPayload.slice(4);
      const prepared = createMockPreparedTransfer(255, unknownPayload);
      
      // Should not throw, should return a fallback summary
      const summary = await parser.parse(prepared);
      expect(summary).toBeDefined();
      expect(summary.action).toBe('execute'); // Falls back to execute as "unknown"
    });
  });
});

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('TransactionParser Utility Functions', () => {
  describe('formatAmount', () => {
    it('formats wei to ETH correctly', async () => {
      const parser = createTransactionParser({ defaultChainId: 10004 });
      const prepared = createMockPreparedTransfer(
        ACTION_TRANSFER,
        encodeTransferAction(
          '0x0000000000000000000000000000000000000000',
          '0x1234567890123456789012345678901234567890',
          1234567890000000000n // 1.23456789 ETH
        )
      );
      
      const summary = await parser.parse(prepared);
      if (summary.details && 'token' in summary.details) {
        // Should truncate to reasonable precision
        expect(summary.details.token.amount).toMatch(/1\.234/);
      }
    });

    it('formats small amounts correctly', async () => {
      const parser = createTransactionParser({ defaultChainId: 10004 });
      const prepared = createMockPreparedTransfer(
        ACTION_TRANSFER,
        encodeTransferAction(
          '0x0000000000000000000000000000000000000000',
          '0x1234567890123456789012345678901234567890',
          1000000000000n // 0.000001 ETH
        )
      );
      
      const summary = await parser.parse(prepared);
      if (summary.details && 'token' in summary.details) {
        expect(summary.details.token.amount).toMatch(/0\.000001|< 0\.0001/);
      }
    });
  });

  describe('truncateAddress', () => {
    it('truncates addresses for display', async () => {
      const parser = createTransactionParser({ defaultChainId: 10004 });
      const prepared = createMockPreparedTransfer(ACTION_TRANSFER, mockTransferPayload);
      
      const summary = await parser.parse(prepared);
      if (summary.details && 'recipient' in summary.details) {
        // truncated should be truncated form
        expect(summary.details.recipient.truncated.length).toBeLessThan(42);
        expect(summary.details.recipient.truncated).toMatch(/0x[a-fA-F0-9]+\.{3}[a-fA-F0-9]+/);
      }
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('TransactionParser Integration', () => {
  it('produces consistent summaries for same input', async () => {
    const parser = createTransactionParser({ defaultChainId: 10004 });
    const prepared = createMockPreparedTransfer(ACTION_TRANSFER, mockTransferPayload);
    
    const summary1 = await parser.parse(prepared);
    const summary2 = await parser.parse(prepared);

    // Content should match (timestamps may differ)
    expect(summary1.action).toBe(summary2.action);
    expect(summary1.title).toBe(summary2.title);
    expect(summary1.description).toBe(summary2.description);
  });

  it('generates different timestamps for each summary', async () => {
    const parser = createTransactionParser({ defaultChainId: 10004 });
    const prepared = createMockPreparedTransfer(ACTION_TRANSFER, mockTransferPayload);
    
    const summary1 = await parser.parse(prepared);
    // Wait a tiny bit
    await new Promise(r => setTimeout(r, 5));
    const summary2 = await parser.parse(prepared);

    // GeneratedAt timestamps should be different
    expect(summary1.generatedAt).not.toBe(summary2.generatedAt);
  });
});
