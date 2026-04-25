// ============================================================
// @acars/core — Finance (Revenue & Costs)
// ============================================================
// See docs/ECONOMIC_MODEL.md §3 and §4 for full specification.
// ============================================================

import { FP_ZERO, fp, fpAdd, fpDiv, fpScale } from "./fixed-point.js";
import { FUEL_PRICE_MEAN_PER_KG } from "./fuel.js";
import type { AircraftModel, FixedPoint, FlightOffer } from "./types.js";

/**
 * Detects if a price war is occurring on a route.
 */
export function detectPriceWar(offers: FlightOffer[]): {
  isPriceWar: boolean;
  lowPricedAirlines: string[];
} {
  if (offers.length < 2) return { isPriceWar: false, lowPricedAirlines: [] };

  // Use Economy fare as the benchmark
  const totalEconomy = offers.reduce((acc, o) => fpAdd(acc, o.fareEconomy), FP_ZERO);
  const avgPrice = fpDiv(totalEconomy, fp(offers.length));
  const threshold = fpScale(avgPrice, 0.7);
  const lowPricedAirlines = offers
    .filter((o) => o.fareEconomy < threshold) // >30% below avg
    .map((o) => o.airlinePubkey);

  return {
    isPriceWar: lowPricedAirlines.length > 0,
    lowPricedAirlines,
  };
}

// Global constants
const CREW_COST_PER_HOUR = fp(150); // $150 per hour per crew member
const NAV_FEE_PER_KM = fp(0.5); // $0.50 per km overflight

// realistic Airport Fees
const LANDING_FEE_PER_1000KG = fp(12); // $12 per tonne
const TERMINAL_BASE_FEE = fp(250); // $250 base
const PAX_FACILITY_CHARGE = fp(12); // $12 per passenger

const ANCILLARY_PER_PAX = fp(20);
export const ROUTE_SLOT_FEE = fp(100000);
const MAX_HUB_LANDING_FEE_MULTIPLIER = 10;
const HUB_CONGESTION_THRESHOLD = 0.8;

export interface FlightRevenueParams {
  passengersEconomy: number;
  passengersBusiness: number;
  passengersFirst: number;
  fareEconomy: FixedPoint;
  fareBusiness: FixedPoint;
  fareFirst: FixedPoint;
  seatsOffered: number;
}

export interface FlightCostParams {
  distanceKm: number;
  aircraft: AircraftModel;
  actualPassengers: number;
  blockHours: number;
  airportFeesMultiplier?: number;
  fuelPricePerKg?: FixedPoint;
}

export function calculateHubLandingFee(
  baseLandingFee: FixedPoint,
  baseCapacityPerHour: number,
  hourlyFlights: number,
): FixedPoint {
  const ratio = baseCapacityPerHour > 0 ? hourlyFlights / baseCapacityPerHour : 0;

  if (ratio <= HUB_CONGESTION_THRESHOLD) {
    return fpScale(baseLandingFee, 1 + ratio);
  }

  const excess = ratio - HUB_CONGESTION_THRESHOLD;
  const multiplier = Math.min(
    MAX_HUB_LANDING_FEE_MULTIPLIER,
    1 + HUB_CONGESTION_THRESHOLD + (Math.exp(excess * 4) - 1),
  );
  return fpScale(baseLandingFee, multiplier);
}

/**
 * Calculate the revenue for a flight based on allocated passengers and fares.
 */
export function calculateFlightRevenue(params: FlightRevenueParams): {
  revenueTicket: FixedPoint;
  revenueEconomy: FixedPoint;
  revenueBusiness: FixedPoint;
  revenueFirst: FixedPoint;
  revenueAncillary: FixedPoint;
  revenueTotal: FixedPoint;
  actualPassengers: number;
  actualEconomy: number;
  actualBusiness: number;
  actualFirst: number;
  seatsOffered: number;
  loadFactor: number;
  spilledPassengers: number;
} {
  const totalAllocated =
    params.passengersEconomy + params.passengersBusiness + params.passengersFirst;
  const actualPassengers = Math.min(totalAllocated, params.seatsOffered);
  const loadFactor = params.seatsOffered > 0 ? actualPassengers / params.seatsOffered : 0;
  const spilledPassengers =
    totalAllocated > params.seatsOffered ? totalAllocated - params.seatsOffered : 0;

  // We assume the spill happens evenly across classes (for simplicity),
  // but a better way is to prioritize first -> business -> economy.
  // Let's do priority boarding:
  let remainingSeats = params.seatsOffered;

  const actualFirst = Math.min(params.passengersFirst, remainingSeats);
  remainingSeats -= actualFirst;

  const actualBusiness = Math.min(params.passengersBusiness, remainingSeats);
  remainingSeats -= actualBusiness;

  const actualEconomy = Math.min(params.passengersEconomy, remainingSeats);

  // Revenue calculations
  const revEconomy = fpScale(params.fareEconomy, actualEconomy);
  const revBusiness = fpScale(params.fareBusiness, actualBusiness);
  const revFirst = fpScale(params.fareFirst, actualFirst);

  const revenueTicket = fpAdd(fpAdd(revEconomy, revBusiness), revFirst);

  // Ancillary revenue: generic $20 per passenger
  const revenueAncillary = fpScale(ANCILLARY_PER_PAX, actualPassengers);

  const revenueTotal = fpAdd(revenueTicket, revenueAncillary);

  return {
    revenueTicket,
    revenueEconomy: revEconomy,
    revenueBusiness: revBusiness,
    revenueFirst: revFirst,
    revenueAncillary,
    revenueTotal,
    actualPassengers,
    actualEconomy,
    actualBusiness,
    actualFirst,
    seatsOffered: params.seatsOffered,
    loadFactor,
    spilledPassengers,
  };
}

