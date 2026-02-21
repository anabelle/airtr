import { create } from 'zustand';
import {
    calculateDemand,
    getProsperityIndex,
    haversineDistance,
    getSeason,
    fpScale,
    fp,
} from '@airtr/core';
import type { Airport, Season, FixedPoint } from '@airtr/core';
import { airports as AIRPORTS } from '@airtr/data';

export interface RouteData {
    origin: Airport;
    destination: Airport;
    distance: number;
    demand: { economy: number; business: number; first: number };
    estimatedDailyRevenue: FixedPoint;
    season: Season;
}

export interface UserLocation {
    latitude: number;
    longitude: number;
    source: 'gps' | 'timezone' | 'manual';
}

function generateRoutes(home: Airport, tick: number): RouteData[] {
    const now = new Date();
    const prosperity = getProsperityIndex(tick);

    const others = AIRPORTS
        .filter(a => a.iata !== home.iata)
        .map(a => ({
            airport: a,
            distance: haversineDistance(home.latitude, home.longitude, a.latitude, a.longitude),
        }))
        .sort((a, b) => a.distance - b.distance);

    // Pick: 2 short-haul, 2 medium, 2 long-haul
    const picks: Airport[] = [];
    if (others.length >= 2) picks.push(others[0].airport, others[1].airport);
    const midIdx = Math.floor(others.length * 0.4);
    const midIdx2 = Math.floor(others.length * 0.5);
    if (others.length >= 6) picks.push(others[midIdx].airport, others[midIdx2].airport);
    if (others.length >= 4) picks.push(others[others.length - 2].airport, others[others.length - 1].airport);

    return picks.map(dest => {
        const season = getSeason(dest.latitude, now);
        const distance = haversineDistance(home.latitude, home.longitude, dest.latitude, dest.longitude);
        const demand = calculateDemand(home, dest, season, prosperity);
        const avgFarePerKm = 0.12;
        const baseFare = Math.max(80, Math.round(distance * avgFarePerKm));
        const totalPax = demand.economy + demand.business + demand.first;
        const estimatedDailyRevenue = fpScale(fp(baseFare), totalPax / 7);
        return { origin: home, destination: dest, distance, demand, estimatedDailyRevenue, season };
    });
}

// Add memoized distance lookups, etc. when needed

export interface EngineState {
    tick: number;
    userLocation: UserLocation | null;
    homeAirport: Airport | null;
    routes: RouteData[];
    locationMethod: string;
    isEngineRunning: boolean;

    setHub: (airport: Airport, loc: UserLocation, method: string) => void;
    advanceTick: () => void;
    startEngine: () => void;
    stopEngine: () => void;
}

let engineInterval: ReturnType<typeof setInterval> | null = null;

export const useEngineStore = create<EngineState>((set, get) => ({
    tick: 0,
    userLocation: null,
    homeAirport: null,
    routes: [],
    locationMethod: '',
    isEngineRunning: false,

    setHub: (airport, loc, method) => {
        set((state) => ({
            userLocation: loc,
            homeAirport: airport,
            locationMethod: method,
            routes: generateRoutes(airport, state.tick)
        }));
    },

    advanceTick: () => {
        set((state) => {
            const nextTick = state.tick + 1;
            return {
                tick: nextTick,
                routes: state.homeAirport ? generateRoutes(state.homeAirport, nextTick) : []
            };
        });
    },

    startEngine: () => {
        const { isEngineRunning, advanceTick } = get();
        if (isEngineRunning) return;

        engineInterval = setInterval(() => {
            advanceTick();
        }, 3000);

        set({ isEngineRunning: true });
    },

    stopEngine: () => {
        if (engineInterval) {
            clearInterval(engineInterval);
            engineInterval = null;
        }
        set({ isEngineRunning: false });
    }
}));
