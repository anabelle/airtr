import type { AircraftInstance, Route } from "@acars/core";
import { calculateBookValue, computeRouteFrequency, fpFormat } from "@acars/core";
import { airports as AIRPORTS, getAircraftById } from "@acars/data";
import { FAMILY_ICONS } from "@acars/map";
import { useAirlineStore, useEngineStore } from "@acars/store";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Plane, Route as RouteIcon, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { AircraftLiveryImage } from "@/features/fleet/components/AircraftLiveryImage";
import { getAircraftTimer } from "@/features/fleet/utils/aircraftTimers";
import { navigateToAircraft, navigateToAirport } from "@/shared/lib/permalinkNavigation";

type AircraftInfoPanelProps = {
  aircraft: AircraftInstance;
  onClose: () => void;
};

type AircraftSearchParams = {
  aircraftTab?: "info" | "route";
};

const numberFormat = new Intl.NumberFormat("en-US");
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const airportIndex = new Map(AIRPORTS.map((a) => [a.iata, a]));

const statusConfig = {
  enroute: { label: "En Route", className: "bg-sky-500/20 text-sky-200" },
  turnaround: {
    label: "Turnaround",
    className: "bg-amber-400/20 text-amber-200",
  },
  idle: { label: "Idle", className: "bg-emerald-500/20 text-emerald-200" },
  maintenance: {
    label: "Maintenance",
    className: "bg-rose-500/20 text-rose-200",
  },
  delivery: { label: "Delivery", className: "bg-blue-500/20 text-blue-200" },
} as const;

function AircraftSilhouette({ familyId, className }: { familyId: string; className?: string }) {
  const svg = (FAMILY_ICONS[familyId] || FAMILY_ICONS["a320"]).body;
  const containerRef = useRef<HTMLDivElement>(null);

  const sanitizedSvg = svg
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/on\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .replace('fill="white"', 'fill="currentColor"');

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = sanitizedSvg;
    }
  }, [sanitizedSvg]);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
}

function ConditionBar({ condition }: { condition: number }) {
  const pct = Math.round(condition * 100);
  const color = pct >= 60 ? "bg-emerald-500" : pct >= 30 ? "bg-amber-400" : "bg-rose-500";

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-border/60 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono font-semibold text-foreground">{pct}%</span>
    </div>
  );
}

