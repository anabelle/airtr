import type { AircraftInstance, AirlineEntity, FixedPoint, Route } from "@acars/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";
import type { AirlineState } from "../types";
import {
  _getTickLockSkippedCount,
  _resetTickLockDiagnostics,
  createEngineSlice,
} from "./engineSlice";

// Reset mock call counts (but not implementations) before each test so that
// accumulated calls from one test suite do not pollute assertions in others
// (e.g. the fast-path test that asserts processFlightEngine was never called).
beforeEach(() => {
  vi.clearAllMocks();
  _resetTickLockDiagnostics();
});

vi.mock("../FlightEngine", () => ({
  processFlightEngine: vi.fn(),
  estimateLandingFinancials: vi.fn(() => ({
    revenue: { revenueTotal: 0, loadFactor: 0 },
    cost: { costTotal: 0 },
    profit: 0,
    details: {},
  })),
}));

vi.mock("@acars/nostr", () => ({
  publishAction: vi.fn(() =>
    Promise.resolve({
      id: "evt-1",
      created_at: 1,
      author: { pubkey: "player" },
    }),
  ),
  publishCheckpoint: vi.fn(() => Promise.resolve()),
}));

vi.mock("../engine", () => ({
  useEngineStore: {
    setState: vi.fn(),
    getState: vi.fn(() => ({
      catchupProgress: null,
    })),
  },
}));

vi.mock("@acars/data", async () => {
  const actual = await vi.importActual<typeof import("@acars/data")>("@acars/data");
  return {
    ...actual,
    getHubPricingForIata: vi.fn(() => ({ monthlyOpex: 1000, openFee: 0 })),
    getAircraftById: vi.fn(() => ({ monthlyLease: 500 as FixedPoint })),
  };
});

const makeAirline = (lastTick: number): AirlineEntity => ({
  id: "airline-1",
  foundedBy: "player",
  status: "private",
  ceoPubkey: "player",
  sharesOutstanding: 10000000,
  shareholders: { player: 10000000 },
  name: "Test Air",
  icaoCode: "TST",
  callsign: "TEST",
  hubs: ["JFK"],
  livery: { primary: "#000000", secondary: "#ffffff", accent: "#ffffff" },
  brandScore: 0.5,
  tier: 1,
  corporateBalance: 1000000000 as FixedPoint,
  stockPrice: 0 as FixedPoint,
  fleetIds: [],
  routeIds: [],
  lastTick,
  timeline: [],
});

const makeAircraft = (id: string): AircraftInstance => ({
  id,
  ownerPubkey: "player",
  modelId: "atr72-600",
  name: "Plane",
  status: "idle",
  assignedRouteId: null,
  baseAirportIata: "JFK",
  purchasedAtTick: 0,
  purchasePrice: 1000000 as FixedPoint,
  birthTick: 0,
  flight: null,
  purchaseType: "lease",
  configuration: { economy: 70, business: 0, first: 0, cargoKg: 0 },
  flightHoursTotal: 0,
  flightHoursSinceCheck: 0,
  condition: 1,
});

const createSliceState = (overrides: Partial<AirlineState>) => {
  const state = {
    airline: null,
    fleet: [],
    routes: [],
    timeline: [],
    actionChainHash: "",
    actionSeq: 0,
    fleetDeletedDuringCatchup: [],
    latestCheckpoint: null,
    pubkey: "player",
    identityStatus: "ready",
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
    fleetByOwner: new Map(),
    routesByOwner: new Map(),
    syncWorld: vi.fn(),
    syncCompetitor: vi.fn(),
    projectCompetitorFleet: vi.fn(),
  } as AirlineState;

  const set = vi.fn((partial: AirlineState | ((prev: AirlineState) => Partial<AirlineState>)) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    Object.assign(state, next);
  });
  const get = () => state;

  const slice = (createEngineSlice as StateCreator<AirlineState>)(set, get, {} as never);
  Object.assign(state, slice);
  Object.assign(state, overrides);
  return { state, set };
};

const makeRoute = (id: string, distanceKm: number): Route => ({
  id,
  originIata: "JFK",
  destinationIata: "LAX",
  airlinePubkey: "player",
  distanceKm,
  assignedAircraftIds: [],
  fareEconomy: 500 as FixedPoint,
  fareBusiness: 1000 as FixedPoint,
  fareFirst: 2000 as FixedPoint,
  status: "active",
});

