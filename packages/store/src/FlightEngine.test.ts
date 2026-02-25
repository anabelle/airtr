import { describe, it, expect } from 'vitest';
import type { AircraftInstance, FixedPoint, FlightOffer, Route, TimelineEvent } from '@airtr/core';
import {
    fp,
    fpToNumber,
    TICKS_PER_HOUR,
    calculateDemand,
    getSuggestedFares,
} from '@airtr/core';
import { airports, getAircraftById } from '@airtr/data';
import { processFlightEngine } from './FlightEngine.js';

const PLAYER_PUBKEY = 'player-airline';

type EngineState = {
    fleet: AircraftInstance[];
    routes: Route[];
    balance: FixedPoint;
    lastTick: number;
    events: TimelineEvent[];
};

const makeAircraft = (overrides: Partial<AircraftInstance> = {}): AircraftInstance => {
    const modelId = overrides.modelId ?? 'a320neo';
    const model = getAircraftById(modelId);
    if (!model) {
        throw new Error(`Unknown modelId: ${modelId}`);
    }

    return {
        id: overrides.id ?? 'ac-1',
        ownerPubkey: overrides.ownerPubkey ?? PLAYER_PUBKEY,
        modelId,
        name: overrides.name ?? model.name,
        status: overrides.status ?? 'idle',
        assignedRouteId: overrides.assignedRouteId ?? null,
        baseAirportIata: overrides.baseAirportIata ?? 'JFK',
        purchasedAtTick: overrides.purchasedAtTick ?? 0,
        purchasePrice: overrides.purchasePrice ?? fp(1000000),
        birthTick: overrides.birthTick ?? 0,
        deliveryAtTick: overrides.deliveryAtTick,
        listingPrice: overrides.listingPrice ?? null,
        flight: overrides.flight ?? null,
        lastTickProcessed: overrides.lastTickProcessed,
        turnaroundEndTick: overrides.turnaroundEndTick,
        arrivalTickProcessed: overrides.arrivalTickProcessed,
        purchaseType: overrides.purchaseType ?? 'buy',
        leaseStartedAtTick: overrides.leaseStartedAtTick,
        configuration: overrides.configuration ?? {
            economy: model.capacity.economy,
            business: model.capacity.business,
            first: model.capacity.first,
            cargoKg: model.capacity.cargoKg,
        },
        flightHoursTotal: overrides.flightHoursTotal ?? 0,
        flightHoursSinceCheck: overrides.flightHoursSinceCheck ?? 0,
        condition: overrides.condition ?? 1.0,
    };
};

const makeRoute = (overrides: Partial<Route> = {}): Route => {
    const distanceKm = overrides.distanceKm ?? 1000;
    const fares = getSuggestedFares(distanceKm);

    return {
        id: overrides.id ?? 'route-1',
        originIata: overrides.originIata ?? 'JFK',
        destinationIata: overrides.destinationIata ?? 'LAX',
        airlinePubkey: overrides.airlinePubkey ?? PLAYER_PUBKEY,
        distanceKm,
        frequencyPerWeek: overrides.frequencyPerWeek ?? 7,
        assignedAircraftIds: overrides.assignedAircraftIds ?? [],
        fareEconomy: overrides.fareEconomy ?? fares.economy,
        fareBusiness: overrides.fareBusiness ?? fares.business,
        fareFirst: overrides.fareFirst ?? fares.first,
        status: overrides.status ?? 'active',
        lastTickProcessed: overrides.lastTickProcessed,
    };
};

const initState = (fleet: AircraftInstance[], routes: Route[], balance: FixedPoint = fp(1000000)): EngineState => ({
    fleet,
    routes,
    balance,
    lastTick: 0,
    events: [],
});

const runTick = (
    state: EngineState,
    tick: number,
    options: {
        globalRouteRegistry?: Map<string, FlightOffer[]>;
        playerPubkey?: string;
        brandScore?: number;
    } = {}
): EngineState => {
    const result = processFlightEngine(
        tick,
        state.fleet,
        state.routes,
        state.balance,
        state.lastTick,
        options.globalRouteRegistry ?? new Map(),
        options.playerPubkey ?? PLAYER_PUBKEY,
        options.brandScore ?? 0.5,
    );

    return {
        fleet: result.updatedFleet,
        routes: state.routes,
        balance: result.corporateBalance,
        lastTick: tick,
        events: [...state.events, ...result.events],
    };
};

