import { createLogger } from "@acars/core";
import { NDKEvent, type NDKFilter } from "@nostr-dev-kit/ndk";
import { ensureConnected, getNDK } from "./ndk.js";
import {
  ACTION_KIND,
  WORLD_ID,
  hasWorldTag,
  isTransientPublishError,
  isValidEventTimestamp,
} from "./schema.js";

const logger = createLogger("NostrSnapshot");
export const SNAPSHOT_D_TAG = `airtr:world:${WORLD_ID}:snapshot`;

export interface SnapshotPayload {
  compressedData: string;
  stateHash: string;
  tick: number;
}

export async function publishSnapshot(payload: SnapshotPayload): Promise<NDKEvent> {
  await ensureConnected();
  const ndk = getNDK();

  if (!ndk.signer) {
    throw new Error("No signer available. Call attachSigner() first.");
  }

  const event = new NDKEvent(ndk);
  event.kind = ACTION_KIND;
  event.tags = [
    ["d", SNAPSHOT_D_TAG],
    ["world", WORLD_ID],
    ["stateHash", payload.stateHash],
    ["tick", payload.tick.toString()],
  ];
  event.content = JSON.stringify(payload);

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await event.publish();
      return event;
    } catch (err) {
      const shouldRetry = isTransientPublishError(err);
      if (!shouldRetry || attempt >= maxRetries) {
        throw err;
      }
      const delay = 1000 * 2 ** attempt;
      logger.warn(`Snapshot publish attempt ${attempt + 1} failed, retrying in ${delay}ms...`, err);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return event;
}

export async function loadSnapshot(pubkey: string): Promise<SnapshotPayload | null> {
  await ensureConnected();
  const ndk = getNDK();

  const filter: NDKFilter = {
    kinds: [ACTION_KIND],
    authors: [pubkey],
    "#d": [SNAPSHOT_D_TAG],
    limit: 1,
  };

  let latest: SnapshotPayload | null = null;
  let latestCreatedAt = 0;
  let latestTick = -1;
  await new Promise<void>((resolve) => {
    const sub = ndk.subscribe(filter, { closeOnEose: true });
    const timeout = setTimeout(() => {
      sub.stop();
      resolve();
    }, 6000);

    sub.on("event", (event: NDKEvent) => {
      if (!hasWorldTag(event, WORLD_ID)) return;
      const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
      if (dTag !== SNAPSHOT_D_TAG) return;
      if (!isValidEventTimestamp(event.created_at ?? 0)) return;

      try {
        const parsed = JSON.parse(event.content) as SnapshotPayload;
        if (
          typeof parsed.compressedData !== "string" ||
          typeof parsed.stateHash !== "string" ||
          typeof parsed.tick !== "number" ||
          !Number.isInteger(parsed.tick) ||
          parsed.tick < 0
        )
          return;
        if (
          parsed.tick > latestTick ||
          (parsed.tick === latestTick && (event.created_at || 0) >= latestCreatedAt)
        ) {
          latest = parsed;
          latestTick = parsed.tick;
          latestCreatedAt = event.created_at || 0;
        }
      } catch {
        // Ignore malformed
      }
    });

    sub.on("eose", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  return latest;
}

export async function loadAllSnapshots(): Promise<Map<string, SnapshotPayload>> {
  await ensureConnected();
  const ndk = getNDK();

  const filter: NDKFilter = {
    kinds: [ACTION_KIND],
    "#d": [SNAPSHOT_D_TAG],
  };

  const results = new Map<string, { payload: SnapshotPayload; createdAt: number; tick: number }>();

  await new Promise<void>((resolve) => {
    const sub = ndk.subscribe(filter, { closeOnEose: true });
    const timeout = setTimeout(() => {
      sub.stop();
      resolve();
    }, 8000);

    sub.on("event", (event: NDKEvent) => {
      if (!hasWorldTag(event, WORLD_ID)) return;
      const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
      if (dTag !== SNAPSHOT_D_TAG) return;
      if (!isValidEventTimestamp(event.created_at ?? 0)) return;

      const pubkey = event.author.pubkey;

      try {
        const parsed = JSON.parse(event.content) as SnapshotPayload;
        if (
          typeof parsed.compressedData !== "string" ||
          typeof parsed.stateHash !== "string" ||
          typeof parsed.tick !== "number" ||
          !Number.isInteger(parsed.tick) ||
          parsed.tick < 0
        )
          return;

        const existing = results.get(pubkey);
        if (
          !existing ||
          parsed.tick > existing.tick ||
          (parsed.tick === existing.tick && (event.created_at || 0) > existing.createdAt)
        ) {
          results.set(pubkey, {
            payload: parsed,
            createdAt: event.created_at || 0,
            tick: parsed.tick,
          });
        }
      } catch {
        // Ignore malformed
      }
    });

    sub.on("eose", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  const finalMap = new Map<string, SnapshotPayload>();
  for (const [pubkey, wrapper] of results.entries()) {
    finalMap.set(pubkey, wrapper.payload);
  }
  return finalMap;
}
