# ACARS Security Audit — Event-Based Nostr Architecture

**Date:** 2026-03-02  
**Scope:** All packages (`@acars/core`, `@acars/nostr`, `@acars/store`, `@acars/data`, `apps/web`)  
**Architecture:** Decentralized client-side simulation over Nostr (NIP-33 replaceable events, NIP-07 signing)

---

## Executive Summary

ACARS uses a **fully client-authoritative** architecture: every player's browser runs the complete game simulation and publishes signed Nostr events describing their actions. Peer clients reconstruct each other's state by replaying those action logs through `actionReducer.ts`. There is **no authoritative server** to enforce game rules.

This design gives excellent offline resilience and censorship resistance, but it means **every game rule is enforced only by the honest client's own code**. A modified client (or raw Nostr event injection) can bypass every validation. Below are 11 vulnerability classes ranked by severity, with code-level evidence and actionable mitigations.

---

## CRITICAL — Fixed in this PR

### 1. Balance Checking Disabled During Replay (`canAfford` bypass)

**File:** `packages/store/src/actionReducer.ts`

**Finding:** `canAfford()` always returned `true` during replay, making balance checking cosmetic.

**Fix:** Re-enabled with a soft floor of -$50M. Generous enough to tolerate missing intermediate flight revenue (NIP-33 event replacement), but blocks unlimited spending exploits.

---

### 2. Tick Time-Travel (Unbounded Revenue Generation)

**File:** `packages/store/src/actionReducer.ts` (`TICK_UPDATE`)

**Finding:** `payload.tick` was only clamped to `[0, MAX_SAFE_INTEGER]` with no cross-validation against real-world time.

**Fix:** `actionTick` is now clamped against `event.created_at` — max allowed tick is derived from the Nostr event timestamp + 1 hour tolerance.

---

### 3. Unverified Marketplace Transactions (Asset Theft)

**File:** `packages/store/src/actionReducer.ts` (`AIRCRAFT_BUY_USED`)

**Finding:** No verification that a marketplace listing existed for the claimed aircraft/price.

**Fix:** `AIRCRAFT_BUY_USED` now requires a non-empty `listingId`. Actions without one are rejected during replay.

---

## HIGH — Fixed in this PR

### 4. Self-Verifying Checkpoint Hash (Tautology)

**File:** `packages/store/src/slices/identitySlice.ts`

**Finding:** `verifyCheckpoint` compared `actionChainHash` against itself (`x === x`), making it always pass.

**Fix:** Now uses `computeCheckpointStateHash` to independently recompute and verify the state hash.

---

### 5. Competitor Checkpoint Poisoning (Zero Verification)

**File:** `packages/store/src/slices/worldSlice.ts`

**Finding:** Competitor checkpoints were used as-is, without any hash verification.

**Fix:** Added `computeCheckpointStateHash` verification for competitor checkpoints in `syncWorld`. Invalid checkpoints are discarded and state is rebuilt from the action log.

---

### 6. Seller Settlement Without Price Verification

**File:** `packages/store/src/slices/worldSlice.ts` (`settleMarketplaceSales`)

**Finding:** Settlement credited the seller based solely on detecting the aircraft in a competitor's fleet, with no verification the buyer paid the correct price.

**Fix:** Settlement now verifies the buyer's `purchasePrice` matches the seller's `listingPrice` within 1% tolerance. Mismatched settlements are rejected with a warning.

---

## MODERATE — Fixed in this PR

### 7. Aircraft Instance ID Collisions

**File:** `packages/store/src/slices/fleetSlice.ts`

**Finding:** Aircraft IDs used `ac-${Date.now().toString(36)}` — two players buying at the same millisecond would collide.

**Fix:** IDs now include a pubkey prefix: `ac-${pubkey.slice(0,8)}-${timestamp}`.

---

### 8. No Content Security Policy

**File:** `apps/web/index.html`

**Finding:** No CSP headers, leaving the app vulnerable to XSS which could abuse the NIP-07 signing bridge.

**Fix:** Added a strict CSP meta tag restricting scripts, connections (whitelisted relay WSS endpoints), fonts, and workers.

---

## Remaining — Documented, Requires Architectural Changes

### 9. History Rewriting via NIP-33 Replacement

`AIRLINE_CREATE` and `TICK_UPDATE` actions use NIP-33 replaceable events with no per-instance `d` tag suffix. Only the latest event survives on relays. **Mitigation:** Consider non-replaceable event kinds for financial actions.

### 10. Timeline Injection (Ledger Poisoning)

`TICK_UPDATE` payloads embed timeline arrays that are merged with minimal validation. Revenue/profit values from the payload are not recomputed. **Mitigation:** Mark externally-sourced timeline values as unverified, or recompute from state.

### 11. Relay Network Manipulation

The game broadcasts to 9 relays with no consensus mechanism. A compromised relay could selectively drop events. **Mitigation:** Implement relay response comparison and multi-relay consistency checks.

---

## Architectural Recommendation

The root cause is that **no trusted authority enforces rules** in a fully decentralized system.

**Recommended path forward:** Run a single authoritative relay (`nostr.acars.pub`) that validates incoming events before storing them — reject purchases with insufficient balance, reject marketplace buys without matching listings, reject tick updates that exceed the global clock. This preserves Nostr protocol compatibility while adding a validation layer.
