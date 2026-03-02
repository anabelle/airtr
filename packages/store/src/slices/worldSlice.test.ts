import type { AircraftInstance, AirlineEntity, FixedPoint, Route } from "@acars/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";
import type { AirlineState } from "../types";
import { _resetWorldFlags, createWorldSlice } from "./worldSlice";

vi.mock("@acars/nostr", () => ({
  loadActionLog: vi.fn(() => Promise.resolve([])),
  loadCheckpoints: vi.fn(() => Promise.resolve(new Map())),
  getNDK: vi.fn(() => ({})),
  NDKEvent: vi.fn(),
  MARKETPLACE_KIND: 30079,
}));

vi.mock("../engine", () => ({
  useEngineStore: {
    setState: vi.fn(),
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
    pubkey: "player-pubkey",
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

  const slice = (createWorldSlice as StateCreator<AirlineState>)(set, get, {} as never);
  Object.assign(state, slice);
  Object.assign(state, overrides);
  return { state, set };
};

const buildFleetIndex = (fleet: AircraftInstance[]) => {
  const byOwner = new Map<string, AircraftInstance[]>();
  for (const aircraft of fleet) {
    const bucket = byOwner.get(aircraft.ownerPubkey);
    if (bucket) {
      bucket.push(aircraft);
    } else {
      byOwner.set(aircraft.ownerPubkey, [aircraft]);
    }
  }
  return byOwner;
};

const makeAirline = (pubkey: string, lastTick: number): AirlineEntity => ({
  id: `airline-${pubkey}`,
  foundedBy: pubkey,
  status: "private",
  ceoPubkey: pubkey,
  sharesOutstanding: 10000000,
  shareholders: { [pubkey]: 10000000 },
  name: `Airline ${pubkey}`,
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

const makeAircraft = (id: string, ownerPubkey: string): AircraftInstance => ({
  id,
  ownerPubkey,
  modelId: "atr72-600",
  name: "Plane",
  status: "idle",
  assignedRouteId: null,
  baseAirportIata: "JFK",
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

const buildRoutesIndex = (routes: Route[]) => {
  const byOwner = new Map<string, Route[]>();
  for (const route of routes) {
    const bucket = byOwner.get(route.airlinePubkey);
    if (bucket) {
      bucket.push(route);
    } else {
      byOwner.set(route.airlinePubkey, [route]);
    }
  }
  return byOwner;
};

describe("projectCompetitorFleet", () => {
  beforeEach(async () => {
    _resetWorldFlags();

    // Reset nostr mocks to avoid cross-test contamination
    const nostr = await import("@acars/nostr");
    (nostr.loadActionLog as unknown as ReturnType<typeof vi.fn>).mockClear();
    (nostr.loadActionLog as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (nostr.loadCheckpoints as unknown as ReturnType<typeof vi.fn>).mockClear();
    (nostr.loadCheckpoints as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
  });

  it("projects all competitor fleets to the target tick", () => {
    const tick = 200;
    const behindPubkey = "comp-behind";
    const currentPubkey = "comp-current";

    const competitors = new Map<string, AirlineEntity>([
      [behindPubkey, makeAirline(behindPubkey, tick - 2)],
      [currentPubkey, makeAirline(currentPubkey, tick)],
    ]);

    const allFleet = [
      makeAircraft("ac-behind", behindPubkey),
      makeAircraft("ac-current", currentPubkey),
    ];

    const { state } = createSliceState({
      competitors,
      fleetByOwner: buildFleetIndex(allFleet),
      routesByOwner: buildRoutesIndex([]),
    });

    state.projectCompetitorFleet(tick);

    // Both aircraft should appear in the projected fleet
    const ids = [...state.fleetByOwner.values()].flat().map((ac) => ac.id);
    expect(ids).toContain("ac-behind");
    expect(ids).toContain("ac-current");

    // Competitors map should NOT be modified — projectCompetitorFleet is
    // display-only.  Authoritative state (lastTick, corporateBalance) is
    // written exclusively by syncWorld / syncCompetitor.
    const updatedBehind = state.competitors.get(behindPubkey);
    expect(updatedBehind?.lastTick).toBe(tick - 2);

    const updatedCurrent = state.competitors.get(currentPubkey);
    expect(updatedCurrent?.lastTick).toBe(tick);
  });

  it("does nothing when no competitors exist", () => {
    const { state, set } = createSliceState({
      competitors: new Map(),
      fleetByOwner: new Map(),
    });

    state.projectCompetitorFleet(100);

    // set should not have been called (no changes)
    expect(set).not.toHaveBeenCalled();
  });

  it("skips competitors whose lastTick is already at or ahead of target", () => {
    const tick = 100;
    const pubkey = "comp-ahead";

    const competitors = new Map<string, AirlineEntity>([[pubkey, makeAirline(pubkey, tick + 10)]]);

    const fleet = [makeAircraft("ac-ahead", pubkey)];

    const { state, set } = createSliceState({
      competitors,
      fleetByOwner: buildFleetIndex(fleet),
      routesByOwner: buildRoutesIndex([]),
    });

    state.projectCompetitorFleet(tick);

    // No changes should have been made since the only competitor is ahead
    expect(set).not.toHaveBeenCalled();
  });
});

describe("syncWorld", () => {
  beforeEach(async () => {
    _resetWorldFlags();

    const nostr = await import("@acars/nostr");
    (nostr.loadActionLog as unknown as ReturnType<typeof vi.fn>).mockClear();
    (nostr.loadActionLog as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (nostr.loadCheckpoints as unknown as ReturnType<typeof vi.fn>).mockClear();
    (nostr.loadCheckpoints as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
  });

  it("preserves existing fleet when replay returns fewer aircraft (partial relay)", async () => {
    const { loadActionLog } = await import("@acars/nostr");
    const pubkey = "comp-stable";

    const newerAirline = makeAirline(pubkey, 120);
    const newerFleet = [makeAircraft("ac-new", pubkey)];

    (loadActionLog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        event: {
          id: "evt-1",
          author: { pubkey },
          created_at: 1,
        },
        action: {
          schemaVersion: 2,
          action: "AIRLINE_CREATE",
          payload: {
            name: "Old Air",
            hubs: ["JFK"],
            corporateBalance: 1000000000000,
            tick: 80,
          },
        },
      },
    ]);

    const { state } = createSliceState({
      competitors: new Map([[pubkey, newerAirline]]),
      fleetByOwner: buildFleetIndex(newerFleet),
      routesByOwner: buildRoutesIndex([]),
    });

    await state.syncWorld();

    const ids = [...state.fleetByOwner.values()].flat().map((ac) => ac.id);
    expect(ids).toContain("ac-new");
  });

  it("adopts replayed fleet when replay has more aircraft than local state", async () => {
    const { loadActionLog } = await import("@acars/nostr");
    const pubkey = "comp-growing";

    // Existing state: competitor has 1 aircraft, projected to lastTick 500
    const existingAirline = makeAirline(pubkey, 500);
    const existingFleet = [makeAircraft("ac-old", pubkey)];

    // Relay returns actions that replay into 2 aircraft (AIRLINE_CREATE + 2 purchases)
    (loadActionLog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        event: { id: "evt-1", author: { pubkey }, created_at: 1 },
        action: {
          schemaVersion: 2,
          action: "AIRLINE_CREATE",
          payload: {
            name: "Growing Air",
            hubs: ["JFK"],
            corporateBalance: 1000000000000,
            tick: 10,
          },
        },
      },
      {
        event: { id: "evt-2", author: { pubkey }, created_at: 2 },
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_PURCHASE",
          payload: {
            instanceId: "ac-old",
            modelId: "atr72-600",
            price: 1000000,
            deliveryHubIata: "JFK",
            tick: 20,
          },
        },
      },
      {
        event: { id: "evt-3", author: { pubkey }, created_at: 3 },
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_PURCHASE",
          payload: {
            instanceId: "ac-new-purchase",
            modelId: "atr72-600",
            price: 1000000,
            deliveryHubIata: "JFK",
            tick: 30,
          },
        },
      },
    ]);

    const { state } = createSliceState({
      competitors: new Map([[pubkey, existingAirline]]),
      fleetByOwner: buildFleetIndex(existingFleet),
      routesByOwner: buildRoutesIndex([]),
    });

    await state.syncWorld();

    // The replayed fleet (2 aircraft) should be adopted over the existing (1 aircraft)
    const ids = [...state.fleetByOwner.values()].flat().map((ac) => ac.id);
    expect(ids).toContain("ac-old");
    expect(ids).toContain("ac-new-purchase");
    expect(ids).toHaveLength(2);
  });

  it("projects competitor fleet to current tick during sync", async () => {
    const { loadActionLog } = await import("@acars/nostr");
    const pubkey = "comp-catchup";

    (loadActionLog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        event: {
          id: "evt-1",
          author: { pubkey },
          created_at: 1,
        },
        action: {
          schemaVersion: 2,
          action: "AIRLINE_CREATE",
          payload: {
            name: "Catchup Air",
            hubs: ["JFK"],
            corporateBalance: 1000000000000,
            tick: 10,
          },
        },
      },
      {
        event: {
          id: "evt-2",
          author: { pubkey },
          created_at: 2,
        },
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_PURCHASE",
          payload: {
            instanceId: "ac-fast",
            modelId: "atr72-600",
            price: 1000000,
            deliveryHubIata: "JFK",
            tick: 20,
          },
        },
      },
    ]);

    const { state } = createSliceState({
      competitors: new Map(),
      fleetByOwner: buildFleetIndex([]),
      routesByOwner: buildRoutesIndex([]),
    });

    await state.syncWorld();

    const ids = [...state.fleetByOwner.values()].flat().map((ac) => ac.id);
    expect(ids).toContain("ac-fast");
  });

  it("queues concurrent syncWorld calls instead of dropping them", async () => {
    const { loadActionLog } = await import("@acars/nostr");
    (loadActionLog as unknown as ReturnType<typeof vi.fn>).mockClear();

    const { state } = createSliceState({});

    const first = state.syncWorld();
    const second = state.syncWorld();

    await Promise.all([first, second]);

    // Wait for the queued follow-up sync to complete
    await vi.waitFor(() => {
      expect(loadActionLog).toHaveBeenCalledTimes(2);
    });

    // First call runs immediately, second is queued and runs after first completes
    expect(loadActionLog).toHaveBeenCalledTimes(2);
  });
});
