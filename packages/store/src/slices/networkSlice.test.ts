import { describe, it, expect, vi } from 'vitest';
import type { StateCreator } from 'zustand';
import type { AirlineState } from '../types';
import type { AircraftInstance, AirlineEntity, Route, FixedPoint, TimelineEvent } from '@airtr/core';
import { createNetworkSlice } from './networkSlice';

vi.mock('@airtr/nostr', () => ({
    publishAirline: vi.fn(() => Promise.resolve())
}));

vi.mock('../engine', () => ({
    useEngineStore: {
        getState: () => ({
            tick: 100,
            setHub: vi.fn()
        })
    }
}));

const createSliceState = (overrides: Partial<AirlineState>) => {
    const state = {
        airline: null,
        fleet: [],
        routes: [],
        timeline: [],
        pubkey: 'test-pubkey',
        identityStatus: 'ready',
        isLoading: false,
        error: null,
        initializeIdentity: vi.fn(),
        createAirline: vi.fn(),
        modifyHubs: vi.fn(),
        purchaseAircraft: vi.fn(),
        sellAircraft: vi.fn(),
        buyoutAircraft: vi.fn(),
        purchaseUsedAircraft: vi.fn(),
        listAircraft: vi.fn(),
        cancelListing: vi.fn(),
        performMaintenance: vi.fn(),
        ferryAircraft: vi.fn(),
        openRoute: vi.fn(),
        rebaseRoute: vi.fn(),
        closeRoute: vi.fn(),
        assignAircraftToRoute: vi.fn(),
        updateRouteFares: vi.fn(),
        updateHub: vi.fn(),
        processTick: vi.fn(),
        competitors: new Map(),
        globalRouteRegistry: new Map(),
        globalFleet: [],
        globalRoutes: [],
        syncWorld: vi.fn(),
        processGlobalTick: vi.fn(),
    } as AirlineState;

    const set = vi.fn((partial: AirlineState | ((prev: AirlineState) => Partial<AirlineState>)) => {
        const next = typeof partial === 'function' ? partial(state) : partial;
        Object.assign(state, next);
    });

    const get = () => state;

    const slice = (createNetworkSlice as StateCreator<AirlineState>)(set, get, {} as never);
    Object.assign(state, slice);
    Object.assign(state, overrides);
    return { state, set };
};

const makeAirline = (hubs: string[], balance: FixedPoint = 1000000000000 as FixedPoint): AirlineEntity => ({
    id: 'airline-1',
    foundedBy: 'test-pubkey',
    status: 'private',
    ceoPubkey: 'test-pubkey',
    sharesOutstanding: 10000000,
    shareholders: { 'test-pubkey': 10000000 },
    name: 'TestAir',
    icaoCode: 'TST',
    callsign: 'TEST',
    hubs,
    livery: { primary: '#000000', secondary: '#ffffff', accent: '#ffffff' },
    brandScore: 0.5,
    tier: 1,
    corporateBalance: balance,
    stockPrice: 0 as FixedPoint,
    fleetIds: [],
    routeIds: [],
});

const makeRoute = (id: string, origin: string, dest: string, status: 'active' | 'suspended' = 'active'): Route => ({
    id,
    originIata: origin,
    destinationIata: dest,
    airlinePubkey: 'test-pubkey',
    distanceKm: 300,
    assignedAircraftIds: [],
    fareEconomy: 100000 as FixedPoint,
    fareBusiness: 150000 as FixedPoint,
    fareFirst: 200000 as FixedPoint,
    status,
});

const makeAircraft = (id: string, routeId: string | null): AircraftInstance => ({
    id,
    ownerPubkey: 'test-pubkey',
    modelId: 'atr72-600',
    name: 'Plane',
    status: 'idle',
    assignedRouteId: routeId,
    baseAirportIata: 'AXM',
    purchasedAtTick: 0,
    purchasePrice: 1000000 as FixedPoint,
    birthTick: 0,
    flight: null,
    purchaseType: 'buy',
    configuration: { economy: 70, business: 0, first: 0, cargoKg: 0 },
    flightHoursTotal: 0,
    flightHoursSinceCheck: 0,
    condition: 1,
});

