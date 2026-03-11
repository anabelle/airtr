import {
  type AircraftInstance,
  type Airport,
  fp,
  fpFormat,
  fpScale,
  haversineDistance,
  ROUTE_SLOT_FEE,
  type Route,
} from "@acars/core";
import { airports as AIRPORTS, getHubPricingForIata, HUB_CLASSIFICATIONS } from "@acars/data";
import { useAirlineStore, useEngineStore } from "@acars/store";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Building2, MapPin, Plane, PlaneTakeoff, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FlightBoard } from "@/features/network/components/FlightBoard";
import { buildCompetitorHubEntries } from "@/features/network/utils/competitorHubs";
import { buildGroundTraffic } from "@/features/network/utils/groundTraffic";
import {
  MOBILE_OVERLAY_MAX_HEIGHT_CLASS,
  MOBILE_TOPBAR_TOP_CLASS,
} from "@/shared/components/layout/mobileLayout";
import { navigateToAirport } from "@/shared/lib/permalinkNavigation";
import { useConfirm } from "@/shared/lib/useConfirm";

type AirportInfoPanelProps = {
  airport: Airport;
  onClose: () => void;
};

type AirportSearchParams = {
  airportTab?: "info" | "flights";
};

const airportIndex = new Map(AIRPORTS.map((airport) => [airport.iata, airport]));

const numberFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const currencyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const routeSlotFeeLabel = fpFormat(ROUTE_SLOT_FEE, 0);

function formatPopulation(value: number) {
  return value >= 1_000_000 ? `${compactFormat.format(value)}` : numberFormat.format(value);
}

function routeLabel(route: Route) {
  return `${route.originIata} → ${route.destinationIata}`;
}

