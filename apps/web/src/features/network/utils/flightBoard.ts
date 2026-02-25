import { aircraftModels } from '@airtr/data';
import { GENESIS_TIME, TICK_DURATION, TICKS_PER_HOUR, type AirlineEntity, type AircraftInstance } from '@airtr/core';
import { getFlightNumber } from '@/features/network/utils/flightNumber';

export type FlightBoardMode = 'departures' | 'arrivals';

export type FlightRow = {
    key: string;
    status: string;
    statusTone: 'emerald' | 'amber' | 'sky' | 'slate';
    flightLabel: string;
    airlineName: string;
    airlineColor: string;
    otherIata: string;
    aircraft: string;
    timeLabel: string;
    timeSort: number;
};

type FlightBoardParams = {
    airportIata: string;
    airportTimezone: string;
    mode: FlightBoardMode;
    fleet: AircraftInstance[];
    globalFleet: AircraftInstance[];
    airline: AirlineEntity | null;
    competitors: Map<string, AirlineEntity>;
    tick: number;
};

const aircraftIndex = new Map(aircraftModels.map(model => [model.id, model]));
const timeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatTickTime(tick: number, timezone: string) {
    const date = new Date(GENESIS_TIME + tick * TICK_DURATION);
    let formatter = timeFormatterCache.get(timezone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: timezone,
        });
        timeFormatterCache.set(timezone, formatter);
    }
    return formatter.format(date);
}

function resolveAirline(
    aircraft: AircraftInstance,
    airline: AirlineEntity | null,
    competitors: Map<string, AirlineEntity>
) {
    if (airline && aircraft.ownerPubkey === airline.ceoPubkey) return airline;
    return competitors.get(aircraft.ownerPubkey) ?? null;
}

const BOARDING_WINDOW_TICKS = Math.round(TICKS_PER_HOUR * 0.25);

function getStatusLabel(aircraft: AircraftInstance, mode: FlightBoardMode, tick: number) {
    if (aircraft.status === 'enroute') return 'En Route';
    if (aircraft.status === 'turnaround') {
        if (mode === 'arrivals') return 'Landed';
        const departureTick = aircraft.turnaroundEndTick ?? aircraft.flight?.arrivalTick ?? tick;
        const timeToDeparture = Math.max(0, departureTick - tick);
        return timeToDeparture <= BOARDING_WINDOW_TICKS ? 'Boarding' : 'Scheduled';
    }
    if (aircraft.status === 'maintenance') return 'Maintenance';
    if (aircraft.status === 'delivery') return 'Delivery';
    return 'Scheduled';
}

function getStatusTone(status: string): FlightRow['statusTone'] {
    if (status === 'Landed' || status === 'Departed') return 'emerald';
    if (status === 'Boarding') return 'amber';
    if (status === 'En Route') return 'sky';
    return 'slate';
}

function getTimeLabel(
    aircraft: AircraftInstance,
    mode: FlightBoardMode,
    airportTimezone: string
) {
    const flight = aircraft.flight;
    if (flight) {
        const targetTick = mode === 'arrivals' ? flight.arrivalTick : flight.departureTick;
        return formatTickTime(targetTick, airportTimezone);
    }
    return '--:--';
}

function getTimeSort(
    aircraft: AircraftInstance,
    mode: FlightBoardMode
) {
    const flight = aircraft.flight;
    if (flight) return mode === 'arrivals' ? flight.arrivalTick : flight.departureTick;
    return Number.MAX_SAFE_INTEGER;
}

function getOtherIata(
    aircraft: AircraftInstance,
    mode: FlightBoardMode
) {
    const flight = aircraft.flight;
    if (!flight) return '--';
    return mode === 'arrivals' ? flight.originIata : flight.destinationIata;
}

function getFlightSeed(aircraft: AircraftInstance) {
    return aircraft.assignedRouteId ?? aircraft.id;
}

function shouldIncludeFlight(
    aircraft: AircraftInstance,
    airportIata: string,
    mode: FlightBoardMode,
    tick: number
) {
    const flight = aircraft.flight;
    if (!flight) return false;

    const isDeparture = flight.originIata === airportIata;
    const isArrival = flight.destinationIata === airportIata;

    if (aircraft.status === 'enroute') {
        if (mode === 'departures') return isDeparture;
        return isArrival;
    }

    if (aircraft.baseAirportIata !== airportIata) return false;

    const arrivalTick = aircraft.arrivalTickProcessed ?? flight.arrivalTick;
    const turnaroundEndTick = aircraft.turnaroundEndTick ?? arrivalTick;
    const turnaroundMidpoint = arrivalTick + Math.floor((turnaroundEndTick - arrivalTick) / 2);

    if (mode === 'departures') {
        if (aircraft.status === 'idle') return isDeparture;
        if (!isArrival || aircraft.status !== 'turnaround') return false;
        return tick >= turnaroundMidpoint;
    }

    if (!isArrival) return false;
    if (aircraft.status !== 'turnaround') return false;
    return tick >= arrivalTick && tick < turnaroundMidpoint;
}

export function buildFlightBoardRows({
    airportIata,
    airportTimezone,
    mode,
    fleet,
    globalFleet,
    airline,
    competitors,
    tick,
}: FlightBoardParams): FlightRow[] {
    const combined = [...fleet, ...globalFleet];
    const rows: FlightRow[] = [];

    for (const aircraft of combined) {
        if (!shouldIncludeFlight(aircraft, airportIata, mode, tick)) continue;

        const airlineInfo = resolveAirline(aircraft, airline, competitors);
        const airlineName = airlineInfo?.name ?? 'Unknown Airline';
        const airlineColor = airlineInfo?.livery.primary ?? '#94a3b8';
        const flightLabel = getFlightNumber(airlineInfo?.icaoCode ?? 'UNK', getFlightSeed(aircraft));
        const model = aircraftIndex.get(aircraft.modelId);
        const aircraftLabel = model ? model.name : aircraft.modelId;
        const status = getStatusLabel(aircraft, mode, tick);

        rows.push({
            key: `${aircraft.id}-${mode}`,
            status,
            statusTone: getStatusTone(status),
            flightLabel,
            airlineName,
            airlineColor,
            otherIata: getOtherIata(aircraft, mode),
            aircraft: aircraftLabel,
            timeLabel: getTimeLabel(aircraft, mode, airportTimezone),
            timeSort: getTimeSort(aircraft, mode),
        });
    }

    return rows
        .sort((a, b) => a.timeSort - b.timeSort)
        .slice(0, 40);
}
