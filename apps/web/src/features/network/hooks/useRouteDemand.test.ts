import type { Route } from "@acars/core";
import { fp } from "@acars/core";
import { describe, expect, it, vi } from "vitest";
import { getRouteDemandSnapshot } from "./useRouteDemand";

vi.mock("@acars/store", () => {
  return {
    useAirlineStore: vi.fn(),
    useEngineStore: vi.fn(),
  };
});

vi.mock("@acars/data", () => {
  return {
    airports: [
      {
        iata: "JFK",
        latitude: 0,
        longitude: 0,
      },
      {
        iata: "LAX",
        latitude: 1,
        longitude: 1,
      },
    ],
    HUB_CLASSIFICATIONS: {},
  };
});

vi.mock("@acars/core", async () => {
  const actual = await vi.importActual<typeof import("@acars/core")>("@acars/core");
  return {
    ...actual,
    buildHubState: vi.fn(() => ({
      hubIata: "",
      spokeCount: 0,
      weeklyFrequency: 0,
      avgFrequency: 0,
    })),
    calculateDemand: vi.fn(() => ({
      origin: "JFK",
      destination: "LAX",
      economy: 100,
      business: 50,
      first: 25,
    })),
    scaleToAddressableMarket: vi.fn((demand) => ({
      ...demand,
      economy: 70,
      business: 20,
      first: 10,
    })),
    calculateSupplyPressure: vi.fn(() => 0.8),
    getAirportTraffic: vi.fn(() => 0),
    getSuggestedFares: vi.fn(() => ({
      economy: fp(100),
      business: fp(200),
      first: fp(300),
    })),
    calculatePriceElasticity: vi.fn((_actual, _reference, elasticity) => {
      if (elasticity === -1.2) return 0.5;
      if (elasticity === -0.5) return 0.9;
      return 1.1;
    }),
    getSeason: vi.fn(() => "summer"),
    getProsperityIndex: vi.fn(() => 1),
    getHubDemandModifier: vi.fn(() => 1),
    getHubCongestionModifier: vi.fn(() => 1),
  };
});

describe("getRouteDemandSnapshot", () => {
  it("returns elasticity metadata and effective load factor", () => {
    const route: Route = {
      id: "route-1",
      originIata: "JFK",
      destinationIata: "LAX",
      airlinePubkey: "pub",
      distanceKm: 500,
      assignedAircraftIds: ["ac-1"],
      fareEconomy: fp(120),
      fareBusiness: fp(220),
      fareFirst: fp(330),
      status: "active",
    };

    const snapshot = getRouteDemandSnapshot(
      route,
      0,
      [
        {
          id: "ac-1",
          configuration: { economy: 120, business: 12, first: 4, cargoKg: 0 },
        },
      ],
      [],
    );

    expect(snapshot.elasticityEconomy).toBe(0.5);
    expect(snapshot.elasticityBusiness).toBe(0.9);
    expect(snapshot.elasticityFirst).toBe(1.1);
    expect(snapshot.referenceFareEconomy).toBe(fp(100));
    expect(snapshot.referenceFareBusiness).toBe(fp(200));
    expect(snapshot.referenceFareFirst).toBe(fp(300));
    expect(snapshot.effectiveLoadFactor).toBeCloseTo(0.512, 3);
  });

  it("returns elasticity data when airports are missing", () => {
    const route: Route = {
      id: "route-2",
      originIata: "AAA",
      destinationIata: "BBB",
      airlinePubkey: "pub",
      distanceKm: 500,
      assignedAircraftIds: [],
      fareEconomy: fp(120),
      fareBusiness: fp(220),
      fareFirst: fp(330),
      status: "active",
    };

    const snapshot = getRouteDemandSnapshot(route, 0, [], []);

    expect(snapshot.pressureMultiplier).toBe(0.15);
    expect(snapshot.elasticityEconomy).toBe(0.5);
    expect(snapshot.elasticityBusiness).toBe(0.9);
    expect(snapshot.elasticityFirst).toBe(1.1);
    expect(snapshot.effectiveLoadFactor).toBeCloseTo(0.0915, 4);
  });
});
