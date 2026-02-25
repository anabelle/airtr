import { describe, it, expect } from 'vitest';
import { fp } from '@airtr/core';
import { MARKETPLACE_D_PREFIX } from './schema.js';

const mockIsRecord = (data: unknown): data is Record<string, unknown> => {
    return typeof data === 'object' && data !== null;
};

const mockParseAirlineContent = (data: unknown): {
    name: string;
    icaoCode: string | null;
    callsign: string | null;
    hubs: string[];
    livery: { primary: string; secondary: string; accent: string };
    corporateBalance: number | null;
    fleet: any[];
    routes: any[];
    timeline: any[];
    lastTick: number | null;
} | null => {
    if (!mockIsRecord(data)) return null;

    const name = typeof data.name === 'string' ? data.name : null;
    const icaoCode = typeof data.icaoCode === 'string'
        ? data.icaoCode
        : (typeof data.icao === 'string' ? data.icao : null);
    const callsign = typeof data.callsign === 'string' ? data.callsign : null;

    const hubs = Array.isArray(data.hubs)
        ? data.hubs.filter((hub): hub is string => typeof hub === 'string')
        : (typeof data.hubIata === 'string' ? [data.hubIata] : []);

    const liverySource = mockIsRecord(data.livery) ? data.livery : null;
    const livery = {
        primary: typeof liverySource?.primary === 'string' ? liverySource.primary : '#1f2937',
        secondary: typeof liverySource?.secondary === 'string' ? liverySource.secondary : '#3b82f6',
        accent: typeof liverySource?.accent === 'string' ? liverySource.accent : '#f59e0b',
    };

    const corporateBalance = typeof data.corporateBalance === 'number' && Number.isFinite(data.corporateBalance)
        ? data.corporateBalance
        : null;

    const lastTick = typeof data.lastTick === 'number' && Number.isFinite(data.lastTick)
        ? data.lastTick
        : null;

    if (!name) return null;

    return {
        name,
        icaoCode,
        callsign,
        hubs,
        livery,
        corporateBalance,
        fleet: Array.isArray(data.fleet) ? data.fleet : [],
        routes: Array.isArray(data.routes) ? data.routes : [],
        timeline: Array.isArray(data.timeline) ? data.timeline : [],
        lastTick,
    };
};

const mockParseMarketplaceListing = (
    data: unknown,
    eventId: string,
    authorPubkey: string,
    createdAt: number
) => {
    if (!mockIsRecord(data)) return null;

    const modelId = typeof data.modelId === 'string' ? data.modelId : null;
    const instanceId = typeof data.id === 'string' ? data.id : null;
    if (!modelId || !instanceId) return null;

    const name = typeof data.name === 'string' ? data.name : 'Unknown Aircraft';
    const ownerPubkey = typeof data.ownerPubkey === 'string' ? data.ownerPubkey : authorPubkey;
    const baseAirportIata = typeof data.baseAirportIata === 'string' ? data.baseAirportIata : 'XXX';

    const rawPrice = data.marketplacePrice;
    if (typeof rawPrice !== 'number' || !Number.isFinite(rawPrice) || rawPrice <= 0) return null;
    const marketplacePrice = rawPrice;

    const condition = typeof data.condition === 'number' && Number.isFinite(data.condition)
        ? Math.max(0, Math.min(1, data.condition))
        : 0.5;

    const flightHoursTotal = typeof data.flightHoursTotal === 'number' && Number.isFinite(data.flightHoursTotal)
        ? Math.max(0, data.flightHoursTotal)
        : 0;

    const flightHoursSinceCheck = typeof data.flightHoursSinceCheck === 'number' && Number.isFinite(data.flightHoursSinceCheck)
        ? Math.max(0, data.flightHoursSinceCheck)
        : 0;

    const birthTick = typeof data.birthTick === 'number' && Number.isFinite(data.birthTick) ? data.birthTick : 0;
    const purchasedAtTick = typeof data.purchasedAtTick === 'number' && Number.isFinite(data.purchasedAtTick) ? data.purchasedAtTick : 0;
    const listedAt = typeof data.listedAt === 'number' && Number.isFinite(data.listedAt) ? data.listedAt : Date.now();

    const purchasePrice = typeof data.purchasePrice === 'number' && Number.isFinite(data.purchasePrice)
        ? data.purchasePrice
        : 0;

    const purchaseType = data.purchaseType === 'lease' ? 'lease' as const : 'buy' as const;

    const rawConfig = mockIsRecord(data.configuration) ? data.configuration : null;
    const configuration = {
        economy: typeof rawConfig?.economy === 'number' ? Math.max(0, Math.round(rawConfig.economy)) : 150,
        business: typeof rawConfig?.business === 'number' ? Math.max(0, Math.round(rawConfig.business)) : 0,
        first: typeof rawConfig?.first === 'number' ? Math.max(0, Math.round(rawConfig.first)) : 0,
        cargoKg: typeof rawConfig?.cargoKg === 'number' ? Math.max(0, Math.round(rawConfig.cargoKg)) : 0,
    };

    if (ownerPubkey !== authorPubkey) return null;

    return {
        id: eventId,
        instanceId,
        sellerPubkey: authorPubkey,
        createdAt,
        modelId,
        name,
        ownerPubkey,
        marketplacePrice,
        listedAt,
        condition,
        flightHoursTotal,
        flightHoursSinceCheck,
        birthTick,
        purchasedAtTick,
        purchasePrice,
        baseAirportIata,
        purchaseType,
        configuration,
    };
};

