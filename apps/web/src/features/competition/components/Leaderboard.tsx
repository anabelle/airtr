import type { AircraftInstance, FixedPoint, Route } from "@acars/core";
import { fpFormat } from "@acars/core";
import { useAirlineStore, useEngineStore } from "@acars/store";
import { ArrowDownRight, ArrowUpRight, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  LeaderboardMetric,
  LeaderboardRow as LeaderboardRowData,
} from "@/features/competition/leaderboardMetrics";
import {
  buildLeaderboardRows,
  sortLeaderboardRows,
} from "@/features/competition/leaderboardMetrics";
import { useNostrProfile } from "@/shared/hooks/useNostrProfile";

const metricMeta: Record<
  LeaderboardMetric,
  { label: string; description: string; isMoney?: boolean }
> = {
  balance: {
    label: "Liquidity",
    description: "Ranked by corporate cash position",
    isMoney: true,
  },
  fleet: { label: "Fleet Size", description: "Ranked by total aircraft count" },
  routes: { label: "Route Count", description: "Ranked by active route count" },
  brand: { label: "Brand Score", description: "Ranked by service reputation" },
  fleetValue: {
    label: "Fleet Value",
    description: "Ranked by depreciated fleet value",
    isMoney: true,
  },
  networkDistance: {
    label: "Network Distance",
    description: "Ranked by total route kilometers",
  },
};

function formatBrandScore(value: number) {
  return `${(value * 10).toFixed(1)}`;
}

function formatMetric(metric: LeaderboardMetric, value: number | FixedPoint) {
  if (metricMeta[metric].isMoney) return fpFormat(value as FixedPoint, 0);
  if (metric === "brand") return formatBrandScore(value);
  if (metric === "networkDistance") return `${value.toLocaleString()} km`;
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
  const profile = useNostrProfile(row.ceoPubkey);
  const npub = profile.npub;
  const displayName =
    profile.displayName ||
    profile.name ||
    `${row.ceoPubkey.slice(0, 8)}...${row.ceoPubkey.slice(-4)}`;
  const avatarLetter = displayName?.[0]?.toUpperCase() ?? "?";

  return (
    <div
      className={`flex items-center justify-between rounded-xl border px-4 py-3 transition ${isOwn ? "border-primary/40 bg-primary/10" : "border-border/50 bg-background/40 hover:bg-accent/10"}`}
    >
      <div className="flex flex-1 min-w-0 items-center gap-3">
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
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center font-mono text-sm font-black text-muted-foreground">
              {profile.isLoading ? "" : avatarLetter}
            </div>
          )}
        </a>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground truncate">{row.name}</span>
            {isOwn && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase text-primary">
                Your Airline
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {row.icaoCode} · {displayName}
            {profile.nip05 && (
              <span className="ml-2 rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
                {profile.nip05}
              </span>
            )}
            {!isOwn && profile.lud16 && (
              <a
                href={`lightning:${profile.lud16}`}
                className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-300"
              >
                Zap
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-3 sm:gap-6">
        {!isOwn && (
          <button
            type="button"
            onClick={() => onView(row.ceoPubkey)}
            className="rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground hover:border-primary/40 hover:text-foreground"
          >
            View As
          </button>
        )}
        <div className="hidden text-right text-xs text-muted-foreground sm:block">
          <div className="text-[10px] uppercase">Fleet</div>
          <div className="font-mono text-sm text-foreground">{row.fleet}</div>
        </div>
        <div className="hidden text-right text-xs text-muted-foreground sm:block">
          <div className="text-[10px] uppercase">Routes</div>
          <div className="font-mono text-sm text-foreground">{row.routes}</div>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-1 text-[10px] uppercase text-muted-foreground">
            {metricMeta[metric].label}
            {index === 0 ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
          </div>
          <div className="font-mono text-lg font-black text-foreground">
            {formatMetric(metric, value)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Leaderboard() {
  const competitors = useAirlineStore((s) => s.competitors);
  const airline = useAirlineStore((s) => s.airline);
  const fleetByOwner = useAirlineStore((s) => s.fleetByOwner);
  const routesByOwner = useAirlineStore((s) => s.routesByOwner);
  const viewAs = useAirlineStore((s) => s.viewAs);
  const currentTick = useEngineStore((s) => s.tick);
  const [metric, setMetric] = useState<LeaderboardMetric>("balance");

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

  return (
    <div className="flex h-full w-full flex-col">
      <div className="mb-6 flex items-center justify-between pr-10">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Trophy className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">Leaderboard</h2>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Multiplayer standings
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
          {metricMeta[metric].label}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(Object.keys(metricMeta) as LeaderboardMetric[]).map((key) => {
          const isActive = key === metric;
          return (
            <button
              key={key}
              onClick={() => setMetric(key)}
              type="button"
              className={`rounded-xl border px-4 py-3 text-left transition ${isActive ? "border-primary/40 bg-primary/10 text-primary" : "border-border/50 bg-background/40 text-muted-foreground hover:bg-accent/10 hover:text-foreground"}`}
            >
              <p className="text-[10px] uppercase font-semibold tracking-wider">
                {metricMeta[key].label}
              </p>
              <p className="text-[10px] text-muted-foreground/70">{metricMeta[key].description}</p>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        <div className="space-y-2">
          {rows.map((row, index) => {
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
              <LeaderboardRow
                key={row.id}
                row={row}
                index={index}
                isOwn={isOwn}
                metric={metric}
                value={value}
                onView={viewAs}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
