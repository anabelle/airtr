import type { AircraftInstance } from "@acars/core";
import { useAirlineStore, useEngineStore } from "@acars/store";
import { PlaneLanding, PlaneTakeoff } from "lucide-react";
import { useMemo } from "react";
import { buildFlightBoardRows, type FlightRow } from "@/features/network/utils/flightBoard";
import { navigateToAirport, navigateToAircraft } from "@/shared/lib/permalinkNavigation";

type FlightBoardProps = {
  airportIata: string;
  airportTimezone: string;
};

const STATUS_CLASS: Record<FlightRow["statusTone"], string> = {
  emerald: "text-emerald-400",
  amber: "text-amber-400",
  sky: "text-sky-400",
  slate: "text-slate-400",
};

function FidsRow({ flight }: { flight: FlightRow }) {
  const loadFactor = flight.loadFactor !== undefined ? Math.round(flight.loadFactor * 100) : null;
  return (
    <div className="grid grid-cols-[72px_1fr_52px_52px_56px_42px] items-center gap-1.5 border-b border-slate-700/60 px-3 py-1.5 text-[11px] font-mono hover:bg-white/[0.03] transition-colors">
      <span
        className={`font-bold uppercase tracking-wide text-[10px] leading-tight ${STATUS_CLASS[flight.statusTone]}`}
      >
        {flight.status}
      </span>
      <span className="flex items-center gap-1.5 min-w-0">
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ backgroundColor: flight.airlineColor }}
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={() => navigateToAircraft(flight.aircraftId)}
          className="text-slate-100 font-semibold truncate hover:text-sky-300 transition-colors cursor-pointer"
        >
          {flight.flightLabel}
        </button>
      </span>
      <button
        type="button"
        onClick={() => navigateToAirport(flight.otherIata, { airportTab: "flights" })}
        className="text-yellow-300 font-bold tracking-wide hover:text-yellow-100 transition-colors cursor-pointer text-left"
      >
        {flight.otherIata}
      </button>
      <span className="text-slate-400 text-[10px]">{flight.aircraft}</span>
      <span className="text-slate-100 font-semibold text-right tabular-nums">
        {flight.timeLabel}
      </span>
      <span className="text-slate-200 text-right tabular-nums text-[10px]">
        {loadFactor !== null ? `${loadFactor}%` : "--"}
      </span>
    </div>
  );
}

function FidsSection({
  title,
  icon,
  columns,
  flights,
  emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  columns: { to: string; time: string };
  flights: FlightRow[];
  emptyLabel: string;
}) {
  return (
    <div>
      {/* Section header — yellow bar like real FIDS */}
      <div className="flex items-center gap-2 bg-amber-500/90 px-3 py-1.5">
        {icon}
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-950 font-mono">
          {title}
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[72px_1fr_52px_52px_56px_42px] gap-1.5 border-b border-slate-600 bg-slate-800/80 px-3 py-1 text-[9px] uppercase tracking-[0.15em] text-slate-400 font-mono font-semibold">
        <span>Status</span>
        <span>Flight</span>
        <span>{columns.to}</span>
        <span>A/C</span>
        <span className="text-right">{columns.time}</span>
        <span className="text-right">LF</span>
      </div>

      {/* Rows */}
      {flights.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-slate-500 font-mono italic">{emptyLabel}</div>
      ) : (
        flights.map((flight) => <FidsRow key={flight.key} flight={flight} />)
      )}
    </div>
  );
}

export function FlightBoard({ airportIata, airportTimezone }: FlightBoardProps) {
  const { airline, fleet, fleetByOwner, competitors, pubkey } = useAirlineStore();
  const tick = useEngineStore((s) => s.tick);

  const competitorFleet = useMemo(() => {
    const playerPubkey = pubkey ?? null;
    const result: AircraftInstance[] = [];
    fleetByOwner.forEach((ownerFleet, key) => {
      if (key !== playerPubkey) result.push(...ownerFleet);
    });
    return result;
  }, [pubkey, fleetByOwner]);

  const departures = useMemo(() => {
    return buildFlightBoardRows({
      airportIata,
      airportTimezone,
      mode: "departures",
      fleet,
      globalFleet: competitorFleet,
      airline,
      competitors,
      tick,
    });
  }, [fleet, competitorFleet, airline, competitors, airportIata, airportTimezone, tick]);

  const arrivals = useMemo(() => {
    return buildFlightBoardRows({
      airportIata,
      airportTimezone,
      mode: "arrivals",
      fleet,
      globalFleet: competitorFleet,
      airline,
      competitors,
      tick,
    });
  }, [fleet, competitorFleet, airline, competitors, airportIata, airportTimezone, tick]);

  return (
    <div className="rounded-lg overflow-hidden border border-slate-700/80 bg-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      {/* FIDS header bar */}
      <div className="flex items-center justify-between bg-slate-950 px-3 py-2 border-b border-slate-700/60">
        <span className="text-[10px] font-mono font-bold uppercase tracking-[0.25em] text-slate-300">
          {airportIata} — Flight Information
        </span>
        <span className="text-[10px] font-mono tabular-nums text-slate-500">
          {departures.length + arrivals.length} flights
        </span>
      </div>

      {/* Departures section */}
      <FidsSection
        title="Departures"
        icon={<PlaneTakeoff className="h-3 w-3 text-slate-950" />}
        columns={{ to: "To", time: "Dep" }}
        flights={departures}
        emptyLabel="No scheduled departures"
      />

      {/* Arrivals section */}
      <FidsSection
        title="Arrivals"
        icon={<PlaneLanding className="h-3 w-3 text-slate-950" />}
        columns={{ to: "From", time: "Arr" }}
        flights={arrivals}
        emptyLabel="No incoming flights"
      />
    </div>
  );
}
