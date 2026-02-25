import { describe, it, expect } from 'vitest';
import { haversineDistance } from './geo.js';

describe('geo', () => {
    describe('haversineDistance', () => {
        it('calculates distance between same point as zero', () => {
            const distance = haversineDistance(40.7128, -74.0060, 40.7128, -74.0060);
            expect(distance).toBe(0);
        });

        it('calculates distance between NYC and LA (approx 3940km)', () => {
            const distance = haversineDistance(40.7128, -74.0060, 34.0522, -118.2437);
            expect(distance).toBeCloseTo(3940, -1);
        });

        it('calculates distance between London and Paris (approx 344km)', () => {
            const distance = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522);
            expect(distance).toBeCloseTo(344, -1);
        });

        it('calculates distance between Tokyo and Sydney (approx 7820km)', () => {
            const distance = haversineDistance(35.6762, 139.6503, -33.8688, 151.2093);
            expect(distance).toBeCloseTo(7826, -1);
        });

        it('calculates distance across equator', () => {
            const distance = haversineDistance(0, 0, 0, 90);
            expect(distance).toBeCloseTo(10007, -1);
        });

        it('calculates distance across prime meridian', () => {
            const distance = haversineDistance(51.4778, 0, 51.4778, 0);
            expect(distance).toBeCloseTo(0, 0);
        });

        it('handles negative coordinates', () => {
            const distance = haversineDistance(-33.8688, 151.2093, 35.6762, 139.6503);
            expect(distance).toBeCloseTo(7826, -1);
        });

        it('is symmetric (A to B equals B to A)', () => {
            const distAB = haversineDistance(40.7128, -74.0060, 34.0522, -118.2437);
            const distBA = haversineDistance(34.0522, -118.2437, 40.7128, -74.0060);
            expect(distAB).toBeCloseTo(distBA, 10);
        });
    });
});
