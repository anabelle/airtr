import type { Airport, FixedPoint, TimelineEvent } from "@acars/core";
import {
  CHAPTER11_BALANCE_THRESHOLD_USD,
  FP_ZERO,
  fp,
  fpAdd,
  fpDiv,
  fpFormat,
  fpScale,
  fpSub,
  fpSum,
  fpToNumber,
  getFuelPriceAtTick,
  getFuelPriceHistory,
  TICK_DURATION,
  TICKS_PER_HOUR,
  TIER_THRESHOLDS,
} from "@acars/core";
import { getAircraftById, getHubPricingForIata } from "@acars/data";
import { useActiveAirline, useAirlineStore, useEngineStore } from "@acars/store";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MapPin,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AirlineTimeline } from "@/features/airline/components/Timeline";
import { useBillingCycle } from "@/features/corporate/hooks/useBillingCycle";
import type { FinancialPulse as FinancialPulseData } from "@/features/corporate/hooks/useFinancialPulse";
import {
  RECENT_FLIGHT_COUNT,
  useFinancialPulse,
} from "@/features/corporate/hooks/useFinancialPulse";
import { useRoutePerformance } from "@/features/corporate/hooks/useRoutePerformance";
import { HubPicker } from "@/features/network/components/HubPicker";
import { getRouteDemandSnapshot } from "@/features/network/hooks/useRouteDemand";
import {
  estimateRouteEconomics,
  getPrimaryAssignedAircraft,
} from "@/features/network/utils/routeEconomics";
import { NostrAccessCard } from "@/shared/components/identity/NostrAccessCard";
import { PanelBody, PanelHeader, PanelLayout } from "@/shared/components/layout/PanelLayout";
import { useNostrProfile } from "@/shared/hooks/useNostrProfile";

const CHAPTER11_THRESHOLD_DISPLAY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
}).format(Math.abs(CHAPTER11_BALANCE_THRESHOLD_USD));

/* ------------------------------------------------------------------ */
/*  Financial Pulse                                                    */
/* ------------------------------------------------------------------ */

