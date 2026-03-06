import type { AircraftInstance, AirlineEntity, Route } from "@acars/core";
import { fp } from "@acars/core";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useNavBadges } from "./useNavBadges";

// Minimal factory helpers
const makeAircraft = (overrides: Partial<AircraftInstance> = {}): AircraftInstance =>
  ({
    id: "ac-1",
    ownerPubkey: "pk1",
    modelId: "b737",
    name: "Test",
    status: "idle",
    assignedRouteId: null,
    baseAirportIata: "JFK",
    purchasedAtTick: 0,
    purchasePrice: fp(1000000),
    birthTick: 0,
    listingPrice: null,
    flight: null,
    purchaseType: "buy",
    flightHoursTotal: 0,
    condition: 1,
    seatsEconomy: 150,
    seatsBusiness: 20,
    seatsFirst: 0,
    cargoKg: 0,
    ...overrides,
  }) as AircraftInstance;

const makeRoute = (overrides: Partial<Route> = {}): Route =>
  ({
    id: "rt-1",
    originIata: "JFK",
    destinationIata: "LHR",
    airlinePubkey: "pk1",
    distanceKm: 5500,
    frequencyPerWeek: 7,
    assignedAircraftIds: [],
    fareEconomy: fp(300),
    fareBusiness: fp(900),
    fareFirst: fp(1800),
    status: "active",
    ...overrides,
  }) as Route;

const makeAirline = (overrides: Partial<AirlineEntity> = {}): AirlineEntity =>
  ({
    id: "al-1",
    ceoPubkey: "pk1",
    name: "Test Air",
    icaoCode: "TST",
    callsign: "TESTA",
    hubIata: "JFK",
    hubs: ["JFK"],
    fleetIds: [],
    routeIds: [],
    corporateBalance: fp(1000000),
    brandScore: 5,
    tier: 1,
    cumulativeRevenue: fp(0),
    stockPrice: fp(10),
    livery: { primary: "#000", secondary: "#fff", accent: "#0f0" },
    status: "public",
    ...overrides,
  }) as unknown as AirlineEntity;

// State we'll mutate per test
let mockState = {
  airline: null as AirlineEntity | null,
  fleet: [] as AircraftInstance[],
  routes: [] as Route[],
  competitors: new Map<string, AirlineEntity>(),
};

vi.mock("@acars/store", () => ({
  useAirlineStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

describe("useNavBadges", () => {
  it("returns all zeros when no airline is loaded", () => {
    mockState = {
      airline: null,
      fleet: [],
      routes: [],
      competitors: new Map(),
    };
    const { result } = renderHook(() => useNavBadges());
    expect(result.current).toEqual({
      fleetTotal: 0,
      fleetUnassigned: 0,
      networkTotal: 0,
      networkUnassigned: 0,
      leaderboardRank: 0,
    });
  });

  it("counts total fleet and idle-unassigned aircraft", () => {
    const airline = makeAirline();
    mockState = {
      airline,
      fleet: [
        makeAircraft({ id: "ac-1", status: "idle", assignedRouteId: null }),
        makeAircraft({ id: "ac-2", status: "idle", assignedRouteId: "rt-1" }),
        makeAircraft({
          id: "ac-3",
          status: "enroute",
          assignedRouteId: "rt-1",
        }),
      ],
      routes: [],
      competitors: new Map(),
    };
    const { result } = renderHook(() => useNavBadges());
    expect(result.current.fleetTotal).toBe(3);
    expect(result.current.fleetUnassigned).toBe(1); // only ac-1 is idle+unassigned
  });

  it("counts total routes and active-unassigned routes", () => {
    const airline = makeAirline();
    mockState = {
      airline,
      fleet: [],
      routes: [
        makeRoute({ id: "rt-1", status: "active", assignedAircraftIds: [] }),
        makeRoute({
          id: "rt-2",
          status: "active",
          assignedAircraftIds: ["ac-1"],
        }),
        makeRoute({ id: "rt-3", status: "suspended", assignedAircraftIds: [] }),
      ],
      competitors: new Map(),
    };
    const { result } = renderHook(() => useNavBadges());
    expect(result.current.networkTotal).toBe(3);
    expect(result.current.networkUnassigned).toBe(1); // only rt-1 active+empty
  });

  it("computes leaderboard rank correctly", () => {
    const airline = makeAirline({ id: "al-own", corporateBalance: fp(500000) });
    const comp1 = makeAirline({
      id: "al-comp1",
      ceoPubkey: "pk2",
      corporateBalance: fp(2000000),
    });
    const comp2 = makeAirline({
      id: "al-comp2",
      ceoPubkey: "pk3",
      corporateBalance: fp(100000),
    });
    mockState = {
      airline,
      fleet: [],
      routes: [],
      competitors: new Map([
        ["pk2", comp1],
        ["pk3", comp2],
      ]),
    };
    const { result } = renderHook(() => useNavBadges());
    // Sorted: comp1 (2M), own (500k), comp2 (100k) → rank 2
    expect(result.current.leaderboardRank).toBe(2);
  });

  it("returns rank 1 when airline is top by balance", () => {
    const airline = makeAirline({
      id: "al-own",
      corporateBalance: fp(9999999),
    });
    const comp = makeAirline({
      id: "al-comp",
      ceoPubkey: "pk2",
      corporateBalance: fp(100),
    });
    mockState = {
      airline,
      fleet: [],
      routes: [],
      competitors: new Map([["pk2", comp]]),
    };
    const { result } = renderHook(() => useNavBadges());
    expect(result.current.leaderboardRank).toBe(1);
  });
});
