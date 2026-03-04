import {
  calculateBookValue,
  type FixedPoint,
  FP_ZERO,
  fp,
  fpFormat,
  fpScale,
  fpSub,
  fpToNumber,
  TICKS_PER_HOUR,
} from "@acars/core";
import { getAircraftById } from "@acars/data";
import { FAMILY_ICONS } from "@acars/map";
import { useActiveAirline, useAirlineStore, useEngineStore } from "@acars/store";
import {
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  PlusCircle,
  RotateCcw,
  Search,
  Settings,
  Tag,
  Trash2,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getRouteDemandSnapshot } from "@/features/network/hooks/useRouteDemand";
import { useConfirm } from "@/shared/lib/useConfirm";
import { navigateToAirport } from "@/shared/lib/permalinkNavigation";
import { getAircraftBaseHub } from "../utils/aircraftBaseHub";
import { getAircraftTimer } from "../utils/aircraftTimers";
import { AircraftDealer } from "./AircraftDealer";

const timerStyleMap = {
  enroute: {
    container: "border-sky-500/30 bg-sky-500/10 text-sky-200",
    label: "text-sky-200/70",
    time: "text-sky-100",
    glow: "shadow-[0_0_20px_rgba(56,189,248,0.35)]",
    icon: PlaneTakeoff,
  },
  turnaround: {
    container: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    label: "text-amber-200/70",
    time: "text-amber-100",
    glow: "shadow-[0_0_18px_rgba(251,191,36,0.35)]",
    icon: RotateCcw,
  },
  maintenance: {
    container: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    label: "text-rose-200/70",
    time: "text-rose-100",
    glow: "shadow-[0_0_18px_rgba(244,63,94,0.35)]",
    icon: Wrench,
  },
  delivery: {
    container: "border-blue-500/30 bg-blue-500/10 text-blue-200",
    label: "text-blue-200/70",
    time: "text-blue-100",
    glow: "shadow-[0_0_18px_rgba(59,130,246,0.35)]",
    icon: PlaneLanding,
  },
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

  return <div ref={containerRef} className={className} />;
}

