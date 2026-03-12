import { fpFormat } from "@acars/core";
import { useActiveAirline, useAirlineStore } from "@acars/store";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Compass,
  Globe,
  Plane,
  Radar,
  ShieldCheck,
  Signal,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFinancialPulse } from "@/features/corporate/hooks/useFinancialPulse";
import { useRoutePerformance } from "@/features/corporate/hooks/useRoutePerformance";
import { PanelLayout } from "@/shared/components/layout/PanelLayout";
import { useRelayHealth } from "@/shared/hooks/useRelayHealth";
import { cn } from "@/shared/lib/utils";

const numberFormatter = new Intl.NumberFormat();
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type Tone = "neutral" | "good" | "warn" | "danger";

type ActionItem = {
  title: string;
  description: string;
  to?: string;
  action?: () => void;
  icon: typeof Activity;
  tone: Tone;
};

type StatusItem = {
  title: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone: Tone;
};

type InsightItem = {
  title: string;
  description: string;
  tone: Tone;
};

function toneClasses(tone: Tone) {
  if (tone === "good") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
  }
  if (tone === "warn") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-200";
  }
  if (tone === "danger") {
    return "border-rose-500/25 bg-rose-500/10 text-rose-200";
  }
  return "border-border/60 bg-background/60 text-foreground";
}

function HeaderCard({ item }: { item: StatusItem }) {
  const Icon = item.icon;

  return (
    <div className={cn("h-full min-w-0 rounded-2xl border p-4 shadow-sm", toneClasses(item.tone))}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {item.title}
          </p>
          <p className="mt-2 text-xl font-black tracking-tight sm:text-2xl">{item.value}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-background/50 p-2 text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
    </div>
  );
}

