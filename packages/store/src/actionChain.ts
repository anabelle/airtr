import {
  type GameActionEnvelope,
  type Checkpoint,
  computeCheckpointStateHash,
  compressSnapshotString,
} from "@acars/core";
import { type NDKEvent, publishAction, publishSnapshot } from "@acars/nostr";
import type { AirlineState } from "./types.js";
import { enqueueSerialUpdate } from "./utils/asyncQueue.js";
import { useEngineStore } from "./engine.js";
import { replayActionLog } from "./actionReducer.js";
import { db } from "./db.js";

export async function publishActionWithChain(params: {
  action: GameActionEnvelope;
  get: () => AirlineState;
  set: (state: Partial<AirlineState>) => void;
}): Promise<NDKEvent> {
  const { action, get, set } = params;
  const state = get();

  if (!state.airline) {
    throw new Error("Cannot publish action: no airline exists. Create an airline first.");
  }

  // Capture pre-action baseline for deterministic replay
  const baselineCheckpoint: Checkpoint = {
    schemaVersion: 1,
    tick: useEngineStore.getState().tick,
    createdAt: Date.now(),
    actionChainHash: state.actionChainHash,
    stateHash: state.latestCheckpoint?.stateHash || "",
    airline: state.airline,
    fleet: state.fleet,
    routes: state.routes,
    timeline: state.timeline,
  };

  const seq = state.actionSeq;
  set({ actionSeq: seq + 1 });

  const event = await publishAction(action, seq);

  await enqueueSerialUpdate(async () => {
    // Replay from the committed baseline, not live store
    const replayed = await replayActionLog({
      pubkey: get().pubkey || event.author.pubkey,
      actions: [
        {
          action,
          eventId: event.id,
          authorPubkey: event.author.pubkey,
          createdAt: event.created_at ?? null,
        },
      ],
      checkpoint: baselineCheckpoint,
      rejectedEventIds: new Set(),
    });

    // Update Zustand
    set({
      airline: replayed.airline,
      fleet: replayed.fleet,
      routes: replayed.routes,
      timeline: replayed.timeline,
      actionChainHash: replayed.actionChainHash,
    });

    // Update IndexedDB — transactional replace by owner
    if (replayed.airline) {
      const airline = replayed.airline;
      const ownerPubkey = airline.ceoPubkey;
      await db.transaction("rw", db.airline, db.fleet, db.routes, async () => {
        await db.airline.put(airline);
        await db.fleet.where({ ownerPubkey }).delete();
        await db.routes.where({ airlinePubkey: ownerPubkey }).delete();
        if (replayed.fleet.length > 0) await db.fleet.bulkPut(replayed.fleet);
        if (replayed.routes.length > 0) await db.routes.bulkPut(replayed.routes);
      });
    }

    // Trigger NIP-33 snapshot (background)
    publishCurrentStateSnapshot(get()).catch(console.error);
  });

  return event;
}

export async function publishCurrentStateSnapshot(state: AirlineState) {
  if (!state.airline) return;
  const tick = useEngineStore.getState().tick;
  const stateHash = await computeCheckpointStateHash({
    airline: state.airline,
    fleet: state.fleet,
    routes: state.routes,
    timeline: state.timeline,
  });
  const payload = {
    schemaVersion: 1,
    tick,
    createdAt: Date.now(),
    actionChainHash: state.actionChainHash,
    stateHash,
    airline: state.airline,
    fleet: state.fleet,
    routes: state.routes,
    timeline: state.timeline,
  };
  const str = JSON.stringify(payload);
  const compressedData = await compressSnapshotString(str);
  await publishSnapshot({
    compressedData,
    stateHash,
    tick,
  });
}
