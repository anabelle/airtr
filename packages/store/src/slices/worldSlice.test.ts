import type { AircraftInstance, AirlineEntity, FixedPoint, Route } from "@airtr/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";
import type { AirlineState } from "../types";
import { _resetWorldFlags, createWorldSlice } from "./worldSlice";

const mockProcessFlightEngine = vi.fn();

vi.mock("../FlightEngine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../FlightEngine")>();
  return {
    ...actual,
    processFlightEngine: (...args: unknown[]) => mockProcessFlightEngine(...args),
  };
});

vi.mock("@airtr/nostr", () => ({
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

describe("processGlobalTick", () => {
  beforeEach(async () => {
    mockProcessFlightEngine.mockReset();
    mockProcessFlightEngine.mockImplementation(
      (_tick: number, fleet: AircraftInstance[], _routes: unknown, balance: FixedPoint) => ({
        updatedFleet: fleet,
        corporateBalance: balance,
        hasChanges: false,
        events: [],
      }),
    );
    _resetWorldFlags();

    // Reset nostr mocks to avoid cross-test contamination
    const nostr = await import("@airtr/nostr");
    (nostr.loadActionLog as unknown as ReturnType<typeof vi.fn>).mockClear();
    (nostr.loadActionLog as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (nostr.loadCheckpoints as unknown as ReturnType<typeof vi.fn>).mockClear();
    (nostr.loadCheckpoints as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
  });

  it("keeps up-to-date competitor fleet while others catch up", async () => {
    const tick = 200;
    const behindPubkey = "comp-behind";
    const currentPubkey = "comp-current";

    const competitors = new Map<string, AirlineEntity>([
      [behindPubkey, makeAirline(behindPubkey, tick - 2)],
      [currentPubkey, makeAirline(currentPubkey, tick)],
    ]);

    const globalFleet = [
      makeAircraft("ac-behind", behindPubkey),
      makeAircraft("ac-current", currentPubkey),
    ];

    const { state } = createSliceState({
      competitors,
      globalFleet,
      globalFleetByOwner: buildFleetIndex(globalFleet),
      globalRoutes: [],
      globalRoutesByOwner: buildRoutesIndex([]),
    });

    await state.processGlobalTick(tick);

    const ids = state.globalFleet.map((ac) => ac.id);
    expect(ids).toContain("ac-behind");
    expect(ids).toContain("ac-current");
    expect(mockProcessFlightEngine).toHaveBeenCalled();
  });

  it("retains fleets for competitors beyond catchup budget", async () => {
    // MAX_TOTAL_COMPETITOR_TICKS = 5000, MAX_COMPETITOR_CATCHUP = 1000
    // 6 competitors at lastTick=0 with tick=2000: first 5 each use 1000 ticks (= 5000 total),
    // the 6th competitor (comp-f) gets skipped by the budget cap. Its fleet must still appear.
    const tick = 2000;
    const compKeys = ["comp-a", "comp-b", "comp-c", "comp-d", "comp-e", "comp-f"];
    const upToDate = "comp-current";

    const competitors = new Map<string, AirlineEntity>(
      compKeys.map((key) => [key, makeAirline(key, 0)] as const),
    );
    competitors.set(upToDate, makeAirline(upToDate, tick));

    const globalFleet = [
      ...compKeys.map((key) => makeAircraft(`ac-${key}`, key)),
      makeAircraft("ac-current", upToDate),
    ];

    // Mock always returns valid results — just echoes fleet through
    mockProcessFlightEngine.mockImplementation(
      (_tick: number, fleet: AircraftInstance[], _routes: unknown, balance: FixedPoint) => ({
        updatedFleet: fleet,
        corporateBalance: balance,
        hasChanges: false,
        events: [],
      }),
    );

    const { state } = createSliceState({
      competitors,
      globalFleet,
      globalFleetByOwner: buildFleetIndex(globalFleet),
      globalRoutes: [],
      globalRoutesByOwner: buildRoutesIndex([]),
    });

    await state.processGlobalTick(tick);

    const ids = state.globalFleet.map((ac) => ac.id);
    // The first 5 competitors were processed (budget allows 5 * 1000 = 5000)
    for (const key of compKeys.slice(0, 5)) {
      expect(ids).toContain(`ac-${key}`);
    }
    // The 6th competitor was NOT processed but its fleet must still be retained
    expect(ids).toContain("ac-comp-f");
    // The up-to-date competitor's fleet should be retained too
    expect(ids).toContain("ac-current");
  });

  it("preserves newer competitor state over older sync snapshot", async () => {
    const { loadActionLog } = await import("@airtr/nostr");
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
          payload: { name: "Old Air", hubs: ["JFK"], corporateBalance: 100000000, tick: 80 },
        },
      },
    ]);

    const { state } = createSliceState({
      competitors: new Map([[pubkey, newerAirline]]),
      globalFleet: newerFleet,
      globalFleetByOwner: buildFleetIndex(newerFleet),
      globalRoutes: [],
      globalRoutesByOwner: buildRoutesIndex([]),
    });

    await state.syncWorld();

    const ids = state.globalFleet.map((ac) => ac.id);
    expect(ids).toContain("ac-new");
  });

  it("fast-forwards competitor fleet during initial sync", async () => {
    const { loadActionLog } = await import("@airtr/nostr");
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
          payload: { name: "Catchup Air", hubs: ["JFK"], corporateBalance: 100000000, tick: 10 },
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

    mockProcessFlightEngine.mockImplementation(
      (_tick: number, _fleet: AircraftInstance[], _routes: unknown, balance: FixedPoint) => ({
        updatedFleet: [makeAircraft("ac-fast", pubkey)],
        corporateBalance: balance,
        hasChanges: false,
        events: [],
      }),
    );

    const { state } = createSliceState({
      competitors: new Map(),
      globalFleet: [],
      globalFleetByOwner: buildFleetIndex([]),
      globalRoutes: [],
      globalRoutesByOwner: buildRoutesIndex([]),
    });

    await state.syncWorld();

    const ids = state.globalFleet.map((ac) => ac.id);
    expect(ids).toContain("ac-fast");
  });

  it("queues concurrent syncWorld calls instead of dropping them", async () => {
    const { loadActionLog } = await import("@airtr/nostr");
    (loadActionLog as unknown as ReturnType<typeof vi.fn>).mockClear();

    const { state } = createSliceState({});

    const first = state.syncWorld();
    const second = state.syncWorld();

    await Promise.all([first, second]);

    // Wait for the queued follow-up sync to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // First call runs immediately, second is queued and runs after first completes
    expect(loadActionLog).toHaveBeenCalledTimes(2);
  });

  it("skips syncWorld while global tick processing", async () => {
    const { loadActionLog } = await import("@airtr/nostr");
    (loadActionLog as unknown as ReturnType<typeof vi.fn>).mockClear();

    // Set up a competitor that needs 1000 ticks of catchup.
    // GLOBAL_CATCHUP_CHUNK = 200, so the loop yields every 200 ticks via setTimeout(0).
    // That means 4 yield points (at ticks 200, 400, 600, 800).
    // We call syncWorld right after the first yield while isProcessingGlobal is still true.
    const tick = 1100;
    const pubkey = "comp-blocking";
    const competitors = new Map<string, AirlineEntity>([
      [pubkey, makeAirline(pubkey, tick - 1000)],
    ]);
    const globalFleet = [makeAircraft("ac-blocking", pubkey)];

    const { state } = createSliceState({
      competitors,
      globalFleet,
      globalFleetByOwner: buildFleetIndex(globalFleet),
      globalRoutes: [],
      globalRoutesByOwner: buildRoutesIndex([]),
    });

    // processGlobalTick will set isProcessingGlobal=true and yield at the
    // 200-tick boundary.  We inject syncWorld into the macrotask queue
    // right after the first yield so it runs while processing is still active.
    let syncResult: Promise<void> | null = null;
    const origSetTimeout = globalThis.setTimeout;
    let yieldCount = 0;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: TimerHandler, ms?: number) => {
      yieldCount++;
      if (yieldCount === 1) {
        // After the first yield from processGlobalTick, insert syncWorld
        return origSetTimeout(() => {
          syncResult = state.syncWorld();
          (fn as () => void)();
        }, ms) as unknown as ReturnType<typeof setTimeout>;
      }
      return origSetTimeout(fn as TimerHandler, ms) as unknown as ReturnType<typeof setTimeout>;
    });

    await state.processGlobalTick(tick);
    if (syncResult) await syncResult;

    vi.restoreAllMocks();

    // syncWorld should have been skipped because isProcessingGlobal was true
    expect(loadActionLog).toHaveBeenCalledTimes(0);
  });
});
