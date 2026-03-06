import type {
  AircraftInstance,
  AirlineEntity,
  FixedPoint,
  Route,
  TimelineEvent,
} from "@acars/core";
import { fpAdd } from "@acars/core";
import { describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";
import type { AirlineState } from "../types";
import { createNetworkSlice } from "./networkSlice";

vi.mock("@acars/nostr", () => ({
  publishAction: vi.fn(() =>
    Promise.resolve({
      id: "evt-1",
      created_at: 1,
      author: { pubkey: "test-pubkey" },
    }),
  ),
}));

vi.mock("../actionChain", () => ({
  publishActionWithChain: vi.fn(() =>
    Promise.resolve({
      id: "evt-chain-1",
      created_at: 1,
      author: { pubkey: "test-pubkey" },
    }),
  ),
}));

vi.mock("../engine", () => ({
  useEngineStore: {
    getState: () => ({
      tick: 100,
      setHub: vi.fn(),
    }),
  },
}));

const createSliceState = (overrides: Partial<AirlineState>) => {
  const state = {
    airline: null,
    fleet: [],
    routes: [],
    timeline: [],
    actionChainHash: "",
    actionSeq: 0,
    latestCheckpoint: null,
    pubkey: "test-pubkey",
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

  const slice = (createNetworkSlice as StateCreator<AirlineState>)(set, get, {} as never);
  Object.assign(state, slice);
  Object.assign(state, overrides);
  return { state, set };
};

const makeAirline = (
  hubs: string[],
  balance: FixedPoint = 1000000000000 as FixedPoint,
): AirlineEntity => ({
  id: "airline-1",
  foundedBy: "test-pubkey",
  status: "private",
  ceoPubkey: "test-pubkey",
  sharesOutstanding: 10000000,
  shareholders: { "test-pubkey": 10000000 },
  name: "TestAir",
  icaoCode: "TST",
  callsign: "TEST",
  hubs,
  livery: { primary: "#000000", secondary: "#ffffff", accent: "#ffffff" },
  brandScore: 0.5,
  tier: 1,
  corporateBalance: balance,
  stockPrice: 0 as FixedPoint,
  fleetIds: [],
  routeIds: [],
});

const makeRoute = (
  id: string,
  origin: string,
  dest: string,
  status: "active" | "suspended" = "active",
): Route => ({
  id,
  originIata: origin,
  destinationIata: dest,
  airlinePubkey: "test-pubkey",
  distanceKm: 300,
  assignedAircraftIds: [],
  fareEconomy: 100000 as FixedPoint,
  fareBusiness: 150000 as FixedPoint,
  fareFirst: 200000 as FixedPoint,
  status,
});

const makeAircraft = (id: string, routeId: string | null): AircraftInstance => ({
  id,
  ownerPubkey: "test-pubkey",
  modelId: "atr72-600",
  name: "Plane",
  status: "idle",
  assignedRouteId: routeId,
  baseAirportIata: "AXM",
  purchasedAtTick: 0,
  purchasePrice: 1000000 as FixedPoint,
  birthTick: 0,
  flight: null,
  purchaseType: "buy",
  configuration: { economy: 70, business: 0, first: 0, cargoKg: 0 },
  flightHoursTotal: 0,
  flightHoursSinceCheck: 0,
  condition: 1,
});

describe("modifyHubs remove behavior", () => {
  it("suspends routes touching removed hub and unassigns aircraft", async () => {
    const airline = makeAirline(["AXM", "BOG"]);
    const routes = [
      makeRoute("rt-1", "AXM", "BOG", "active"),
      makeRoute("rt-2", "BOG", "MDE", "active"),
      makeRoute("rt-3", "BOG", "AXM", "active"),
    ];
    const fleet = [
      makeAircraft("ac-1", "rt-1"),
      makeAircraft("ac-2", "rt-2"),
      makeAircraft("ac-3", "rt-3"),
    ];

    const { state } = createSliceState({
      airline,
      routes,
      fleet,
      timeline: [] as TimelineEvent[],
    });

    await state.modifyHubs({ type: "remove", iata: "AXM" });

    const updatedRoutes = state.routes as Route[];
    const updatedFleet = state.fleet as AircraftInstance[];
    const updatedAirline = state.airline as AirlineEntity;

    const suspended = updatedRoutes.find((route) => route.id === "rt-1");
    const untouched = updatedRoutes.find((route) => route.id === "rt-2");
    const inbound = updatedRoutes.find((route) => route.id === "rt-3");

    expect(suspended?.status).toBe("suspended");
    expect(suspended?.assignedAircraftIds).toEqual([]);
    expect(untouched?.status).toBe("active");
    expect(inbound?.status).toBe("active");

    const aircraft1 = updatedFleet.find((ac) => ac.id === "ac-1");
    const aircraft2 = updatedFleet.find((ac) => ac.id === "ac-2");
    const aircraft3 = updatedFleet.find((ac) => ac.id === "ac-3");

    expect(aircraft1?.assignedRouteId).toBe(null);
    expect(aircraft2?.assignedRouteId).toBe("rt-2");
    expect(aircraft3?.assignedRouteId).toBe("rt-3");
    expect(updatedAirline.hubs).toEqual(["BOG"]);
  });
});

describe("modifyHubs switch behavior", () => {
  it("reorders hubs and applies relocation cost", async () => {
    const airline = makeAirline(["AXM", "BOG"], 1000000000000 as FixedPoint);

    const { state } = createSliceState({
      airline,
      routes: [],
      fleet: [],
      timeline: [] as TimelineEvent[],
    });

    await state.modifyHubs({ type: "switch", iata: "BOG" });

    const updatedAirline = state.airline as AirlineEntity;
    expect(updatedAirline.hubs[0]).toBe("BOG");
    expect(updatedAirline.hubs).toEqual(["BOG", "AXM"]);
    expect(updatedAirline.corporateBalance).toBeLessThan(airline.corporateBalance);
  });
});

describe("openRoute", () => {
  it("allows opening a route from any owned hub", async () => {
    const airline = makeAirline(["AXM", "BOG"]);
    const { state } = createSliceState({
      airline,
      routes: [],
      fleet: [],
      timeline: [] as TimelineEvent[],
    });

    await state.openRoute("BOG", "MDE", 300);

    const updatedRoutes = state.routes as Route[];
    expect(updatedRoutes).toHaveLength(1);
    expect(updatedRoutes[0].originIata).toBe("BOG");
  });

  it("blocks opening a duplicate origin-destination route", async () => {
    const airline = makeAirline(["BOG"]);
    const routes = [makeRoute("rt-1", "BOG", "MDE", "active")];
    const { state } = createSliceState({
      airline,
      routes,
      fleet: [],
      timeline: [] as TimelineEvent[],
    });

    await expect(state.openRoute("BOG", "MDE", 300)).rejects.toThrow(
      "Route BOG → MDE already exists.",
    );
  });

  it("blocks opening a route when a slot-controlled hub exceeds capacity", async () => {
    const airline = makeAirline(["LHR"]);
    const routes = [makeRoute("rt-1", "LHR", "JFK", "active")];
    routes[0].frequencyPerWeek = 200000;
    const { state } = createSliceState({
      airline,
      routes,
      fleet: [],
      timeline: [] as TimelineEvent[],
    });

    await expect(state.openRoute("LHR", "CDG", 5540)).rejects.toThrow(
      "Slot capacity exceeded at LHR",
    );
  });
});

describe("rebaseRoute", () => {
  it("moves a suspended route to a new hub and reactivates it", async () => {
    const airline = makeAirline(["BOG", "MDE"]);
    const routes = [makeRoute("rt-1", "AXM", "CLO", "suspended")];
    const fleet = [makeAircraft("ac-1", "rt-1")];

    const { state } = createSliceState({
      airline,
      routes,
      fleet,
      timeline: [] as TimelineEvent[],
    });

    await state.rebaseRoute("rt-1", "BOG");

    const updatedRoutes = state.routes as Route[];
    const updatedFleet = state.fleet as AircraftInstance[];

    const rebased = updatedRoutes.find((route) => route.id === "rt-1");
    expect(rebased?.originIata).toBe("BOG");
    expect(rebased?.destinationIata).toBe("CLO");
    expect(rebased?.status).toBe("active");

    const aircraft = updatedFleet.find((ac) => ac.id === "ac-1");
    expect(aircraft?.assignedRouteId).toBe(null);
  });
});

describe("closeRoute", () => {
  it("removes a route and clears aircraft assignment", async () => {
    const airline = makeAirline(["BOG"]);
    const routes = [makeRoute("rt-1", "BOG", "CLO", "suspended")];
    const fleet = [makeAircraft("ac-1", "rt-1")];

    const { state } = createSliceState({
      airline,
      routes,
      fleet,
      timeline: [] as TimelineEvent[],
    });

    await state.closeRoute("rt-1");

    const updatedRoutes = state.routes as Route[];
    const updatedFleet = state.fleet as AircraftInstance[];

    expect(updatedRoutes.find((route) => route.id === "rt-1")).toBeUndefined();
    const aircraft = updatedFleet.find((ac) => ac.id === "ac-1");
    expect(aircraft?.assignedRouteId).toBe(null);
  });

  it("keeps enroute aircraft flight state with fare snapshot", async () => {
    const airline = makeAirline(["BOG"]);
    const route = makeRoute("rt-1", "BOG", "CLO", "active");
    const enrouteAircraft = {
      ...makeAircraft("ac-1", "rt-1"),
      status: "enroute" as const,
      baseAirportIata: "BOG",
      flight: {
        originIata: "BOG",
        destinationIata: "CLO",
        departureTick: 90,
        arrivalTick: 110,
        direction: "outbound" as const,
      },
    };

    const { state } = createSliceState({
      airline,
      routes: [route],
      fleet: [enrouteAircraft],
      timeline: [] as TimelineEvent[],
    });

    await state.closeRoute("rt-1");

    const updatedFleet = state.fleet as AircraftInstance[];
    const aircraft = updatedFleet.find((ac) => ac.id === "ac-1");

    expect(aircraft?.assignedRouteId).toBe(null);
    expect(aircraft?.status).toBe("enroute");
    expect(aircraft?.flight?.fareEconomy).toBe(route.fareEconomy);
    expect(aircraft?.flight?.fareBusiness).toBe(route.fareBusiness);
    expect(aircraft?.flight?.fareFirst).toBe(route.fareFirst);
  });

  it("turnaround aircraft goes idle on closeRoute", async () => {
    const airline = makeAirline(["BOG"]);
    const route = makeRoute("rt-1", "BOG", "CLO", "active");
    const turnaroundAircraft = {
      ...makeAircraft("ac-1", "rt-1"),
      status: "turnaround" as const,
      flight: {
        originIata: "BOG",
        destinationIata: "CLO",
        departureTick: 90,
        arrivalTick: 100,
        direction: "outbound" as const,
      },
    };

    const { state } = createSliceState({
      airline,
      routes: [route],
      fleet: [turnaroundAircraft],
      timeline: [] as TimelineEvent[],
    });

    await state.closeRoute("rt-1");

    const updatedFleet = state.fleet as AircraftInstance[];
    const aircraft = updatedFleet.find((ac) => ac.id === "ac-1");

    expect(aircraft?.assignedRouteId).toBe(null);
    expect(aircraft?.status).toBe("idle");
    expect(aircraft?.flight).toBe(null);
  });
});

describe("assignAircraftToRoute", () => {
  it("blocks assignment changes while enroute", async () => {
    const airline = makeAirline(["BOG"]);
    const routes = [
      makeRoute("rt-1", "BOG", "CLO", "active"),
      makeRoute("rt-2", "BOG", "MDE", "active"),
    ];
    const enrouteAircraft = {
      ...makeAircraft("ac-1", "rt-1"),
      status: "enroute" as const,
      baseAirportIata: "BOG",
      flight: {
        originIata: "BOG",
        destinationIata: "CLO",
        departureTick: 90,
        arrivalTick: 110,
        direction: "outbound" as const,
      },
    };

    const { state } = createSliceState({
      airline,
      routes,
      fleet: [enrouteAircraft],
      timeline: [] as TimelineEvent[],
    });

    await expect(state.assignAircraftToRoute("ac-1", null)).rejects.toThrow(
      "Cannot change assignment while enroute.",
    );

    await expect(state.assignAircraftToRoute("ac-1", "rt-2")).rejects.toThrow(
      "Cannot change assignment while enroute.",
    );

    await state.assignAircraftToRoute("ac-1", "rt-1");
  });

  it("blocks assignment when aircraft is not at an active hub", async () => {
    const airline = makeAirline(["BOG"]);
    const routes = [makeRoute("rt-1", "BOG", "CLO", "active")];
    const groundedAircraft = {
      ...makeAircraft("ac-1", null),
      baseAirportIata: "MDE",
    };

    const { state } = createSliceState({
      airline,
      routes,
      fleet: [groundedAircraft],
      timeline: [] as TimelineEvent[],
    });

    await expect(state.assignAircraftToRoute("ac-1", "rt-1")).rejects.toThrow(
      "Aircraft must be at an active hub to be assigned to a route.",
    );
  });

  it("assigns aircraft when idle at an active hub", async () => {
    const airline = makeAirline(["BOG"]);
    const routes = [makeRoute("rt-1", "BOG", "CLO", "active")];
    const groundedAircraft = {
      ...makeAircraft("ac-1", null),
      baseAirportIata: "BOG",
    };

    const { state } = createSliceState({
      airline,
      routes,
      fleet: [groundedAircraft],
      timeline: [] as TimelineEvent[],
    });

    await state.assignAircraftToRoute("ac-1", "rt-1");

    const updatedFleet = state.fleet as AircraftInstance[];
    const updatedRoutes = state.routes as Route[];
    const aircraft = updatedFleet.find((ac) => ac.id === "ac-1");
    const route = updatedRoutes.find((rt) => rt.id === "rt-1");

    expect(aircraft?.assignedRouteId).toBe("rt-1");
    expect(aircraft?.routeAssignedAtTick).toBe(100);
    expect(aircraft?.routeAssignedAtIata).toBe("BOG");
    expect(route?.assignedAircraftIds).toContain("ac-1");
  });

  it("rolls back assignment without clobbering concurrent airline updates", async () => {
    const airline = { ...makeAirline(["BOG"]), lastTick: 10 };
    const routes = [makeRoute("rt-1", "BOG", "CLO", "active")];
    const groundedAircraft = {
      ...makeAircraft("ac-1", null),
      baseAirportIata: "BOG",
    };

    const { state } = createSliceState({
      airline,
      routes,
      fleet: [groundedAircraft],
      timeline: [] as TimelineEvent[],
    });

    const { publishActionWithChain } = await import("../actionChain");
    vi.mocked(publishActionWithChain).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("publish failed")), 0);
        }),
    );

    const pendingAssignment = state.assignAircraftToRoute("ac-1", "rt-1");
    state.airline = { ...(state.airline as AirlineEntity), lastTick: 777 };
    await pendingAssignment;

    expect(state.airline?.lastTick).toBe(777);
    expect(state.fleet.find((ac) => ac.id === "ac-1")?.assignedRouteId).toBeNull();
    expect(state.routes.find((rt) => rt.id === "rt-1")?.assignedAircraftIds).toEqual([]);
  });

  it("assignment rollback preserves concurrent fleet condition changes", async () => {
    const airline = makeAirline(["BOG"]);
    const routes = [makeRoute("rt-1", "BOG", "CLO", "active")];
    const aircraft1 = { ...makeAircraft("ac-1", null), baseAirportIata: "BOG" };
    const aircraft2 = {
      ...makeAircraft("ac-2", null),
      baseAirportIata: "BOG",
      condition: 0.9,
    };

    const { state } = createSliceState({
      airline,
      routes,
      fleet: [aircraft1, aircraft2],
      timeline: [] as TimelineEvent[],
    });

    const { publishActionWithChain } = await import("../actionChain");
    vi.mocked(publishActionWithChain).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("publish failed")), 0);
        }),
    );

    const pending = state.assignAircraftToRoute("ac-1", "rt-1");

    // Simulate concurrent condition change on another aircraft from tick processing
    state.fleet = (state.fleet as AircraftInstance[]).map((ac) =>
      ac.id === "ac-2" ? { ...ac, condition: 0.7 } : ac,
    );

    await pending;

    // Assignment should be rolled back
    expect(state.fleet.find((ac) => ac.id === "ac-1")?.assignedRouteId).toBeNull();
    // Concurrent condition change on ac-2 should be preserved
    expect(state.fleet.find((ac) => ac.id === "ac-2")?.condition).toBe(0.7);
  });

  it("assignment rollback preserves concurrently-added timeline events", async () => {
    const airline = makeAirline(["BOG"]);
    const routes = [makeRoute("rt-1", "BOG", "CLO", "active")];
    const aircraft = { ...makeAircraft("ac-1", null), baseAirportIata: "BOG" };

    const { state } = createSliceState({
      airline,
      routes,
      fleet: [aircraft],
      timeline: [] as TimelineEvent[],
    });

    const { publishActionWithChain } = await import("../actionChain");
    vi.mocked(publishActionWithChain).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("publish failed")), 0);
        }),
    );

    const pending = state.assignAircraftToRoute("ac-1", "rt-1");

    // Simulate a concurrent timeline event added by processTick (e.g., a landing event)
    const concurrentEvent: TimelineEvent = {
      id: "evt-concurrent-landing",
      tick: 101,
      timestamp: 0,
      type: "landing",
      description: "Concurrent landing event from tick processing",
    };
    state.timeline = [concurrentEvent, ...(state.timeline as TimelineEvent[])];

    await pending;

    // Assignment should be rolled back
    expect(state.fleet.find((ac) => ac.id === "ac-1")?.assignedRouteId).toBeNull();
    // The optimistic assignment event should be removed
    expect(state.timeline.some((evt) => evt.id.startsWith("evt-assign-"))).toBe(false);
    // The concurrently-added timeline event should be preserved
    expect(state.timeline.some((evt) => evt.id === "evt-concurrent-landing")).toBe(true);
  });
});

