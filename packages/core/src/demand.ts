// ============================================================
// @acars/core — Gravity Demand Model
// ============================================================
// See docs/ECONOMIC_MODEL.md §1 for full specification.
// ============================================================

import { fpToNumber } from "./fixed-point.js";
import { haversineDistance } from "./geo.js";
import { getSeasonalMultiplier } from "./season.js";
import type {
  Airport,
  BidirectionalDemandResult,
  DemandResult,
  FixedPoint,
  HubState,
  HubTier,
  Season,
} from "./types.js";
import { TICKS_PER_HOUR } from "./types.js";

// --- Model Parameters (from ECONOMIC_MODEL.md §1.2) ---

/** Calibration constant — tuned against BOG routes (see demand tests). */
const K = 5.995e-7;
/** Origin population exponent */
const ALPHA = 0.8;
/** Destination population exponent */
const BETA = 0.8;
/** Origin GDP exponent */
const GAMMA = 0.6;
/** Destination GDP exponent */
const DELTA = 0.3;
/** Distance decay exponent */
const THETA = 1.0;

/** Minimum distance to prevent short-haul blowups (km) */
const MIN_DISTANCE_KM = 800;

// --- Demand Class Splits (from ECONOMIC_MODEL.md §1.4) ---

const ECONOMY_SHARE = 0.75;
const BUSINESS_SHARE = 0.2;
const FIRST_SHARE = 0.05;

// --- Price Elasticity (from ECONOMIC_MODEL.md §1.4) ---

export const PRICE_ELASTICITY_ECONOMY = -1.5;
export const PRICE_ELASTICITY_BUSINESS = -0.5;
export const PRICE_ELASTICITY_FIRST = -0.2;
export const MAX_PRICE_ELASTICITY_MULTIPLIER = 1.5;
export const MIN_PRICE_ELASTICITY_MULTIPLIER = 0.01;

// --- Player Market Scaling (see ECONOMIC_MODEL.md §6.2) ---

/**
 * Maximum fraction of total route demand that ALL player airlines
 * can collectively capture. The remainder is served by NPC legacy
 * carriers (Avianca, LATAM, etc.) who exist off-screen.
 *
 * At 0.14, BOG-MDE (85K total) yields ~11,900 addressable pax/week.
 * This creates meaningful supply/demand tension with 5-15 aircraft.
 */
export const PLAYER_MARKET_CEILING = 0.14;

/**
 * Minimum total addressable weekly passengers on any route.
 * Prevents tiny routes from being completely unplayable.
 * 360 pax/week ≈ 51/day — enough for 1 small aircraft at ~65% LF.
 */
export const MIN_ADDRESSABLE_WEEKLY = 360;

/**
 * Natural load-factor ceiling. Real airlines never achieve 100% LF
 * consistently due to no-shows, time-of-day mismatches, booking gaps,
 * and schedule fragmentation. Industry average is ~82–85%.
 */
export const NATURAL_LF_CEILING = 0.88;

/**
 * Calculate weekly passenger demand between two airports
 * using the gravity model formula.
 *
 * @param origin - Origin airport
 * @param destination - Destination airport
 * @param season - Current season at destination
 * @param prosperityIndex - Global economic multiplier (default 1.0)
 * @returns Demand split by passenger class
 */
