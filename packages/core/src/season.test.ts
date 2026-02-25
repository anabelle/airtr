import { describe, it, expect } from 'vitest';
import { getSeason, getSeasonalMultiplier } from './season.js';

describe('season', () => {
    describe('getSeason', () => {
        const northernLatitude = 40; // New York approximate latitude
        const southernLatitude = -33; // Sydney approximate latitude

        it('returns winter for December in northern hemisphere', () => {
            const date = new Date('2024-12-15T12:00:00Z');
            expect(getSeason(northernLatitude, date)).toBe('winter');
        });

        it('returns summer for December in southern hemisphere', () => {
            const date = new Date('2024-12-15T12:00:00Z');
            expect(getSeason(southernLatitude, date)).toBe('summer');
        });

        it('returns spring for March in northern hemisphere', () => {
            const date = new Date('2024-03-15T12:00:00Z');
            expect(getSeason(northernLatitude, date)).toBe('spring');
        });

        it('returns autumn for March in southern hemisphere', () => {
            const date = new Date('2024-03-15T12:00:00Z');
            expect(getSeason(southernLatitude, date)).toBe('autumn');
        });

        it('returns summer for June in northern hemisphere', () => {
            const date = new Date('2024-06-15T12:00:00Z');
            expect(getSeason(northernLatitude, date)).toBe('summer');
        });

        it('returns winter for June in southern hemisphere', () => {
            const date = new Date('2024-06-15T12:00:00Z');
            expect(getSeason(southernLatitude, date)).toBe('winter');
        });

        it('returns autumn for September in northern hemisphere', () => {
            const date = new Date('2024-09-15T12:00:00Z');
            expect(getSeason(northernLatitude, date)).toBe('autumn');
        });

        it('returns spring for September in southern hemisphere', () => {
            const date = new Date('2024-09-15T12:00:00Z');
            expect(getSeason(southernLatitude, date)).toBe('spring');
        });

        it('handles equator (latitude 0) as northern', () => {
            const date = new Date('2024-06-15T12:00:00Z');
            expect(getSeason(0, date)).toBe('summer');
        });
    });

    describe('getSeasonalMultiplier', () => {
        it('returns 1.30 for beach destination in summer', () => {
            expect(getSeasonalMultiplier('beach', 'summer')).toBe(1.30);
        });

        it('returns 0.70 for beach destination in winter', () => {
            expect(getSeasonalMultiplier('beach', 'winter')).toBe(0.70);
        });

        it('returns 1.40 for ski destination in winter', () => {
            expect(getSeasonalMultiplier('ski', 'winter')).toBe(1.40);
        });

        it('returns 0.60 for ski destination in summer', () => {
            expect(getSeasonalMultiplier('ski', 'summer')).toBe(0.60);
        });

        it('returns 1.10 for business in spring', () => {
            expect(getSeasonalMultiplier('business', 'spring')).toBe(1.10);
        });

        it('returns 1.10 for business in autumn', () => {
            expect(getSeasonalMultiplier('business', 'autumn')).toBe(1.10);
        });

        it('returns 1.10 for general in summer', () => {
            expect(getSeasonalMultiplier('general', 'summer')).toBe(1.10);
        });

        it('returns 0.90 for general in winter', () => {
            expect(getSeasonalMultiplier('general', 'winter')).toBe(0.90);
        });

        it('returns 1.0 for unknown tag', () => {
            expect(getSeasonalMultiplier('unknown' as any, 'summer')).toBe(1.0);
        });
    });
});
