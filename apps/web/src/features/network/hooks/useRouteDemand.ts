import type { DemandResult, FixedPoint, Route } from "@airtr/core";
import {
  buildHubState,
  calculateDemand,
  calculatePriceElasticity,
  calculateSupplyPressure,
  getAirportTraffic,
  getHubCongestionModifier,
  getHubDemandModifier,
  getProsperityIndex,
  getSeason,
  getSuggestedFares,
  PRICE_ELASTICITY_BUSINESS,
  PRICE_ELASTICITY_ECONOMY,
  PRICE_ELASTICITY_FIRST,
  scaleToAddressableMarket,
} from "@airtr/core";
import { airports, HUB_CLASSIFICATIONS } from "@airtr/data";
import { useAirlineStore, useEngineStore } from "@airtr/store";
import { useMemo } from "react";

export type RouteDemandSnapshot = {
  totalDemand: DemandResult;
  addressableDemand: DemandResult;
  pressureMultiplier: number;
  totalWeeklySeats: number;
  suggestedFleetDelta: number;
  isOversupplied: boolean;
  elasticityEconomy: number;
  elasticityBusiness: number;
  elasticityFirst: number;
  referenceFareEconomy: FixedPoint;
  referenceFareBusiness: FixedPoint;
  referenceFareFirst: FixedPoint;
  effectiveLoadFactor: number;
};

