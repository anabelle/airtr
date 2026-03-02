import type { Checkpoint } from "@acars/core";
import type { ActionLogEntry } from "@acars/nostr";
import { describe, expect, it } from "vitest";
import { scopeActionsToCheckpoint } from "./scopeActions";

/**
 * Helper to build a minimal ActionLogEntry for testing.
 */
function makeEntry(
  action: string,
  payload: Record<string, unknown>,
  createdAt: number,
  eventId = `evt-${Math.random().toString(36).slice(2, 8)}`,
): ActionLogEntry {
  return {
    event: {
      id: eventId,
      created_at: createdAt,
      author: { pubkey: "test-pubkey" },
    } as unknown as ActionLogEntry["event"],
    action: {
      schemaVersion: 2,
      action,
      payload,
    } as ActionLogEntry["action"],
  };
}

/**
 * Helper to build a minimal Checkpoint for testing.
 */
function makeCheckpoint(
  tick: number,
  createdAt: number,
  fleetIds: string[],
  routeIds: string[],
): Checkpoint {
  return {
    schemaVersion: 1,
    tick,
    createdAt,
    actionChainHash: "test-hash",
    stateHash: "test-state-hash",
    airline: {
      ceoPubkey: "test-pubkey",
      name: "Test Air",
      iataCode: "TA",
      hubs: ["JFK"],
      corporateBalance: 1000000000000,
      fleetIds,
      routeIds,
      brandScore: 0.5,
      lastTick: tick,
      status: "active",
      genesisHash: "test-genesis",
      shareCount: 10000000,
      capTable: [],
    } as unknown as Checkpoint["airline"],
    fleet: fleetIds.map(
      (id) =>
        ({
          id,
          modelId: "b787-9",
          status: "idle",
        }) as unknown as Checkpoint["fleet"][0],
    ),
    routes: routeIds.map(
      (id) =>
        ({
          id,
          originIata: "JFK",
          destinationIata: "LAX",
          status: "active",
        }) as unknown as Checkpoint["routes"][0],
    ),
    timeline: [],
  };
}