const findLastEvent = (events: TimelineEvent[], type: TimelineEvent['type']): TimelineEvent | undefined => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
        if (events[i].type === type) return events[i];
    }
    return undefined;
};

const simulateSingleLanding = (
    aircraft: AircraftInstance,
    route: Route,
    options: {
        globalRouteRegistry?: Map<string, FlightOffer[]>;
        brandScore?: number;
    } = {}
) => {
    let state = initState([aircraft], [route]);
    state = runTick(state, 1, options);
    const arrivalTick = state.fleet[0].flight?.arrivalTick;
    if (!arrivalTick) {
        throw new Error('Expected flight to be enroute with arrival tick');
    }
    state = runTick(state, arrivalTick, options);
    const landing = findLastEvent(state.events, 'landing');
    if (!landing) {
        throw new Error('Expected landing event');
    }
    return { landing, state };
};

const makeFlight = (overrides: Partial<AircraftInstance['flight']>): AircraftInstance['flight'] => ({
    originIata: 'JFK',
    destinationIata: 'LAX',
    departureTick: 1,
    arrivalTick: 10,
    direction: 'outbound',
    ...overrides,
});

describe('FlightEngine — Solo/Offline scenarios', () => {
    it('turboprop economy-only stays zero for business/first', () => {
        const aircraft = makeAircraft({
            id: 'ac-atr',
            modelId: 'atr72-600',
            assignedRouteId: 'route-atr',
            baseAirportIata: 'JFK',
        });
        const route = makeRoute({
            id: 'route-atr',
            originIata: 'JFK',
            destinationIata: 'LAX',
            distanceKm: 500,
            assignedAircraftIds: [aircraft.id],
        });

        const { landing } = simulateSingleLanding(aircraft, route);
        const passengers = landing.details?.passengers;
        expect(passengers?.business ?? 0).toBe(0);
        expect(passengers?.first ?? 0).toBe(0);
        expect(landing.details?.seatsOffered).toBe(70);
        expect(landing.details?.loadFactor).toBeGreaterThanOrEqual(0);
        expect(landing.details?.loadFactor).toBeLessThanOrEqual(1);
    });

    it('narrowbody fills business but has zero first-class seats', () => {
        const aircraft = makeAircraft({
            id: 'ac-a320',
            modelId: 'a320neo',
            assignedRouteId: 'route-a320',
            baseAirportIata: 'JFK',
        });
        const route = makeRoute({
            id: 'route-a320',
            originIata: 'JFK',
            destinationIata: 'LAX',
            distanceKm: 3000,
            assignedAircraftIds: [aircraft.id],
        });

        const { landing } = simulateSingleLanding(aircraft, route);
        const passengers = landing.details?.passengers;
        expect(passengers?.first ?? 0).toBe(0);
        expect((passengers?.business ?? 0)).toBeGreaterThanOrEqual(0);
    });

    it('widebody long-haul supports all three classes', () => {
        const aircraft = makeAircraft({
            id: 'ac-b787',
            modelId: 'b787-9',
            assignedRouteId: 'route-b787',
            baseAirportIata: 'JFK',
        });
        const route = makeRoute({
            id: 'route-b787',
            originIata: 'JFK',
            destinationIata: 'LHR',
            distanceKm: 10000,
            assignedAircraftIds: [aircraft.id],
        });

        const { landing } = simulateSingleLanding(aircraft, route);
        const passengers = landing.details?.passengers;
        expect(passengers?.economy ?? 0).toBeGreaterThan(0);
        expect(passengers?.business ?? 0).toBeGreaterThanOrEqual(0);
        expect(passengers?.first ?? 0).toBeGreaterThanOrEqual(0);
    });

    it('oversized aircraft on thin route yields low load factor', () => {
        const aircraft = makeAircraft({
            id: 'ac-a380',
            modelId: 'a380-800',
            assignedRouteId: 'route-a380',
            baseAirportIata: 'GKA',
        });
        const route = makeRoute({
            id: 'route-a380',
            originIata: 'GKA',
            destinationIata: 'CPT',
            distanceKm: 11000,
            assignedAircraftIds: [aircraft.id],
        });

        const { landing } = simulateSingleLanding(aircraft, route);
        expect(landing.details?.loadFactor ?? 1).toBeLessThan(0.4);
    });
});

