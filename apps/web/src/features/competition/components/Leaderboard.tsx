import type { AircraftInstance, FixedPoint, Route } from "@acars/core";
import { fpFormat } from "@acars/core";
import { useAirlineStore, useEngineStore } from "@acars/store";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownRight, ArrowUpRight, ChevronDown, MapPin, Trophy } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  LeaderboardMetric,
  LeaderboardRow as LeaderboardRowData,
} from "@/features/competition/leaderboardMetrics";
import {
  buildLeaderboardRows,
  sortLeaderboardRows,
} from "@/features/competition/leaderboardMetrics";
import { usePanelScrollRef } from "@/shared/components/layout/panelScrollContext";
import { useNostrProfile } from "@/shared/hooks/useNostrProfile";
import { cn } from "@/shared/lib/utils";

const metricMeta: Record<
  LeaderboardMetric,
  { label: string; description: string; isMoney?: boolean }
> = {
  balance: {
    label: "leaderboard.liquidity",
    description: "leaderboard.liquidityDesc",
    isMoney: true,
  },
  fleet: {
    label: "leaderboard.fleetSize",
    description: "leaderboard.fleetSizeDesc",
  },
  routes: {
    label: "leaderboard.routeCount",
    description: "leaderboard.routeCountDesc",
  },
  brand: {
    label: "leaderboard.brandScore",
    description: "leaderboard.brandScoreDesc",
  },
  fleetValue: {
    label: "leaderboard.fleetValue",
    description: "leaderboard.fleetValueDesc",
    isMoney: true,
  },
  networkDistance: {
    label: "leaderboard.networkDistance",
    description: "leaderboard.networkDistanceDesc",
  },
};
const ROW_HEIGHT = 116;

function formatBrandScore(value: number) {
  return `${(value * 10).toFixed(1)}`;
}

function formatMetric(metric: LeaderboardMetric, value: number | FixedPoint) {
  if (metricMeta[metric].isMoney) return fpFormat(value as FixedPoint, 0);
  if (metric === "brand") return formatBrandScore(value);
  if (metric === "networkDistance") return `${Math.round(value as number).toLocaleString()} km`;
  return value.toLocaleString();
}