export function FleetManager() {
  const { airline, fleet, routes, timeline, isViewingOther } = useActiveAirline();
  const {
    sellAircraft,
    buyoutAircraft,
    assignAircraftToRoute,
    listAircraft,
    cancelListing,
    ferryAircraft,
  } = useAirlineStore((state) => state);
  const { tick, tickProgress } = useEngineStore((state) => state);
  const [view, setView] = useState<"owned" | "dealer">("owned");
  const [search, setSearch] = useState("");
  const confirm = useConfirm();
  const routeDemandIndex = useMemo(
    () =>
      new Map(
        routes.map((route) => [route.id, getRouteDemandSnapshot(route, tick, fleet, routes)]),
      ),
    [routes, tick, fleet],
  );
  const [listingTarget, setListingTarget] = useState<{
    aircraftId: string;
    name: string;
    marketVal: FixedPoint;
    maxPrice: FixedPoint;
  } | null>(null);
  const [listingPrice, setListingPrice] = useState("");
  const [listingError, setListingError] = useState<string | null>(null);
  const [isListing, setIsListing] = useState(false);
  const [ferryTargets, setFerryTargets] = useState<Record<string, string>>({});
  const minListingPrice = fp(1000);

  useEffect(() => {
    if (isViewingOther && view === "dealer") {
      setView("owned");
    }
  }, [isViewingOther, view]);

  if (view === "dealer") {
    return (
      <div className="flex flex-col h-full w-full">
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setView("owned")}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors"
          >
            &larr; Back to My Fleet
          </button>
        </div>
        <div className="flex-1 overflow-hidden min-h-0">
          <AircraftDealer onPurchaseSuccess={() => setView("owned")} />
        </div>
      </div>
    );
  }

  const filteredFleet = fleet.filter(
    (f) =>
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.modelId.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSubmitListing = async () => {
    if (!listingTarget) return;
    const priceNum = Number(listingPrice);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setListingError("Enter a valid positive price.");
      return;
    }

    const priceFp = fp(priceNum);
    if (priceFp < minListingPrice) {
      setListingError(`Minimum allowed is ${fpFormat(minListingPrice)}.`);
      return;
    }
    if (priceFp > listingTarget.maxPrice) {
      setListingError(`Maximum allowed is ${fpFormat(listingTarget.maxPrice)}.`);
      return;
    }

    setListingError(null);
    setIsListing(true);
    try {
      await listAircraft(listingTarget.aircraftId, priceFp);
      setListingTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Listing failed", {
        description: message,
      });
    } finally {
      setIsListing(false);
    }
  };

  const listingPriceNum = Number(listingPrice);
  const listingPriceFp = Number.isFinite(listingPriceNum) ? fp(listingPriceNum) : null;
  const listingFeeFp = listingPriceFp ? fpScale(listingPriceFp, 0.005) : null;

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between rounded-2xl bg-card border border-border/40 p-4 shadow-sm backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div className="relative flex items-center flex-1 sm:w-[300px]">
            <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
            <input
              className="h-10 w-full rounded-xl bg-background border border-border/50 pl-10 pr-4 text-sm transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground outline-none"
              placeholder="Search active fleet..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {!isViewingOther && (
          <button
            type="button"
            onClick={() => setView("dealer")}
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold shadow-lg shadow-primary/25 hover:scale-[1.02] transition-all active:scale-95"
          >
            <PlusCircle className="h-4 w-4" />
            Purchase Aircraft
          </button>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-10">
        {fleet.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-border/50 rounded-2xl bg-card/10">
            <Plane className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
            <p className="text-xl font-semibold text-foreground mb-2">Your hangar is empty</p>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm text-center">
              You haven't purchased any aircraft yet. Hit the global marketplace to acquire your
              first plane and start flying routes.
            </p>
            <button
              type="button"
              onClick={() => setView("dealer")}
              className="rounded-xl bg-primary text-primary-foreground px-6 py-2.5 text-sm font-bold shadow-lg shadow-primary/20 hover:scale-105 transition-transform"
            >
              Open Global Marketplace
            </button>
          </div>
        ) : filteredFleet.length === 0 ? (
          <div className="py-20 text-center flex flex-col items-center">
            <p className="text-muted-foreground">No aircraft found matching "{search}".</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            {filteredFleet.map((ac) => {
              const model = getAircraftById(ac.modelId);
              if (!model) return null;

              const marketVal = calculateBookValue(
                model,
                ac.flightHoursTotal,
                ac.condition,
                ac.birthTick || ac.purchasedAtTick,
                tick,
              );
              const scrapVal = fpScale(marketVal, 0.7);
              const timer = getAircraftTimer(ac, tick, tickProgress);
              const timerStyle = timer ? timerStyleMap[timer.kind] : null;
              const isAssignmentLocked = ac.status === "enroute";
              const isScrapLocked = ac.status !== "idle";
              const baseHub = getAircraftBaseHub(ac, routes, airline);

              return (
                <div
                  key={ac.id}
                  className="group relative flex flex-col rounded-3xl border border-border/50 bg-card overflow-hidden shadow-sm hover:shadow-xl hover:border-primary/30 transition-all duration-300"
                >
                  <div className="relative h-40 bg-zinc-900/40 p-6 perspective-1000 overflow-hidden">
                    <div className="absolute top-4 right-4 z-10 flex gap-2 items-center">
                      {ac.listingPrice && (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-3 py-1 text-[10px] font-black uppercase tracking-widest">
                          For Sale: {fpFormat(ac.listingPrice, 0)}
                        </span>
                      )}
                      {timer && timerStyle ? (
                        <span
                          className={`relative inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest overflow-hidden ${timerStyle.container} ${timer.isImminent ? `animate-pulse ${timerStyle.glow}` : ""} shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]`}
                        >
                          <span
                            className="absolute inset-y-0 left-0 opacity-90"
                            style={{
                              width: `${Math.round(timer.progress * 100)}%`,
                              background:
                                "linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.08))",
                            }}
                          />
                          <span className="absolute inset-0 rounded-full ring-1 ring-white/10" />
                          <span className="relative z-10 flex items-center gap-2">
                            <timerStyle.icon className="h-3 w-3" />
                            <span className="text-white/90 drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
                              {timer.label}
                            </span>
                            <span
                              className={`font-mono text-[10px] font-black drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)] ${timerStyle.time}`}
                            >
                              {timer.time}
                            </span>
                          </span>
                        </span>
                      ) : (
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${ac.status === "idle"
                            ? ac.assignedRouteId
                              ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                              : "bg-primary/20 text-primary border border-primary/30"
                            : "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                            }`}
                        >
                          {ac.status === "idle" && ac.assignedRouteId ? "assigned" : ac.status}
                        </span>
                      )}
                    </div>

                    <div className="absolute -bottom-6 -right-6 text-zinc-800/20 select-none">
                      <AircraftSilhouette
                        familyId={model.familyId}
                        className="h-48 w-48 rotate-12"
                      />
                    </div>

                    <div className="relative z-10 flex flex-col h-full justify-end">
                      <h3 className="text-xl font-black tracking-tighter text-foreground group-hover:text-primary transition-colors">
                        {ac.name}
                      </h3>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                        {model.manufacturer} <span className="text-accent">{model.name}</span>
                      </p>
                    </div>
                  </div>

                  <div className="p-4 sm:p-6 pt-3 sm:pt-4 flex flex-col space-y-4">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                      <div>
                        <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">
                          Registry ID
                        </p>
                        <p className="font-mono text-xs text-foreground font-bold">
                          {ac.id.toUpperCase()}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">
                          Current Location
                        </p>
                        <p className="font-mono text-xs text-foreground font-bold">
                          {ac.status === "enroute" && ac.flight ? (
                            <>
                              Enroute:{" "}
                              <button type="button" onClick={() => navigateToAirport(ac.flight!.originIata)} className="hover:text-primary transition-colors cursor-pointer">{ac.flight.originIata}</button>
                              {" → "}
                              <button type="button" onClick={() => navigateToAirport(ac.flight!.destinationIata)} className="hover:text-primary transition-colors cursor-pointer">{ac.flight.destinationIata}</button>
                            </>
                          ) : ac.status === "delivery" ? (
                            <>
                              Delivery to{" "}
                              <button type="button" onClick={() => navigateToAirport(ac.baseAirportIata)} className="hover:text-primary transition-colors cursor-pointer">{ac.baseAirportIata}</button>
                            </>
                          ) : (
                            <>
                              At{" "}
                              <button type="button" onClick={() => navigateToAirport(ac.baseAirportIata)} className="hover:text-primary transition-colors cursor-pointer">{ac.baseAirportIata}</button>
                            </>
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">
                          Base Hub
                        </p>
                        <p className="font-mono text-xs text-accent font-bold">
                          <button type="button" onClick={() => navigateToAirport(baseHub)} className="hover:text-primary transition-colors cursor-pointer">{baseHub}</button>
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">
                          Condition
                        </p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-accent/20 overflow-hidden">
                            <div
                              className={`h-full transition-all duration-500 ${ac.condition > 0.8 ? "bg-primary" : ac.condition > 0.5 ? "bg-yellow-500" : "bg-red-500"}`}
                              style={{ width: `${Math.round(ac.condition * 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-[10px] font-bold">
                            {(ac.condition * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">
                          Flight Hours
                        </p>
                        <p className="font-mono text-xs">{ac.flightHoursTotal.toLocaleString()}h</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-1 flex justify-between">
                          <span>Maintenance Debt</span>
                          <span
                            className={
                              ac.condition < 0.3 ? "text-red-400" : "text-muted-foreground"
                            }
                          >
                            Grounding at 20%
                          </span>
                        </p>
                        <div className="h-1.5 w-full bg-muted/30 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${ac.condition < 0.3 ? "bg-red-500" : "bg-primary"}`}
                            style={{ width: `${Math.max(0, ((ac.condition - 0.2) / 0.8) * 100)}%` }}
                          />
                        </div>
                      </div>
                      {ac.purchasePrice && (
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">
                            Purchased For
                          </p>
                          <p className="font-mono text-xs">{fpFormat(ac.purchasePrice, 0)}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">
                          {ac.purchaseType === "lease" ? "Buyout Price" : "Appraisal"}
                        </p>
                        <p className="font-mono text-xs text-emerald-400">
                          {fpFormat(marketVal, 0)}
                        </p>
                      </div>
                      {ac.purchaseType === "lease" && (
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">
                            Monthly Lease
                          </p>
                          <p className="font-mono text-xs text-rose-400">
                            {fpFormat(model.monthlyLease, 0)}/mo
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Performance Section */}
                    {(() => {
                      const lastLanding = [...timeline]
                        .reverse()
                        .find((e) => e.type === "landing" && e.aircraftId === ac.id);

                      if (!lastLanding) return null;

                      const flightProfit = lastLanding.profit || FP_ZERO;

                      // For leased aircraft, amortize lease cost into per-flight profit
                      const flightDurationTicks = lastLanding.details?.flightDurationTicks ?? 0;
                      const flightHours = flightDurationTicks / TICKS_PER_HOUR;
                      const isLeased = ac.purchaseType === "lease";
                      const leasePerHour = isLeased
                        ? fpToNumber(model.monthlyLease) / (30 * 24)
                        : 0;
                      const leaseForFlight = fp(leasePerHour * flightHours);
                      const trueProfit = isLeased
                        ? fpSub(flightProfit, leaseForFlight)
                        : flightProfit;

                      const isProfitable = trueProfit > 0;
                      const pax = lastLanding.details?.passengers;
                      const lf = lastLanding.details?.loadFactor;

                      return (
                        <div className="bg-muted/20 rounded-2xl p-4 border border-border/40">
                          <div className="flex justify-between items-center mb-3">
                            <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">
                              Last Flight Outcome
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${isProfitable ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}
                            >
                              {isProfitable ? "Profitable" : "Loss Making"}
                            </span>
                          </div>

                          {/* Route & Profit */}
                          <div className="flex justify-between items-end mb-3">
                            <div className="flex flex-col">
                              <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                                Route
                              </span>
                              <span className="text-xs font-bold text-foreground">
                                <button type="button" onClick={() => navigateToAirport(lastLanding.originIata!)} className="hover:text-primary transition-colors cursor-pointer">{lastLanding.originIata}</button>
                                {" → "}
                                <button type="button" onClick={() => navigateToAirport(lastLanding.destinationIata!)} className="hover:text-primary transition-colors cursor-pointer">{lastLanding.destinationIata}</button>
                              </span>
                            </div>
                            <div className="flex flex-col text-right">
                              <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                                {isLeased ? "True Profit" : "Net Profit"}
                              </span>
                              <span
                                className={`text-sm font-mono font-bold ${isProfitable ? "text-emerald-400" : "text-red-400"}`}
                              >
                                {fpFormat(trueProfit, 0)}
                              </span>
                              {isLeased && (
                                <span className="text-[9px] font-mono text-muted-foreground/60">
                                  incl. {fpFormat(leaseForFlight, 0)} lease
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Passenger & Occupancy Data */}
                          {pax && lf !== undefined && (
                            <div className="pt-3 border-t border-border/30">
                              {/* Load Factor Bar */}
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                                  Load Factor
                                </span>
                                <span
                                  className={`text-[10px] font-mono font-black ${lf >= 0.85
                                    ? "text-emerald-400"
                                    : lf >= 0.6
                                      ? "text-yellow-400"
                                      : "text-red-400"
                                    }`}
                                >
                                  {Math.round(lf * 100)}%
                                </span>
                              </div>
                              <div className="h-1 w-full bg-muted/30 rounded-full overflow-hidden mb-3">
                                <div
                                  className={`h-full rounded-full transition-all ${lf >= 0.85
                                    ? "bg-emerald-500"
                                    : lf >= 0.6
                                      ? "bg-yellow-500"
                                      : "bg-red-500"
                                    }`}
                                  style={{ width: `${Math.round(lf * 100)}%` }}
                                />
                              </div>

                              {/* Class Breakdown */}
                              <div className="flex items-center gap-3 text-[10px] font-mono">
                                <span className="text-muted-foreground">
                                  <span className="text-foreground font-bold">{pax.total}</span> pax
                                </span>
                                <span className="text-muted-foreground/40">|</span>
                                <span className="text-muted-foreground">
                                  Y:<span className="text-foreground font-bold">{pax.economy}</span>
                                </span>
                                {pax.business > 0 && (
                                  <span className="text-amber-400/70">
                                    J:
                                    <span className="text-amber-400 font-bold">{pax.business}</span>
                                  </span>
                                )}
                                {pax.first > 0 && (
                                  <span className="text-violet-400/70">
                                    F:<span className="text-violet-400 font-bold">{pax.first}</span>
                                  </span>
                                )}
                                {(lastLanding.details?.spilledPassengers ?? 0) > 0 && (
                                  <span className="text-orange-400 ml-auto font-bold">
                                    {lastLanding.details!.spilledPassengers} denied
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    <div className="h-px w-full bg-border/50 mb-2" />

                    <div className="flex flex-col gap-3">
                      {ac.status !== "delivery" && !isViewingOther && (
                        <div className="flex flex-col gap-1.5">
                          <p className="text-[10px] uppercase text-muted-foreground font-bold tracking-widest pl-1">
                            Route Assignment
                          </p>
                          <div className="flex gap-2">
                            <select
                              className="flex-1 bg-background border border-border/50 rounded-xl px-3 py-2 text-xs font-bold outline-none ring-primary/20 focus:ring-2 focus:border-primary/50 transition-all appearance-none cursor-pointer"
                              value={ac.assignedRouteId || ""}
                              disabled={isAssignmentLocked}
                              title={
                                isAssignmentLocked
                                  ? "Route changes are locked while enroute."
                                  : undefined
                              }
                              onChange={async (e) => {
                                try {
                                  await assignAircraftToRoute(ac.id, e.target.value || null);
                                } catch (err) {
                                  const message =
                                    err instanceof Error ? err.message : "Unknown error";
                                  toast.error("Assignment failed", {
                                    description: message,
                                  });
                                }
                              }}
                            >
                              <option value="">Unassigned (Idle)</option>
                              {routes
                                .filter((r) =>
                                  [r.originIata, r.destinationIata].includes(ac.baseAirportIata),
                                )
                                .map((r) => {
                                  const isOutOfRange = r.distanceKm > model.rangeKm;
                                  const routeDemand = routeDemandIndex.get(r.id);
                                  const effectiveLoadFactor =
                                    routeDemand?.effectiveLoadFactor ??
                                    routeDemand?.pressureMultiplier ??
                                    0;
                                  const loadFactor = Math.round(effectiveLoadFactor * 100);
                                  const healthLabel =
                                    loadFactor >= 80
                                      ? "Healthy"
                                      : loadFactor >= 60
                                        ? "Caution"
                                        : "Oversupplied";
                                  return (
                                    <option
                                      key={r.id}
                                      value={r.id}
                                      className={isOutOfRange ? "text-muted-foreground" : ""}
                                    >
                                      {r.originIata} &rarr; {r.destinationIata} ({r.distanceKm}km) —{" "}
                                      {loadFactor}% {healthLabel}{" "}
                                      {isOutOfRange ? " — [OUT OF RANGE]" : ""}
                                    </option>
                                  );
                                })}
                            </select>
                            {ac.assignedRouteId && (
                              <button
                                type="button"
                                onClick={() => assignAircraftToRoute(ac.id, null)}
                                className={`px-3 py-2 rounded-xl border transition-all ${isAssignmentLocked ? "bg-muted/20 text-muted-foreground border-border/50 cursor-not-allowed" : "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500"}`}
                                title={
                                  isAssignmentLocked
                                    ? "Route changes are locked while enroute."
                                    : "Unassign Route"
                                }
                                disabled={isAssignmentLocked}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2 mt-1 w-full">
                        <button
                          type="button"
                          onClick={() => {
                            if (isScrapLocked) return;
                            const isLease = ac.purchaseType === "lease";
                            const title = isLease
                              ? "Return leased aircraft?"
                              : "Instant scrap aircraft?";
                            const description = isLease
                              ? `Return ${ac.name} to the lessor. This action cannot be undone.`
                              : `Scrap ${ac.name} for ${fpFormat(scrapVal)}. 30% liquidity penalty applies.`;
                            confirm({
                              title,
                              description,
                              confirmLabel: isLease ? "Return" : "Scrap",
                              cancelLabel: "Cancel",
                              tone: "destructive",
                            }).then(async (approved: boolean) => {
                              if (!approved) return;
                              try {
                                await sellAircraft(ac.id);
                              } catch (err) {
                                const message =
                                  err instanceof Error ? err.message : "Unknown error";
                                toast.error("Scrap failed", { description: message });
                              }
                            });
                          }}
                          className={`flex items-center justify-center p-2 rounded-lg border transition-all ${isScrapLocked ? "bg-muted/20 text-muted-foreground border-border/50 cursor-not-allowed" : "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white"}`}
                          title={
                            isScrapLocked ? "Scrap only available while idle." : "Instant Scrap"
                          }
                          disabled={isScrapLocked}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>

                        {ac.status === "idle" &&
                          !ac.assignedRouteId &&
                          airline &&
                          airline.hubs.length > 0 && (
                            <div className="flex-1 flex items-center gap-2">
                              <select
                                value={ferryTargets[ac.id] ?? ""}
                                onChange={(e) =>
                                  setFerryTargets((prev) => ({ ...prev, [ac.id]: e.target.value }))
                                }
                                className="h-9 rounded-lg border border-border/50 bg-background px-2 text-[10px] font-bold uppercase text-foreground"
                              >
                                <option value="" disabled>
                                  Select hub
                                </option>
                                {airline.hubs
                                  .filter((hub) => hub !== ac.baseAirportIata)
                                  .map((hub) => (
                                    <option key={hub} value={hub}>
                                      {hub}
                                    </option>
                                  ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => {
                                  const targetHub = ferryTargets[ac.id];
                                  if (!targetHub) return;
                                  confirm({
                                    title: "Ferry aircraft?",
                                    description: `Ferry ${ac.name} to ${targetHub}. This is a reposition flight with no passengers.`,
                                    confirmLabel: "Ferry",
                                    cancelLabel: "Cancel",
                                  }).then(async (approved: boolean) => {
                                    if (!approved) return;
                                    try {
                                      await ferryAircraft(ac.id, targetHub);
                                    } catch (err) {
                                      const message =
                                        err instanceof Error ? err.message : "Ferry failed";
                                      toast.error("Ferry failed", { description: message });
                                    }
                                  });
                                }}
                                className="flex-1 flex items-center justify-center gap-2 p-2 rounded-lg bg-sky-500/20 border border-sky-500/30 text-sky-300 hover:bg-sky-500 hover:text-white transition-all overflow-hidden"
                              >
                                <Plane className="h-4 w-4 shrink-0" />
                                <span className="text-[10px] font-bold uppercase truncate">
                                  Ferry to Hub
                                </span>
                              </button>
                            </div>
                          )}

                        {!isViewingOther &&
                          (!ac.purchaseType || ac.purchaseType === "buy" ? (
                            ac.listingPrice ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await cancelListing(ac.id);
                                  } catch (err) {
                                    const message =
                                      err instanceof Error ? err.message : "Unknown error";
                                    toast.error("Cancellation failed", {
                                      description: message,
                                    });
                                  }
                                }}
                                className="flex-1 flex items-center justify-center gap-2 p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all overflow-hidden"
                              >
                                <XCircle className="h-4 w-4 shrink-0" />
                                <span className="text-[10px] font-bold uppercase truncate">
                                  Cancel Listing
                                </span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  const marketVal = calculateBookValue(
                                    model,
                                    ac.flightHoursTotal,
                                    ac.condition,
                                    ac.birthTick || ac.purchasedAtTick,
                                    tick,
                                  );
                                  const msrp = calculateBookValue(model, 0, 1, tick, tick);
                                  const maxPriceFp = fpScale(msrp, 1.2) as FixedPoint;
                                  setListingTarget({
                                    aircraftId: ac.id,
                                    name: ac.name,
                                    marketVal,
                                    maxPrice: maxPriceFp,
                                  });
                                  setListingPrice(fpToNumber(marketVal).toString());
                                  setListingError(null);
                                }}
                                className="flex-1 flex items-center justify-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all shadow-sm"
                              >
                                <Tag className="h-4 w-4 shrink-0" />
                                <span className="text-[10px] font-bold uppercase">
                                  List for Sale
                                </span>
                              </button>
                            )
                          ) : (
                            ac.purchaseType === "lease" && (
                              <button
                                type="button"
                                onClick={() => {
                                  confirm({
                                    title: "Buyout lease?",
                                    description: `Purchase ${ac.name} for ${fpFormat(marketVal)} to convert the lease to ownership.`,
                                    confirmLabel: "Buyout",
                                    cancelLabel: "Cancel",
                                    tone: "default",
                                  }).then(async (approved: boolean) => {
                                    if (!approved) return;
                                    try {
                                      await buyoutAircraft(ac.id);
                                    } catch (err) {
                                      const message =
                                        err instanceof Error ? err.message : "Unknown error";
                                      toast.error("Buyout failed", { description: message });
                                    }
                                  });
                                }}
                                className="flex-1 flex items-center justify-center gap-2 p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 hover:bg-orange-500 hover:text-white transition-all"
                              >
                                <PlusCircle className="h-4 w-4" />
                                <span className="text-[10px] font-bold uppercase">
                                  Buyout Lease
                                </span>
                              </button>
                            )
                          ))}

                        <button
                          type="button"
                          className="p-2 rounded-lg bg-background border border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-all"
                        >
                          <Settings className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {listingTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !isListing && setListingTarget(null)}
            aria-label="Close listing modal"
          />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-background/95 shadow-[0_20px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
            <div className="flex items-start justify-between border-b border-border/50 px-6 py-5">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                  Marketplace Listing
                </p>
                <h3 className="text-lg font-bold text-foreground">List {listingTarget.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => !isListing && setListingTarget(null)}
                className="rounded-full bg-background/60 p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl border border-border/50 bg-background/60 p-3">
                  <p className="text-[10px] uppercase text-muted-foreground font-semibold">
                    Appraisal
                  </p>
                  <p className="text-sm font-bold text-foreground mt-1">
                    {fpFormat(listingTarget.marketVal)}
                  </p>
                </div>
                <div className="rounded-xl border border-border/50 bg-background/60 p-3">
                  <p className="text-[10px] uppercase text-muted-foreground font-semibold">
                    Max Allowed
                  </p>
                  <p className="text-sm font-bold text-foreground mt-1">
                    {fpFormat(listingTarget.maxPrice)}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-border/50 bg-background/60 p-4">
                <label
                  htmlFor="listing-price"
                  className="text-[10px] uppercase text-muted-foreground font-semibold"
                >
                  Listing Price
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="listing-price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={listingPrice}
                    onChange={(e) => setListingPrice(e.target.value)}
                    className="h-10 w-full rounded-lg bg-background border border-border/50 px-3 text-sm font-medium outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                  />
                  <div className="rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                    USD
                  </div>
                </div>
                {listingError ? (
                  <p className="mt-2 text-xs font-semibold text-red-400">{listingError}</p>
                ) : null}
              </div>

              <div className="rounded-xl border border-border/50 bg-background/60 p-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Listing fee (0.5%)</span>
                  <span className="font-mono font-bold text-foreground">
                    {listingFeeFp ? fpFormat(listingFeeFp) : "--"}
                  </span>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  The listing fee is non-refundable and will be deducted immediately.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border/50 px-6 py-4">
              <button
                type="button"
                onClick={() => setListingTarget(null)}
                disabled={isListing}
                className="rounded-lg border border-border bg-background/70 px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitListing}
                disabled={isListing}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
              >
                {isListing ? "Listing..." : "List aircraft"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
