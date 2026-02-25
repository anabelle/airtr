import { describe, it, expect } from 'vitest';
import { findPreferredHub } from './geo.js';

const airports = [
    { iata: 'SM1', country: 'AA', latitude: 10, longitude: 10, population: 100000 },
    { iata: 'SM2', country: 'AA', latitude: 12, longitude: 10, population: 200000 },
    { iata: 'BIG', country: 'AA', latitude: 30, longitude: 30, population: 1000000 },
    { iata: 'FAR', country: 'AA', latitude: 80, longitude: 80, population: 900000 },
    { iata: 'BB1', country: 'BB', latitude: -10, longitude: -10, population: 900000 },
    { iata: 'BB2', country: 'BB', latitude: -11, longitude: -11, population: 1000000 },
    { iata: 'NONE', country: 'CC', latitude: 5, longitude: 5, population: 0 },
    { iata: 'NONE2', country: 'CC', latitude: 6, longitude: 6, population: 0 },
] as const;

describe('findPreferredHub', () => {
    it('prefers closest among top populated cities in nearest country', () => {
        const result = findPreferredHub(10.2, 10.1, airports as any);
        expect(result.iata).toBe('SM1');
    });

    it('falls back to nearest when country population missing', () => {
        const result = findPreferredHub(5.1, 5.1, airports as any);
        expect(result.iata).toBe('NONE');
    });

    it('chooses nearest country by geography, not max population', () => {
        const result = findPreferredHub(-10.2, -10.1, airports as any);
        expect(result.country).toBe('BB');
    });
});
