import { describe, it, expect } from 'vitest';
import {
    aircraftModels,
    aircraftByFamilyId,
    aircraftByTier,
    getAircraftById,
    getAircraftByType,
} from './aircraft.js';

describe('aircraft', () => {
    describe('aircraftModels', () => {
        it('contains aircraft models', () => {
            expect(aircraftModels.length).toBeGreaterThan(0);
        });

        it('each aircraft has required fields', () => {
            for (const aircraft of aircraftModels) {
                expect(aircraft.id).toBeDefined();
                expect(aircraft.manufacturer).toBeDefined();
                expect(aircraft.name).toBeDefined();
                expect(aircraft.type).toBeDefined();
                expect(aircraft.rangeKm).toBeGreaterThan(0);
                expect(aircraft.speedKmh).toBeGreaterThan(0);
                expect(aircraft.capacity).toBeDefined();
                expect(aircraft.price).toBeDefined();
            }
        });

        it('has correct unlock tiers', () => {
            const tiers = new Set(aircraftModels.map(a => a.unlockTier));
            expect(tiers.has(1)).toBe(true);
            expect(tiers.has(2)).toBe(true);
            expect(tiers.has(3)).toBe(true);
            expect(tiers.has(4)).toBe(true);
        });
    });

    describe('aircraftByFamilyId', () => {
        it('groups aircraft by family ID', () => {
            const a320Family = aircraftByFamilyId.get('a320');
            expect(a320Family).toBeDefined();
            expect(a320Family!.length).toBe(2);
            expect(a320Family!.every(a => a.familyId === 'a320')).toBe(true);
        });

        it('includes atr family', () => {
            const atrFamily = aircraftByFamilyId.get('atr');
            expect(atrFamily).toBeDefined();
            expect(atrFamily!.length).toBe(1);
        });
    });

    describe('aircraftByTier', () => {
        it('groups aircraft by unlock tier', () => {
            const tier1 = aircraftByTier.get(1);
            expect(tier1).toBeDefined();
            expect(tier1!.length).toBe(2);
            expect(tier1!.every(a => a.unlockTier === 1)).toBe(true);
        });

        it('has increasing aircraft count per tier', () => {
            const tier1Count = aircraftByTier.get(1)!.length;
            const tier2Count = aircraftByTier.get(2)!.length;
            const tier3Count = aircraftByTier.get(3)!.length;
            const tier4Count = aircraftByTier.get(4)!.length;
            expect(tier1Count).toBe(2);
            expect(tier2Count).toBe(6);
            expect(tier3Count).toBe(4);
            expect(tier4Count).toBe(3);
        });
    });

    describe('getAircraftById', () => {
        it('finds aircraft by ID', () => {
            const aircraft = getAircraftById('a320neo');
            expect(aircraft).toBeDefined();
            expect(aircraft!.name).toBe('A320neo');
        });

        it('returns undefined for unknown ID', () => {
            const aircraft = getAircraftById('unknown-aircraft');
            expect(aircraft).toBeUndefined();
        });
    });

    describe('getAircraftByType', () => {
        it('filters by turboprop type', () => {
            const turboprops = getAircraftByType('turboprop');
            expect(turboprops.length).toBe(2);
            expect(turboprops.every(a => a.type === 'turboprop')).toBe(true);
        });

        it('filters by widebody type', () => {
            const widebodies = getAircraftByType('widebody');
            expect(widebodies.length).toBe(7);
            expect(widebodies.every(a => a.type === 'widebody')).toBe(true);
        });

        it('filters by narrowbody type', () => {
            const narrowbodies = getAircraftByType('narrowbody');
            expect(narrowbodies.length).toBe(4);
            expect(narrowbodies.every(a => a.type === 'narrowbody')).toBe(true);
        });

        it('filters by regional type', () => {
            const regionals = getAircraftByType('regional');
            expect(regionals.length).toBe(2);
            expect(regionals.every(a => a.type === 'regional')).toBe(true);
        });
    });
});
