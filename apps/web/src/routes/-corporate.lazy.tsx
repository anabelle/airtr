import type { Airport, FixedPoint, TimelineEvent } from "@acars/core";
import {
  FP_ZERO,
  fp,
  fpAdd,
  fpDiv,
  fpFormat,
  fpScale,
  fpSub,
  fpSum,
  fpToNumber,
  TICK_DURATION,
} from "@acars/core";
import { getAircraftById, getHubPricingForIata } from "@acars/data";
import { useActiveAirline, useAirlineStore, useEngineStore } from "@acars/store";
import {
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
import { AirlineTimeline } from "@/features/airline/components/Timeline";
import { useBillingCycle } from "@/features/corporate/hooks/useBillingCycle";
import type { FinancialPulse as FinancialPulseData } from "@/features/corporate/hooks/useFinancialPulse";
import {
  RECENT_FLIGHT_COUNT,
  useFinancialPulse,
} from "@/features/corporate/hooks/useFinancialPulse";
import { useRoutePerformance } from "@/features/corporate/hooks/useRoutePerformance";
import { HubPicker } from "@/features/network/components/HubPicker";
import { PanelLayout } from "@/shared/components/layout/PanelLayout";
import { useNostrProfile } from "@/shared/hooks/useNostrProfile";

/* ------------------------------------------------------------------ */
/*  Financial Pulse                                                    */
/* ------------------------------------------------------------------ */

function FinancialPulse({
  corporateBalance,
  pulse,
  hubOpex,
  fleetLease,
  leasedCount,
}: {
  corporateBalance: FixedPoint;
  pulse: FinancialPulseData;
  hubOpex: number;
  fleetLease: FixedPoint;
  leasedCount: number;
}) {
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
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Corporate Balance
            </p>
            <p
              className="text-2xl font-black text-foreground"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fpFormat(corporateBalance, 0)}
            </p>
          </div>

          {pulse.flightCount > 0 && (
            <div className="shrink-0 text-right space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Flight Revenue Rate
              </p>
              <div
                className={`flex items-center justify-end gap-1 text-lg font-black ${
                  pulse.isPositive ? "text-emerald-400" : "text-rose-400"
                }`}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {pulse.isPositive ? (
                  <TrendingUp className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <TrendingDown className="h-4 w-4" aria-hidden="true" />
                )}
                {fpFormat(pulse.netIncomeRate, 0)}/hr
              </div>
              <p
                className={`text-[10px] font-mono font-bold ${pulse.isPositive ? "text-emerald-400/60" : "text-rose-400/60"}`}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {fpFormat(fpScale(netIncomePerHour, 24 * 30), 0)}/mo (30 days)
              </p>
              <p
                className={`text-[10px] ${lowConfidence ? "text-amber-400" : "text-muted-foreground"}`}
              >
                {lowConfidence ? "⚠ " : ""}Last {pulse.flightCount} flight
                {pulse.flightCount !== 1 ? "s" : ""}{" "}
                {pulse.financialFlightCount !== pulse.flightCount &&
                  `(${pulse.financialFlightCount} with full financials)`}
                {lowConfidence ? " — low financial sample" : ""}
              </p>
            </div>
          )}
        </div>

        {/* Monthly fixed costs breakdown */}
        <div className="mt-3 space-y-1">
          <div
            className="flex items-center justify-between text-xs text-muted-foreground"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <span>Hub OPEX</span>
            <span>
              {fpFormat(fp(hubOpex), 0)}/mo{" "}
              <span className="text-muted-foreground/50">(30 days)</span>
            </span>
          </div>
          {leasedCount > 0 && (
            <div
              className="flex items-center justify-between text-xs text-rose-400/80"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <span>Fleet Leases ({leasedCount} aircraft)</span>
              <span>{fpFormat(fleetLease, 0)}/mo (30 days)</span>
            </div>
          )}
          <div
            className="flex items-center justify-between text-xs font-bold border-t border-border/30 pt-1"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <span className="text-muted-foreground">Total Fixed Costs</span>
            <span className="text-rose-400">{fpFormat(totalFixedCosts, 0)}/mo (30 days)</span>
          </div>
        </div>

        {/* Billing cycle progress */}
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="font-bold uppercase tracking-wider">Billing Cycle</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {billingCycle.daysRemaining} day{billingCycle.daysRemaining !== 1 ? "s" : ""}{" "}
              remaining
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${cycleColor}`}
              role="progressbar"
              aria-label="Billing cycle progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={billingCyclePercent}
              aria-valuetext={`${billingCycle.daysRemaining} days remaining`}
              style={{ width: `${Math.max(2, billingCyclePercent)}%` }}
            />
          </div>
          {totalFixedCosts !== FP_ZERO && (
            <p
              className="text-[10px] text-muted-foreground/60"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              Next deduction: {fpFormat(totalFixedCosts, 0)}
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
                Net Cash Flow
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
              Flight revenue minus fixed costs
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
                Hide P&L
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
                View P&L Breakdown
              </>
            )}
          </button>
        )}

        {/* P&L breakdown (level 2) */}
        {showBreakdown && pulse.flightCount > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/30 pt-4 animate-in fade-in slide-in-from-top-1 duration-200">
            <PnlCell
              label="Total Revenue"
              value={fpFormat(pulse.totalRevenue, 0)}
              color="text-emerald-400"
            />
            <PnlCell
              label="Total Costs"
              value={fpFormat(pulse.totalCosts, 0)}
              color="text-rose-400"
            />
            <PnlCell
              label="Avg Load Factor"
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
              label="Avg Profit/Flight"
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

/* ------------------------------------------------------------------ */
/*  Company Profile                                                    */
/* ------------------------------------------------------------------ */

function CompanyProfile({
  name,
  icaoCode,
  callsign,
  tier,
  brandScore,
  status,
  ceoPubkey,
}: {
  name: string;
  icaoCode: string;
  callsign: string;
  tier: number;
  brandScore: number;
  status: string;
  ceoPubkey?: string | null;
}) {
  const profile = useNostrProfile(ceoPubkey ?? null);
  const npub = profile.npub;
  const airlinePrimary = useAirlineStore((s) => s.airline?.livery.primary);
  const fallbackName = ceoPubkey
    ? `${ceoPubkey.slice(0, 8)}...${ceoPubkey.slice(-4)}`
    : "Unknown CEO";
  const displayName = profile.displayName || profile.name || fallbackName;
  const avatarLetter = displayName?.[0]?.toUpperCase() ?? "?";
  const statusColors: Record<string, string> = {
    private: "bg-primary/10 border-primary/20 text-primary",
    public: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    chapter11: "bg-rose-500/10 border-rose-500/20 text-rose-400",
    liquidated: "bg-muted border-border text-muted-foreground",
  };

  const tierLabels: Record<number, string> = {
    1: "Regional Startup",
    2: "National Carrier",
    3: "Intercontinental",
    4: "Global Mega-Carrier",
  };

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
              aria-label={npub ? `Open ${displayName} on Primal` : undefined}
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
            Tier {tier}
          </span>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase ${statusColors[status] ?? statusColors.private}`}
          >
            {status}
          </span>
        </div>
      </div>

      {/* Brand score bar */}
      <div className="mt-3 flex items-center gap-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">
          Brand
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
            HQ
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
            Set HQ
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={!canClose || isReadOnly}
            className="text-[9px] font-bold uppercase text-rose-300/70 border border-rose-400/20 px-2.5 py-1 rounded transition-colors hover:text-rose-200 hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              isReadOnly
                ? "Viewing another airline"
                : !canClose
                  ? "Cannot close last hub"
                  : undefined
            }
          >
            Close
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
    add: "Opening a new hub activates market access and starts monthly operations costs.",
    switch: "Relocating your primary hub updates active operations with a relocation fee.",
    remove: "Closing a hub stops monthly operations costs for that location.",
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === dialogRef.current) onCancel();
      }}
      aria-label={`Hub contract review for ${action.iata}`}
      className="fixed inset-0 z-50 m-auto w-full max-w-xl rounded-2xl border border-white/10 bg-gradient-to-br from-[#0b1117] via-[#0d1218] to-[#101722] p-0 shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm open:animate-in open:fade-in open:zoom-in-95"
      style={{ overscrollBehavior: "contain" }}
    >
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-white/40">
              Hub Contract Review
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
            aria-label="Close hub contract review"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-[10px] uppercase font-semibold text-white/40">Immediate Charge</p>
            <p
              className="mt-1 text-lg font-mono font-black text-white"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fpFormat(fp(cost), 0)}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-[10px] uppercase font-semibold text-white/40">New Monthly OPEX</p>
            <p
              className="mt-1 text-lg font-mono font-black text-white"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fpFormat(fp(nextMonthlyOpex), 0)}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-[10px] uppercase font-semibold text-white/40">Cash After</p>
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
            Insufficient liquidity for this hub action.
          </output>
        )}

        <div className="mt-6 flex items-center justify-between">
          <p className="text-[10px] uppercase text-white/40">
            Charges apply immediately &middot; OPEX bills every 30 days
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-white/10 px-4 py-2 text-xs font-bold uppercase text-white/60 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
            <button
              ref={confirmRef}
              type="button"
              onClick={onConfirm}
              disabled={!canAfford || isProcessing}
              className="rounded-md bg-emerald-500/90 px-5 py-2 text-xs font-bold uppercase text-black transition-colors hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? "Processing\u2026" : "Confirm & Charge"}
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
  const [expanded, setExpanded] = useState(false);
  const tick = useEngineStore((s) => s.tick);

  const recentEvents = useMemo(() => timeline.slice(0, 5), [timeline]);

  const getRelativeTime = (eventTick: number, currentTick: number) => {
    const diffSecs = Math.max(0, (currentTick - eventTick) * (TICK_DURATION / 1000));
    if (diffSecs < 10) return "Now";
    if (diffSecs < 60) return `${Math.floor(diffSecs)}s`;
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m`;
    if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h`;
    return `${Math.floor(diffSecs / 86400)}d`;
  };

  if (timeline.length === 0) {
    return (
      <section className="rounded-xl border border-border/50 bg-background/50 p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
          Activity Log
        </p>
        <p className="text-xs text-muted-foreground">
          No events yet. Your history will appear here.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border/50 bg-background/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Activity Log
        </p>
        <button
          type="button"
          onClick={() => setExpanded((s) => !s)}
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
              Collapse
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
              View All
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
  return (
    <section className="rounded-xl border border-border/50 bg-background/50 p-3">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">
          Livery
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
  const { airline, modifyHubs, initializeIdentity, isLoading } = useAirlineStore();
  const { fleet, timeline, routes, isViewingOther } = useActiveAirline();
  const homeAirport = useEngineStore((s) => s.homeAirport);

  const [pendingAction, setPendingAction] = useState<{
    type: "add" | "switch" | "remove";
    iata: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const pulse = useFinancialPulse(timeline);

  const routePerformance = useRoutePerformance(timeline, routes);

  const currentMonthlyOpex = useMemo(
    () => airline?.hubs.reduce((sum, hub) => sum + getHubPricingForIata(hub).monthlyOpex, 0) ?? 0,
    [airline?.hubs],
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

  if (!airline && !isViewingOther) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="max-w-md space-y-4 rounded-2xl border border-border/60 bg-background/70 p-6 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">Corporate access locked</h2>
          <p className="text-sm text-muted-foreground">
            Connect a Nostr wallet to create an airline and manage corporate strategy.
          </p>
          <button
            type="button"
            onClick={initializeIdentity}
            disabled={isLoading}
            className="w-full rounded-md border border-border bg-background/70 px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-60"
          >
            {isLoading ? "Connecting..." : "Connect Wallet"}
          </button>
        </div>
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
      <div className="flex h-full w-full flex-col gap-4 p-5 pr-12 overflow-y-auto custom-scrollbar">
        {/* 1. Financial Pulse — the heartbeat */}
        <FinancialPulse
          corporateBalance={airline.corporateBalance}
          pulse={pulse}
          hubOpex={currentMonthlyOpex}
          fleetLease={totalMonthlyLease}
          leasedCount={leasedCount}
        />

        {routePerformance.length > 0 && (
          <section className="rounded-xl border border-border/50 bg-background/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Route Performance
              </p>
              <span className="text-[10px] text-muted-foreground">
                Last {RECENT_FLIGHT_COUNT} flights
              </span>
            </div>
            <div className="space-y-2">
              {routePerformance
                .sort((a, b) => fpToNumber(b.profitPerHour) - fpToNumber(a.profitPerHour))
                .slice(0, 6)
                .map((route) => {
                  const lf = Math.round(route.avgLoadFactor * 100);
                  const lfTone =
                    lf >= 80 ? "text-emerald-400" : lf >= 60 ? "text-amber-400" : "text-rose-400";
                  const profitTone =
                    route.profitPerHour >= 0 ? "text-emerald-400" : "text-rose-400";
                  return (
                    <div
                      key={route.routeId}
                      className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-foreground">{route.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {route.fleetCount} aircraft
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-[10px] font-mono">
                        <span className={lfTone}>{lf}% LF</span>
                        <span className={profitTone}>{fpFormat(route.profitPerHour, 0)}/hr</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        )}

        {/* 2. Company Profile — identity + tier/brand/status */}
        <CompanyProfile
          name={airline.name}
          icaoCode={airline.icaoCode}
          callsign={airline.callsign}
          tier={airline.tier}
          brandScore={airline.brandScore}
          status={airline.status}
          ceoPubkey={airline.ceoPubkey}
        />

        {/* 3. Hub Operations — actionable */}
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

        {/* 4. Livery — compact */}
        <LiveryStrip primary={airline.livery.primary} secondary={airline.livery.secondary} />

        {/* 5. Activity Log — collapsed by default */}
        {isViewingOther ? (
          <section className="rounded-xl border border-border/50 bg-background/50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Activity Log
            </p>
            <p className="text-xs text-muted-foreground">
              Timeline data is not available for other airlines yet.
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
    </PanelLayout>
  );
}
