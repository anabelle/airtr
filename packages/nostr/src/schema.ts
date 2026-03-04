import { type Checkpoint, createLogger, type FixedPoint, FP_ZERO, fpRaw } from "@acars/core";
import type { NDKKind } from "@nostr-dev-kit/ndk";
import { NDKEvent, type NDKFilter } from "@nostr-dev-kit/ndk";
import { ensureConnected, getNDK } from "./ndk.js";

const logger = createLogger("Nostr");

/**
 * A validated marketplace listing from Nostr.
 */
export interface MarketplaceListing {
  /** Nostr event ID */
  id: string;
  /** Original aircraft instance ID */
  instanceId: string;
  /** Seller's Nostr pubkey (from event signature, not content) */
  sellerPubkey: string;
  /** Event creation timestamp */
  createdAt: number;
  /** Aircraft model ID */
  modelId: string;
  /** Aircraft display name */
  name: string;
  /** Owner pubkey (from content) */
  ownerPubkey: string;
  /** Asking price (FixedPoint) */
  marketplacePrice: FixedPoint;
  /** When the listing was created */
  listedAt: number;
  /** Aircraft condition 0.0-1.0 */
  condition: number;
  /** Total flight hours */
  flightHoursTotal: number;
  /** Flight hours since last check */
  flightHoursSinceCheck: number;
  /** Tick when aircraft was originally manufactured */
  birthTick: number;
  /** Tick when current owner purchased */
  purchasedAtTick: number;
  /** Original purchase price (FixedPoint) */
  purchasePrice: FixedPoint;
  /** Base airport */
  baseAirportIata: string;
  /** Purchase type */
  purchaseType: "buy" | "lease";
  /** Interior configuration */
  configuration: {
    economy: number;
    business: number;
    first: number;
    cargoKg: number;
  };
}

export type ActionEnvelope = import("@acars/core").GameActionEnvelope;

export interface ActionLogEntry {
  event: NDKEvent;
  action: ActionEnvelope;
}

const ACTION_KIND = 30078;
const WORLD_ID = "dev-v3";
const ACARS_SCHEMA_VERSION = 1;
const ACTION_D_PREFIX = `airtr:world:${WORLD_ID}:action:`;
const CHECKPOINT_D_TAG = `airtr:world:${WORLD_ID}:checkpoint`;

const MAX_FUTURE_SKEW_SEC = 5 * 60;
const MAX_EVENT_AGE_SEC = 365 * 24 * 60 * 60;

const ACTION_SCHEMA_VERSION = 2;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.floor(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function isValidEventTimestamp(createdAt: number): boolean {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (createdAt > nowSec + MAX_FUTURE_SKEW_SEC) return false;
  if (nowSec - createdAt > MAX_EVENT_AGE_SEC) return false;
  return true;
}

function hasWorldTag(event: NDKEvent, worldId: string): boolean {
  return event.tags.some((tag) => tag[0] === "world" && tag[1] === worldId);
}

function isActionKind(event: NDKEvent): boolean {
  if (event.kind !== ACTION_KIND) return false;
  const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
  return Boolean(dTag && dTag.startsWith(ACTION_D_PREFIX));
}

function parseActionContent(data: unknown): ActionEnvelope | null {
  if (!isRecord(data)) return null;
  const schemaVersion = clampInt(data.schemaVersion, 1, 10);
  const action = typeof data.action === "string" ? data.action : null;
  if (!schemaVersion || !action) return null;
  if (!isRecord(data.payload)) return null;
  return {
    schemaVersion,
    action: action as ActionEnvelope["action"],
    payload: data.payload,
  };
}

function isTransientPublishError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (name === "NDKPublishError") return true;
  return /(not enough relays|timeout|timed out|network|websocket|relay|fetch failed|econn|enotfound|connection)/i.test(
    message,
  );
}