export function calculateDemand(
  origin: Airport,
  destination: Airport,
  season: Season,
  prosperityIndex: number = 1.0,
  hubModifier: number = 1.0,
): DemandResult {
  // Calculate great-circle distance
  const distance = Math.max(
    MIN_DISTANCE_KM,
    haversineDistance(
      origin.latitude,
      origin.longitude,
      destination.latitude,
      destination.longitude,
    ),
  );

  // Gravity model formula
  const numerator =
    origin.population ** ALPHA *
    destination.population ** BETA *
    origin.gdpPerCapita ** GAMMA *
    destination.gdpPerCapita ** DELTA;

  const denominator = distance ** THETA;

  const baseDemand = K * (numerator / denominator);

  // Apply seasonal modulation
  const destTag = destination.tags[0] ?? "general";
  const seasonalMultiplier = getSeasonalMultiplier(destTag, season);

  // Apply prosperity index
  const totalDemand = Math.max(
    0,
    Math.round(baseDemand * seasonalMultiplier * prosperityIndex * hubModifier),
  );

  // Split into classes
  return {
    origin: origin.iata,
    destination: destination.iata,
    economy: Math.round(totalDemand * ECONOMY_SHARE),
    business: Math.round(totalDemand * BUSINESS_SHARE),
    first: Math.round(totalDemand * FIRST_SHARE),
  };
}

/**
 * Calculate weekly passenger demand in both directions between two airports.
 *
 * Because the gravity model uses asymmetric exponents (origin GDP γ=0.6 vs
 * destination GDP δ=0.3) and destination-based seasonal modulation, demand
 * from A→B differs from B→A. This function computes both directions by
 * calling `calculateDemand` twice with swapped origin/destination.
 *
 * The hub modifier is also direction-dependent: `getHubDemandModifier()`
 * includes an origin-only density bonus, so the outbound and inbound legs
 * need separately computed hub modifiers (with swapped origin/destination
 * hub state). Callers should compute each via `getHubDemandModifier()` with
 * the appropriate directional arguments.
 *
 * @param origin - Origin airport (outbound perspective)
 * @param destination - Destination airport (outbound perspective)
 * @param season - Current season
 * @param prosperityIndex - Global economic multiplier (default 1.0)
 * @param outboundHubModifier - Hub modifier for origin→destination (default 1.0)
 * @param inboundHubModifier - Hub modifier for destination→origin (default 1.0)
 * @returns Outbound and inbound DemandResult objects
 */
export function calculateBidirectionalDemand(
  origin: Airport,
  destination: Airport,
  season: Season,
  prosperityIndex: number = 1.0,
  outboundHubModifier: number = 1.0,
  inboundHubModifier: number = 1.0,
): BidirectionalDemandResult {
  return {
    outbound: calculateDemand(origin, destination, season, prosperityIndex, outboundHubModifier),
    inbound: calculateDemand(destination, origin, season, prosperityIndex, inboundHubModifier),
  };
}

export function getHubDemandModifier(
  originTier: HubTier | null,
  destTier: HubTier | null,
  originState: HubState | null,
  destState: HubState | null,
): number {
  let modifier = 1.0;

  if (originTier && destTier) {
    const tierValue = (tier: HubTier) =>
      tier === "regional" ? 1 : tier === "national" ? 2 : tier === "international" ? 3 : 4;
    modifier += (tierValue(originTier) + tierValue(destTier)) * 0.08;
  }

  if (originState && destState) {
    const feed = (Math.log1p(originState.spokeCount) + Math.log1p(destState.spokeCount)) * 0.08;
    modifier += feed;
  }

  if (originState && originState.spokeCount > 0) {
    const density = Math.min(originState.avgFrequency / 20, 0.25);
    modifier += density;
  }

  return modifier;
}

export function getHubCongestionModifier(
  baseCapacityPerHour: number,
  hourlyFlights: number,
): number {
  if (baseCapacityPerHour <= 0) return 1.0;

  const ratio = hourlyFlights / baseCapacityPerHour;
  if (ratio <= 0.85) return 1.0;

  if (ratio <= 1.0) {
    const over = (ratio - 0.85) / 0.15;
    return 1.0 - 0.25 * over;
  }

  const excess = ratio - 1.0;
  const penalty = Math.exp(-1.5 * excess);
  return Math.max(0.3, 0.75 * penalty);
}

/**
 * Calculate prosperity index for a given tick.
 * Oscillates between 0.85 (recession) and 1.15 (boom).
 */
