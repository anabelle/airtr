// ============================================================
// @airtr/core — QSI Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { calculateShares, allocatePassengers } from './qsi.js';
import { fp } from './fixed-point.js';
import type { FlightOffer, DemandResult } from './types.js';

describe('calculateShares()', () => {
    it('gives 100% to a monopoly', () => {
        const offers: FlightOffer[] = [
            {
                airlinePubkey: 'monopoly',
                fareEconomy: fp(500),
                fareBusiness: fp(1500),
                fareFirst: fp(3000),
                frequencyPerWeek: 14,
                travelTimeMinutes: 300,
                stops: 0,
                serviceScore: 0.8,
                brandScore: 0.8,
            }
        ];

        const shares = calculateShares(offers);
        expect(shares.economy.get('monopoly')).toBe(1.0);
        expect(shares.business.get('monopoly')).toBe(1.0);
        expect(shares.first.get('monopoly')).toBe(1.0);
    });

    it('splits evenly between identical offers', () => {
        const base = {
            fareEconomy: fp(500),
            fareBusiness: fp(1500),
            fareFirst: fp(3000),
            frequencyPerWeek: 14,
            travelTimeMinutes: 300,
            stops: 0,
            serviceScore: 0.8,
            brandScore: 0.8,
        };

        const offers: FlightOffer[] = [
            { ...base, airlinePubkey: 'airlineA' },
            { ...base, airlinePubkey: 'airlineB' },
        ];

        const shares = calculateShares(offers);
        expect(shares.economy.get('airlineA')).toBeCloseTo(0.5);
        expect(shares.economy.get('airlineB')).toBeCloseTo(0.5);
    });

    it('favors cheaper flights heavily in economy, but less in business/first', () => {
        const offers: FlightOffer[] = [
            {
                airlinePubkey: 'cheap',
                fareEconomy: fp(300),
                fareBusiness: fp(1000),
                fareFirst: fp(2000),
                frequencyPerWeek: 14,
                travelTimeMinutes: 300,
                stops: 0,
                serviceScore: 0.5,
                brandScore: 0.5,
            },
            {
                airlinePubkey: 'expensive',
                fareEconomy: fp(600),
                fareBusiness: fp(2000),
                fareFirst: fp(4000),
                frequencyPerWeek: 14,
                travelTimeMinutes: 300,
                stops: 0,
                serviceScore: 0.5,
                brandScore: 0.5,
            }
        ];

        const shares = calculateShares(offers);

        const cheapEco = shares.economy.get('cheap')!;
        const expEco = shares.economy.get('expensive')!;
        expect(cheapEco).toBeGreaterThan(expEco);

        const cheapBiz = shares.business.get('cheap')!;
        const expBiz = shares.business.get('expensive')!;
        // The *ratio* of advantage should be smaller in business than in economy
        expect(cheapEco / expEco).toBeGreaterThan(cheapBiz / expBiz);
    });
});

describe('allocatePassengers()', () => {
    it('returns empty exact values when there is no demand', () => {
        const offers: FlightOffer[] = [
            { airlinePubkey: 'A', fareEconomy: fp(100), fareBusiness: fp(200), fareFirst: fp(300), frequencyPerWeek: 7, travelTimeMinutes: 100, stops: 0, serviceScore: 0.5, brandScore: 0.5 }
        ];

        const demand: DemandResult = { origin: 'JFK', destination: 'LAX', economy: 0, business: 0, first: 0 };
        const alloc = allocatePassengers(offers, demand);

        expect(alloc.get('A')).toEqual({ economy: 0, business: 0, first: 0 });
    });

    it('allocates without losing any passengers (Largest Remainder Method)', () => {
        const base = {
            fareEconomy: fp(500),
            fareBusiness: fp(1500),
            fareFirst: fp(3000),
            frequencyPerWeek: 14,
            travelTimeMinutes: 300,
            stops: 0,
            serviceScore: 0.8,
            brandScore: 0.8,
        };

        const offers: FlightOffer[] = [
            { ...base, airlinePubkey: 'airlineA' },
            { ...base, airlinePubkey: 'airlineB' },
            { ...base, airlinePubkey: 'airlineC' },
        ];

        // 100 passengers split by 3 is 33.33 each
        const demand: DemandResult = { origin: 'JFK', destination: 'LAX', economy: 100, business: 10, first: 0 };
        const alloc = allocatePassengers(offers, demand);

        const a = alloc.get('airlineA')!;
        const b = alloc.get('airlineB')!;
        const c = alloc.get('airlineC')!;

        // Total should be exactly 100
        expect(a.economy + b.economy + c.economy).toBe(100);

        // Exact integer counts
        expect([a.economy, b.economy, c.economy].sort()).toEqual([33, 33, 34]);

        expect(a.business + b.business + c.business).toBe(10);
        expect(a.first + b.first + c.first).toBe(0);
    });

    it('deterministically breaks exact ties using pubkey', () => {
        const base = {
            fareEconomy: fp(500),
            fareBusiness: fp(1500),
            fareFirst: fp(3000),
            frequencyPerWeek: 14,
            travelTimeMinutes: 300,
            stops: 0,
            serviceScore: 0.8,
            brandScore: 0.8,
        };

        const offers: FlightOffer[] = [
            { ...base, airlinePubkey: 'airlineA' },
            { ...base, airlinePubkey: 'airlineB' },
        ];

        const demand: DemandResult = { origin: 'JFK', destination: 'LAX', economy: 3, business: 0, first: 0 };

        // Both have exact 1.5 seats. By pubkey sort ('airlineA' vs 'airlineB' descending wait no, localeCompare)
        // b.remainder - a.remainder is 0.
        // a.pubkey.localeCompare(b.pubkey) puts 'airlineA' before 'airlineB'
        const alloc = allocatePassengers(offers, demand);

        expect(alloc.get('airlineA')!.economy).toBe(2);
        expect(alloc.get('airlineB')!.economy).toBe(1);
    });
});