export function buildActionDTag(action: ActionEnvelope, seq?: number): string {
  const base = `${ACTION_D_PREFIX}${action.action.toLowerCase()}`;
  if (action.action === "AIRLINE_CREATE" || action.action === "TICK_UPDATE") {
    return base;
  }

  const payload = isRecord(action.payload) ? action.payload : {};
  const idCandidates = [payload.instanceId, payload.routeId, payload.aircraftId, payload.iata];
  const rawId = idCandidates.find((value) => typeof value === "string" && value.trim());
  const id = typeof rawId === "string" ? rawId.trim() : null;
  const tick = isFiniteNumber(payload.tick) ? Math.floor(payload.tick) : null;

  const suffixParts: string[] = [];
  if (id) suffixParts.push(id);
  if (tick !== null) suffixParts.push(String(tick));
  if (typeof seq === "number" && Number.isFinite(seq)) suffixParts.push(`s${Math.floor(seq)}`);

  return suffixParts.length > 0 ? `${base}:${suffixParts.join(":")}` : base;
}

/**
 * Kind for used aircraft listings.
 */
export const MARKETPLACE_KIND: NDKKind = 30079 as NDKKind;
export const MARKETPLACE_D_PREFIX = `airtr:world:${WORLD_ID}:marketplace:`;

/**
 * Publishes an airline creation or update event to Nostr.
 */
export async function publishAirline(): Promise<never> {
  throw new Error("Snapshot publishing is disabled for action-log worlds.");
}

/**
 * Publishes a single game action event to Nostr.
 */
export async function publishAction(action: ActionEnvelope, seq?: number): Promise<NDKEvent> {
  await ensureConnected();
  const ndk = getNDK();

  if (!ndk.signer) {
    throw new Error("No signer available. Call attachSigner() first.");
  }

  const event = new NDKEvent(ndk);
  event.kind = ACTION_KIND;
  event.tags = [
    ["d", buildActionDTag(action, seq)],
    ["world", WORLD_ID],
  ];

  event.content = JSON.stringify({
    schemaVersion: ACTION_SCHEMA_VERSION,
    action: action.action,
    payload: action.payload,
  });

  await event.publish();
  return event;
}

