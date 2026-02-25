import { describe, expect, it } from 'vitest';
import { getFlightNumber } from './flightNumber';

describe('getFlightNumber', () => {
    it('returns deterministic numbers for the same seed', () => {
        expect(getFlightNumber('AAL', 'route-1')).toBe(getFlightNumber('AAL', 'route-1'));
    });

    it('normalizes ICAO codes', () => {
        expect(getFlightNumber('dal', 'route-2')).toMatch(/^DAL\s\d+$/);
    });

    it('falls back to UNK when ICAO missing', () => {
        expect(getFlightNumber('', 'route-3')).toMatch(/^UNK\s\d+$/);
    });

    it('keeps numbers within the expected range', () => {
        const match = getFlightNumber('UAL', 'route-4').match(/\s(\d+)$/);
        expect(match).not.toBeNull();
        const value = Number(match?.[1]);
        expect(value).toBeGreaterThanOrEqual(100);
        expect(value).toBeLessThanOrEqual(9999);
    });
});