function LeaderboardRow({
  row,
  index,
  isOwn,
  metric,
  value,
  onView,
}: {
  row: LeaderboardRowData;
  index: number;
  isOwn: boolean;
  metric: LeaderboardMetric;
  value: number | FixedPoint;
  onView: (pubkey: string) => void;
}) {
  const { t } = useTranslation("game");
  const profile = useNostrProfile(row.ceoPubkey);
  const npub = profile.npub;
  const displayName =
    profile.displayName ||
    profile.name ||
    `${row.ceoPubkey.slice(0, 8)}...${row.ceoPubkey.slice(-4)}`;
  const avatarLetter = displayName?.[0]?.toUpperCase() ?? "?";

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border px-3 py-3 transition sm:flex-row sm:items-center sm:justify-between sm:px-4",
        isOwn
          ? "border-primary/40 bg-primary/10"
          : "border-border/50 bg-background/40 hover:bg-accent/10",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <a
          href={npub ? `https://primal.net/p/${npub}` : undefined}
          target={npub ? "_blank" : undefined}
          rel={npub ? "noreferrer" : undefined}
          className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border/50 bg-background/60"
          aria-label={npub ? `Open ${displayName} on Primal` : undefined}
          style={row.liveryPrimary ? { boxShadow: `0 0 0 2px ${row.liveryPrimary}` } : undefined}
        >
          {profile.image ? (
            <img
              src={profile.image}
              alt={displayName}
              className="h-full w-full object-cover"
              loading="lazy"
              width="40"
              height="40"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center font-mono text-sm font-black text-muted-foreground">
              {profile.isLoading ? "" : avatarLetter}
            </div>
          )}
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground sm:text-base">
              {row.name}
            </span>
            {isOwn && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase text-primary">
                {t("leaderboard.yourAirline")}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground sm:text-xs">
            <span className="truncate">
              {row.icaoCode} · {displayName}
            </span>
            {row.hubs.length > 0 && (
              <span className="inline-flex items-center gap-1 truncate text-muted-foreground/80">
                <MapPin className="h-3 w-3" />
                {row.hubs.slice(0, 3).join(", ")}
                {row.hubs.length > 3 && <span>+{row.hubs.length - 3}</span>}
              </span>
            )}
            {profile.nip05 && (
              <span className="rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
                {profile.nip05}
              </span>
            )}
            {!isOwn && profile.lud16 && (
              <a
                href={`lightning:${profile.lud16}`}
                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-300"
              >
                Zap
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3 sm:shrink-0 sm:items-center sm:justify-end sm:gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:hidden">
          <div className="min-w-0 text-left">
            <div className="text-[10px] uppercase text-muted-foreground">
              {t("leaderboard.fleet")}
            </div>
            <div className="font-mono text-sm text-foreground">{row.fleet}</div>
          </div>
          <div className="min-w-0 text-left">
            <div className="text-[10px] uppercase text-muted-foreground">
              {t("leaderboard.routes")}
            </div>
            <div className="font-mono text-sm text-foreground">{row.routes}</div>
          </div>
        </div>
        <div className="hidden text-right text-xs text-muted-foreground sm:block">
          <div className="text-[10px] uppercase">{t("leaderboard.fleet")}</div>
          <div className="font-mono text-sm text-foreground">{row.fleet}</div>
        </div>
        <div className="hidden text-right text-xs text-muted-foreground sm:block">
          <div className="text-[10px] uppercase">{t("leaderboard.routes")}</div>
          <div className="font-mono text-sm text-foreground">{row.routes}</div>
        </div>
        <div className="min-w-0 text-right">
          <div className="flex items-center justify-end gap-1 text-[10px] uppercase text-muted-foreground">
            {t(metricMeta[metric].label)}
            {index === 0 ? (
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
            )}
          </div>
          <div className="font-mono text-base font-black text-foreground sm:text-lg">
            {formatMetric(metric, value)}
          </div>
        </div>
        {!isOwn && (
          <button
            type="button"
            onClick={() => onView(row.ceoPubkey)}
            className="rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground hover:border-primary/40 hover:text-foreground"
          >
            {t("leaderboard.viewAs")}
          </button>
        )}
      </div>
    </div>
  );
}

export function Leaderboard() {
  const { t } = useTranslation("game");
  const competitors = useAirlineStore((s) => s.competitors);
  const airline = useAirlineStore((s) => s.airline);
  const fleetByOwner = useAirlineStore((s) => s.fleetByOwner);
  const routesByOwner = useAirlineStore((s) => s.routesByOwner);
  const viewAs = useAirlineStore((s) => s.viewAs);
  const currentTick = useEngineStore((s) => s.tick);
  const [metric, setMetric] = useState<LeaderboardMetric>("networkDistance");
  const handleMetricChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => setMetric(e.target.value as LeaderboardMetric),
    [],
  );

  // Build lookup maps separately so toggling metric doesn't rebuild them
  const { aircraftById, routeById } = useMemo(() => {
    const aircraftMap = new Map<string, AircraftInstance>();
    for (const ownerFleet of fleetByOwner.values()) {
      for (const aircraft of ownerFleet) {
        aircraftMap.set(aircraft.id, aircraft);
      }
    }
    const routeMap = new Map<string, Route>();
    for (const ownerRoutes of routesByOwner.values()) {
      for (const route of ownerRoutes) {
        routeMap.set(route.id, route);
      }
    }
    return { aircraftById: aircraftMap, routeById: routeMap };
  }, [fleetByOwner, routesByOwner]);

  const rows = useMemo(() => {
    const entries = Array.from(competitors.values());
    if (airline) {
      entries.push(airline);
    }

    const unique = new Map(entries.map((entry) => [entry.id, entry]));
    const scored = buildLeaderboardRows(
      Array.from(unique.values()),
      aircraftById,
      routeById,
      currentTick,
    );

    return sortLeaderboardRows(scored, metric);
  }, [competitors, airline, aircraftById, routeById, currentTick, metric]);

  const ownId = airline?.id ?? null;
  const panelScrollRef = usePanelScrollRef();
  const parentRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => panelScrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    scrollMargin: parentRef.current?.offsetTop ?? 0,
  });

  return (
    <div className="flex w-full flex-col gap-3 sm:gap-4">
      <div className="rounded-2xl border border-border/50 bg-card/90 p-3 shadow-sm backdrop-blur-xl sm:p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Trophy className="h-5 w-5 text-primary sm:h-6 sm:w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              {t("leaderboard.activeMetric")}
            </p>
            <p className="text-sm font-semibold text-foreground sm:text-base">
              {t(metricMeta[metric].description)}
            </p>
          </div>
        </div>

        <div className="relative mt-3">
          <select
            value={metric}
            onChange={handleMetricChange}
            aria-label={t("leaderboard.sortBy")}
            className="h-10 w-full appearance-none rounded-xl border border-border/60 bg-background/70 px-3 pr-8 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30 sm:text-[11px]"
          >
            {(Object.keys(metricMeta) as LeaderboardMetric[]).map((key) => (
              <option key={key} value={key}>
                {t(metricMeta[key].label)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-background/40 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-foreground">{t("leaderboard.noAirlines")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("leaderboard.noAirlinesDesc")}</p>
        </div>
      ) : (
        <div ref={parentRef}>
          <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              const isOwn = ownId === row.id;
              const value =
                metric === "balance"
                  ? row.balance
                  : metric === "fleet"
                    ? row.fleet
                    : metric === "routes"
                      ? row.routes
                      : metric === "brand"
                        ? row.brand
                        : metric === "fleetValue"
                          ? row.fleetValue
                          : row.networkDistance;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 right-0 pb-2"
                  style={{
                    transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  <LeaderboardRow
                    row={row}
                    index={virtualRow.index}
                    isOwn={isOwn}
                    metric={metric}
                    value={value}
                    onView={viewAs}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
