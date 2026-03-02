import type { AircraftInstance, AirlineEntity, FixedPoint, Route } from "@acars/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";
import type { AirlineState } from "../types";
import { createEngineSlice } from "./engineSlice";

// Reset mock call counts (but not implementations) before each test so that
// accumulated calls from one test suite do not pollute assertions in others
// (e.g. the fast-path test that asserts processFlightEngine was never called).
beforeEach(() => {
  vi.clearAllMocks();
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
