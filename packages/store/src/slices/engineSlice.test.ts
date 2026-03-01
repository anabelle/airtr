import type { AircraftInstance, AirlineEntity, FixedPoint, Route } from "@acars/core";
import { describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";
import type { AirlineState } from "../types";
import { createEngineSlice } from "./engineSlice";

vi.mock("../FlightEngine", () => ({
  processFlightEngine: vi.fn(),
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
