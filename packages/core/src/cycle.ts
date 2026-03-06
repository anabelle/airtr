import type { Route } from "./types.js";

export interface CyclePhase {
  status: "enroute" | "turnaround";
  direction: "outbound" | "inbound";
  positionInCycle: number;
  departureTick: number;
  arrivalTick: number;
  turnaroundEndTick: number | null;
  baseAirportIata: string;
  originIata: string;
  destinationIata: string;
}

export function getCyclePhase(
  cycleStartTick: number,
  targetTick: number,
  durationTicks: number,
  turnaroundTicks: number,
  route: Route,
): CyclePhase {
  if (durationTicks <= 0 || turnaroundTicks < 0) {
    throw new Error(
      `getCyclePhase: invalid inputs — durationTicks=${durationTicks}, turnaroundTicks=${turnaroundTicks}`,
    );
  }
  const roundTripTicks = durationTicks * 2 + turnaroundTicks * 2;
  const elapsed = targetTick - cycleStartTick;
  const positionInCycle = ((elapsed % roundTripTicks) + roundTripTicks) % roundTripTicks;

  if (positionInCycle < durationTicks) {
    const departureTick = targetTick - positionInCycle;
    return {
      status: "enroute",
      direction: "outbound",
      positionInCycle,
      departureTick,
      arrivalTick: departureTick + durationTicks,
      turnaroundEndTick: null,
      baseAirportIata: route.originIata,
      originIata: route.originIata,
      destinationIata: route.destinationIata,
    };
  } else if (positionInCycle < durationTicks + turnaroundTicks) {
    const arrivalTick = targetTick - (positionInCycle - durationTicks);
    return {
      status: "turnaround",
      direction: "outbound",
      positionInCycle,
      departureTick: arrivalTick - durationTicks,
      arrivalTick,
      turnaroundEndTick: arrivalTick + turnaroundTicks,
      baseAirportIata: route.destinationIata,
      originIata: route.originIata,
      destinationIata: route.destinationIata,
    };
  } else if (positionInCycle < durationTicks * 2 + turnaroundTicks) {
    const inboundStart = durationTicks + turnaroundTicks;
    const departureTick = targetTick - (positionInCycle - inboundStart);
    return {
      status: "enroute",
      direction: "inbound",
      positionInCycle,
      departureTick,
      arrivalTick: departureTick + durationTicks,
      turnaroundEndTick: null,
      baseAirportIata: route.destinationIata,
      originIata: route.destinationIata,
      destinationIata: route.originIata,
    };
  } else {
    const inboundArrival = durationTicks * 2 + turnaroundTicks;
    const arrivalTick = targetTick - (positionInCycle - inboundArrival);
    return {
      status: "turnaround",
      direction: "inbound",
      positionInCycle,
      departureTick: arrivalTick - durationTicks,
      arrivalTick,
      turnaroundEndTick: arrivalTick + turnaroundTicks,
      baseAirportIata: route.originIata,
      originIata: route.destinationIata,
      destinationIata: route.originIata,
    };
  }
}

/**
 * Count the number of landings that occur in the half-open interval (fromTick, toTick].
 *
 * - Exclusive start, inclusive end: a landing exactly at `fromTick` is NOT counted,
 *   but a landing exactly at `toTick` IS counted.
 * - Returns 0 when `toTick <= fromTick`, `durationTicks <= 0`, or `turnaroundTicks < 0`.
 */
/**
 * Counts landings between ticks using cycle algebra.
 */
export function countLandingsBetween(
  cycleStartTick: number,
  fromTick: number,
  toTick: number,
  durationTicks: number,
  turnaroundTicks: number,
): number {
  if (toTick <= fromTick) return 0;
  if (durationTicks <= 0 || turnaroundTicks < 0) return 0;
  const roundTripTicks = durationTicks * 2 + turnaroundTicks * 2;
  const landingOffsets = [durationTicks, durationTicks * 2 + turnaroundTicks];
  let count = 0;

  for (const offset of landingOffsets) {
    const firstLandingTick = cycleStartTick + offset;
    if (toTick < firstLandingTick) continue;
    const countTo = Math.floor((toTick - firstLandingTick) / roundTripTicks) + 1;
    const countFrom =
      fromTick >= firstLandingTick
        ? Math.floor((fromTick - firstLandingTick) / roundTripTicks) + 1
        : 0;
    count += countTo - countFrom;
  }

  return Math.max(0, count);
}

