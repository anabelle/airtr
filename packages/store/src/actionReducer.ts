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
  fpScale,
  fpSub,
  getSuggestedFares,
  ROUTE_SLOT_FEE,
  TICKS_PER_HOUR,
} from "@airtr/core";
import { getAircraftById } from "@airtr/data";

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

  const fpZero = fp(0);

  const filteredActions = actions.filter((record) => record.authorPubkey === pubkey);
  const sortedActions = [...filteredActions].sort((a, b) => {
    const aTime = a.createdAt ?? 0;
    const bTime = b.createdAt ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.eventId.localeCompare(b.eventId);
  });

  for (const record of sortedActions) {
    const { action } = record;
    const payload = action.payload;
    const actionTick = clampInt(payload.tick, 0, Number.MAX_SAFE_INTEGER) ?? 0;
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
        break;
      }
      case "HUB_ADD": {
        const iata = sanitizeIata(payload.iata);
        if (iata && airline.hubs.length < MAX_HUBS && !airline.hubs.includes(iata)) {
          airline = { ...airline, hubs: [...airline.hubs, iata] };
        }
        const fee = clampFixedPoint(payload.fee, fpZero, MAX_PRICE) ?? fpZero;
        applyBalanceDelta(fpSub(fpZero, fee));
        updateLastTick(actionTick);
        break;
      }
      case "HUB_REMOVE": {
        const iata = sanitizeIata(payload.iata);
        if (iata) {
          airline = { ...airline, hubs: airline.hubs.filter((hub) => hub !== iata) };
        }
        updateLastTick(actionTick);
        break;
      }
      case "HUB_SWITCH": {
        const iata = sanitizeIata(payload.iata);
        if (iata && airline.hubs.includes(iata)) {
          airline = {
            ...airline,
            hubs: [iata, ...airline.hubs.filter((hub) => hub !== iata)],
          };
        }
        const fee = clampFixedPoint(payload.fee, fpZero, MAX_PRICE) ?? fpZero;
        applyBalanceDelta(fpSub(fpZero, fee));
        updateLastTick(actionTick);
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

        const routeCost = clampFixedPoint(payload.cost ?? ROUTE_SLOT_FEE, fpZero, MAX_PRICE);
        applyBalanceDelta(fpSub(fpZero, routeCost ?? ROUTE_SLOT_FEE));
        updateLastTick(actionTick);
        break;
      }
      case "ROUTE_CLOSE": {
        const routeId = clampString(payload.routeId, 64);
        if (!routeId) break;
        routesById.delete(routeId);
        for (const aircraft of fleetById.values()) {
          if (aircraft.assignedRouteId === routeId) {
            aircraft.assignedRouteId = null;
          }
        }
        updateLastTick(actionTick);
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
        break;
      }
      case "ROUTE_ASSIGN_AIRCRAFT": {
        const aircraftId = clampString(payload.aircraftId, 64);
        const routeId = clampString(payload.routeId, 64);
        if (!aircraftId || !routeId) break;
        const aircraft = fleetById.get(aircraftId);
        const route = routesById.get(routeId);
        if (!aircraft || !route) break;
        aircraft.assignedRouteId = routeId;
        aircraft.routeAssignedAtTick = actionTick;
        if (!route.assignedAircraftIds.includes(aircraftId)) {
          route.assignedAircraftIds = [...route.assignedAircraftIds, aircraftId];
        }
        updateLastTick(actionTick);
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
        break;
      }
      case "AIRCRAFT_SELL": {
        const instanceId = clampString(payload.instanceId, 64);
        if (!instanceId) break;
        fleetById.delete(instanceId);
        for (const route of routesById.values()) {
          route.assignedAircraftIds = route.assignedAircraftIds.filter((id) => id !== instanceId);
        }
        const salePrice = clampFixedPoint(payload.price, fpZero, MAX_PRICE) ?? fpZero;
        applyBalanceDelta(salePrice);
        updateLastTick(actionTick);
        break;
      }
      case "AIRCRAFT_BUYOUT": {
        const instanceId = clampString(payload.instanceId, 64);
        const aircraft = instanceId ? fleetById.get(instanceId) : null;
        if (!aircraft) break;
        aircraft.purchaseType = "buy";
        const buyoutPrice = clampFixedPoint(payload.price, fpZero, MAX_PRICE) ?? fpZero;
        applyBalanceDelta(fpSub(fpZero, buyoutPrice));
        updateLastTick(actionTick);
        break;
      }
      case "AIRCRAFT_LIST": {
        const instanceId = clampString(payload.instanceId, 64);
        const aircraft = instanceId ? fleetById.get(instanceId) : null;
        if (!aircraft) break;
        const price = clampFixedPoint(payload.price, fpZero, MAX_PRICE);
        if (!price) break;
        aircraft.listingPrice = price;
        const fee = fpScale(price, 0.005);
        applyBalanceDelta(fpSub(fpZero, fee));
        updateLastTick(actionTick);
        break;
      }
      case "AIRCRAFT_CANCEL_LIST": {
        const instanceId = clampString(payload.instanceId, 64);
        const aircraft = instanceId ? fleetById.get(instanceId) : null;
        if (!aircraft) break;
        aircraft.listingPrice = null;
        updateLastTick(actionTick);
        break;
      }
      case "AIRCRAFT_BUY_USED": {
        const instanceId = clampString(payload.instanceId, 64);
        const modelId = clampString(payload.modelId, 64);
        if (!instanceId || !modelId) break;
        const price = clampFixedPoint(payload.price, fpZero, MAX_PRICE);
        if (!price) break;
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
            status: "delivery",
            purchaseType: "buy",
            assignedRouteId: null,
            baseAirportIata,
            purchasedAtTick: actionTick,
            purchasePrice: price,
            listingPrice: null,
            birthTick,
            deliveryAtTick: actionTick + 20,
            flight: null,
            configuration,
            flightHoursTotal,
            flightHoursSinceCheck,
            condition,
          });
        }

        applyBalanceDelta(fpSub(fpZero, price));
        updateLastTick(actionTick);
        break;
      }
      case "AIRCRAFT_MAINTENANCE": {
        const instanceId = clampString(payload.instanceId, 64);
        const aircraft = instanceId ? fleetById.get(instanceId) : null;
        if (!aircraft) break;
        aircraft.condition = 1.0;
        aircraft.flightHoursSinceCheck = 0;
        aircraft.status = "maintenance";
        aircraft.maintenanceStartTick = actionTick;
        const cost = clampFixedPoint(payload.cost, fpZero, MAX_PRICE) ?? fpZero;
        applyBalanceDelta(fpSub(fpZero, cost));
        updateLastTick(actionTick);
        break;
      }
      case "AIRCRAFT_FERRY": {
        const instanceId = clampString(payload.instanceId, 64);
        const originIata = sanitizeIata(payload.originIata);
        const destinationIata = sanitizeIata(payload.destinationIata);
        const distanceKm = clampNumber(payload.distanceKm, 1, MAX_DISTANCE_KM);
        const aircraft = instanceId ? fleetById.get(instanceId) : null;
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

  return { airline, fleet, routes, timeline, actionChainHash };
}
