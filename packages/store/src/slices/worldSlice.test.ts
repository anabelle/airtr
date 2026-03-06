import type { AircraftInstance, AirlineEntity } from "@acars/core";
import { fp } from "@acars/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";
import type { AirlineState } from "../types";
import { _resetWorldFlags, createWorldSlice } from "./worldSlice";

vi.mock("@acars/core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@acars/core")>();
  return {
    ...mod,
    decompressSnapshotString: vi.fn((data: string) => Promise.resolve(data)),
  };
});

vi.mock("@acars/nostr", () => ({
  loadAllSnapshots: vi.fn(() => Promise.resolve(new Map())),
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

vi.mock("../FlightEngine", () => ({
  reconcileFleetToTick: vi.fn((fleet) => ({
    fleet,
    balanceDelta: 0,
    events: [],
  })),
}));

const createSliceState = (overrides: Partial<AirlineState> = {}) => {
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
  } as unknown as AirlineState;

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
  cumulativeRevenue: fp(0),
  corporateBalance: fp(1000000000),
  stockPrice: fp(0),
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
  purchasePrice: fp(1000000),
  birthTick: 0,
  flight: null,
  purchaseType: "buy",
  configuration: { economy: 70, business: 0, first: 0, cargoKg: 0 },
  flightHoursTotal: 0,
  flightHoursSinceCheck: 0,
  condition: 1,
});

describe("projectCompetitorFleet", () => {
  beforeEach(async () => {
    _resetWorldFlags();
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
      routesByOwner: new Map(),
    });

    state.projectCompetitorFleet(tick);

    const ids = [...state.fleetByOwner.values()].flat().map((ac) => ac.id);
    expect(ids).toContain("ac-behind");
    expect(ids).toContain("ac-current");

    const updatedBehind = state.competitors.get(behindPubkey);
    expect(updatedBehind?.lastTick).toBe(tick - 2);
  });

  it("does not project bankrupt competitors", () => {
    const tick = 200;
    const pubkey = "comp-bankrupt";
    const airline = {
      ...makeAirline(pubkey, tick - 50),
      status: "chapter11" as const,
    };
    const aircraft: AircraftInstance = {
      ...makeAircraft("ac-bankrupt", pubkey),
      status: "enroute",
      assignedRouteId: "rt-1",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 100,
        arrivalTick: 150,
        distanceKm: 2000,
        direction: "outbound" as const,
        purpose: "route" as const,
      },
    };

    const { state, set } = createSliceState({
      competitors: new Map([[pubkey, airline]]),
      fleetByOwner: buildFleetIndex([aircraft]),
      routesByOwner: new Map(),
    });

    state.projectCompetitorFleet(tick);

    expect(set).not.toHaveBeenCalled();
    expect(state.fleetByOwner.get(pubkey)?.[0].id).toBe("ac-bankrupt");
  });
});

describe("syncWorld", () => {
  beforeEach(async () => {
    _resetWorldFlags();
    const nostr = await import("@acars/nostr");
    vi.mocked(nostr.loadAllSnapshots).mockClear();
    vi.mocked(nostr.loadAllSnapshots).mockResolvedValue(new Map());
  });

  it("loads and installs snapshots for competitors", async () => {
    const pubkey = "comp-new";
    const newAirline = makeAirline(pubkey, 120);
    const mockSnapshot = {
      schemaVersion: 1,
      tick: 120,
      airline: newAirline,
      fleet: [makeAircraft("ac-new", pubkey)],
      routes: [],
      timeline: [],
    };

    const { loadAllSnapshots } = await import("@acars/nostr");
    vi.mocked(loadAllSnapshots).mockResolvedValueOnce(
      new Map([[pubkey, { compressedData: JSON.stringify(mockSnapshot) } as any]]),
    );

    const { state } = createSliceState();

    await state.syncWorld();

    expect(state.competitors.has("comp-new")).toBe(true);
    expect([...state.fleetByOwner.values()].flat().map((a) => a.id)).toContain("ac-new");
  });

  it("ignores bankrupt states", async () => {
    const pubkey = "comp-bankrupt";
    const bankruptAirline = {
      ...makeAirline(pubkey, 100),
      status: "chapter11",
    };
    const mockSnapshot = {
      schemaVersion: 1,
      tick: 120,
      airline: bankruptAirline,
      fleet: [makeAircraft("ac-new", pubkey)],
      routes: [],
      timeline: [],
    };

    const { loadAllSnapshots } = await import("@acars/nostr");
    vi.mocked(loadAllSnapshots).mockResolvedValueOnce(
      new Map([[pubkey, { compressedData: JSON.stringify(mockSnapshot) } as any]]),
    );

    const { state } = createSliceState();

    await state.syncWorld();

    expect(state.competitors.has("comp-bankrupt")).toBe(true);
    expect(state.competitors.get("comp-bankrupt")?.status).toBe("chapter11");
  });
});
