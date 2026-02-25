import { useMemo } from 'react';
import { useAirlineStore, useEngineStore } from '@airtr/store';
import { buildFlightBoardRows, type FlightBoardMode } from '@/features/network/utils/flightBoard';

type FlightBoardProps = {
    airportIata: string;
    airportTimezone: string;
    mode: FlightBoardMode;
};

export function FlightBoard({ airportIata, airportTimezone, mode }: FlightBoardProps) {
    const { airline, fleet, globalFleet, competitors } = useAirlineStore();
    const tick = useEngineStore(s => s.tick);

    const flights = useMemo(() => {
        return buildFlightBoardRows({
            airportIata,
            airportTimezone,
            mode,
            fleet,
            globalFleet,
            airline,
            competitors,
            tick,
        });
    }, [fleet, globalFleet, airline, competitors, airportIata, airportTimezone, mode, tick]);

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