// --- Flight event enumeration ---

export interface CycleFlightEvent {
  tick: number;
  type: "takeoff" | "landing";
  direction: "outbound" | "inbound";
  originIata: string;
  destinationIata: string;
}

const DEFAULT_MAX_EVENTS = 200;

/**
 * Enumerate every individual takeoff and landing tick in the half-open
 * interval (fromTick, toTick].  Uses cycle algebra (no tick-by-tick loop).
 *
 * Within each round-trip cycle the 4 transition offsets are:
 *   0                              → takeoff outbound
 *   durationTicks                  → landing outbound  (= arrival at dest)
 *   durationTicks + turnaroundTicks→ takeoff inbound   (= departure from dest)
 *   durationTicks*2 + turnaroundTicks → landing inbound (= arrival at origin)
 *
 * Events are returned sorted by tick ascending.  A safety cap (`maxEvents`,
 * default 200) prevents runaway allocation for extremely long offline gaps.
 */
/**
 * Enumerates takeoff/landing events within (fromTick, toTick].
 */
export function enumerateFlightEvents(
  cycleStartTick: number,
  fromTick: number,
  toTick: number,
  durationTicks: number,
  turnaroundTicks: number,
  route: Route,
  maxEvents: number = DEFAULT_MAX_EVENTS,
): CycleFlightEvent[] {
  if (toTick <= fromTick) return [];
  if (durationTicks <= 0 || turnaroundTicks < 0) return [];

  const roundTripTicks = durationTicks * 2 + turnaroundTicks * 2;

  // The 4 transition points within each cycle, described by their offset from
  // cycle start, event type, direction, and origin/destination airports.
  const transitions: Array<{
    offset: number;
    type: "takeoff" | "landing";
    direction: "outbound" | "inbound";
    originIata: string;
    destinationIata: string;
  }> = [
    {
      offset: 0,
      type: "takeoff",
      direction: "outbound",
      originIata: route.originIata,
      destinationIata: route.destinationIata,
    },
    {
      offset: durationTicks,
      type: "landing",
      direction: "outbound",
      originIata: route.originIata,
      destinationIata: route.destinationIata,
    },
    {
      offset: durationTicks + turnaroundTicks,
      type: "takeoff",
      direction: "inbound",
      originIata: route.destinationIata,
      destinationIata: route.originIata,
    },
    {
      offset: durationTicks * 2 + turnaroundTicks,
      type: "landing",
      direction: "inbound",
      originIata: route.destinationIata,
      destinationIata: route.originIata,
    },
  ];

  const events: CycleFlightEvent[] = [];

  for (const t of transitions) {
    // First occurrence of this transition type at or after cycleStartTick
    const firstTick = cycleStartTick + t.offset;

    // Find the first occurrence in (fromTick, toTick]
    // i.e. the smallest k >= 0 such that firstTick + k * roundTripTicks > fromTick
    if (firstTick > toTick) continue;

    let startK: number;
    if (firstTick > fromTick) {
      startK = 0;
    } else {
      // firstTick + k * roundTripTicks > fromTick
      // k > (fromTick - firstTick) / roundTripTicks
      startK = Math.floor((fromTick - firstTick) / roundTripTicks) + 1;
    }

    for (let k = startK; ; k++) {
      const eventTick = firstTick + k * roundTripTicks;
      if (eventTick > toTick) break;
      events.push({
        tick: eventTick,
        type: t.type,
        direction: t.direction,
        originIata: t.originIata,
        destinationIata: t.destinationIata,
      });
    }
  }

  // Sort by tick ascending (transitions are interleaved across types)
  events.sort((a, b) => a.tick - b.tick);

  return events.slice(0, maxEvents);
}
