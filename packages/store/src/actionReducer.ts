import type {
  AircraftInstance,
  AirlineEntity,
  Checkpoint,
  FixedPoint,
  Route,
  TimelineEvent,
  TimelineEventType,
} from "@acars/core";
import {
  calculateBookValue,
  computeActionChainHash,
  fp,
  fpAdd,
  fpFormat,
  fpScale,
  fpSub,
  GENESIS_TIME,
  getSuggestedFares,
  ROUTE_SLOT_FEE,
  TICK_DURATION,
  TICKS_PER_HOUR,
} from "@acars/core";
import { getAircraftById } from "@acars/data";
import { reconcileFleetToTick } from "./FlightEngine";

export interface ActionRecord {
  action: import("@acars/core").GameActionEnvelope;
  eventId: string;
  authorPubkey: string;
  createdAt: number | null;
}

export interface ActionReplayResult {
  airline: AirlineEntity | null;
  fleet: AircraftInstance[];
  routes: Route[];
  timeline: TimelineEvent[];
  actionChainHash: string;
  /** True when the action log ends with AIRLINE_DISSOLVE — the airline was intentionally removed. */
  dissolved: boolean;
}

const MAX_TIMELINE_EVENTS = 1000;

const DEFAULT_LIVERY = {
  primary: "#1f2937",
  secondary: "#3b82f6",
  accent: "#f59e0b",
};

const MAX_NAME_LENGTH = 64;
const MAX_CODE_LENGTH = 8;
const MAX_HUBS = 12;
const MAX_DISTANCE_KM = 20000;
const MAX_FARE = fp(10000);
const MAX_PRICE = fp(1000000000);
const MIN_BALANCE = fp(-1000000000);
const MAX_BALANCE = fp(1000000000);
const VALID_STATUSES: AirlineEntity["status"][] = ["private", "public", "chapter11", "liquidated"];
const TIMELINE_EVENT_TYPES: ReadonlySet<TimelineEventType> = new Set([
  "takeoff",
  "landing",
  "purchase",
  "sale",
  "lease_payment",
  "maintenance",
  "delivery",
  "hub_change",
  "route_change",
  "ferry",
  "competitor_hub",
  "price_war",
  "tier_upgrade",
  "bankruptcy",
  "financial_warning",
]);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const isTimelineEventType = (value: string): value is TimelineEventType =>
  TIMELINE_EVENT_TYPES.has(value as TimelineEventType);

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const clampInt = (value: unknown, min: number, max: number): number | null => {
  const numeric = asNumber(value);
  if (numeric === null) return null;
  const rounded = Math.floor(numeric);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
};

const clampNumber = (value: unknown, min: number, max: number): number | null => {
  const numeric = asNumber(value);
  if (numeric === null) return null;
  if (numeric < min) return min;
  if (numeric > max) return max;
  return numeric;
};

const clampString = (value: unknown, maxLength: number): string | null => {
  const str = asString(value);
  if (!str) return null;
  return str.slice(0, maxLength);
};

const sanitizeIata = (value: unknown): string | null => {
  const str = asString(value);
  if (!str) return null;
  const trimmed = str.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(trimmed)) return null;
  return trimmed;
};

const clampFixedPoint = (value: unknown, min: FixedPoint, max: FixedPoint): FixedPoint | null => {
  const numeric = asNumber(value);
  if (numeric === null) return null;
  const rounded = Math.round(numeric);
  const clamped = Math.min(Math.max(rounded, min), max);
  return clamped as FixedPoint;
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => asString(item)).filter((item): item is string => Boolean(item))
    : [];

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const buildAircraftName = (modelName: string | undefined, index: number) =>
  `${modelName ?? "Aircraft"} ${index}`;

export async function buildActionChainHashFromRecords(
  previousHash: string,
  records: ActionRecord[],
): Promise<string> {
  const sorted = [...records].sort((a, b) => {
    const aTime = a.createdAt ?? 0;
    const bTime = b.createdAt ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.eventId.localeCompare(b.eventId);
  });
  let hash = previousHash;
  for (const record of sorted) {
    hash = await computeActionChainHash(hash, {
      id: record.eventId,
      createdAt: record.createdAt,
      authorPubkey: record.authorPubkey,
      action: record.action,
    });
  }
  return hash;
}

/**
 * Replays the action log to rebuild airline state.
 */
