# Architecture Overhaul TODO: Core SDK & Smart Contracts

**Date:** February 26, 2026
**Target:** `@veridex/sdk` and `packages/contracts`
**Phase:** Q1 2026 Pivot

To implement the Enterprise Risk Pivot (Trace Logging & Pre-Transaction Assessment), the core SDK and smart contracts require significant updates.

## 1. Smart Contract Integration (`TraceHash`)
*   [ ] **Update `VeridexHub` & `VeridexVault`:** The smart contracts must accept an optional `bytes32 traceHash` argument within execution functions (or `executeWithTrace()`). This binds an off-chain trace log to the on-chain execution irrevocably.
*   [ ] **Add Event Emission:** Contracts must emit `TransactionTraced(address indexed agent, bytes32 indexed traceHash)` to allow indexers to build dispute dashboards.
*   [ ] **Extend Data Types:** Update corresponding EVM/Solana SDK interfaces to encode the new `traceHash` parameter.

## 2. Validation Proxy / Middleware
*   [ ] **Update Universal Abstraction Handlers:** Modify `x402`, `UCP`, and `ACP` protocol execution handlers in the SDK to be aware of the "Risk/Trust Firewall." The middleware should act as a proxy intercepting agent payment requests, querying a Validator Network with the `TracePayload`, and rejecting the transaction if the intent is maliciously injected (Trace Hash Risk Score == High).

## 3. The Identity Layer: KYA & ERC-8004
*   [ ] **Create `@veridex/sdk/kya` Submodule:** Build the "Know Your Agent" client. Agents must establish verified metadata against an ERC-8004 on-chain registry before routing logic will authorize a transaction.
*   [ ] **Reputation Integration:** Surface the "Veridex Trust Score" (historical success rate vs. disputes) as part of the SDK's metadata returned from `verifyAgent(address)`.

## 4. Documentation & Examples
*   [ ] Update Quickstart guides with a simulated high-risk/prompt-injection attempt that gets blocked by the new "Risk Firewall."
*   [ ] Diagram the difference between "Execution Failure" (Session Key limits exceeded) vs "Trust Failure" (Trace Log intent does not match the Mandate).