/**
 * Calculate the cost of operating a single flight.
 */
export function calculateFlightCost(params: FlightCostParams): {
  costFuel: FixedPoint;
  costCrew: FixedPoint;
  costMaintenance: FixedPoint;
  costAirport: FixedPoint;
  costNavigation: FixedPoint;
  costLeasing: FixedPoint;
  costOverhead: FixedPoint;
  costTotal: FixedPoint;
} {
  // Fuel: distance_km * fuel_per_km * fuel_price
  const fuelKg = params.distanceKm * params.aircraft.fuelBurnKgPerKm;
  const fuelPricePerKg = params.fuelPricePerKg ?? FUEL_PRICE_MEAN_PER_KG;
  const costFuel = fpScale(fuelPricePerKg, fuelKg);

  // Crew: blockHours * crewCostPerHour * crewCount
  const crewCount = params.aircraft.crewRequired.cockpit + params.aircraft.crewRequired.cabin;
  const crewHours = params.blockHours * crewCount;
  const costCrew = fpScale(CREW_COST_PER_HOUR, crewHours);

  // Maintenance: blockHours * maintPerHour
  const costMaintenance = fpScale(params.aircraft.maintCostPerHour, params.blockHours);

  // Airport Fees: based on MTOW for realism
  // landing = MTOW(tonnes) * price_per_tonne
  // terminal = base + pax_fee
  const mtowTonnes = params.aircraft.maxTakeoffWeight / 1000;
  const landingFee = fpScale(LANDING_FEE_PER_1000KG, mtowTonnes);
  const terminalFee = fpAdd(
    TERMINAL_BASE_FEE,
    fpScale(PAX_FACILITY_CHARGE, params.actualPassengers),
  );

  // Total for one cycle (Landing + Terminal)
  const airportBase = fpScale(fpAdd(landingFee, terminalFee), 2);
  const airportMultiplier = params.airportFeesMultiplier ?? 1;
  const costAirport = fpScale(airportBase, airportMultiplier);

  // Navigation: distance_km * nav_fee_per_km
  const costNavigation = fpScale(NAV_FEE_PER_KM, params.distanceKm);

  // Leasing is handled via monthly lump-sum deductions in processFlightEngine
  // (and applyMonthlyCosts for competitor catchup).  Including per-flight
  // amortization here would double-charge lease costs.
  const costLeasing = FP_ZERO;

  // Sum base costs
  const baseTotal = [
    costFuel,
    costCrew,
    costMaintenance,
    costAirport,
    costNavigation,
    costLeasing,
  ].reduce((acc, val) => fpAdd(acc, val), FP_ZERO);

  // Overhead: 5% of all other costs
  const costOverhead = fpScale(baseTotal, 0.05);

  // Total Cost
  const costTotal = fpAdd(baseTotal, costOverhead);

  return {
    costFuel,
    costCrew,
    costMaintenance,
    costAirport,
    costNavigation,
    costLeasing,
    costOverhead,
    costTotal,
  };
}

/**
 * Get suggestions for baseline fares based on distance.
 */
export function getSuggestedFares(distanceKm: number): {
  economy: FixedPoint;
  business: FixedPoint;
  first: FixedPoint;
} {
  return {
    economy: fp(Math.round(distanceKm * 0.15 + 50)),
    business: fp(Math.round(distanceKm * 0.4 + 150)),
    first: fp(Math.round(distanceKm * 0.8 + 400)),
  };
}
