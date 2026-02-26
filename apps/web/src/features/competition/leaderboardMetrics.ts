import type { AircraftInstance, AirlineEntity, FixedPoint, Route } from "@airtr/core";
import { calculateBookValue, FP_ZERO, fpAdd } from "@airtr/core";
import { getAircraftById } from "@airtr/data";

export type LeaderboardMetric =
  | "balance"
  | "fleet"
  | "routes"
  | "brand"
  | "fleetValue"
  | "networkDistance";

export interface LeaderboardRow {
  id: string;
  name: string;
  icaoCode: string;
  ceoPubkey: string;
  liveryPrimary: string;
  balance: FixedPoint;
  fleet: number;
  routes: number;
  brand: number;
  fleetValue: FixedPoint;
  networkDistance: number;
}

export function computeFleetValue(
  fleetIds: string[],
  aircraftById: Map<string, AircraftInstance>,
  currentTick: number,
): FixedPoint {
  return fleetIds.reduce((total, aircraftId) => {
    const aircraft = aircraftById.get(aircraftId);
    if (!aircraft) return total;
    const model = getAircraftById(aircraft.modelId);
    if (!model) return total;
    return fpAdd(
      total,
      calculateBookValue(
        model,
        aircraft.flightHoursTotal,
        aircraft.condition,
        aircraft.birthTick,
        currentTick,
      ),
    );
  }, FP_ZERO);
}

export function computeNetworkDistance(routeIds: string[], routeById: Map<string, Route>): number {
  return routeIds.reduce((total, routeId) => {
    const route = routeById.get(routeId);
    if (!route) return total;
    return total + route.distanceKm;
  }, 0);
}

export function buildLeaderboardRows(
  airlines: AirlineEntity[],
  aircraftById: Map<string, AircraftInstance>,
  routeById: Map<string, Route>,
  currentTick: number,
): LeaderboardRow[] {
  return airlines.map((entry) => ({
    id: entry.id,
    name: entry.name,
    icaoCode: entry.icaoCode,
    ceoPubkey: entry.ceoPubkey,
    liveryPrimary: entry.livery.primary,
    balance: entry.corporateBalance,
    fleet: entry.fleetIds.length,
    routes: entry.routeIds.length,
    brand: entry.brandScore,
    fleetValue: computeFleetValue(entry.fleetIds, aircraftById, currentTick),
    networkDistance: computeNetworkDistance(entry.routeIds, routeById),
  }));
}

export function sortLeaderboardRows(
  rows: LeaderboardRow[],
  metric: LeaderboardMetric,
): LeaderboardRow[] {
  return [...rows].sort((a, b) => {
    if (metric === "brand") return b.brand - a.brand;
    if (metric === "balance") return b.balance - a.balance;
    if (metric === "fleetValue") return b.fleetValue - a.fleetValue;
    if (metric === "networkDistance") return b.networkDistance - a.networkDistance;
    if (metric === "fleet") return b.fleet - a.fleet;
    return b.routes - a.routes;
  });
}
