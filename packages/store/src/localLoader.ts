import { type Checkpoint, decompressSnapshotString, fpAdd } from "@acars/core";
import { loadSnapshot } from "@acars/nostr";
import { db } from "./db.js";
import { reconcileFleetToTick } from "./FlightEngine.js";
import { useEngineStore } from "./engine.js";
import type { AirlineState } from "./types.js";

const MAX_PLAYER_CATCHUP = 50000;

export async function hydrateIdentityFromStorage(
  pubkey: string,
  set: (state: Partial<AirlineState>) => void,
) {
  // 1. Load instantly from IndexedDB
  const localAirline = await db.airline.where({ ceoPubkey: pubkey }).first();
  const localFleet = await db.fleet.where({ ownerPubkey: pubkey }).toArray();
  const localRoutes = await db.routes.where({ airlinePubkey: pubkey }).toArray();

  let currentAirline = localAirline ?? null;
  let currentFleet = localFleet;
  let currentRoutes = localRoutes;
  let currentActionChainHash = "";
  const currentActionSeq = 0;

  // 2. Background sync with Nostr NIP-33 Snapshot Rollups
  try {
    const remote = await loadSnapshot(pubkey);
    if (remote) {
      const decompressedString = await decompressSnapshotString(remote.compressedData);
      const snapshotCheckpoint = JSON.parse(decompressedString) as Checkpoint;

      const localTick = currentAirline?.lastTick ?? 0;

      // If remote is newer, replace local
      if (snapshotCheckpoint.tick > localTick) {
        console.log(
          `[Identity] Nostr snapshot tick ${snapshotCheckpoint.tick} is newer than local DB ${localTick}. Overwriting state.`,
        );
        const { airline, fleet, routes, actionChainHash } = snapshotCheckpoint;

        // Transactional replace: clear existing records for this owner then write snapshot
        await db.transaction("rw", db.airline, db.fleet, db.routes, async () => {
          await db.airline.where({ ceoPubkey: pubkey }).delete();
          await db.fleet.where({ ownerPubkey: pubkey }).delete();
          await db.routes.where({ airlinePubkey: pubkey }).delete();
          await db.airline.put(airline);
          if (fleet.length > 0) await db.fleet.bulkPut(fleet);
          if (routes.length > 0) await db.routes.bulkPut(routes);
        });

        currentAirline = airline;
        currentFleet = fleet;
        currentRoutes = routes;
        currentActionChainHash = actionChainHash;
      }
    }
  } catch (err) {
    console.error("[Identity] Failed to sync remote snapshot:", err);
  }

  // 3. Reconcile loaded state (catchup)
  if (!currentAirline) {
    set({
      pubkey,
      airline: null,
      fleet: [],
      routes: [],
      timeline: [],
      actionChainHash: "",
      actionSeq: 0,
      fleetDeletedDuringCatchup: [],
      latestCheckpoint: null,
      identityStatus: "ready",
      isLoading: false,
    });
    return;
  }

  const airline = { ...currentAirline };
  let fleet = currentFleet;
  const routes = currentRoutes;
  const engineTick = useEngineStore.getState().tick;

  if (
    (airline.lastTick == null || airline.lastTick === 0) &&
    (fleet.length > 0 || routes.length > 0)
  ) {
    airline.lastTick = Math.max(0, engineTick - MAX_PLAYER_CATCHUP);
  } else if (airline.lastTick != null) {
    const oldestAllowedTick = Math.max(0, engineTick - MAX_PLAYER_CATCHUP);
    if (airline.lastTick < oldestAllowedTick) {
      airline.lastTick = oldestAllowedTick;
    }
  }

  // Reconcile to the current engine tick, not the snapshot's lastTick
  if (airline.lastTick != null && fleet.length > 0 && engineTick > airline.lastTick) {
    const { fleet: reconciled, balanceDelta } = reconcileFleetToTick(fleet, routes, engineTick);
    fleet = reconciled;
    airline.corporateBalance = fpAdd(airline.corporateBalance, balanceDelta);
    airline.lastTick = engineTick;
  }

  set({
    pubkey,
    airline,
    fleet,
    routes,
    timeline: airline.timeline || [],
    actionChainHash: currentActionChainHash,
    actionSeq: currentActionSeq,
    fleetDeletedDuringCatchup: [],
    identityStatus: "ready",
    isLoading: false,
  });
}
