import { createLogger } from "@acars/core";
import {
  connectedRelayCount,
  ensureConnected,
  reconnectIfNeeded,
  subscribeActions,
} from "@acars/nostr";
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
  viewedPubkey: null,
}));

// --- Side Effects ---

// Automatically process fleet ticks when engine ticks advance.
// IMPORTANT: Only fire when the tick INTEGER changes, not on tickProgress
// sub-tick updates. The engine fires syncTick() every 1000ms but ticks only
// change every 3000ms, so without this guard we'd re-enter processTick
// ~3x per tick, causing duplicate event generation and aircraft position
// flicker on the map.
let lastSubscribedTick = -1;
let initialSyncComplete = false;
let unsubscribeActionStream: (() => void) | null = null;
const logger = createLogger("WorldSync");

/**
 * Persistent promise chain that serializes tick processing across boundaries.
 *
 * Player ticks (`processTick`) and competitor fleet re-projection
 * (`projectCompetitorFleet`) are chained sequentially to prevent overlap.
 */
let tickPipeline: Promise<void> = Promise.resolve();
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

// Buffer for live events that arrive before the initial sync completes.
// Flushed (with deduplication) once initialSyncComplete is set to true.
const eventBuffer: string[] = [];

/** @internal — test-only accessor for the pre-sync event buffer */
export function _getEventBuffer(): string[] {
  return [...eventBuffer];
}

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
  tickPipeline = tickPipeline
    .then(async () => {
      await store.processTick(state.tick);
      // Re-project competitor fleet to current tick (replaces processGlobalTick).
      // This is synchronous — reconcileFleetToTick is a pure O(N) function.
      store.projectCompetitorFleet(state.tick);
    })
    .catch((error) => {
      logger.warn("Tick pipeline failed", error);
    });

  // Sync world state every 20 ticks (~1 min) to refresh competitor data
  // from Nostr relays.  This is the primary mechanism for keeping competitor
  // state fresh; projectCompetitorFleet keeps positions current between syncs.
  // Skip until the initial eager sync completes to avoid racing with it.
  // Use force: true so the sync is not silently dropped.
  if (state.tick % 20 === 0 && initialSyncComplete) {
    store.syncWorld({ force: true });
  }

  // Relay health check every 100 ticks (~5 min).
  // If all relays disconnected, attempt reconnection and re-subscribe.
  if (state.tick % 100 === 0 && initialSyncComplete) {
    if (connectedRelayCount() === 0) {
      logger.warn("Relay health check: no relays connected — attempting recovery...");
      void (async () => {
        const recovered = await reconnectIfNeeded();
        if (recovered && !unsubscribeActionStream) {
          const freshSince = Math.floor(Date.now() / 1000);
          await startActionSubscription(freshSince);
          void store.syncWorld({ force: true });
          logger.info("Relay health check: recovered — re-subscribed and resynced.");
        }
      })();
    }
  }
});

// Initial world sync — wait for relay connectivity, then fetch with force
// to bypass the isSyncingWorld guard that can silently skip the call.
const RETRY_SYNC_DELAY = 3000;
const MAX_SYNC_RETRIES = 3;

// Minimum delay before re-subscribing after an unexpected close, to avoid
// tight reconnect loops if relays are consistently dropping us.
const RESUBSCRIBE_DELAY_MS = 2000;

/**
 * Replay events buffered during the initial sync window.
 * Deduplicates by pubkey and skips competitors already captured by syncWorld.
 * Mirrors the flushPendingCompetitorSyncs pattern.
 */
function flushEventBuffer() {
  if (eventBuffer.length === 0) return;
  const { competitors } = useAirlineStore.getState();
  const seen = new Set<string>();
  for (const pk of eventBuffer) {
    if (seen.has(pk)) continue;
    seen.add(pk);
    if (!competitors.has(pk)) {
      queueCompetitorSync(pk);
    }
  }
  eventBuffer.length = 0;
}

