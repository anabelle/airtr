import { fpFormat } from "@airtr/core";
import { useActiveAirline, useAirlineStore } from "@airtr/store";
import { useNavigate } from "@tanstack/react-router";
import { useFinancialPulse } from "@/features/corporate/hooks/useFinancialPulse";

export function Topbar() {
  const airline = useAirlineStore((state) => state.airline);
  const initializeIdentity = useAirlineStore((state) => state.initializeIdentity);
  const isLoading = useAirlineStore((state) => state.isLoading);
  const viewAs = useAirlineStore((state) => state.viewAs);
  const { airline: activeAirline, timeline, isViewingOther } = useActiveAirline();
  const navigate = useNavigate();
  const safeTimeline = Array.isArray(timeline) ? timeline : [];
  const pulse = useFinancialPulse(safeTimeline);
  const avgLoadFactor = pulse.avgLoadFactor;

  if (!airline) {
    return (
      <div className="pointer-events-auto flex h-14 w-full items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-xl">
        <div className="flex items-center space-x-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/20 text-xs font-bold text-primary">
            AT
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-foreground leading-none">AirTR</h1>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
              Live Aviation Exchange
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={initializeIdentity}
          disabled={isLoading}
          className="rounded-md border border-border bg-background/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-60"
        >
          {isLoading ? "Connecting..." : "Connect Wallet"}
        </button>
      </div>
    );
  }

  if (!activeAirline) return null;

  return (
    <div className="pointer-events-auto flex h-14 w-full items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-xl">
      <div className="flex items-center space-x-4">
        {/* Livery Box */}
        <div
          className="flex h-8 w-8 items-center justify-center rounded uppercase text-[10px] font-bold shadow-sm"
          style={{
            backgroundColor: activeAirline.livery.primary,
            color: activeAirline.livery.secondary,
            border: `1px solid ${activeAirline.livery.secondary}40`,
          }}
        >
          {activeAirline.icaoCode}
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-tight text-foreground leading-none">
            {activeAirline.name}
          </h1>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
            {activeAirline.callsign}
          </p>
        </div>
        {isViewingOther && (
          <button
            type="button"
            onClick={() => {
              viewAs(null);
              navigate({ to: "/" });
            }}
            className="ml-4 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:border-primary/40 hover:text-foreground"
          >
            Back to Your Airline
          </button>
        )}
      </div>

      {/* Critical Macro Metrics */}
      <div className="flex items-center space-x-8">
        <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase font-semibold text-muted-foreground leading-none">
            Corporate Balance
          </span>
          <span className="font-mono text-sm font-bold text-green-400 mt-1">
            {fpFormat(activeAirline.corporateBalance)}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase font-semibold text-muted-foreground leading-none">
            Stock Price
          </span>
          <span className="font-mono text-sm font-bold text-primary mt-1">
            {fpFormat(activeAirline.stockPrice)}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase font-semibold text-muted-foreground leading-none">
            Brand / Tier
          </span>
          <span className="font-mono text-sm font-bold text-foreground mt-1 text-right">
            {(activeAirline.brandScore * 10).toFixed(1)}{" "}
            <span className="text-muted-foreground">T{activeAirline.tier}</span>
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase font-semibold text-muted-foreground leading-none">
            Avg Load Factor
          </span>
          <span
            className={`font-mono text-sm font-bold mt-1 ${avgLoadFactor >= 0.8 ? "text-emerald-400" : avgLoadFactor >= 0.6 ? "text-amber-400" : "text-rose-400"}`}
          >
            {Math.round(avgLoadFactor * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
