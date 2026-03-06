import {
  type Airport,
  calculateDemand,
  calculatePriceElasticity,
  calculateShares,
  canonicalRouteKey,
  computeRouteFrequency,
  type FixedPoint,
  type FlightOffer,
  fp,
  fpAdd,
  fpFormat,
  fpScale,
  fpToNumber,
  getProsperityIndex,
  getSeason,
  getSuggestedFares,
  haversineDistance,
  NATURAL_LF_CEILING,
  PRICE_ELASTICITY_BUSINESS,
  PRICE_ELASTICITY_ECONOMY,
  PRICE_ELASTICITY_FIRST,
  ROUTE_SLOT_FEE,
  type Season,
  scaleToAddressableMarket,
} from "@acars/core";
import { airports as ALL_AIRPORTS, HUB_CLASSIFICATIONS } from "@acars/data";
import { useActiveAirline, useAirlineStore, useEngineStore } from "@acars/store";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { navigateToAirport } from "@/shared/lib/permalinkNavigation";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Globe,
  MapPin,
  PlusCircle,
  Search,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getRouteDemandSnapshot } from "@/features/network/hooks/useRouteDemand";
import { useConfirm } from "@/shared/lib/useConfirm";

const toneDotClass = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
} as const;

const toneTextClass = {
  emerald: "text-emerald-400",
  amber: "text-amber-400",
  rose: "text-rose-400",
  muted: "text-muted-foreground",
} as const;

const getFareTone = (actual: FixedPoint, suggested: FixedPoint) => {
  const actualValue = fpToNumber(actual);
  const suggestedValue = fpToNumber(suggested);
  if (suggestedValue <= 0) return null;
  const ratio = actualValue / suggestedValue;
  if (ratio <= 1) return "emerald" as const;
  if (ratio <= 1.2) return null;
  if (ratio <= 1.5) return "amber" as const;
  return "rose" as const;
};

const getElasticityTone = (multiplier: number) => {
  if (multiplier >= 0.85) return "emerald" as const;
  if (multiplier >= 0.6) return "amber" as const;
  return "rose" as const;
};

