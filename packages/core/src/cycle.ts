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
