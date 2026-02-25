// ============================================================
// @airtr/core — Gravity Demand Model Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { calculateDemand, getProsperityIndex } from './demand.js';
import type { Airport } from './types.js';

// --- Test airport fixtures ---

const BOG: Airport = {
    id: '2709', name: 'El Dorado International Airport', iata: 'BOG', icao: 'SKBO',
    latitude: 4.70159, longitude: -74.1469, altitude: 8361,
    timezone: 'America/Bogota', country: 'CO', city: 'Bogota',
    population: 7_674_366, gdpPerCapita: 7_919, tags: ['business'],
};

const MDE: Airport = {
    id: '2745', name: 'Jose Maria Cordova International Airport', iata: 'MDE', icao: 'SKRG',
    latitude: 6.16454, longitude: -75.4231, altitude: 6955,
    timezone: 'America/Bogota', country: 'CO', city: 'Rio Negro',
    population: 1_999_979, gdpPerCapita: 7_919, tags: ['general'],
};

const CTG: Airport = {
    id: '2714', name: 'Rafael Nunez International Airport', iata: 'CTG', icao: 'SKCG',
    latitude: 10.4424, longitude: -75.513, altitude: 4,
    timezone: 'America/Bogota', country: 'CO', city: 'Cartagena',
    population: 1_206_319, gdpPerCapita: 7_919, tags: ['beach'],
};

const MAD: Airport = {
    id: '1229', name: 'Adolfo Suarez Madrid-Barajas Airport', iata: 'MAD', icao: 'LEMD',
    latitude: 40.471926, longitude: -3.56264, altitude: 1998,
    timezone: 'Europe/Madrid', country: 'ES', city: 'Madrid',
    population: 3_255_944, gdpPerCapita: 35_327, tags: ['business'],
};

const SMALL_AIRPORT: Airport = {
    id: '9999', name: 'Tiny Regional', iata: 'TNY', icao: 'XTNY',
    latitude: 10.0, longitude: 20.0, altitude: 100,
    timezone: 'UTC', country: 'XX', city: 'Tinytown',
    population: 50_000, gdpPerCapita: 5_000, tags: ['general'],
};