function ActionCard({ item }: { item: ActionItem }) {
  const Icon = item.icon;
  const className = cn(
    "group flex min-h-28 flex-col justify-between rounded-2xl border p-4 text-left transition-colors sm:min-h-32",
    toneClasses(item.tone),
  );

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-xl border border-white/10 bg-background/50 p-2 text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="mt-6">
        <h3 className="text-sm font-bold text-foreground">{item.title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
      </div>
    </>
  );

  if (item.to) {
    return (
      <Link to={item.to} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={item.action} className={className}>
      {content}
    </button>
  );
}

function InsightCard({ item }: { item: InsightItem }) {
  return (
    <div className={cn("h-full min-w-0 rounded-2xl border p-4", toneClasses(item.tone))}>
      <h3 className="text-sm font-bold text-foreground">{item.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
    </div>
  );
}

export function OperationsCockpit() {
  const { t } = useTranslation(["common", "game"]);
  const navigate = useNavigate();
  const { airline: activeAirline, fleet, routes, timeline, isViewingOther } = useActiveAirline();
  const identityStatus = useAirlineStore((state) => state.identityStatus);
  const competitors = useAirlineStore((state) => state.competitors);
  const viewAs = useAirlineStore((state) => state.viewAs);
  const { isConnected, relayCount } = useRelayHealth();
  const pulse = useFinancialPulse(timeline);
  const routePerformance = useRoutePerformance(timeline, routes);

  const activeRoutes = useMemo(() => routes.filter((route) => route.status === "active"), [routes]);
  const suspendedRoutes = useMemo(
    () => routes.filter((route) => route.status === "suspended"),
    [routes],
  );
  const idleAircraft = useMemo(
    () =>
      fleet.filter((aircraft) => aircraft.status === "idle" && aircraft.assignedRouteId === null),
    [fleet],
  );
  const unassignedRoutes = useMemo(
    () => activeRoutes.filter((route) => route.assignedAircraftIds.length === 0),
    [activeRoutes],
  );
  const sortedRoutes = useMemo(
    () => [...routePerformance].sort((a, b) => b.profitPerHour - a.profitPerHour),
    [routePerformance],
  );
  const strongestRoute = sortedRoutes[0] ?? null;
  const weakestRoute = sortedRoutes.length > 0 ? sortedRoutes[sortedRoutes.length - 1] : null;
  const recentTimeline = timeline.slice(0, 5);

  const statusCards = useMemo<StatusItem[]>(() => {
    if (!activeAirline) return [];

    return [
      {
        title: t("cockpit.status.cashPosition", { ns: "game" }),
        value: fpFormat(activeAirline.corporateBalance, 0),
        detail: isViewingOther
          ? t("cockpit.status.cashPositionCompetitor", { ns: "game" })
          : t("cockpit.status.cashPositionDetail", { ns: "game" }),
        icon: Wallet,
        tone: activeAirline.corporateBalance >= 0 ? "good" : "danger",
      },
      {
        title: t("cockpit.status.liveNetwork", { ns: "game" }),
        value: numberFormatter.format(activeRoutes.length),
        detail: t("cockpit.status.liveNetworkDetail", {
          ns: "game",
          fleet: numberFormatter.format(fleet.length),
          hubs: numberFormatter.format(activeAirline.hubs.length),
        }),
        icon: Globe,
        tone: activeRoutes.length > 0 ? "good" : "warn",
      },
      {
        title: t("cockpit.status.loadFactor", { ns: "game" }),
        value: `${Math.round(pulse.avgLoadFactor * 100)}%`,
        detail:
          pulse.flightCount > 0
            ? t("cockpit.status.loadFactorDetail", {
                ns: "game",
                count: pulse.flightCount,
              })
            : t("cockpit.status.loadFactorEmpty", { ns: "game" }),
        icon: Plane,
        tone:
          pulse.flightCount === 0
            ? "neutral"
            : pulse.avgLoadFactor >= 0.8
              ? "good"
              : pulse.avgLoadFactor >= 0.6
                ? "warn"
                : "danger",
      },
      {
        title: t("cockpit.status.relayState", { ns: "game" }),
        value: isConnected
          ? t("cockpit.status.relaysOnline", { ns: "game", count: relayCount })
          : t("cockpit.status.relaysOffline", { ns: "game" }),
        detail: isConnected
          ? t("cockpit.status.relayStateDetail", { ns: "game" })
          : t("cockpit.status.relayStateDanger", { ns: "game" }),
        icon: Signal,
        tone: isConnected ? "good" : "danger",
      },
    ];
  }, [
    activeAirline,
    activeRoutes.length,
    fleet.length,
    isConnected,
    isViewingOther,
    pulse,
    relayCount,
    t,
  ]);

  const insights = useMemo<InsightItem[]>(() => {
    if (!activeAirline) return [];

    if (isViewingOther) {
      return [
        {
          title: t("cockpit.insights.competitorMode", { ns: "game" }),
          description: t("cockpit.insights.competitorModeDesc", {
            ns: "game",
            name: activeAirline.name,
          }),
          tone: "warn",
        },
        {
          title: t("cockpit.insights.competitorFootprint", { ns: "game" }),
          description: t("cockpit.insights.competitorFootprintDesc", {
            ns: "game",
            hubs: numberFormatter.format(activeAirline.hubs.length),
            routes: numberFormatter.format(activeRoutes.length),
            fleet: numberFormatter.format(fleet.length),
          }),
          tone: activeRoutes.length > 0 ? "neutral" : "warn",
        },
      ];
    }

    const items: InsightItem[] = [];

    if (activeAirline.status === "chapter11" || activeAirline.status === "liquidated") {
      items.push({
        title: t("cockpit.insights.bankruptcy", { ns: "game" }),
        description: t("cockpit.insights.bankruptcyDesc", { ns: "game" }),
        tone: "danger",
      });
    }
    if (!isConnected) {
      items.push({
        title: t("cockpit.insights.relayRisk", { ns: "game" }),
        description: t("cockpit.insights.relayRiskDesc", { ns: "game" }),
        tone: "danger",
      });
    }
    if (activeRoutes.length === 0) {
      items.push({
        title: t("cockpit.insights.noRoutes", { ns: "game" }),
        description: t("cockpit.insights.noRoutesDesc", { ns: "game" }),
        tone: "warn",
      });
    }
    if (unassignedRoutes.length > 0) {
      items.push({
        title: t("cockpit.insights.unassignedRoutes", {
          ns: "game",
          count: unassignedRoutes.length,
        }),
        description: t("cockpit.insights.unassignedRoutesDesc", { ns: "game" }),
        tone: "warn",
      });
    }
    if (idleAircraft.length > 0) {
      items.push({
        title: t("cockpit.insights.idleAircraft", {
          ns: "game",
          count: idleAircraft.length,
        }),
        description: t("cockpit.insights.idleAircraftDesc", { ns: "game" }),
        tone: idleAircraft.length >= 3 ? "warn" : "neutral",
      });
    }
    if (suspendedRoutes.length > 0) {
      items.push({
        title: t("cockpit.insights.suspendedRoutes", {
          ns: "game",
          count: suspendedRoutes.length,
        }),
        description: t("cockpit.insights.suspendedRoutesDesc", { ns: "game" }),
        tone: "danger",
      });
    }
    if (pulse.flightCount > 0 && pulse.avgLoadFactor < 0.6) {
      items.push({
        title: t("cockpit.insights.loadFactorSoft", { ns: "game" }),
        description: t("cockpit.insights.loadFactorSoftDesc", { ns: "game" }),
        tone: "warn",
      });
    }
    if (items.length === 0) {
      items.push({
        title: t("cockpit.insights.stable", { ns: "game" }),
        description: t("cockpit.insights.stableDesc", { ns: "game" }),
        tone: "good",
      });
    }

    return items.slice(0, 4);
  }, [
    activeAirline,
    activeRoutes.length,
    fleet.length,
    idleAircraft.length,
    isConnected,
    isViewingOther,
    pulse.avgLoadFactor,
    pulse.flightCount,
    suspendedRoutes.length,
    t,
    unassignedRoutes.length,
  ]);

  const actions = useMemo<ActionItem[]>(() => {
    if (!activeAirline) {
      return [
        {
          title: t("cockpit.guest.startAirline", { ns: "game" }),
          description: t("cockpit.guest.startAirlineDesc", { ns: "game" }),
          to: "/join",
          icon: Compass,
          tone: "good",
        },
        {
          title: t("cockpit.guest.studyLeaderboard", { ns: "game" }),
          description: t("cockpit.guest.studyLeaderboardDesc", { ns: "game" }),
          to: "/leaderboard",
          icon: Radar,
          tone: "neutral",
        },
      ];
    }

    if (isViewingOther) {
      return [
        {
          title: t("cockpit.actions.returnToAirline", { ns: "game" }),
          description: t("cockpit.actions.returnToAirlineDesc", { ns: "game" }),
          action: () => viewAs(null),
          icon: ShieldCheck,
          tone: "good",
        },
        {
          title: t("cockpit.actions.compareStandings", { ns: "game" }),
          description: t("cockpit.actions.compareStandingsDesc", {
            ns: "game",
          }),
          to: "/leaderboard",
          icon: Users,
          tone: "neutral",
        },
      ];
    }

    const items: ActionItem[] = [];

    if (activeRoutes.length === 0) {
      items.push({
        title: t("cockpit.actions.openRoute", { ns: "game" }),
        description: t("cockpit.actions.openRouteDesc", { ns: "game" }),
        to: "/network",
        icon: Globe,
        tone: "good",
      });
    }
    if (unassignedRoutes.length > 0 || idleAircraft.length > 0) {
      items.push({
        title: t("cockpit.actions.deployFleet", { ns: "game" }),
        description: t("cockpit.actions.deployFleetDesc", {
          ns: "game",
          idle: numberFormatter.format(idleAircraft.length),
          routes: numberFormatter.format(unassignedRoutes.length),
        }),
        to: "/fleet",
        icon: Plane,
        tone: "warn",
      });
    }
    items.push(
      {
        title: t("cockpit.actions.tuneNetwork", { ns: "game" }),
        description: t("cockpit.actions.tuneNetworkDesc", { ns: "game" }),
        to: "/network",
        icon: Activity,
        tone: "neutral",
      },
      {
        title: t("cockpit.actions.reviewFinance", { ns: "game" }),
        description: t("cockpit.actions.reviewFinanceDesc", { ns: "game" }),
        to: "/corporate",
        icon: TrendingUp,
        tone: "neutral",
      },
      {
        title: t("cockpit.actions.scanCompetition", { ns: "game" }),
        description: t("cockpit.actions.scanCompetitionDesc", { ns: "game" }),
        to: "/leaderboard",
        icon: Radar,
        tone: "neutral",
      },
    );

    return items.slice(0, 4);
  }, [
    activeAirline,
    activeRoutes.length,
    idleAircraft.length,
    isViewingOther,
    t,
    unassignedRoutes.length,
    viewAs,
  ]);

  if (!activeAirline) {
    return (
      <PanelLayout>
        <div className="border-b border-border/60 bg-background/88 px-4 py-4 backdrop-blur-xl sm:px-6 sm:py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">
                {t("cockpit.guest.kicker", { ns: "game" })}
              </p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-foreground sm:text-3xl">
                {t("cockpit.guest.title", { ns: "game" })}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {t("cockpit.guest.subtitle", { ns: "game" })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate({ to: "/", search: { panel: "map" } })}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              title={t("panel.closeTitle", { ns: "common" })}
              aria-label={t("panel.closeAria", { ns: "common" })}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="space-y-6 px-4 py-4 sm:px-6 sm:py-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
            <div className="rounded-3xl border border-border/60 bg-card/80 p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    {t("cockpit.guest.mapTitle", { ns: "game" })}
                  </p>
                  <h2 className="mt-2 text-xl font-black tracking-tight text-foreground">
                    {t("cockpit.guest.mapHeadline", { ns: "game" })}
                  </h2>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/70 p-3 text-primary">
                  <Compass className="h-5 w-5" aria-hidden="true" />
                </div>
              </div>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                {t("cockpit.guest.mapBody", { ns: "game" })}
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <InsightCard
                  item={{
                    title: t("cockpit.guest.stepOne", { ns: "game" }),
                    description: t("cockpit.guest.stepOneDesc", { ns: "game" }),
                    tone: "neutral",
                  }}
                />
                <InsightCard
                  item={{
                    title: t("cockpit.guest.stepTwo", { ns: "game" }),
                    description: t("cockpit.guest.stepTwoDesc", { ns: "game" }),
                    tone: "neutral",
                  }}
                />
                <InsightCard
                  item={{
                    title: t("cockpit.guest.stepThree", { ns: "game" }),
                    description: t("cockpit.guest.stepThreeDesc", {
                      ns: "game",
                    }),
                    tone: "neutral",
                  }}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
              {actions.map((item) => (
                <ActionCard key={item.title} item={item} />
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-border/60 bg-background/60 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-2xl border border-border/60 bg-background/70 p-2 text-muted-foreground">
                <Users className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  {t("cockpit.guest.worldPulse", { ns: "game" })}
                </h2>
                <p className="mt-1 text-sm text-foreground">
                  {t("cockpit.guest.worldPulseDesc", {
                    ns: "game",
                    airlines: numberFormatter.format(competitors.size),
                    state:
                      identityStatus === "guest"
                        ? t("cockpit.guest.worldGuest", { ns: "game" })
                        : t("cockpit.guest.worldNoExtension", { ns: "game" }),
                  })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </PanelLayout>
    );
  }

  return (
    <PanelLayout>
      <div className="border-b border-border/60 bg-background/88 px-4 py-4 backdrop-blur-xl sm:px-6 sm:py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                {t("cockpit.kicker", { ns: "game" })}
              </span>
              {isViewingOther ? (
                <span className="inline-flex rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">
                  {t("cockpit.competitorBadge", { ns: "game" })}
                </span>
              ) : null}
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-foreground sm:text-3xl">
              {isViewingOther
                ? t("cockpit.competitorTitle", {
                    ns: "game",
                    name: activeAirline.name,
                  })
                : t("cockpit.title", { ns: "game", name: activeAirline.name })}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {isViewingOther
                ? t("cockpit.competitorSubtitle", { ns: "game" })
                : t("cockpit.subtitle", {
                    ns: "game",
                    competitors: numberFormatter.format(competitors.size),
                  })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate({ to: "/", search: { panel: "map" } })}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            title={t("panel.closeTitle", { ns: "common" })}
            aria-label={t("panel.closeAria", { ns: "common" })}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="space-y-6 px-4 py-4 sm:px-6 sm:py-5">
        <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {statusCards.map((item) => (
            <HeaderCard key={item.title} item={item} />
          ))}
        </section>

        <section className="grid gap-4 2xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
          <div className="rounded-3xl border border-border/60 bg-card/80 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {t("cockpit.priorityKicker", { ns: "game" })}
                </p>
                <h2 className="mt-2 text-xl font-black tracking-tight text-foreground">
                  {t("cockpit.priorityTitle", { ns: "game" })}
                </h2>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/70 p-3 text-primary">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {insights.map((item) => (
                <InsightCard key={item.title} item={item} />
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-1">
            {actions.map((item) => (
              <ActionCard key={item.title} item={item} />
            ))}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-3xl border border-border/60 bg-card/80 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {t("cockpit.networkKicker", { ns: "game" })}
                </p>
                <h2 className="mt-2 text-xl font-black tracking-tight text-foreground">
                  {t("cockpit.networkTitle", { ns: "game" })}
                </h2>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/70 p-3 text-primary">
                <Globe className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              <InsightCard
                item={{
                  title: t("cockpit.networkFootprint", { ns: "game" }),
                  description: t("cockpit.networkFootprintDesc", {
                    ns: "game",
                    hubs: numberFormatter.format(activeAirline.hubs.length),
                    routes: numberFormatter.format(activeRoutes.length),
                    fleet: numberFormatter.format(fleet.length),
                  }),
                  tone: "neutral",
                }}
              />
              <InsightCard
                item={{
                  title: t("cockpit.networkBestRoute", { ns: "game" }),
                  description: strongestRoute
                    ? t("cockpit.networkBestRouteDesc", {
                        ns: "game",
                        route: strongestRoute.label,
                        profit: fpFormat(strongestRoute.profitPerHour, 0),
                      })
                    : t("cockpit.networkBestRouteEmpty", { ns: "game" }),
                  tone: strongestRoute ? "good" : "neutral",
                }}
              />
              <InsightCard
                item={{
                  title: t("cockpit.networkWeakestRoute", { ns: "game" }),
                  description:
                    weakestRoute && weakestRoute.profitPerHour < 0
                      ? t("cockpit.networkWeakestRouteDesc", {
                          ns: "game",
                          route: weakestRoute.label,
                          profit: fpFormat(weakestRoute.profitPerHour, 0),
                        })
                      : t("cockpit.networkWeakestRouteEmpty", { ns: "game" }),
                  tone:
                    weakestRoute && weakestRoute.profitPerHour < 0
                      ? "danger"
                      : weakestRoute
                        ? "good"
                        : "neutral",
                }}
              />
            </div>

            {sortedRoutes.length > 0 ? (
              <div className="mt-4 space-y-3">
                {sortedRoutes.slice(0, 3).map((route) => (
                  <div
                    key={route.routeId}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/60 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">{route.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("cockpit.networkRouteMeta", {
                          ns: "game",
                          fleet: numberFormatter.format(route.fleetCount),
                          load: Math.round(route.avgLoadFactor * 100),
                        })}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "shrink-0 text-right text-sm font-black",
                        route.profitPerHour >= 0 ? "text-emerald-400" : "text-rose-400",
                      )}
                    >
                      {route.profitPerHour >= 0 ? "+" : ""}
                      {fpFormat(route.profitPerHour, 0)}/hr
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-border/60 bg-card/80 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {t("cockpit.activityKicker", { ns: "game" })}
                </p>
                <h2 className="mt-2 text-xl font-black tracking-tight text-foreground">
                  {t("cockpit.activityTitle", { ns: "game" })}
                </h2>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/70 p-3 text-primary">
                <Radar className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>

            {recentTimeline.length > 0 ? (
              <div className="mt-4 space-y-3">
                {recentTimeline.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{event.description}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {timeFormatter.format(event.timestamp)}
                        </p>
                      </div>
                      {event.profit !== undefined ? (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
                            event.profit >= 0
                              ? "bg-emerald-500/10 text-emerald-300"
                              : "bg-rose-500/10 text-rose-300",
                          )}
                        >
                          {event.profit >= 0 ? "+" : ""}
                          {fpFormat(event.profit, 0)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-border/60 bg-background/40 px-4 py-8 text-center">
                <p className="text-sm font-semibold text-foreground">
                  {t("cockpit.activityEmpty", { ns: "game" })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("cockpit.activityEmptyDesc", { ns: "game" })}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </PanelLayout>
  );
}
