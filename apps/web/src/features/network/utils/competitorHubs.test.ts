import type { AirlineEntity } from "@acars/core";
import { fp } from "@acars/core";
import { describe, expect, it } from "vitest";
import { buildCompetitorHubEntries } from "./competitorHubs";

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

describe("buildCompetitorHubEntries", () => {
  it("filters competitors to hubs at the airport", () => {
    const competitors = new Map([
      [
        "comp-1",
        makeAirline({
          ceoPubkey: "comp-1",
          name: "NorthWind",
          icaoCode: "NWD",
          hubs: ["JFK"],
        }),
      ],
      [
        "comp-2",
        makeAirline({
          ceoPubkey: "comp-2",
          name: "Sunrise",
          icaoCode: "SUN",
          hubs: ["LAX"],
        }),
      ],
    ]);

    const result = buildCompetitorHubEntries(competitors, "JFK");
    expect(result).toEqual([{ name: "NorthWind", icaoCode: "NWD", ceoPubkey: "comp-1" }]);
  });

  it("allows duplicate names with distinct pubkeys", () => {
    const competitors = new Map([
      [
        "comp-1",
        makeAirline({
          ceoPubkey: "comp-1",
          name: "Avianca",
          icaoCode: "AVA",
          hubs: ["JFK"],
        }),
      ],
      [
        "comp-2",
        makeAirline({
          ceoPubkey: "comp-2",
          name: "Avianca",
          icaoCode: "AVC",
          hubs: ["JFK"],
        }),
      ],
    ]);

    const result = buildCompetitorHubEntries(competitors, "JFK");
    expect(result).toEqual([
      { name: "Avianca", icaoCode: "AVA", ceoPubkey: "comp-1" },
      { name: "Avianca", icaoCode: "AVC", ceoPubkey: "comp-2" },
    ]);
  });
});
