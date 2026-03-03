import { getProsperityIndex } from "@acars/core";
import { airports as AIRPORTS } from "@acars/data";
import { useAirlineStore, useEngineStore } from "@acars/store";
import { useFinancialPulse } from "@/features/corporate/hooks/useFinancialPulse";

/**
 * A global ticker component that displays live macroeconomic and network status.
 * Hidden on mobile devices to save screen space, visible on large screens.
 */
export function Ticker() {
  const season = useEngineStore((s) => (s.routes.length > 0 ? s.routes[0]?.season : "winter"));
  const tick = useEngineStore((s) => s.tick);
  const homeAirport = useEngineStore((s) => s.homeAirport);
  const progress = useEngineStore((s) => s.tickProgress);
  const catchup = useEngineStore((s) => s.catchupProgress);

  const { competitors, fleetByOwner, routesByOwner, timeline } = useAirlineStore();

  const safeTimeline = Array.isArray(timeline) ? timeline : [];

  const prosperity = getProsperityIndex(tick);
  const pulse = useFinancialPulse(safeTimeline);
  const recentLoadFactor = pulse.flightCount > 0 ? Math.round(pulse.avgLoadFactor * 100) : null;

  if (!homeAirport) return null;

  return (
    <div className="pointer-events-auto hidden sm:flex items-center space-x-6 overflow-x-auto custom-scrollbar bg-background/95 backdrop-blur-sm border-t border-border px-4 py-1.5 text-xs font-mono text-muted-foreground z-50 fixed bottom-0 left-0 right-0 shadow-[0_-5px_15px_rgba(0,0,0,0.5)]">
      <div className="flex items-center space-x-2 text-primary w-24 shrink-0">
        <div className="relative h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_5px_currentColor] shrink-0">
          <div className="absolute -inset-1 rounded-full bg-primary/20 animate-ping"></div>
        </div>
        <span className="font-semibold uppercase tracking-wider text-[10px]">Live Data</span>
      </div>

      <div className="flex items-center space-x-3 border-r border-border pr-6 min-w-[120px] shrink-0">
        <span className="shrink-0 text-[10px] text-muted-foreground/70">Game Time</span>
        <div className="flex flex-col flex-1">
          <span className="text-foreground leading-none mb-1">Cycle {tick}</span>
          <div className="h-0.5 w-full bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-1000 ease-linear"
              style={{ width: `${progress * 100}%` }}
            ></div>
          </div>
        </div>
      </div>

      <div className="hidden sm:flex items-center space-x-2 border-r border-border pr-6">
        <span>Airlines</span>
        <span className="text-foreground font-bold">{1 + competitors.size}</span>
      </div>

      <div className="hidden sm:flex items-center space-x-2 border-r border-border pr-6">
        <span>Total Planes</span>
        <span className="text-foreground font-bold">
          {Array.from(fleetByOwner.values()).reduce((sum, f) => sum + f.length, 0)}
        </span>
      </div>

      <div className="hidden sm:flex items-center space-x-2 border-r border-border pr-6">
        <span>Active Routes</span>
        <span className="text-foreground font-bold">
          {Array.from(routesByOwner.values()).reduce((sum, r) => sum + r.length, 0)}
        </span>
      </div>

      <div className="hidden md:flex items-center space-x-2 border-r border-border pr-6">
        <span>Hub</span>
        <span className="text-accent">{homeAirport.iata}</span>
      </div>
      <div className="hidden md:flex items-center space-x-2 border-r border-border pr-6">
        <span>Season</span>
        <span className="text-info text-blue-400 capitalize">{season}</span>
      </div>
      <div className="hidden md:flex items-center space-x-2 border-r border-border pr-6">
        <span>Market Economy</span>
        <span className={`font-semibold ${prosperity >= 1 ? "text-green-500" : "text-orange-400"}`}>
          {(prosperity * 100).toFixed(1)}%
        </span>
      </div>
      {recentLoadFactor !== null && (
        <div className="hidden md:flex items-center space-x-2 border-r border-border pr-6">
          <span>Avg LF</span>
          <span
            className={`font-semibold ${recentLoadFactor >= 80 ? "text-green-500" : recentLoadFactor >= 60 ? "text-amber-400" : "text-rose-400"}`}
          >
            {recentLoadFactor}%
          </span>
        </div>
      )}
      <div className="hidden lg:flex items-center space-x-2 border-r border-border pr-6">
        <span>Database</span>
        <span className="text-foreground">{AIRPORTS.length} Airports</span>
      </div>
      <div className="flex items-center space-x-2 shrink-0">
        <span>Status</span>
        {catchup ? (
          <span className="text-amber-400">
            Catching up ({catchup.phase === "player" ? "Your Airline" : "World"}{" "}
            {Math.min(100, Math.round((catchup.current / Math.max(catchup.target, 1)) * 100))}
            %)
          </span>
        ) : (
          <span className="text-green-500">Normal Operations</span>
        )}
      </div>
    </div>
  );
}