async function startActionSubscription(since: number): Promise<void> {
  // Tear down any existing subscription before creating a new one.
  if (unsubscribeActionStream) {
    unsubscribeActionStream();
    unsubscribeActionStream = null;
  }

  logger.info(`Starting live action subscription (since=${since})`);

  unsubscribeActionStream = await subscribeActions({
    since,
    onEvent: (entry) => {
      const { pubkey } = useAirlineStore.getState();
      // Skip our own events — we already applied them locally.
      if (pubkey && entry.event.author.pubkey === pubkey) return;

      const competitorPubkey = entry.event.author.pubkey;

      // Buffer events that arrive before the initial sync finishes so they
      // are not silently dropped.  They will be replayed once sync completes.
      if (!initialSyncComplete) {
        eventBuffer.push(competitorPubkey);
        return;
      }

      if (enableRealtimeSyncLogs) {
        logger.info(`Live event from ${competitorPubkey.slice(0, 8)}...: ${entry.action.action}`);
      }

      // Queue a targeted sync for just this competitor.
      // Events arriving within LIVE_SYNC_BATCH_MS are coalesced.
      queueCompetitorSync(competitorPubkey);
    },
    onClose: () => {
      // Subscription died unexpectedly (relay disconnect, WebSocket close).
      // Wait briefly then re-subscribe with a fresh `since` timestamp and
      // trigger a full resync to recover any events missed while disconnected.
      logger.warn("Live subscription closed unexpectedly — scheduling re-subscribe...");
      unsubscribeActionStream = null;
      setTimeout(async () => {
        try {
          await ensureConnected();
          const freshSince = Math.floor(Date.now() / 1000);
          await startActionSubscription(freshSince);
          // Only trigger a full resync if we've completed the initial sync;
          // otherwise the IIFE retry loop will handle it.
          if (initialSyncComplete) {
            void useAirlineStore.getState().syncWorld({ force: true });
          }
          logger.info("Re-subscribed successfully after unexpected close.");
        } catch {
          logger.warn("Re-subscribe attempt failed, will retry on next periodic sync.");
        }
      }, RESUBSCRIBE_DELAY_MS);
    },
  });
}

(async () => {
  // Wait for at least one Nostr relay to be connected before fetching
  // world state, instead of using an arbitrary delay.
  await ensureConnected();

  // Capture `since` BEFORE the initial sync starts so we don't miss events
  // published by competitors during the multi-second syncWorld() fetch.
  const since = Math.floor(Date.now() / 1000);

  // Start the subscription NOW (before syncWorld) so events that arrive
  // during the sync window are buffered rather than missed.
  try {
    await startActionSubscription(since);
  } catch (err) {
    logger.warn("Failed to start action subscription, will rely on periodic sync", err);
  }

  for (let attempt = 0; attempt <= MAX_SYNC_RETRIES; attempt++) {
    // force: true bypasses the isSyncingWorld guard so the initial
    // sync cannot be silently skipped by a concurrent sync.
    await useAirlineStore.getState().syncWorld({ force: true });
    const { competitors } = useAirlineStore.getState();
    if (competitors.size > 0) break;
    if (attempt < MAX_SYNC_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_SYNC_DELAY));
    }
  }

  initialSyncComplete = true;

  // Replay buffered events that arrived during the initial sync window.
  flushEventBuffer();
})();

// --- Visibility change handling ---
// When the user switches tabs, browsers throttle/kill WebSocket connections.
// When they come back, re-sync and re-subscribe to recover missed events.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!initialSyncComplete) return;

    logger.info("Tab became visible — triggering recovery sync...");

    // Force a full world resync to catch up on any events we missed.
    void useAirlineStore.getState().syncWorld({ force: true });

    // If the subscription died while we were in the background, restart it.
    // Even if it's still technically alive, relay connections may be stale.
    // Re-subscribing is cheap and guarantees we're receiving events.
    void (async () => {
      try {
        await ensureConnected();
        // Only re-subscribe if the connection looks dead or there's no
        // active subscription.  Checking connectedRelayCount avoids
        // needlessly tearing down a healthy subscription.
        if (!unsubscribeActionStream || connectedRelayCount() === 0) {
          const freshSince = Math.floor(Date.now() / 1000);
          await startActionSubscription(freshSince);
          logger.info("Re-subscribed after tab visibility change.");
        }
      } catch {
        logger.warn("Failed to re-subscribe on visibility change, will retry on periodic sync.");
      }
    })();
  });
}

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
