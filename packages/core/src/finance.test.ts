// ============================================================
// @airtr/core — Finance Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { calculateFlightRevenue, calculateFlightCost, detectPriceWar, getSuggestedFares } from './finance.js';
import { fp, fpToNumber } from './fixed-point.js';
import type { AircraftModel, FlightOffer } from './types.js';

describe('calculateFlightRevenue()', () => {
    it('calculates 100% load factor correctly', () => {
        const result = calculateFlightRevenue({
            passengersEconomy: 100,
            passengersBusiness: 20,
            passengersFirst: 0,
            fareEconomy: fp(100),
            fareBusiness: fp(300),
            fareFirst: fp(0),
            seatsOffered: 120,
        });

        expect(result.loadFactor).toBe(1.0);
        expect(result.actualPassengers).toBe(120);
        expect(result.spilledPassengers).toBe(0);

        // Ticket: 100 * 100 + 20 * 300 = 10000 + 6000 = 16000
        // Ancillary: 120 * 20 = 2400
        // Total: 18400
        expect(fpToNumber(result.revenueTicket)).toBe(16000);
        expect(fpToNumber(result.revenueAncillary)).toBe(2400);
        expect(fpToNumber(result.revenueTotal)).toBe(18400);
    });

    it('spills excess demand, prioritizing first -> business -> economy', () => {
        const result = calculateFlightRevenue({
            passengersEconomy: 200, // Wants 200 eco
            passengersBusiness: 50, // Wants 50 biz
            passengersFirst: 10,    // Wants 10 first
            fareEconomy: fp(100),
            fareBusiness: fp(500),
            fareFirst: fp(1000),
            seatsOffered: 150,      // Only 150 total seats
        });

        expect(result.loadFactor).toBe(1.0);
        expect(result.actualPassengers).toBe(150);
        expect(result.spilledPassengers).toBe(110); // 260 - 150

        // Seated:
        // First: 10 * 1000 = 10000
        // Biz: 50 * 500 = 25000
        // Eco: (150 - 60) = 90 * 100 = 9000
        // Total ticket: 44000
        expect(fpToNumber(result.revenueTicket)).toBe(44000);
    });
});

describe('calculateFlightCost()', () => {
    it('calculates cost components correctly', () => {
        const aircraft: AircraftModel = {
            id: 'a320neo',
            manufacturer: 'Airbus',
            name: 'A320neo',
            type: 'narrowbody',
            generation: 'nextgen',
            rangeKm: 6300,
            speedKmh: 830,
            maxTakeoffWeight: 79000,
            capacity: {
                economy: 180,
                business: 0,
                first: 0,
                cargoKg: 2000
            },
            fuelBurnKgPerHour: 2075,
            fuelBurnKgPerKm: 2.5,
            blockHoursPerDay: 13,
            turnaroundTimeMinutes: 35,
            price: fp(110000000),
            monthlyLease: fp(380000),
            casm: fp(0.08),
            maintCostPerHour: fp(850),
            crewRequired: {
                cockpit: 2,
                cabin: 4
            },
            economicLifeYears: 20,
            residualValuePercent: 15,
            unlockTier: 1,
            familyId: 'a320',
            deliveryTimeTicks: 120
        };

        const result = calculateFlightCost({
            distanceKm: 4000,
            aircraft: aircraft,
            actualPassengers: 150,
            blockHours: 5, // ~4000km / 830kmh + pad
            airportFeesMultiplier: 1,
        });

        // Fuel: 4000 * 2.5 * 1.20 = 12000
        expect(fpToNumber(result.costFuel)).toBe(12000);

        // Crew: 5 * 150 * 6 = 4500
        expect(fpToNumber(result.costCrew)).toBe(4500);

        // Maint: 5 * 850 = 4250
        expect(fpToNumber(result.costMaintenance)).toBe(4250);

        // Airport: (LANDING_FEE_PER_1000KG * MTOW_tonnes + TERMINAL_BASE_FEE + PAX_FACILITY_CHARGE * pax) * 2
        // = (12 * 79 + 250 + 12 * 150) * 2 = (948 + 250 + 1800) * 2 = 5996
        expect(fpToNumber(result.costAirport)).toBe(5996);

        // Nav: 4000 * 0.5 = 2000
        expect(fpToNumber(result.costNavigation)).toBe(2000);

        // Lease: 380000 / 120 = 3166.6666...
        expect(fpToNumber(result.costLeasing)).toBeCloseTo(3166.6666, 2);

        // Total base: 12000 + 4500 + 4250 + 5996 + 2000 + 3166.6666 = 31912.6666
        const totalBase = 12000 + 4500 + 4250 + 5996 + 2000 + 3166.6666;

        // Overhead: 5% of total base
        const overhead = totalBase * 0.05;
        expect(fpToNumber(result.costOverhead)).toBeCloseTo(overhead, 2);

        // Total: base + overhead
        expect(fpToNumber(result.costTotal)).toBeCloseTo(totalBase + overhead, 1);
    });
});

