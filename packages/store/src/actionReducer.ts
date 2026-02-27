import type {
  AircraftInstance,
  AirlineEntity,
  Checkpoint,
  FixedPoint,
  Route,
  TimelineEvent,
} from "@airtr/core";
import {
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
} from "@airtr/core";
import { getAircraftById } from "@airtr/data";
import { processFlightEngine } from "./FlightEngine";

export interface ActionRecord {
  action: import("@airtr/core").GameActionEnvelope;
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
}

const MAX_TIMELINE_EVENTS = 1000;
const BACKFILL_TICK_WINDOW = TICKS_PER_HOUR * 6;

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

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

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

export async function replayActionLog(params: {
  pubkey: string;
  actions: ActionRecord[];
  checkpoint?: Checkpoint | null;
}): Promise<ActionReplayResult> {
  const { pubkey, actions, checkpoint } = params;

  let airline: AirlineEntity | null = checkpoint?.airline ?? null;
  const fleetById = new Map<string, AircraftInstance>();
  const routesById = new Map<string, Route>();
  const timeline: TimelineEvent[] = checkpoint?.timeline ? [...checkpoint.timeline] : [];
  const timelineEventIds = new Set(timeline.map((event) => event.id));
  const allowActionTimeline = timeline.length === 0;
  let actionChainHash = checkpoint?.actionChainHash ?? "";

  if (checkpoint?.fleet) {
    for (const aircraft of checkpoint.fleet) {
      fleetById.set(aircraft.id, { ...aircraft });
    }
  }

  if (checkpoint?.routes) {
    for (const route of checkpoint.routes) {
      routesById.set(route.id, { ...route });
    }
  }

  const applyBalanceDelta = (delta: FixedPoint) => {
    if (!airline) return;
    const nextBalance = fpAdd(airline.corporateBalance, delta);
    const clampedBalance = clampFixedPoint(nextBalance, MIN_BALANCE, MAX_BALANCE) ?? nextBalance;
    airline = { ...airline, corporateBalance: clampedBalance };
  };

  /** Returns true if the airline can afford the given cost. */
  const canAfford = (cost: FixedPoint): boolean => {
    if (!airline) return false;
    return airline.corporateBalance >= cost;
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

  const sortedTimeline = () =>
    timeline
      .slice()
      .sort((a, b) => (a.tick !== b.tick ? b.tick - a.tick : b.timestamp - a.timestamp));

  const fpZero = fp(0);

  const filteredActions = actions.filter((record) => record.authorPubkey === pubkey);
  const sortedActions = [...filteredActions].sort((a, b) => {
    const aTime = a.createdAt ?? 0;
    const bTime = b.createdAt ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.eventId.localeCompare(b.eventId);
  });
  const actionTicks = sortedActions
    .map((record) => clampInt(record.action.payload.tick, 0, Number.MAX_SAFE_INTEGER))
    .filter((tick): tick is number => typeof tick === "number" && Number.isFinite(tick));
  const latestActionTick = actionTicks.length ? Math.max(...actionTicks) : 0;
  const backfillStartTick = Math.max(0, latestActionTick - BACKFILL_TICK_WINDOW);
  const backfillTickSet = new Set<number>();

  for (const record of sortedActions) {
    const { action } = record;
    const payload = action.payload;
    const actionTick = clampInt(payload.tick, 0, Number.MAX_SAFE_INTEGER) ?? 0;
    const eventTimestamp = resolveEventTimestamp(actionTick, record.createdAt);
    actionChainHash = await computeActionChainHash(actionChainHash, {
      id: record.eventId,
      createdAt: record.createdAt,
      authorPubkey: record.authorPubkey,
      action,
    });

    if (action.action === "AIRLINE_CREATE") {
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
        corporateBalance,
        stockPrice: fp(10),
        fleetIds: [],
        routeIds: [],
        lastTick: actionTick,
      };
      continue;
    }

    if (!airline) continue;

    const updateLastTick = (tickValue: number) => {
      const nextTick = Math.max(airline?.lastTick ?? 0, tickValue);
      airline = airline ? { ...airline, lastTick: nextTick } : airline;
    };

    switch (action.action) {
      case "TICK_UPDATE": {
        const status = asString(payload.status);
        if (status && VALID_STATUSES.includes(status as AirlineEntity["status"])) {
          airline = { ...airline, status: status as AirlineEntity["status"] };
        }
        updateLastTick(actionTick);
        if (actionTick >= backfillStartTick) {
          backfillTickSet.add(actionTick);
        }
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
          airline = { ...airline, hubs: airline.hubs.filter((hub) => hub !== iata) };
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

        const routeCost = clampFixedPoint(payload.cost ?? ROUTE_SLOT_FEE, fpZero, MAX_PRICE);
        if (!canAfford(routeCost ?? ROUTE_SLOT_FEE)) break;

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
        const routeId = clampString(payload.routeId, 64);
        if (!routeId) break;
        const route = routesById.get(routeId);
        routesById.delete(routeId);
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
        const routeId = clampString(payload.routeId, 64);
        if (!routeId) break;
        const originIata = sanitizeIata(payload.originIata);
        const destinationIata = sanitizeIata(payload.destinationIata);
        if (!originIata || !destinationIata) break;
        const route = routesById.get(routeId);
        if (!route) break;
        routesById.set(routeId, {
          ...route,
          originIata,
          destinationIata,
          status: "active",
          assignedAircraftIds: [],
        });
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
        const routeId = clampString(payload.routeId, 64);
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
        const routeId = clampString(payload.routeId, 64);
        if (!aircraftId) break;
        const aircraft = fleetById.get(aircraftId);
        if (aircraft) aircraft.assignedRouteId = null;
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
        const routeId = clampString(payload.routeId, 64);
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
        const price = clampFixedPoint(payload.price, fpZero, MAX_PRICE);
        if (!price) break;
        if (!canAfford(price)) break;
        const purchaseType = payload.purchaseType === "lease" ? "lease" : "buy";
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
        fleetById.delete(instanceId);
        for (const route of routesById.values()) {
          route.assignedAircraftIds = route.assignedAircraftIds.filter((id) => id !== instanceId);
        }
        const salePrice = clampFixedPoint(payload.price, fpZero, MAX_PRICE) ?? fpZero;
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
        const buyoutPrice = clampFixedPoint(payload.price, fpZero, MAX_PRICE) ?? fpZero;
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
        if (!instanceId || !modelId) break;
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
        const cost = clampFixedPoint(payload.cost, fpZero, MAX_PRICE) ?? fpZero;
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
      default:
        updateLastTick(actionTick);
        break;
    }
  }

  const fleet = Array.from(fleetById.values());
  const routes = Array.from(routesById.values());

  if (airline) {
    airline = {
      ...airline,
      fleetIds: fleet.map((aircraft) => aircraft.id),
      routeIds: routes.map((route) => route.id),
      timeline,
    };
  }

  const orderedTimeline = sortedTimeline();
  const backfillTimeline = new Map<string, TimelineEvent>();
  for (const event of orderedTimeline) backfillTimeline.set(event.id, event);
  const orderedBackfillTicks = Array.from(backfillTickSet.values()).sort((a, b) => a - b);
  if (airline && orderedBackfillTicks.length > 0) {
    let simulatedFleet = fleet.map((ac) => ({ ...ac }));
    let simulatedBalance = airline.corporateBalance;
    let lastTick = backfillStartTick - 1;
    for (const tick of orderedBackfillTicks) {
      const { updatedFleet, corporateBalance, events } = processFlightEngine(
        tick,
        simulatedFleet,
        routes,
        simulatedBalance,
        lastTick,
        new Map(),
        pubkey,
        0.5,
      );
      simulatedFleet = updatedFleet;
      simulatedBalance = corporateBalance;
      lastTick = tick;
      for (const event of events) {
        if (!backfillTimeline.has(event.id)) {
          backfillTimeline.set(event.id, event);
        }
      }
    }
    timeline.length = 0;
    timeline.push(
      ...Array.from(backfillTimeline.values())
        .sort((a, b) => (a.tick !== b.tick ? b.tick - a.tick : b.timestamp - a.timestamp))
        .slice(0, MAX_TIMELINE_EVENTS),
    );
  } else {
    timeline.length = 0;
    timeline.push(...orderedTimeline.slice(0, MAX_TIMELINE_EVENTS));
  }

  return { airline, fleet, routes, timeline, actionChainHash };
}
