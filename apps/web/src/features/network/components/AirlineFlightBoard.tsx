import { useActiveAirline, useEngineStore } from "@acars/store";
import { Plane } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  buildAirlineFlightBoardRows,
  type AirlineFlightRow,
} from "@/features/network/utils/airlineFlightBoard";
import { navigateToAirport, navigateToAircraft } from "@/shared/lib/permalinkNavigation";

const STATUS_CLASS: Record<AirlineFlightRow["statusTone"], string> = {
  emerald: "text-emerald-400",
  amber: "text-amber-400",
  sky: "text-sky-400",
  slate: "text-slate-400",
};

function AirlineFidsRow({ flight }: { flight: AirlineFlightRow }) {
  const loadFactor = flight.loadFactor !== undefined ? Math.round(flight.loadFactor * 100) : null;
  return (
    <div className="grid grid-cols-[68px_1fr_44px_44px_52px_72px_36px] items-center gap-1.5 border-b border-slate-700/60 px-3 py-1.5 text-[11px] font-mono hover:bg-white/[0.03] transition-colors">
      <span
        className={`font-bold uppercase tracking-wide text-[10px] leading-tight ${STATUS_CLASS[flight.statusTone]}`}
      >
        {flight.status}
      </span>
      <span className="flex items-center gap-1.5 min-w-0">
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
        onClick={() => navigateToAirport(flight.originIata, { airportTab: "flights" })}
        className="text-yellow-300 font-bold tracking-wide hover:text-yellow-100 transition-colors cursor-pointer text-left"
      >
        {flight.originIata}
      </button>
      <button
        type="button"
        onClick={() => navigateToAirport(flight.destinationIata, { airportTab: "flights" })}
        className="text-yellow-300 font-bold tracking-wide hover:text-yellow-100 transition-colors cursor-pointer text-left"
      >
        {flight.destinationIata}
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

export function AirlineFlightBoard() {
  const { t } = useTranslation("game");
  const { airline, fleet } = useActiveAirline();
  const tick = useEngineStore((s) => s.tick);

  const flights = useMemo(
    () => buildAirlineFlightBoardRows(fleet, airline, tick),
    [fleet, airline, tick],
  );

  if (flights.length === 0) return null;

  return (
    <div className="rounded-lg overflow-hidden border border-slate-700/80 bg-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] mb-4">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-slate-950 px-3 py-2 border-b border-slate-700/60">
        <span className="text-[10px] font-mono font-bold uppercase tracking-[0.25em] text-slate-300">
          {airline?.icaoCode ?? "---"} — {t("airlineFlightBoard.title", { ns: "game" })}
        </span>
        <span className="text-[10px] font-mono tabular-nums text-slate-500">
          {t("airlineFlightBoard.activeCount", { ns: "game", count: flights.length })}
        </span>
      </div>

      {/* Section bar */}
      <div className="flex items-center gap-2 bg-amber-500/90 px-3 py-1.5">
        <Plane className="h-3 w-3 text-slate-950" />
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-950 font-mono">
          {t("airlineFlightBoard.title", { ns: "game" })}
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[68px_1fr_44px_44px_52px_72px_36px] gap-1.5 border-b border-slate-600 bg-slate-800/80 px-3 py-1 text-[9px] uppercase tracking-[0.15em] text-slate-400 font-mono font-semibold">
        <span>{t("flightBoard.status", { ns: "game" })}</span>
        <span>{t("flightBoard.flight", { ns: "game" })}</span>
        <span>{t("flightBoard.from", { ns: "game" })}</span>
        <span>{t("flightBoard.to", { ns: "game" })}</span>
        <span>{t("flightBoard.aircraft", { ns: "game" })}</span>
        <span className="text-right">{t("airlineFlightBoard.time", { ns: "game" })}</span>
        <span className="text-right">{t("flightBoard.loadFactor", { ns: "game" })}</span>
      </div>

      {/* Rows */}
      {flights.map((flight) => (
        <AirlineFidsRow key={flight.key} flight={flight} />
      ))}
    </div>
  );
}
