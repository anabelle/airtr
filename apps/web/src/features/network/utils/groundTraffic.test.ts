import type { AircraftInstance, AirlineEntity } from "@acars/core";
import { fp } from "@acars/core";
import { describe, expect, it } from "vitest";
import { buildGroundPresenceByAirport, buildGroundTraffic, isGrounded } from "./groundTraffic";

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

describe("buildGroundTraffic", () => {
  it("matches grounded status rules", () => {
    expect(isGrounded(makeAircraft({ status: "idle" }))).toBe(true);
    expect(isGrounded(makeAircraft({ status: "turnaround" }))).toBe(true);
    expect(isGrounded(makeAircraft({ status: "maintenance" }))).toBe(true);
    expect(isGrounded(makeAircraft({ status: "enroute" }))).toBe(false);
    expect(isGrounded(makeAircraft({ status: "delivery" }))).toBe(false);
  });
  it("counts grounded aircraft for player and competitors", () => {
    const airline = makeAirline({
      ceoPubkey: "player",
      name: "Skyline Air",
      icaoCode: "SKY",
    });
    const competitors = new Map([
      [
        "comp-1",
        makeAirline({
          ceoPubkey: "comp-1",
          name: "NorthWind",
          icaoCode: "NWD",
        }),
      ],
    ]);

    const fleet = [
      makeAircraft({
        id: "p1",
        ownerPubkey: "player",
        baseAirportIata: "JFK",
        status: "idle",
      }),
      makeAircraft({
        id: "p2",
        ownerPubkey: "player",
        baseAirportIata: "JFK",
        status: "turnaround",
      }),
      makeAircraft({
        id: "p3",
        ownerPubkey: "player",
        baseAirportIata: "LAX",
        status: "idle",
      }),
    ];

    const globalFleet = [
      makeAircraft({
        id: "c1",
        ownerPubkey: "comp-1",
        baseAirportIata: "JFK",
        status: "maintenance",
      }),
      makeAircraft({
        id: "c2",
        ownerPubkey: "comp-1",
        baseAirportIata: "JFK",
        status: "enroute",
      }),
    ];

    const result = buildGroundTraffic("JFK", fleet, globalFleet, airline, competitors);
    expect(result.totalCount).toBe(3);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].name).toBe("Skyline Air");
    expect(result.entries[0].icaoCode).toBe("SKY");
    expect(result.entries[0].count).toBe(2);
    expect(result.entries[1].name).toBe("NorthWind");
    expect(result.entries[1].icaoCode).toBe("NWD");
    expect(result.entries[1].count).toBe(1);
  });

  it("sorts competitors by count and name after player", () => {
    const airline = makeAirline({
      ceoPubkey: "player",
      name: "Skyline Air",
      icaoCode: "SKY",
    });
    const competitors = new Map([
      ["alpha", makeAirline({ ceoPubkey: "alpha", name: "Alpha Air", icaoCode: "ALP" })],
      ["beta", makeAirline({ ceoPubkey: "beta", name: "Beta Air", icaoCode: "BET" })],
    ]);

    const fleet = [
      makeAircraft({
        id: "p1",
        ownerPubkey: "player",
        baseAirportIata: "JFK",
        status: "idle",
      }),
    ];

    const globalFleet = [
      makeAircraft({
        id: "a1",
        ownerPubkey: "alpha",
        baseAirportIata: "JFK",
        status: "idle",
      }),
      makeAircraft({
        id: "b1",
        ownerPubkey: "beta",
        baseAirportIata: "JFK",
        status: "idle",
      }),
      makeAircraft({
        id: "b2",
        ownerPubkey: "beta",
        baseAirportIata: "JFK",
        status: "maintenance",
      }),
    ];

    const result = buildGroundTraffic("JFK", fleet, globalFleet, airline, competitors);
    expect(result.entries.map((entry) => entry.name)).toEqual([
      "Skyline Air",
      "Beta Air",
      "Alpha Air",
    ]);
    expect(result.entries.map((entry) => entry.icaoCode)).toEqual(["SKY", "BET", "ALP"]);
  });
});

describe("buildGroundPresenceByAirport", () => {
  it("aggregates per-airport segments with player first", () => {
    const airline = makeAirline({
      ceoPubkey: "player",
      name: "Skyline Air",
      livery: { primary: "#00ff00", secondary: "#222222", accent: "#333333" },
    });
    const competitors = new Map([
      [
        "comp-1",
        makeAirline({
          ceoPubkey: "comp-1",
          name: "NorthWind",
          livery: {
            primary: "#ff0000",
            secondary: "#222222",
            accent: "#333333",
          },
        }),
      ],
    ]);

    const fleet = [
      makeAircraft({
        id: "p1",
        ownerPubkey: "player",
        baseAirportIata: "JFK",
        status: "idle",
      }),
      makeAircraft({
        id: "p2",
        ownerPubkey: "player",
        baseAirportIata: "JFK",
        status: "turnaround",
      }),
    ];

    const globalFleet = [
      makeAircraft({
        id: "c1",
        ownerPubkey: "comp-1",
        baseAirportIata: "JFK",
        status: "maintenance",
      }),
    ];

    const result = buildGroundPresenceByAirport(fleet, globalFleet, airline, competitors);
    expect(result.totals.JFK).toBe(3);
    expect(result.presence.JFK).toHaveLength(2);
    expect(result.presence.JFK[0].color).toBe("#00ff00");
    expect(result.presence.JFK[0].count).toBe(2);
    expect(result.presence.JFK[1].color).toBe("#ff0000");
    expect(result.presence.JFK[1].count).toBe(1);
  });
});