export function getProsperityIndex(
  tick: number,
  ticksPerCycle: number = TICKS_PER_HOUR * 24 * 365.25,
): number {
  return 1.0 + 0.15 * Math.sin((2 * Math.PI * tick) / ticksPerCycle);
}

// --- Addressable Market & Supply Pressure ---

/**
 * Scale raw gravity-model demand to the player-addressable market.
 *
 * The gravity model is calibrated to real-world total traffic.
 * Player airlines are upstart carriers competing for a fraction of
 * that traffic — the rest is served by NPC legacy airlines.
 *
 * A per-class floor (derived from MIN_ADDRESSABLE_WEEKLY) ensures
 * even tiny routes can sustain one small aircraft.
 */
export function scaleToAddressableMarket(demand: DemandResult): DemandResult {
  const totalRaw = demand.economy + demand.business + demand.first;
  const totalAddressable = Math.max(
    MIN_ADDRESSABLE_WEEKLY,
    Math.floor(totalRaw * PLAYER_MARKET_CEILING),
  );

  // Preserve class ratios from the original demand
  const ratio = totalRaw > 0 ? totalAddressable / totalRaw : 0;

  return {
    origin: demand.origin,
    destination: demand.destination,
    economy: Math.max(1, Math.round(demand.economy * ratio)),
    business: Math.max(0, Math.round(demand.business * ratio)),
    first: Math.max(0, Math.round(demand.first * ratio)),
  };
}

/**
 * Compute a load-factor multiplier based on supply vs demand.
 *
 * - When supply ≤ demand → NATURAL_LF_CEILING (best case, ~88%)
 * - When supply > demand → smooth decay via 1/R^1.1
 * - Hard floor at 0.15 (even a dead route has some passengers)
 *
 * @param totalWeeklySeats  Total seats this airline offers per week on this route
 * @param weeklyDemand      This airline's weekly passenger allocation (post-QSI)
 * @returns Multiplier for per-flight pax count (0.15 - 0.88)
 */
export function calculateSupplyPressure(totalWeeklySeats: number, weeklyDemand: number): number {
  if (weeklyDemand <= 0) return 0.15;
  if (totalWeeklySeats <= 0) return NATURAL_LF_CEILING;

  const supplyRatio = totalWeeklySeats / weeklyDemand;

  if (supplyRatio <= 1.0) {
    // Under-supplied or balanced: cap at natural ceiling
    return NATURAL_LF_CEILING;
  }

  // Over-supplied: decay with slight aggression (exponent 1.1)
  const pressure = NATURAL_LF_CEILING / supplyRatio ** 1.1;
  return Math.max(0.15, pressure);
}

/**
 * Price elasticity multiplier using constant elasticity demand curve.
 *
 * multiplier = (actualFare / referenceFare) ^ elasticity
 *
 * - actualFare < referenceFare -> multiplier > 1 (stimulates demand)
 * - actualFare > referenceFare -> multiplier < 1 (suppresses demand)
 * - clamped to [MIN_PRICE_ELASTICITY_MULTIPLIER, MAX_PRICE_ELASTICITY_MULTIPLIER]
 */
export function calculatePriceElasticity(
  actualFare: FixedPoint,
  referenceFare: FixedPoint,
  elasticity: number,
): number {
  const reference = fpToNumber(referenceFare);
  if (reference <= 0) return 1.0;

  const actual = fpToNumber(actualFare);
  if (actual <= 0) return MAX_PRICE_ELASTICITY_MULTIPLIER;

  const ratio = actual / reference;
  const multiplier = ratio ** elasticity;

  if (!Number.isFinite(multiplier)) {
    return ratio <= 1 ? MAX_PRICE_ELASTICITY_MULTIPLIER : MIN_PRICE_ELASTICITY_MULTIPLIER;
  }

  return Math.min(
    MAX_PRICE_ELASTICITY_MULTIPLIER,
    Math.max(MIN_PRICE_ELASTICITY_MULTIPLIER, multiplier),
  );
}
