import { getProsperityIndex } from "@acars/core";
import { useAirlineStore, useEngineStore } from "@acars/store";
import { useTranslation } from "react-i18next";

/**
 * A global ticker component that displays live macroeconomic and network status.
 * Hidden on mobile devices to save screen space, visible on large screens.
 */
export function Ticker() {
  const { t } = useTranslation("game");
  const season = useEngineStore((s) => (s.routes.length > 0 ? s.routes[0]?.season : "winter"));
  const tick = useEngineStore((s) => s.tick);
  const homeAirport = useEngineStore((s) => s.homeAirport);
  const progress = useEngineStore((s) => s.tickProgress);
  const catchup = useEngineStore((s) => s.catchupProgress);

  const { competitors, fleetByOwner, routesByOwner } = useAirlineStore();

  const prosperity = getProsperityIndex(tick);

  if (!homeAirport) return null;

  return (
    <div className="pointer-events-auto hidden sm:flex items-center space-x-6 overflow-x-auto custom-scrollbar bg-background/95 backdrop-blur-sm border-t border-border px-4 py-1.5 text-xs font-mono text-muted-foreground z-50 fixed bottom-0 left-0 right-0 shadow-[0_-5px_15px_rgba(0,0,0,0.5)]">
      <div className="flex items-center space-x-2 text-primary w-24 shrink-0">
        <div className="relative h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_5px_currentColor] shrink-0">
          <div className="absolute -inset-1 rounded-full bg-primary/20 animate-ping"></div>
        </div>
        <span className="font-semibold uppercase tracking-wider text-[10px]">
          {t("ticker.liveData")}
        </span>
      </div>

      <div className="flex items-center space-x-3 border-r border-border pr-6 min-w-[120px] shrink-0">
        <span className="shrink-0 text-[10px] text-muted-foreground/70">
          {t("ticker.gameTime")}
        </span>
        <div className="flex flex-col flex-1">
          <span className="text-foreground leading-none mb-1">{t("ticker.cycle", { tick })}</span>
          <div className="h-0.5 w-full bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-1000 ease-linear"
              style={{ width: `${progress * 100}%` }}
            ></div>
          </div>
        </div>
      </div>

      <div className="hidden sm:flex items-center space-x-2 border-r border-border pr-6">
        <span>{t("ticker.airlines")}</span>
        <span className="text-foreground font-bold">{1 + competitors.size}</span>
      </div>

      <div className="hidden sm:flex items-center space-x-2 border-r border-border pr-6">
        <span>{t("ticker.planes")}</span>
        <span className="text-foreground font-bold">
          {Array.from(fleetByOwner.values()).reduce((sum, f) => sum + f.length, 0)}
        </span>
      </div>

      <div className="hidden sm:flex items-center space-x-2 border-r border-border pr-6">
        <span>{t("ticker.routes")}</span>
        <span className="text-foreground font-bold">
          {Array.from(routesByOwner.values()).reduce((sum, r) => sum + r.length, 0)}
        </span>
      </div>

      <div className="hidden md:flex items-center space-x-2 border-r border-border pr-6">
        <span>{t("ticker.season")}</span>
        <span className="text-info text-blue-400 capitalize">{t(`ticker.seasons.${season}`)}</span>
      </div>
      <div className="hidden md:flex items-center space-x-2 border-r border-border pr-6">
        <span>{t("ticker.economy")}</span>
        <span className={`font-semibold ${prosperity >= 1 ? "text-green-500" : "text-orange-400"}`}>
          {(prosperity * 100).toFixed(1)}%
        </span>
      </div>
      <div className="flex items-center space-x-2 shrink-0">
        <span>{t("ticker.status")}</span>
        {catchup ? (
          <span className="text-amber-400">
            {t("ticker.catchingUp", {
              phase: catchup.phase === "player" ? t("ticker.yourAirline") : t("ticker.world"),
              percent: Math.min(
                100,
                Math.round((catchup.current / Math.max(catchup.target, 1)) * 100),
              ),
            })}
          </span>
        ) : (
          <span className="text-green-500">{t("ticker.normalOperations")}</span>
        )}
      </div>
    </div>
  );
}
