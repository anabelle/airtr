import {
  type AircraftInstance,
  type AircraftModel,
  calculateFlightCost,
  calculateFlightRevenue,
  computeRouteFrequency,
  type DemandResult,
  type FixedPoint,
  fp,
  fpAdd,
  fpScale,
  fpSub,
  fpToNumber,
  type Route,
} from "@acars/core";
import { getHubPricingForIata } from "@acars/data";

type CabinConfig = {
  economy: number;
  business: number;
  first: number;
  cargoKg: number;
};

export type ProjectedRouteEconomics = {
  frequencyPerWeek: number;
  seatsPerFlight: number;
  totalWeeklySeats: number;
  weeklyPassengers: number;
  passengersPerFlight: number;
  estimatedLoadFactor: number;
  breakEvenLoadFactor: number;
  recommendedAircraftCount: number;
  revenuePerFlight: FixedPoint;
  costPerFlight: FixedPoint;
  profitPerFlight: FixedPoint;
  revenuePerWeek: FixedPoint;
  costPerWeek: FixedPoint;
  profitPerWeek: FixedPoint;
  monthlyLeaseCost: FixedPoint;
  monthlyHubCostShare: FixedPoint;
  supplyRatio: number;
  costBreakdown: {
    fuel: FixedPoint;
    crew: FixedPoint;
    maintenance: FixedPoint;
    airport: FixedPoint;
    navigation: FixedPoint;
    overhead: FixedPoint;
  };
};

