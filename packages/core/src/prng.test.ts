// ============================================================
// @airtr/core — Seeded PRNG Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { createPRNG, createTickPRNG } from './prng.js';

describe('PRNG', () => {
    it('produces values in [0, 1)', () => {
        const rng = createPRNG(42);
        for (let i = 0; i < 1000; i++) {
            const val = rng();
            expect(val).toBeGreaterThanOrEqual(0);
            expect(val).toBeLessThan(1);
        }
    });

    it('is deterministic — same seed produces same sequence', () => {
        const rng1 = createPRNG(12345);
        const rng2 = createPRNG(12345);
        for (let i = 0; i < 100; i++) {
            expect(rng1()).toBe(rng2());
        }
    });

    it('different seeds produce different sequences', () => {
        const rng1 = createPRNG(1);
        const rng2 = createPRNG(2);
        // At least one of the first 10 values should differ
        let allSame = true;
        for (let i = 0; i < 10; i++) {
            if (rng1() !== rng2()) allSame = false;
        }
        expect(allSame).toBe(false);
    });

    it('createTickPRNG produces deterministic output per tick', () => {
        const rng1 = createTickPRNG(100);
        const rng2 = createTickPRNG(100);
        for (let i = 0; i < 50; i++) {
            expect(rng1()).toBe(rng2());
        }
    });

    it('different ticks produce different sequences', () => {
        const rng1 = createTickPRNG(1);
        const rng2 = createTickPRNG(2);
        let allSame = true;
        for (let i = 0; i < 10; i++) {
            if (rng1() !== rng2()) allSame = false;
        }
        expect(allSame).toBe(false);
    });

    it('has reasonable distribution (chi-squared sanity check)', () => {
        const rng = createPRNG(999);
        const buckets = new Array(10).fill(0);
        const n = 10000;
        for (let i = 0; i < n; i++) {
            const bucket = Math.floor(rng() * 10);
            buckets[bucket]++;
        }
        // Each bucket should have roughly n/10 = 1000 items
        // Allow 20% deviation
        for (const count of buckets) {
            expect(count).toBeGreaterThan(800);
            expect(count).toBeLessThan(1200);
        }
    });
});
