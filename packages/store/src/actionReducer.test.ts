import { fp } from "@acars/core";
import { describe, expect, it } from "vitest";
import { replayActionLog } from "./actionReducer";

describe("replayActionLog", () => {
  it("clamps balance and ignores invalid actions", async () => {
    const pubkey = "pubkey-1";
    const actions = [
      {
        eventId: "evt-1",
        authorPubkey: pubkey,
        createdAt: 1,
        action: {
          schemaVersion: 2,
          action: "AIRLINE_CREATE",
          payload: {
            name: "Test Air",
            icaoCode: "TST",
            callsign: "TEST",
            hubs: ["JFK"],
            corporateBalance: fp(9999999999),
            tick: 1,
          },
        },
      },
      {
        eventId: "evt-2",
        authorPubkey: pubkey,
        createdAt: 2,
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_PURCHASE",
          payload: {
            instanceId: "ac-1",
            modelId: "invalid-model",
            price: fp(5000000000),
            tick: 2,
          },
        },
      },
    ];

    const result = await replayActionLog({ pubkey, actions });
    expect(result.airline).toBeTruthy();
    expect(result.fleet.length).toBe(0);
    expect(result.airline?.corporateBalance).toBe(fp(1000000000));
    expect(result.actionChainHash).toBeTypeOf("string");
  });

  it("replays a basic route open action", async () => {
    const pubkey = "pubkey-2";
    const actions = [
      {
        eventId: "evt-1",
        authorPubkey: pubkey,
        createdAt: 1,
        action: {
          schemaVersion: 2,
          action: "AIRLINE_CREATE",
          payload: {
            name: "Route Air",
            hubs: ["LAX"],
            corporateBalance: fp(100000000),
            tick: 1,
          },
        },
      },
      {
        eventId: "evt-2",
        authorPubkey: pubkey,
        createdAt: 2,
        action: {
          schemaVersion: 2,
          action: "ROUTE_OPEN",
          payload: {
            routeId: "rt-1",
            originIata: "LAX",
            destinationIata: "SFO",
            distanceKm: 550,
            tick: 2,
          },
        },
      },
    ];

    const result = await replayActionLog({ pubkey, actions });
    expect(result.routes.length).toBe(1);
    expect(result.routes[0]?.originIata).toBe("LAX");
    expect(result.routes[0]?.destinationIata).toBe("SFO");
    expect(result.actionChainHash).toBeTypeOf("string");
  });

  it("updates status via tick update", async () => {
    const pubkey = "pubkey-3";
    const actions = [
      {
        eventId: "evt-1",
        authorPubkey: pubkey,
        createdAt: 1,
        action: {
          schemaVersion: 2,
          action: "AIRLINE_CREATE",
          payload: { name: "Status Air", hubs: ["SEA"], corporateBalance: fp(50000000), tick: 1 },
        },
      },
      {
        eventId: "evt-2",
        authorPubkey: pubkey,
        createdAt: 2,
        action: {
          schemaVersion: 2,
          action: "TICK_UPDATE",
          payload: { status: "chapter11", tick: 5 },
        },
      },
    ];

    const result = await replayActionLog({ pubkey, actions });
    expect(result.airline?.status).toBe("chapter11");
    expect(result.airline?.lastTick).toBe(5);
    expect(result.actionChainHash).toBeTypeOf("string");
  });

  it("deduplicates retried route opens for the same origin-destination and preserves assignments", async () => {
    const pubkey = "pubkey-dup";
    const actions = [
      {
        eventId: "evt-1",
        authorPubkey: pubkey,
        createdAt: 1,
        action: {
          schemaVersion: 2,
          action: "AIRLINE_CREATE",
          payload: { name: "Dup Air", hubs: ["PTY"], corporateBalance: fp(500000000), tick: 1 },
        },
      },
      {
        eventId: "evt-2",
        authorPubkey: pubkey,
        createdAt: 2,
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_PURCHASE",
          payload: { instanceId: "ac-1", modelId: "a320neo", tick: 2 },
        },
      },
      {
        eventId: "evt-3",
        authorPubkey: pubkey,
        createdAt: 3,
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_PURCHASE",
          payload: { instanceId: "ac-2", modelId: "a320neo", tick: 3 },
        },
      },
      {
        eventId: "evt-4",
        authorPubkey: pubkey,
        createdAt: 4,
        action: {
          schemaVersion: 2,
          action: "ROUTE_OPEN",
          payload: {
            routeId: "rt-1",
            originIata: "PTY",
            destinationIata: "MTY",
            distanceKm: 2200,
            tick: 4,
          },
        },
      },
      {
        // Retried same route (relay delay scenario) — different routeId, same O/D
        eventId: "evt-5",
        authorPubkey: pubkey,
        createdAt: 5,
        action: {
          schemaVersion: 2,
          action: "ROUTE_OPEN",
          payload: {
            routeId: "rt-2",
            originIata: "PTY",
            destinationIata: "MTY",
            distanceKm: 2200,
            tick: 5,
          },
        },
      },
      {
        eventId: "evt-6",
        authorPubkey: pubkey,
        createdAt: 6,
        action: {
          schemaVersion: 2,
          action: "ROUTE_ASSIGN_AIRCRAFT",
          payload: { aircraftId: "ac-1", routeId: "rt-1", tick: 6 },
        },
      },
      {
        // Aircraft assigned to duplicate route — should alias to canonical rt-1
        eventId: "evt-7",
        authorPubkey: pubkey,
        createdAt: 7,
        action: {
          schemaVersion: 2,
          action: "ROUTE_ASSIGN_AIRCRAFT",
          payload: { aircraftId: "ac-2", routeId: "rt-2", tick: 7 },
        },
      },
    ];

    const result = await replayActionLog({ pubkey, actions });
    const route = result.routes.find((r) => r.originIata === "PTY" && r.destinationIata === "MTY");
    const ac1 = result.fleet.find((ac) => ac.id === "ac-1");
    const ac2 = result.fleet.find((ac) => ac.id === "ac-2");

    // Only one route should exist despite two ROUTE_OPEN events
    expect(result.routes).toHaveLength(1);
    expect(route?.id).toBe("rt-1");
    expect(route?.assignedAircraftIds).toEqual(expect.arrayContaining(["ac-1", "ac-2"]));
    expect(ac1?.assignedRouteId).toBe("rt-1");
    expect(ac2?.assignedRouteId).toBe("rt-1");
  });

  it("allows opening reverse-direction routes (different O/D pair)", async () => {
    const pubkey = "pubkey-reverse";
    const actions = [
      {
        eventId: "evt-1",
        authorPubkey: pubkey,
        createdAt: 1,
        action: {
          schemaVersion: 2,
          action: "AIRLINE_CREATE",
          payload: {
            name: "Reverse Air",
            hubs: ["PTY", "MTY"],
            corporateBalance: fp(500000000),
            tick: 1,
          },
        },
      },
      {
        eventId: "evt-2",
        authorPubkey: pubkey,
        createdAt: 2,
        action: {
          schemaVersion: 2,
          action: "ROUTE_OPEN",
          payload: {
            routeId: "rt-1",
            originIata: "PTY",
            destinationIata: "MTY",
            distanceKm: 2200,
            tick: 2,
          },
        },
      },
      {
        eventId: "evt-3",
        authorPubkey: pubkey,
        createdAt: 3,
        action: {
          schemaVersion: 2,
          action: "ROUTE_OPEN",
          payload: {
            routeId: "rt-2",
            originIata: "MTY",
            destinationIata: "PTY",
            distanceKm: 2200,
            tick: 3,
          },
        },
      },
    ];

    const result = await replayActionLog({ pubkey, actions });

    // Both directions should be allowed as separate routes
    expect(result.routes).toHaveLength(2);
    expect(result.routes.find((r) => r.id === "rt-1")).toBeTruthy();
    expect(result.routes.find((r) => r.id === "rt-2")).toBeTruthy();
  });

  it("deduplicates duplicate routes loaded from a checkpoint", async () => {
    const pubkey = "pubkey-ckpt";
    const checkpoint = {
      schemaVersion: 1,
      tick: 100,
      createdAt: 100,
      actionChainHash: "abc",
      stateHash: "def",
      airline: {
        name: "Checkpoint Air",
        callsign: "CKP",
        iata: "CK",
        icao: "CKP",
        liveryColor: "#000",
        hubs: ["PTY"],
        corporateBalance: fp(1000000),
        routeIds: ["rt-1", "rt-2"],
        lastTick: 100,
      },
      fleet: [
        {
          id: "ac-1",
          ownerPubkey: pubkey,
          modelId: "a320neo",
          name: "A320 #1",
          status: "idle",
          assignedRouteId: "rt-1",
          baseAirportIata: "PTY",
          purchasedAtTick: 10,
          purchasePrice: fp(50000000),
          birthTick: 10,
          flight: null,
          configuration: { economy: 180, business: 0, first: 0, cargoKg: 0 },
          flightHoursTotal: 0,
          flightHoursSinceCheck: 0,
          condition: 1.0,
          purchaseType: "buy",
        },
        {
          id: "ac-2",
          ownerPubkey: pubkey,
          modelId: "a320neo",
          name: "A320 #2",
          status: "idle",
          assignedRouteId: "rt-2",
          baseAirportIata: "PTY",
          purchasedAtTick: 11,
          purchasePrice: fp(50000000),
          birthTick: 11,
          flight: null,
          configuration: { economy: 180, business: 0, first: 0, cargoKg: 0 },
          flightHoursTotal: 0,
          flightHoursSinceCheck: 0,
          condition: 1.0,
          purchaseType: "buy",
        },
      ],
      routes: [
        {
          id: "rt-1",
          originIata: "PTY",
          destinationIata: "MTY",
          airlinePubkey: pubkey,
          distanceKm: 2200,
          frequencyPerWeek: 7,
          assignedAircraftIds: ["ac-1"],
          fareEconomy: fp(150),
          fareBusiness: fp(400),
          fareFirst: fp(800),
          status: "active",
        },
        {
          id: "rt-2",
          originIata: "PTY",
          destinationIata: "MTY",
          airlinePubkey: pubkey,
          distanceKm: 2200,
          frequencyPerWeek: 7,
          assignedAircraftIds: ["ac-2"],
          fareEconomy: fp(160),
          fareBusiness: fp(420),
          fareFirst: fp(850),
          status: "active",
        },
      ],
      timeline: [],
    };

    const result = await replayActionLog({
      pubkey,
      actions: [],
      checkpoint: checkpoint as any,
    });

    // Duplicate route from checkpoint should be merged into one
    expect(result.routes).toHaveLength(1);
    const route = result.routes[0];
    expect(route.id).toBe("rt-1");
    expect(route.originIata).toBe("PTY");
    expect(route.destinationIata).toBe("MTY");
    // Aircraft from both routes should be merged
    expect(route.assignedAircraftIds).toEqual(expect.arrayContaining(["ac-1", "ac-2"]));
    expect(route.assignedAircraftIds).toHaveLength(2);
    // Aircraft that pointed at the removed duplicate route must be rebased to canonical
    const ac1 = result.fleet.find((ac) => ac.id === "ac-1");
    const ac2 = result.fleet.find((ac) => ac.id === "ac-2");
    expect(ac1?.assignedRouteId).toBe("rt-1");
    expect(ac2?.assignedRouteId).toBe("rt-1");
  });

  it("cleans up old route assignedAircraftIds on aircraft reassignment", async () => {
    const pubkey = "pubkey-4";
    const actions = [
      {
        eventId: "evt-1",
        authorPubkey: pubkey,
        createdAt: 1,
        action: {
          schemaVersion: 2,
          action: "AIRLINE_CREATE",
          payload: {
            name: "Reassign Air",
            hubs: ["JFK"],
            corporateBalance: fp(500000000),
            tick: 1,
          },
        },
      },
      {
        eventId: "evt-2",
        authorPubkey: pubkey,
        createdAt: 2,
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_PURCHASE",
          payload: {
            instanceId: "ac-1",
            modelId: "a320neo",
            price: fp(50000000),
            deliveryHubIata: "JFK",
            tick: 2,
          },
        },
      },
      {
        eventId: "evt-3",
        authorPubkey: pubkey,
        createdAt: 3,
        action: {
          schemaVersion: 2,
          action: "ROUTE_OPEN",
          payload: {
            routeId: "rt-a",
            originIata: "JFK",
            destinationIata: "LAX",
            distanceKm: 3983,
            tick: 3,
          },
        },
      },
      {
        eventId: "evt-4",
        authorPubkey: pubkey,
        createdAt: 4,
        action: {
          schemaVersion: 2,
          action: "ROUTE_OPEN",
          payload: {
            routeId: "rt-b",
            originIata: "JFK",
            destinationIata: "ORD",
            distanceKm: 1188,
            tick: 4,
          },
        },
      },
      {
        eventId: "evt-5",
        authorPubkey: pubkey,
        createdAt: 5,
        action: {
          schemaVersion: 2,
          action: "ROUTE_ASSIGN_AIRCRAFT",
          payload: {
            aircraftId: "ac-1",
            routeId: "rt-a",
            tick: 100,
          },
        },
      },
      {
        eventId: "evt-6",
        authorPubkey: pubkey,
        createdAt: 6,
        action: {
          schemaVersion: 2,
          action: "ROUTE_ASSIGN_AIRCRAFT",
          payload: {
            aircraftId: "ac-1",
            routeId: "rt-b",
            tick: 200,
          },
        },
      },
    ];

    const result = await replayActionLog({ pubkey, actions });
    const aircraft = result.fleet.find((ac) => ac.id === "ac-1");
    const routeA = result.routes.find((r) => r.id === "rt-a");
    const routeB = result.routes.find((r) => r.id === "rt-b");

    expect(aircraft?.assignedRouteId).toBe("rt-b");
    expect(aircraft?.routeAssignedAtTick).toBe(200);
    expect(aircraft?.routeAssignedAtIata).toBe("JFK"); // baseAirportIata at assignment time
    expect(routeA?.assignedAircraftIds).not.toContain("ac-1");
    expect(routeB?.assignedAircraftIds).toContain("ac-1");
  });

  it("ROUTE_ASSIGN_AIRCRAFT clears stale flight state when actionTick >= departureTick", async () => {
    const pubkey = "pubkey-stale";
    const actions = [
      {
        eventId: "e1",
        authorPubkey: pubkey,
        createdAt: 100,
        action: {
          schemaVersion: 2,
          action: "AIRLINE_CREATE",
          payload: { name: "Test Airline", hubs: ["JFK"] },
        },
      },
      {
        eventId: "e2",
        authorPubkey: pubkey,
        createdAt: 101,
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_PURCHASE",
          payload: {
            instanceId: "ac-1",
            modelId: "a320neo",
            name: "Test A320",
            purchaseType: "buy",
            deliveryHubIata: "JFK",
            tick: 100,
          },
        },
      },
      {
        eventId: "e3",
        authorPubkey: pubkey,
        createdAt: 102,
        action: {
          schemaVersion: 2,
          action: "ROUTE_OPEN",
          payload: {
            routeId: "rt-a",
            originIata: "JFK",
            destinationIata: "LAX",
            distanceKm: 3983,
            tick: 100,
          },
        },
      },
      {
        eventId: "e4",
        authorPubkey: pubkey,
        createdAt: 103,
        action: {
          schemaVersion: 2,
          action: "ROUTE_ASSIGN_AIRCRAFT",
          payload: { aircraftId: "ac-1", routeId: "rt-a", tick: 100 },
        },
      },
      // TICK_UPDATE to reconcile fleet — this gives the aircraft a flight state
      {
        eventId: "e5",
        authorPubkey: pubkey,
        createdAt: 104,
        action: {
          schemaVersion: 2,
          action: "TICK_UPDATE",
          payload: { tick: 5000, timeline: [] },
        },
      },
      // Unassign then reassign at a later tick (stagger scenario)
      {
        eventId: "e6",
        authorPubkey: pubkey,
        createdAt: 105,
        action: {
          schemaVersion: 2,
          action: "ROUTE_UNASSIGN_AIRCRAFT",
          payload: { aircraftId: "ac-1", routeId: "rt-a", tick: 6000 },
        },
      },
      {
        eventId: "e7",
        authorPubkey: pubkey,
        createdAt: 106,
        action: {
          schemaVersion: 2,
          action: "ROUTE_ASSIGN_AIRCRAFT",
          payload: { aircraftId: "ac-1", routeId: "rt-a", tick: 6000 },
        },
      },
    ];

    const result = await replayActionLog({ pubkey, actions });
    const aircraft = result.fleet.find((ac) => ac.id === "ac-1");

    // The TICK_UPDATE at tick 5000 gave the aircraft a flight state with a
    // departureTick in the past. The ROUTE_ASSIGN at tick 6000 should have
    // cleared that stale flight state.
    expect(aircraft?.routeAssignedAtTick).toBe(6000);
    expect(aircraft?.status).toBe("idle");
    expect(aircraft?.flight).toBeNull();
  });

  it("TICK_UPDATE with corporateBalance sets authoritative balance", async () => {
    const pubkey = "pubkey-auth-bal";
    const authoritativeBalance = fp(7777777);
    const actions = [
      {
        eventId: "evt-1",
        authorPubkey: pubkey,
        createdAt: 1,
        action: {
          schemaVersion: 2,
          action: "AIRLINE_CREATE" as const,
          payload: { name: "Auth Air", hubs: ["LAX"], corporateBalance: fp(50000000), tick: 1 },
        },
      },
      {
        eventId: "evt-2",
        authorPubkey: pubkey,
        createdAt: 2,
        action: {
          schemaVersion: 2,
          action: "TICK_UPDATE" as const,
          payload: { tick: 100, corporateBalance: authoritativeBalance },
        },
      },
    ];

    const result = await replayActionLog({ pubkey, actions });
    expect(result.airline?.corporateBalance).toBe(authoritativeBalance);
    expect(result.airline?.lastTick).toBe(100);
  });

  it("TICK_UPDATE without corporateBalance falls back to estimation", async () => {
    const pubkey = "pubkey-est-bal";
    const initialBalance = fp(50000000);
    const actions = [
      {
        eventId: "evt-1",
        authorPubkey: pubkey,
        createdAt: 1,
        action: {
          schemaVersion: 2,
          action: "AIRLINE_CREATE" as const,
          payload: { name: "Est Air", hubs: ["SFO"], corporateBalance: initialBalance, tick: 1 },
        },
      },
      {
        eventId: "evt-2",
        authorPubkey: pubkey,
        createdAt: 2,
        action: {
          schemaVersion: 2,
          action: "TICK_UPDATE" as const,
          payload: { tick: 100 },
        },
      },
    ];

    const result = await replayActionLog({ pubkey, actions });
    // Without corporateBalance in payload, balance should remain unchanged
    // (no fleet to generate revenue, so reconcileFleetToTick delta is 0)
    expect(result.airline?.corporateBalance).toBe(initialBalance);
    expect(result.airline?.lastTick).toBe(100);
  });

  it("bootstraps missing corporateBalance from TICK_UPDATE to default starting balance", async () => {
    const pubkey = "pubkey-bootstrap-default-balance";
    const actions = [
      {
        eventId: "evt-tick-only",
        authorPubkey: pubkey,
        createdAt: 100,
        action: {
          schemaVersion: 2 as const,
          action: "TICK_UPDATE" as const,
          payload: {
            tick: 100,
            fleetIds: [],
            routeIds: [],
          },
        },
      },
    ];

    const result = await replayActionLog({ pubkey, actions });
    expect(result.airline).toBeTruthy();
    expect(result.airline?.corporateBalance).toBe(fp(100000000));
  });

  it("does not replay actions at or before bootstrap TICK_UPDATE tick", async () => {
    const pubkey = "pubkey-bootstrap-skip-history";
    const actions = [
      {
        eventId: "evt-old-purchase",
        authorPubkey: pubkey,
        createdAt: 1,
        action: {
          schemaVersion: 2 as const,
          action: "AIRCRAFT_PURCHASE" as const,
          payload: {
            tick: 10,
            instanceId: "ac-old",
            modelId: "atr72-600",
            name: "Old Plane",
            purchaseType: "buy" as const,
            price: fp(50000000),
            baseAirportIata: "JFK",
          },
        },
      },
      {
        eventId: "evt-bootstrap-tick",
        authorPubkey: pubkey,
        createdAt: 2,
        action: {
          schemaVersion: 2 as const,
          action: "TICK_UPDATE" as const,
          payload: {
            tick: 100,
            corporateBalance: fp(100000000),
            fleetIds: [],
            routeIds: [],
          },
        },
      },
    ];

    const result = await replayActionLog({ pubkey, actions });
    expect(result.airline?.corporateBalance).toBe(fp(100000000));
    expect(result.fleet).toHaveLength(0);
  });

  it("resets dissolved flag after a later AIRLINE_CREATE", async () => {
    const pubkey = "pubkey-dissolve-recreate";
    const actions = [
      {
        eventId: "evt-dissolve",
        authorPubkey: pubkey,
        createdAt: 1,
        action: {
          schemaVersion: 2 as const,
          action: "AIRLINE_DISSOLVE" as const,
          payload: { tick: 1 },
        },
      },
      {
        eventId: "evt-create",
        authorPubkey: pubkey,
        createdAt: 2,
        action: {
          schemaVersion: 2 as const,
          action: "AIRLINE_CREATE" as const,
          payload: {
            name: "Recreated Air",
            hubs: ["JFK"],
            tick: 2,
          },
        },
      },
    ];

    const result = await replayActionLog({ pubkey, actions });
    expect(result.airline?.name).toBe("Recreated Air");
    expect(result.dissolved).toBe(false);
  });
});
