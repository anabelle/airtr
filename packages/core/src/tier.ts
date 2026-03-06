import { fp, fpSum } from "./fixed-point";
import type { AircraftInstance, FixedPoint, Route } from "./types";

export interface TierThreshold {
  minCumulativeRevenue: FixedPoint;
  minActiveRoutes: number;
}

export const TIER_THRESHOLDS: Record<number, TierThreshold> = {
  2: {
    minCumulativeRevenue: fp(5_000_000),
    minActiveRoutes: 3,
  },
  3: {
    minCumulativeRevenue: fp(50_000_000),
    minActiveRoutes: 10,
  },
  4: {
    minCumulativeRevenue: fp(250_000_000),
    minActiveRoutes: 25,
  },
};

const MAX_TIER = 4;

/**
 * Computes the next tier based on cumulative revenue and active routes.
 */
export function evaluateTier(
  currentTier: number,
  cumulativeRevenue: FixedPoint,
  activeRouteCount: number,
): number {
  let nextTier = currentTier;
  for (let tier = currentTier + 1; tier <= MAX_TIER; tier += 1) {
    const threshold = TIER_THRESHOLDS[tier];
    if (!threshold) continue;
    if (cumulativeRevenue < threshold.minCumulativeRevenue) break;
    if (activeRouteCount < threshold.minActiveRoutes) break;
    nextTier = tier;
  }
  return nextTier;
}

/**
 * Returns the maximum allowed route distance by tier.
 */
export function getMaxRouteDistanceKm(tier: number): number {
  if (tier <= 1) return 3000;
  if (tier === 2) return 7000;
  return Number.POSITIVE_INFINITY;
}

/**
 * Returns the maximum allowed hub count by tier.
 */
export function getMaxHubs(tier: number): number {
  if (tier <= 1) return 1;
  if (tier === 2) return 3;
  if (tier === 3) return 5;
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Estimates legacy revenue to seed tier progression for existing airlines.
 */
export function estimateHistoricRevenue(fleet: AircraftInstance[], routes: Route[]): FixedPoint {
  if (fleet.length === 0) return fp(0);
  const fleetValue = fpSum(
    fleet.map((aircraft) => {
      return aircraft.purchasePrice ?? fp(0);
    }),
  );
  const activeRoutes = routes.filter((route) => route.status === "active").length;
  const routeBonus = fp(Math.min(activeRoutes, 25) * 2_000_000);
  return fpSum([fleetValue, routeBonus]);
}