describe('schema parsing', () => {
    describe('parseAirlineContent', () => {
        it('parses valid airline content', () => {
            const content = {
                name: 'Test Airlines',
                icaoCode: 'TEST',
                callsign: 'TESTAIR',
                hubs: ['JFK', 'LAX'],
                livery: { primary: '#ff0000', secondary: '#ffffff', accent: '#0000ff' },
                corporateBalance: 100000000,
                lastTick: 12345,
            };
            const result = mockParseAirlineContent(content);
            expect(result).not.toBeNull();
            expect(result!.name).toBe('Test Airlines');
            expect(result!.icaoCode).toBe('TEST');
            expect(result!.callsign).toBe('TESTAIR');
            expect(result!.hubs).toEqual(['JFK', 'LAX']);
            expect(result!.corporateBalance).toBe(100000000);
        });

        it('handles legacy icao field', () => {
            const content = {
                name: 'Legacy Airlines',
                icao: 'LEGA',
            };
            const result = mockParseAirlineContent(content);
            expect(result).not.toBeNull();
            expect(result!.icaoCode).toBe('LEGA');
        });

        it('handles legacy hubIata field', () => {
            const content = {
                name: 'Hub Airline',
                hubIata: 'JFK',
            };
            const result = mockParseAirlineContent(content);
            expect(result).not.toBeNull();
            expect(result!.hubs).toEqual(['JFK']);
        });

        it('uses default livery when not provided', () => {
            const content = { name: 'No Livery Airline' };
            const result = mockParseAirlineContent(content);
            expect(result).not.toBeNull();
            expect(result!.livery.primary).toBe('#1f2937');
            expect(result!.livery.secondary).toBe('#3b82f6');
        });

        it('parses custom livery', () => {
            const content = {
                name: 'Custom Airline',
                livery: { primary: '#abc123', secondary: '#def456', accent: '#789012' },
            };
            const result = mockParseAirlineContent(content);
            expect(result).not.toBeNull();
            expect(result!.livery.primary).toBe('#abc123');
        });

        it('returns null for invalid input (null)', () => {
            const result = mockParseAirlineContent(null);
            expect(result).toBeNull();
        });

        it('returns null for invalid input (string)', () => {
            const result = mockParseAirlineContent('not an object');
            expect(result).toBeNull();
        });

        it('returns null when name is missing', () => {
            const result = mockParseAirlineContent({ icaoCode: 'TEST' });
            expect(result).toBeNull();
        });

        it('handles empty arrays for fleet/routes/timeline', () => {
            const content = { name: 'Empty Airline', fleet: [], routes: [], timeline: [] };
            const result = mockParseAirlineContent(content);
            expect(result).not.toBeNull();
            expect(result!.fleet).toEqual([]);
            expect(result!.routes).toEqual([]);
            expect(result!.timeline).toEqual([]);
        });

        it('handles missing corporateBalance', () => {
            const content = { name: 'No Balance Airline' };
            const result = mockParseAirlineContent(content);
            expect(result).not.toBeNull();
            expect(result!.corporateBalance).toBeNull();
        });
    });

    describe('parseMarketplaceListing', () => {
        it('parses valid marketplace listing', () => {
            const data = {
                id: 'aircraft-123',
                modelId: 'a320neo',
                name: 'My A320',
                ownerPubkey: 'pubkey123',
                baseAirportIata: 'JFK',
                marketplacePrice: fp(50000000),
                condition: 0.85,
                flightHoursTotal: 15000,
                flightHoursSinceCheck: 500,
                birthTick: 1000,
                purchasedAtTick: 5000,
                purchasePrice: fp(45000000),
                purchaseType: 'buy',
                configuration: { economy: 150, business: 30, first: 0, cargoKg: 3000 },
            };
            const result = mockParseMarketplaceListing(data, 'event-123', 'pubkey123', 1234567890);
            expect(result).not.toBeNull();
            expect(result!.instanceId).toBe('aircraft-123');
            expect(result!.modelId).toBe('a320neo');
            expect(result!.marketplacePrice).toBe(fp(50000000));
            expect(result!.condition).toBe(0.85);
        });

        it('rejects listing when owner does not match author', () => {
            const data = {
                id: 'aircraft-123',
                modelId: 'a320neo',
                ownerPubkey: 'different-pubkey',
                marketplacePrice: fp(50000000),
            };
            const result = mockParseMarketplaceListing(data, 'event-123', 'author-pubkey', 1234567890);
            expect(result).toBeNull();
        });

        it('returns null for invalid price', () => {
            const data = { id: 'aircraft-123', modelId: 'a320neo', marketplacePrice: -100 };
            const result = mockParseMarketplaceListing(data, 'event-123', 'pubkey123', 1234567890);
            expect(result).toBeNull();
        });

        it('returns null for missing modelId', () => {
            const data = { id: 'aircraft-123', marketplacePrice: fp(50000000) };
            const result = mockParseMarketplaceListing(data, 'event-123', 'pubkey123', 1234567890);
            expect(result).toBeNull();
        });

        it('clamps condition to 0-1 range', () => {
            const data = {
                id: 'aircraft-123',
                modelId: 'a320neo',
                marketplacePrice: fp(50000000),
                condition: 1.5,
            };
            const result = mockParseMarketplaceListing(data, 'event-123', 'pubkey123', 1234567890);
            expect(result!.condition).toBe(1);
        });

        it('defaults missing numeric fields', () => {
            const data = { id: 'aircraft-123', modelId: 'a320neo', marketplacePrice: fp(50000000) };
            const result = mockParseMarketplaceListing(data, 'event-123', 'pubkey123', 1234567890);
            expect(result!.condition).toBe(0.5);
            expect(result!.flightHoursTotal).toBe(0);
            expect(result!.configuration.economy).toBe(150);
        });

        it('defaults to buy when purchaseType missing', () => {
            const data = { id: 'aircraft-123', modelId: 'a320neo', marketplacePrice: fp(50000000) };
            const result = mockParseMarketplaceListing(data, 'event-123', 'pubkey123', 1234567890);
            expect(result!.purchaseType).toBe('buy');
        });

        it('accepts lease purchaseType', () => {
            const data = { id: 'aircraft-123', modelId: 'a320neo', marketplacePrice: fp(50000000), purchaseType: 'lease' };
            const result = mockParseMarketplaceListing(data, 'event-123', 'pubkey123', 1234567890);
            expect(result!.purchaseType).toBe('lease');
        });

        it('uses default configuration when not provided', () => {
            const data = { id: 'aircraft-123', modelId: 'a320neo', marketplacePrice: fp(50000000) };
            const result = mockParseMarketplaceListing(data, 'event-123', 'pubkey123', 1234567890);
            expect(result!.configuration.economy).toBe(150);
            expect(result!.configuration.business).toBe(0);
            expect(result!.configuration.first).toBe(0);
            expect(result!.configuration.cargoKg).toBe(0);
        });
    });
});
