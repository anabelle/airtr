import { describe, expect, it } from "vitest";
import { computeActionChainHash, computeCheckpointStateHash } from "./checkpoint.js";
import { fp } from "./fixed-point.js";

describe("checkpoint hashing", () => {
  it("computes stable action chain hashes", async () => {
    const action = {
      schemaVersion: 2,
      action: "AIRLINE_CREATE",
      payload: { name: "Test Air", tick: 1 },
    };

    const first = await computeActionChainHash("", { id: "evt-1", action });
    const second = await computeActionChainHash("", { id: "evt-1", action });
    expect(first).toBe(second);
  });

  it("hashes derived state deterministically", async () => {
    const airline = {
      id: "airline-1",
      foundedBy: "pubkey-1",
      status: "private" as const,
      ceoPubkey: "pubkey-1",
      sharesOutstanding: 10000000,
      shareholders: { "pubkey-1": 10000000 },
      name: "Test Air",
      icaoCode: "TST",
      callsign: "TEST",
      hubs: ["JFK"],
      livery: { primary: "#000000", secondary: "#111111", accent: "#222222" },
      brandScore: 0.5,
      tier: 1,
      cumulativeRevenue: fp(0),
      corporateBalance: 100000000,
      stockPrice: 100000,
      fleetIds: [],
      routeIds: [],
      lastTick: 1,
    };

    const first = await computeCheckpointStateHash({
      airline,
      fleet: [],
      routes: [],
      timeline: [],
    });
    const second = await computeCheckpointStateHash({
      airline,
      fleet: [],
      routes: [],
      timeline: [],
    });
    expect(first).toBe(second);
  });
});