function FlightStrip({
  aircraft,
  timer,
  speedKmh,
}: {
  aircraft: AircraftInstance;
  timer: ReturnType<typeof getAircraftTimer>;
  speedKmh: number;
}) {
  const flight = aircraft.flight;
  if (!flight || !timer) return null;

  const isFerry = flight.purpose === "ferry";

  return (
    <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-mono font-bold text-foreground hover:text-primary transition-colors cursor-pointer"
            onClick={() => navigateToAirport(flight.originIata)}
          >
            {flight.originIata}
          </span>
          <div className="flex-1 flex items-center gap-1 text-muted-foreground">
            <div className="h-px flex-1 bg-sky-500/40" />
            <Plane className="h-3 w-3 text-sky-300" />
            <div className="h-px flex-1 bg-sky-500/40" />
          </div>
          <span
            className="text-sm font-mono font-bold text-foreground hover:text-primary transition-colors cursor-pointer"
            onClick={() => navigateToAirport(flight.destinationIata)}
          >
            {flight.destinationIata}
          </span>
        </div>
        {isFerry ? (
          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] uppercase tracking-widest font-semibold text-amber-200">
            Ferry
          </span>
        ) : null}
      </div>

      <div className="h-1.5 rounded-full bg-sky-900/40 overflow-hidden">
        <div
          className="h-full rounded-full bg-sky-400 transition-all"
          style={{ width: `${Math.round(timer.progress * 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          ETA <span className="font-mono font-semibold text-sky-200">{timer.time}</span>
        </span>
        <span>{numberFormat.format(speedKmh)} km/h</span>
        {flight.distanceKm ? <span>{numberFormat.format(flight.distanceKm)} km</span> : null}
      </div>
    </div>
  );
}

export function AircraftInfoPanel({ aircraft, onClose }: AircraftInfoPanelProps) {
  const navigate = useNavigate();
  const search = useSearch({ from: "__root__" });
  const { airline, fleet, routesByOwner, competitors } = useAirlineStore();
  const tick = useEngineStore((s) => s.tick);
  const tickProgress = useEngineStore((s) => s.tickProgress);

  const activeTab = search.aircraftTab === "route" ? "route" : "info";

  const setActiveTab = (newTab: "info" | "route") => {
    navigate({
      to: window.location.pathname,
      search: (prev: AircraftSearchParams) => ({
        ...prev,
        aircraftTab: newTab === "info" ? undefined : newTab,
      }),
    });
  };

  useEffect(() => {
    let armed = false;
    const timer = setTimeout(() => {
      armed = true;
    }, 300);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && armed) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    setActiveTab("info");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aircraft.id]);

  const model = getAircraftById(aircraft.modelId);
  const timer = getAircraftTimer(aircraft, tick, tickProgress);

  const bookValue = useMemo(() => {
    if (!model) return null;
    return calculateBookValue(
      model,
      aircraft.flightHoursTotal,
      aircraft.condition,
      aircraft.birthTick || aircraft.purchasedAtTick,
      tick,
    );
  }, [
    model,
    aircraft.flightHoursTotal,
    aircraft.condition,
    aircraft.birthTick,
    aircraft.purchasedAtTick,
    tick,
  ]);

  const isPlayerAircraft = airline?.ceoPubkey === aircraft.ownerPubkey;

  const ownerAirline = useMemo(() => {
    if (isPlayerAircraft) return airline;
    return competitors.get(aircraft.ownerPubkey) ?? null;
  }, [isPlayerAircraft, airline, competitors, aircraft.ownerPubkey]);

  const assignedRoute = useMemo((): Route | null => {
    if (!aircraft.assignedRouteId) return null;
    // Direct bucket lookup via owner pubkey when available
    const ownerRoutes = aircraft.ownerPubkey ? routesByOwner.get(aircraft.ownerPubkey) : undefined;
    if (ownerRoutes) {
      const match = ownerRoutes.find((r) => r.id === aircraft.assignedRouteId);
      if (match) return match;
    }
    // Fallback: scan all owners (e.g. if ownerPubkey is missing)
    for (const bucket of routesByOwner.values()) {
      if (bucket === ownerRoutes) continue; // already checked
      const match = bucket.find((r) => r.id === aircraft.assignedRouteId);
      if (match) return match;
    }
    return null;
  }, [aircraft.assignedRouteId, aircraft.ownerPubkey, routesByOwner]);

  const siblingsOnRoute = useMemo(() => {
    if (!assignedRoute || !isPlayerAircraft) return [];
    return fleet.filter((ac) => ac.assignedRouteId === assignedRoute.id && ac.id !== aircraft.id);
  }, [assignedRoute, fleet, isPlayerAircraft, aircraft.id]);

  const status = statusConfig[aircraft.status];
  const familyId = model?.familyId ?? "a320";

  return (
    <aside
      className="pointer-events-auto fixed z-30 flex flex-col w-[min(480px,calc(100vw-2rem))] max-h-[80vh] rounded-2xl border border-border bg-background/90 shadow-[0_30px_90px_rgba(0,0,0,0.65)] backdrop-blur-2xl overflow-hidden left-4 right-4 bottom-4 sm:left-auto sm:right-4 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2"
      aria-live="polite"
    >
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border/60 px-5 py-4">
        <div className="flex items-start gap-3 min-w-0">
          <AircraftSilhouette
            familyId={familyId}
            className="h-8 w-8 shrink-0 text-muted-foreground [&>svg]:h-full [&>svg]:w-full"
          />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Aircraft
            </p>
            <h3 className="text-lg font-bold text-foreground truncate">{aircraft.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {model ? (
                <span>
                  {model.manufacturer} {model.name}
                </span>
              ) : (
                <span className="font-mono">{aircraft.modelId}</span>
              )}
              {ownerAirline ? (
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{
                      backgroundColor: ownerAirline.livery?.primary ?? "#94a3b8",
                    }}
                    aria-hidden="true"
                  />
                  {ownerAirline.name}
                  {ownerAirline.icaoCode ? ` (${ownerAirline.icaoCode})` : ""}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-9 w-9 rounded-full bg-background/60 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors touch-manipulation shrink-0"
          aria-label="Close aircraft panel"
        >
          <X className="mx-auto h-4 w-4" />
        </button>
      </div>

      {/* Livery hero image */}
      {model ? (
        <div className="relative w-full overflow-hidden bg-zinc-900/40 h-56">
          <AircraftLiveryImage
            aircraft={aircraft}
            airline={ownerAirline}
            model={model}
            isOwner={isPlayerAircraft}
            objectFit="object-contain"
            fallback={
              <div className="absolute inset-0 flex items-center justify-center text-zinc-800/20 select-none">
                <AircraftSilhouette familyId={familyId} className="h-32 w-32 rotate-12" />
              </div>
            }
          />
        </div>
      ) : null}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-5">
        {/* Status badge */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] uppercase tracking-widest font-semibold ${status.className}`}
          >
            {status.label}
          </span>
          {model ? (
            <span className="rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
              {model.type}
            </span>
          ) : null}
          <span className="rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
            {aircraft.purchaseType === "lease" ? "Leased" : "Owned"}
          </span>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2 rounded-full border border-border/60 bg-background/70 p-1 text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
          {(
            [
              { key: "info", label: "Info" },
              { key: "route", label: "Route" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={
                activeTab === tab.key
                  ? "flex-1 rounded-full bg-foreground/10 px-3 py-1 text-foreground"
                  : "flex-1 rounded-full px-3 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "info" ? (
          <>
            {/* Live flight strip */}
            {aircraft.status === "enroute" && model ? (
              <FlightStrip aircraft={aircraft} timer={timer} speedKmh={model.speedKmh} />
            ) : null}

            {/* Timer for non-enroute states */}
            {timer && aircraft.status !== "enroute" ? (
              <div className="rounded-xl border border-border/60 bg-background/70 p-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{timer.label}</span>
                <span className="font-mono text-sm font-semibold text-foreground">
                  {timer.time}
                </span>
              </div>
            ) : null}

            {/* Specs grid */}
            {model ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Range
                  </p>
                  <p className="mt-1 text-sm font-mono font-semibold">
                    {numberFormat.format(model.rangeKm)} km
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Speed
                  </p>
                  <p className="mt-1 text-sm font-mono font-semibold">
                    {numberFormat.format(model.speedKmh)} km/h
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Capacity
                  </p>
                  <p className="mt-1 text-sm font-mono font-semibold">
                    {aircraft.configuration.economy > 0 ? `Y${aircraft.configuration.economy}` : ""}
                    {aircraft.configuration.business > 0
                      ? ` J${aircraft.configuration.business}`
                      : ""}
                    {aircraft.configuration.first > 0 ? ` F${aircraft.configuration.first}` : ""}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Fuel Burn
                  </p>
                  <p className="mt-1 text-sm font-mono font-semibold">
                    {numberFormat.format(model.fuelBurnKgPerHour)} kg/h
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                    MTOW
                  </p>
                  <p className="mt-1 text-sm font-mono font-semibold">
                    {numberFormat.format(model.maxTakeoffWeight)} kg
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Wingspan
                  </p>
                  <p className="mt-1 text-sm font-mono font-semibold">{model.wingspanM} m</p>
                </div>
              </div>
            ) : null}

            {/* Condition & maintenance */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                <Wrench className="h-4 w-4" />
                Condition & Maintenance
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                    <span>Airframe Condition</span>
                  </div>
                  <ConditionBar condition={aircraft.condition} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      Total Hours
                    </p>
                    <p className="mt-0.5 text-sm font-mono font-semibold">
                      {numberFormat.format(Math.round(aircraft.flightHoursTotal))}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      Since Check
                    </p>
                    <p className="mt-0.5 text-sm font-mono font-semibold">
                      {numberFormat.format(Math.round(aircraft.flightHoursSinceCheck))} hrs
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Economics */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                <Plane className="h-4 w-4" />
                Economics
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Purchase Price
                  </p>
                  <p className="mt-1 text-sm font-mono font-semibold">
                    {fpFormat(aircraft.purchasePrice, 0)}
                  </p>
                </div>
                {bookValue !== null ? (
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      Appraisal
                    </p>
                    <p className="mt-1 text-sm font-mono font-semibold">{fpFormat(bookValue, 0)}</p>
                  </div>
                ) : null}
                {model ? (
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      CASM
                    </p>
                    <p className="mt-1 text-sm font-mono font-semibold">
                      {fpFormat(model.casm, 4)}
                    </p>
                  </div>
                ) : null}
                {model ? (
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      Maint/hr
                    </p>
                    <p className="mt-1 text-sm font-mono font-semibold">
                      {fpFormat(model.maintCostPerHour, 0)}
                    </p>
                  </div>
                ) : null}
                {aircraft.purchaseType === "lease" && model ? (
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      Monthly Lease
                    </p>
                    <p className="mt-1 text-sm font-mono font-semibold">
                      {fpFormat(model.monthlyLease, 0)}
                    </p>
                  </div>
                ) : null}
                {aircraft.lastKnownLoadFactor !== undefined ? (
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      Last Load Factor
                    </p>
                    <p className="mt-1 text-sm font-mono font-semibold">
                      {Math.round(aircraft.lastKnownLoadFactor * 100)}%
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Base & assignment */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                <RouteIcon className="h-4 w-4" />
                Assignment
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Base
                  </p>
                  <p className="mt-1 text-sm font-mono font-semibold">
                    {aircraft.baseAirportIata ? (
                      <button
                        type="button"
                        onClick={() => navigateToAirport(aircraft.baseAirportIata)}
                        className="hover:text-primary transition-colors cursor-pointer"
                      >
                        {aircraft.baseAirportIata}
                      </button>
                    ) : (
                      "—"
                    )}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Route
                  </p>
                  <p className="mt-1 text-sm font-mono font-semibold">
                    {assignedRoute ? (
                      <>
                        <button
                          type="button"
                          onClick={() => navigateToAirport(assignedRoute.originIata)}
                          className="hover:text-primary transition-colors cursor-pointer"
                        >
                          {assignedRoute.originIata}
                        </button>
                        {" — "}
                        <button
                          type="button"
                          onClick={() => navigateToAirport(assignedRoute.destinationIata)}
                          className="hover:text-primary transition-colors cursor-pointer"
                        >
                          {assignedRoute.destinationIata}
                        </button>
                      </>
                    ) : (
                      "Unassigned"
                    )}
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Route tab */
          <RouteTab route={assignedRoute} siblings={siblingsOnRoute} aircraft={aircraft} />
        )}
      </div>
    </aside>
  );
}

function RouteTab({
  route,
  siblings,
  aircraft,
}: {
  route: Route | null;
  siblings: AircraftInstance[];
  aircraft: AircraftInstance;
}) {
  if (!route) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <RouteIcon className="h-8 w-8 mb-3 opacity-40" />
        <p className="text-sm font-semibold">No route assigned</p>
        <p className="text-xs mt-1">This aircraft is not currently operating a route.</p>
      </div>
    );
  }

  const originAirport = airportIndex.get(route.originIata);
  const destAirport = airportIndex.get(route.destinationIata);
  const acModel = getAircraftById(aircraft.modelId);
  const frequency = computeRouteFrequency(
    route.distanceKm,
    route.assignedAircraftIds.length,
    acModel?.speedKmh || 800,
    acModel?.turnaroundTimeMinutes || 35,
  );

  const getLocalTime = (tz: string | undefined) => {
    if (!tz) return null;
    try {
      return new Date().toLocaleTimeString("en-US", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return null;
    }
  };

  const getCountryName = (code: string | undefined) => {
    if (!code) return null;
    try {
      return regionNames.of(code) ?? code;
    } catch {
      return code;
    }
  };

  return (
    <div className="space-y-5">
      {/* Route header */}
      <div className="rounded-xl border border-border/60 bg-background/70 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="text-center min-w-0">
              <span
                className="text-lg font-mono font-bold text-foreground hover:text-primary transition-colors cursor-pointer"
                onClick={() => navigateToAirport(route.originIata)}
              >
                {route.originIata}
              </span>
              {originAirport ? (
                <p className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                  {originAirport.city}, {getCountryName(originAirport.country)}
                </p>
              ) : null}
              {originAirport?.timezone ? (
                <p className="text-[10px] font-mono text-muted-foreground/70">
                  {getLocalTime(originAirport.timezone)}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-1 text-muted-foreground shrink-0">
              <div className="h-px w-4 bg-border" />
              <Plane className="h-3 w-3" />
              <div className="h-px w-4 bg-border" />
            </div>
            <div className="text-center min-w-0">
              <span
                className="text-lg font-mono font-bold text-foreground hover:text-primary transition-colors cursor-pointer"
                onClick={() => navigateToAirport(route.destinationIata)}
              >
                {route.destinationIata}
              </span>
              {destAirport ? (
                <p className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                  {destAirport.city}, {getCountryName(destAirport.country)}
                </p>
              ) : null}
              {destAirport?.timezone ? (
                <p className="text-[10px] font-mono text-muted-foreground/70">
                  {getLocalTime(destAirport.timezone)}
                </p>
              ) : null}
            </div>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-widest font-semibold ${
              route.status === "active"
                ? "bg-emerald-500/20 text-emerald-200"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {route.status}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Distance
            </p>
            <p className="mt-0.5 text-sm font-mono font-semibold">
              {numberFormat.format(route.distanceKm)} km
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Frequency
            </p>
            <p className="mt-0.5 text-sm font-mono font-semibold">{frequency}x/wk</p>
          </div>
        </div>
      </div>

      {/* Fares */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
          Fares
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border/60 bg-background/70 p-3 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Economy
            </p>
            <p className="mt-1 text-sm font-mono font-semibold">{fpFormat(route.fareEconomy, 0)}</p>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/70 p-3 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Business
            </p>
            <p className="mt-1 text-sm font-mono font-semibold">
              {fpFormat(route.fareBusiness, 0)}
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/70 p-3 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              First
            </p>
            <p className="mt-1 text-sm font-mono font-semibold">{fpFormat(route.fareFirst, 0)}</p>
          </div>
        </div>
      </div>

      {/* Siblings on same route */}
      {siblings.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
            Other Aircraft on Route
          </p>
          <div className="space-y-1.5">
            {siblings.slice(0, 5).map((ac) => {
              const acModel = getAircraftById(ac.modelId);
              return (
                <div
                  key={ac.id}
                  className="flex items-center justify-between rounded-lg border border-border/40 bg-background/50 px-3 py-2 text-xs hover:border-primary/40 transition-colors cursor-pointer"
                  onClick={() => navigateToAircraft(ac.id)}
                >
                  <span className="font-semibold text-foreground">{ac.name}</span>
                  <span className="text-muted-foreground">
                    {acModel ? `${acModel.manufacturer} ${acModel.name}` : ac.modelId}
                  </span>
                </div>
              );
            })}
            {siblings.length > 5 ? (
              <p className="text-[11px] text-muted-foreground px-1">+{siblings.length - 5} more</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