describe("openRoute rollback", () => {
  it("refunds slot fee using arithmetic and preserves concurrent balance changes", async () => {
    const initialBalance = 1000000000000 as FixedPoint;
    const airline = makeAirline(["BOG"], initialBalance);
    const { state } = createSliceState({
      airline,
      routes: [],
      fleet: [],
      timeline: [] as TimelineEvent[],
    });

    const { publishActionWithChain } = await import("../actionChain");
    vi.mocked(publishActionWithChain).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("publish failed")), 0);
        }),
    );

    const pending = state.openRoute("BOG", "MDE", 300);

    // Simulate concurrent revenue from tick processing
    const concurrentRevenue = 5000000 as FixedPoint;
    state.airline = {
      ...(state.airline as AirlineEntity),
      corporateBalance: fpAdd((state.airline as AirlineEntity).corporateBalance, concurrentRevenue),
    };

    await pending;

    // Route should be rolled back
    expect(state.routes).toHaveLength(0);
    // Balance should include the concurrent revenue (slot fee refunded via arithmetic)
    expect(state.airline?.corporateBalance).toBe(fpAdd(initialBalance, concurrentRevenue));
  });

  it("rollback removes only the optimistic timeline event", async () => {
    const airline = makeAirline(["BOG"]);
    const existingEvent = {
      id: "evt-existing",
      tick: 50,
      timestamp: 0,
      type: "purchase" as const,
      description: "Existing event",
    };
    const { state } = createSliceState({
      airline,
      routes: [],
      fleet: [],
      timeline: [existingEvent] as TimelineEvent[],
    });

    const { publishActionWithChain } = await import("../actionChain");
    vi.mocked(publishActionWithChain).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("publish failed")), 0);
        }),
    );

    await state.openRoute("BOG", "MDE", 300);

    // Existing timeline event should still be there
    expect(state.timeline.some((evt) => evt.id === "evt-existing")).toBe(true);
    // Route open event should be removed
    expect(state.routes).toHaveLength(0);
  });
});
