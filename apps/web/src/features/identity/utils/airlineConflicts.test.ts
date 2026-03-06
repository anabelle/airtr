import type { AirlineEntity } from "@acars/core";
import { fp } from "@acars/core";
import { describe, expect, it } from "vitest";
import { findAirlineConflicts } from "./airlineConflicts";

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

describe("findAirlineConflicts", () => {
  it("returns null conflicts when no matches", () => {
    const competitors = new Map([
      ["comp-1", makeAirline({ ceoPubkey: "comp-1", name: "Skyline", icaoCode: "SKY" })],
    ]);

    const result = findAirlineConflicts(competitors, "Apex", "APX");
    expect(result).toEqual({ nameConflict: null, icaoConflict: null });
  });

  it("detects name conflict case-insensitively", () => {
    const competitors = new Map([
      ["comp-1", makeAirline({ ceoPubkey: "comp-1", name: "Avianca", icaoCode: "AVA" })],
    ]);

    const result = findAirlineConflicts(competitors, "avianca", "APX");
    expect(result.nameConflict).toBe("Avianca");
    expect(result.icaoConflict).toBe(null);
  });

  it("detects ICAO conflict case-insensitively", () => {
    const competitors = new Map([
      ["comp-1", makeAirline({ ceoPubkey: "comp-1", name: "Avianca", icaoCode: "AVA" })],
    ]);

    const result = findAirlineConflicts(competitors, "Apex", "ava");
    expect(result.nameConflict).toBe(null);
    expect(result.icaoConflict).toBe("AVA");
  });

  it("detects both name and ICAO conflicts", () => {
    const competitors = new Map([
      ["comp-1", makeAirline({ ceoPubkey: "comp-1", name: "Avianca", icaoCode: "AVA" })],
    ]);

    const result = findAirlineConflicts(competitors, "Avianca", "AVA");
    expect(result).toEqual({ nameConflict: "Avianca", icaoConflict: "AVA" });
  });
});
