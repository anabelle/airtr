import {
  type AircraftInstance,
  type AirlineEntity,
  type FixedPoint,
  fp,
  type Route,
} from "@acars/core";
import { publishAction } from "@acars/nostr";
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
  reconcileFleetToTick: vi.fn((fleet: AircraftInstance[]) => ({
    fleet,
    balanceDelta: 0,
    events: [],
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
  cumulativeRevenue: fp(0),
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
          tickRevenue: fp(0),
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
        tickRevenue: fp(0),
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

describe("immediate visual reconciliation during catch-up", () => {
  it("projects fleet to target tick before tick-by-tick loop begins", async () => {
    const { reconcileFleetToTick } = await import("../FlightEngine");
    const { processFlightEngine } = await import("../FlightEngine");

    const enrouteAircraft: AircraftInstance = {
      ...makeAircraft("ac-enroute"),
      status: "enroute",
      assignedRouteId: "rt-1",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 800,
        arrivalTick: 1400,
        distanceKm: 4000,
        purpose: "scheduled",
      },
    };

    const projectedAircraft: AircraftInstance = {
      ...enrouteAircraft,
      status: "enroute",
      flight: {
        originIata: "LAX",
        destinationIata: "JFK",
        departureTick: 2600,
        arrivalTick: 3200,
        distanceKm: 4000,
        purpose: "scheduled",
      },
    };

    vi.mocked(reconcileFleetToTick).mockReturnValue({
      fleet: [projectedAircraft],
      balanceDelta: 0 as FixedPoint,
      events: [],
    });

    vi.mocked(processFlightEngine).mockReturnValue({
      updatedFleet: [projectedAircraft],
      corporateBalance: 1000000000 as FixedPoint,
      events: [],
      hasChanges: true,
      tickRevenue: fp(0),
    });

    const route = makeRoute("rt-1", 4000);
    const { state, set } = createSliceState({
      airline: makeAirline(1000),
      fleet: [enrouteAircraft],
      routes: [route],
    });

    await state.processTick(5000);

    // reconcileFleetToTick should have been called with original fleet and target tick
    expect(reconcileFleetToTick).toHaveBeenCalledWith([enrouteAircraft], [route], 5000);

    // The first set() call with fleet should be the projected fleet (immediate visual fix)
    const fleetSetCalls = vi
      .mocked(set)
      .mock.calls.filter(
        (call) => typeof call[0] === "object" && "fleet" in (call[0] as Record<string, unknown>),
      );
    expect(fleetSetCalls.length).toBeGreaterThanOrEqual(1);
    const firstFleetSet = fleetSetCalls[0][0] as { fleet: AircraftInstance[] };
    expect(firstFleetSet.fleet).toEqual([projectedAircraft]);
  });

  it("skips projection when gap is only 1 tick", async () => {
    const { reconcileFleetToTick } = await import("../FlightEngine");
    const { processFlightEngine } = await import("../FlightEngine");

    vi.mocked(processFlightEngine).mockReturnValue({
      updatedFleet: [makeAircraft("ac-1")],
      corporateBalance: 1000000000 as FixedPoint,
      events: [],
      hasChanges: false,
      tickRevenue: fp(0),
    });

    const route = makeRoute("rt-1", 400);
    const aircraft: AircraftInstance = {
      ...makeAircraft("ac-1"),
      assignedRouteId: "rt-1",
      status: "enroute",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 998,
        arrivalTick: 1500,
        distanceKm: 400,
        purpose: "scheduled",
      },
    };

    const { state } = createSliceState({
      airline: makeAirline(999),
      fleet: [aircraft],
      routes: [route],
    });

    // Gap = 1 tick (1000 - 999), should NOT trigger projection
    await state.processTick(1000);
    expect(reconcileFleetToTick).not.toHaveBeenCalled();
  });
});

describe("TICK_UPDATE publish cadence", () => {
  it("throttles non-material publishes to heartbeat cadence", async () => {
    const { processFlightEngine } = await import("../FlightEngine");
    vi.mocked(processFlightEngine).mockImplementation(
      (_tick, currentFleet, _routes, corporateBalance) => ({
        updatedFleet: currentFleet,
        corporateBalance,
        events: [],
        hasChanges: true,
        tickRevenue: fp(0),
      }),
    );

    const route = makeRoute("rt-1", 400);
    const { state } = createSliceState({
      airline: makeAirline(999),
      fleet: [makeAircraft("ac-1")],
      routes: [route],
    });

    await state.processTick(1000);
    for (let tick = 1001; tick < 1020; tick += 1) {
      await state.processTick(tick);
    }
    expect(vi.mocked(publishAction)).toHaveBeenCalledTimes(1);

    await state.processTick(1020);
    expect(vi.mocked(publishAction)).toHaveBeenCalledTimes(2);
  });

  it("does NOT publish immediately on routine timeline events (rides heartbeat)", async () => {
    const { processFlightEngine } = await import("../FlightEngine");
    vi.mocked(processFlightEngine).mockImplementation(
      (tick, currentFleet, _routes, corporateBalance) => ({
        updatedFleet: currentFleet,
        corporateBalance,
        events:
          tick === 1001
            ? [
                {
                  id: `evt-landing-${tick}`,
                  tick,
                  timestamp: 0,
                  type: "landing",
                  description: "routine landing event",
                },
              ]
            : [],
        hasChanges: true,
        tickRevenue: fp(0),
      }),
    );

    const route = makeRoute("rt-1", 400);
    const { state } = createSliceState({
      airline: makeAirline(999),
      fleet: [makeAircraft("ac-1")],
      routes: [route],
    });

    // First tick publishes (first-ever publish).
    await state.processTick(1000);
    // Second tick has a landing event but should NOT publish
    // immediately — routine events ride the heartbeat cadence.
    await state.processTick(1001);

    expect(vi.mocked(publishAction)).toHaveBeenCalledTimes(1);
  });

  it("publishes immediately when airline status changes within heartbeat window", async () => {
    const route = makeRoute("rt-1", 400);
    const { state, set } = createSliceState({
      airline: makeAirline(999),
      fleet: [makeAircraft("ac-1")],
      routes: [route],
    });

    const { processFlightEngine } = await import("../FlightEngine");
    vi.mocked(processFlightEngine).mockImplementation(
      (tick, currentFleet, _routes, corporateBalance) => {
        if (tick === 1001 && state.airline) {
          set({
            airline: {
              ...state.airline,
              status: "chapter11",
            },
          });
        }
        return {
          updatedFleet: currentFleet,
          corporateBalance,
          events: [],
          hasChanges: true,
          tickRevenue: fp(0),
        };
      },
    );

    await state.processTick(1000);
    await state.processTick(1001);

    expect(vi.mocked(publishAction)).toHaveBeenCalledTimes(2);
  });

  it("includes identity fields in bankruptcy TICK_UPDATE payload", async () => {
    const bankruptAirline = {
      ...makeAirline(999),
      corporateBalance: fp(-100000000),
      name: "Bankrupt Air",
      icaoCode: "BNKR",
      callsign: "BROKE",
      hubs: ["BOG"],
      tier: 3,
      cumulativeRevenue: fp(50000000),
    };
    const { state } = createSliceState({
      airline: bankruptAirline,
      fleet: [makeAircraft("ac-1")],
      routes: [makeRoute("rt-1", 400)],
    });

    await state.processTick(1000);
    expect(vi.mocked(publishAction)).toHaveBeenCalledTimes(1);

    const publishedAction = vi.mocked(publishAction).mock.calls[0][0];
    expect(publishedAction.action).toBe("TICK_UPDATE");
    expect(publishedAction.payload.status).toBe("chapter11");
    expect(publishedAction.payload.airlineName).toBe("Bankrupt Air");
    expect(publishedAction.payload.icaoCode).toBe("BNKR");
    expect(publishedAction.payload.callsign).toBe("BROKE");
    expect(publishedAction.payload.hubs).toEqual(["BOG"]);
    expect(publishedAction.payload.tier).toBe(3);
    expect(publishedAction.payload.cumulativeRevenue).toBe(bankruptAirline.cumulativeRevenue);
    expect(publishedAction.payload.brandScore).toBe(bankruptAirline.brandScore);
  });

  it("throttles retry attempts when publish fails", async () => {
    const { processFlightEngine } = await import("../FlightEngine");
    vi.mocked(processFlightEngine).mockImplementation(
      (_tick, currentFleet, _routes, corporateBalance) => ({
        updatedFleet: currentFleet,
        corporateBalance,
        events: [],
        hasChanges: true,
        tickRevenue: fp(0),
      }),
    );
    vi.mocked(publishAction).mockRejectedValue(new Error("Not enough relays received the event"));

    const route = makeRoute("rt-1", 400);
    const { state } = createSliceState({
      airline: makeAirline(999),
      fleet: [makeAircraft("ac-1")],
      routes: [route],
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await state.processTick(1000);
      for (let tick = 1001; tick < 1020; tick += 1) {
        await state.processTick(tick);
      }
      expect(vi.mocked(publishAction)).toHaveBeenCalledTimes(1);

      await state.processTick(1020);
      expect(vi.mocked(publishAction)).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("includes corporateBalance in TICK_UPDATE payload", async () => {
    const { processFlightEngine } = await import("../FlightEngine");
    const updatedBalance = 888888888 as FixedPoint;
    vi.mocked(processFlightEngine).mockImplementation((_tick, currentFleet) => ({
      updatedFleet: currentFleet,
      corporateBalance: updatedBalance,
      events: [],
      hasChanges: true,
      tickRevenue: fp(0),
    }));

    const route = makeRoute("rt-1", 400);
    const { state } = createSliceState({
      airline: makeAirline(999),
      fleet: [makeAircraft("ac-1")],
      routes: [route],
    });

    await state.processTick(1000);
    expect(vi.mocked(publishAction)).toHaveBeenCalledTimes(1);

    const publishedAction = vi.mocked(publishAction).mock.calls[0][0];
    expect(publishedAction.action).toBe("TICK_UPDATE");
    expect(publishedAction.payload.corporateBalance).toBe(updatedBalance);
  });
});