describe("recovery sweep synchronized departure fix", () => {
  it("idle aircraft with different routeAssignedAtTick get different departure ticks (not all targetTick)", async () => {
    const { getAircraftById } = await import("@acars/data");
    vi.mocked(getAircraftById).mockReturnValue({
      monthlyLease: 500 as FixedPoint,
      speedKmh: 800,
      turnaroundTimeMinutes: 60,
      rangeKm: 5000,
    } as never);

    // Route: 400 km @ 800 km/h → durationTicks = ceil(400/800 * 1200) = 600
    // turnaroundTicks = ceil(60/60 * 1200) = 1200, roundTripTicks = 3600
    const route = makeRoute("rt-1", 400);

    // Two idle aircraft assigned to the same route, but at different ticks.
    // routeAssignedAtTick=900 → positionInCycle = (1000-900) % 3600 = 100 → outbound enroute, departureTick=900
    // routeAssignedAtTick=950 → positionInCycle = (1000-950) % 3600 = 50  → outbound enroute, departureTick=950
    const ac1: AircraftInstance = {
      ...makeAircraft("ac-1"),
      assignedRouteId: "rt-1",
      routeAssignedAtTick: 900,
      baseAirportIata: "JFK",
    };
    const ac2: AircraftInstance = {
      ...makeAircraft("ac-2"),
      assignedRouteId: "rt-1",
      routeAssignedAtTick: 950,
      baseAirportIata: "JFK",
    };

    const airline = makeAirline(999);
    const { state } = createSliceState({ airline, fleet: [ac1, ac2], routes: [route] });

    const { processFlightEngine } = await import("../FlightEngine");
    vi.mocked(processFlightEngine).mockImplementation(
      (_tick, currentFleet, _routes, corporateBalance) => ({
        updatedFleet: currentFleet,
        corporateBalance,
        events: [],
        hasChanges: false,
      }),
    );

    await state.processTick(1000);

    const final1 = state.fleet.find((ac) => ac.id === "ac-1");
    const final2 = state.fleet.find((ac) => ac.id === "ac-2");

    // Both aircraft must have been placed in-flight (not left idle)
    expect(final1?.status).toBe("enroute");
    expect(final2?.status).toBe("enroute");

    // They must NOT share the same departure tick (the old bug)
    expect(final1?.flight?.departureTick).toBe(900);
    expect(final2?.flight?.departureTick).toBe(950);
    expect(final1?.flight?.departureTick).not.toBe(final2?.flight?.departureTick);
  });

  it("turnaround aircraft depart at their own turnaroundEndTick rather than all at targetTick", async () => {
    const { getAircraftById } = await import("@acars/data");
    vi.mocked(getAircraftById).mockReturnValue({
      monthlyLease: 500 as FixedPoint,
      speedKmh: 800,
      turnaroundTimeMinutes: 60,
      rangeKm: 5000,
    } as never);

    const route = makeRoute("rt-1", 400);

    // Two turnaround aircraft that finished turnaround before targetTick=1000 at different ticks
    const baseFlight = {
      originIata: "JFK",
      destinationIata: "LAX",
      departureTick: 300,
      arrivalTick: 900,
      direction: "outbound" as const,
    };

    const ac1: AircraftInstance = {
      ...makeAircraft("ac-1"),
      status: "turnaround",
      assignedRouteId: "rt-1",
      turnaroundEndTick: 990,
      arrivalTickProcessed: 900,
      baseAirportIata: "LAX",
      flight: baseFlight,
    };
    const ac2: AircraftInstance = {
      ...makeAircraft("ac-2"),
      status: "turnaround",
      assignedRouteId: "rt-1",
      turnaroundEndTick: 995,
      arrivalTickProcessed: 900,
      baseAirportIata: "LAX",
      flight: baseFlight,
    };

    const airline = makeAirline(999);
    const { state } = createSliceState({ airline, fleet: [ac1, ac2], routes: [route] });

    const { processFlightEngine } = await import("../FlightEngine");
    vi.mocked(processFlightEngine).mockImplementation(
      (_tick, currentFleet, _routes, corporateBalance) => ({
        updatedFleet: currentFleet,
        corporateBalance,
        events: [],
        hasChanges: false,
      }),
    );

    await state.processTick(1000);

    const final1 = state.fleet.find((ac) => ac.id === "ac-1");
    const final2 = state.fleet.find((ac) => ac.id === "ac-2");

    // Both must be on their return legs
    expect(final1?.status).toBe("enroute");
    expect(final2?.status).toBe("enroute");
    expect(final1?.flight?.direction).toBe("inbound");
    expect(final2?.flight?.direction).toBe("inbound");

    // Each aircraft must depart at its own turnaroundEndTick, not the shared targetTick
    expect(final1?.flight?.departureTick).toBe(990);
    expect(final2?.flight?.departureTick).toBe(995);
    expect(final1?.flight?.departureTick).not.toBe(final2?.flight?.departureTick);
  });

  it("enroute recovery computes turnaroundEndTick from arrivalTick (not targetTick)", async () => {
    const { getAircraftById } = await import("@acars/data");
    vi.mocked(getAircraftById).mockReturnValue({
      monthlyLease: 500 as FixedPoint,
      speedKmh: 800,
      turnaroundTimeMinutes: 60, // => 1200 ticks
      rangeKm: 5000,
    } as never);

    const route = makeRoute("rt-1", 400);

    // Aircraft is enroute and arrived before targetTick=1000
    const ac: AircraftInstance = {
      ...makeAircraft("ac-1"),
      status: "enroute",
      assignedRouteId: "rt-1",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 300,
        arrivalTick: 900, // arrived before targetTick=1000
        direction: "outbound",
      },
    };

    const { state } = createSliceState({ airline: makeAirline(999), fleet: [ac], routes: [route] });
    const { processFlightEngine } = await import("../FlightEngine");
    vi.mocked(processFlightEngine).mockImplementation(
      (_tick, currentFleet, _routes, corporateBalance) => ({
        updatedFleet: currentFleet,
        corporateBalance,
        events: [],
        hasChanges: false,
      }),
    );

    await state.processTick(1000);
    const final = state.fleet.find((x) => x.id === "ac-1");
    // turnaroundEndTick must be anchored to arrivalTick, not targetTick
    expect(final?.status).toBe("turnaround");
    expect(final?.turnaroundEndTick).toBe(900 + 1200);
  });
});

