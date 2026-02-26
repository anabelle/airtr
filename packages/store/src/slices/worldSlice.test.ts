import type { StateCreator } from 'zustand';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AirlineState } from '../types';
import type { AirlineEntity, AircraftInstance, FixedPoint } from '@airtr/core';
import { createWorldSlice } from './worldSlice';

const mockProcessFlightEngine = vi.fn();

vi.mock('../FlightEngine', () => ({
    processFlightEngine: (...args: unknown[]) => mockProcessFlightEngine(...args),
}));

vi.mock('@airtr/nostr', () => ({
    loadGlobalAirlines: vi.fn(() => Promise.resolve([])),
    publishAirline: vi.fn(() => Promise.resolve()),
    getNDK: vi.fn(() => ({})),
    NDKEvent: vi.fn(),
    MARKETPLACE_KIND: 30079,
}));

vi.mock('../engine', () => ({
    useEngineStore: {
        getState: () => ({
            tick: 100,
        })
    }
}));

const createSliceState = (overrides: Partial<AirlineState>) => {
    const state = {
        airline: null,
        fleet: [],
        routes: [],
        timeline: [],
        pubkey: 'player-pubkey',
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

    const slice = (createWorldSlice as StateCreator<AirlineState>)(set, get, {} as never);
    Object.assign(state, slice);
    Object.assign(state, overrides);
    return { state, set };
};

const makeAirline = (pubkey: string, lastTick: number): AirlineEntity => ({
    id: `airline-${pubkey}`,
    foundedBy: pubkey,
    status: 'private',
    ceoPubkey: pubkey,
    sharesOutstanding: 10000000,
    shareholders: { [pubkey]: 10000000 },
    name: `Airline ${pubkey}`,
    icaoCode: 'TST',
    callsign: 'TEST',
    hubs: ['JFK'],
    livery: { primary: '#000000', secondary: '#ffffff', accent: '#ffffff' },
    brandScore: 0.5,
    tier: 1,
    corporateBalance: 1000000000 as FixedPoint,
    stockPrice: 0 as FixedPoint,
    fleetIds: [],
    routeIds: [],
    lastTick,
    timeline: [],
});

const makeAircraft = (id: string, ownerPubkey: string): AircraftInstance => ({
    id,
    ownerPubkey,
    modelId: 'atr72-600',
    name: 'Plane',
    status: 'idle',
    assignedRouteId: null,
    baseAirportIata: 'JFK',
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

describe('processGlobalTick', () => {
    beforeEach(() => {
        mockProcessFlightEngine.mockReset();
        mockProcessFlightEngine.mockImplementation((
            _tick: number,
            fleet: AircraftInstance[],
            _routes: unknown,
            balance: FixedPoint,
        ) => ({
            updatedFleet: fleet,
            corporateBalance: balance,
            hasChanges: false,
            events: [],
        }));
    });

    it('keeps up-to-date competitor fleet while others catch up', () => {
        const tick = 200;
        const behindPubkey = 'comp-behind';
        const currentPubkey = 'comp-current';

        const competitors = new Map<string, AirlineEntity>([
            [behindPubkey, makeAirline(behindPubkey, tick - 2)],
            [currentPubkey, makeAirline(currentPubkey, tick)],
        ]);

        const globalFleet = [
            makeAircraft('ac-behind', behindPubkey),
            makeAircraft('ac-current', currentPubkey),
        ];

        const { state } = createSliceState({
            competitors,
            globalFleet,
            globalRoutes: [],
        });

        state.processGlobalTick(tick);

        const ids = state.globalFleet.map(ac => ac.id);
        expect(ids).toContain('ac-behind');
        expect(ids).toContain('ac-current');
        expect(mockProcessFlightEngine).toHaveBeenCalled();
    });
});