export async function publishCheckpoint(checkpoint: Checkpoint): Promise<NDKEvent> {
  await ensureConnected();
  const ndk = getNDK();

  if (!ndk.signer) {
    throw new Error("No signer available. Call attachSigner() first.");
  }

  const event = new NDKEvent(ndk);
  event.kind = ACTION_KIND;
  event.tags = [
    ["d", CHECKPOINT_D_TAG],
    ["world", WORLD_ID],
  ];
  event.content = JSON.stringify(checkpoint);

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
      const delay = 1000 * 2 ** attempt; // 1s, 2s
      console.warn(
        `Checkpoint publish attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
        err,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return event; // unreachable, satisfies TypeScript
}

/**
 * Loads recent game actions for the current world.
 */
export async function loadActionLog(options?: {
  authors?: string[];
  limit?: number;
  maxPages?: number;
  since?: number;
}): Promise<ActionLogEntry[]> {
  await ensureConnected();
  const ndk = getNDK();
  const { authors, limit, maxPages, since } = options ?? {};
  const pageLimit = limit ?? 1000;
  const pageCap = maxPages ?? 10;
  const resultsById = new Map<string, ActionLogEntry>();

  let page = 0;
  let until: number | undefined;

  while (page < pageCap) {
    const filter: NDKFilter = {
      kinds: [ACTION_KIND],
      limit: pageLimit,
      ...(authors && authors.length > 0 ? { authors } : {}),
      ...(until ? { until } : {}),
      ...(since ? { since } : {}),
    };

    const pageResults: ActionLogEntry[] = [];

    await new Promise<void>((resolve) => {
      const sub = ndk.subscribe(filter, { closeOnEose: true });
      const timeout = setTimeout(() => {
        sub.stop();
        resolve();
      }, 8000);

      sub.on("event", (event: NDKEvent) => {
        if (!hasWorldTag(event, WORLD_ID)) return;
        if (!isValidEventTimestamp(event.created_at ?? 0)) return;
        if (!isActionKind(event)) return;
        const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
        if (dTag === CHECKPOINT_D_TAG) return;
        if (!event.content.trim().startsWith("{")) return;

        try {
          const parsed = parseActionContent(JSON.parse(event.content));
          if (!parsed) return;
          pageResults.push({ event, action: parsed });
        } catch {
          // Ignore malformed action payloads
        }
      });

      sub.on("eose", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    for (const entry of pageResults) {
      if (!resultsById.has(entry.event.id)) {
        resultsById.set(entry.event.id, entry);
      }
    }

    if (pageResults.length < pageLimit) break;

    const minCreatedAt = pageResults.reduce(
      (min, entry) => {
        const createdAt = entry.event.created_at ?? 0;
        if (createdAt <= 0) return min;
        return min === null ? createdAt : Math.min(min, createdAt);
      },
      null as number | null,
    );

    if (!minCreatedAt || minCreatedAt <= 0) break;

    until = minCreatedAt - 1;
    page += 1;
  }

  const results = Array.from(resultsById.values());

  results.sort((a, b) => {
    const aTime = a.event.created_at ?? 0;
    const bTime = b.event.created_at ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.event.id.localeCompare(b.event.id);
  });

  return results;
}

export async function subscribeActions(options: {
  onEvent: (entry: ActionLogEntry) => void;
  authors?: string[];
  since?: number;
  onEose?: () => void;
  /** Called when the subscription is closed unexpectedly (relay disconnect, error, etc.) */
  onClose?: () => void;
}): Promise<() => void> {
  await ensureConnected();
  const ndk = getNDK();
  const { onEvent, authors, since, onEose, onClose } = options;

  const filter: NDKFilter = {
    kinds: [ACTION_KIND],
    ...(authors && authors.length > 0 ? { authors } : {}),
    ...(since ? { since } : {}),
  };

  const sub = ndk.subscribe(filter, { closeOnEose: false });
  let intentionallyStopped = false;

  sub.on("event", (event: NDKEvent) => {
    if (!hasWorldTag(event, WORLD_ID)) return;
    if (!isValidEventTimestamp(event.created_at ?? 0)) return;
    if (!isActionKind(event)) return;
    const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
    if (dTag === CHECKPOINT_D_TAG) return;
    if (!event.content.trim().startsWith("{")) return;

    try {
      const parsed = parseActionContent(JSON.parse(event.content));
      if (!parsed) return;
      onEvent({ event, action: parsed });
    } catch {
      // Ignore malformed action payloads
    }
  });

  sub.on("eose", () => {
    onEose?.();
  });

  // Detect unexpected subscription death (relay disconnect, WebSocket close, etc.)
  sub.on("close", () => {
    if (!intentionallyStopped) {
      logger.warn("Live subscription closed unexpectedly — notifying caller for re-subscribe.");
      onClose?.();
    }
  });

  return () => {
    intentionallyStopped = true;
    sub.stop();
  };
}

function parseCheckpoint(data: unknown): Checkpoint | null {
  if (!isRecord(data)) return null;
  const schemaVersion = clampInt(data.schemaVersion, 1, 10);
  const tick = clampInt(data.tick, 0, Number.MAX_SAFE_INTEGER);
  const createdAt = clampInt(data.createdAt, 0, Number.MAX_SAFE_INTEGER);
  const actionChainHash = typeof data.actionChainHash === "string" ? data.actionChainHash : null;
  const stateHash = typeof data.stateHash === "string" ? data.stateHash : null;
  if (!schemaVersion || tick == null || createdAt == null || !actionChainHash || !stateHash) {
    return null;
  }
  if (!isRecord(data.airline) || !Array.isArray(data.fleet) || !Array.isArray(data.routes)) {
    return null;
  }
  const timeline = Array.isArray(data.timeline) ? data.timeline : [];

  return {
    schemaVersion,
    tick,
    createdAt,
    actionChainHash,
    stateHash,
    airline: data.airline as unknown as Checkpoint["airline"],
    fleet: data.fleet as unknown as Checkpoint["fleet"],
    routes: data.routes as unknown as Checkpoint["routes"],
    timeline: timeline as unknown as Checkpoint["timeline"],
  };
}

export async function loadCheckpoint(pubkey: string): Promise<Checkpoint | null> {
  await ensureConnected();
  const ndk = getNDK();

  const filter: NDKFilter = {
    kinds: [ACTION_KIND],
    authors: [pubkey],
    "#d": [CHECKPOINT_D_TAG],
    limit: 5,
  };

  let latest: Checkpoint | null = null;
  let latestCreatedAt = 0;
  await new Promise<void>((resolve) => {
    const sub = ndk.subscribe(filter, { closeOnEose: true });
    const timeout = setTimeout(() => {
      sub.stop();
      resolve();
    }, 6000);

    sub.on("event", (event: NDKEvent) => {
      if (!hasWorldTag(event, WORLD_ID)) return;
      const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
      if (dTag !== CHECKPOINT_D_TAG) return;
      if (!isValidEventTimestamp(event.created_at ?? 0)) return;
      if (!event.content.trim().startsWith("{")) return;

      try {
        const parsed = parseCheckpoint(JSON.parse(event.content));
        if (!parsed) return;
        if (parsed.createdAt >= latestCreatedAt) {
          latest = parsed;
          latestCreatedAt = parsed.createdAt;
        }
      } catch {
        // Ignore malformed checkpoints
      }
    });

    sub.on("eose", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  return latest;
}

export async function loadCheckpoints(pubkeys: string[]): Promise<Map<string, Checkpoint>> {
  if (pubkeys.length === 0) return new Map();
  await ensureConnected();
  const ndk = getNDK();

  const filter: NDKFilter = {
    kinds: [ACTION_KIND],
    authors: pubkeys,
    "#d": [CHECKPOINT_D_TAG],
    limit: Math.max(pubkeys.length, 100),
  };

  const checkpoints = new Map<string, Checkpoint>();
  const latestByPubkey = new Map<string, number>();

  await new Promise<void>((resolve) => {
    const sub = ndk.subscribe(filter, { closeOnEose: true });
    const timeout = setTimeout(() => {
      sub.stop();
      resolve();
    }, 8000);

    sub.on("event", (event: NDKEvent) => {
      if (!hasWorldTag(event, WORLD_ID)) return;
      const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
      if (dTag !== CHECKPOINT_D_TAG) return;
      if (!isValidEventTimestamp(event.created_at ?? 0)) return;
      if (!event.content.trim().startsWith("{")) return;

      try {
        const parsed = parseCheckpoint(JSON.parse(event.content));
        if (!parsed) return;
        const author = event.author.pubkey;
        const lastSeen = latestByPubkey.get(author) ?? 0;
        if (parsed.createdAt >= lastSeen) {
          checkpoints.set(author, parsed);
          latestByPubkey.set(author, parsed.createdAt);
        }
      } catch {
        // Ignore malformed checkpoints
      }
    });

    sub.on("eose", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  return checkpoints;
}

/**
 * Tries to fetch an existing airline configuration for the given pubkey.
 */
export async function loadAirline(): Promise<never> {
  throw new Error("Snapshot loading is disabled for action-log worlds.");
}

/**
 * Publishes an aircraft to the global used marketplace.
 */
export async function publishUsedAircraft(
  aircraft: import("@acars/core").AircraftInstance,
  price: import("@acars/core").FixedPoint,
): Promise<NDKEvent> {
  // Input validation — defense-in-depth against malformed or malicious calls
  if (!aircraft || typeof aircraft.id !== "string" || !aircraft.id) {
    throw new Error("Invalid aircraft: missing id");
  }
  if (typeof aircraft.modelId !== "string" || !aircraft.modelId) {
    throw new Error("Invalid aircraft: missing modelId");
  }
  if (typeof aircraft.ownerPubkey !== "string" || !aircraft.ownerPubkey) {
    throw new Error("Invalid aircraft: missing ownerPubkey");
  }
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new Error("Invalid listing price: must be a positive finite number");
  }

  await ensureConnected();
  const ndk = getNDK();

  if (!ndk.signer) throw new Error("No signer available. Please check your Nostr extension.");

  logger.info("Publishing used aircraft listing:", aircraft.id, "at price:", price);

  const event = new NDKEvent(ndk);
  event.kind = MARKETPLACE_KIND;
  event.tags = [
    ["d", `${MARKETPLACE_D_PREFIX}${aircraft.id}`],
    ["model", aircraft.modelId],
    ["owner", aircraft.ownerPubkey || "unknown"],
    ["price", price.toString()],
    ["world", WORLD_ID],
  ];

  const payload = {
    ...aircraft,
    schemaVersion: ACARS_SCHEMA_VERSION,
    marketplacePrice: price,
    listedAt: Date.now(),
  };

  event.content = JSON.stringify(payload);

  logger.info("Broadcasting marketplace event to relays...");
  await event.publish();
  logger.info("Broadcast complete for event:", event.id);
  return event;
}

/**
 * Validates and parses raw marketplace listing data from a Nostr event.
 * Returns null if the data fails validation.
 */
function parseMarketplaceListing(
  data: unknown,
  eventId: string,
  authorPubkey: string,
  createdAt: number,
): MarketplaceListing | null {
  if (!isRecord(data)) return null;

  // Required string fields
  const modelId = typeof data.modelId === "string" ? data.modelId : null;
  const instanceId = typeof data.id === "string" ? data.id : null;
  if (!modelId || !instanceId) return null;

  const name = typeof data.name === "string" ? data.name : "Unknown Aircraft";
  const ownerPubkey = typeof data.ownerPubkey === "string" ? data.ownerPubkey : authorPubkey;
  const baseAirportIata = typeof data.baseAirportIata === "string" ? data.baseAirportIata : "XXX";

  // Price: must be a positive finite number (already in FixedPoint scale from publishUsedAircraft)
  const rawPrice = data.marketplacePrice;
  if (typeof rawPrice !== "number" || !Number.isFinite(rawPrice) || rawPrice <= 0) return null;
  const marketplacePrice = fpRaw(rawPrice);

  // Numeric fields with safe defaults (use ?? to handle 0 correctly)
  const condition =
    typeof data.condition === "number" && Number.isFinite(data.condition)
      ? Math.max(0, Math.min(1, data.condition))
      : 0.5;

  const flightHoursTotal =
    typeof data.flightHoursTotal === "number" && Number.isFinite(data.flightHoursTotal)
      ? Math.max(0, data.flightHoursTotal)
      : 0;

  const flightHoursSinceCheck =
    typeof data.flightHoursSinceCheck === "number" && Number.isFinite(data.flightHoursSinceCheck)
      ? Math.max(0, data.flightHoursSinceCheck)
      : 0;

  const birthTick =
    typeof data.birthTick === "number" && Number.isFinite(data.birthTick) ? data.birthTick : 0;
  const purchasedAtTick =
    typeof data.purchasedAtTick === "number" && Number.isFinite(data.purchasedAtTick)
      ? data.purchasedAtTick
      : 0;
  const listedAt =
    typeof data.listedAt === "number" && Number.isFinite(data.listedAt)
      ? data.listedAt
      : Date.now();

  const purchasePrice =
    typeof data.purchasePrice === "number" && Number.isFinite(data.purchasePrice)
      ? fpRaw(data.purchasePrice)
      : FP_ZERO;

  const purchaseType = data.purchaseType === "lease" ? ("lease" as const) : ("buy" as const);

  // Configuration: validate each field or use sane defaults
  const rawConfig = isRecord(data.configuration) ? data.configuration : null;
  const configuration = {
    economy:
      typeof rawConfig?.economy === "number" ? Math.max(0, Math.round(rawConfig.economy)) : 150,
    business:
      typeof rawConfig?.business === "number" ? Math.max(0, Math.round(rawConfig.business)) : 0,
    first: typeof rawConfig?.first === "number" ? Math.max(0, Math.round(rawConfig.first)) : 0,
    cargoKg:
      typeof rawConfig?.cargoKg === "number" ? Math.max(0, Math.round(rawConfig.cargoKg)) : 0,
  };

  // Verify seller matches content owner (reject impersonation)
  if (ownerPubkey !== authorPubkey) return null;

  return {
    id: eventId,
    instanceId,
    sellerPubkey: authorPubkey,
    createdAt,
    modelId,
    name,
    ownerPubkey,
    marketplacePrice,
    listedAt,
    condition,
    flightHoursTotal,
    flightHoursSinceCheck,
    birthTick,
    purchasedAtTick,
    purchasePrice,
    baseAirportIata,
    purchaseType,
    configuration,
  };
}

/**
 * A map of pubkey -> Set of aircraft instanceIds they currently own.
 * Used to filter stale marketplace listings via ownership cross-referencing.
 */
export type SellerFleetIndex = Map<string, Set<string>>;

/**
 * Loads all active used aircraft listings from the global marketplace.
 *
 * @param sellerFleets - Optional index of ALL known airline fleets (pubkey -> Set<instanceId>).
 *   Used for two-pass ownership verification:
 *   1. If the seller's fleet no longer contains the aircraft → stale (seller removed it).
 *   2. If ANY other airline's fleet contains the aircraft → stale (someone else bought it,
 *      but the seller's client hasn't settled yet — covers pre-existing listings).
 */
export async function loadMarketplace(
  sellerFleets?: SellerFleetIndex,
): Promise<MarketplaceListing[]> {
  await ensureConnected();
  const ndk = getNDK();

  logger.info("Fetching marketplace listings (Kind 30079) from relays...");

  const filter: NDKFilter = {
    kinds: [MARKETPLACE_KIND],
    limit: 100,
  };

  const listingsMap = new Map<string, MarketplaceListing>();

  // We use a manual subscription to collect events as they stream in.
  // This is more resilient than fetchEvents which can be unpredictable with slow relays.
  await new Promise<void>((resolve) => {
    const sub = ndk.subscribe(filter, { closeOnEose: true });
    const timeout = setTimeout(() => {
      sub.stop();
      console.warn("[Nostr] Marketplace fetch reached 6s safety timeout.");
      resolve();
    }, 6000);

    sub.on("event", (event: NDKEvent) => {
      // Only attempt to parse if it's an ACARS marketplace entry
      const dTag = event.tags.find((t) => t[0] === "d")?.[1];
      if (!dTag?.startsWith(MARKETPLACE_D_PREFIX)) return;
      if (!hasWorldTag(event, WORLD_ID)) return;
      if (!isValidEventTimestamp(event.created_at ?? 0)) return;

      try {
        const data = JSON.parse(event.content);
        const listing = parseMarketplaceListing(
          data,
          event.id,
          event.author.pubkey,
          event.created_at ?? 0,
        );
        if (!listing) return;

        // Dedup by instanceId:sellerPubkey, keeping latest
        const dedupKey = `${listing.instanceId}:${listing.sellerPubkey}`;
        const existing = listingsMap.get(dedupKey);
        if (!existing || listing.createdAt >= existing.createdAt) {
          listingsMap.set(dedupKey, listing);
        }
      } catch {
        // Silently skip truly malformed events that match our prefix
      }
    });

    sub.on("eose", () => {
      logger.info("Marketplace fetch received EOSE");
      clearTimeout(timeout);
      resolve();
    });
  });

  let result = Array.from(listingsMap.values());

  // Ownership verification: filter out stale listings
  if (sellerFleets && sellerFleets.size > 0) {
    // Build reverse index: aircraftId -> ownerPubkey (for all known fleets)
    const aircraftOwner = new Map<string, string>();
    for (const [pubkey, aircraftIds] of sellerFleets) {
      for (const aircraftId of aircraftIds) {
        aircraftOwner.set(aircraftId, pubkey);
      }
    }

    const beforeCount = result.length;
    result = result.filter((listing) => {
      const currentOwner = aircraftOwner.get(listing.instanceId);

      // Check 1: If another airline (not the seller) now owns this aircraft,
      // it was already purchased. The seller's state may not be updated yet
      // (pre-settlement), but the listing is definitely stale.
      if (currentOwner && currentOwner !== listing.sellerPubkey) {
        logger.info(
          `Filtering stale listing: ${listing.instanceId} (now owned by ${currentOwner.slice(0, 8)}..., not seller ${listing.sellerPubkey.slice(0, 8)}...)`,
        );
        return false;
      }

      // Check 2: If we have the seller's fleet data and it no longer contains
      // this aircraft, the seller already settled/scrapped it.
      const sellerAircraftIds = sellerFleets.get(listing.sellerPubkey);
      if (sellerAircraftIds && !sellerAircraftIds.has(listing.instanceId)) {
        logger.info(
          `Filtering stale listing: ${listing.instanceId} (seller ${listing.sellerPubkey.slice(0, 8)}... no longer owns it)`,
        );
        return false;
      }

      return true;
    });
    const filtered = beforeCount - result.length;
    if (filtered > 0) {
      logger.info(`Filtered ${filtered} stale marketplace listing(s) via ownership verification.`);
    }
  }

  result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  logger.info(`Returning ${result.length} unique marketplace listings.`);
  return result;
}
/**
 * Loads all active airlines from the global network.
 */
export async function loadGlobalAirlines(): Promise<never> {
  throw new Error("Snapshot loading is disabled for action-log worlds.");
}
