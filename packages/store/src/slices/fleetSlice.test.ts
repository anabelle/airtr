import type { AircraftInstance, AirlineEntity, FixedPoint } from "@airtr/core";
import { describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";
import type { AirlineState } from "../types";
import { createFleetSlice } from "./fleetSlice";

vi.mock("@airtr/nostr", () => ({
  publishAction: vi.fn(() =>
    Promise.resolve({ id: "evt-1", created_at: 1, author: { pubkey: "test-pubkey" } }),
  ),
  publishUsedAircraft: vi.fn(() => Promise.resolve()),
  attachSigner: vi.fn(),
  ensureConnected: vi.fn(),
  getNDK: vi.fn(() => ({
    connect: vi.fn(),
  })),
  NDKEvent: vi.fn(() => ({
    publish: vi.fn(),
  })),
  MARKETPLACE_KIND: 30079,
}));

vi.mock("../engine", () => ({
  useEngineStore: {
    getState: () => ({
      tick: 100,
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
    globalFleet: [],
    globalFleetByOwner: new Map(),
    globalRoutes: [],
    globalRoutesByOwner: new Map(),
    syncWorld: vi.fn(),
    syncCompetitor: vi.fn(),
    processGlobalTick: vi.fn(),
  } as AirlineState;

  const set = vi.fn((partial: AirlineState | ((prev: AirlineState) => Partial<AirlineState>)) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    Object.assign(state, next);
  });
  const get = () => state;

  const slice = (createFleetSlice as StateCreator<AirlineState>)(set, get, {} as never);
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

const makeAircraft = (id: string, base: string): AircraftInstance => ({
  id,
  ownerPubkey: "test-pubkey",
  modelId: "atr72-600",
  name: "Plane",
  status: "idle",
  assignedRouteId: null,
  baseAirportIata: base,
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

describe("ferryAircraft", () => {
  it("sets aircraft enroute with ferry flight state", async () => {
    const airline = makeAirline(["BOG"]);
    const fleet = [makeAircraft("ac-1", "BOG")];

    const { state } = createSliceState({ airline, fleet, timeline: [] });

    await state.ferryAircraft("ac-1", "MDE");

    const updated = state.fleet.find((ac) => ac.id === "ac-1");
    expect(updated?.status).toBe("enroute");
    expect(updated?.flight?.purpose).toBe("ferry");
    expect(updated?.flight?.originIata).toBe("BOG");
    expect(updated?.flight?.destinationIata).toBe("MDE");
  });

  it("rejects ferry when already at destination", async () => {
    const airline = makeAirline(["BOG"]);
    const fleet = [makeAircraft("ac-1", "BOG")];

    const { state } = createSliceState({ airline, fleet, timeline: [] });

    await expect(state.ferryAircraft("ac-1", "BOG")).rejects.toThrow("already at that airport");
  });
});

describe("sellAircraft", () => {
  it("blocks scrapping when aircraft is not idle", async () => {
    const airline = makeAirline(["BOG"]);
    const fleet = [{ ...makeAircraft("ac-1", "BOG"), status: "enroute" as const }];

    const { state } = createSliceState({ airline, fleet, timeline: [] });

    await expect(state.sellAircraft("ac-1")).rejects.toThrow(
      "Aircraft can only be scrapped while idle.",
    );
  });
});