export async function replayActionLog(params: {
  pubkey: string;
  actions: ActionRecord[];
  checkpoint?: Checkpoint | null;
  rejectedEventIds?: Set<string>;
}): Promise<ActionReplayResult> {
  const { pubkey, actions, checkpoint, rejectedEventIds } = params;

  let airline: AirlineEntity | null = checkpoint?.airline ?? null;
  let dissolved = false;
  const fleetById = new Map<string, AircraftInstance>();
  const routesById = new Map<string, Route>();
  const timeline: TimelineEvent[] = checkpoint?.timeline ? [...checkpoint.timeline] : [];
  const timelineEventIds = new Set(timeline.map((event) => event.id));
  let allowActionTimeline = timeline.length === 0;
  let actionChainHash = checkpoint?.actionChainHash ?? "";

  // Track the most recent authoritative fleet/route IDs from TICK_UPDATE.
  // These override locally-derived IDs at the end of replay, fixing
  // count divergence when action events are missing from relay delivery.
  let authoritativeFleetIds: string[] | null = null;
  let authoritativeRouteIds: string[] | null = null;

  if (checkpoint?.fleet) {
    for (const aircraft of checkpoint.fleet) {
      fleetById.set(aircraft.id, { ...aircraft });
    }
  }

  if (checkpoint?.routes) {
    // Deduplicate checkpoint routes by origin:destination pair.
    // If a checkpoint was saved with duplicate routes (same O/D),
    // keep only the first and merge assignedAircraftIds.
    const checkpointRouteKeys = new Map<string, string>();
    // Maps removed duplicate routeId -> canonical routeId for fleet fixup below.
    const removedRouteAliases = new Map<string, string>();
    for (const route of checkpoint.routes) {
      const odKey = `${route.originIata}:${route.destinationIata}`;
      const canonicalId = checkpointRouteKeys.get(odKey);
      if (canonicalId) {
        // Merge aircraft assignments into the canonical route
        const canonical = routesById.get(canonicalId);
        if (canonical) {
          const mergedIds = new Set([
            ...canonical.assignedAircraftIds,
            ...route.assignedAircraftIds,
          ]);
          routesById.set(canonicalId, {
            ...canonical,
            assignedAircraftIds: [...mergedIds],
          });
        }
        removedRouteAliases.set(route.id, canonicalId);
      } else {
        checkpointRouteKeys.set(odKey, route.id);
        routesById.set(route.id, { ...route });
      }
    }
    // Fix up any aircraft whose assignedRouteId points at a removed duplicate.
    if (removedRouteAliases.size > 0) {
      for (const aircraft of fleetById.values()) {
        if (aircraft.assignedRouteId) {
          const canonical = removedRouteAliases.get(aircraft.assignedRouteId);
          if (canonical) {
            aircraft.assignedRouteId = canonical;
          }
        }
      }
    }
  }

  const applyBalanceDelta = (delta: FixedPoint) => {
    if (!airline) return;
    const nextBalance = fpAdd(airline.corporateBalance, delta);
    const clampedBalance = clampFixedPoint(nextBalance, MIN_BALANCE, MAX_BALANCE) ?? nextBalance;
    airline = { ...airline, corporateBalance: clampedBalance };
  };

  /**
   * During replay, canAfford uses a soft floor rather than strict
   * balance enforcement.  Only the latest TICK_UPDATE survives on relays
   * due to NIP-33 replacement, so intermediate flight revenue is
   * invisible during replay.  A strict check would reject legitimate
   * purchases.  Instead we allow purchases as long as the balance stays
   * above REPLAY_SOFT_FLOOR (-$50M), which is generous enough for
   * revenue gaps but blocks unlimited spending exploits.
   */
  const REPLAY_SOFT_FLOOR = fp(-50_000_000);
  const canAfford = (cost: FixedPoint): boolean => {
    if (!airline) return false;
    const projectedBalance = fpSub(airline.corporateBalance, cost);
    return projectedBalance >= REPLAY_SOFT_FLOOR;
  };

  const resolveEventTimestamp = (tick: number, createdAt: number | null) =>
    typeof createdAt === "number" && Number.isFinite(createdAt)
      ? createdAt * 1000
      : GENESIS_TIME + tick * TICK_DURATION;

  const pushTimelineEvent = (event: TimelineEvent) => {
    if (!allowActionTimeline && event.id.startsWith("evt-action-")) return;
    if (timelineEventIds.has(event.id)) return;
    timeline.unshift(event);
    timelineEventIds.add(event.id);
    if (timeline.length > MAX_TIMELINE_EVENTS) {
      timeline.length = MAX_TIMELINE_EVENTS;
      timelineEventIds.clear();
      for (const item of timeline) timelineEventIds.add(item.id);
    }
  };

  const mergeTickTimelineEvents = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const candidate of value) {
      const record = asRecord(candidate);
      if (!record) continue;
      const id = asString(record.id);
      const type = asString(record.type);
      const description = asString(record.description);
      const tick = clampInt(record.tick, 0, Number.MAX_SAFE_INTEGER);
      const timestamp = clampInt(record.timestamp, 0, Number.MAX_SAFE_INTEGER);
      if (
        !id ||
        !type ||
        !isTimelineEventType(type) ||
        !description ||
        tick == null ||
        timestamp == null
      )
        continue;
      const event: TimelineEvent = {
        id,
        type,
        description,
        tick,
        timestamp,
      };
      const aircraftId = asString(record.aircraftId);
      if (aircraftId) event.aircraftId = aircraftId;
      const aircraftName = asString(record.aircraftName);
      if (aircraftName) event.aircraftName = aircraftName;
      const routeId = asString(record.routeId);
      if (routeId) event.routeId = routeId;
      const originIata = sanitizeIata(record.originIata);
      if (originIata) event.originIata = originIata;
      const destinationIata = sanitizeIata(record.destinationIata);
      if (destinationIata) event.destinationIata = destinationIata;
      const revenue = clampFixedPoint(record.revenue, MIN_BALANCE, MAX_BALANCE);
      if (revenue != null) event.revenue = revenue;
      const cost = clampFixedPoint(record.cost, MIN_BALANCE, MAX_BALANCE);
      if (cost != null) event.cost = cost;
      const profit = clampFixedPoint(record.profit, MIN_BALANCE, MAX_BALANCE);
      if (profit != null) event.profit = profit;
      const details = asRecord(record.details);
      if (details) event.details = details as TimelineEvent["details"];
      pushTimelineEvent(event);
    }
  };

  const sortedTimeline = () =>
    timeline
      .slice()
      .sort((a, b) => (a.tick !== b.tick ? b.tick - a.tick : b.timestamp - a.timestamp));

  const fpZero = fp(0);
  const routePairKey = (originIata: string, destinationIata: string) =>
    `${originIata}:${destinationIata}`;
  const routePairs = new Set<string>(
    [...routesById.values()].map((route) => routePairKey(route.originIata, route.destinationIata)),
  );
  const routePairToRouteId = new Map<string, string>(
    [...routesById.values()].map((route) => [
      routePairKey(route.originIata, route.destinationIata),
      route.id,
    ]),
  );
  // Maps duplicate route IDs (from retried ROUTE_OPEN events) to the
  // canonical route ID so later actions still resolve to a single route.
  const routeIdAliases = new Map<string, string>();
  const resolveRouteId = (routeId: string | null) =>
    routeId ? (routeIdAliases.get(routeId) ?? routeId) : null;

  const filteredActions = actions.filter((record) => record.authorPubkey === pubkey);
  const sortedActions = [...filteredActions].sort((a, b) => {
    const aTime = a.createdAt ?? 0;
    const bTime = b.createdAt ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.eventId.localeCompare(b.eventId);
  });
  let bootstrapTick: number | null = null;

  // Bootstrap: If no checkpoint and no AIRLINE_CREATE in the action log,
  // use the latest TICK_UPDATE to create a synthetic airline entity.
  // This prevents competitors from being invisible when their AIRLINE_CREATE
  // event is missing from relay responses (relay pruning, different relays, etc.).
  if (!airline) {
    const hasAirlineCreate = sortedActions.some(
      (record) => record.action.action === "AIRLINE_CREATE",
    );
    if (!hasAirlineCreate) {
      // Find the latest TICK_UPDATE (last in sorted order since it's the most recent).
      for (let i = sortedActions.length - 1; i >= 0; i--) {
        const record = sortedActions[i];
        if (record.action.action === "TICK_UPDATE") {
          const payload = record.action.payload;
          const tick = clampInt(payload.tick, 0, Number.MAX_SAFE_INTEGER) ?? 0;
          const corporateBalance =
            clampFixedPoint(payload.corporateBalance, MIN_BALANCE, MAX_BALANCE) ?? fp(100000000);
          const name = clampString(payload.airlineName, MAX_NAME_LENGTH) ?? "Unknown Airline";
          const icaoCode = clampString(payload.icaoCode, MAX_CODE_LENGTH) ?? "";
          const callsign = clampString(payload.callsign, MAX_CODE_LENGTH) ?? "";
          const hubs = asStringArray(payload.hubs)
            .map((hub) => sanitizeIata(hub))
            .filter((hub): hub is string => Boolean(hub))
            .slice(0, MAX_HUBS);
          const liveryPayload = asRecord(payload.livery);
          const livery = liveryPayload
            ? {
                primary: asString(liveryPayload.primary) ?? DEFAULT_LIVERY.primary,
                secondary: asString(liveryPayload.secondary) ?? DEFAULT_LIVERY.secondary,
                accent: asString(liveryPayload.accent) ?? DEFAULT_LIVERY.accent,
              }
            : { ...DEFAULT_LIVERY };
          const status =
            typeof payload.status === "string" &&
            VALID_STATUSES.includes(payload.status as AirlineEntity["status"])
              ? (payload.status as AirlineEntity["status"])
              : "private";
          const tier = clampInt(payload.tier, 1, 10) ?? 1;
          const brandScore = clampNumber(payload.brandScore, 0, 1) ?? 0.5;
          const cumulativeRevenue =
            clampFixedPoint(payload.cumulativeRevenue, fp(0), MAX_BALANCE) ?? fp(0);
          const payloadFleetIds = asStringArray(payload.fleetIds);
          const payloadRouteIds = asStringArray(payload.routeIds);
          if (payloadFleetIds.length > 0) authoritativeFleetIds = payloadFleetIds;
          if (payloadRouteIds.length > 0) authoritativeRouteIds = payloadRouteIds;

          dissolved = false;
          bootstrapTick = tick;
          airline = {
            id: `bootstrap:${record.eventId}`,
            foundedBy: pubkey,
            status,
            ceoPubkey: pubkey,
            sharesOutstanding: 10000000,
            shareholders: { [pubkey]: 10000000 },
            name,
            icaoCode,
            callsign,
            hubs,
            livery,
            brandScore,
            tier,
            cumulativeRevenue,
            corporateBalance,
            stockPrice: fp(10),
            fleetIds: payloadFleetIds,
            routeIds: payloadRouteIds,
            lastTick: tick,
          };
          break;
        }
      }
    }
  }

  for (const record of sortedActions) {
    const { action } = record;
    if (rejectedEventIds?.has(record.eventId)) continue;
    const payload = action.payload;
    // Clamp payload.tick against event.created_at to prevent tick time-travel.
    // Max allowed tick = derived from event timestamp + 1 hour tolerance.
    // Only applies when the event timestamp is after GENESIS_TIME (valid game era).
    const rawActionTick = clampInt(payload.tick, 0, Number.MAX_SAFE_INTEGER) ?? 0;
    const genesisSeconds = Math.floor(GENESIS_TIME / 1000);
    const maxTickFromTimestamp =
      typeof record.createdAt === "number" &&
      Number.isFinite(record.createdAt) &&
      record.createdAt > genesisSeconds
        ? Math.floor((record.createdAt * 1000 - GENESIS_TIME) / TICK_DURATION) + TICKS_PER_HOUR
        : Number.MAX_SAFE_INTEGER;
    const actionTick = Math.min(rawActionTick, maxTickFromTimestamp);
    if (bootstrapTick != null && actionTick <= bootstrapTick) continue;
    const eventTimestamp = resolveEventTimestamp(actionTick, record.createdAt);
    actionChainHash = await computeActionChainHash(actionChainHash, {
      id: record.eventId,
      createdAt: record.createdAt,
      authorPubkey: record.authorPubkey,
      action,
    });

    if (action.action === "AIRLINE_CREATE") {
      // Starting a new airline resets all prior owned state.
      fleetById.clear();
      routesById.clear();
      routePairs.clear();
      routePairToRouteId.clear();
      routeIdAliases.clear();
      timeline.splice(0, timeline.length);
      timelineEventIds.clear();
      allowActionTimeline = true;

      const name = clampString(payload.name, MAX_NAME_LENGTH) ?? "New Airline";
      const icaoCode = clampString(payload.icaoCode, MAX_CODE_LENGTH) ?? "";
      const callsign = clampString(payload.callsign, MAX_CODE_LENGTH) ?? "";
      const hubs = asStringArray(payload.hubs)
        .map((hub) => sanitizeIata(hub))
        .filter((hub): hub is string => Boolean(hub))
        .slice(0, MAX_HUBS);
      const liveryPayload = asRecord(payload.livery);
      const livery = {
        primary: asString(liveryPayload?.primary) ?? DEFAULT_LIVERY.primary,
        secondary: asString(liveryPayload?.secondary) ?? DEFAULT_LIVERY.secondary,
        accent: asString(liveryPayload?.accent) ?? DEFAULT_LIVERY.accent,
      };
      const corporateBalance =
        clampFixedPoint(payload.corporateBalance ?? fp(100000000), MIN_BALANCE, MAX_BALANCE) ??
        fp(100000000);

      dissolved = false;
      airline = {
        id: `action:${record.eventId}`,
        foundedBy: pubkey,
        status: "private",
        ceoPubkey: pubkey,
        sharesOutstanding: 10000000,
        shareholders: { [pubkey]: 10000000 },
        name,
        icaoCode,
        callsign,
        hubs,
        livery,
        brandScore: 0.5,
        tier: 1,
        cumulativeRevenue: fp(0),
        corporateBalance,
        stockPrice: fp(10),
        fleetIds: [],
        routeIds: [],
        lastTick: actionTick,
      };
      continue;
    }

    if (action.action === "AIRLINE_DISSOLVE") {
      // Dissolution wipes the owned airline state so IdentityGate can re-open
      // airline creation on reload before a fresh AIRLINE_CREATE event.
      airline = null;
      dissolved = true;
      fleetById.clear();
      routesById.clear();
      routePairs.clear();
      routePairToRouteId.clear();
      routeIdAliases.clear();
      timeline.splice(0, timeline.length);
      timelineEventIds.clear();
      allowActionTimeline = true;
      continue;
    }

    if (!airline) continue;

    const updateLastTick = (tickValue: number) => {
      const nextTick = Math.max(airline?.lastTick ?? 0, tickValue);
      airline = airline ? { ...airline, lastTick: nextTick } : airline;
    };

    if (
      (airline.status === "chapter11" || airline.status === "liquidated") &&
      action.action !== "TICK_UPDATE"
    ) {
      continue;
    }

    switch (action.action) {
      case "TICK_UPDATE": {
        const status = asString(payload.status);
        if (status && VALID_STATUSES.includes(status as AirlineEntity["status"])) {
          airline = { ...airline, status: status as AirlineEntity["status"] };
        }

        // Track authoritative fleet/route IDs from the TICK_UPDATE payload.
        // The publishing client includes these from its local state, so they
        // reflect the true set of aircraft and routes regardless of whether
        // the viewer received every individual action event.
        const payloadFleetIds = asStringArray(payload.fleetIds);
        const payloadRouteIds = asStringArray(payload.routeIds);
        if (payloadFleetIds.length > 0) authoritativeFleetIds = payloadFleetIds;
        if (payloadRouteIds.length > 0) authoritativeRouteIds = payloadRouteIds;

        if (airline.status === "chapter11" || airline.status === "liquidated") {
          const groundedFleet = Array.from(fleetById.values()).map((aircraft) => {
            if (aircraft.status === "enroute") {
              return {
                ...aircraft,
                status: "idle" as const,
                baseAirportIata: aircraft.flight?.originIata ?? aircraft.baseAirportIata,
                flight: null,
                turnaroundEndTick: undefined,
                arrivalTickProcessed: undefined,
              };
            }
            if (aircraft.status === "turnaround") {
              return {
                ...aircraft,
                status: "idle" as const,
                flight: null,
                turnaroundEndTick: undefined,
                arrivalTickProcessed: undefined,
              };
            }
            return aircraft;
          });
          fleetById.clear();
          for (const aircraft of groundedFleet) {
            fleetById.set(aircraft.id, aircraft);
          }

          updateLastTick(actionTick);
          mergeTickTimelineEvents(payload.timeline);
          break;
        }

        const previousTick = airline.lastTick ?? 0;
        if (actionTick > previousTick) {
          const tier = clampInt(payload.tier, 1, 10);
          if (tier != null) {
            airline = { ...airline, tier };
          }
          const authoritativeBrandScore = clampNumber(payload.brandScore, 0, 1);
          if (authoritativeBrandScore != null) {
            airline = { ...airline, brandScore: authoritativeBrandScore };
          }
          const authoritativeCumulativeRevenue = clampFixedPoint(
            payload.cumulativeRevenue,
            fp(0),
            MAX_BALANCE,
          );
          if (authoritativeCumulativeRevenue != null) {
            airline = {
              ...airline,
              cumulativeRevenue: authoritativeCumulativeRevenue,
            };
          }
          const { fleet: reconciledFleet, balanceDelta } = reconcileFleetToTick(
            Array.from(fleetById.values()),
            Array.from(routesById.values()),
            actionTick,
          );
          // Use authoritative balance from the TICK_UPDATE payload when
          // available.  The publishing client computed this via the full
          // demand engine (QSI, competition, price elasticity), which is
          // far more accurate than the simplified estimation produced by
          // reconcileFleetToTick.  Fall back to the estimated delta for
          // old events that predate this field.
          const authoritativeBalance = clampFixedPoint(
            payload.corporateBalance,
            MIN_BALANCE,
            MAX_BALANCE,
          );
          if (authoritativeBalance != null) {
            airline = { ...airline, corporateBalance: authoritativeBalance };
          } else {
            applyBalanceDelta(balanceDelta);
          }
          fleetById.clear();
          for (const aircraft of reconciledFleet) {
            fleetById.set(aircraft.id, aircraft);
          }
        }

        // Prune aircraft/routes that the authoritative TICK_UPDATE says no
        // longer exist (e.g. sold aircraft, closed routes).  This prevents
        // ghost entries from lingering in the viewer's reconstruction.
        if (authoritativeFleetIds) {
          const validFleetSet = new Set(authoritativeFleetIds);
          for (const id of fleetById.keys()) {
            if (!validFleetSet.has(id)) fleetById.delete(id);
          }
        }
        if (authoritativeRouteIds) {
          const validRouteSet = new Set(authoritativeRouteIds);
          for (const id of routesById.keys()) {
            if (!validRouteSet.has(id)) routesById.delete(id);
          }
        }

        updateLastTick(actionTick);
        mergeTickTimelineEvents(payload.timeline);
        break;
      }
      case "HUB_ADD": {
        const iata = sanitizeIata(payload.iata);
        const fee = clampFixedPoint(payload.fee, fpZero, MAX_PRICE) ?? fpZero;
        if (!canAfford(fee)) break;
        if (iata && airline.hubs.length < MAX_HUBS && !airline.hubs.includes(iata)) {
          airline = { ...airline, hubs: [...airline.hubs, iata] };
        }
        applyBalanceDelta(fpSub(fpZero, fee));
        updateLastTick(actionTick);
        if (iata) {
          pushTimelineEvent({
            id: `evt-action-${record.eventId}`,
            tick: actionTick,
            timestamp: eventTimestamp,
            type: "hub_change",
            description: `Hub added at ${iata}.`,
            cost: fee,
          });
        }
        break;
      }
      case "HUB_REMOVE": {
        const iata = sanitizeIata(payload.iata);
        if (iata) {
          airline = {
            ...airline,
            hubs: airline.hubs.filter((hub) => hub !== iata),
          };
        }
        updateLastTick(actionTick);
        if (iata) {
          pushTimelineEvent({
            id: `evt-action-${record.eventId}`,
            tick: actionTick,
            timestamp: eventTimestamp,
            type: "hub_change",
            description: `Hub removed at ${iata}.`,
          });
        }
        break;
      }
      case "HUB_SWITCH": {
        const iata = sanitizeIata(payload.iata);
        const fee = clampFixedPoint(payload.fee, fpZero, MAX_PRICE) ?? fpZero;
        if (!canAfford(fee)) break;
        if (iata && airline.hubs.includes(iata)) {
          airline = {
            ...airline,
            hubs: [iata, ...airline.hubs.filter((hub) => hub !== iata)],
          };
        }
        applyBalanceDelta(fpSub(fpZero, fee));
        updateLastTick(actionTick);
        if (iata) {
          pushTimelineEvent({
            id: `evt-action-${record.eventId}`,
            tick: actionTick,
            timestamp: eventTimestamp,
            type: "hub_change",
            description: `Hub switched to ${iata}.`,
            cost: fee,
          });
        }
        break;
      }
      case "ROUTE_OPEN": {
        const routeId = clampString(payload.routeId, 64);
        const originIata = sanitizeIata(payload.originIata);
        const destinationIata = sanitizeIata(payload.destinationIata);
        const distanceKm = clampNumber(payload.distanceKm, 1, MAX_DISTANCE_KM);
        if (!routeId || !originIata || !destinationIata || !distanceKm) break;
        const pairKey = routePairKey(originIata, destinationIata);
        const existingRouteId = routePairs.has(pairKey)
          ? routePairToRouteId.get(pairKey)
          : undefined;
        const existingRoute = existingRouteId ? routesById.get(existingRouteId) : undefined;
        if (existingRoute) {
          routeIdAliases.set(routeId, existingRoute.id);
          break;
        }

        const faresPayload = asRecord(payload.fares);
        const suggested = getSuggestedFares(distanceKm);
        const fareEconomy =
          clampFixedPoint(faresPayload?.economy ?? suggested.economy, fpZero, MAX_FARE) ??
          suggested.economy;
        const fareBusiness =
          clampFixedPoint(faresPayload?.business ?? suggested.business, fpZero, MAX_FARE) ??
          suggested.business;
        const fareFirst =
          clampFixedPoint(faresPayload?.first ?? suggested.first, fpZero, MAX_FARE) ??
          suggested.first;
        const frequencyPerWeek = clampInt(payload.frequencyPerWeek, 0, 1000) ?? 7;

        const routeCost = ROUTE_SLOT_FEE;
        if (!canAfford(routeCost)) break;

        routesById.set(routeId, {
          id: routeId,
          originIata,
          destinationIata,
          airlinePubkey: pubkey,
          distanceKm,
          frequencyPerWeek,
          assignedAircraftIds: [],
          fareEconomy,
          fareBusiness,
          fareFirst,
          status: "active",
        });
        routePairs.add(pairKey);
        routePairToRouteId.set(pairKey, routeId);

        applyBalanceDelta(fpSub(fpZero, routeCost ?? ROUTE_SLOT_FEE));
        updateLastTick(actionTick);
        pushTimelineEvent({
          id: `evt-action-${record.eventId}`,
          tick: actionTick,
          timestamp: eventTimestamp,
          type: "route_change",
          routeId,
          originIata: originIata || undefined,
          destinationIata: destinationIata || undefined,
          description: `Opened route ${originIata} ↔ ${destinationIata}.`,
          cost: routeCost ?? ROUTE_SLOT_FEE,
        });
        break;
      }
      case "ROUTE_CLOSE": {
        const routeId = resolveRouteId(clampString(payload.routeId, 64));
        if (!routeId) break;
        const route = routesById.get(routeId);
        routesById.delete(routeId);
        if (route) {
          const pairKey = routePairKey(route.originIata, route.destinationIata);
          routePairs.delete(pairKey);
          routePairToRouteId.delete(pairKey);
        }
        for (const aircraft of fleetById.values()) {
          if (aircraft.assignedRouteId === routeId) {
            aircraft.assignedRouteId = null;
          }
        }
        updateLastTick(actionTick);
        pushTimelineEvent({
          id: `evt-action-${record.eventId}`,
          tick: actionTick,
          timestamp: eventTimestamp,
          type: "route_change",
          routeId,
          originIata: route?.originIata,
          destinationIata: route?.destinationIata,
          description: route
            ? `Closed route ${route.originIata} ↔ ${route.destinationIata}.`
            : `Closed route ${routeId}.`,
        });
        break;
      }
      case "ROUTE_REBASE": {
        const routeId = resolveRouteId(clampString(payload.routeId, 64));
        if (!routeId) break;
        const originIata = sanitizeIata(payload.originIata);
        const destinationIata = sanitizeIata(payload.destinationIata);
        if (!originIata || !destinationIata) break;
        const route = routesById.get(routeId);
        if (!route) break;
        const previousPairKey = routePairKey(route.originIata, route.destinationIata);
        routePairs.delete(previousPairKey);
        routePairToRouteId.delete(previousPairKey);
        routesById.set(routeId, {
          ...route,
          originIata,
          destinationIata,
          status: "active",
          assignedAircraftIds: [],
        });
        const nextPairKey = routePairKey(originIata, destinationIata);
        routePairs.add(nextPairKey);
        routePairToRouteId.set(nextPairKey, routeId);
        updateLastTick(actionTick);
        pushTimelineEvent({
          id: `evt-action-${record.eventId}`,
          tick: actionTick,
          timestamp: eventTimestamp,
          type: "route_change",
          routeId,
          originIata: originIata || undefined,
          destinationIata: destinationIata || undefined,
          description: `Rebased route to ${originIata} ↔ ${destinationIata}.`,
        });
        break;
      }
      case "ROUTE_ASSIGN_AIRCRAFT": {
        const aircraftId = clampString(payload.aircraftId, 64);
        const routeId = resolveRouteId(clampString(payload.routeId, 64));
        if (!aircraftId || !routeId) break;
        const aircraft = fleetById.get(aircraftId);
        const route = routesById.get(routeId);
        if (!aircraft || !route) break;
        // Remove from previous route's assignedAircraftIds
        if (aircraft.assignedRouteId && aircraft.assignedRouteId !== routeId) {
          const prevRoute = routesById.get(aircraft.assignedRouteId);
          if (prevRoute) {
            prevRoute.assignedAircraftIds = prevRoute.assignedAircraftIds.filter(
              (id) => id !== aircraftId,
            );
          }
        }
        aircraft.assignedRouteId = routeId;
        aircraft.routeAssignedAtTick = actionTick;
        aircraft.routeAssignedAtIata = aircraft.baseAirportIata;
        aircraft.lastKnownLoadFactor = undefined;
        // Clear stale flight state from a previous cycle so reconcileFleetToTick
        // uses routeAssignedAtTick as the new cycle anchor instead of old departureTick.
        if (aircraft.flight && actionTick >= aircraft.flight.departureTick) {
          aircraft.status = "idle";
          aircraft.flight = null;
          aircraft.turnaroundEndTick = undefined;
          aircraft.arrivalTickProcessed = undefined;
        }
        if (!route.assignedAircraftIds.includes(aircraftId)) {
          route.assignedAircraftIds = [...route.assignedAircraftIds, aircraftId];
        }
        updateLastTick(actionTick);
        pushTimelineEvent({
          id: `evt-action-${record.eventId}`,
          tick: actionTick,
          timestamp: eventTimestamp,
          type: "route_change",
          routeId,
          originIata: route.originIata,
          destinationIata: route.destinationIata,
          description: `Assigned aircraft ${aircraftId} to ${route.originIata} ↔ ${route.destinationIata}.`,
        });
        break;
      }
      case "ROUTE_UNASSIGN_AIRCRAFT": {
        const aircraftId = clampString(payload.aircraftId, 64);
        const routeId = resolveRouteId(clampString(payload.routeId, 64));
        if (!aircraftId) break;
        const aircraft = fleetById.get(aircraftId);
        if (aircraft) {
          aircraft.assignedRouteId = null;
          aircraft.routeAssignedAtTick = undefined;
          aircraft.routeAssignedAtIata = undefined;
          aircraft.lastKnownLoadFactor = undefined;
          if (aircraft.status === "turnaround") {
            aircraft.status = "idle";
            aircraft.flight = null;
            aircraft.turnaroundEndTick = undefined;
            aircraft.arrivalTickProcessed = undefined;
          }
        }
        if (routeId) {
          const route = routesById.get(routeId);
          if (route) {
            route.assignedAircraftIds = route.assignedAircraftIds.filter((id) => id !== aircraftId);
          }
        } else {
          for (const route of routesById.values()) {
            route.assignedAircraftIds = route.assignedAircraftIds.filter((id) => id !== aircraftId);
          }
        }
        updateLastTick(actionTick);
        const route = routeId ? routesById.get(routeId) : null;
        pushTimelineEvent({
          id: `evt-action-${record.eventId}`,
          tick: actionTick,
          timestamp: eventTimestamp,
          type: "route_change",
          routeId: routeId ?? undefined,
          originIata: route?.originIata,
          destinationIata: route?.destinationIata,
          description: route
            ? `Unassigned aircraft ${aircraftId} from ${route.originIata} ↔ ${route.destinationIata}.`
            : `Unassigned aircraft ${aircraftId} from its route.`,
        });
        break;
      }
      case "ROUTE_UPDATE_FARES": {
        const routeId = resolveRouteId(clampString(payload.routeId, 64));
        if (!routeId) break;
        const faresPayload = asRecord(payload.fares);
        const route = routesById.get(routeId);
        if (!route || !faresPayload) break;
        routesById.set(routeId, {
          ...route,
          fareEconomy:
            faresPayload.economy != null
              ? (clampFixedPoint(faresPayload.economy, fpZero, MAX_FARE) ?? route.fareEconomy)
              : route.fareEconomy,
          fareBusiness:
            faresPayload.business != null
              ? (clampFixedPoint(faresPayload.business, fpZero, MAX_FARE) ?? route.fareBusiness)
              : route.fareBusiness,
          fareFirst:
            faresPayload.first != null
              ? (clampFixedPoint(faresPayload.first, fpZero, MAX_FARE) ?? route.fareFirst)
              : route.fareFirst,
        });
        updateLastTick(actionTick);
        pushTimelineEvent({
          id: `evt-action-${record.eventId}`,
          tick: actionTick,
          timestamp: eventTimestamp,
          type: "route_change",
          routeId,
          originIata: route.originIata,
          destinationIata: route.destinationIata,
          description: `Updated fares for ${route.originIata} ↔ ${route.destinationIata}.`,
        });
        break;
      }
      case "AIRCRAFT_PURCHASE": {
        const instanceId = clampString(payload.instanceId, 64);
        const modelId = clampString(payload.modelId, 64);
        const deliveryHubIata = sanitizeIata(payload.deliveryHubIata) ?? "XXX";
        if (!instanceId || !modelId) break;
        if (fleetById.has(instanceId)) break;
        const model = getAircraftById(modelId);
        if (!model) break;
        const configurationPayload = asRecord(payload.configuration);
        const configuration = {
          economy: clampInt(configurationPayload?.economy, 0, 1000) ?? model.capacity.economy,
          business: clampInt(configurationPayload?.business, 0, 1000) ?? model.capacity.business,
          first: clampInt(configurationPayload?.first, 0, 1000) ?? model.capacity.first,
          cargoKg: clampInt(configurationPayload?.cargoKg, 0, 1000000) ?? model.capacity.cargoKg,
        };
        const purchaseType = payload.purchaseType === "lease" ? "lease" : "buy";
        const price = purchaseType === "buy" ? model.price : fpScale(model.price, 0.1);
        if (!canAfford(price)) break;
        const name =
          clampString(payload.name, MAX_NAME_LENGTH) ??
          buildAircraftName(model.name, fleetById.size + 1);
        const deliveryAtTick = actionTick + model.deliveryTimeTicks;
        const newAircraft: AircraftInstance = {
          id: instanceId,
          ownerPubkey: pubkey,
          modelId,
          name,
          status: "delivery",
          purchaseType,
          leaseStartedAtTick: purchaseType === "lease" ? actionTick : undefined,
          assignedRouteId: null,
          baseAirportIata: deliveryHubIata,
          purchasedAtTick: actionTick,
          purchasePrice: price,
          birthTick: actionTick,
          deliveryAtTick,
          flight: null,
          configuration,
          flightHoursTotal: 0,
          flightHoursSinceCheck: 0,
          condition: 1.0,
        };
        fleetById.set(instanceId, newAircraft);
        applyBalanceDelta(fpSub(fpZero, price));
        updateLastTick(actionTick);
        pushTimelineEvent({
          id: `evt-action-${record.eventId}`,
          tick: actionTick,
          timestamp: eventTimestamp,
          type: "purchase",
          aircraftId: instanceId,
          aircraftName: name,
          cost: price,
          description: `Purchased ${model.name} for ${fpFormat(price, 0)}.`,
        });
        break;
      }
      case "AIRCRAFT_SELL": {
        const instanceId = clampString(payload.instanceId, 64);
        if (!instanceId) break;
        const aircraft = fleetById.get(instanceId);
        if (!aircraft) break;
        fleetById.delete(instanceId);
        for (const route of routesById.values()) {
          route.assignedAircraftIds = route.assignedAircraftIds.filter((id) => id !== instanceId);
        }
        const model = getAircraftById(aircraft?.modelId ?? "");
        if (!model) break;
        const isLease = aircraft?.purchaseType === "lease";
        const marketValue = isLease
          ? fp(0)
          : calculateBookValue(
              model,
              aircraft?.flightHoursTotal ?? 0,
              aircraft?.condition ?? 1.0,
              aircraft?.birthTick || aircraft?.purchasedAtTick || actionTick,
              actionTick,
            );
        const salePrice = fpScale(marketValue, 0.7);
        applyBalanceDelta(salePrice);
        updateLastTick(actionTick);
        pushTimelineEvent({
          id: `evt-action-${record.eventId}`,
          tick: actionTick,
          timestamp: eventTimestamp,
          type: "sale",
          aircraftId: instanceId,
          aircraftName: aircraft?.name,
          revenue: salePrice,
          description: `Sold ${aircraft?.name ?? "aircraft"} for ${fpFormat(salePrice, 0)}.`,
        });
        break;
      }
      case "AIRCRAFT_BUYOUT": {
        const instanceId = clampString(payload.instanceId, 64);
        if (!instanceId) break;
        const aircraft = fleetById.get(instanceId);
        if (!aircraft) break;
        const model = getAircraftById(aircraft.modelId);
        if (!model) break;
        const buyoutPrice = calculateBookValue(
          model,
          aircraft.flightHoursTotal,
          aircraft.condition,
          aircraft.birthTick || aircraft.purchasedAtTick,
          actionTick,
        );
        if (!canAfford(buyoutPrice)) break;
        aircraft.purchaseType = "buy";
        applyBalanceDelta(fpSub(fpZero, buyoutPrice));
        updateLastTick(actionTick);
        pushTimelineEvent({
          id: `evt-action-${record.eventId}`,
          tick: actionTick,
          timestamp: eventTimestamp,
          type: "purchase",
          aircraftId: instanceId,
          aircraftName: aircraft.name,
          cost: buyoutPrice,
          description: `Lease buyout for ${aircraft.name} (${fpFormat(buyoutPrice, 0)}).`,
        });
        break;
      }
      case "AIRCRAFT_LIST": {
        const instanceId = clampString(payload.instanceId, 64);
        if (!instanceId) break;
        const aircraft = fleetById.get(instanceId);
        if (!aircraft) break;
        const price = clampFixedPoint(payload.price, fpZero, MAX_PRICE);
        if (!price) break;
        const fee = fpScale(price, 0.005);
        if (!canAfford(fee)) break;
        aircraft.listingPrice = price;
        applyBalanceDelta(fpSub(fpZero, fee));
        updateLastTick(actionTick);
        pushTimelineEvent({
          id: `evt-action-${record.eventId}`,
          tick: actionTick,
          timestamp: eventTimestamp,
          type: "sale",
          aircraftId: instanceId,
          aircraftName: aircraft.name,
          cost: fee,
          description: `Listed ${aircraft.name} for sale (fee ${fpFormat(fee, 0)}).`,
        });
        break;
      }
      case "AIRCRAFT_CANCEL_LIST": {
        const instanceId = clampString(payload.instanceId, 64);
        if (!instanceId) break;
        const aircraft = fleetById.get(instanceId);
        if (!aircraft) break;
        aircraft.listingPrice = null;
        updateLastTick(actionTick);
        pushTimelineEvent({
          id: `evt-action-${record.eventId}`,
          tick: actionTick,
          timestamp: eventTimestamp,
          type: "sale",
          aircraftId: instanceId,
          aircraftName: aircraft.name,
          description: `Cancelled sale listing for ${aircraft.name}.`,
        });
        break;
      }
      case "AIRCRAFT_BUY_USED": {
        const instanceId = clampString(payload.instanceId, 64);
        const modelId = clampString(payload.modelId, 64);
        // Require a non-empty listingId referencing the seller's marketplace event.
        // Without this, an attacker could fabricate a purchase for any aircraft.
        const listingId = clampString(payload.listingId, 128);
        if (!instanceId || !modelId || !listingId) break;
        const price = clampFixedPoint(payload.price, fpZero, MAX_PRICE);
        if (!price) break;
        if (!canAfford(price)) break;
        const name =
          clampString(payload.name, MAX_NAME_LENGTH) ??
          buildAircraftName(undefined, fleetById.size + 1);
        const condition = Math.max(0, Math.min(1, asNumber(payload.condition) ?? 0.8));
        const flightHoursTotal =
          clampNumber(payload.flightHoursTotal, 0, Number.MAX_SAFE_INTEGER) ?? 0;
        const flightHoursSinceCheck =
          clampNumber(payload.flightHoursSinceCheck, 0, Number.MAX_SAFE_INTEGER) ?? 0;
        const birthTick = clampInt(payload.birthTick, 0, Number.MAX_SAFE_INTEGER) ?? actionTick;
        const model = getAircraftById(modelId);
        if (!model) break;
        const configurationPayload = asRecord(payload.configuration);
        const configuration = {
          economy: clampInt(configurationPayload?.economy, 0, 1000) ?? model.capacity.economy,
          business: clampInt(configurationPayload?.business, 0, 1000) ?? model.capacity.business,
          first: clampInt(configurationPayload?.first, 0, 1000) ?? model.capacity.first,
          cargoKg: clampInt(configurationPayload?.cargoKg, 0, 1000000) ?? model.capacity.cargoKg,
        };
        const baseAirportIata = sanitizeIata(payload.baseAirportIata) ?? airline.hubs[0] ?? "XXX";
        const aircraft = fleetById.get(instanceId);

        if (aircraft) {
          aircraft.ownerPubkey = pubkey;
          aircraft.purchasePrice = price;
          aircraft.purchasedAtTick = actionTick;
          aircraft.listingPrice = null;
          aircraft.status = "idle";
          aircraft.deliveryAtTick = undefined;
          aircraft.condition = condition;
          aircraft.flightHoursTotal = flightHoursTotal;
          aircraft.flightHoursSinceCheck = flightHoursSinceCheck;
          aircraft.configuration = configuration;
          aircraft.baseAirportIata = baseAirportIata;
        } else {
          fleetById.set(instanceId, {
            id: instanceId,
            ownerPubkey: pubkey,
            modelId,
            name,
            status: "idle",
            purchaseType: "buy",
            assignedRouteId: null,
            baseAirportIata,
            purchasedAtTick: actionTick,
            purchasePrice: price,
            listingPrice: null,
            birthTick,
            deliveryAtTick: undefined,
            flight: null,
            configuration,
            flightHoursTotal,
            flightHoursSinceCheck,
            condition,
          });
        }

        applyBalanceDelta(fpSub(fpZero, price));
        updateLastTick(actionTick);
        pushTimelineEvent({
          id: `evt-action-${record.eventId}`,
          tick: actionTick,
          timestamp: eventTimestamp,
          type: "purchase",
          aircraftId: instanceId,
          aircraftName: name,
          cost: price,
          description: `Purchased used ${name} for ${fpFormat(price, 0)}.`,
        });
        break;
      }
      case "AIRCRAFT_MAINTENANCE": {
        const instanceId = clampString(payload.instanceId, 64);
        if (!instanceId) break;
        const aircraft = fleetById.get(instanceId);
        if (!aircraft) break;
        const model = getAircraftById(aircraft.modelId);
        if (!model) break;
        const baseFee = fp(15000);
        const repairCost = fpScale(model.price, (1 - aircraft.condition) * 0.1);
        const cost = fpAdd(baseFee, repairCost);
        if (!canAfford(cost)) break;
        aircraft.condition = 1.0;
        aircraft.flightHoursSinceCheck = 0;
        aircraft.status = "maintenance";
        aircraft.maintenanceStartTick = actionTick;
        applyBalanceDelta(fpSub(fpZero, cost));
        updateLastTick(actionTick);
        pushTimelineEvent({
          id: `evt-action-${record.eventId}`,
          tick: actionTick,
          timestamp: eventTimestamp,
          type: "maintenance",
          aircraftId: instanceId,
          aircraftName: aircraft.name,
          cost,
          description: `Maintenance performed on ${aircraft.name} (${fpFormat(cost, 0)}).`,
        });
        break;
      }
      case "AIRCRAFT_FERRY": {
        const instanceId = clampString(payload.instanceId, 64);
        if (!instanceId) break;
        const originIata = sanitizeIata(payload.originIata);
        const destinationIata = sanitizeIata(payload.destinationIata);
        const distanceKm = clampNumber(payload.distanceKm, 1, MAX_DISTANCE_KM);
        const aircraft = fleetById.get(instanceId);
        if (!aircraft || !originIata || !destinationIata) break;
        const model = getAircraftById(aircraft.modelId);
        if (!model || !distanceKm) break;
        const hours = distanceKm / (model.speedKmh || 800);
        const durationTicks = Math.max(1, Math.ceil(hours * TICKS_PER_HOUR));
        aircraft.assignedRouteId = null;
        aircraft.status = "enroute";
        aircraft.flight = {
          originIata,
          destinationIata,
          departureTick: actionTick,
          arrivalTick: actionTick + durationTicks,
          direction: "outbound",
          purpose: "ferry",
          distanceKm: distanceKm ?? undefined,
        };
        updateLastTick(actionTick);
        pushTimelineEvent({
          id: `evt-action-${record.eventId}`,
          tick: actionTick,
          timestamp: eventTimestamp,
          type: "ferry",
          aircraftId: instanceId,
          aircraftName: aircraft.name,
          originIata: originIata || undefined,
          destinationIata: destinationIata || undefined,
          description: `${aircraft.name} ferrying: ${originIata} → ${destinationIata}.`,
        });
        break;
      }
      case "AIRCRAFT_UPDATE_LIVERY": {
        const instanceId = clampString(payload.instanceId, 64);
        const imageUrl = clampString(payload.imageUrl, 4096);
        const promptHash = clampString(payload.promptHash, 128);
        if (!instanceId || !imageUrl || !promptHash) break;
        const aircraft = fleetById.get(instanceId);
        if (!aircraft) break;
        aircraft.liveryImageUrl = imageUrl;
        aircraft.liveryPromptHash = promptHash;
        updateLastTick(actionTick);
        break;
      }
      default:
        updateLastTick(actionTick);
        break;
    }
  }

  let fleet = Array.from(fleetById.values());
  const routes = Array.from(routesById.values());

  const orderedTimeline = sortedTimeline();
  timeline.length = 0;
  timeline.push(...orderedTimeline.slice(0, MAX_TIMELINE_EVENTS));

  fleet = Array.from(fleetById.values());
  if (airline) {
    // Use authoritative fleet/route IDs from the most recent TICK_UPDATE
    // when available.  This ensures counts match what the airline owner
    // published, even if the viewer is missing some action events from
    // relay delivery.  Fall back to locally-derived IDs for old events
    // that predate this field.
    airline = {
      ...airline,
      fleetIds: authoritativeFleetIds ?? fleet.map((aircraft) => aircraft.id),
      routeIds: authoritativeRouteIds ?? routes.map((route) => route.id),
      timeline,
    };
  }

  return { airline, fleet, routes, timeline, actionChainHash, dissolved };
}