type ProjectionInput = {
  route: Pick<
    Route,
    "originIata" | "destinationIata" | "distanceKm" | "fareEconomy" | "fareBusiness" | "fareFirst"
  >;
  addressableDemand: DemandResult;
  pressureMultiplier: number;
  effectiveLoadFactor: number;
  aircraft: Pick<
    AircraftModel,
    | "speedKmh"
    | "turnaroundTimeMinutes"
    | "blockHoursPerDay"
    | "capacity"
    | "fuelBurnKgPerHour"
    | "fuelBurnKgPerKm"
    | "maxTakeoffWeight"
    | "wingspanM"
    | "engineCount"
    | "maintCostPerHour"
    | "crewRequired"
    | "monthlyLease"
  >;
  aircraftCount: number;
  cabinConfig?: CabinConfig;
  airportFeesMultiplier?: number;
  includeFixedCosts?: boolean;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const getSeatsPerFlight = (config: CabinConfig) => config.economy + config.business + config.first;

export function estimateRouteEconomics({
  route,
  addressableDemand,
  pressureMultiplier,
  effectiveLoadFactor,
  aircraft,
  aircraftCount,
  cabinConfig,
  airportFeesMultiplier = 1,
  includeFixedCosts = false,
}: ProjectionInput): ProjectedRouteEconomics {
  const count = Math.max(1, aircraftCount);
  const config = cabinConfig ?? aircraft.capacity;
  const seatsPerFlight = getSeatsPerFlight(config);
  const frequencyPerWeek = computeRouteFrequency(
    route.distanceKm,
    count,
    aircraft.speedKmh,
    aircraft.turnaroundTimeMinutes,
    aircraft.blockHoursPerDay,
  );

  const weeklyPassengers = Math.round(
    (addressableDemand.economy + addressableDemand.business + addressableDemand.first) *
      clamp01(effectiveLoadFactor),
  );
  const passengersPerFlight =
    frequencyPerWeek > 0 ? Math.round(weeklyPassengers / frequencyPerWeek) : 0;
  const estimatedLoadFactor =
    seatsPerFlight > 0 ? clamp01(passengersPerFlight / seatsPerFlight) : 0;

  const passengersEconomy = Math.min(
    config.economy,
    Math.round(
      (addressableDemand.economy * clamp01(effectiveLoadFactor)) / Math.max(1, frequencyPerWeek),
    ),
  );
  const passengersBusiness = Math.min(
    config.business,
    Math.round(
      (addressableDemand.business * clamp01(effectiveLoadFactor)) / Math.max(1, frequencyPerWeek),
    ),
  );
  const passengersFirst = Math.min(
    config.first,
    Math.round(
      (addressableDemand.first * clamp01(effectiveLoadFactor)) / Math.max(1, frequencyPerWeek),
    ),
  );

  const revenue = calculateFlightRevenue({
    passengersEconomy,
    passengersBusiness,
    passengersFirst,
    fareEconomy: route.fareEconomy,
    fareBusiness: route.fareBusiness,
    fareFirst: route.fareFirst,
    seatsOffered: seatsPerFlight,
  });

  const blockHours = route.distanceKm / aircraft.speedKmh;
  const variableCost = calculateFlightCost({
    distanceKm: route.distanceKm,
    aircraft: {
      ...aircraft,
      id: "projection-model",
      manufacturer: "Projection",
      name: "Projection",
      type: "narrowbody",
      generation: "nextgen",
      rangeKm: route.distanceKm,
      price: fp(0),
      casm: fp(0),
      economicLifeYears: 25,
      residualValuePercent: 15,
      unlockTier: 1,
      familyId: "projection",
      deliveryTimeTicks: 0,
    },
    actualPassengers: revenue.actualPassengers,
    blockHours,
    airportFeesMultiplier,
  });

  const weeklyLeaseShare = includeFixedCosts
    ? fpScale(aircraft.monthlyLease, count / 4.2857)
    : fp(0);
  const monthlyHubCostShare = includeFixedCosts
    ? fp(getHubPricingForIata(route.originIata).monthlyOpex)
    : fp(0);
  const weeklyHubShare = includeFixedCosts ? fpScale(monthlyHubCostShare, 1 / 4.2857) : fp(0);
  const fixedCostPerFlight =
    includeFixedCosts && frequencyPerWeek > 0
      ? fpScale(fpAdd(weeklyLeaseShare, weeklyHubShare), 1 / frequencyPerWeek)
      : fp(0);

  const costPerFlight = fpAdd(variableCost.costTotal, fixedCostPerFlight);
  const profitPerFlight = fpSub(revenue.revenueTotal, costPerFlight);
  const revenuePerWeek = fpScale(revenue.revenueTotal, frequencyPerWeek);
  const costPerWeek = fpScale(costPerFlight, frequencyPerWeek);
  const profitPerWeek = fpSub(revenuePerWeek, costPerWeek);

  const breakEvenLoadFactor =
    seatsPerFlight > 0 && revenue.revenueTotal > 0
      ? clamp01(
          (fpToNumber(costPerFlight) / Math.max(1, fpToNumber(revenue.revenueTotal))) *
            estimatedLoadFactor,
        )
      : 1;

  const targetWeeklySeats =
    seatsPerFlight > 0 && pressureMultiplier > 0
      ? Math.round(
          (addressableDemand.economy + addressableDemand.business + addressableDemand.first) * 0.85,
        )
      : 0;
  const recommendedAircraftCount =
    seatsPerFlight > 0 && frequencyPerWeek > 0
      ? Math.max(
          1,
          Math.round(targetWeeklySeats / Math.max(1, seatsPerFlight * (frequencyPerWeek / count))),
        )
      : count;

  const totalWeeklySeats = seatsPerFlight * frequencyPerWeek;
  const totalAddressable =
    addressableDemand.economy + addressableDemand.business + addressableDemand.first;

  return {
    frequencyPerWeek,
    seatsPerFlight,
    totalWeeklySeats,
    weeklyPassengers,
    passengersPerFlight: revenue.actualPassengers,
    estimatedLoadFactor,
    breakEvenLoadFactor,
    recommendedAircraftCount,
    revenuePerFlight: revenue.revenueTotal,
    costPerFlight,
    profitPerFlight,
    revenuePerWeek,
    costPerWeek,
    profitPerWeek,
    monthlyLeaseCost: fpScale(aircraft.monthlyLease, count),
    monthlyHubCostShare,
    supplyRatio: totalAddressable > 0 ? totalWeeklySeats / totalAddressable : 0,
    costBreakdown: {
      fuel: variableCost.costFuel,
      crew: variableCost.costCrew,
      maintenance: variableCost.costMaintenance,
      airport: variableCost.costAirport,
      navigation: variableCost.costNavigation,
      overhead: variableCost.costOverhead,
    },
  };
}

export function getPrimaryAssignedAircraft(
  routeAircraftIds: string[],
  fleet: Pick<AircraftInstance, "id" | "modelId" | "configuration">[],
  getModel: (modelId: string) => AircraftModel | undefined,
) {
  const aircraft = routeAircraftIds
    .map((id) => fleet.find((item) => item.id === id))
    .find((item): item is Pick<AircraftInstance, "id" | "modelId" | "configuration"> =>
      Boolean(item),
    );
  if (!aircraft) return null;
  const model = getModel(aircraft.modelId);
  if (!model) return null;
  return { aircraft, model };
}
