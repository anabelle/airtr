import type { AircraftInstance, AirlineEntity, Route } from "@acars/core";
import { fp } from "@acars/core";
import { describe, expect, it } from "vitest";
import {
  buildLeaderboardRows,
  computeFleetValue,
  computeNetworkDistance,
  sortLeaderboardRows,
} from "./leaderboardMetrics";

const makeAirline = (overrides: Partial<AirlineEntity> = {}): AirlineEntity => ({
  id: "airline-1",
  foundedBy: "founder",
  status: "private",
  ceoPubkey: "pubkey-1",
  sharesOutstanding: 10000000,
  shareholders: { "pubkey-1": 10000000 },
  name: "Test Air",
  icaoCode: "TST",
  callsign: "TEST",
  hubs: ["JFK"],
  livery: { primary: "#111111", secondary: "#222222", accent: "#333333" },
  brandScore: 0.7,
  tier: 1,
  cumulativeRevenue: fp(0),
  corporateBalance: fp(1000000),
  stockPrice: fp(0),
  fleetIds: [],
  routeIds: [],
  ...overrides,
});

const makeAircraft = (overrides: Partial<AircraftInstance> = {}): AircraftInstance => ({
  id: "ac-1",
  ownerPubkey: "pubkey-1",
  modelId: "a320neo",
  name: "Ship 1",
  status: "idle",
  assignedRouteId: null,
  baseAirportIata: "JFK",
  purchasedAtTick: 0,
  purchasePrice: fp(100000000),
  birthTick: 0,
  purchaseType: "buy",
  configuration: { economy: 156, business: 24, first: 0, cargoKg: 3700 },
  flightHoursTotal: 0,
  flightHoursSinceCheck: 0,
  condition: 1,
  flight: null,
  ...overrides,
});

const makeRoute = (overrides: Partial<Route> = {}): Route => ({
  id: "route-1",
  originIata: "JFK",
  destinationIata: "LAX",
  airlinePubkey: "pubkey-1",
  distanceKm: 3974,
  assignedAircraftIds: [],
  fareEconomy: fp(200),
  fareBusiness: fp(450),
  fareFirst: fp(900),
  status: "active",
  ...overrides,
});

describe("leaderboardMetrics", () => {
  it("computes fleet value from aircraft instances", () => {
    const aircraft = makeAircraft();
    const aircraftById = new Map([[aircraft.id, aircraft]]);
    const value = computeFleetValue([aircraft.id], aircraftById, 0);
    expect(value).toBeGreaterThan(0);
  });

  it("computes network distance from routes", () => {
    const routeA = makeRoute({ id: "route-a", distanceKm: 1200 });
    const routeB = makeRoute({ id: "route-b", distanceKm: 2500 });
    const routeById = new Map([
      [routeA.id, routeA],
      [routeB.id, routeB],
    ]);

    const distance = computeNetworkDistance([routeA.id, routeB.id], routeById);
    expect(distance).toBe(3700);
  });

  it("builds leaderboard rows with derived metrics", () => {
    const airline = makeAirline({
      id: "airline-1",
      fleetIds: ["ac-1"],
      routeIds: ["route-1"],
    });
    const aircraft = makeAircraft({ id: "ac-1" });
    const route = makeRoute({ id: "route-1", distanceKm: 987 });

    const rows = buildLeaderboardRows(
      [airline],
      new Map([[aircraft.id, aircraft]]),
      new Map([[route.id, route]]),
      0,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].fleet).toBe(1);
    expect(rows[0].routes).toBe(1);
    expect(rows[0].networkDistance).toBe(987);
    expect(rows[0].fleetValue).toBeGreaterThan(0);
  });

  it("sorts leaderboard rows by fleet value", () => {
    const rows = [
      {
        id: "a",
        name: "Alpha",
        icaoCode: "AAA",
        ceoPubkey: "pubkey-a",
        liveryPrimary: "#111111",
        balance: fp(100),
        fleet: 1,
        routes: 1,
        brand: 0.5,
        fleetValue: fp(1000),
        networkDistance: 100,
      },
      {
        id: "b",
        name: "Beta",
        icaoCode: "BBB",
        ceoPubkey: "pubkey-b",
        liveryPrimary: "#222222",
        balance: fp(100),
        fleet: 1,
        routes: 1,
        brand: 0.5,
        fleetValue: fp(3000),
        networkDistance: 100,
      },
    ];

    const sorted = sortLeaderboardRows(rows, "fleetValue");
    expect(sorted[0].id).toBe("b");
  });
});