describe('detectPriceWar', () => {
    it('returns false when only one offer', () => {
        const offers: FlightOffer[] = [
            {
                airlinePubkey: 'pubkey1',
                fareEconomy: fp(100),
                fareBusiness: fp(300),
                fareFirst: fp(500),
                frequencyPerWeek: 7,
                travelTimeMinutes: 120,
                stops: 0,
                serviceScore: 0.7,
                brandScore: 0.5,
            },
        ];
        const result = detectPriceWar(offers);
        expect(result.isPriceWar).toBe(false);
        expect(result.lowPricedAirlines).toEqual([]);
    });

    it('detects price war when fares are 30%+ below average', () => {
        const offers: FlightOffer[] = [
            {
                airlinePubkey: 'airline1',
                fareEconomy: fp(100),
                fareBusiness: fp(300),
                fareFirst: fp(500),
                frequencyPerWeek: 14,
                travelTimeMinutes: 140,
                stops: 0,
                serviceScore: 0.7,
                brandScore: 0.6,
            },
            {
                airlinePubkey: 'airline2',
                fareEconomy: fp(100),
                fareBusiness: fp(300),
                fareFirst: fp(500),
                frequencyPerWeek: 14,
                travelTimeMinutes: 145,
                stops: 0,
                serviceScore: 0.7,
                brandScore: 0.6,
            },
            {
                airlinePubkey: 'airline3',
                fareEconomy: fp(50),
                fareBusiness: fp(150),
                fareFirst: fp(250),
                frequencyPerWeek: 14,
                travelTimeMinutes: 150,
                stops: 0,
                serviceScore: 0.7,
                brandScore: 0.6,
            },
        ];
        const result = detectPriceWar(offers);
        expect(result.isPriceWar).toBe(true);
        expect(result.lowPricedAirlines).toContain('airline3');
    });

    it('returns false when all fares are similar', () => {
        const offers: FlightOffer[] = [
            {
                airlinePubkey: 'airline1',
                fareEconomy: fp(100),
                fareBusiness: fp(300),
                fareFirst: fp(500),
                frequencyPerWeek: 10,
                travelTimeMinutes: 120,
                stops: 0,
                serviceScore: 0.7,
                brandScore: 0.5,
            },
            {
                airlinePubkey: 'airline2',
                fareEconomy: fp(105),
                fareBusiness: fp(310),
                fareFirst: fp(520),
                frequencyPerWeek: 10,
                travelTimeMinutes: 125,
                stops: 0,
                serviceScore: 0.7,
                brandScore: 0.5,
            },
            {
                airlinePubkey: 'airline3',
                fareEconomy: fp(98),
                fareBusiness: fp(295),
                fareFirst: fp(490),
                frequencyPerWeek: 10,
                travelTimeMinutes: 130,
                stops: 0,
                serviceScore: 0.7,
                brandScore: 0.5,
            },
        ];
        const result = detectPriceWar(offers);
        expect(result.isPriceWar).toBe(false);
    });
});

describe('getSuggestedFares', () => {
    it('returns increasing fares for longer distances', () => {
        const shortHaul = getSuggestedFares(500);
        const longHaul = getSuggestedFares(5000);

        expect(shortHaul.economy).toBeLessThan(longHaul.economy);
        expect(shortHaul.business).toBeLessThan(longHaul.business);
        expect(shortHaul.first).toBeLessThan(longHaul.first);
    });

    it('returns valid fares for 1000km route', () => {
        const fares = getSuggestedFares(1000);
        expect(fpToNumber(fares.economy)).toBe(200);
        expect(fpToNumber(fares.business)).toBe(550);
        expect(fpToNumber(fares.first)).toBe(1200);
    });

    it('business is more expensive than economy', () => {
        const fares = getSuggestedFares(2000);
        expect(fpToNumber(fares.business)).toBeGreaterThan(fpToNumber(fares.economy));
    });

    it('first class is most expensive', () => {
        const fares = getSuggestedFares(2000);
        expect(fpToNumber(fares.first)).toBeGreaterThan(fpToNumber(fares.business));
    });
});