function FinancialPulse({
  corporateBalance,
  pulse,
  hubOpex,
  fleetLease,
  leasedCount,
  tick,
}: {
  corporateBalance: FixedPoint;
  pulse: FinancialPulseData;
  hubOpex: number;
  fleetLease: FixedPoint;
  leasedCount: number;
  tick: number;
}) {
  const { t } = useTranslation(["common", "game"]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const billingCycle = useBillingCycle();

  const totalFixedCosts = fpAdd(fp(hubOpex), fleetLease);
  // Hourly fixed-cost burn = monthly fixed costs / (30 days × 24 hours)
  const fixedCostsPerHour = fpDiv(totalFixedCosts, fp(30 * 24));
  const netIncomePerHour = pulse.flightCount > 0 ? pulse.netIncomeRate : FP_ZERO;
  const netCashFlowPerHour = fpSub(netIncomePerHour, fixedCostsPerHour);
  const netCashFlowPositive = netCashFlowPerHour >= FP_ZERO;
  const billingCyclePercent = Math.min(99, Math.floor(billingCycle.progress * 100));

  const lowConfidence = pulse.flightCount > 0 && pulse.financialFlightCount < 5;
  const fuelPrice = getFuelPriceAtTick(tick);
  const fuelHistory = useMemo(() => {
    const fuelTrendWindowHours = 4;
    const fuelTrendSampleCount = 25;
    const fuelTrendSpacingTicks =
      (fuelTrendWindowHours * TICKS_PER_HOUR) / (fuelTrendSampleCount - 1);
    return getFuelPriceHistory(tick, fuelTrendSampleCount, fuelTrendSpacingTicks);
  }, [tick]);
  const fuelMin = Math.min(...fuelHistory.map((sample) => fpToNumber(sample.price)));
  const fuelMax = Math.max(...fuelHistory.map((sample) => fpToNumber(sample.price)));
  const sparklinePoints = fuelHistory
    .map((sample, index) => {
      const x = fuelHistory.length === 1 ? 100 : (index / (fuelHistory.length - 1)) * 100;
      const price = fpToNumber(sample.price);
      const normalized = fuelMax === fuelMin ? 0.5 : (price - fuelMin) / (fuelMax - fuelMin);
      const y = 100 - normalized * 100;
      return `${x},${y}`;
    })
    .join(" ");

  // Billing cycle urgency colors
  const cycleColor =
    billingCycle.daysRemaining <= 2
      ? "bg-rose-500"
      : billingCycle.daysRemaining <= 7
        ? "bg-amber-500"
        : "bg-muted-foreground/30";

  return (
    <section className="space-y-3">
      <div className="rounded-xl border border-border/50 bg-background/50 p-5">
        {/* Main balance + rate */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("corporate.corporateBalance", { ns: "game" })}
            </p>
            <p
              className="text-2xl font-black text-foreground"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fpFormat(corporateBalance, 0)}
            </p>
          </div>

          {pulse.flightCount > 0 && (
            <div className="shrink-0 text-left sm:text-right space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t("corporate.flightRevenueRate", { ns: "game" })}
              </p>
              <div
                className={`flex items-start sm:items-center sm:justify-end gap-1 text-lg font-black ${
                  pulse.isPositive ? "text-emerald-400" : "text-rose-400"
                }`}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {pulse.isPositive ? (
                  <TrendingUp className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <TrendingDown className="h-4 w-4" aria-hidden="true" />
                )}
                {t("corporate.perHour", {
                  ns: "game",
                  amount: fpFormat(pulse.netIncomeRate, 0),
                })}
              </div>
              <p
                className={`text-[10px] font-mono font-bold ${pulse.isPositive ? "text-emerald-400/60" : "text-rose-400/60"}`}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {t("corporate.perMonthThirtyDays", {
                  ns: "game",
                  amount: fpFormat(fpScale(netIncomePerHour, 24 * 30), 0),
                })}
              </p>
              <p
                className={`text-[10px] ${lowConfidence ? "text-amber-400" : "text-muted-foreground"}`}
              >
                {lowConfidence ? "⚠ " : ""}
                {pulse.financialFlightCount !== pulse.flightCount
                  ? t("corporate.lastFlightsWithFinancials", {
                      ns: "game",
                      count: pulse.flightCount,
                      financialCount: pulse.financialFlightCount,
                    })
                  : t("corporate.lastFlights", {
                      ns: "game",
                      count: pulse.flightCount,
                    })}
                {lowConfidence ? ` — ${t("corporate.lowFinancialSample", { ns: "game" })}` : ""}
              </p>
            </div>
          )}
        </div>

        {/* Monthly fixed costs breakdown */}
        <div className="mt-3 space-y-1">
          <div className="rounded-lg border border-border/40 bg-background/60 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t("corporate.liveJetFuel", { ns: "game" })}
                </p>
                <p
                  className="text-sm font-black text-foreground"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {fpFormat(fuelPrice, 2)}/kg
                </p>
              </div>
              <div className="h-10 w-28 shrink-0 opacity-85">
                <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
                  <polyline
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    points={sparklinePoints}
                    className="text-primary/80"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              {t("corporate.fuelTrendWindow", { ns: "game" })}
            </p>
          </div>

          <div
            className="flex items-center justify-between text-xs text-muted-foreground"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <span>{t("corporate.hubOpex", { ns: "game" })}</span>
            <span>
              {fpFormat(fp(hubOpex), 0)}/mo{" "}
              <span className="text-muted-foreground/50">
                {t("corporate.monthlyWindow", { ns: "game" })}
              </span>
            </span>
          </div>
          {leasedCount > 0 && (
            <div
              className="flex items-center justify-between text-xs text-rose-400/80"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <span>{t("corporate.fleetLeases", { ns: "game", count: leasedCount })}</span>
              <span>
                {t("corporate.perMonthThirtyDays", {
                  ns: "game",
                  amount: fpFormat(fleetLease, 0),
                })}
              </span>
            </div>
          )}
          <div
            className="flex items-center justify-between text-xs font-bold border-t border-border/30 pt-1"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <span className="text-muted-foreground">
              {t("corporate.totalFixedCosts", { ns: "game" })}
            </span>
            <span className="text-rose-400">
              {t("corporate.perMonthThirtyDays", {
                ns: "game",
                amount: fpFormat(totalFixedCosts, 0),
              })}
            </span>
          </div>
        </div>

        {/* Billing cycle progress */}
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="font-bold uppercase tracking-wider">
              {t("corporate.billingCycle", { ns: "game" })}
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {t("corporate.daysRemaining", {
                ns: "game",
                count: billingCycle.daysRemaining,
              })}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${cycleColor}`}
              role="progressbar"
              aria-label={t("corporate.billingCycleProgress", { ns: "game" })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={billingCyclePercent}
              aria-valuetext={t("corporate.daysRemaining", {
                ns: "game",
                count: billingCycle.daysRemaining,
              })}
              style={{ width: `${Math.max(2, billingCyclePercent)}%` }}
            />
          </div>
          {totalFixedCosts !== FP_ZERO && (
            <p
              className="text-[10px] text-muted-foreground/60"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {t("corporate.nextDeduction", {
                ns: "game",
                amount: fpFormat(totalFixedCosts, 0),
              })}
            </p>
          )}
        </div>

        {/* Net Cash Flow — flight revenue minus fixed costs */}
        {pulse.flightCount > 0 && totalFixedCosts !== FP_ZERO && (
          <div
            className={`mt-3 rounded-lg border px-3 py-2 ${
              netCashFlowPositive
                ? "border-emerald-500/20 bg-emerald-500/5"
                : "border-rose-500/20 bg-rose-500/5"
            }`}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <div
              className={`flex items-center justify-between text-xs font-bold ${
                netCashFlowPositive ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              <span className="flex items-center gap-1">
                {netCashFlowPositive ? (
                  <TrendingUp className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <TrendingDown className="h-3 w-3" aria-hidden="true" />
                )}
                {t("corporate.netCashFlow", { ns: "game" })}
              </span>
              <span className="text-right">
                <span>
                  {netCashFlowPositive ? "+" : ""}
                  {fpFormat(netCashFlowPerHour, 0)}/hr
                </span>
                <span className="ml-2 opacity-60">
                  {netCashFlowPositive ? "+" : ""}
                  {fpFormat(fpScale(netCashFlowPerHour, 24 * 30), 0)}/mo (30 days)
                </span>
              </span>
            </div>
            <p className="mt-0.5 text-[9px] text-muted-foreground/60">
              {t("corporate.netCashFlowDescription", { ns: "game" })}
            </p>
          </div>
        )}

        {/* Progressive disclosure toggle */}
        {pulse.flightCount > 0 && (
          <button
            type="button"
            onClick={() => setShowBreakdown((s) => !s)}
            className="mt-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            {showBreakdown ? (
              <>
                <ChevronUp className="h-3 w-3" aria-hidden="true" />
                {t("corporate.hidePnl", { ns: "game" })}
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
                {t("corporate.viewPnl", { ns: "game" })}
              </>
            )}
          </button>
        )}

        {/* P&L breakdown (level 2) */}
        {showBreakdown && pulse.flightCount > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/30 pt-4 animate-in fade-in slide-in-from-top-1 duration-200">
            <PnlCell
              label={t("timeline.totalRevenue", { ns: "game" })}
              value={fpFormat(pulse.totalRevenue, 0)}
              color="text-emerald-400"
            />
            <PnlCell
              label={t("timeline.totalCosts", { ns: "game" })}
              value={fpFormat(pulse.totalCosts, 0)}
              color="text-rose-400"
            />
            <PnlCell
              label={t("corporate.avgLoadFactor", { ns: "game" })}
              value={`${Math.round(pulse.avgLoadFactor * 100)}%`}
              color={
                pulse.avgLoadFactor >= 0.75
                  ? "text-emerald-400"
                  : pulse.avgLoadFactor >= 0.5
                    ? "text-yellow-400"
                    : "text-rose-400"
              }
            />
            <PnlCell
              label={t("corporate.avgProfitPerFlight", { ns: "game" })}
              value={fpFormat(pulse.avgProfitPerFlight, 0)}
              color={pulse.avgProfitPerFlight >= 0 ? "text-emerald-400" : "text-rose-400"}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function PnlCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={`text-sm font-mono font-bold ${color}`}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </p>
    </div>
  );
}

