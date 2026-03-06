import { describe, expect, it } from "vitest";
import { countLandingsBetween, enumerateFlightEvents } from "./cycle.js";
import type { Route } from "./types.js";

const makeRoute = (overrides: Partial<Route> = {}): Route =>
  ({
    id: overrides.id ?? "route-test",
    originIata: overrides.originIata ?? "JFK",
    destinationIata: overrides.destinationIata ?? "LAX",
    airlinePubkey: "test-pubkey",
    distanceKm: 3000,
    frequencyPerWeek: 7,
    assignedAircraftIds: [],
    status: "active",
    ...overrides,
  }) as Route;

describe("enumerateFlightEvents", () => {
  const route = makeRoute();
  const durationTicks = 4000;
  const turnaroundTicks = 600;
  const roundTrip = durationTicks * 2 + turnaroundTicks * 2; // 9200

  it("returns empty when toTick <= fromTick", () => {
    expect(enumerateFlightEvents(0, 100, 100, durationTicks, turnaroundTicks, route)).toEqual([]);
    expect(enumerateFlightEvents(0, 200, 100, durationTicks, turnaroundTicks, route)).toEqual([]);
  });

  it("returns empty when durationTicks <= 0", () => {
    expect(enumerateFlightEvents(0, 0, 10000, 0, turnaroundTicks, route)).toEqual([]);
    expect(enumerateFlightEvents(0, 0, 10000, -1, turnaroundTicks, route)).toEqual([]);
  });

  it("returns empty when turnaroundTicks < 0", () => {
    expect(enumerateFlightEvents(0, 0, 10000, durationTicks, -1, route)).toEqual([]);
  });

  it("enumerates a single full round-trip cycle", () => {
    // Cycle starts at tick 0.
    // Transitions:
    //   tick 0    → takeoff outbound  (JFK → LAX)
    //   tick 4000 → landing outbound  (JFK → LAX, arrived LAX)
    //   tick 4600 → takeoff inbound   (LAX → JFK)
    //   tick 8600 → landing inbound   (LAX → JFK, arrived JFK)
    //
    // Query interval: (0, 9200] — one full round trip, excluding the
    // starting takeoff at tick 0 (half-open, exclusive start).
    const events = enumerateFlightEvents(0, 0, roundTrip, durationTicks, turnaroundTicks, route);

    // We should see: landing@4000, takeoff@4600, landing@8600, takeoff@9200
    // (the next cycle's outbound takeoff at tick 9200 is within (0, 9200])
    // Actually tick 9200 is the start of the NEXT cycle, which is offset 0.
    // 0 + 1 * 9200 = 9200. Since 9200 <= 9200 (toTick), it is included.
    expect(events.length).toBe(4);

    // Sorted ascending by tick
    expect(events[0]).toEqual({
      tick: 4000,
      type: "landing",
      direction: "outbound",
      originIata: "JFK",
      destinationIata: "LAX",
    });
    expect(events[1]).toEqual({
      tick: 4600,
      type: "takeoff",
      direction: "inbound",
      originIata: "LAX",
      destinationIata: "JFK",
    });
    expect(events[2]).toEqual({
      tick: 8600,
      type: "landing",
      direction: "inbound",
      originIata: "LAX",
      destinationIata: "JFK",
    });
    expect(events[3]).toEqual({
      tick: 9200,
      type: "takeoff",
      direction: "outbound",
      originIata: "JFK",
      destinationIata: "LAX",
    });
  });

  it("respects half-open interval — excludes events at fromTick", () => {
    // Query exactly at the outbound takeoff tick (0) — should NOT include it
    const events = enumerateFlightEvents(0, 0, 1, durationTicks, turnaroundTicks, route);
    expect(events.length).toBe(0);
  });

  it("includes events exactly at toTick", () => {
    // Query (0, 4000] — should include the landing at 4000
    const events = enumerateFlightEvents(0, 0, 4000, durationTicks, turnaroundTicks, route);
    expect(events.length).toBe(1);
    expect(events[0].tick).toBe(4000);
    expect(events[0].type).toBe("landing");
  });

  it("landing count matches countLandingsBetween", () => {
    const cycleStart = 0;
    const fromTick = 0;
    const toTick = roundTrip * 5; // 5 full cycles

    const events = enumerateFlightEvents(
      cycleStart,
      fromTick,
      toTick,
      durationTicks,
      turnaroundTicks,
      route,
    );
    const landingEvents = events.filter((e) => e.type === "landing");
    const countFromHelper = countLandingsBetween(
      cycleStart,
      fromTick,
      toTick,
      durationTicks,
      turnaroundTicks,
    );

    expect(landingEvents.length).toBe(countFromHelper);
  });

  it("events are sorted by tick ascending", () => {
    const events = enumerateFlightEvents(
      0,
      0,
      roundTrip * 3,
      durationTicks,
      turnaroundTicks,
      route,
    );
    for (let i = 1; i < events.length; i++) {
      expect(events[i].tick).toBeGreaterThanOrEqual(events[i - 1].tick);
    }
  });

  it("respects maxEvents safety cap", () => {
    // 100 cycles = 400 events. Cap at 10.
    const events = enumerateFlightEvents(
      0,
      0,
      roundTrip * 100,
      durationTicks,
      turnaroundTicks,
      route,
      10,
    );
    expect(events.length).toBeLessThanOrEqual(10);
  });

  it("handles cycle start in the past (negative elapsed)", () => {
    // cycleStart is at 10000, query from 0 to 5000 — both before cycleStart+offset for most events
    const events = enumerateFlightEvents(10000, 0, 5000, durationTicks, turnaroundTicks, route);
    // No transitions occur before tick 10000 (earliest is takeoff at 10000)
    expect(events.length).toBe(0);
  });

  it("handles non-zero cycleStartTick correctly", () => {
    const cycleStart = 5000;
    // Transitions at: 5000 (takeoff-out), 9000 (land-out), 9600 (takeoff-in), 13600 (land-in)
    const events = enumerateFlightEvents(
      cycleStart,
      cycleStart,
      cycleStart + roundTrip,
      durationTicks,
      turnaroundTicks,
      route,
    );

    // Excluding takeoff at 5000 (half-open), we get:
    // land@9000, takeoff@9600, land@13600, takeoff@14200 (next cycle start)
    expect(events.length).toBe(4);
    expect(events[0].tick).toBe(cycleStart + durationTicks);
    expect(events[0].type).toBe("landing");
  });

  it("correctly assigns direction and airports", () => {
    const events = enumerateFlightEvents(0, 0, roundTrip, durationTicks, turnaroundTicks, route);

    const outboundEvents = events.filter((e) => e.direction === "outbound");
    const inboundEvents = events.filter((e) => e.direction === "inbound");

    // Outbound events go JFK → LAX
    for (const e of outboundEvents) {
      expect(e.originIata).toBe("JFK");
      expect(e.destinationIata).toBe("LAX");
    }

    // Inbound events go LAX → JFK
    for (const e of inboundEvents) {
      expect(e.originIata).toBe("LAX");
      expect(e.destinationIata).toBe("JFK");
    }
  });

  it("produces exactly 4 events per full cycle when queried cycle-by-cycle", () => {
    // Each full cycle has: landing-out, takeoff-in, landing-in, takeoff-out(next)
    // When querying from end of one cycle to end of next
    for (let c = 0; c < 3; c++) {
      const from = c * roundTrip;
      const to = (c + 1) * roundTrip;
      const events = enumerateFlightEvents(0, from, to, durationTicks, turnaroundTicks, route);
      expect(events.length).toBe(4);
    }
  });

  it("handles narrow query window with no events", () => {
    // Query (1, 2] — well within the first outbound flight, no transitions
    const events = enumerateFlightEvents(0, 1, 2, durationTicks, turnaroundTicks, route);
    expect(events.length).toBe(0);
  });

  it("handles zero turnaround correctly", () => {
    // 0 turnaround is not valid (turnaroundTicks must be >= 0, but roundTrip = 2*d+2*0 = 2*d)
    // Actually turnaroundTicks = 0 is allowed. Round trip = 2*4000 = 8000
    const events = enumerateFlightEvents(0, 0, 8000, durationTicks, 0, route);
    // Transitions: takeoff-out@0(excluded), land-out@4000, takeoff-in@4000, land-in@8000, takeoff-out@8000
    // land-out and takeoff-in at same tick 4000 — both should appear
    expect(events.length).toBe(4);
    const at4000 = events.filter((e) => e.tick === 4000);
    expect(at4000.length).toBe(2);
    expect(at4000.map((e) => e.type).sort()).toEqual(["landing", "takeoff"]);
  });

  it("phase offset (effectiveCycleStart adjustment) produces correct events", () => {
    // Simulate an aircraft that starts at destination (LAX).
    // The caller adjusts cycleStartTick by subtracting phaseOffset.
    const phaseOffset = durationTicks + turnaroundTicks; // 4600
    const assignedTick = 1000;
    const effectiveCycleStart = assignedTick - phaseOffset; // -3600

    // Query from assignment to one round trip after
    const events = enumerateFlightEvents(
      effectiveCycleStart,
      assignedTick,
      assignedTick + roundTrip,
      durationTicks,
      turnaroundTicks,
      route,
    );

    // The first event after tick 1000 should be near the inbound takeoff or landing
    // since the aircraft conceptually starts at the inbound position
    expect(events.length).toBeGreaterThan(0);

    // All events should be within (assignedTick, assignedTick + roundTrip]
    for (const e of events) {
      expect(e.tick).toBeGreaterThan(assignedTick);
      expect(e.tick).toBeLessThanOrEqual(assignedTick + roundTrip);
    }
  });

  it("landing event count across multiple cycles matches countLandingsBetween exactly", () => {
    // Test with various offsets and ranges
    const testCases = [
      { cycleStart: 0, from: 0, to: roundTrip * 10 },
      { cycleStart: 500, from: 500, to: 500 + roundTrip * 7 },
      { cycleStart: 0, from: roundTrip * 2, to: roundTrip * 5 },
      { cycleStart: 100, from: 3000, to: 50000 },
    ];

    for (const { cycleStart, from, to } of testCases) {
      const events = enumerateFlightEvents(
        cycleStart,
        from,
        to,
        durationTicks,
        turnaroundTicks,
        route,
        500, // high cap for this test
      );
      const landingCount = events.filter((e) => e.type === "landing").length;
      const expected = countLandingsBetween(cycleStart, from, to, durationTicks, turnaroundTicks);
      expect(landingCount).toBe(expected);
    }
  });
});