const DEFAULT_DEMAND: DemandResult = {
  origin: "",
  destination: "",
  economy: 0,
  business: 0,
  first: 0,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function getRouteDemandSnapshot(
  route: Route,
  tick: number,
  fleet: RouteDemandFleet,
  routes: Route[],
): RouteDemandSnapshot {
  const originIata = route.originIata;
  const destinationIata = route.destinationIata;
  const origin = airports.find((airport) => airport.iata === originIata) ?? null;
  const destination = airports.find((airport) => airport.iata === destinationIata) ?? null;

  if (!origin || !destination) {
    const referenceFares = getSuggestedFares(route.distanceKm);
    const elasticityEconomy = calculatePriceElasticity(
      route.fareEconomy,
      referenceFares.economy,
      PRICE_ELASTICITY_ECONOMY,
    );
    const elasticityBusiness = calculatePriceElasticity(
      route.fareBusiness,
      referenceFares.business,
      PRICE_ELASTICITY_BUSINESS,
    );
    const elasticityFirst = calculatePriceElasticity(
      route.fareFirst,
      referenceFares.first,
      PRICE_ELASTICITY_FIRST,
    );
    const blendedElasticity =
      elasticityEconomy * 0.75 + elasticityBusiness * 0.2 + elasticityFirst * 0.05;

    return {
      totalDemand: { ...DEFAULT_DEMAND, origin: originIata, destination: destinationIata },
      addressableDemand: { ...DEFAULT_DEMAND, origin: originIata, destination: destinationIata },
      pressureMultiplier: 0.15,
      totalWeeklySeats: 0,
      suggestedFleetDelta: 0,
      isOversupplied: false,
      elasticityEconomy,
      elasticityBusiness,
      elasticityFirst,
      referenceFareEconomy: referenceFares.economy,
      referenceFareBusiness: referenceFares.business,
      referenceFareFirst: referenceFares.first,
      effectiveLoadFactor: 0.15 * blendedElasticity,
    };
  }

  const now = new Date();
  const season = getSeason(destination.latitude, now);
  const prosperity = getProsperityIndex(tick);

  const originHub = originIata ? (HUB_CLASSIFICATIONS[originIata] ?? null) : null;
  const destHub = destinationIata ? (HUB_CLASSIFICATIONS[destinationIata] ?? null) : null;
  const originState = originHub && originIata ? buildHubState(originIata, routes) : null;
  const destState = destHub && destinationIata ? buildHubState(destinationIata, routes) : null;
  const hubModifier = getHubDemandModifier(
    originHub?.tier ?? null,
    destHub?.tier ?? null,
    originState,
    destState,
  );

  const originTraffic = originIata ? getAirportTraffic(originIata, routes) : 0;
  const destTraffic = destinationIata ? getAirportTraffic(destinationIata, routes) : 0;
  const originCapacity = originHub?.baseCapacityPerHour ?? 80;
  const destCapacity = destHub?.baseCapacityPerHour ?? 80;
  const originCongestion = getHubCongestionModifier(originCapacity, originTraffic);
  const destCongestion = getHubCongestionModifier(destCapacity, destTraffic);
  const congestionModifier = (originCongestion + destCongestion) / 2;

  const weeklyDemand = calculateDemand(origin, destination, season, prosperity, hubModifier);

  const totalDemand: DemandResult = {
    origin: originIata,
    destination: destinationIata,
    economy: Math.round(weeklyDemand.economy * congestionModifier),
    business: Math.round(weeklyDemand.business * congestionModifier),
    first: Math.round(weeklyDemand.first * congestionModifier),
  };

  const addressableDemand = scaleToAddressableMarket(totalDemand);

  const totalWeeklySeats = route.assignedAircraftIds.reduce((sum, aircraftId) => {
    const aircraft = fleet.find((item) => item.id === aircraftId);
    if (!aircraft) return sum;
    const cabin = aircraft.configuration ?? { economy: 0, business: 0, first: 0, cargoKg: 0 };
    return sum + (cabin.economy + cabin.business + cabin.first) * 7;
  }, 0);

  const weeklyAddressableTotal =
    addressableDemand.economy + addressableDemand.business + addressableDemand.first;
  const pressureMultiplier = calculateSupplyPressure(totalWeeklySeats, weeklyAddressableTotal);
  const isOversupplied = totalWeeklySeats > weeklyAddressableTotal;

  const referenceFares = getSuggestedFares(route.distanceKm);
  const elasticityEconomy = calculatePriceElasticity(
    route.fareEconomy,
    referenceFares.economy,
    PRICE_ELASTICITY_ECONOMY,
  );
  const elasticityBusiness = calculatePriceElasticity(
    route.fareBusiness,
    referenceFares.business,
    PRICE_ELASTICITY_BUSINESS,
  );
  const elasticityFirst = calculatePriceElasticity(
    route.fareFirst,
    referenceFares.first,
    PRICE_ELASTICITY_FIRST,
  );
  const demandTotal =
    addressableDemand.economy + addressableDemand.business + addressableDemand.first;
  const demandWeights =
    demandTotal > 0
      ? {
          economy: addressableDemand.economy / demandTotal,
          business: addressableDemand.business / demandTotal,
          first: addressableDemand.first / demandTotal,
        }
      : { economy: 0.75, business: 0.2, first: 0.05 };
  const blendedElasticity =
    elasticityEconomy * demandWeights.economy +
    elasticityBusiness * demandWeights.business +
    elasticityFirst * demandWeights.first;

  const targetLf = 0.85;
  const targetSeats =
    weeklyAddressableTotal > 0 ? Math.round((weeklyAddressableTotal * targetLf) / 7) : 0;

  const averageSeats =
    route.assignedAircraftIds.length > 0
      ? Math.round(totalWeeklySeats / Math.max(1, route.assignedAircraftIds.length))
      : 0;

  const suggestedFleetDelta =
    averageSeats > 0
      ? clamp(Math.round((targetSeats - totalWeeklySeats / 7) / averageSeats), -9, 9)
      : 0;

  return {
    totalDemand,
    addressableDemand,
    pressureMultiplier,
    totalWeeklySeats,
    suggestedFleetDelta,
    isOversupplied,
    elasticityEconomy,
    elasticityBusiness,
    elasticityFirst,
    referenceFareEconomy: referenceFares.economy,
    referenceFareBusiness: referenceFares.business,
    referenceFareFirst: referenceFares.first,
    effectiveLoadFactor: pressureMultiplier * blendedElasticity,
  };
}

type RouteDemandFleet = {
  id: string;
  configuration?: { economy: number; business: number; first: number; cargoKg: number };
}[];

export function useRouteDemand(route: Route): RouteDemandSnapshot {
  const tick = useEngineStore((state) => state.tick);
  const fleet = useAirlineStore((state) => state.fleet);
  const routes = useAirlineStore((state) => state.routes);

  return useMemo(
    () => getRouteDemandSnapshot(route, tick, fleet, routes),
    [route, tick, fleet, routes],
  );
}