describe("scopeActionsToCheckpoint", () => {
  it("includes actions with tick > checkpoint tick", () => {
    const checkpoint = makeCheckpoint(1000, Date.now(), ["ac-1"], ["rt-1"]);
    const actions = [
      makeEntry("TICK_UPDATE", { tick: 1001 }, 100),
      makeEntry("TICK_UPDATE", { tick: 999 }, 90),
    ];

    const scoped = scopeActionsToCheckpoint(actions, checkpoint);

    expect(scoped).toHaveLength(1);
    expect(scoped[0].action.payload).toMatchObject({ tick: 1001 });
  });

  it("filters out actions with tick <= checkpoint tick", () => {
    const checkpoint = makeCheckpoint(1000, Date.now(), ["ac-1"], ["rt-1"]);
    const actions = [
      makeEntry("ROUTE_ASSIGN_AIRCRAFT", { tick: 1000 }, 90),
      makeEntry("ROUTE_ASSIGN_AIRCRAFT", { tick: 500 }, 80),
    ];

    const scoped = scopeActionsToCheckpoint(actions, checkpoint);

    expect(scoped).toHaveLength(0);
  });

  it("rescues AIRCRAFT_PURCHASE actions for aircraft missing from checkpoint fleet", () => {
    // Checkpoint has ac-1, ac-2, ac-3 — but ac-4 and ac-5 were purchased
    // before the checkpoint and are missing (corrupt checkpoint).
    const checkpoint = makeCheckpoint(
      10000,
      Date.now(),
      ["ac-1", "ac-2", "ac-3"],
      ["rt-1", "rt-2"],
    );
    const actions = [
      // These are BEFORE the checkpoint tick — normally filtered out
      makeEntry("AIRCRAFT_PURCHASE", { instanceId: "ac-1", tick: 5000 }, 50),
      makeEntry("AIRCRAFT_PURCHASE", { instanceId: "ac-4", tick: 8000 }, 80),
      makeEntry("AIRCRAFT_PURCHASE", { instanceId: "ac-5", tick: 8100 }, 81),
      // This is AFTER the checkpoint tick — always included
      makeEntry("TICK_UPDATE", { tick: 10001 }, 100),
    ];

    const scoped = scopeActionsToCheckpoint(actions, checkpoint);

    expect(scoped).toHaveLength(3);
    const instanceIds = scoped
      .filter((e) => e.action.action === "AIRCRAFT_PURCHASE")
      .map((e) => (e.action.payload as Record<string, unknown>).instanceId);
    // ac-1 is already in the checkpoint — NOT rescued
    expect(instanceIds).not.toContain("ac-1");
    // ac-4 and ac-5 are missing from checkpoint — rescued
    expect(instanceIds).toContain("ac-4");
    expect(instanceIds).toContain("ac-5");
  });

  it("rescues ROUTE_OPEN actions for routes missing from checkpoint", () => {
    const checkpoint = makeCheckpoint(10000, Date.now(), ["ac-1"], ["rt-1"]);
    const actions = [
      makeEntry("ROUTE_OPEN", { routeId: "rt-1", tick: 5000 }, 50), // already in checkpoint
      makeEntry("ROUTE_OPEN", { routeId: "rt-2", tick: 8000 }, 80), // missing
      makeEntry("TICK_UPDATE", { tick: 10001 }, 100),
    ];

    const scoped = scopeActionsToCheckpoint(actions, checkpoint);

    expect(scoped).toHaveLength(2);
    const routeIds = scoped
      .filter((e) => e.action.action === "ROUTE_OPEN")
      .map((e) => (e.action.payload as Record<string, unknown>).routeId);
    expect(routeIds).not.toContain("rt-1");
    expect(routeIds).toContain("rt-2");
  });

  it("does not rescue non-creative actions even if their tick is below checkpoint", () => {
    // ROUTE_ASSIGN_AIRCRAFT for ac-1 is NOT rescued because ac-1 is already
    // in the checkpoint fleet — only assignments referencing *rescued* (missing)
    // aircraft are rescued.
    const checkpoint = makeCheckpoint(10000, Date.now(), ["ac-1"], ["rt-1"]);
    const actions = [
      makeEntry("ROUTE_ASSIGN_AIRCRAFT", { routeId: "rt-1", aircraftId: "ac-1", tick: 8000 }, 80),
      makeEntry("ROUTE_UPDATE_FARES", { routeId: "rt-1", tick: 9000 }, 90),
      makeEntry("HUB_ADD", { iata: "LAX", tick: 7000 }, 70),
    ];

    const scoped = scopeActionsToCheckpoint(actions, checkpoint);

    expect(scoped).toHaveLength(0);
  });

  it("rescues ROUTE_ASSIGN_AIRCRAFT actions referencing rescued aircraft", () => {
    // ac-2 was purchased before the checkpoint but is missing from it.
    // The assignment of ac-2 to rt-1 should be rescued along with the purchase.
    const checkpoint = makeCheckpoint(10000, Date.now(), ["ac-1"], ["rt-1"]);
    const actions = [
      makeEntry("AIRCRAFT_PURCHASE", { instanceId: "ac-2", tick: 8000 }, 80),
      makeEntry("ROUTE_ASSIGN_AIRCRAFT", { routeId: "rt-1", aircraftId: "ac-2", tick: 8500 }, 85),
      // ac-1 assignment should NOT be rescued — ac-1 is in checkpoint
      makeEntry("ROUTE_ASSIGN_AIRCRAFT", { routeId: "rt-1", aircraftId: "ac-1", tick: 8600 }, 86),
    ];

    const scoped = scopeActionsToCheckpoint(actions, checkpoint);

    expect(scoped).toHaveLength(2);
    expect(scoped[0].action.action).toBe("AIRCRAFT_PURCHASE");
    expect(scoped[1].action.action).toBe("ROUTE_ASSIGN_AIRCRAFT");
    expect((scoped[1].action.payload as Record<string, unknown>).aircraftId).toBe("ac-2");
  });

  it("rescues ROUTE_UNASSIGN_AIRCRAFT actions referencing rescued aircraft", () => {
    // ac-2 was purchased, assigned, then unassigned before the stale checkpoint.
    // All three actions should be rescued to replay the correct state.
    const checkpoint = makeCheckpoint(10000, Date.now(), ["ac-1"], ["rt-1"]);
    const actions = [
      makeEntry("AIRCRAFT_PURCHASE", { instanceId: "ac-2", tick: 7000 }, 70),
      makeEntry("ROUTE_ASSIGN_AIRCRAFT", { routeId: "rt-1", aircraftId: "ac-2", tick: 7500 }, 75),
      makeEntry("ROUTE_UNASSIGN_AIRCRAFT", { routeId: "rt-1", aircraftId: "ac-2", tick: 8000 }, 80),
    ];

    const scoped = scopeActionsToCheckpoint(actions, checkpoint);

    expect(scoped).toHaveLength(3);
    const actionTypes = scoped.map((e) => e.action.action);
    expect(actionTypes).toEqual([
      "AIRCRAFT_PURCHASE",
      "ROUTE_ASSIGN_AIRCRAFT",
      "ROUTE_UNASSIGN_AIRCRAFT",
    ]);
  });

  it("rescues ROUTE_ASSIGN_AIRCRAFT actions referencing a rescued route", () => {
    // rt-2 was opened before the checkpoint but is missing from it.
    // ac-1 IS in the checkpoint, but its assignment to rt-2 should still
    // be rescued so the aircraft flies the rescued route.
    const checkpoint = makeCheckpoint(10000, Date.now(), ["ac-1"], ["rt-1"]);
    const actions = [
      makeEntry("ROUTE_OPEN", { routeId: "rt-2", tick: 7000 }, 70),
      makeEntry("ROUTE_ASSIGN_AIRCRAFT", { routeId: "rt-2", aircraftId: "ac-1", tick: 7500 }, 75),
    ];

    const scoped = scopeActionsToCheckpoint(actions, checkpoint);

    expect(scoped).toHaveLength(2);
    expect(scoped[0].action.action).toBe("ROUTE_OPEN");
    expect(scoped[1].action.action).toBe("ROUTE_ASSIGN_AIRCRAFT");
    expect((scoped[1].action.payload as Record<string, unknown>).routeId).toBe("rt-2");
    expect((scoped[1].action.payload as Record<string, unknown>).aircraftId).toBe("ac-1");
  });

  it("does not rescue AIRCRAFT_PURCHASE for aircraft that were sold before the checkpoint", () => {
    // ac-2 was purchased then sold before the stale checkpoint.  It is
    // correctly absent from the checkpoint fleet — we must NOT resurrect it.
    const checkpoint = makeCheckpoint(10000, Date.now(), ["ac-1"], ["rt-1"]);
    const actions = [
      makeEntry("AIRCRAFT_PURCHASE", { instanceId: "ac-2", tick: 7000 }, 70),
      makeEntry("AIRCRAFT_SELL", { instanceId: "ac-2", tick: 8000 }, 80),
    ];

    const scoped = scopeActionsToCheckpoint(actions, checkpoint);

    expect(scoped).toHaveLength(0);
  });

  it("does not rescue ROUTE_OPEN for routes that were closed before the checkpoint", () => {
    // rt-2 was opened then closed before the stale checkpoint.
    const checkpoint = makeCheckpoint(10000, Date.now(), ["ac-1"], ["rt-1"]);
    const actions = [
      makeEntry("ROUTE_OPEN", { routeId: "rt-2", tick: 7000 }, 70),
      makeEntry("ROUTE_CLOSE", { routeId: "rt-2", tick: 8000 }, 80),
    ];

    const scoped = scopeActionsToCheckpoint(actions, checkpoint);

    expect(scoped).toHaveLength(0);
  });

  it("does not rescue assignments for sold aircraft", () => {
    // ac-2 was purchased, assigned, then sold.  None of these actions
    // should be rescued since the aircraft no longer exists.
    const checkpoint = makeCheckpoint(10000, Date.now(), ["ac-1"], ["rt-1"]);
    const actions = [
      makeEntry("AIRCRAFT_PURCHASE", { instanceId: "ac-2", tick: 6000 }, 60),
      makeEntry("ROUTE_ASSIGN_AIRCRAFT", { routeId: "rt-1", aircraftId: "ac-2", tick: 7000 }, 70),
      makeEntry("AIRCRAFT_SELL", { instanceId: "ac-2", tick: 8000 }, 80),
    ];

    const scoped = scopeActionsToCheckpoint(actions, checkpoint);

    expect(scoped).toHaveLength(0);
  });

  it("uses created_at fallback when action has no tick", () => {
    const checkpoint = makeCheckpoint(10000, 1772400000000, [], []);
    const checkpointSec = Math.floor(1772400000000 / 1000); // 1772400000
    const actions = [
      makeEntry("AIRLINE_CREATE", {}, checkpointSec + 1), // after checkpoint
      makeEntry("AIRLINE_CREATE", {}, checkpointSec - 1), // before checkpoint
    ];

    const scoped = scopeActionsToCheckpoint(actions, checkpoint);

    expect(scoped).toHaveLength(1);
    expect(scoped[0].event.created_at).toBe(checkpointSec + 1);
  });

  it("reproduces the ANZ scenario: stale checkpoint missing 2 of 5 aircraft", () => {
    // Real-world scenario from the bug:
    // Checkpoint at tick 10689848, fleet has only [ac-1, ac-2, ac-3]
    // But there are 5 AIRCRAFT_PURCHASE events, 2 of which (ac-4, ac-5)
    // have ticks below the checkpoint tick.
    const checkpoint = makeCheckpoint(
      10689848,
      1772403146000,
      ["ac-mm56reyx", "ac-mm5b4gwc", "ac-mm5qntmu"],
      ["rt-mm56q5zw", "rt-mm5b7tqd", "rt-mm5qp2cm", "rt-mm5qtopt"],
    );

    const actions = [
      makeEntry("AIRLINE_CREATE", { tick: 10601263 }, 1772137390),
      makeEntry("AIRCRAFT_PURCHASE", { instanceId: "ac-mm56reyx", tick: 10626969 }, 1772214509),
      makeEntry("AIRCRAFT_PURCHASE", { instanceId: "ac-mm5b4gwc", tick: 10629411 }, 1772221836),
      makeEntry("AIRCRAFT_PURCHASE", { instanceId: "ac-mm5qntmu", tick: 10638111 }, 1772247933),
      makeEntry("ROUTE_OPEN", { routeId: "rt-mm56q5zw", tick: 10626950 }, 1772214450),
      makeEntry("ROUTE_OPEN", { routeId: "rt-mm5b7tqd", tick: 10629464 }, 1772221993),
      makeEntry("ROUTE_OPEN", { routeId: "rt-mm5qp2cm", tick: 10638130 }, 1772247991),
      makeEntry("ROUTE_OPEN", { routeId: "rt-mm5qtopt", tick: 10638202 }, 1772248207),
      // THE TWO MISSING PURCHASES — ticks below checkpoint tick
      makeEntry("AIRCRAFT_PURCHASE", { instanceId: "ac-mm853kwh", tick: 10686505 }, 1772393116),
      makeEntry("AIRCRAFT_PURCHASE", { instanceId: "ac-mm857w9b", tick: 10686572 }, 1772393317),
      makeEntry(
        "ROUTE_ASSIGN_AIRCRAFT",
        { routeId: "rt-mm5qtopt", aircraftId: "ac-mm857w9b", tick: 10686819 },
        1772394059,
      ),
      // Post-checkpoint actions
      makeEntry("TICK_UPDATE", { tick: 10690081 }, 1772403844),
      makeEntry(
        "ROUTE_ASSIGN_AIRCRAFT",
        { routeId: "rt-mm56q5zw", aircraftId: "ac-mm853kwh", tick: 10690094 },
        1772403883,
      ),
    ];

    const scoped = scopeActionsToCheckpoint(actions, checkpoint);

    // Should include: 2 rescued purchases + 1 rescued ROUTE_ASSIGN_AIRCRAFT
    // (ac-mm857w9b → rt-mm5qtopt) + 2 post-checkpoint actions = 5
    const purchaseIds = scoped
      .filter((e) => e.action.action === "AIRCRAFT_PURCHASE")
      .map((e) => (e.action.payload as Record<string, unknown>).instanceId);
    expect(purchaseIds).toContain("ac-mm853kwh");
    expect(purchaseIds).toContain("ac-mm857w9b");
    // Should NOT include purchases already in checkpoint
    expect(purchaseIds).not.toContain("ac-mm56reyx");
    expect(purchaseIds).not.toContain("ac-mm5b4gwc");
    expect(purchaseIds).not.toContain("ac-mm5qntmu");
    // The ROUTE_ASSIGN_AIRCRAFT for rescued ac-mm857w9b should be rescued
    const rescuedAssigns = scoped.filter(
      (e) =>
        e.action.action === "ROUTE_ASSIGN_AIRCRAFT" &&
        (e.action.payload as Record<string, unknown>).aircraftId === "ac-mm857w9b",
    );
    expect(rescuedAssigns).toHaveLength(1);
    expect((rescuedAssigns[0].action.payload as Record<string, unknown>).routeId).toBe(
      "rt-mm5qtopt",
    );
    // Post-checkpoint actions should still be included
    expect(scoped.some((e) => e.action.action === "TICK_UPDATE")).toBe(true);
    // Total: 2 purchases + 1 rescued assign + 1 TICK_UPDATE + 1 post-checkpoint assign = 5
    expect(scoped).toHaveLength(5);
  });
});