describe("engineSlice fast-path", () => {
  it("skips flight engine when idle and no active routes", async () => {
    const airline = makeAirline(0);
    const fleet = [makeAircraft("ac-1")];
    const routes: Route[] = [];

    const { state } = createSliceState({ airline, fleet, routes });

    await state.processTick(1000000);

    const { processFlightEngine } = await import("../FlightEngine");
    expect(processFlightEngine).not.toHaveBeenCalled();
    expect(state.airline?.lastTick).toBeGreaterThan(0);
  });

  it("excludes optimistically deleted aircraft when merging fleet after catchup", async () => {
    const airline = makeAirline(0);
    const fleet = [makeAircraft("ac-1")];
    const routes: Route[] = [
      {
        id: "rt-1",
        originIata: "JFK",
        destinationIata: "LAX",
        airlinePubkey: "player",
        distanceKm: 1000,
        assignedAircraftIds: [],
        fareEconomy: 1000 as FixedPoint,
        fareBusiness: 2000 as FixedPoint,
        fareFirst: 3000 as FixedPoint,
        status: "active",
      },
    ];

    const { state } = createSliceState({ airline, fleet, routes });
    const { processFlightEngine } = await import("../FlightEngine");
    vi.mocked(processFlightEngine).mockImplementation(
      (tick, currentFleet, _routes, corporateBalance) => {
        if (tick === 1) {
          state.fleet = [];
          state.fleetDeletedDuringCatchup = ["ac-1"];
        }
        return {
          updatedFleet: currentFleet,
          corporateBalance,
          events: [],
          hasChanges: false,
        };
      },
    );

    await state.processTick(2);

    expect(state.fleet.some((ac) => ac.id === "ac-1")).toBe(false);
  });

  it("clears fleetDeletedDuringCatchup on fast-path set", async () => {
    const airline = makeAirline(0);
    const fleet = [makeAircraft("ac-1")];
    const routes: Route[] = [];

    const { state } = createSliceState({
      airline,
      fleet,
      routes,
      fleetDeletedDuringCatchup: ["ac-old"],
    });

    await state.processTick(1000000);

    // Fast-path should clear the stale deletion IDs
    expect(state.fleetDeletedDuringCatchup).toEqual([]);
  });
});

