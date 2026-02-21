// ============================================================
// @airtr/core — Finance (Revenue & Costs)
// ============================================================
// See docs/ECONOMIC_MODEL.md §3 and §4 for full specification.
// ============================================================

import { fp, fpAdd, fpScale } from './fixed-point.js';
import type { AircraftType } from './types.js';
import type { FixedPoint } from './types.js';

// Global constants
const FUEL_PRICE_PER_KG = fp(1.20); // $1.20 per kg
const CREW_COST_PER_HOUR = fp(150); // $150 per hour per crew member
const NAV_FEE_PER_KM = fp(0.50); // $0.50 per km overflight

// Default Airport Fees (could be extracted from airport data later)
const DEFAULT_LANDING_FEE = fp(1000);
const DEFAULT_TERMINAL_FEE = fp(500);
const DEFAULT_PAX_FEE = fp(15); // $15 per passenger

const ASSUMED_FLIGHTS_PER_MONTH = 120; // For leasing amortization (4 flights/day)

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
    aircraft: AircraftType;
    actualPassengers: number;
    blockHours: number;
}

/**
 * Calculate the revenue for a flight based on allocated passengers and fares.
 */
export function calculateFlightRevenue(params: FlightRevenueParams): {
    revenueTicket: FixedPoint;
    revenueAncillary: FixedPoint;
    revenueTotal: FixedPoint;
    actualPassengers: number;
    loadFactor: number;
    spilledPassengers: number;
} {
    const totalAllocated = params.passengersEconomy + params.passengersBusiness + params.passengersFirst;
    const actualPassengers = Math.min(totalAllocated, params.seatsOffered);
    const loadFactor = params.seatsOffered > 0 ? actualPassengers / params.seatsOffered : 0;
    const spilledPassengers = totalAllocated > params.seatsOffered ? totalAllocated - params.seatsOffered : 0;

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
    const ancillaryPerPax = fp(20);
    const revenueAncillary = fpScale(ancillaryPerPax, actualPassengers);

    const revenueTotal = fpAdd(revenueTicket, revenueAncillary);

    return {
        revenueTicket,
        revenueAncillary,
        revenueTotal,
        actualPassengers,
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
    const fuelKg = params.distanceKm * params.aircraft.fuelPerKm;
    const costFuel = fpScale(FUEL_PRICE_PER_KG, fuelKg);

    // Crew: blockHours * crewCostPerHour * crewCount
    const crewHours = params.blockHours * params.aircraft.crewCount;
    const costCrew = fpScale(CREW_COST_PER_HOUR, crewHours);

    // Maintenance: blockHours * maintPerHour
    const costMaintenance = fpScale(params.aircraft.maintPerHour, params.blockHours);

    // Airport Fees: landing + terminal + pax_fee * passengers (assume x2 for origin/dest)
    // Here we just calculate origin+dest together generically, or per departure.
    const baseAirportFees = fpAdd(DEFAULT_LANDING_FEE, DEFAULT_TERMINAL_FEE);
    const paxFees = fpScale(DEFAULT_PAX_FEE, params.actualPassengers);
    const costAirport = fpScale(fpAdd(baseAirportFees, paxFees), 2); // Origin and destination

    // Navigation: distance_km * nav_fee_per_km
    const costNavigation = fpScale(NAV_FEE_PER_KM, params.distanceKm);

    // Leasing amortization
    const costLeasing = fpScale(params.aircraft.monthlyLease, 1 / ASSUMED_FLIGHTS_PER_MONTH);

    // Sum base costs
    const baseTotal = [
        costFuel,
        costCrew,
        costMaintenance,
        costAirport,
        costNavigation,
        costLeasing
    ].reduce((acc, val) => fpAdd(acc, val), fp(0));

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
        costTotal
    };
}