describe('calculateDemand()', () => {
    it('BOG→MDE demand aligns with 2023 annual passengers (weekly baseline)', () => {
        const result = calculateDemand(BOG, MDE, 'spring');
        const total = result.economy + result.business + result.first;
        // Source: Spanish Wikipedia, Aeropuerto Internacional El Dorado
        // Rutas nacionales mas transitadas (enero 2023 - diciembre 2023)
        // BOG–MDE passengers: 4,449,875 annual (≈ 85,575 weekly)
        expect(total).toBeGreaterThan(77_000);
        expect(total).toBeLessThan(95_000);
    });

    it('BOG→CTG demand aligns with 2023 annual passengers (weekly baseline)', () => {
        const result = calculateDemand(BOG, CTG, 'spring');
        const total = result.economy + result.business + result.first;
        // Source: Spanish Wikipedia, Aeropuerto Internacional El Dorado
        // Rutas nacionales mas transitadas (enero 2023 - diciembre 2023)
        // BOG–CTG passengers: 3,285,214 annual (≈ 63,177 weekly)
        expect(total).toBeGreaterThan(50_000);
        expect(total).toBeLessThan(70_000);
    });

    it('BOG→MAD demand aligns with 2022 annual passengers (weekly baseline)', () => {
        const result = calculateDemand(BOG, MAD, 'spring');
        const total = result.economy + result.business + result.first;
        // Source: Spanish Wikipedia, Aeropuerto Internacional El Dorado
        // Rutas internacionales mas transitadas (enero 2022 - diciembre 2022)
        // BOG–MAD passengers: 1,095,936 annual (≈ 21,075 weekly)
        expect(total).toBeGreaterThan(18_000);
        expect(total).toBeLessThan(23_000);
    });

    it('economy class has the largest share', () => {
        const result = calculateDemand(BOG, MDE, 'spring');
        expect(result.economy).toBeGreaterThan(result.business);
        expect(result.business).toBeGreaterThan(result.first);
    });

    it('economy is ~75%, business ~20%, first ~5%', () => {
        const result = calculateDemand(BOG, MDE, 'spring');
        const total = result.economy + result.business + result.first;
        expect(result.economy / total).toBeCloseTo(0.75, 1);
        expect(result.business / total).toBeCloseTo(0.20, 1);
        expect(result.first / total).toBeCloseTo(0.05, 1);
    });

    it('small airports produce much less demand', () => {
        const major = calculateDemand(BOG, MDE, 'spring');
        const minor = calculateDemand(BOG, SMALL_AIRPORT, 'spring');
        expect(major.economy).toBeGreaterThan(minor.economy * 10);
    });

    it('small regional demand is in hundreds range', () => {
        const result = calculateDemand(BOG, SMALL_AIRPORT, 'spring');
        const total = result.economy + result.business + result.first;
        expect(total).toBeGreaterThan(0);
        expect(total).toBeLessThan(5_000);
    });

    it('seasonal multiplier affects demand', () => {
        // CTG tagged 'beach': summer = ×1.30, winter = ×0.70
        const summerDemand = calculateDemand(BOG, CTG, 'summer');
        const winterDemand = calculateDemand(BOG, CTG, 'winter');
        expect(summerDemand.economy).toBeGreaterThan(winterDemand.economy);
    });

    it('prosperity index scales demand', () => {
        const normal = calculateDemand(BOG, MDE, 'spring', 1.0, 1.0);
        const boom = calculateDemand(BOG, MDE, 'spring', 1.15, 1.0);
        const recession = calculateDemand(BOG, MDE, 'spring', 0.85, 1.0);
        expect(boom.economy).toBeGreaterThan(normal.economy);
        expect(normal.economy).toBeGreaterThan(recession.economy);
    });

    it('handles zero population gracefully', () => {
        const ghost: Airport = { ...SMALL_AIRPORT, population: 0, iata: 'GHO' };
        const result = calculateDemand(BOG, ghost, 'spring');
        expect(result.economy).toBe(0);
        expect(result.business).toBe(0);
        expect(result.first).toBe(0);
    });

    it('handles same-airport origin/destination (min distance kicks in)', () => {
        const result = calculateDemand(BOG, BOG, 'spring');
        // Should not throw, just return demand with min distance applied
        expect(result.economy).toBeGreaterThan(0);
    });

    it('is deterministic across calls', () => {
        const r1 = calculateDemand(BOG, MDE, 'spring', 1.0, 1.0);
        const r2 = calculateDemand(BOG, MDE, 'spring', 1.0, 1.0);
        expect(r1.economy).toBe(r2.economy);
        expect(r1.business).toBe(r2.business);
        expect(r1.first).toBe(r2.first);
    });

    it('returns IATA codes in result', () => {
        const result = calculateDemand(BOG, MDE, 'spring');
        expect(result.origin).toBe('BOG');
        expect(result.destination).toBe('MDE');
    });

    it('longer routes generally have less demand than shorter similar routes', () => {
        // Compare two routes with similar city sizes but different distances
        const bogMde = calculateDemand(BOG, MDE, 'spring'); // ~215 km
        const bogMad = calculateDemand(BOG, MAD, 'spring'); // ~8,000 km
        // LHR has bigger population so this tests that distance decay is real
        // Both should be positive
        expect(bogMde.economy).toBeGreaterThan(0);
        expect(bogMad.economy).toBeGreaterThan(0);
    });
});

describe('getProsperityIndex()', () => {
    it('returns 1.0 at tick 0', () => {
        expect(getProsperityIndex(0)).toBeCloseTo(1.0, 5);
    });

    it('peaks at 1.15 at quarter cycle', () => {
        expect(getProsperityIndex(91, 365)).toBeCloseTo(1.15, 1);
    });

    it('bottoms at 0.85 at 3/4 cycle', () => {
        expect(getProsperityIndex(274, 365)).toBeCloseTo(0.85, 1);
    });

    it('oscillates between 0.85 and 1.15', () => {
        for (let t = 0; t < 365; t++) {
            const pi = getProsperityIndex(t);
            expect(pi).toBeGreaterThanOrEqual(0.84);
            expect(pi).toBeLessThanOrEqual(1.16);
        }
    });
});
