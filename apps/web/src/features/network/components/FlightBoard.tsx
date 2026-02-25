import { useMemo } from 'react';
import { aircraftModels } from '@airtr/data';
import { GENESIS_TIME, TICK_DURATION, type AirlineEntity, type AircraftInstance } from '@airtr/core';
import { useAirlineStore, useEngineStore } from '@airtr/store';
import { getFlightNumber } from '@/features/network/utils/flightNumber';

type FlightBoardMode = 'departures' | 'arrivals';

type FlightBoardProps = {
    airportIata: string;
    airportTimezone: string;
    mode: FlightBoardMode;
};

type FlightRow = {
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

function getStatusLabel(aircraft: AircraftInstance, mode: FlightBoardMode, airportIata: string) {
    if (aircraft.status === 'enroute') return mode === 'arrivals' ? 'En Route' : 'Departed';
    if (aircraft.status === 'turnaround') return mode === 'arrivals' ? 'Landed' : 'Boarding';
    if (aircraft.status === 'maintenance') return 'Maintenance';
    if (aircraft.status === 'delivery') return 'Delivery';
    if (aircraft.status === 'idle') {
        return aircraft.baseAirportIata === airportIata ? 'Boarding' : 'Scheduled';
    }
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

export function FlightBoard({ airportIata, airportTimezone, mode }: FlightBoardProps) {
    const { airline, fleet, globalFleet, competitors } = useAirlineStore();
    useEngineStore(s => s.tick);

    const flights = useMemo(() => {
        const combined = [...fleet, ...globalFleet];
        const rows: FlightRow[] = [];

        for (const aircraft of combined) {
            const flight = aircraft.flight;
            if (!flight) continue;

            const isDeparture = flight.originIata === airportIata;
            const isArrival = flight.destinationIata === airportIata;
            if (mode === 'departures' && !isDeparture) continue;
            if (mode === 'arrivals' && !isArrival) continue;

            const airlineInfo = resolveAirline(aircraft, airline, competitors);
            const airlineName = airlineInfo?.name ?? 'Unknown Airline';
            const airlineColor = airlineInfo?.livery.primary ?? '#94a3b8';
            const flightLabel = getFlightNumber(airlineInfo?.icaoCode ?? 'UNK', getFlightSeed(aircraft));
            const model = aircraftIndex.get(aircraft.modelId);
            const aircraftLabel = model ? model.name : aircraft.modelId;
            const status = getStatusLabel(aircraft, mode, airportIata);

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
    }, [fleet, globalFleet, airline, competitors, airportIata, airportTimezone, mode]);

    const emptyLabel = mode === 'departures'
        ? 'No scheduled departures'
        : 'No incoming flights';

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-[84px_1.1fr_64px_64px_72px] gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">
                <span>Status</span>
                <span>Flight</span>
                <span>{mode === 'departures' ? 'To' : 'From'}</span>
                <span>A/C</span>
                <span>{mode === 'departures' ? 'Dep' : 'Arr'}</span>
            </div>

            {flights.length === 0 ? (
                <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-5 text-xs text-muted-foreground">
                    {emptyLabel}
                </div>
            ) : (
                <div className="space-y-2">
                    {flights.map((flight) => {
                        const statusClass = {
                            emerald: 'bg-emerald-500/15 text-emerald-200',
                            amber: 'bg-amber-500/15 text-amber-200',
                            sky: 'bg-sky-500/15 text-sky-200',
                            slate: 'bg-slate-500/15 text-slate-200',
                        }[flight.statusTone];

                        return (
                        <div
                            key={flight.key}
                            className="grid grid-cols-[84px_1.1fr_64px_64px_72px] items-center gap-2 rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs"
                        >
                            <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass}`}
                            >
                                {flight.status}
                            </span>
                            <span className="flex flex-col">
                                <span className="flex items-center gap-2 text-foreground font-semibold">
                                    <span
                                        className="h-2 w-2 rounded-full"
                                        style={{ backgroundColor: flight.airlineColor }}
                                        aria-hidden="true"
                                    />
                                    {flight.flightLabel}
                                </span>
                                <span className="text-[11px] text-muted-foreground truncate">{flight.airlineName}</span>
                            </span>
                            <span className="font-mono font-semibold text-foreground">{flight.otherIata}</span>
                            <span className="font-mono text-muted-foreground">{flight.aircraft}</span>
                            <span className="font-mono text-foreground">{flight.timeLabel}</span>
                        </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