function NetworkHealth({
  oversuppliedRoutes,
  projectedWeeklyProfit,
  routesNeedingCuts,
}: {
  oversuppliedRoutes: Array<{
    routeId: string;
    label: string;
    supplyRatio: number;
    projectedProfit: FixedPoint;
  }>;
  projectedWeeklyProfit: FixedPoint;
  routesNeedingCuts: number;
}) {
  const { t } = useTranslation("game");

  return (
    <section className="rounded-xl border border-border/50 bg-background/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {t("corporate.networkHealth")}
        </p>
        <span
          className={`text-xs font-mono font-bold ${projectedWeeklyProfit >= 0 ? "text-emerald-400" : "text-rose-400"}`}
        >
          {fpFormat(projectedWeeklyProfit, 0)}/wk
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 mb-3">
        <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
          <div className="text-[9px] uppercase text-muted-foreground font-semibold">
            {t("corporate.oversupplied")}
          </div>
          <div className="mt-1 text-sm font-bold text-rose-400">
            {oversuppliedRoutes.length} routes
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
          <div className="text-[9px] uppercase text-muted-foreground font-semibold">
            {t("corporate.needsFleetCuts")}
          </div>
          <div className="mt-1 text-sm font-bold text-amber-400">{routesNeedingCuts} routes</div>
        </div>
        <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
          <div className="text-[9px] uppercase text-muted-foreground font-semibold">
            {t("corporate.projectedNetwork")}
          </div>
          <div
            className={`mt-1 text-sm font-bold ${projectedWeeklyProfit >= 0 ? "text-emerald-400" : "text-rose-400"}`}
          >
            {projectedWeeklyProfit >= 0 ? t("corporate.profitable") : t("corporate.losingMoney")}
          </div>
        </div>
      </div>
      {oversuppliedRoutes.length > 0 && (
        <div className="space-y-2">
          {oversuppliedRoutes.slice(0, 5).map((route) => (
            <div
              key={route.routeId}
              className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2"
            >
              <div>
                <div className="text-xs font-bold text-foreground">{route.label}</div>
                <div className="text-[10px] text-muted-foreground">
                  Oversupply {route.supplyRatio.toFixed(2)}x
                </div>
              </div>
              <div
                className={`text-xs font-mono font-bold ${route.projectedProfit >= 0 ? "text-emerald-400" : "text-rose-400"}`}
              >
                {fpFormat(route.projectedProfit, 0)}/wk
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Company Profile                                                    */
/* ------------------------------------------------------------------ */

function CompanyProfile({
  name,
  icaoCode,
  callsign,
  tier,
  brandScore,
  cumulativeRevenue,
  activeRouteCount,
  status,
  ceoPubkey,
}: {
  name: string;
  icaoCode: string;
  callsign: string;
  tier: number;
  brandScore: number;
  cumulativeRevenue: FixedPoint;
  activeRouteCount: number;
  status: string;
  ceoPubkey?: string | null;
}) {
  const { t } = useTranslation("game");
  const profile = useNostrProfile(ceoPubkey ?? null);
  const npub = profile.npub;
  const airlinePrimary = useAirlineStore((s) => s.airline?.livery.primary);
  const fallbackName = ceoPubkey
    ? `${ceoPubkey.slice(0, 8)}...${ceoPubkey.slice(-4)}`
    : t("corporate.unknownCeo", { ns: "game" });
  const displayName = profile.displayName || profile.name || fallbackName;
  const avatarLetter = displayName?.[0]?.toUpperCase() ?? "?";
  const statusColors: Record<string, string> = {
    private: "bg-primary/10 border-primary/20 text-primary",
    public: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    chapter11: "bg-rose-500/10 border-rose-500/20 text-rose-400",
    liquidated: "bg-muted border-border text-muted-foreground",
  };

  const tierLabels: Record<number, string> = {
    1: t("corporate.tier1"),
    2: t("corporate.tier2"),
    3: t("corporate.tier3"),
    4: t("corporate.tier4"),
  };
  const statusLabels: Record<string, string> = {
    private: t("corporate.status.private", { ns: "game" }),
    public: t("corporate.status.public", { ns: "game" }),
    chapter11: t("corporate.status.chapter11", { ns: "game" }),
    liquidated: t("corporate.status.liquidated", { ns: "game" }),
  };

  const nextThreshold = TIER_THRESHOLDS[tier + 1] ?? null;
  const nextRevenueTarget = nextThreshold ? fpToNumber(nextThreshold.minCumulativeRevenue) : 0;
  const revenuePct = nextThreshold
    ? Math.min(100, Math.round((fpToNumber(cumulativeRevenue) / nextRevenueTarget) * 100))
    : 100;
  const routesPct = nextThreshold
    ? Math.min(100, Math.round((activeRouteCount / nextThreshold.minActiveRoutes) * 100))
    : 100;
  const revenueMet = nextThreshold ? cumulativeRevenue >= nextThreshold.minCumulativeRevenue : true;
  const routesMet = nextThreshold ? activeRouteCount >= nextThreshold.minActiveRoutes : true;

  return (
    <section className="rounded-xl border border-border/50 bg-background/50 p-4">
      <div className="flex items-center justify-between gap-3">
        {/* Left: identity */}
        <div className="min-w-0 space-y-2">
          <h2
            className="text-lg font-bold tracking-tight text-foreground truncate"
            style={{ textWrap: "balance" }}
          >
            {name}
          </h2>
          <p className="text-xs text-muted-foreground font-mono">
            {icaoCode}
            <span className="mx-1.5 text-muted-foreground/40">/</span>
            {callsign}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <a
              href={npub ? `https://primal.net/p/${npub}` : undefined}
              target={npub ? "_blank" : undefined}
              rel={npub ? "noreferrer" : undefined}
              className="h-7 w-7 overflow-hidden rounded-full border border-border/60 bg-muted/40"
              aria-label={
                npub
                  ? t("corporate.openProfileAria", {
                      ns: "game",
                      name: displayName,
                    })
                  : undefined
              }
              style={airlinePrimary ? { boxShadow: `0 0 0 2px ${airlinePrimary}` } : undefined}
            >
              {profile.image ? (
                <img
                  src={profile.image}
                  alt={displayName}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-muted-foreground">
                  {profile.isLoading ? "" : avatarLetter}
                </div>
              )}
            </a>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold text-foreground">{displayName}</span>
                {profile.nip05 && (
                  <span className="rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
                    {profile.nip05}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right: tier + status */}
        <div className="shrink-0 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("corporate.tierLabel", { ns: "game", tier })}
          </span>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase ${statusColors[status] ?? statusColors.private}`}
          >
            {statusLabels[status] ?? status}
          </span>
        </div>
      </div>

      {/* Brand score bar */}
      <div className="mt-3 flex items-center gap-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">
          {t("corporate.brand", { ns: "game" })}
        </span>
        <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${Math.round(brandScore * 100)}%` }}
          />
        </div>
        <span
          className="text-[10px] font-mono font-bold text-muted-foreground shrink-0"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {Math.round(brandScore * 100)}%
        </span>
      </div>

      {/* Tier label */}
      <p className="mt-2 text-[10px] text-muted-foreground">{tierLabels[tier] ?? `Tier ${tier}`}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {t("corporate.cumulativeRevenue", {
          ns: "game",
          amount: fpFormat(cumulativeRevenue, 0),
        })}
      </p>

      {/* Next Tier Requirements */}
      {nextThreshold ? (
        <div className="mt-3 rounded-lg border border-border/40 bg-muted/10 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("corporate.nextTierLabel", { ns: "game" })}
            </span>
            <span className="text-[10px] font-semibold text-foreground">
              {tierLabels[tier + 1]}
            </span>
          </div>
          {/* Revenue requirement */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                {revenueMet ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                ) : (
                  <div className="h-3 w-3 rounded-full border border-muted-foreground/40 shrink-0" />
                )}
                <span>{t("corporate.nextTierRevenue", { ns: "game" })}</span>
              </div>
              <span
                className="font-mono text-muted-foreground"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {fpFormat(cumulativeRevenue, 0)} / {fpFormat(nextThreshold.minCumulativeRevenue, 0)}
              </span>
            </div>
            <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${revenueMet ? "bg-emerald-500" : "bg-primary"}`}
                style={{ width: `${revenuePct}%` }}
              />
            </div>
          </div>
          {/* Active routes requirement */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                {routesMet ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                ) : (
                  <div className="h-3 w-3 rounded-full border border-muted-foreground/40 shrink-0" />
                )}
                <span>{t("corporate.nextTierRoutes", { ns: "game" })}</span>
              </div>
              <span
                className="font-mono text-muted-foreground"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {activeRouteCount} / {nextThreshold.minActiveRoutes}
              </span>
            </div>
            <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${routesMet ? "bg-emerald-500" : "bg-primary"}`}
                style={{ width: `${routesPct}%` }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
            {t("corporate.maxTierReached", { ns: "game" })}
          </span>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Bankruptcy Panel                                                   */
/* ------------------------------------------------------------------ */

function BankruptcyPanel({
  airline,
  isDissolving,
  dissolveError,
  onDissolve,
}: {
  airline: { status: string; name: string };
  isDissolving: boolean;
  dissolveError: string | null;
  onDissolve: () => Promise<void>;
}) {
  const { t } = useTranslation("common");
  const [confirmDissolve, setConfirmDissolve] = useState(false);

  return (
    <section className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
        <h3 className="text-sm font-bold text-rose-400">
          {airline.status === "chapter11"
            ? t("bankruptcy.panelChapter11Title")
            : t("bankruptcy.panelLiquidatedTitle")}
        </h3>
      </div>
      <p className="text-xs text-rose-300/70 leading-relaxed">
        {airline.status === "chapter11"
          ? t("bankruptcy.panelChapter11Desc", {
              threshold: CHAPTER11_THRESHOLD_DISPLAY,
            })
          : t("bankruptcy.panelLiquidatedDesc")}
      </p>
      {airline.status === "chapter11" && (
        <div className="rounded-lg border border-rose-500/10 bg-background/30 p-3 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-rose-300/60">
            {t("bankruptcy.whatThisMeans")}
          </p>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc list-inside">
            <li>{t("bankruptcy.consequences.grounded")}</li>
            <li>{t("bankruptcy.consequences.costsAccrue")}</li>
            <li>{t("bankruptcy.consequences.visible")}</li>
          </ul>
        </div>
      )}
      {airline.status === "chapter11" && !confirmDissolve && (
        <button
          type="button"
          onClick={() => setConfirmDissolve(true)}
          className="w-full rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-rose-300 transition hover:bg-rose-500/20"
        >
          {t("bankruptcy.dissolveStartFresh")}
        </button>
      )}
      {confirmDissolve && airline.status === "chapter11" && (
        <div className="rounded-lg border border-rose-500/20 bg-rose-950/40 p-3 space-y-3">
          <p className="text-xs text-rose-300 font-semibold">
            {t("bankruptcy.restartConfirm", { name: airline.name })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmDissolve(false)}
              className="flex-1 rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted/30"
            >
              {t("bankruptcy.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                void onDissolve();
              }}
              disabled={isDissolving}
              className="flex-1 rounded-lg border border-rose-500/40 bg-rose-500/20 px-3 py-2 text-xs font-bold text-rose-300 transition hover:bg-rose-500/30 disabled:opacity-50"
            >
              {isDissolving ? t("bankruptcy.dissolving") : t("bankruptcy.confirmDissolution")}
            </button>
          </div>
        </div>
      )}
      {dissolveError && (
        <p className="text-[11px] text-rose-300/90 rounded-lg border border-rose-500/20 bg-rose-950/40 px-3 py-2">
          {dissolveError}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Hub Card                                                           */
/* ------------------------------------------------------------------ */

function HubCard({
  iata,
  isActive,
  onSwitch,
  onClose,
  canClose,
  isReadOnly,
}: {
  iata: string;
  isActive: boolean;
  onSwitch: () => void;
  onClose: () => void;
  canClose: boolean;
  isReadOnly: boolean;
}) {
  const { t } = useTranslation(["common", "game"]);
  const pricing = getHubPricingForIata(iata);

  return (
    <div
      className={`rounded-lg border p-3 flex items-center justify-between transition-colors ${
        isActive ? "bg-primary/5 border-primary/40" : "bg-background/30 border-border/30"
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="font-mono text-base font-black text-foreground">{iata}</span>
        <span className="text-[9px] font-bold uppercase text-muted-foreground">{pricing.tier}</span>
        {isActive && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded">
            <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />
            {t("corporate.hq", { ns: "game" })}
          </span>
        )}
        <span
          className="text-[9px] font-mono text-muted-foreground"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {fpFormat(fp(pricing.monthlyOpex), 0)}/mo
        </span>
      </div>
      {!isActive && (
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onSwitch}
            disabled={isReadOnly}
            className="text-[9px] font-bold uppercase text-muted-foreground border border-border/50 px-2.5 py-1 rounded transition-colors hover:text-foreground hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("corporate.setHq", { ns: "game" })}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={!canClose || isReadOnly}
            className="text-[9px] font-bold uppercase text-rose-300/70 border border-rose-400/20 px-2.5 py-1 rounded transition-colors hover:text-rose-200 hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              isReadOnly
                ? t("corporate.viewingAnotherAirline", { ns: "game" })
                : !canClose
                  ? t("corporate.cannotCloseLastHub", { ns: "game" })
                  : undefined
            }
          >
            {t("actions.close", { ns: "common" })}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hub Confirmation Dialog                                            */
/* ------------------------------------------------------------------ */

function HubConfirmDialog({
  action,
  pricing,
  cost,
  nextMonthlyOpex,
  canAfford,
  corporateBalance,
  isProcessing,
  error,
  onConfirm,
  onCancel,
}: {
  action: { type: "add" | "switch" | "remove"; iata: string };
  pricing: { tier: string; openFee: number; monthlyOpex: number };
  cost: number;
  nextMonthlyOpex: number;
  canAfford: boolean;
  corporateBalance: number;
  isProcessing: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(["common", "game"]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    confirmRef.current?.focus();
    return () => {
      dialog.close();
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [onCancel],
  );

  const descriptions: Record<string, string> = {
    add: t("corporate.hubContractDescription.add", { ns: "game" }),
    switch: t("corporate.hubContractDescription.switch", { ns: "game" }),
    remove: t("corporate.hubContractDescription.remove", { ns: "game" }),
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === dialogRef.current) onCancel();
      }}
      aria-label={t("corporate.hubContractReviewAria", {
        ns: "game",
        iata: action.iata,
      })}
      className="fixed inset-0 z-50 m-auto w-full max-w-xl rounded-2xl border border-white/10 bg-gradient-to-br from-[#0b1117] via-[#0d1218] to-[#101722] p-0 shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm open:animate-in open:fade-in open:zoom-in-95"
      style={{ overscrollBehavior: "contain" }}
    >
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-white/40">
              {t("corporate.hubContractReview", { ns: "game" })}
            </p>
            <h3 className="mt-2 text-2xl font-black text-white" style={{ textWrap: "balance" }}>
              {action.iata} &middot; {pricing.tier.toUpperCase()}
            </h3>
            <p className="mt-1 text-sm text-white/60">{descriptions[action.type]}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("corporate.closeHubContractReview", { ns: "game" })}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-[10px] uppercase font-semibold text-white/40">
              {t("corporate.immediateCharge", { ns: "game" })}
            </p>
            <p
              className="mt-1 text-lg font-mono font-black text-white"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fpFormat(fp(cost), 0)}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-[10px] uppercase font-semibold text-white/40">
              {t("corporate.newMonthlyOpex", { ns: "game" })}
            </p>
            <p
              className="mt-1 text-lg font-mono font-black text-white"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fpFormat(fp(nextMonthlyOpex), 0)}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-[10px] uppercase font-semibold text-white/40">
              {t("corporate.cashAfter", { ns: "game" })}
            </p>
            <p
              className={`mt-1 text-lg font-mono font-black ${canAfford ? "text-emerald-300" : "text-rose-300"}`}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fpFormat(fpSub(fp(corporateBalance), fp(cost)), 0)}
            </p>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
          >
            {error}
          </p>
        )}

        {!canAfford && (
          <output className="mt-4 block rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {t("corporate.insufficientLiquidity", { ns: "game" })}
          </output>
        )}

        <div className="mt-6 flex items-center justify-between">
          <p className="text-[10px] uppercase text-white/40">
            {t("corporate.chargesApplyImmediately", { ns: "game" })}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-white/10 px-4 py-2 text-xs font-bold uppercase text-white/60 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("actions.cancel", { ns: "common" })}
            </button>
            <button
              ref={confirmRef}
              type="button"
              onClick={onConfirm}
              disabled={!canAfford || isProcessing}
              className="rounded-md bg-emerald-500/90 px-5 py-2 text-xs font-bold uppercase text-black transition-colors hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing
                ? t("corporate.processing", { ns: "game" })
                : t("corporate.confirmAndCharge", { ns: "game" })}
            </button>
          </div>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/*  Compact Activity Log                                               */
/* ------------------------------------------------------------------ */

function ActivityLog({ timeline }: { timeline: TimelineEvent[] }) {
  const { t } = useTranslation("game");
  const [expanded, setExpanded] = useState(false);
  const tick = useEngineStore((s) => s.tick);

  const recentEvents = useMemo(() => timeline.slice(0, 5), [timeline]);

  const getRelativeTime = (eventTick: number, currentTick: number) => {
    const diffSecs = Math.max(0, (currentTick - eventTick) * (TICK_DURATION / 1000));
    if (diffSecs < 10) return t("time.justNow", { ns: "common" });
    if (diffSecs < 60)
      return t("time.secondsAgo", {
        ns: "common",
        count: Math.floor(diffSecs),
      });
    if (diffSecs < 3600) {
      return t("time.minutesAgo", {
        ns: "common",
        count: Math.floor(diffSecs / 60),
      });
    }
    if (diffSecs < 86400) {
      return t("time.hoursAgo", {
        ns: "common",
        count: Math.floor(diffSecs / 3600),
      });
    }
    return t("time.daysAgo", {
      ns: "common",
      count: Math.floor(diffSecs / 86400),
    });
  };

  if (timeline.length === 0) {
    return (
      <section className="rounded-xl border border-border/50 bg-background/50 p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
          {t("corporate.activityLog", { ns: "game" })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("corporate.noEventsYet", { ns: "game" })}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border/50 bg-background/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {t("corporate.activityLog", { ns: "game" })}
        </p>
        <button
          type="button"
          onClick={() => setExpanded((s) => !s)}
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
              {t("corporate.collapse", { ns: "game" })}
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
              {t("corporate.viewAll", { ns: "game" })}
            </>
          )}
        </button>
      </div>

      {/* Compact list (level 1) */}
      {!expanded && (
        <div className="px-4 pb-3 space-y-1">
          {recentEvents.map((event) => (
            <div
              key={event.id}
              className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0 w-6 text-right">
                  {getRelativeTime(event.tick, tick)}
                </span>
                <span className="text-[10px] font-bold uppercase text-muted-foreground shrink-0">
                  {event.type.replace("_", " ")}
                </span>
                {event.originIata && event.destinationIata && (
                  <span className="text-[10px] font-mono text-muted-foreground/60 truncate">
                    {event.originIata}&rarr;{event.destinationIata}
                  </span>
                )}
              </div>
              {event.profit !== undefined && (
                <span
                  className={`text-[10px] font-mono font-bold shrink-0 ${
                    event.profit >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {event.profit >= 0 ? "+" : ""}
                  {fpFormat(event.profit, 0)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Full timeline (level 2) */}
      {expanded && <AirlineTimeline />}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Livery Strip                                                       */
/* ------------------------------------------------------------------ */

function LiveryStrip({ primary, secondary }: { primary: string; secondary: string }) {
  const { t } = useTranslation("game");
  return (
    <section className="rounded-xl border border-border/50 bg-background/50 p-3">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">
          {t("corporate.livery", { ns: "game" })}
        </span>
        <div className="flex-1 h-3 rounded-full border border-border/30 flex overflow-hidden">
          <div className="h-full" style={{ width: "70%", backgroundColor: primary }} />
          <div className="h-full" style={{ width: "30%", backgroundColor: secondary }} />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Corporate Dashboard                                                */
/* ------------------------------------------------------------------ */

export default function CorporateDashboard() {
  const { t } = useTranslation(["identity", "game"]);
  const {
    airline,
    modifyHubs,
    dissolveAirline,
    initializeIdentity,
    createNewIdentity,
    loginWithNsec,
    isLoading,
  } = useAirlineStore();
  const { fleet, timeline, routes, isViewingOther } = useActiveAirline();
  const tick = useEngineStore((s) => s.tick);
  const homeAirport = useEngineStore((s) => s.homeAirport);
  const setActiveHubIata = useEngineStore((s) => s.setActiveHubIata);

  const [pendingAction, setPendingAction] = useState<{
    type: "add" | "switch" | "remove";
    iata: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDissolving, setIsDissolving] = useState(false);
  const [dissolveError, setDissolveError] = useState<string | null>(null);

  const pulse = useFinancialPulse(timeline);

  const routePerformance = useRoutePerformance(timeline, routes);
  const routePerformanceContainerRef = useRef<HTMLDivElement>(null);
  const sortedRoutePerformance = useMemo(
    () =>
      [...routePerformance].sort(
        (a, b) => fpToNumber(b.profitPerHour) - fpToNumber(a.profitPerHour),
      ),
    [routePerformance],
  );
  const routePerformanceVirtualizer = useVirtualizer({
    count: sortedRoutePerformance.length,
    getScrollElement: () => routePerformanceContainerRef.current,
    estimateSize: () => 44,
  });

  useEffect(() => {
    if (airline?.status !== "chapter11") {
      setDissolveError(null);
    }
  }, [airline?.status]);

  const currentMonthlyOpex = useMemo(
    () => airline?.hubs.reduce((sum, hub) => sum + getHubPricingForIata(hub).monthlyOpex, 0) ?? 0,
    [airline?.hubs],
  );

  const activeRouteCount = useMemo(
    () => routes.filter((r) => r.status === "active").length,
    [routes],
  );

  const { totalMonthlyLease, leasedCount } = useMemo(() => {
    const leasedAircraft = fleet.filter((ac) => ac.purchaseType === "lease");
    const leaseAmounts = leasedAircraft.map((ac) => {
      const model = getAircraftById(ac.modelId);
      return model?.monthlyLease ?? FP_ZERO;
    });
    return {
      totalMonthlyLease: leaseAmounts.length > 0 ? fpSum(leaseAmounts) : FP_ZERO,
      leasedCount: leasedAircraft.length,
    };
  }, [fleet]);

  const networkHealth = useMemo(() => {
    const entries = routes
      .map((route) => {
        const primaryAssignment = getPrimaryAssignedAircraft(
          route.assignedAircraftIds,
          fleet,
          getAircraftById,
        );
        if (!primaryAssignment) return null;
        const snapshot = getRouteDemandSnapshot(
          route,
          useEngineStore.getState().tick,
          fleet,
          routes,
        );
        const economics = estimateRouteEconomics({
          route,
          addressableDemand: snapshot.addressableDemand,
          pressureMultiplier: snapshot.pressureMultiplier,
          effectiveLoadFactor: snapshot.effectiveLoadFactor,
          aircraft: primaryAssignment.model,
          aircraftCount: Math.max(1, route.assignedAircraftIds.length),
          cabinConfig: primaryAssignment.aircraft.configuration,
          includeFixedCosts: true,
          tick,
        });
        return {
          routeId: route.id,
          label: `${route.originIata} -> ${route.destinationIata}`,
          supplyRatio: economics.supplyRatio,
          projectedProfit: economics.profitPerWeek,
          needsCuts:
            economics.recommendedAircraftCount < Math.max(1, route.assignedAircraftIds.length),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    return {
      oversuppliedRoutes: entries
        .filter((entry) => entry.supplyRatio > 1.5)
        .sort((a, b) => b.supplyRatio - a.supplyRatio),
      projectedWeeklyProfit: fpSum(entries.map((entry) => entry.projectedProfit)),
      routesNeedingCuts: entries.filter((entry) => entry.needsCuts).length,
    };
  }, [fleet, routes, tick]);

  if (!airline && !isViewingOther) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <NostrAccessCard
          icon={Building2}
          title={t("access.corporateLockedTitle", { ns: "identity" })}
          description={t("access.corporateLockedDescription", {
            ns: "identity",
          })}
          onConnect={initializeIdentity}
          onCreateFree={createNewIdentity}
          onLoginWithNsec={loginWithNsec}
          isLoading={isLoading}
        />
      </div>
    );
  }

  const handleAddHub = (airport: Airport | null) => {
    if (!airport || !airline || airline.hubs.includes(airport.iata)) return;
    setActionError(null);
    setPendingAction({ type: "add", iata: airport.iata });
  };

  const handleSwitchActiveHub = (iata: string) => {
    setActionError(null);
    setPendingAction({ type: "switch", iata });
    setActiveHubIata(iata, "corporate hub");
  };

  const handleCloseHub = (iata: string) => {
    setActionError(null);
    setPendingAction({ type: "remove", iata });
  };

  const confirmHubAction = async () => {
    if (!pendingAction || !airline) return;
    setIsProcessing(true);
    setActionError(null);
    try {
      await modifyHubs(pendingAction);
      setPendingAction(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to complete hub action";
      setActionError(message);
    } finally {
      setIsProcessing(false);
    }
  };

  const pendingPricing = pendingAction ? getHubPricingForIata(pendingAction.iata) : null;
  const pendingSetupFee = pendingPricing ? pendingPricing.openFee : 0;
  const pendingRelocationFee = pendingPricing ? pendingPricing.openFee * 0.25 : 0;
  const pendingCostRaw =
    pendingAction?.type === "add"
      ? pendingSetupFee
      : pendingAction?.type === "switch"
        ? pendingRelocationFee
        : 0;

  const nextMonthlyOpex = pendingAction
    ? pendingAction.type === "add"
      ? currentMonthlyOpex + (pendingPricing?.monthlyOpex ?? 0)
      : pendingAction.type === "remove"
        ? Math.max(0, currentMonthlyOpex - (pendingPricing?.monthlyOpex ?? 0))
        : currentMonthlyOpex
    : currentMonthlyOpex;

  const canAfford = airline ? fp(pendingCostRaw) <= airline.corporateBalance : false;

  if (!airline) return null;

  return (
    <PanelLayout>
      <PanelHeader
        title={t("corporate.pageTitle", { ns: "game" })}
        subtitle={t("corporate.pageSubtitle", { ns: "game" })}
        badge={
          <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary sm:px-3 sm:text-xs">
            Tier {airline.tier}
          </span>
        }
      />
      <PanelBody className="pt-3 sm:pt-4">
        <div className="flex w-full flex-col gap-4">
          {/* ── Zone 1: Identity ── */}
          <CompanyProfile
            name={airline.name}
            icaoCode={airline.icaoCode}
            callsign={airline.callsign}
            tier={airline.tier}
            brandScore={airline.brandScore}
            cumulativeRevenue={airline.cumulativeRevenue}
            activeRouteCount={activeRouteCount}
            status={airline.status}
            ceoPubkey={airline.ceoPubkey}
          />
          <LiveryStrip primary={airline.livery.primary} secondary={airline.livery.secondary} />

          {/* ── Zone 2: Financials ── */}
          <FinancialPulse
            corporateBalance={airline.corporateBalance}
            pulse={pulse}
            hubOpex={currentMonthlyOpex}
            fleetLease={totalMonthlyLease}
            leasedCount={leasedCount}
            tick={tick}
          />

          {/* ── Zone 3: Network Intelligence ── */}
          {routePerformance.length > 0 && (
            <section className="rounded-xl border border-border/50 bg-background/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t("corporate.routePerformance", { ns: "game" })}
                </p>
                <span className="text-[10px] text-muted-foreground">
                  {t("corporate.lastFlights", {
                    ns: "game",
                    count: RECENT_FLIGHT_COUNT,
                  })}
                </span>
              </div>
              <div ref={routePerformanceContainerRef} className="max-h-64 overflow-y-auto">
                <div
                  className="relative w-full"
                  style={{
                    height: `${routePerformanceVirtualizer.getTotalSize()}px`,
                  }}
                >
                  {routePerformanceVirtualizer.getVirtualItems().map((virtualItem) => {
                    const route = sortedRoutePerformance[virtualItem.index];
                    const lf = Math.round(route.avgLoadFactor * 100);
                    const lfTone =
                      lf >= 80 ? "text-emerald-400" : lf >= 60 ? "text-amber-400" : "text-rose-400";
                    const profitTone =
                      route.profitPerHour >= 0 ? "text-emerald-400" : "text-rose-400";
                    return (
                      <div
                        key={route.routeId}
                        className="absolute left-0 top-0 w-full"
                        style={{
                          height: `${virtualItem.size}px`,
                          transform: `translateY(${virtualItem.start}px)`,
                        }}
                      >
                        <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-foreground">{route.label}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {route.fleetCount} aircraft
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-[10px] font-mono">
                            <span className={lfTone}>{lf}% LF</span>
                            <span className={profitTone}>
                              {fpFormat(route.profitPerHour, 0)}/hr
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          <NetworkHealth
            oversuppliedRoutes={networkHealth.oversuppliedRoutes}
            projectedWeeklyProfit={networkHealth.projectedWeeklyProfit}
            routesNeedingCuts={networkHealth.routesNeedingCuts}
          />

          {/* ── Zone 4: Operations ── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Operations Centers ({airline.hubs.length})
                </p>
              </div>
              {!isViewingOther && <HubPicker currentHub={null} onSelect={handleAddHub} />}
            </div>
            <div className="grid grid-cols-1 gap-2">
              {airline.hubs.map((hub) => (
                <HubCard
                  key={hub}
                  iata={hub}
                  isActive={homeAirport?.iata === hub}
                  onSwitch={() => handleSwitchActiveHub(hub)}
                  onClose={() => handleCloseHub(hub)}
                  canClose={!isViewingOther && airline.hubs.length > 1}
                  isReadOnly={isViewingOther}
                />
              ))}
            </div>
          </section>

          {/* Bankruptcy explanation panel */}
          {(airline.status === "chapter11" || airline.status === "liquidated") &&
            !isViewingOther && (
              <BankruptcyPanel
                key={`bankruptcy-${airline.status}`}
                airline={airline}
                isDissolving={isDissolving}
                dissolveError={dissolveError}
                onDissolve={async () => {
                  setDissolveError(null);
                  setIsDissolving(true);
                  try {
                    await dissolveAirline();
                    const latestError = useAirlineStore.getState().error;
                    if (latestError) {
                      throw new Error(latestError);
                    }
                  } catch (error) {
                    const message =
                      error instanceof Error ? error.message : "Unable to dissolve airline.";
                    console.error("Dissolution failed", error);
                    setDissolveError(message);
                  } finally {
                    setIsDissolving(false);
                  }
                }}
              />
            )}

          {/* ── Zone 5: Activity ── */}
          {isViewingOther ? (
            <section className="rounded-xl border border-border/50 bg-background/50 p-4">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t("corporate.activityLog", { ns: "game" })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("corporate.timelineUnavailable", { ns: "game" })}
              </p>
            </section>
          ) : (
            <ActivityLog timeline={timeline} />
          )}
        </div>

        {/* Hub Confirmation Dialog */}
        {!isViewingOther && pendingAction && pendingPricing && (
          <HubConfirmDialog
            action={pendingAction}
            pricing={pendingPricing}
            cost={pendingCostRaw}
            nextMonthlyOpex={nextMonthlyOpex}
            canAfford={canAfford}
            corporateBalance={
              typeof airline.corporateBalance === "number" ? airline.corporateBalance : 0
            }
            isProcessing={isProcessing}
            error={actionError}
            onConfirm={confirmHubAction}
            onCancel={() => setPendingAction(null)}
          />
        )}
      </PanelBody>
    </PanelLayout>
  );
}
