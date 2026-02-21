// ============================================================
// @airtr/core — Finance Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { calculateFlightRevenue, calculateFlightCost } from './finance.js';
import { fp, fpToNumber } from './fixed-point.js';
import type { AircraftType } from './types.js';

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
        const aircraft: AircraftType = {
            designator: 'A320neo',
            name: 'Airbus A320neo',
            manufacturer: 'Airbus',
            seats: 180,
            rangeKm: 6300,
            cruiseSpeedKmh: 830,
            fuelPerKm: 2.5,
            crewCount: 6,
            monthlyLease: fp(380000),
            maintPerHour: fp(850)
        };

        const result = calculateFlightCost({
            distanceKm: 4000,
            aircraft: aircraft,
            actualPassengers: 150,
            blockHours: 5, // ~4000km / 830kmh + pad
        });

        // Fuel: 4000 * 2.5 * 1.20 = 12000
        expect(fpToNumber(result.costFuel)).toBe(12000);

        // Crew: 5 * 150 * 6 = 4500
        expect(fpToNumber(result.costCrew)).toBe(4500);

        // Maint: 5 * 850 = 4250
        expect(fpToNumber(result.costMaintenance)).toBe(4250);

        // Airport: (1000 + 500 + 15 * 150) * 2 = (3750) * 2 = 7500
        expect(fpToNumber(result.costAirport)).toBe(7500);

        // Nav: 4000 * 0.5 = 2000
        expect(fpToNumber(result.costNavigation)).toBe(2000);

        // Lease: 380000 / 120 = 3166.6666...
        expect(fpToNumber(result.costLeasing)).toBeCloseTo(3166.6666, 2);

        // Total base: 12000 + 4500 + 4250 + 7500 + 2000 + 3166.6666 = 33416.6666
        const totalBase = 12000 + 4500 + 4250 + 7500 + 2000 + 3166.6666;

        // Overhead: 5% of total base
        const overhead = totalBase * 0.05;
        expect(fpToNumber(result.costOverhead)).toBeCloseTo(overhead, 2);

        // Total: base + overhead
        expect(fpToNumber(result.costTotal)).toBeCloseTo(totalBase + overhead, 1);
    });
});