describe('FlightEngine — Multiplayer scenarios', () => {
    it('competition reduces our passenger allocation', () => {
        const aircraft = makeAircraft({
            id: 'ac-comp',
            modelId: 'a320neo',
            assignedRouteId: 'route-comp',
            baseAirportIata: 'JFK',
        });
        const assignedAircraftIds = Array.from({ length: 200 }, (_, index) => `ac-comp-${index + 1}`);
        const route = makeRoute({
            id: 'route-comp',
            originIata: 'JFK',
            destinationIata: 'LAX',
            distanceKm: 3000,
            assignedAircraftIds,
        });

        const monopoly = simulateSingleLanding(aircraft, route);

        const competitorOffer: FlightOffer = {
            airlinePubkey: 'competitor-1',
            fareEconomy: fp(120),
            fareBusiness: fp(350),
            fareFirst: fp(700),
            frequencyPerWeek: 2800,
            travelTimeMinutes: 300,
            stops: 0,
            serviceScore: 0.7,
            brandScore: 0.6,
        };
        const registry = new Map<string, FlightOffer[]>([
            ['JFK-LAX', [competitorOffer]],
        ]);

        const competition = simulateSingleLanding(aircraft, route, { globalRouteRegistry: registry });

        const monoPax = monopoly.landing.details?.passengers?.total ?? 0;
        const compPax = competition.landing.details?.passengers?.total ?? 0;
        expect(compPax).toBeLessThan(monoPax);
    });

    it('price war emits an event when we undercut', () => {
        const aircraft = makeAircraft({
            id: 'ac-pw',
            modelId: 'a320neo',
            assignedRouteId: 'route-pw',
            baseAirportIata: 'JFK',
        });
        const route = makeRoute({
            id: 'route-pw',
            originIata: 'JFK',
            destinationIata: 'LAX',
            distanceKm: 3000,
            assignedAircraftIds: [aircraft.id],
            fareEconomy: fp(50),
            fareBusiness: fp(150),
            fareFirst: fp(300),
        });

        const competitorOffer: FlightOffer = {
            airlinePubkey: 'competitor-2',
            fareEconomy: fp(200),
            fareBusiness: fp(500),
            fareFirst: fp(900),
            frequencyPerWeek: 7,
            travelTimeMinutes: 310,
            stops: 0,
            serviceScore: 0.7,
            brandScore: 0.6,
        };
        const registry = new Map<string, FlightOffer[]>([
            ['JFK-LAX', [competitorOffer]],
        ]);

        const { state } = simulateSingleLanding(aircraft, route, { globalRouteRegistry: registry });
        const priceWarEvent = state.events.find(e => e.type === 'price_war');
        expect(priceWarEvent).toBeTruthy();
    });

    it('registry entries for other routes do not affect our monopoly', () => {
        const aircraft = makeAircraft({
            id: 'ac-mono',
            modelId: 'a320neo',
            assignedRouteId: 'route-mono',
            baseAirportIata: 'JFK',
        });
        const route = makeRoute({
            id: 'route-mono',
            originIata: 'JFK',
            destinationIata: 'LAX',
            distanceKm: 3000,
            assignedAircraftIds: [aircraft.id],
        });

        const registry = new Map<string, FlightOffer[]>([
            ['LAX-SFO', [{
                airlinePubkey: 'competitor-3',
                fareEconomy: fp(120),
                fareBusiness: fp(300),
                fareFirst: fp(600),
                frequencyPerWeek: 14,
                travelTimeMinutes: 60,
                stops: 0,
                serviceScore: 0.7,
                brandScore: 0.6,
            }]],
        ]);

        const baseline = simulateSingleLanding(aircraft, route);
        const otherRoutes = simulateSingleLanding(aircraft, route, { globalRouteRegistry: registry });
        const basePax = baseline.landing.details?.passengers?.total ?? 0;
        const otherPax = otherRoutes.landing.details?.passengers?.total ?? 0;
        expect(otherPax).toBe(basePax);
    });
});

