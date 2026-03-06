# Snapshot Rollup Architecture (NIP-33)

## Objective

To enable "Planetary Scale" decentralized state synchronization on Nostr without requiring every client to replay the entire transaction history (event log) of every other player.

## The Problem: Event Log Bloat

In a purely event-sourced system on Nostr, the game state is reconstructed by fetching all `kind: 30078` events for a given `pubkey`. As a player performs thousands of actions (buying planes, setting prices, etc.), the time to fetch and reduce these events grows linearly ($O(N)$), leading to:

- **Slow Initial Load**: Waiting seconds or minutes for relays to return thousands of events.
- **High Relay Load**: Requesting massive result sets from Nostr relays.
- **Client Processing Overhead**: Reducing a long action chain on every app start.

## The Solution: Attested Snapshots

ACARS implements a **Snapshot Rollup** system using Nostr **NIP-33 Parameterized Replaceable Events**.

### 1. The Rollup Event

- **Kind**: `30078` (App-specific data)
- **d-tag**: `airtr:world:${WORLD_ID}:snapshot`
- **Content**: A Gzip-compressed JSON payload (`SnapshotPayload`) containing the full `AirlineState`.
- **Attestation**: Every snapshot includes a `stateHash` and an `actionChainHash`, allowing other clients to verify that the snapshot is a valid transition from the previous known state.

### 2. Multi-Layer Storage Strategy

| Layer     | Technology            | Purpose                                                                  | Speed      |
| :-------- | :-------------------- | :----------------------------------------------------------------------- | :--------- |
| **Local** | **IndexedDB (Dexie)** | Persistent local cache for instant app resumption.                       | < 50ms     |
| **Relay** | **Nostr (NIP-33)**    | Authoritative remote backup for cross-device sync and public visibility. | 500ms - 2s |
| **Chain** | **Nostr (NIP-30078)** | The raw event log for granular audit and fallback reconstruction.        | Variable   |

### 3. Synchronization Flow

1. **Instant Load**: On startup, `localLoader.ts` immediately hydrates the Zustand store from **IndexedDB**.
2. **Snapshot Fetch**: The client simultaneously queries Nostr relays for the latest NIP-33 snapshot for the player's `pubkey`.
3. **Rollup Merge**: If the remote snapshot tick is greater than the local tick, the local state is overwritten with the snapshot.
4. **Action Replay**: Any events published _after_ the snapshot tick are fetched and applied (reduced) to bring the state to the "head" of the log.
5. **Real-Time Reconciliation**: Since ACARS is deterministic, if the player was offline for 5 hours, the `FlightEngine` reconciles the 1,800 missing ticks (at 1 tick/10s) to calculate revenue and costs since the last saved state.

## Implementation Details

### Compression (`@acars/core/compression.ts`)

Snapshots are compressed using the native browser `CompressionStream` (Gzip). This reduces the payload size by ~80-90%, keeping events within relay size limits (typically 64KB - 100KB).

### Attestation (`@acars/store/actionChain.ts`)

Each action published also triggers a background snapshot update. The `actionChainHash` is a SHA-256 accumulation of all event IDs in sequence, ensuring that snapshots cannot be tampered with or "skipped" without detection by the auditor.

### Background Auditing (`apps/web/src/workers/auditor.ts`)

A dedicated Web Worker (the "Auditor") periodically verifies the `stateHash` of the local state against the computed math to ensure no memory corruption or logic errors have drifted the simulation away from the authoritative deterministic rules.

## Benefits

- **O(1) Join Time**: New players or returning players load the latest "state of the world" instantly, regardless of how many years of history exist.
- **Cross-Device Persistence**: Login on mobile and desktop shows the exact same airline state immediately.
- **Relay Efficiency**: Relays only need to store and serve the _latest_ snapshot per player, rather than the entire history.