describe('modifyHubs remove behavior', () => {
    it('suspends routes touching removed hub and unassigns aircraft', async () => {
        const airline = makeAirline(['AXM', 'BOG']);
        const routes = [
            makeRoute('rt-1', 'AXM', 'BOG', 'active'),
            makeRoute('rt-2', 'BOG', 'MDE', 'active'),
            makeRoute('rt-3', 'BOG', 'AXM', 'active')
        ];
        const fleet = [
            makeAircraft('ac-1', 'rt-1'),
            makeAircraft('ac-2', 'rt-2'),
            makeAircraft('ac-3', 'rt-3')
        ];

        const { state } = createSliceState({ airline, routes, fleet, timeline: [] as TimelineEvent[] });

        await state.modifyHubs({ type: 'remove', iata: 'AXM' });

        const updatedRoutes = state.routes as Route[];
        const updatedFleet = state.fleet as AircraftInstance[];
        const updatedAirline = state.airline as AirlineEntity;

        const suspended = updatedRoutes.find(route => route.id === 'rt-1');
        const untouched = updatedRoutes.find(route => route.id === 'rt-2');
        const inbound = updatedRoutes.find(route => route.id === 'rt-3');

        expect(suspended?.status).toBe('suspended');
        expect(suspended?.assignedAircraftIds).toEqual([]);
        expect(untouched?.status).toBe('active');
        expect(inbound?.status).toBe('active');

        const aircraft1 = updatedFleet.find(ac => ac.id === 'ac-1');
        const aircraft2 = updatedFleet.find(ac => ac.id === 'ac-2');
        const aircraft3 = updatedFleet.find(ac => ac.id === 'ac-3');

        expect(aircraft1?.assignedRouteId).toBe(null);
        expect(aircraft2?.assignedRouteId).toBe('rt-2');
        expect(aircraft3?.assignedRouteId).toBe('rt-3');
        expect(updatedAirline.hubs).toEqual(['BOG']);
    });
});

describe('rebaseRoute', () => {
    it('moves a suspended route to a new hub and reactivates it', async () => {
        const airline = makeAirline(['BOG', 'MDE']);
        const routes = [
            makeRoute('rt-1', 'AXM', 'CLO', 'suspended')
        ];
        const fleet = [makeAircraft('ac-1', 'rt-1')];

        const { state } = createSliceState({ airline, routes, fleet, timeline: [] as TimelineEvent[] });

        await state.rebaseRoute('rt-1', 'BOG');

        const updatedRoutes = state.routes as Route[];
        const updatedFleet = state.fleet as AircraftInstance[];

        const rebased = updatedRoutes.find(route => route.id === 'rt-1');
        expect(rebased?.originIata).toBe('BOG');
        expect(rebased?.destinationIata).toBe('CLO');
        expect(rebased?.status).toBe('active');

        const aircraft = updatedFleet.find(ac => ac.id === 'ac-1');
        expect(aircraft?.assignedRouteId).toBe(null);
    });
});

describe('closeRoute', () => {
    it('removes a route and clears aircraft assignment', async () => {
        const airline = makeAirline(['BOG']);
        const routes = [
            makeRoute('rt-1', 'BOG', 'CLO', 'suspended')
        ];
        const fleet = [makeAircraft('ac-1', 'rt-1')];

        const { state } = createSliceState({ airline, routes, fleet, timeline: [] as TimelineEvent[] });

        await state.closeRoute('rt-1');

        const updatedRoutes = state.routes as Route[];
        const updatedFleet = state.fleet as AircraftInstance[];

        expect(updatedRoutes.find(route => route.id === 'rt-1')).toBeUndefined();
        const aircraft = updatedFleet.find(ac => ac.id === 'ac-1');
        expect(aircraft?.assignedRouteId).toBe(null);
    });

    it('keeps enroute aircraft flight state with fare snapshot', async () => {
        const airline = makeAirline(['BOG']);
        const route = makeRoute('rt-1', 'BOG', 'CLO', 'active');
        const enrouteAircraft = {
            ...makeAircraft('ac-1', 'rt-1'),
            status: 'enroute' as const,
            flight: {
                originIata: 'BOG',
                destinationIata: 'CLO',
                departureTick: 90,
                arrivalTick: 110,
                direction: 'outbound' as const,
            }
        };

        const { state } = createSliceState({ airline, routes: [route], fleet: [enrouteAircraft], timeline: [] as TimelineEvent[] });

        await state.closeRoute('rt-1');

        const updatedFleet = state.fleet as AircraftInstance[];
        const aircraft = updatedFleet.find(ac => ac.id === 'ac-1');

        expect(aircraft?.assignedRouteId).toBe(null);
        expect(aircraft?.status).toBe('enroute');
        expect(aircraft?.flight?.fareEconomy).toBe(route.fareEconomy);
        expect(aircraft?.flight?.fareBusiness).toBe(route.fareBusiness);
        expect(aircraft?.flight?.fareFirst).toBe(route.fareFirst);
    });

    it('turnaround aircraft goes idle on closeRoute', async () => {
        const airline = makeAirline(['BOG']);
        const route = makeRoute('rt-1', 'BOG', 'CLO', 'active');
        const turnaroundAircraft = {
            ...makeAircraft('ac-1', 'rt-1'),
            status: 'turnaround' as const,
            flight: {
                originIata: 'BOG',
                destinationIata: 'CLO',
                departureTick: 90,
                arrivalTick: 100,
                direction: 'outbound' as const,
            }
        };

        const { state } = createSliceState({ airline, routes: [route], fleet: [turnaroundAircraft], timeline: [] as TimelineEvent[] });

        await state.closeRoute('rt-1');

        const updatedFleet = state.fleet as AircraftInstance[];
        const aircraft = updatedFleet.find(ac => ac.id === 'ac-1');

        expect(aircraft?.assignedRouteId).toBe(null);
        expect(aircraft?.status).toBe('idle');
        expect(aircraft?.flight).toBe(null);
    });
});