describe('FlightEngine — Edge cases', () => {
    it('safety grounding blocks takeoff when condition is low', () => {
        const aircraft = makeAircraft({
            id: 'ac-ground',
            modelId: 'a320neo',
            assignedRouteId: 'route-ground',
            condition: 0.15,
            baseAirportIata: 'JFK',
        });
        const route = makeRoute({
            id: 'route-ground',
            originIata: 'JFK',
            destinationIata: 'LAX',
            distanceKm: 3000,
            assignedAircraftIds: [aircraft.id],
        });

        const state = initState([aircraft], [route]);
        const dayTick = TICKS_PER_HOUR * 24;
        const nextState = runTick({ ...state, lastTick: dayTick - 1 }, dayTick);
        expect(nextState.fleet[0].status).toBe('idle');
        expect(nextState.events.some(e => e.type === 'maintenance')).toBe(true);
    });

    it('out-of-range routes do not take off', () => {
        const aircraft = makeAircraft({
            id: 'ac-range',
            modelId: 'atr72-600',
            assignedRouteId: 'route-range',
            baseAirportIata: 'JFK',
        });
        const route = makeRoute({
            id: 'route-range',
            originIata: 'JFK',
            destinationIata: 'LAX',
            distanceKm: 3000,
            assignedAircraftIds: [aircraft.id],
        });

        const state = initState([aircraft], [route]);
        const nextState = runTick(state, 1);
        expect(nextState.events.length).toBe(0);
        expect(nextState.fleet[0].status).toBe('idle');
    });

    it('balance can cross bankruptcy threshold after a loss', () => {
        const aircraft = makeAircraft({
            id: 'ac-loss',
            modelId: 'a380-800',
            assignedRouteId: 'route-loss',
            baseAirportIata: 'JFK',
        });
        const route = makeRoute({
            id: 'route-loss',
            originIata: 'JFK',
            destinationIata: 'LAX',
            distanceKm: 9000,
            assignedAircraftIds: [aircraft.id],
            fareEconomy: fp(1),
            fareBusiness: fp(1),
            fareFirst: fp(1),
        });

        let state = initState([aircraft], [route], fp(-9999000));
        state = runTick(state, 1);
        const arrivalTick = state.fleet[0].flight?.arrivalTick;
        if (!arrivalTick) throw new Error('Expected arrival tick');
        state = runTick(state, arrivalTick);

        const landing = findLastEvent(state.events, 'landing');
        expect(landing?.profit && fpToNumber(landing.profit)).toBeLessThan(0);
        expect(fpToNumber(state.balance)).toBeLessThan(-10000000);
    });

    it('multi-tick simulation completes outbound and return legs', () => {
        const aircraft = makeAircraft({
            id: 'ac-cycle',
            modelId: 'a320neo',
            assignedRouteId: 'route-cycle',
            baseAirportIata: 'JFK',
        });
        const route = makeRoute({
            id: 'route-cycle',
            originIata: 'JFK',
            destinationIata: 'LAX',
            distanceKm: 3000,
            assignedAircraftIds: [aircraft.id],
        });

        const model = getAircraftById(aircraft.modelId)!;
        const hours = route.distanceKm / model.speedKmh;
        const durationTicks = Math.ceil(hours * TICKS_PER_HOUR);
        const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
        const totalTicks = 1 + durationTicks + turnaroundTicks + durationTicks + 1;

        let state = initState([aircraft], [route]);
        for (let t = 1; t <= totalTicks; t += 1) {
            state = runTick(state, t);
        }

        const landingEvents = state.events.filter(e => e.type === 'landing');
        expect(landingEvents.length).toBeGreaterThanOrEqual(2);
        expect(state.fleet[0].flightHoursTotal).toBeGreaterThan(0);
    });

    it('orphaned flight uses fare snapshot when route is missing', () => {
        const fares = getSuggestedFares(3000);
        const aircraft = makeAircraft({
            id: 'ac-orphan',
            modelId: 'a320neo',
            status: 'enroute',
            assignedRouteId: null,
            baseAirportIata: 'JFK',
            flight: makeFlight({
                departureTick: 1,
                arrivalTick: 5,
                distanceKm: 3000,
                fareEconomy: fares.economy,
                fareBusiness: fares.business,
                fareFirst: fares.first,
                frequencyPerWeek: 7,
            }),
        });

        const state = initState([aircraft], []);
        const nextState = runTick(state, 5);
        const landing = findLastEvent(nextState.events, 'landing');
        expect(landing).toBeTruthy();
        expect(landing?.revenue && fpToNumber(landing.revenue)).toBeGreaterThan(0);
        expect(nextState.fleet[0].condition).toBeLessThan(1.0);
    });

    it('orphaned flight without fare snapshot yields zero revenue but still costs', () => {
        const aircraft = makeAircraft({
            id: 'ac-orphan-zero',
            modelId: 'a320neo',
            status: 'enroute',
            assignedRouteId: null,
            baseAirportIata: 'JFK',
            flight: makeFlight({
                departureTick: 1,
                arrivalTick: 5,
                distanceKm: 3000,
            }),
        });

        const state = initState([aircraft], []);
        const nextState = runTick(state, 5);
        const landing = findLastEvent(nextState.events, 'landing');
        expect(landing).toBeTruthy();
        expect(fpToNumber(landing?.revenue ?? fp(1))).toBe(0);
        expect(fpToNumber(landing?.cost ?? fp(0))).toBeGreaterThan(0);
    });
});

