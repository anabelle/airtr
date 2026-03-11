import {
  type AircraftInstance,
  type AirlineEntity,
  type Airport,
  GENESIS_TIME,
  TICK_DURATION,
} from "@acars/core";
import { airports as ALL_AIRPORTS } from "@acars/data";
import {
  aircraftModelIndex,
  BOARDING_WINDOW_TICKS,
  type FlightRow,
  formatTickTime,
  getFlightSeed,
  getStatusTone,
} from "@/features/network/utils/flightBoard";
import { getFlightNumber } from "@/features/network/utils/flightNumber";

export type AirlineFlightRow = FlightRow & {
  originIata: string;
  destinationIata: string;
};

type FlightBoardWindow = {
  start: number;
  end: number;
};

const airportByIata = new Map<string, Airport>(ALL_AIRPORTS.map((a) => [a.iata, a]));

const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getUtcOffsetLabel(tick: number, timezone: string): string {
  const date = new Date(GENESIS_TIME + tick * TICK_DURATION);
  let fmt = offsetFormatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    });
    offsetFormatterCache.set(timezone, fmt);
  }
  const parts = fmt.formatToParts(date);
  const offsetPart = parts.find((p) => p.type === "timeZoneName");
  // "GMT-5" → "-5", "GMT+5:30" → "+5:30", "GMT" → "+0"
  const raw = offsetPart?.value ?? "";
  return raw.replace("GMT", "").replace(/^$/, "+0");
}

function getAirlineStatusLabel(aircraft: AircraftInstance, tick: number): string {
  if (aircraft.status === "enroute") return "En Route";
  if (aircraft.status === "turnaround") {
    const arrivalTick = aircraft.arrivalTickProcessed ?? aircraft.flight?.arrivalTick ?? tick;
    const turnaroundEndTick = aircraft.turnaroundEndTick ?? arrivalTick;
    const turnaroundMidpoint = arrivalTick + Math.floor((turnaroundEndTick - arrivalTick) / 2);

    if (tick < turnaroundMidpoint) return "Landed";

    const timeToDeparture = Math.max(0, turnaroundEndTick - tick);
    return timeToDeparture <= BOARDING_WINDOW_TICKS ? "Boarding" : "Scheduled";
  }
  if (aircraft.status === "maintenance") return "Maintenance";
  if (aircraft.status === "delivery") return "Delivery";
  return "Scheduled";
}

function isPostMidpointTurnaround(aircraft: AircraftInstance, tick: number): boolean {
  if (aircraft.status !== "turnaround" || !aircraft.flight) return false;

  const arrivalTick = aircraft.arrivalTickProcessed ?? aircraft.flight.arrivalTick;
  const turnaroundEndTick = aircraft.turnaroundEndTick ?? arrivalTick;
  const turnaroundMidpoint = arrivalTick + Math.floor((turnaroundEndTick - arrivalTick) / 2);

  return tick >= turnaroundMidpoint;
}

function getDisplayLeg(
  aircraft: AircraftInstance,
  tick: number,
): { originIata: string; destinationIata: string } | null {
  const flight = aircraft.flight;
  if (!flight) return null;

  if (isPostMidpointTurnaround(aircraft, tick)) {
    return {
      originIata: flight.destinationIata,
      destinationIata: flight.originIata,
    };
  }

  return {
    originIata: flight.originIata,
    destinationIata: flight.destinationIata,
  };
}

function getRelevantTick(aircraft: AircraftInstance, tick: number): number {
  const flight = aircraft.flight;
  if (!flight) return Number.MAX_SAFE_INTEGER;

  if (aircraft.status === "enroute") return flight.arrivalTick;
  if (aircraft.status === "turnaround") {
    const arrivalTick = aircraft.arrivalTickProcessed ?? flight.arrivalTick;
    const turnaroundEndTick = aircraft.turnaroundEndTick ?? arrivalTick;
    const turnaroundMidpoint = arrivalTick + Math.floor((turnaroundEndTick - arrivalTick) / 2);
    // Pre-midpoint = arrived recently → show arrival tick
    if (tick < turnaroundMidpoint) return arrivalTick;
    // Post-midpoint = preparing to depart → show departure tick
    return turnaroundEndTick;
  }
  return flight.departureTick;
}

function getRelevantTimezone(aircraft: AircraftInstance, tick: number): string {
  const flight = aircraft.flight;
  if (!flight) return "UTC";

  const displayLeg = getDisplayLeg(aircraft, tick);
  if (!displayLeg) return "UTC";

  if (aircraft.status === "enroute") {
    return airportByIata.get(displayLeg.destinationIata)?.timezone ?? "UTC";
  }
  if (aircraft.status === "turnaround") {
    if (isPostMidpointTurnaround(aircraft, tick)) {
      return airportByIata.get(displayLeg.originIata)?.timezone ?? "UTC";
    }
    return airportByIata.get(displayLeg.destinationIata)?.timezone ?? "UTC";
  }
  return airportByIata.get(displayLeg.originIata)?.timezone ?? "UTC";
}

function canAppearOnBoard(aircraft: AircraftInstance) {
  return (
    Boolean(aircraft.flight) && aircraft.status !== "delivery" && aircraft.status !== "maintenance"
  );
}

export function countAirlineFlightBoardRows(fleet: AircraftInstance[]) {
  return fleet.filter(canAppearOnBoard).length;
}

export function buildAirlineFlightBoardRows(
  fleet: AircraftInstance[],
  airline: AirlineEntity | null,
  tick: number,
  window?: FlightBoardWindow,
): AirlineFlightRow[] {
  const rows: AirlineFlightRow[] = [];
  const icaoCode = airline?.icaoCode ?? "UNK";
  const airlineName = airline?.name ?? "Unknown Airline";
  const airlineColor = airline?.livery?.primary ?? "#94a3b8";

  for (const aircraft of fleet) {
    const flight = aircraft.flight;
    if (!canAppearOnBoard(aircraft) || !flight) continue;

    const displayLeg = getDisplayLeg(aircraft, tick);
    if (!displayLeg) continue;
    const status = getAirlineStatusLabel(aircraft, tick);
    const relevantTick = getRelevantTick(aircraft, tick);
    const timezone = getRelevantTimezone(aircraft, tick);
    const timeLabel = formatTickTime(relevantTick, timezone);
    const offsetLabel = getUtcOffsetLabel(relevantTick, timezone);
    const model = aircraftModelIndex.get(aircraft.modelId);

    rows.push({
      key: aircraft.id,
      aircraftId: aircraft.id,
      status,
      statusTone: getStatusTone(status),
      flightLabel: getFlightNumber(icaoCode, getFlightSeed(aircraft)),
      airlineName,
      airlineColor,
      otherIata: displayLeg.destinationIata,
      originIata: displayLeg.originIata,
      destinationIata: displayLeg.destinationIata,
      aircraft: model ? model.name : aircraft.modelId,
      timeLabel: `${timeLabel} ${offsetLabel}`,
      timeSort: relevantTick,
      loadFactor: aircraft.lastKnownLoadFactor,
    });
  }

  const sortedRows = rows.sort((a, b) => a.timeSort - b.timeSort);

  if (!window) return sortedRows;

  return sortedRows.slice(window.start, window.end + 1);
}
