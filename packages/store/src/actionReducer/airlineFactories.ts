import type { AirlineEntity } from "@acars/core";
import { fp } from "@acars/core";
import {
  asRecord,
  asString,
  asStringArray,
  clampFixedPoint,
  clampInt,
  clampNumber,
  clampString,
  DEFAULT_LIVERY,
  MAX_BALANCE,
  MAX_CODE_LENGTH,
  MAX_HUBS,
  MAX_NAME_LENGTH,
  MIN_BALANCE,
  sanitizeIata,
  VALID_STATUSES,
} from "./shared.js";

type AirlineReplayPayload = Record<string, unknown>;

const parseHubs = (value: unknown): string[] =>
  asStringArray(value)
    .map((hub) => sanitizeIata(hub))
    .filter((hub): hub is string => Boolean(hub))
    .slice(0, MAX_HUBS);

const parseLivery = (value: unknown) => {
  const liveryPayload = asRecord(value);
  return {
    primary: asString(liveryPayload?.primary) ?? DEFAULT_LIVERY.primary,
    secondary: asString(liveryPayload?.secondary) ?? DEFAULT_LIVERY.secondary,
    accent: asString(liveryPayload?.accent) ?? DEFAULT_LIVERY.accent,
  };
};

const parseStatus = (value: unknown): AirlineEntity["status"] =>
  typeof value === "string" && VALID_STATUSES.includes(value as AirlineEntity["status"])
    ? (value as AirlineEntity["status"])
    : "private";

export function createAirlineFromCreateAction(
  pubkey: string,
  eventId: string,
  actionTick: number,
  payload: AirlineReplayPayload,
): AirlineEntity {
  const name = clampString(payload.name, MAX_NAME_LENGTH) ?? "New Airline";
  const icaoCode = clampString(payload.icaoCode, MAX_CODE_LENGTH) ?? "";
  const callsign = clampString(payload.callsign, MAX_CODE_LENGTH) ?? "";
  const hubs = parseHubs(payload.hubs);
  const livery = parseLivery(payload.livery);
  const corporateBalance =
    clampFixedPoint(payload.corporateBalance ?? fp(100000000), MIN_BALANCE, MAX_BALANCE) ??
    fp(100000000);

  return {
    id: `action:${eventId}`,
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
}

export function createBootstrapAirlineFromTickUpdate(
  pubkey: string,
  eventId: string,
  payload: AirlineReplayPayload,
): {
  airline: AirlineEntity;
  tick: number;
  authoritativeFleetIds: string[];
  authoritativeRouteIds: string[];
} {
  const tick = clampInt(payload.tick, 0, Number.MAX_SAFE_INTEGER) ?? 0;
  const corporateBalance =
    clampFixedPoint(payload.corporateBalance, MIN_BALANCE, MAX_BALANCE) ?? fp(100000000);
  const name = clampString(payload.airlineName, MAX_NAME_LENGTH) ?? "Unknown Airline";
  const icaoCode = clampString(payload.icaoCode, MAX_CODE_LENGTH) ?? "";
  const callsign = clampString(payload.callsign, MAX_CODE_LENGTH) ?? "";
  const hubs = parseHubs(payload.hubs);
  const livery = parseLivery(payload.livery);
  const status = parseStatus(payload.status);
  const tier = clampInt(payload.tier, 1, 10) ?? 1;
  const brandScore = clampNumber(payload.brandScore, 0, 1) ?? 0.5;
  const cumulativeRevenue = clampFixedPoint(payload.cumulativeRevenue, fp(0), MAX_BALANCE) ?? fp(0);
  const authoritativeFleetIds = asStringArray(payload.fleetIds);
  const authoritativeRouteIds = asStringArray(payload.routeIds);

  return {
    tick,
    authoritativeFleetIds,
    authoritativeRouteIds,
    airline: {
      id: `bootstrap:${eventId}`,
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
      fleetIds: authoritativeFleetIds,
      routeIds: authoritativeRouteIds,
      lastTick: tick,
    },
  };
}