export function AirportInfoPanel({ airport, onClose }: AirportInfoPanelProps) {
  const { t } = useTranslation(["common", "game"]);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const search = useSearch({ from: "__root__" });
  const { airline, routes, fleet, fleetByOwner, competitors, modifyHubs, openRoute, pubkey } =
    useAirlineStore();
  const setHub = useEngineStore((s) => s.setHub);

  // Default to 'info' if no valid tab is in search params
  const activeTab = search.airportTab === "flights" ? "flights" : "info";

  const setActiveTab = useCallback(
    (newTab: "info" | "flights") => {
      navigate({
        to: window.location.pathname,
        search: (prev: AirportSearchParams) => ({
          ...prev,
          airportTab: newTab === "info" ? undefined : newTab, // omit info to keep url clean
        }),
      });
    },
    [navigate],
  );

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
    if (!search.airportTab) {
      setActiveTab("info");
    }
  }, [search.airportTab, setActiveTab]);

  const hubInfo = HUB_CLASSIFICATIONS[airport.iata];
  const hubPricing = getHubPricingForIata(airport.iata);

  const playerHubs = useMemo(() => airline?.hubs ?? [], [airline?.hubs]);
  const isPlayerHub = playerHubs.includes(airport.iata);
  const isActiveHub = playerHubs[0] === airport.iata;
  const lastHub = playerHubs.length <= 1;

  const defaultOriginHub = useMemo(
    () => playerHubs.find((hub) => hub !== airport.iata) ?? playerHubs[0] ?? null,
    [playerHubs, airport.iata],
  );
  const [originHubIata, setOriginHubIata] = useState<string | null>(defaultOriginHub);

  useEffect(() => {
    setOriginHubIata(defaultOriginHub);
  }, [defaultOriginHub]);

  const originHubAirport = originHubIata ? airportIndex.get(originHubIata) : null;
  const activeHubAirport = playerHubs[0] ? airportIndex.get(playerHubs[0]) : null;
  const distanceKm = originHubAirport
    ? Math.round(
        haversineDistance(
          originHubAirport.latitude,
          originHubAirport.longitude,
          airport.latitude,
          airport.longitude,
        ),
      )
    : null;
  const hqDistanceKm = activeHubAirport
    ? Math.round(
        haversineDistance(
          activeHubAirport.latitude,
          activeHubAirport.longitude,
          airport.latitude,
          airport.longitude,
        ),
      )
    : null;

  const routesTouching = useMemo(
    () =>
      routes.filter(
        (route) => route.originIata === airport.iata || route.destinationIata === airport.iata,
      ),
    [routes, airport.iata],
  );

  const originHubRoute = useMemo(() => {
    if (!originHubIata) return null;
    return (
      routes.find(
        (route) => route.originIata === originHubIata && route.destinationIata === airport.iata,
      ) ?? null
    );
  }, [routes, airport.iata, originHubIata]);

  const stationedFleet = useMemo(
    () => fleet.filter((ac) => ac.baseAirportIata === airport.iata),
    [fleet, airport.iata],
  );

  const competitorFleet = useMemo(() => {
    const playerPubkey = pubkey ?? null;
    const result: AircraftInstance[] = [];
    fleetByOwner.forEach((ownerFleet, key) => {
      if (key !== playerPubkey) result.push(...ownerFleet);
    });
    return result;
  }, [pubkey, fleetByOwner]);

  const groundTraffic = useMemo(
    () => buildGroundTraffic(airport.iata, fleet, competitorFleet, airline ?? null, competitors),
    [airport.iata, fleet, competitorFleet, airline, competitors],
  );

  const competitorHubNames = useMemo(
    () => buildCompetitorHubEntries(competitors, airport.iata),
    [competitors, airport.iata],
  );

  const canOpenHub = airline && !isPlayerHub;
  const canSwitchHub = airline && isPlayerHub && !isActiveHub;
  const canRemoveHub = airline && isPlayerHub && !lastHub;
  const canOpenRoute =
    airline && originHubIata && originHubIata !== airport.iata && !originHubRoute;

  const handleOpenHub = async () => {
    if (!airline) return;
    const approved = await confirm({
      title: t("airportPanel.openHubTitle", { ns: "game", iata: airport.iata }),
      description: t("airportPanel.openHubDescription", {
        ns: "game",
        openFee: currencyFormat.format(hubPricing.openFee),
        monthlyOpex: currencyFormat.format(hubPricing.monthlyOpex),
      }),
      confirmLabel: t("airportPanel.openHubConfirm", { ns: "game" }),
    });
    if (!approved) return;
    try {
      await modifyHubs({ type: "add", iata: airport.iata });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(t("airportPanel.hubCreationFailed", { ns: "game" }), {
        description: message,
      });
    }
  };

  const handleSwitchHub = async () => {
    if (!airline) return;
    const relocationFee = fpScale(fp(hubPricing.openFee), 0.25);
    const approved = await confirm({
      title: t("airportPanel.relocateHqTitle", {
        ns: "game",
        iata: airport.iata,
      }),
      description: t("airportPanel.relocateHqDescription", {
        ns: "game",
        relocationFee: fpFormat(relocationFee, 0),
      }),
      confirmLabel: t("airportPanel.relocateHqConfirm", { ns: "game" }),
    });
    if (!approved) return;
    try {
      await modifyHubs({ type: "switch", iata: airport.iata });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(t("airportPanel.hqRelocationFailed", { ns: "game" }), {
        description: message,
      });
    }
  };

  const handleRemoveHub = async () => {
    if (!airline) return;
    const approved = await confirm({
      title: t("airportPanel.removeHubTitle", {
        ns: "game",
        iata: airport.iata,
      }),
      description: t("airportPanel.removeHubDescription", { ns: "game" }),
      confirmLabel: t("airportPanel.removeHubConfirm", { ns: "game" }),
      tone: "destructive",
    });
    if (!approved) return;
    try {
      await modifyHubs({ type: "remove", iata: airport.iata });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(t("airportPanel.hubRemovalFailed", { ns: "game" }), {
        description: message,
      });
    }
  };

  const handleOpenRoute = async () => {
    if (!airline || !originHubIata || !distanceKm) return;
    const approved = await confirm({
      title: t("airportPanel.openRouteTitle", {
        ns: "game",
        origin: originHubIata,
        destination: airport.iata,
      }),
      description: t("airportPanel.openRouteDescription", {
        ns: "game",
        slotFee: routeSlotFeeLabel,
        distance: distanceKm.toLocaleString(),
      }),
      confirmLabel: t("airportPanel.openRouteConfirm", { ns: "game" }),
    });
    if (!approved) return;
    try {
      await openRoute(originHubIata, airport.iata, distanceKm);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(t("airportPanel.routeOpenFailed", { ns: "game" }), {
        description: message,
      });
    }
  };

  const handleSetHome = () => {
    setHub(
      airport,
      {
        latitude: airport.latitude,
        longitude: airport.longitude,
        source: "manual",
      },
      "manual selection",
    );
    onClose();
  };

  return (
    <aside
      className={`pointer-events-auto fixed z-30 flex max-h-none flex-col overflow-hidden rounded-[24px] border border-border/80 bg-background/88 shadow-[0_26px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl left-3 right-3 ${MOBILE_TOPBAR_TOP_CLASS} ${MOBILE_OVERLAY_MAX_HEIGHT_CLASS} sm:left-auto sm:right-4 sm:top-1/2 sm:bottom-auto sm:w-[min(480px,calc(100vw-2rem))] sm:max-h-[80vh] sm:-translate-y-1/2 sm:rounded-[26px]`}
      aria-live="polite"
    >
      <div className="flex items-start justify-between border-b border-border/60 px-4 py-4 sm:px-5">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
            {t("airportPanel.title", { ns: "game" })}
          </p>
          <h3 className="text-lg font-bold text-foreground sm:text-[1.35rem]">{airport.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{airport.iata}</span>
            {airport.icao && airport.icao !== airport.iata ? (
              <span className="font-mono">{airport.icao}</span>
            ) : null}
            <span>
              {airport.city}, {airport.country}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-9 w-9 rounded-full bg-background/60 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors touch-manipulation"
          aria-label={t("airportPanel.closeAria", { ns: "game" })}
        >
          <X className="mx-auto h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-5 sm:px-5">
        <div className="flex gap-2 rounded-full border border-border/60 bg-background/70 p-1 text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
          {(
            [
              { key: "info", label: t("nav.info", { ns: "common" }) },
              {
                key: "flights",
                label: t("airportPanel.flightsTab", { ns: "game" }),
              },
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
                {t("airportPanel.hubBadge", {
                  ns: "game",
                  tier: hubInfo?.tier ?? t("airportPanel.regional", { ns: "game" }),
                })}
              </span>
              {isActiveHub ? (
                <span className="rounded-full bg-emerald-500/20 text-emerald-200 px-2.5 py-1 text-[11px] uppercase tracking-widest font-semibold">
                  {t("airportPanel.hqHub", { ns: "game" })}
                </span>
              ) : null}
              {!isActiveHub && isPlayerHub ? (
                <span className="rounded-full bg-emerald-500/10 text-emerald-200 px-2.5 py-1 text-[11px] uppercase tracking-widest font-semibold">
                  {t("airportPanel.operationalHub", { ns: "game" })}
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                  {t("airportPanel.population", { ns: "game" })}
                </p>
                <p className="mt-1 text-sm font-mono font-semibold">
                  {formatPopulation(airport.population)}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                  {t("airportPanel.gdpPerCapita", { ns: "game" })}
                </p>
                <p className="mt-1 text-sm font-mono font-semibold">
                  {currencyFormat.format(airport.gdpPerCapita)}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                  {t("airportPanel.altitude", { ns: "game" })}
                </p>
                <p className="mt-1 text-sm font-mono font-semibold">
                  {numberFormat.format(airport.altitude)} ft
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                  {t("airportPanel.timezone", { ns: "game" })}
                </p>
                <p className="mt-1 text-sm font-mono font-semibold">{airport.timezone}</p>
              </div>
              {hubInfo ? (
                <>
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      {t("airportPanel.capacityPerHour", { ns: "game" })}
                    </p>
                    <p className="mt-1 text-sm font-mono font-semibold">
                      {hubInfo.baseCapacityPerHour}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      {t("airportPanel.slotControl", { ns: "game" })}
                    </p>
                    <p className="mt-1 text-sm font-mono font-semibold">
                      {hubInfo.slotControlled
                        ? t("airportPanel.yes", { ns: "game" })
                        : t("airportPanel.no", { ns: "game" })}
                    </p>
                  </div>
                </>
              ) : null}
            </div>

            {airline ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                  <MapPin className="h-4 w-4" />
                  {t("airportPanel.yourOperations", { ns: "game" })}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      {t("airportPanel.fleetHere", { ns: "game" })}
                    </p>
                    <p className="mt-1 text-sm font-mono font-semibold">{stationedFleet.length}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      {t("airportPanel.routesTouching", { ns: "game" })}
                    </p>
                    <p className="mt-1 text-sm font-mono font-semibold">{routesTouching.length}</p>
                  </div>
                </div>
                {routesTouching.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {routesTouching.slice(0, 5).map((route) => {
                      const otherIata =
                        route.originIata === airport.iata
                          ? route.destinationIata
                          : route.originIata;
                      return (
                        <button
                          key={route.id}
                          type="button"
                          onClick={() => navigateToAirport(otherIata)}
                          className="rounded-full border border-border/50 bg-background/60 px-2 py-1 text-[11px] font-mono text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors cursor-pointer"
                        >
                          {routeLabel(route)}
                        </button>
                      );
                    })}
                    {routesTouching.length > 5 ? (
                      <span className="rounded-full border border-border/50 bg-background/60 px-2 py-1 text-[11px] font-mono text-muted-foreground">
                        {t("airportPanel.more", {
                          ns: "game",
                          count: routesTouching.length - 5,
                        })}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {competitorHubNames.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                  <Users className="h-4 w-4" />
                  {t("airportPanel.competitorHubs", { ns: "game" })}
                </div>
                <div className="flex flex-wrap gap-2">
                  {competitorHubNames.slice(0, 4).map((entry) => (
                    <span
                      key={entry.ceoPubkey}
                      className="rounded-full border border-border/50 bg-background/60 px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      {entry.name}
                      {entry.icaoCode ? ` (${entry.icaoCode})` : ""}
                    </span>
                  ))}
                  {competitorHubNames.length > 4 ? (
                    <span className="rounded-full border border-border/50 bg-background/60 px-2.5 py-1 text-[11px] text-muted-foreground">
                      {t("airportPanel.more", {
                        ns: "game",
                        count: competitorHubNames.length - 4,
                      })}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {groundTraffic.totalCount > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                  <Plane className="h-4 w-4" />
                  {t("airportPanel.groundTraffic", { ns: "game" })}
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t("airportPanel.totalOnGround", { ns: "game" })}</span>
                    <span className="font-mono font-semibold text-foreground">
                      {groundTraffic.totalCount}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {groundTraffic.entries.map((entry) => (
                      <div key={entry.key} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{
                              backgroundColor: entry.livery?.primary ?? "#94a3b8",
                            }}
                            aria-hidden="true"
                          />
                          <span
                            className={
                              entry.isPlayer
                                ? "font-semibold text-foreground"
                                : "text-muted-foreground"
                            }
                          >
                            {entry.name}
                            {entry.icaoCode ? ` (${entry.icaoCode})` : ""}
                          </span>
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">
                          {entry.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="space-y-3 rounded-[22px] border border-border/60 bg-background/55 p-4 sm:p-5">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                <Building2 className="h-4 w-4" />
                {t("airportPanel.actions", { ns: "game" })}
              </div>
              {playerHubs.length > 1 ? (
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="airport-route-origin"
                    className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold"
                  >
                    {t("airportPanel.routeOrigin", { ns: "game" })}
                  </label>
                  <select
                    id="airport-route-origin"
                    value={originHubIata ?? ""}
                    onChange={(event) => setOriginHubIata(event.target.value || null)}
                    className="h-10 rounded-xl border border-border/60 bg-background/70 px-3 text-xs font-bold text-foreground"
                  >
                    {playerHubs.map((hub) => (
                      <option key={hub} value={hub}>
                        {hub}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    {t("airportPanel.mapClicksHint", { ns: "game" })}
                  </p>
                </div>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {canOpenHub ? (
                  <button
                    type="button"
                    onClick={handleOpenHub}
                    className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:scale-[1.02] active:scale-[0.98] touch-manipulation"
                  >
                    {t("airportPanel.openHubButton", {
                      ns: "game",
                      amount: currencyFormat.format(hubPricing.openFee),
                    })}
                  </button>
                ) : null}
                {canSwitchHub ? (
                  <button
                    type="button"
                    onClick={handleSwitchHub}
                    className="flex-1 rounded-xl border border-border/60 bg-background/70 px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent touch-manipulation"
                  >
                    {t("airportPanel.relocateHqButton", { ns: "game" })}
                  </button>
                ) : null}
                {canRemoveHub ? (
                  <button
                    type="button"
                    onClick={handleRemoveHub}
                    className="flex-1 rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20 touch-manipulation"
                  >
                    {t("airportPanel.removeHubButton", { ns: "game" })}
                  </button>
                ) : null}
                {airline && isPlayerHub && lastHub ? (
                  <button
                    type="button"
                    disabled
                    className="flex-1 rounded-xl border border-border/40 bg-background/40 px-4 py-2.5 text-sm font-semibold text-muted-foreground opacity-60"
                  >
                    {t("airportPanel.lastHubLocked", { ns: "game" })}
                  </button>
                ) : null}
                {canOpenRoute ? (
                  <button
                    type="button"
                    onClick={handleOpenRoute}
                    className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent/80 touch-manipulation"
                  >
                    {t("airportPanel.openRouteButton", {
                      ns: "game",
                      distance: distanceKm?.toLocaleString() ?? "",
                      slotFee: routeSlotFeeLabel,
                    })}
                  </button>
                ) : null}
                {originHubRoute ? (
                  <button
                    type="button"
                    onClick={() => navigate({ to: "/network", search: { tab: "active" } })}
                    className="flex-1 rounded-xl border border-border/60 bg-background/70 px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent touch-manipulation"
                  >
                    {t("airportPanel.viewRoute", { ns: "game" })}
                  </button>
                ) : null}
                {!airline ? (
                  <button
                    type="button"
                    onClick={handleSetHome}
                    className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:scale-[1.02] active:scale-[0.98] touch-manipulation sm:flex-1"
                  >
                    {t("airportPanel.setAsHome", { ns: "game" })}
                  </button>
                ) : null}
              </div>
              {distanceKm && originHubAirport ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <PlaneTakeoff className="h-4 w-4" />
                  {t("airportPanel.distanceFrom", { ns: "game" })}{" "}
                  <button
                    type="button"
                    onClick={() => navigateToAirport(originHubAirport.iata)}
                    className="font-mono font-semibold text-foreground hover:text-primary transition-colors cursor-pointer"
                  >
                    {originHubAirport.iata}
                  </button>
                  : {distanceKm.toLocaleString()} km
                </div>
              ) : null}
              {!originHubAirport && hqDistanceKm && activeHubAirport ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <PlaneTakeoff className="h-4 w-4" />
                  {t("airportPanel.distanceFromHq", { ns: "game" })}{" "}
                  <button
                    type="button"
                    onClick={() => navigateToAirport(activeHubAirport.iata)}
                    className="font-mono font-semibold text-foreground hover:text-primary transition-colors cursor-pointer"
                  >
                    {activeHubAirport.iata}
                  </button>
                  : {hqDistanceKm.toLocaleString()} km
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <FlightBoard airportIata={airport.iata} airportTimezone={airport.timezone} />
        )}
      </div>
    </aside>
  );
}