const formatSignedPercent = (value: number) => {
  const signed = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${signed}${Math.abs(value).toFixed(0)}%`;
};

const parseFareInput = (value: string) => {
  const parsed = parseInt(value.replace(/[^0-9]/g, ""), 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const calculateElasticityDisplay = (
  actualFare: FixedPoint,
  referenceFare: FixedPoint,
  elasticity: number,
) => {
  const multiplier = calculatePriceElasticity(actualFare, referenceFare, elasticity);
  const referenceValue = fpToNumber(referenceFare);
  const actualValue = fpToNumber(actualFare);
  const ratio = referenceValue > 0 ? actualValue / referenceValue : 1;
  const deltaPercent = referenceValue > 0 ? (ratio - 1) * 100 : 0;
  return { multiplier, deltaPercent };
};

export function RouteManager() {
  const { airline, routes, fleet, isViewingOther } = useActiveAirline();
  const {
    pubkey,
    openRoute,
    updateRouteFares,
    rebaseRoute,
    closeRoute,
    globalRouteRegistry,
    competitors,
  } = useAirlineStore();
  const confirm = useConfirm();
  const { homeAirport, tick } = useEngineStore();
  const { tab } = useSearch({ from: "/network" });
  const navigate = useNavigate({ from: "/network" });
  const setTab = (newTab: "active" | "opportunities") => {
    navigate({ search: { tab: newTab } });
  };
  const [fareEditor, setFareEditor] = useState<{
    routeId: string;
    originIata: string;
    destinationIata: string;
    distanceKm: number;
  } | null>(null);
  const [fareInputs, setFareInputs] = useState<{ e: string; b: string; f: string }>({
    e: "",
    b: "",
    f: "",
  });
  const [fareError, setFareError] = useState<string | null>(null);
  const [isSavingFares, setIsSavingFares] = useState(false);
  const [openingRouteIata, setOpeningRouteIata] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [rebaseTargets, setRebaseTargets] = useState<Record<string, string>>({});
  const [planningOriginIata, setPlanningOriginIata] = useState<string | null>(
    airline?.hubs?.[0] ?? null,
  );

  const airportIndex = useMemo(
    () => new Map(ALL_AIRPORTS.map((airport) => [airport.iata, airport])),
    [],
  );

  useEffect(() => {
    if (!airline?.hubs?.length) return;
    if (!planningOriginIata || !airline.hubs.includes(planningOriginIata)) {
      setPlanningOriginIata(airline.hubs[0]);
    }
  }, [airline?.hubs, planningOriginIata]);

  const planningOriginAirport = useMemo(() => {
    if (planningOriginIata) {
      return airportIndex.get(planningOriginIata) ?? null;
    }
    if (airline?.hubs?.length) {
      return airportIndex.get(airline.hubs[0]) ?? null;
    }
    return homeAirport;
  }, [planningOriginIata, airline?.hubs, airportIndex, homeAirport]);

  const searchResults = useMemo(() => {
    if (searchQuery.length < 2) return [];
    const query = searchQuery.toLowerCase();
    return ALL_AIRPORTS.filter(
      (airport) =>
        airport.iata !== planningOriginAirport?.iata &&
        (airport.iata?.toLowerCase().includes(query) ||
          airport.icao?.toLowerCase().includes(query) ||
          airport.city?.toLowerCase().includes(query) ||
          airport.name?.toLowerCase().includes(query)),
    ).slice(0, 5);
  }, [searchQuery, planningOriginAirport?.iata]);

  type ProspectMarket = {
    origin: Airport;
    destination: Airport;
    distance: number;
    demand: { economy: number; business: number; first: number };
    estimatedDailyRevenue: FixedPoint;
    season: Season;
  };

  const calculateSearchProspect = useCallback(
    (dest: Airport): ProspectMarket | null => {
      if (!planningOriginAirport) return null;
      const now = new Date();
      const prosperity = getProsperityIndex(tick);
      const season = getSeason(dest.latitude, now);
      const distance = haversineDistance(
        planningOriginAirport.latitude,
        planningOriginAirport.longitude,
        dest.latitude,
        dest.longitude,
      );
      const demand = calculateDemand(planningOriginAirport, dest, season, prosperity, 1.0);
      const fares = getSuggestedFares(distance);
      const estimatedDailyRevenue = fpAdd(
        fpAdd(
          fpScale(fares.economy, demand.economy / 7),
          fpScale(fares.business, demand.business / 7),
        ),
        fpScale(fares.first, demand.first / 7),
      );
      return {
        origin: planningOriginAirport,
        destination: dest,
        distance,
        demand,
        estimatedDailyRevenue,
        season,
      };
    },
    [planningOriginAirport, tick],
  );

  const buildProspects = useCallback(
    (origin: Airport | null): ProspectMarket[] => {
      if (!origin) return [];
      const now = new Date();
      const prosperity = getProsperityIndex(tick);
      const others = ALL_AIRPORTS.filter((a) => a.iata !== origin.iata)
        .map((a) => ({
          airport: a,
          distance: haversineDistance(origin.latitude, origin.longitude, a.latitude, a.longitude),
        }))
        .sort((a, b) => a.distance - b.distance);

      const picks: Airport[] = [];
      if (others.length >= 2) picks.push(others[0].airport, others[1].airport);
      const midIdx = Math.floor(others.length * 0.4);
      const midIdx2 = Math.floor(others.length * 0.5);
      if (others.length >= 6) picks.push(others[midIdx].airport, others[midIdx2].airport);
      if (others.length >= 4)
        picks.push(others[others.length - 2].airport, others[others.length - 1].airport);

      return picks.map((dest) => {
        const season = getSeason(dest.latitude, now);
        const distance = haversineDistance(
          origin.latitude,
          origin.longitude,
          dest.latitude,
          dest.longitude,
        );
        const demand = calculateDemand(origin, dest, season, prosperity, 1.0);
        const fares = getSuggestedFares(distance);
        const estimatedDailyRevenue = fpAdd(
          fpAdd(
            fpScale(fares.economy, demand.economy / 7),
            fpScale(fares.business, demand.business / 7),
          ),
          fpScale(fares.first, demand.first / 7),
        );
        return { origin, destination: dest, distance, demand, estimatedDailyRevenue, season };
      });
    },
    [tick],
  );

  const prospectMarkets = useMemo(
    () => buildProspects(planningOriginAirport),
    [buildProspects, planningOriginAirport],
  );

  const activeRoutes = useMemo(
    () => [...routes].reverse().filter((route) => route.status === "active"),
    [routes],
  );
  const suspendedRoutes = useMemo(
    () => routes.filter((route) => route.status === "suspended"),
    [routes],
  );
  const originActiveRoutes = useMemo(() => {
    if (!planningOriginAirport) return [];
    return activeRoutes.filter((route) => route.originIata === planningOriginAirport.iata);
  }, [activeRoutes, planningOriginAirport]);

  const originHubMeta = planningOriginAirport
    ? HUB_CLASSIFICATIONS[planningOriginAirport.iata]
    : undefined;
  const originCapacityPerHour = originHubMeta?.baseCapacityPerHour ?? 0;
  const originSlotControlled = originHubMeta?.slotControlled ?? false;
  const currentOriginHourlyFlights = useMemo(() => {
    if (!planningOriginAirport) return 0;
    return routes.reduce((total, route) => {
      if (
        route.originIata !== planningOriginAirport.iata &&
        route.destinationIata !== planningOriginAirport.iata
      )
        return total;
      const weekly = route.frequencyPerWeek ?? 0;
      return total + weekly / (7 * 24);
    }, 0);
  }, [planningOriginAirport, routes]);
  const nextRouteHourly = 7 / (7 * 24);
  const projectedOriginHourly = currentOriginHourlyFlights + nextRouteHourly;
  const canOpenFromOrigin = !originSlotControlled || projectedOriginHourly <= originCapacityPerHour;

  const fareData = useMemo(() => {
    if (!fareEditor) {
      return {
        suggestedFares: null,
        activeFareRoute: null,
        fareDemandSnapshot: null,
        fareInputValues: {
          economy: parseFareInput(fareInputs.e),
          business: parseFareInput(fareInputs.b),
          first: parseFareInput(fareInputs.f),
        },
        resolvedFareInputs: {
          economy: 0,
          business: 0,
          first: 0,
        },
        fareElasticity: null,
        fareProjection: null,
      };
    }

    const suggestedFares = getSuggestedFares(fareEditor.distanceKm);
    const activeFareRoute = routes.find((route) => route.id === fareEditor.routeId) ?? null;
    const fareDemandSnapshot = activeFareRoute
      ? getRouteDemandSnapshot(activeFareRoute, tick, fleet, routes)
      : null;
    const fareInputValues = {
      economy: parseFareInput(fareInputs.e),
      business: parseFareInput(fareInputs.b),
      first: parseFareInput(fareInputs.f),
    };
    const resolvedFareInputs = {
      economy:
        fareInputValues.economy ?? (activeFareRoute ? fpToNumber(activeFareRoute.fareEconomy) : 0),
      business:
        fareInputValues.business ??
        (activeFareRoute ? fpToNumber(activeFareRoute.fareBusiness) : 0),
      first: fareInputValues.first ?? (activeFareRoute ? fpToNumber(activeFareRoute.fareFirst) : 0),
    };
    const fareElasticity = {
      economy: calculateElasticityDisplay(
        fp(resolvedFareInputs.economy),
        suggestedFares.economy,
        PRICE_ELASTICITY_ECONOMY,
      ),
      business: calculateElasticityDisplay(
        fp(resolvedFareInputs.business),
        suggestedFares.business,
        PRICE_ELASTICITY_BUSINESS,
      ),
      first: calculateElasticityDisplay(
        fp(resolvedFareInputs.first),
        suggestedFares.first,
        PRICE_ELASTICITY_FIRST,
      ),
    };

    let fareProjection: {
      currentRevenue: FixedPoint;
      suggestedRevenue: FixedPoint;
      currentPassengers: number;
      suggestedPassengers: number;
      deltaRevenue: number;
      deltaPassengers: number;
    } | null = null;

    if (suggestedFares && fareDemandSnapshot && activeFareRoute) {
      const assignedFleet = activeFareRoute.assignedAircraftIds
        .map((id) => fleet.find((item) => item.id === id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (assignedFleet.length > 0) {
        const weeklyDemand = fareDemandSnapshot.addressableDemand;
        const frequency = computeRouteFrequency(
          activeFareRoute.distanceKm,
          activeFareRoute.assignedAircraftIds.length,
        );
        if (frequency > 0) {
          const pressureMultiplier = fareDemandSnapshot.pressureMultiplier;
          const currentEconomy = resolvedFareInputs.economy;
          const currentBusiness = resolvedFareInputs.business;
          const currentFirst = resolvedFareInputs.first;

          const currentElasticity = {
            economy: fareElasticity.economy.multiplier,
            business: fareElasticity.business.multiplier,
            first: fareElasticity.first.multiplier,
          };

          const currentPassengers = {
            economy: Math.floor(
              (weeklyDemand.economy / frequency) * pressureMultiplier * currentElasticity.economy,
            ),
            business: Math.floor(
              (weeklyDemand.business / frequency) * pressureMultiplier * currentElasticity.business,
            ),
            first: Math.floor(
              (weeklyDemand.first / frequency) * pressureMultiplier * currentElasticity.first,
            ),
          };

          const suggestedPassengers = {
            economy: Math.floor((weeklyDemand.economy / frequency) * pressureMultiplier),
            business: Math.floor((weeklyDemand.business / frequency) * pressureMultiplier),
            first: Math.floor((weeklyDemand.first / frequency) * pressureMultiplier),
          };

          const currentRevenue = fpAdd(
            fpAdd(
              fpScale(fp(currentEconomy), currentPassengers.economy),
              fpScale(fp(currentBusiness), currentPassengers.business),
            ),
            fpScale(fp(currentFirst), currentPassengers.first),
          );

          const suggestedRevenue = fpAdd(
            fpAdd(
              fpScale(suggestedFares.economy, suggestedPassengers.economy),
              fpScale(suggestedFares.business, suggestedPassengers.business),
            ),
            fpScale(suggestedFares.first, suggestedPassengers.first),
          );

          const currentTotalPassengers =
            currentPassengers.economy + currentPassengers.business + currentPassengers.first;
          const suggestedTotalPassengers =
            suggestedPassengers.economy + suggestedPassengers.business + suggestedPassengers.first;

          fareProjection = {
            currentRevenue,
            suggestedRevenue,
            currentPassengers: currentTotalPassengers,
            suggestedPassengers: suggestedTotalPassengers,
            deltaRevenue: fpToNumber(currentRevenue) - fpToNumber(suggestedRevenue),
            deltaPassengers: currentTotalPassengers - suggestedTotalPassengers,
          };
        }
      }
    }

    return {
      suggestedFares,
      activeFareRoute,
      fareDemandSnapshot,
      fareInputValues,
      resolvedFareInputs,
      fareElasticity,
      fareProjection,
    };
  }, [fareEditor, fareInputs, routes, tick, fleet]);

  const { suggestedFares, fareElasticity, fareProjection } = fareData;

  const handleSaveFares = async () => {
    if (!fareEditor) return;
    const eVal = parseInt(fareInputs.e.replace(/[^0-9]/g, ""), 10);
    const bVal = parseInt(fareInputs.b.replace(/[^0-9]/g, ""), 10);
    const fVal = parseInt(fareInputs.f.replace(/[^0-9]/g, ""), 10);

    if ([eVal, bVal, fVal].every((val) => Number.isNaN(val))) {
      setFareError("Enter at least one fare value.");
      return;
    }

    setFareError(null);
    setIsSavingFares(true);
    try {
      await updateRouteFares(fareEditor.routeId, {
        economy: Number.isNaN(eVal) ? undefined : fp(eVal),
        business: Number.isNaN(bVal) ? undefined : fp(bVal),
        first: Number.isNaN(fVal) ? undefined : fp(fVal),
      });
      setFareEditor(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Fare update failed", {
        description: message,
      });
    } finally {
      setIsSavingFares(false);
    }
  };

  // --- Virtualization (hooks must come before any conditional return) ---
  const listParentRef = useRef<HTMLDivElement>(null);

  const displayedOpportunities = useMemo(() => {
    const activeDests = new Set(originActiveRoutes.map((r) => r.destinationIata));
    const candidates =
      searchQuery.length >= 2
        ? searchResults.map(calculateSearchProspect).filter((m): m is ProspectMarket => Boolean(m))
        : prospectMarkets;
    return candidates.filter((m) => !activeDests.has(m.destination.iata));
  }, [searchQuery, searchResults, prospectMarkets, originActiveRoutes, calculateSearchProspect]);

  const activeRoutesVirtualizer = useVirtualizer({
    count: activeRoutes.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 420,
    overscan: 3,
  });

  const opportunitiesVirtualizer = useVirtualizer({
    count: displayedOpportunities.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 220,
    overscan: 5,
  });

  if (!airline || !homeAirport || !planningOriginAirport) return null;

  return (
    <div className="flex h-full w-full flex-col p-6 overflow-hidden">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Globe className="h-6 w-6 sm:h-8 sm:w-8 text-primary shrink-0" />
            Network
          </h2>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Manage your routes and flight frequencies from {planningOriginAirport.name}.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {airline.hubs.length > 1 ? (
            <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/30 px-3 py-2">
              <MapPin className="h-4 w-4 text-primary" />
              <select
                value={planningOriginIata ?? ""}
                onChange={(event) => setPlanningOriginIata(event.target.value || null)}
                className="h-9 rounded-lg border border-border/50 bg-background px-3 text-xs font-bold text-foreground"
              >
                {airline.hubs.map((hub) => (
                  <option key={hub} value={hub}>
                    {hub}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="flex flex-col sm:flex-row bg-muted/50 p-1 rounded-xl border border-border/50 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setTab("active")}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex-1 text-center ${tab === "active" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Active Network ({activeRoutes.length})
            </button>
            <button
              type="button"
              onClick={() => setTab("opportunities")}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex-1 text-center ${tab === "opportunities" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Market Opportunities
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col pr-2">
        {suspendedRoutes.length > 0 && !isViewingOther && (
          <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-200">
                  Suspended Routes
                </p>
                <p className="text-sm text-amber-100/80 mt-2">
                  These routes lost their origin hub. Rebase them to an operational hub to resume
                  service.
                </p>
              </div>
              <div className="rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-xs font-bold text-amber-200">
                {suspendedRoutes.length} awaiting rebase
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3">
              {suspendedRoutes.map((route) => (
                <div
                  key={route.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-background/70 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-bold text-foreground flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => navigateToAirport(route.originIata)}
                        className="hover:text-primary transition-colors cursor-pointer"
                      >
                        {route.originIata}
                      </button>
                      <span className="text-muted-foreground">→</span>
                      <button
                        type="button"
                        onClick={() => navigateToAirport(route.destinationIata)}
                        className="hover:text-primary transition-colors cursor-pointer"
                      >
                        {route.destinationIata}
                      </button>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Distance {Math.round(route.distanceKm).toLocaleString()} km
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {airline.hubs.some((hub) => hub !== route.destinationIata) ? (
                      <>
                        <select
                          value={
                            rebaseTargets[route.id] ??
                            airline.hubs.find((hub) => hub !== route.destinationIata) ??
                            ""
                          }
                          onChange={(e) =>
                            setRebaseTargets((prev) => ({ ...prev, [route.id]: e.target.value }))
                          }
                          className="h-9 rounded-lg border border-border/60 bg-background px-3 text-xs font-bold text-foreground"
                        >
                          {airline.hubs
                            .filter((hub) => hub !== route.destinationIata)
                            .map((hub) => (
                              <option key={hub} value={hub}>
                                {hub}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          onClick={async () => {
                            const fallbackHub = airline.hubs.find(
                              (hub) => hub !== route.destinationIata,
                            );
                            const targetHub = rebaseTargets[route.id] ?? fallbackHub;
                            if (!targetHub) return;
                            try {
                              await rebaseRoute(route.id, targetHub);
                            } catch (err) {
                              const message =
                                err instanceof Error ? err.message : "Route rebase failed";
                              toast.error("Route rebase failed", { description: message });
                            }
                          }}
                          className="h-9 rounded-lg bg-amber-500 px-3 text-xs font-bold text-amber-950 hover:bg-amber-400 transition"
                        >
                          Rebase to Hub
                        </button>
                      </>
                    ) : (
                      <div className="text-xs font-bold text-amber-100/70">
                        Open another hub to rebase.
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        const approved = await confirm({
                          title: "Close route?",
                          description: `This removes ${route.originIata} → ${route.destinationIata} from your network. Any assigned aircraft will be unassigned.`,
                          confirmLabel: "Close Route",
                          tone: "destructive",
                        });
                        if (!approved) return;
                        try {
                          await closeRoute(route.id);
                        } catch (err) {
                          const message = err instanceof Error ? err.message : "Route close failed";
                          toast.error("Route close failed", { description: message });
                        }
                      }}
                      className="h-9 rounded-lg border border-amber-500/30 bg-transparent px-3 text-xs font-bold text-amber-100 hover:bg-amber-500/20 transition"
                    >
                      Close Route
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === "opportunities" && (
          <div className="mb-6 flex items-center gap-4 bg-muted/30 p-4 rounded-2xl border border-border/50">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by IATA, ICAO, City, or Name..."
                className="w-full bg-background border border-border/50 rounded-xl py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all font-bold"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-xs font-bold text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {tab === "active" ? (
          activeRoutes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-border/50 rounded-3xl bg-muted/20">
              <Globe className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground font-medium">Your network is empty.</p>
              {!isViewingOther && (
                <button
                  type="button"
                  onClick={() => setTab("opportunities")}
                  className="mt-4 px-6 py-2 bg-primary text-primary-foreground rounded-full text-sm font-bold shadow-lg shadow-primary/20 hover:scale-105 transition-transform"
                >
                  Browse Market Opportunities
                </button>
              )}
            </div>
          ) : (
            <div ref={listParentRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              <div
                style={{
                  height: `${activeRoutesVirtualizer.getTotalSize()}px`,
                  position: "relative",
                }}
              >
                {activeRoutesVirtualizer.getVirtualItems().map((virtualItem) => {
                  const route = activeRoutes[virtualItem.index];
                  const destinationAirport = airportIndex.get(route.destinationIata);
                  const assignedCount = route.assignedAircraftIds.length;
                  const demandSnapshot = getRouteDemandSnapshot(route, tick, fleet, routes);
                  const { addressableDemand } = demandSnapshot;
                  const marketDemand =
                    demandSnapshot.totalDemand.economy +
                    demandSnapshot.totalDemand.business +
                    demandSnapshot.totalDemand.first;
                  const addressableTotal =
                    addressableDemand.economy +
                    addressableDemand.business +
                    addressableDemand.first;
                  const totalWeeklySeats = demandSnapshot.totalWeeklySeats;
                  const loadFactor = Math.round(demandSnapshot.pressureMultiplier * 100);
                  const supplyRatio =
                    addressableTotal > 0 ? totalWeeklySeats / addressableTotal : 0;
                  const lfTone =
                    loadFactor >= 80
                      ? "text-emerald-400"
                      : loadFactor >= 60
                        ? "text-amber-400"
                        : "text-rose-400";
                  const lfFill =
                    loadFactor >= 80
                      ? "bg-emerald-500"
                      : loadFactor >= 60
                        ? "bg-amber-500"
                        : "bg-rose-500";
                  const supplyLabel =
                    supplyRatio > 1.05
                      ? "Over-Supplied"
                      : supplyRatio < 0.7
                        ? "Underserved"
                        : "Balanced";
                  const economyTone = getFareTone(
                    route.fareEconomy,
                    demandSnapshot.referenceFareEconomy,
                  );
                  const businessTone = getFareTone(
                    route.fareBusiness,
                    demandSnapshot.referenceFareBusiness,
                  );
                  const firstTone = getFareTone(route.fareFirst, demandSnapshot.referenceFareFirst);
                  const economyElasticity = demandSnapshot.elasticityEconomy;
                  const businessElasticity = demandSnapshot.elasticityBusiness;
                  const firstElasticity = demandSnapshot.elasticityFirst;
                  const showPriceEffect =
                    Math.abs(1 - economyElasticity) > 0.05 ||
                    Math.abs(1 - businessElasticity) > 0.05 ||
                    Math.abs(1 - firstElasticity) > 0.05;

                  return (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      ref={activeRoutesVirtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <div className="group relative rounded-2xl bg-card border border-border overflow-hidden p-4 sm:p-5 transition-all hover:border-primary/50 hover:shadow-md mb-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-3 sm:gap-6">
                            <div className="flex flex-col">
                              <span className="text-2xl font-black text-primary leading-none tracking-tighter flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => navigateToAirport(route.originIata)}
                                  className="hover:text-foreground transition-colors cursor-pointer"
                                >
                                  {route.originIata}
                                </button>
                                <span className="text-muted-foreground">→</span>
                                <button
                                  type="button"
                                  onClick={() => navigateToAirport(route.destinationIata)}
                                  className="hover:text-foreground transition-colors cursor-pointer"
                                >
                                  {route.destinationIata}
                                </button>
                              </span>
                              <span className="text-xs text-muted-foreground font-semibold mt-1">
                                {destinationAirport?.city}, {destinationAirport?.country} •{" "}
                                {Math.round(route.distanceKm).toLocaleString()}km
                              </span>
                            </div>

                            <div className="hidden sm:block h-10 w-px bg-border/50" />

                            <div className="flex flex-col">
                              <span className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                                Pricing
                              </span>
                              <div className="flex gap-3 mt-1">
                                <span className="text-xs font-mono bg-zinc-500/10 px-2 py-0.5 rounded border border-zinc-500/20 inline-flex items-center gap-1.5">
                                  {economyTone && (
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full ${toneDotClass[economyTone]}`}
                                    />
                                  )}
                                  E: {fpFormat(route.fareEconomy, 0)}
                                </span>
                                <span className="text-xs font-mono bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 text-blue-400 inline-flex items-center gap-1.5">
                                  {businessTone && (
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full ${toneDotClass[businessTone]}`}
                                    />
                                  )}
                                  B: {fpFormat(route.fareBusiness, 0)}
                                </span>
                                <span className="text-xs font-mono bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20 text-yellow-500 inline-flex items-center gap-1.5">
                                  {firstTone && (
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full ${toneDotClass[firstTone]}`}
                                    />
                                  )}
                                  F: {fpFormat(route.fareFirst, 0)}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                            <div className="flex flex-col text-right">
                              <span className="text-xs text-muted-foreground font-bold uppercase tracking-widest">
                                Fleet
                              </span>
                              <span
                                className={`text-sm font-bold mt-1 ${assignedCount > 0 ? "text-foreground" : "text-red-400 flex items-center gap-1 justify-end"}`}
                              >
                                {assignedCount === 0 && <AlertCircle className="h-3 w-3" />}
                                {assignedCount} Aircraft Assigned
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              {!isViewingOther && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFareEditor({
                                        routeId: route.id,
                                        originIata: route.originIata,
                                        destinationIata: route.destinationIata,
                                        distanceKm: route.distanceKm,
                                      });
                                      setFareInputs({
                                        e: fpToNumber(route.fareEconomy).toString(),
                                        b: fpToNumber(route.fareBusiness).toString(),
                                        f: fpToNumber(route.fareFirst).toString(),
                                      });
                                      setFareError(null);
                                    }}
                                    className="px-4 py-2 bg-white/5 text-white/60 border border-white/5 rounded-xl text-sm font-bold hover:bg-white/10 transition-all"
                                  >
                                    Edit Fares
                                  </button>

                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const approved = await confirm({
                                        title: "Close route?",
                                        description: `This removes ${route.originIata} → ${route.destinationIata} from your network. Any assigned aircraft will be unassigned.`,
                                        confirmLabel: "Close Route",
                                        tone: "destructive",
                                      });
                                      if (!approved) return;
                                      try {
                                        await closeRoute(route.id);
                                      } catch (err) {
                                        const message =
                                          err instanceof Error ? err.message : "Route close failed";
                                        toast.error("Route close failed", { description: message });
                                      }
                                    }}
                                    className="px-3 py-2 rounded-xl border border-red-500/30 text-red-200/80 text-sm font-bold hover:bg-red-500/15 transition-all"
                                  >
                                    Close Route
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Market Supply / Demand */}
                        {addressableDemand && (
                          <div className="mt-3 rounded-xl sm:rounded-2xl border border-border/40 bg-muted/20 p-3 sm:p-4">
                            <div className="flex items-center justify-between mb-2 sm:mb-3">
                              <span className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                                <TrendingUp className="h-3 w-3" /> Market Supply
                              </span>
                              <span className={`text-[10px] font-bold uppercase ${lfTone}`}>
                                {supplyLabel}
                              </span>
                            </div>

                            <div className="grid grid-cols-3 gap-2 sm:gap-3 text-[10px] font-mono">
                              <div className="flex flex-col gap-1 rounded-lg border border-border/30 bg-background/40 px-2 py-1.5">
                                <span className="text-[9px] uppercase text-muted-foreground font-semibold">
                                  Total Market
                                </span>
                                <span className="text-foreground font-bold">
                                  {marketDemand.toLocaleString()} / wk
                                </span>
                              </div>
                              <div className="flex flex-col gap-1 rounded-lg border border-border/30 bg-background/40 px-2 py-1.5">
                                <span className="text-[9px] uppercase text-muted-foreground font-semibold">
                                  Addressable
                                </span>
                                <span className="text-foreground font-bold">
                                  {addressableTotal.toLocaleString()} / wk
                                </span>
                              </div>
                              <div className="flex flex-col gap-1 rounded-lg border border-border/30 bg-background/40 px-2 py-1.5">
                                <span className="text-[9px] uppercase text-muted-foreground font-semibold">
                                  Your Seats
                                </span>
                                <span className="text-foreground font-bold">
                                  {totalWeeklySeats.toLocaleString()} / wk
                                </span>
                              </div>
                            </div>

                            <div className="mt-3">
                              <div className="flex justify-between text-[10px] font-semibold">
                                <span className="text-muted-foreground uppercase">
                                  Supply Pressure
                                </span>
                                <span className={lfTone}>{loadFactor}% LF</span>
                              </div>
                              <div className="mt-1 h-2 w-full rounded-full bg-background/70 overflow-hidden">
                                <div
                                  className={`h-full ${lfFill} transition-all duration-500`}
                                  style={{ width: `${Math.min(100, loadFactor)}%` }}
                                />
                              </div>
                              <div className="mt-2 flex justify-between text-[9px] text-muted-foreground">
                                <span>Target {Math.round(NATURAL_LF_CEILING * 100)}%</span>
                                <span>
                                  {supplyRatio > 1.05
                                    ? `Oversupply ${(supplyRatio).toFixed(2)}x`
                                    : `Coverage ${(supplyRatio).toFixed(2)}x`}
                                </span>
                              </div>
                              {showPriceEffect && (
                                <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-semibold">
                                  <span className="uppercase text-muted-foreground">
                                    Price Effect
                                  </span>
                                  <span
                                    className={`font-mono ${toneTextClass[getElasticityTone(economyElasticity)]}`}
                                  >
                                    E: {economyElasticity.toFixed(2)}x
                                  </span>
                                  <span
                                    className={`font-mono ${toneTextClass[getElasticityTone(businessElasticity)]}`}
                                  >
                                    B: {businessElasticity.toFixed(2)}x
                                  </span>
                                  <span
                                    className={`font-mono ${toneTextClass[getElasticityTone(firstElasticity)]}`}
                                  >
                                    F: {firstElasticity.toFixed(2)}x
                                  </span>
                                </div>
                              )}
                              {demandSnapshot.suggestedFleetDelta !== 0 && (
                                <div className="mt-2 flex items-center gap-1.5 text-[9px] font-semibold">
                                  {demandSnapshot.suggestedFleetDelta > 0 ? (
                                    <>
                                      <ArrowUp className="h-3 w-3 text-emerald-400" />
                                      <span className="text-emerald-400">
                                        +{demandSnapshot.suggestedFleetDelta} aircraft suggested
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <ArrowDown className="h-3 w-3 text-amber-400" />
                                      <span className="text-amber-400">
                                        {demandSnapshot.suggestedFleetDelta} aircraft suggested
                                      </span>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Market Analysis Tab */}
                        <div className="mt-3 sm:mt-5 pt-3 sm:pt-5 border-t border-border/50">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                              <Globe className="h-3 w-3" />
                              Market Health
                            </h4>
                            <div className="flex gap-2">
                              <div className="flex items-center gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                                <span className="text-[8px] text-muted-foreground font-bold uppercase">
                                  Econ
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                <span className="text-[8px] text-muted-foreground font-bold uppercase">
                                  Bus
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                                <span className="text-[8px] text-muted-foreground font-bold uppercase">
                                  First
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Demand class breakdown visualization */}
                          {(() => {
                            const demandTotal =
                              demandSnapshot.totalDemand.economy +
                              demandSnapshot.totalDemand.business +
                              demandSnapshot.totalDemand.first;
                            return (
                              <div className="flex h-1 w-full rounded-full bg-muted/30 overflow-hidden mb-3">
                                <div
                                  className="h-full bg-zinc-500"
                                  style={{
                                    width:
                                      demandTotal === 0
                                        ? "0%"
                                        : `${(demandSnapshot.totalDemand.economy / demandTotal) * 100}%`,
                                  }}
                                />
                                <div
                                  className="h-full bg-blue-500"
                                  style={{
                                    width:
                                      demandTotal === 0
                                        ? "0%"
                                        : `${(demandSnapshot.totalDemand.business / demandTotal) * 100}%`,
                                  }}
                                />
                                <div
                                  className="h-full bg-yellow-500"
                                  style={{
                                    width:
                                      demandTotal === 0
                                        ? "0%"
                                        : `${(demandSnapshot.totalDemand.first / demandTotal) * 100}%`,
                                  }}
                                />
                              </div>
                            );
                          })()}

                          {(() => {
                            const routeKey = canonicalRouteKey(
                              route.originIata,
                              route.destinationIata,
                            );
                            const offers = globalRouteRegistry.get(routeKey) || [];

                            if (offers.length === 0) {
                              return (
                                <div className="bg-emerald-500/5 rounded-xl p-3 border border-emerald-500/10">
                                  <p className="text-[11px] text-emerald-400/80 font-medium flex items-center gap-2">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Monopoly Market: No active competitors found on this route.
                                  </p>
                                </div>
                              );
                            }

                            return (
                              <div className="grid grid-cols-1 gap-2">
                                {offers.map((offer: FlightOffer) => {
                                  const comp = competitors.get(offer.airlinePubkey);

                                  // Calculate estimated share for this offer vs ours
                                  const ourFrequency = computeRouteFrequency(
                                    route.distanceKm,
                                    route.assignedAircraftIds.length,
                                  );
                                  const ourTravelTime = Math.round((route.distanceKm / 800) * 60); // simplified model speed

                                  const ourOffer: FlightOffer = {
                                    airlinePubkey: pubkey || "",
                                    fareEconomy: route.fareEconomy,
                                    fareBusiness: route.fareBusiness,
                                    fareFirst: route.fareFirst,
                                    frequencyPerWeek: ourFrequency || 1, // at least 1 for display
                                    travelTimeMinutes: ourTravelTime,
                                    stops: 0,
                                    serviceScore: 0.7,
                                    brandScore: airline.brandScore || 0.5,
                                  };

                                  const allOffers = [ourOffer, ...offers];
                                  const shares = calculateShares(allOffers);
                                  const compShare =
                                    (shares.economy.get(offer.airlinePubkey) || 0) * 100;

                                  return (
                                    <div
                                      key={`${offer.airlinePubkey}-${offer.frequencyPerWeek}-${offer.fareEconomy}`}
                                      className="flex flex-wrap items-center justify-between gap-2 bg-muted/30 rounded-xl px-3 sm:px-4 py-2 border border-border/50"
                                    >
                                      <div className="flex items-center gap-3">
                                        <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                                          {comp?.icaoCode || "??"}
                                        </div>
                                        <div className="flex flex-col">
                                          <span className="text-xs font-bold text-foreground">
                                            {comp?.name || "Unknown Airline"}
                                          </span>
                                          <span className="text-[9px] text-muted-foreground uppercase font-semibold">
                                            Freq: {offer.frequencyPerWeek}/wk
                                          </span>
                                        </div>
                                      </div>

                                      <div className="flex gap-4 items-center">
                                        <div className="flex gap-2">
                                          <span className="text-[10px] font-mono text-zinc-500">
                                            E: {fpFormat(offer.fareEconomy, 0)}
                                          </span>
                                          <span className="text-[10px] font-mono text-blue-400">
                                            B: {fpFormat(offer.fareBusiness, 0)}
                                          </span>
                                          <span className="text-[10px] font-mono text-yellow-500">
                                            F: {fpFormat(offer.fareFirst, 0)}
                                          </span>
                                        </div>
                                        <div className="h-8 w-px bg-border/50" />
                                        <div className="flex flex-col text-right">
                                          <span className="text-[9px] text-muted-foreground uppercase font-bold">
                                            Est. Share
                                          </span>
                                          <span className="text-xs font-bold text-accent">
                                            {compShare.toFixed(1)}%
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        ) : (
          <div ref={listParentRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            <div
              style={{
                height: `${opportunitiesVirtualizer.getTotalSize()}px`,
                position: "relative",
              }}
            >
              {opportunitiesVirtualizer.getVirtualItems().map((virtualItem) => {
                const market = displayedOpportunities[virtualItem.index];
                const isAlreadyOpen = activeRoutes.some(
                  (r) =>
                    r.originIata === market.origin.iata &&
                    r.destinationIata === market.destination.iata,
                );
                const totalDemand =
                  market.demand.economy + market.demand.business + market.demand.first;
                const addressableDemand = scaleToAddressableMarket({
                  origin: market.origin.iata,
                  destination: market.destination.iata,
                  economy: market.demand.economy,
                  business: market.demand.business,
                  first: market.demand.first,
                });
                const addressableTotal =
                  addressableDemand.economy + addressableDemand.business + addressableDemand.first;
                const destinationMeta = HUB_CLASSIFICATIONS[market.destination.iata];
                const destinationCapacity = destinationMeta?.baseCapacityPerHour ?? null;
                const destinationSlotControlled = destinationMeta?.slotControlled ?? false;

                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={opportunitiesVirtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <div className="group relative rounded-2xl bg-card border border-border overflow-hidden p-5 transition-all hover:border-primary/50 mb-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-3 sm:gap-8">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl font-black text-foreground tracking-tighter">
                                {market.destination.iata}
                                {market.destination.icao &&
                                  market.destination.icao !== market.destination.iata && (
                                    <span className="ml-2 text-xs text-muted-foreground font-mono font-normal">
                                      [{market.destination.icao}]
                                    </span>
                                  )}
                              </span>
                              <TrendingUp className="h-4 w-4 text-accent" />
                            </div>
                            <span className="text-sm font-bold text-muted-foreground">
                              {market.destination.city}, {market.destination.country}
                            </span>
                          </div>

                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                              Total Market
                            </span>
                            <span className="text-lg font-mono font-bold">
                              {totalDemand.toLocaleString()}
                            </span>
                          </div>

                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                              Addressable
                            </span>
                            <span className="text-lg font-mono font-bold text-foreground">
                              {addressableTotal.toLocaleString()}
                            </span>
                          </div>

                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                              Distance
                            </span>
                            <span className="text-lg font-mono font-bold text-accent">
                              {Math.round(market.distance).toLocaleString()} km
                            </span>
                          </div>

                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                              Est. Daily Rev
                            </span>
                            <span className="text-lg font-mono font-bold text-green-400">
                              {fpFormat(market.estimatedDailyRevenue, 0)}
                            </span>
                          </div>
                          {destinationCapacity && (
                            <div className="flex flex-col">
                              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                                Destination Capacity
                              </span>
                              <span className="text-xs font-semibold text-foreground">
                                {destinationCapacity}/hr
                                {destinationSlotControlled ? " • Slot Controlled" : ""}
                              </span>
                            </div>
                          )}
                        </div>

                        {isAlreadyOpen ? (
                          <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary border border-primary/20 rounded-xl text-sm font-bold">
                            <CheckCircle2 className="h-4 w-4" />
                            Route Open
                          </div>
                        ) : !isViewingOther ? (
                          <button
                            type="button"
                            onClick={async () => {
                              const approved = await confirm({
                                title: "Open route?",
                                description: `This charges ${fpFormat(ROUTE_SLOT_FEE, 0)} to open ${market.origin.iata} → ${market.destination.iata}.`,
                                confirmLabel: "Open Route",
                              });
                              if (!approved) return;
                              setOpeningRouteIata(market.destination.iata);
                              try {
                                await openRoute(
                                  market.origin.iata,
                                  market.destination.iata,
                                  market.distance,
                                );
                              } catch (error) {
                                const message =
                                  error instanceof Error ? error.message : "Unknown error";
                                toast.error("Route open failed", {
                                  description: message,
                                });
                              } finally {
                                setOpeningRouteIata(null);
                              }
                            }}
                            disabled={!canOpenFromOrigin || openingRouteIata !== null}
                            className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:scale-105 transition-all shadow-lg shadow-primary/25 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                          >
                            {openingRouteIata === market.destination.iata ? (
                              <>
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                Opening…
                              </>
                            ) : (
                              <>
                                <PlusCircle className="h-4 w-4" />
                                Open Route ({fpFormat(ROUTE_SLOT_FEE, 0)})
                              </>
                            )}
                          </button>
                        ) : null}
                      </div>
                      {!isAlreadyOpen && originSlotControlled && !canOpenFromOrigin && (
                        <div className="mt-3 text-xs text-amber-400">
                          Slot capacity reached at {market.origin.iata}. Reduce frequency or choose
                          another hub.
                        </div>
                      )}
                      <div className="mt-4 flex h-1 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-zinc-500"
                          style={{
                            width: `${(market.demand.economy / (totalDemand || 1)) * 100}%`,
                          }}
                          title="Economy"
                        />
                        <div
                          className="h-full bg-blue-500"
                          style={{
                            width: `${(market.demand.business / (totalDemand || 1)) * 100}%`,
                          }}
                          title="Business"
                        />
                        <div
                          className="h-full bg-yellow-500"
                          style={{ width: `${(market.demand.first / (totalDemand || 1)) * 100}%` }}
                          title="First"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {searchQuery.length > 0 && searchQuery.length < 2 && (
              <div className="p-8 text-center text-muted-foreground font-bold italic">
                Type at least 2 characters to search...
              </div>
            )}
            {searchQuery.length >= 2 && searchResults.length === 0 && (
              <div className="p-8 text-center text-muted-foreground font-bold italic">
                No airports found matching "{searchQuery}"
              </div>
            )}
          </div>
        )}
      </div>
      {fareEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !isSavingFares && setFareEditor(null)}
            aria-label="Close fare editor"
          />
          <div className="relative z-10 w-full max-w-xl rounded-2xl border border-border bg-background/95 shadow-[0_20px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
            <div className="flex items-start justify-between border-b border-border/50 px-6 py-5">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                  Route Pricing
                </p>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setFareEditor(null);
                      navigateToAirport(fareEditor.originIata);
                    }}
                    className="hover:text-primary transition-colors cursor-pointer"
                  >
                    {fareEditor.originIata}
                  </button>
                  <span className="text-muted-foreground">→</span>
                  <button
                    type="button"
                    onClick={() => {
                      setFareEditor(null);
                      navigateToAirport(fareEditor.destinationIata);
                    }}
                    className="hover:text-primary transition-colors cursor-pointer"
                  >
                    {fareEditor.destinationIata}
                  </button>
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Distance: {Math.round(fareEditor.distanceKm).toLocaleString()} km
                </p>
              </div>
              <button
                type="button"
                onClick={() => !isSavingFares && setFareEditor(null)}
                className="rounded-full bg-background/60 p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close"
              >
                <span className="sr-only">Close</span>X
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-border/50 bg-background/60 p-4">
                  <label
                    htmlFor="fare-economy"
                    className="text-[10px] uppercase text-muted-foreground font-semibold"
                  >
                    Economy
                  </label>
                  <input
                    id="fare-economy"
                    type="number"
                    min="0"
                    step="1"
                    value={fareInputs.e}
                    onChange={(e) => setFareInputs({ ...fareInputs, e: e.target.value })}
                    className="mt-2 h-10 w-full rounded-lg bg-background border border-border/50 px-3 text-sm font-medium outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                  />
                  {suggestedFares ? (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Suggested: {fpToNumber(suggestedFares.economy)}
                    </p>
                  ) : null}
                  {suggestedFares && fareElasticity ? (
                    <div className="mt-3 rounded-lg border border-border/50 bg-background/70 px-3 py-2">
                      <div className="flex items-center justify-between text-[10px] font-semibold">
                        <span className="uppercase text-muted-foreground">Demand Impact</span>
                        <span
                          className={`font-mono ${toneTextClass[getElasticityTone(fareElasticity.economy.multiplier)]}`}
                        >
                          {fareElasticity.economy.multiplier.toFixed(2)}x
                        </span>
                      </div>
                      <div className="mt-2 h-2 w-full rounded-full bg-background/70 overflow-hidden relative">
                        <div
                          className={`h-full transition-all duration-500 ${toneDotClass[getElasticityTone(fareElasticity.economy.multiplier)]}`}
                          style={{
                            width: `${Math.min(100, (fareElasticity.economy.multiplier / 1.5) * 100)}%`,
                          }}
                        />
                        <div
                          className="absolute inset-y-0 left-[66.7%] w-px bg-white/30"
                          aria-hidden
                        />
                        {fareElasticity.economy.multiplier > 1 && (
                          <div
                            className="absolute inset-y-0 left-[66.7%] bg-sky-500/70"
                            style={{
                              width: `${Math.min(33.3, ((fareElasticity.economy.multiplier - 1) / 0.5) * 33.3)}%`,
                            }}
                          />
                        )}
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Fare is {formatSignedPercent(fareElasticity.economy.deltaPercent)} vs market
                      </p>
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-border/50 bg-background/60 p-4">
                  <label
                    htmlFor="fare-business"
                    className="text-[10px] uppercase text-muted-foreground font-semibold"
                  >
                    Business
                  </label>
                  <input
                    id="fare-business"
                    type="number"
                    min="0"
                    step="1"
                    value={fareInputs.b}
                    onChange={(e) => setFareInputs({ ...fareInputs, b: e.target.value })}
                    className="mt-2 h-10 w-full rounded-lg bg-background border border-border/50 px-3 text-sm font-medium outline-none focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/20 text-blue-400"
                  />
                  {suggestedFares ? (
                    <p className="mt-2 text-[10px] text-blue-400/70">
                      Suggested: {fpToNumber(suggestedFares.business)}
                    </p>
                  ) : null}
                  {suggestedFares && fareElasticity ? (
                    <div className="mt-3 rounded-lg border border-border/50 bg-background/70 px-3 py-2">
                      <div className="flex items-center justify-between text-[10px] font-semibold">
                        <span className="uppercase text-muted-foreground">Demand Impact</span>
                        <span
                          className={`font-mono ${toneTextClass[getElasticityTone(fareElasticity.business.multiplier)]}`}
                        >
                          {fareElasticity.business.multiplier.toFixed(2)}x
                        </span>
                      </div>
                      <div className="mt-2 h-2 w-full rounded-full bg-background/70 overflow-hidden relative">
                        <div
                          className={`h-full transition-all duration-500 ${toneDotClass[getElasticityTone(fareElasticity.business.multiplier)]}`}
                          style={{
                            width: `${Math.min(100, (fareElasticity.business.multiplier / 1.5) * 100)}%`,
                          }}
                        />
                        <div
                          className="absolute inset-y-0 left-[66.7%] w-px bg-white/30"
                          aria-hidden
                        />
                        {fareElasticity.business.multiplier > 1 && (
                          <div
                            className="absolute inset-y-0 left-[66.7%] bg-sky-500/70"
                            style={{
                              width: `${Math.min(33.3, ((fareElasticity.business.multiplier - 1) / 0.5) * 33.3)}%`,
                            }}
                          />
                        )}
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Fare is {formatSignedPercent(fareElasticity.business.deltaPercent)} vs
                        market
                      </p>
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-border/50 bg-background/60 p-4">
                  <label
                    htmlFor="fare-first"
                    className="text-[10px] uppercase text-muted-foreground font-semibold"
                  >
                    First
                  </label>
                  <input
                    id="fare-first"
                    type="number"
                    min="0"
                    step="1"
                    value={fareInputs.f}
                    onChange={(e) => setFareInputs({ ...fareInputs, f: e.target.value })}
                    className="mt-2 h-10 w-full rounded-lg bg-background border border-border/50 px-3 text-sm font-medium outline-none focus:border-yellow-500/60 focus:ring-2 focus:ring-yellow-500/20 text-yellow-500"
                  />
                  {suggestedFares ? (
                    <p className="mt-2 text-[10px] text-yellow-500/70">
                      Suggested: {fpToNumber(suggestedFares.first)}
                    </p>
                  ) : null}
                  {suggestedFares && fareElasticity ? (
                    <div className="mt-3 rounded-lg border border-border/50 bg-background/70 px-3 py-2">
                      <div className="flex items-center justify-between text-[10px] font-semibold">
                        <span className="uppercase text-muted-foreground">Demand Impact</span>
                        <span
                          className={`font-mono ${toneTextClass[getElasticityTone(fareElasticity.first.multiplier)]}`}
                        >
                          {fareElasticity.first.multiplier.toFixed(2)}x
                        </span>
                      </div>
                      <div className="mt-2 h-2 w-full rounded-full bg-background/70 overflow-hidden relative">
                        <div
                          className={`h-full transition-all duration-500 ${toneDotClass[getElasticityTone(fareElasticity.first.multiplier)]}`}
                          style={{
                            width: `${Math.min(100, (fareElasticity.first.multiplier / 1.5) * 100)}%`,
                          }}
                        />
                        <div
                          className="absolute inset-y-0 left-[66.7%] w-px bg-white/30"
                          aria-hidden
                        />
                        {fareElasticity.first.multiplier > 1 && (
                          <div
                            className="absolute inset-y-0 left-[66.7%] bg-sky-500/70"
                            style={{
                              width: `${Math.min(33.3, ((fareElasticity.first.multiplier - 1) / 0.5) * 33.3)}%`,
                            }}
                          />
                        )}
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Fare is {formatSignedPercent(fareElasticity.first.deltaPercent)} vs market
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
              {fareProjection ? (
                <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground">
                    Revenue Projection
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 text-xs font-mono">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">At current fares</span>
                      <span className="font-bold text-foreground">
                        {fpFormat(fareProjection.currentRevenue, 0)} / flight
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">At suggested fares</span>
                      <span className="font-bold text-muted-foreground">
                        {fpFormat(fareProjection.suggestedRevenue, 0)} / flight
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Delta</span>
                      <span
                        className={`font-bold ${fareProjection.deltaRevenue >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                      >
                        {fareProjection.deltaRevenue >= 0 ? "+" : "-"}
                        {Math.abs(fareProjection.deltaRevenue).toLocaleString()} revenue{" "}
                        {fareProjection.deltaPassengers !== 0 && (
                          <span className="text-muted-foreground">
                            ({fareProjection.deltaPassengers > 0 ? "+" : "-"}
                            {Math.abs(fareProjection.deltaPassengers)} pax)
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3 text-[10px] text-muted-foreground">
                  Assign aircraft to see revenue projection.
                </div>
              )}
              {fareError ? <p className="text-xs font-semibold text-red-400">{fareError}</p> : null}
              <button
                type="button"
                onClick={() => {
                  if (!suggestedFares) return;
                  setFareInputs({
                    e: fpToNumber(suggestedFares.economy).toString(),
                    b: fpToNumber(suggestedFares.business).toString(),
                    f: fpToNumber(suggestedFares.first).toString(),
                  });
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-background/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent"
              >
                Use suggested fares
              </button>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border/50 px-6 py-4">
              <button
                type="button"
                onClick={() => setFareEditor(null)}
                disabled={isSavingFares}
                className="rounded-lg border border-border bg-background/70 px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveFares}
                disabled={isSavingFares}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
              >
                {isSavingFares ? "Saving..." : "Save fares"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