describe("engineSlice lock diagnostics", () => {
  it("increments skipped-lock counter when overlapping processTick calls contend", async () => {
    const airline = makeAirline(0);
    const fleet = [makeAircraft("ac-1")];
    const routes: Route[] = [makeRoute("rt-1", 400)];
    const { state } = createSliceState({ airline, fleet, routes });

    const { processFlightEngine } = await import("../FlightEngine");
    vi.mocked(processFlightEngine).mockImplementation(
      (_tick, currentFleet, _routes, corporateBalance) => ({
        updatedFleet: currentFleet,
        corporateBalance,
        events: [],
        hasChanges: false,
      }),
    );

    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      const first = state.processTick(2001);
      const second = state.processTick(2002);
      await Promise.all([first, second]);

      expect(_getTickLockSkippedCount()).toBeGreaterThan(0);
      expect(debugSpy).toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
    }
  });
});

describe("deterministic timeline backfill", () => {
  it("generates historical landing events for aircraft with assigned routes regardless of status", async () => {
    const { getAircraftById } = await import("@acars/data");
    vi.mocked(getAircraftById).mockReturnValue({
      monthlyLease: 500 as FixedPoint,
      speedKmh: 800,
      turnaroundTimeMinutes: 60,
      rangeKm: 5000,
    } as never);

    // Route: 400 km @ 800 km/h → durationTicks = ceil(400/800 * 1200) = 600
    // turnaroundTicks = ceil(60/60 * 1200) = 1200
    // roundTripTicks = 600 * 2 + 1200 * 2 = 3600
    // First outbound landing at cycleAnchor + 600 = 1600
    // First inbound landing at cycleAnchor + 600*2 + 1200 = 3400
    // Second outbound at 1600 + 3600 = 5200, etc.
    const route = makeRoute("rt-1", 400);

    // Aircraft assigned at tick 1000, NOW at tick 20000.
    // It's already been reconciled to enroute (not idle) — the backfill must still work.
    const ac: AircraftInstance = {
      ...makeAircraft("ac-1"),
      status: "enroute", // Already reconciled by reconcileFleetToTick
      assignedRouteId: "rt-1",
      routeAssignedAtTick: 1000,
      baseAirportIata: "JFK",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 19900,
        arrivalTick: 20500,
        direction: "outbound",
      },
    };

    // airline.lastTick close to tick (simulating TICK_UPDATE advancing lastTick)
    const airline = makeAirline(19999);
    const { state } = createSliceState({
      airline,
      fleet: [ac],
      routes: [route],
      timeline: [],
    });

    const { processFlightEngine } = await import("../FlightEngine");
    vi.mocked(processFlightEngine).mockImplementation(
      (_tick, currentFleet, _routes, corporateBalance) => ({
        updatedFleet: currentFleet,
        corporateBalance,
        events: [],
        hasChanges: false,
      }),
    );

    await state.processTick(20000);

    // Compute expected landings: from routeAssignedAtTick=1000 to targetTick=20000
    // Outbound landings at: 1600, 5200, 8800, 12400, 16000, 19600 (6 landings)
    // Inbound landings at: 3400, 7000, 10600, 14200, 17800 (5 landings)
    // Total: 11 landings
    const landings = state.timeline.filter(
      (e) => e.type === "landing" && e.id.startsWith("evt-landing-"),
    );
    expect(landings.length).toBe(11);

    // Verify chronological ordering (most recent first in timeline)
    expect(landings[0].tick).toBe(19600);
    expect(landings[landings.length - 1].tick).toBe(1600);

    // Each event has financial data
    for (const landing of landings) {
      expect(landing.revenue).toBeDefined();
      expect(landing.cost).toBeDefined();
      expect(landing.profit).toBeDefined();
    }
  });

  it("caps backfill to MAX_BACKFILL_PER_AIRCRAFT most recent events", async () => {
    const { getAircraftById } = await import("@acars/data");
    vi.mocked(getAircraftById).mockReturnValue({
      monthlyLease: 500 as FixedPoint,
      speedKmh: 800,
      turnaroundTimeMinutes: 60,
      rangeKm: 5000,
    } as never);

    // Short route: 100 km → durationTicks = ceil(100/800 * 1200) = 150
    // turnaroundTicks = 1200, roundTripTicks = 150*2 + 1200*2 = 2700
    // Very many landings in a large gap
    const route = makeRoute("rt-1", 100);

    const ac: AircraftInstance = {
      ...makeAircraft("ac-1"),
      status: "enroute",
      assignedRouteId: "rt-1",
      routeAssignedAtTick: 1000,
      baseAirportIata: "JFK",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 199900,
        arrivalTick: 200050,
        direction: "outbound",
      },
    };

    // Huge gap — would produce 100+ landings without capping
    const airline = makeAirline(199999);
    const { state } = createSliceState({
      airline,
      fleet: [ac],
      routes: [route],
      timeline: [],
    });

    const { processFlightEngine } = await import("../FlightEngine");
    vi.mocked(processFlightEngine).mockImplementation(
      (_tick, currentFleet, _routes, corporateBalance) => ({
        updatedFleet: currentFleet,
        corporateBalance,
        events: [],
        hasChanges: false,
      }),
    );

    await state.processTick(200000);

    const landings = state.timeline.filter(
      (e) => e.type === "landing" && e.id.startsWith("evt-landing-"),
    );
    // MAX_BACKFILL_PER_AIRCRAFT = 40, so capped at 40
    expect(landings.length).toBe(40);

    // Verify they're the most recent 40 landings (highest ticks)
    for (let i = 0; i < landings.length - 1; i++) {
      expect(landings[i].tick).toBeGreaterThan(landings[i + 1].tick);
    }
  });

  it("does not modify balance (display-only events)", async () => {
    const { getAircraftById } = await import("@acars/data");
    vi.mocked(getAircraftById).mockReturnValue({
      monthlyLease: 500 as FixedPoint,
      speedKmh: 800,
      turnaroundTimeMinutes: 60,
      rangeKm: 5000,
    } as never);

    const route = makeRoute("rt-1", 400);

    const ac: AircraftInstance = {
      ...makeAircraft("ac-1"),
      status: "enroute",
      assignedRouteId: "rt-1",
      routeAssignedAtTick: 1000,
      baseAirportIata: "JFK",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 19900,
        arrivalTick: 20500,
        direction: "outbound",
      },
    };

    const initialBalance = 1000000000 as FixedPoint;
    const airline = makeAirline(19999);
    airline.corporateBalance = initialBalance;

    const { state } = createSliceState({
      airline,
      fleet: [ac],
      routes: [route],
      timeline: [],
    });

    const { processFlightEngine } = await import("../FlightEngine");
    vi.mocked(processFlightEngine).mockImplementation(
      (_tick, currentFleet, _routes, corporateBalance) => ({
        updatedFleet: currentFleet,
        corporateBalance,
        events: [],
        hasChanges: false,
      }),
    );

    await state.processTick(20000);

    // Balance should only be affected by processFlightEngine (mocked to no-op)
    // and monthly costs, not by backfill events
    expect(state.airline?.corporateBalance).toBe(initialBalance);
  });

  it("deduplicates against existing timeline events from checkpoint", async () => {
    const { getAircraftById } = await import("@acars/data");
    vi.mocked(getAircraftById).mockReturnValue({
      monthlyLease: 500 as FixedPoint,
      speedKmh: 800,
      turnaroundTimeMinutes: 60,
      rangeKm: 5000,
    } as never);

    const route = makeRoute("rt-1", 400);

    const ac: AircraftInstance = {
      ...makeAircraft("ac-1"),
      status: "enroute",
      assignedRouteId: "rt-1",
      routeAssignedAtTick: 1000,
      baseAirportIata: "JFK",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 19900,
        arrivalTick: 20500,
        direction: "outbound",
      },
    };

    // Pre-populate timeline with some events (simulating checkpoint)
    const existingEvents = [
      {
        id: "evt-landing-ac-1-1600",
        tick: 1600,
        timestamp: 0,
        type: "landing" as const,
        description: "existing",
      },
      {
        id: "evt-landing-ac-1-3400",
        tick: 3400,
        timestamp: 0,
        type: "landing" as const,
        description: "existing",
      },
    ];

    const airline = makeAirline(19999);
    const { state } = createSliceState({
      airline,
      fleet: [ac],
      routes: [route],
      timeline: existingEvents,
    });

    const { processFlightEngine } = await import("../FlightEngine");
    vi.mocked(processFlightEngine).mockImplementation(
      (_tick, currentFleet, _routes, corporateBalance) => ({
        updatedFleet: currentFleet,
        corporateBalance,
        events: [],
        hasChanges: false,
      }),
    );

    await state.processTick(20000);

    // Should not have duplicates — existing events preserved, new ones added
    const allLandingIds = state.timeline.filter((e) => e.type === "landing").map((e) => e.id);
    const uniqueIds = new Set(allLandingIds);
    expect(uniqueIds.size).toBe(allLandingIds.length);

    // Total should be 11 (all computed landings) — 2 existing + 9 new
    expect(uniqueIds.size).toBe(11);
  });
});