describe('FlightEngine — Economic variation', () => {
    it('seasonal multipliers affect beach destinations', () => {
        const origin = airports.find(a => a.iata === 'JFK') ?? airports[0];
        const destination = airports.find(a => a.tags.includes('beach')) ?? airports[0];
        const summer = calculateDemand(origin, destination, 'summer');
        const winter = calculateDemand(origin, destination, 'winter');
        const summerTotal = summer.economy + summer.business + summer.first;
        const winterTotal = winter.economy + winter.business + winter.first;
        expect(summerTotal).toBeGreaterThan(winterTotal);
    });

    it('prosperity index scales demand', () => {
        const origin = airports.find(a => a.iata === 'JFK') ?? airports[0];
        const destination = airports.find(a => a.iata === 'LAX') ?? airports[1] ?? airports[0];
        const boom = calculateDemand(origin, destination, 'summer', 1.15, 1.0);
        const recession = calculateDemand(origin, destination, 'summer', 0.85, 1.0);
        const boomTotal = boom.economy + boom.business + boom.first;
        const recessionTotal = recession.economy + recession.business + recession.first;
        expect(boomTotal).toBeGreaterThan(recessionTotal);
    });

    it('wear and tear accumulates with flight hours', () => {
        const aircraft = makeAircraft({
            id: 'ac-wear',
            modelId: 'a320neo',
            assignedRouteId: 'route-wear',
            baseAirportIata: 'JFK',
            condition: 1.0,
        });
        const route = makeRoute({
            id: 'route-wear',
            originIata: 'JFK',
            destinationIata: 'LAX',
            distanceKm: 3000,
            assignedAircraftIds: [aircraft.id],
        });

        let state = initState([aircraft], [route]);
        state = runTick(state, 1);
        const arrivalTick = state.fleet[0].flight?.arrivalTick;
        if (!arrivalTick) throw new Error('Expected arrival tick');
        state = runTick(state, arrivalTick);

        const model = getAircraftById('a320neo')!;
        const hours = route.distanceKm / model.speedKmh;
        const expectedWear = Math.min(24, hours) * 0.00005;
        const condition = state.fleet[0].condition;
        expect(condition).toBeCloseTo(1.0 - expectedWear, 6);
    });

    it('lease payments trigger on monthly boundaries', () => {
        const aircraft = makeAircraft({
            id: 'ac-lease',
            modelId: 'a320neo',
            purchaseType: 'lease',
            assignedRouteId: null,
            baseAirportIata: 'JFK',
        });

        const monthTicks = 30 * 24 * TICKS_PER_HOUR;
        const state = initState([aircraft], []);
        const nextState = runTick({ ...state, lastTick: monthTicks - 1 }, monthTicks);
        const leaseEvent = nextState.events.find(e => e.type === 'lease_payment');
        expect(leaseEvent).toBeTruthy();
        expect(fpToNumber(nextState.balance)).toBeLessThan(fpToNumber(state.balance));
    });
});
