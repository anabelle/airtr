import { createLogger } from "@airtr/core";
import { ensureConnected, subscribeActions } from "@airtr/nostr";
import { create } from "zustand";
import { useEngineStore } from "./engine.js";
import { createEngineSlice } from "./slices/engineSlice.js";
import { createFleetSlice } from "./slices/fleetSlice.js";
import { createIdentitySlice } from "./slices/identitySlice.js";
import { createNetworkSlice } from "./slices/networkSlice.js";
import { createWorldSlice } from "./slices/worldSlice.js";
import type { AirlineState } from "./types.js";

export * from "./types.js";

/**
 * AIRLINE STORE
 *
 * The main store for the player's airline.
 * Refactored into specialized slices for easier maintenance.
 */
export const useAirlineStore = create<AirlineState>()((...a) => ({
  ...createIdentitySlice(...a),
  ...createFleetSlice(...a),
  ...createNetworkSlice(...a),
  ...createEngineSlice(...a),
  ...createWorldSlice(...a),
}));

// --- Side Effects ---

// Automatically process fleet ticks when engine ticks advance.
// IMPORTANT: Only fire when the tick INTEGER changes, not on tickProgress
// sub-tick updates. The engine fires syncTick() every 1000ms but ticks only
// change every 3000ms, so without this guard we'd re-enter processTick and
// processGlobalTick ~3x per tick, causing duplicate event generation and
// competitor aircraft position flicker on the map.
let lastSubscribedTick = -1;
let initialSyncComplete = false;
let unsubscribeActionStream: (() => void) | null = null;
const logger = createLogger("WorldSync");
const runtimeEnv = (
  globalThis as {
    process?: { env?: { NODE_ENV?: string } };
  }
).process?.env?.NODE_ENV;
const enableRealtimeSyncLogs = runtimeEnv !== "production";

// Batching: collect competitor pubkeys that need targeted sync, flush after
// a short window so rapid-fire events from the same player coalesce.
const LIVE_SYNC_BATCH_MS = 1000;
let pendingCompetitorSyncs = new Set<string>();
let batchFlushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingCompetitorSyncs() {
  batchFlushTimer = null;
  const pubkeys = pendingCompetitorSyncs;
  pendingCompetitorSyncs = new Set();

  for (const pubkey of pubkeys) {
    if (enableRealtimeSyncLogs) {
      logger.info(`Live sync: fetching competitor ${pubkey.slice(0, 8)}...`);
    }
    void useAirlineStore.getState().syncCompetitor(pubkey);
  }
}

function queueCompetitorSync(pubkey: string) {
  pendingCompetitorSyncs.add(pubkey);
  if (!batchFlushTimer) {
    batchFlushTimer = setTimeout(flushPendingCompetitorSyncs, LIVE_SYNC_BATCH_MS);
  }
}

useEngineStore.subscribe((state) => {
  if (state.tick === lastSubscribedTick) return;
  lastSubscribedTick = state.tick;

  const store = useAirlineStore.getState();
  void store.processTick(state.tick);
  void store.processGlobalTick(state.tick);

  // Sync world state every 20 ticks (~1 min) as a safety net.
  // The primary sync path is the live subscription handler above.
  // Skip until the initial eager sync completes to avoid racing with it.
  if (state.tick % 20 === 0 && initialSyncComplete) {
    store.syncWorld();
  }
});

// Initial world sync — wait for relay connectivity, then fetch with force
// to bypass the isProcessingGlobal guard that can silently skip the call.
const RETRY_SYNC_DELAY = 3000;
const MAX_SYNC_RETRIES = 3;

(async () => {
  // Wait for at least one Nostr relay to be connected before fetching
  // world state, instead of using an arbitrary delay.
  await ensureConnected();

  for (let attempt = 0; attempt <= MAX_SYNC_RETRIES; attempt++) {
    // force: true bypasses the isProcessingGlobal guard so the initial
    // sync cannot be silently skipped by a concurrent processGlobalTick.
    await useAirlineStore.getState().syncWorld({ force: true });
    const { competitors } = useAirlineStore.getState();
    if (competitors.size > 0) break;
    if (attempt < MAX_SYNC_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_SYNC_DELAY));
    }
  }

  initialSyncComplete = true;

  if (!unsubscribeActionStream) {
    const since = Math.floor(Date.now() / 1000);
    unsubscribeActionStream = await subscribeActions({
      since,
      onEvent: (entry) => {
        const { pubkey } = useAirlineStore.getState();
        // Skip our own events — we already applied them locally.
        if (pubkey && entry.event.author.pubkey === pubkey) return;
        if (!initialSyncComplete) return;

        const competitorPubkey = entry.event.author.pubkey;

        if (enableRealtimeSyncLogs) {
          logger.info(`Live event from ${competitorPubkey.slice(0, 8)}...: ${entry.action.action}`);
        }

        // Queue a targeted sync for just this competitor.
        // Events arriving within LIVE_SYNC_BATCH_MS are coalesced.
        queueCompetitorSync(competitorPubkey);
      },
    });
  }
})();

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (batchFlushTimer) {
      clearTimeout(batchFlushTimer);
      batchFlushTimer = null;
    }
    if (unsubscribeActionStream) {
      unsubscribeActionStream();
      unsubscribeActionStream = null;
    }
  });
}
