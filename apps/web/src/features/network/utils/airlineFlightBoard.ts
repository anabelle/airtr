import {
  type AircraftInstance,
  type AirlineEntity,
  type Airport,
  GENESIS_TIME,
  TICK_DURATION,
} from "@acars/core";
import { airports as ALL_AIRPORTS } from "@acars/data";
import { getFlightNumber } from "@/features/network/utils/flightNumber";
import {
  type FlightRow,
  BOARDING_WINDOW_TICKS,
  aircraftModelIndex,
  formatTickTime,
  getFlightSeed,
  getStatusTone,
} from "@/features/network/utils/flightBoard";

export type AirlineFlightRow = FlightRow & {
  originIata: string;
  destinationIata: string;
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

  if (aircraft.status === "enroute") {
    return airportByIata.get(flight.destinationIata)?.timezone ?? "UTC";
  }
  if (aircraft.status === "turnaround") {
    const arrivalTick = aircraft.arrivalTickProcessed ?? flight.arrivalTick;
    const turnaroundEndTick = aircraft.turnaroundEndTick ?? arrivalTick;
    const turnaroundMidpoint = arrivalTick + Math.floor((turnaroundEndTick - arrivalTick) / 2);
    if (tick < turnaroundMidpoint) {
      // Landed → destination timezone
      return airportByIata.get(flight.destinationIata)?.timezone ?? "UTC";
    }
    // Boarding/Scheduled for next departure → origin timezone of next leg
    // For turnaround, the aircraft is at the destination preparing to fly back
    return airportByIata.get(flight.destinationIata)?.timezone ?? "UTC";
  }
  // Idle/Scheduled → origin timezone
  return airportByIata.get(flight.originIata)?.timezone ?? "UTC";
}

export function buildAirlineFlightBoardRows(
  fleet: AircraftInstance[],
  airline: AirlineEntity | null,
  tick: number,
): AirlineFlightRow[] {
  const rows: AirlineFlightRow[] = [];
  const icaoCode = airline?.icaoCode ?? "UNK";
  const airlineName = airline?.name ?? "Unknown Airline";
  const airlineColor = airline?.livery.primary ?? "#94a3b8";

  for (const aircraft of fleet) {
    const flight = aircraft.flight;
    if (!flight) continue;
    if (aircraft.status === "delivery" || aircraft.status === "maintenance") continue;

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
      otherIata: flight.destinationIata,
      originIata: flight.originIata,
      destinationIata: flight.destinationIata,
      aircraft: model ? model.name : aircraft.modelId,
      timeLabel: `${timeLabel} ${offsetLabel}`,
      timeSort: relevantTick,
      loadFactor: aircraft.lastKnownLoadFactor,
    });
  }

  return rows.sort((a, b) => a.timeSort - b.timeSort);
}
