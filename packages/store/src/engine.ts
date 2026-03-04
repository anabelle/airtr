import type { Airport, FixedPoint, Season } from "@acars/core";
import {
  calculateDemand,
  fp,
  fpDiv,
  fpScale,
  GENESIS_TIME,
  getProsperityIndex,
  getSeason,
  haversineDistance,
  TICK_DURATION,
} from "@acars/core";
import { airports as AIRPORTS } from "@acars/data";
import { create } from "zustand";

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
  source: "gps" | "timezone" | "manual";
}

let cachedHomeIata: string | null = null;
let cachedSortedOthers: { airport: Airport; distance: number }[] = [];

function generateRoutes(home: Airport, tick: number): RouteData[] {
  const now = new Date();
  const prosperity = getProsperityIndex(tick);

  if (cachedHomeIata !== home.iata) {
    cachedHomeIata = home.iata;
    cachedSortedOthers = AIRPORTS.filter((a) => a.iata !== home.iata)
      .map((a) => ({
        airport: a,
        distance: haversineDistance(home.latitude, home.longitude, a.latitude, a.longitude),
      }))
      .sort((a, b) => a.distance - b.distance);
  }

  const others = cachedSortedOthers;

  // Pick: 2 short-haul, 2 medium, 2 long-haul
  const picks: Airport[] = [];
  if (others.length >= 2) picks.push(others[0].airport, others[1].airport);
  const midIdx = Math.floor(others.length * 0.4);
  const midIdx2 = Math.floor(others.length * 0.5);
  if (others.length >= 6) picks.push(others[midIdx].airport, others[midIdx2].airport);
  if (others.length >= 4)
    picks.push(others[others.length - 2].airport, others[others.length - 1].airport);

  return picks.map((dest) => {
    const season = getSeason(dest.latitude, now);
    const distance = haversineDistance(
      home.latitude,
      home.longitude,
      dest.latitude,
      dest.longitude,
    );
    const demand = calculateDemand(home, dest, season, prosperity, 1.0);
    const avgFarePerKm = 0.12;
    const baseFare = Math.max(80, Math.round(distance * avgFarePerKm));
    const totalPax = demand.economy + demand.business + demand.first;
    const estimatedDailyRevenue = fpDiv(fpScale(fp(baseFare), totalPax), fp(7));
    return {
      origin: home,
      destination: dest,
      distance,
      demand,
      estimatedDailyRevenue,
      season,
    };
  });
}

// --- Universal Clock Configuration is now handled in @acars/core ---

function calculateGlobalTick(): number {
  const now = Date.now();
  const elapsed = now - GENESIS_TIME;
  return Math.max(0, Math.floor(elapsed / TICK_DURATION));
}

export interface EngineState {
  tick: number;
  tickProgress: number; // 0 to 1
  userLocation: UserLocation | null;
  homeAirport: Airport | null;
  routes: RouteData[];
  locationMethod: string;
  isEngineRunning: boolean;
  catchupProgress: {
    current: number;
    target: number;
    phase: "player" | "competitor";
  } | null;

  /** IATA of airport focused via permalink (e.g. /airport/JFK) */
  permalinkAirportIata: string | null;
  /** Aircraft ID focused via permalink (e.g. /aircraft/abc123) */
  permalinkAircraftId: string | null;

  syncTick: () => void;
  setHub: (airport: Airport, loc: UserLocation, method: string) => void;
  startEngine: () => void;
  stopEngine: () => void;
  setPermalinkAirport: (iata: string | null) => void;
  setPermalinkAircraft: (id: string | null) => void;
}

let engineProgressInterval: ReturnType<typeof setInterval> | null = null;
let engineTimeout: ReturnType<typeof setTimeout> | null = null;
const TICK_BOUNDARY_BUFFER_MS = 50;

function getMsIntoTick(elapsed: number): number {
  // JS modulo can be negative for negative elapsed values; normalize to [0, TICK_DURATION).
  return ((elapsed % TICK_DURATION) + TICK_DURATION) % TICK_DURATION;
}

export const useEngineStore = create<EngineState>((set, get) => ({
  tick: calculateGlobalTick(),
  tickProgress: 0,
  userLocation: null,
  homeAirport: null,
  routes: [],
  locationMethod: "",
  isEngineRunning: false,
  catchupProgress: null,
  permalinkAirportIata: null,
  permalinkAircraftId: null,

  setPermalinkAirport: (iata) => set({ permalinkAirportIata: iata }),
  setPermalinkAircraft: (id) => set({ permalinkAircraftId: id }),

  syncTick: () => {
    const now = Date.now();
    const elapsed = now - GENESIS_TIME;
    const nextTick = Math.max(0, Math.floor(elapsed / TICK_DURATION));
    const progress = getMsIntoTick(elapsed) / TICK_DURATION;

    const { tick, homeAirport } = get();

    if (nextTick !== tick) {
      set({
        tick: nextTick,
        tickProgress: progress,
        routes: homeAirport ? generateRoutes(homeAirport, nextTick) : [],
      });
    } else {
      set({ tickProgress: progress });
    }
  },

  setHub: (airport, loc, method) => {
    const currentTick = calculateGlobalTick();
    set({
      tick: currentTick,
      userLocation: loc,
      homeAirport: airport,
      locationMethod: method,
      routes: generateRoutes(airport, currentTick),
    });
  },

  startEngine: () => {
    const { isEngineRunning, syncTick } = get();
    if (isEngineRunning) return;

    const scheduleNextTick = () => {
      const now = Date.now();
      const elapsed = now - GENESIS_TIME;
      const msIntoTick = getMsIntoTick(elapsed);
      const msUntilNextTick = TICK_DURATION - msIntoTick + TICK_BOUNDARY_BUFFER_MS;

      engineTimeout = setTimeout(() => {
        syncTick();
        scheduleNextTick();
      }, msUntilNextTick);
    };

    syncTick();
    scheduleNextTick();
    engineProgressInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - GENESIS_TIME;
      const progress = getMsIntoTick(elapsed) / TICK_DURATION;
      set({ tickProgress: progress });
    }, 1000);
    set({ isEngineRunning: true });
  },

  stopEngine: () => {
    if (engineTimeout) {
      clearTimeout(engineTimeout);
      engineTimeout = null;
    }
    if (engineProgressInterval) {
      clearInterval(engineProgressInterval);
      engineProgressInterval = null;
    }
    set({ isEngineRunning: false });
  },
}));
