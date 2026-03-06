import type { AircraftInstance, AirlineEntity, Route } from "@acars/core";
import { fp } from "@acars/core";
import { describe, expect, it } from "vitest";
import { getAircraftBaseHub } from "./aircraftBaseHub";

const makeAircraft = (overrides: Partial<AircraftInstance> = {}): AircraftInstance => ({
  id: "ac-1",
  ownerPubkey: "pubkey-1",
  modelId: "a320neo",
  name: "Ship 1",
  status: "idle",
  assignedRouteId: null,
  baseAirportIata: "BOG",
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
  hubs: ["PTY"],
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

const makeRoute = (overrides: Partial<Route> = {}): Route => ({
  id: "route-1",
  originIata: "PTY",
  destinationIata: "BOG",
  airlinePubkey: "pubkey-1",
  distanceKm: 1000,
  assignedAircraftIds: [],
  fareEconomy: fp(100),
  fareBusiness: fp(200),
  fareFirst: fp(0),
  status: "active",
  ...overrides,
});

describe("getAircraftBaseHub", () => {
  it("prefers assigned route origin over current location", () => {
    const aircraft = makeAircraft({
      assignedRouteId: "route-1",
      baseAirportIata: "BOG",
    });
    const routes = [makeRoute({ id: "route-1", originIata: "PTY" })];
    const airline = makeAirline({ hubs: ["PTY"] });

    expect(getAircraftBaseHub(aircraft, routes, airline)).toBe("PTY");
  });

  it("falls back to aircraft location when unassigned", () => {
    const aircraft = makeAircraft({
      assignedRouteId: null,
      baseAirportIata: "BOG",
    });
    const routes: Route[] = [];
    const airline = makeAirline({ hubs: ["PTY"] });

    expect(getAircraftBaseHub(aircraft, routes, airline)).toBe("BOG");
  });

  it("falls back to airline primary hub when location is blank", () => {
    const aircraft = makeAircraft({
      assignedRouteId: null,
      baseAirportIata: "",
    });
    const routes: Route[] = [];
    const airline = makeAirline({ hubs: ["PTY"] });

    expect(getAircraftBaseHub(aircraft, routes, airline)).toBe("PTY");
  });
});
