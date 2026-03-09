import { FP_ZERO, fp, fpAdd, fpDiv, fpFormat, fpSub, fpSum } from "@acars/core";
import { getAircraftById, getHubPricingForIata } from "@acars/data";
import { useActiveAirline, useAirlineStore } from "@acars/store";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CircleHelp, KeyRound, Menu, Sparkles, Wallet, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EphemeralKeyBackupActions } from "@/features/identity/components/EphemeralKeyBackupActions";
import { useFinancialPulse } from "@/features/corporate/hooks/useFinancialPulse";
import { useRelayHealth } from "@/shared/hooks/useRelayHealth";

export function Topbar() {
  const airline = useAirlineStore((state) => state.airline);
  const initializeIdentity = useAirlineStore((state) => state.initializeIdentity);
  const loginWithNsec = useAirlineStore((state) => state.loginWithNsec);
  const createNewIdentity = useAirlineStore((state) => state.createNewIdentity);
  const authError = useAirlineStore((state) => state.error);
  const isEphemeral = useAirlineStore((state) => state.isEphemeral);
  const isLoading = useAirlineStore((state) => state.isLoading);
  const viewAs = useAirlineStore((state) => state.viewAs);
  const { airline: activeAirline, fleet = [], timeline, isViewingOther } = useActiveAirline();
  const navigate = useNavigate();
  const { isConnected, relayCount } = useRelayHealth();
  const safeTimeline = Array.isArray(timeline) ? timeline : [];
  const pulse = useFinancialPulse(safeTimeline);
  const avgLoadFactor = pulse.avgLoadFactor;
  const [showNsecInput, setShowNsecInput] = useState(false);
  const [nsecInputError, setNsecInputError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showKeyTools, setShowKeyTools] = useState(false);
  const { t } = useTranslation("common");

  /* Net cash flow ticker — flight revenue minus fixed costs (hub opex + fleet leases) */
  const netCashFlow = useMemo(() => {
    if (!activeAirline || pulse.flightCount === 0) return null;
    const hubOpex = activeAirline.hubs.reduce(
      (sum, hub) => sum + getHubPricingForIata(hub).monthlyOpex,
      0,
    );
    const leaseAmounts = fleet
      .filter((ac) => ac.purchaseType === "lease")
      .map((ac) => getAircraftById(ac.modelId)?.monthlyLease ?? FP_ZERO);
    const totalMonthlyLease = leaseAmounts.length > 0 ? fpSum(leaseAmounts) : FP_ZERO;
    const totalFixedCosts = fpAdd(fp(hubOpex), totalMonthlyLease);
    if (totalFixedCosts === FP_ZERO) return null;
    const fixedCostsPerHour = fpDiv(totalFixedCosts, fp(30 * 24));
    const perHour = fpSub(pulse.netIncomeRate, fixedCostsPerHour);
    return { perHour, positive: perHour >= FP_ZERO };
  }, [activeAirline, fleet, pulse]);

  const cashFlowTicker = netCashFlow ? (
    <span
      className={`font-mono text-[10px] font-semibold ${netCashFlow.positive ? "text-emerald-400" : "text-rose-400"}`}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {netCashFlow.positive ? "▲" : "▼"} {netCashFlow.positive ? "+" : ""}
      {fpFormat(netCashFlow.perHour, 0)}/hr
    </span>
  ) : null;

  const mobilePanelTitle = airline ? t("topbar.flightDeck") : t("topbar.identity");
  const mobilePanelLabel = mobilePanelTitle.toLowerCase();
  const canManageLocalKey = isEphemeral && !isViewingOther;

  function renderMobileToggle(summary: React.ReactNode) {
    return (
      <div className="pointer-events-auto absolute top-3 left-3 right-3 z-30 sm:hidden">
        <button
          type="button"
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-topbar-panel"
          aria-label={t(mobileMenuOpen ? "topbar.closePanel" : "topbar.openPanel", {
            panel: mobilePanelLabel,
          })}
          onClick={() => setMobileMenuOpen((open) => !open)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-border/80 bg-background/88 px-4 py-3 text-left shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
        >
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              {mobilePanelTitle}
            </p>
            {summary}
          </div>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/70 text-muted-foreground">
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </span>
        </button>
      </div>
    );
  }

  function renderBankruptcyBanner() {
    return activeAirline &&
      (activeAirline.status === "chapter11" || activeAirline.status === "liquidated") &&
      !isViewingOther ? (
      <div className="pointer-events-auto flex w-full items-center justify-center gap-2 border-b border-rose-500/30 bg-rose-950/80 px-4 py-2 backdrop-blur-xl">
        <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
        <span className="text-xs font-semibold text-rose-300">
          {activeAirline.status === "chapter11"
            ? t("bankruptcy.chapter11Banner")
            : t("bankruptcy.liquidatedBanner")}
        </span>
        <button
          type="button"
          onClick={() => navigate({ to: "/corporate" })}
          className="ml-2 shrink-0 rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-300 transition hover:bg-rose-500/20"
        >
          {t("bankruptcy.details")}
        </button>
      </div>
    ) : null;
  }

  if (!airline) {
    return (
      <>
        <div className="pointer-events-auto absolute top-3 left-3 right-3 z-30 sm:hidden">
          <button
            type="button"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-topbar-panel"
            aria-label={t(mobileMenuOpen ? "topbar.closePanel" : "topbar.openPanel", {
              panel: mobilePanelLabel,
            })}
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3 text-left shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
          >
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-primary/70">
                ACARS
              </p>
              <h1 className="truncate text-sm leading-none font-bold tracking-tight text-primary">
                {t("topbar.createYourAirline")}
              </h1>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            </span>
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="pointer-events-auto absolute top-[4.75rem] left-3 right-3 z-30 sm:hidden">
            <div
              id="mobile-topbar-panel"
              role="dialog"
              aria-label={mobilePanelTitle}
              className="rounded-[24px] border border-border/80 bg-background/92 px-4 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
            >
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center space-x-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/20 text-xs font-bold text-primary">
                    AT
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-sm leading-none font-bold tracking-tight text-foreground">
                      ACARS
                    </h1>
                    <p className="mt-0.5 hidden text-[10px] uppercase tracking-widest text-muted-foreground sm:block">
                      {t("topbar.acarsLong")}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground sm:hidden">
                      {t("topbar.buildOnNostr")}
                    </p>
                  </div>
                </div>

                <div className="w-full sm:w-auto">
                  {showNsecInput ? (
                    <form
                      className="flex w-full flex-col gap-2 sm:max-w-sm sm:items-end"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const normalized = (
                          e.currentTarget.elements.namedItem("nsec") as HTMLInputElement | null
                        )?.value
                          ?.trim()
                          ?.toLowerCase();
                        if (!normalized?.startsWith("nsec1")) {
                          setNsecInputError(t("topbar.enterValidNsec"));
                          return;
                        }
                        setNsecInputError(null);
                        await loginWithNsec(normalized);
                        if (useAirlineStore.getState().airline) {
                          setShowNsecInput(false);
                          setMobileMenuOpen(false);
                        }
                      }}
                    >
                      <label
                        htmlFor="topbar-nsec"
                        className="text-[11px] text-muted-foreground sm:max-w-xs sm:text-right"
                      >
                        {t("topbar.nsecLabel")}
                      </label>
                      <input
                        id="topbar-nsec"
                        name="nsec"
                        type="password"
                        placeholder={t("topbar.pasteNsec")}
                        autoComplete="off"
                        className="min-h-11 w-full rounded-md border border-border bg-background/70 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/60 focus:outline-none"
                      />
                      <div className="flex w-full gap-2 sm:justify-end">
                        <button
                          type="submit"
                          disabled={isLoading}
                          className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-60 sm:flex-none"
                        >
                          {isLoading ? t("topbar.loading") : t("topbar.signIn")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNsecInputError(null);
                            setShowNsecInput(false);
                          }}
                          aria-label={t("topbar.cancelNsecLogin")}
                          className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground transition hover:border-border hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      {(nsecInputError || authError) && (
                        <p className="text-[11px] font-medium text-rose-400">
                          {nsecInputError ?? authError}
                        </p>
                      )}
                    </form>
                  ) : (
                    <div className="flex w-full flex-col gap-2 sm:items-end">
                      <p className="text-[11px] text-muted-foreground sm:max-w-xs sm:text-right">
                        {t("topbar.newHereStart")}
                      </p>
                      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                        <button
                          type="button"
                          onClick={createNewIdentity}
                          disabled={isLoading}
                          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-primary/50 bg-primary/15 px-3 py-2 text-sm font-bold text-primary transition hover:bg-primary/25 disabled:opacity-60 sm:w-auto"
                        >
                          <Sparkles className="h-4 w-4 shrink-0" />
                          {isLoading ? t("topbar.creating") : t("topbar.playFree")}
                        </button>
                        <button
                          type="button"
                          onClick={initializeIdentity}
                          disabled={isLoading}
                          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-60 sm:w-auto"
                        >
                          <Wallet className="h-4 w-4 shrink-0" />
                          {isLoading ? t("topbar.connecting") : t("topbar.browserWallet")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNsecInputError(null);
                            setShowNsecInput(true);
                          }}
                          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground sm:w-auto"
                          title={t("topbar.nsecLabel")}
                        >
                          <KeyRound className="h-4 w-4 shrink-0" />
                          {t("topbar.haveNsec")}
                        </button>
                      </div>
                      <a
                        href="https://nostr.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center gap-2 self-start rounded-md border border-border/60 bg-background/50 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-border hover:text-foreground sm:self-end"
                      >
                        <CircleHelp className="h-4 w-4 shrink-0" />
                        {t("topbar.whatIsNostr")}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="pointer-events-auto hidden w-full border-b border-border bg-background/80 px-4 py-2.5 backdrop-blur-xl sm:block sm:px-6">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center space-x-3">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/20 text-xs font-bold text-primary">
                AT
              </div>
              <div className="min-w-0">
                <h1 className="text-sm leading-none font-bold tracking-tight text-foreground">
                  ACARS
                </h1>
                <p className="mt-0.5 hidden text-[10px] uppercase tracking-widest text-muted-foreground sm:block">
                  {t("topbar.acarsLong")}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground sm:hidden">
                  {t("topbar.buildOnNostr")}
                </p>
              </div>
            </div>

            <div className="w-full sm:w-auto">
              {showNsecInput ? (
                <form
                  className="flex w-full flex-col gap-2 sm:max-w-none sm:flex-row sm:items-center"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const normalized = (
                      e.currentTarget.elements.namedItem("nsec") as HTMLInputElement | null
                    )?.value
                      ?.trim()
                      ?.toLowerCase();
                    if (!normalized?.startsWith("nsec1")) {
                      setNsecInputError(t("topbar.enterValidNsec"));
                      return;
                    }
                    setNsecInputError(null);
                    await loginWithNsec(normalized);
                    if (useAirlineStore.getState().airline) {
                      setShowNsecInput(false);
                    }
                  }}
                >
                  <label htmlFor="topbar-nsec" className="sr-only">
                    {t("topbar.nsecLabel")}
                  </label>
                  <input
                    id="topbar-nsec"
                    name="nsec"
                    type="password"
                    placeholder={t("topbar.pasteNsec")}
                    autoComplete="off"
                    className="min-h-11 w-full rounded-md border border-border bg-background/70 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/60 focus:outline-none sm:w-72"
                  />
                  <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-60 sm:flex-none"
                    >
                      {isLoading ? t("topbar.loading") : t("topbar.signIn")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNsecInputError(null);
                        setShowNsecInput(false);
                      }}
                      aria-label={t("topbar.cancelNsecLogin")}
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground transition hover:border-border hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {(nsecInputError || authError) && (
                    <p className="text-[11px] font-medium text-rose-400">
                      {nsecInputError ?? authError}
                    </p>
                  )}
                </form>
              ) : (
                <div className="flex w-full flex-col gap-2 sm:items-end">
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                    <p className="mr-1 hidden text-[11px] text-muted-foreground lg:block">
                      {t("topbar.newHereStartDesktop")}
                    </p>
                    <button
                      type="button"
                      onClick={createNewIdentity}
                      disabled={isLoading}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-primary/50 bg-primary/15 px-3 py-2 text-sm font-bold text-primary transition hover:bg-primary/25 disabled:opacity-60 sm:w-auto"
                    >
                      <Sparkles className="h-4 w-4 shrink-0" />
                      {isLoading ? t("topbar.creating") : t("topbar.playFree")}
                    </button>
                    <button
                      type="button"
                      onClick={initializeIdentity}
                      disabled={isLoading}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-60 sm:w-auto"
                    >
                      <Wallet className="h-4 w-4 shrink-0" />
                      {isLoading ? t("topbar.connecting") : t("topbar.browserWallet")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNsecInputError(null);
                        setShowNsecInput(true);
                      }}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground sm:w-auto"
                      title={t("topbar.nsecLabel")}
                    >
                      <KeyRound className="h-4 w-4 shrink-0" />
                      {t("topbar.haveNsec")}
                    </button>
                    <a
                      href="https://nostr.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hidden min-h-11 items-center gap-2 rounded-md border border-border/60 bg-background/50 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-border hover:text-foreground xl:inline-flex"
                    >
                      <CircleHelp className="h-4 w-4 shrink-0" />
                      {t("topbar.whatIsNostr")}
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!activeAirline) return null;

  return (
    <>
      {renderMobileToggle(
        <>
          <h1 className="truncate text-sm leading-none font-bold tracking-tight text-foreground">
            {activeAirline.name}
          </h1>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {activeAirline.callsign} · {fpFormat(activeAirline.corporateBalance)}
            {cashFlowTicker && <span className="ml-1.5">{cashFlowTicker}</span>}
          </p>
        </>,
      )}

      {mobileMenuOpen && (
        <div
          className="pointer-events-auto absolute top-[4.75rem] left-3 right-3 z-30 rounded-[24px] border border-border/80 bg-background/92 px-4 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:hidden"
          id="mobile-topbar-panel"
          role="dialog"
          aria-label={mobilePanelTitle}
        >
          {renderBankruptcyBanner()}
          <div className="flex w-full flex-col gap-3 md:min-h-14 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-4">
              <div
                className="flex h-8 w-8 items-center justify-center rounded uppercase text-[10px] font-bold shadow-sm"
                style={{
                  backgroundColor: activeAirline.livery.primary,
                  color: activeAirline.livery.secondary,
                  border: `1px solid ${activeAirline.livery.secondary}40`,
                }}
              >
                {activeAirline.icaoCode}
              </div>
              <div className="min-w-0">
                <h1 className="text-sm leading-none font-bold tracking-tight text-foreground">
                  {activeAirline.name}
                </h1>
                <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                  {activeAirline.callsign}
                </p>
              </div>
              {isViewingOther && (
                <button
                  type="button"
                  onClick={() => {
                    viewAs(null);
                    navigate({ to: "/" });
                    setMobileMenuOpen(false);
                  }}
                  className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:border-primary/40 hover:text-foreground"
                >
                  {t("topbar.backToYourAirline")}
                </button>
              )}
              {canManageLocalKey && (
                <button
                  type="button"
                  onClick={() => setShowKeyTools((open) => !open)}
                  className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-200 transition hover:bg-amber-500/20"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" />
                    {showKeyTools ? t("topbar.hideKeyTools") : t("topbar.accountKey")}
                  </span>
                </button>
              )}
            </div>

            <div
              data-testid="topbar-metrics"
              className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:items-center md:space-x-6"
            >
              <output
                className="col-span-2 flex min-h-11 items-center gap-2 rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:border-0 md:bg-transparent md:p-0"
                aria-live="polite"
                title={
                  isConnected
                    ? t("topbar.relaysConnected", { count: relayCount })
                    : t("topbar.disconnectedWarning")
                }
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${isConnected ? "bg-emerald-400" : "animate-pulse bg-rose-500"}`}
                />
                <span className="text-[11px] font-medium text-muted-foreground">
                  {isConnected
                    ? t("topbar.relaysOnline", { count: relayCount })
                    : t("topbar.relaysOffline")}
                </span>
              </output>
              <div className="flex min-h-11 flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:items-end md:border-0 md:bg-transparent md:p-0">
                <span className="text-[10px] leading-none font-semibold uppercase text-muted-foreground">
                  {t("topbar.corporateBalance")}
                </span>
                <span className="mt-1 flex items-baseline gap-1.5">
                  <span className="font-mono text-sm font-bold text-green-400">
                    {fpFormat(activeAirline.corporateBalance)}
                  </span>
                  {cashFlowTicker}
                </span>
              </div>
              <div className="flex min-h-11 flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:items-end md:border-0 md:bg-transparent md:p-0">
                <span className="text-[10px] leading-none font-semibold uppercase text-muted-foreground">
                  {t("topbar.brandTier")}
                </span>
                <span className="mt-1 font-mono text-sm font-bold text-foreground md:text-right">
                  {(activeAirline.brandScore * 10).toFixed(1)}{" "}
                  <span className="text-muted-foreground">T{activeAirline.tier}</span>
                </span>
              </div>
              <div className="flex min-h-11 flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:items-end md:border-0 md:bg-transparent md:p-0">
                <span className="text-[10px] leading-none font-semibold uppercase text-muted-foreground">
                  {t("topbar.avgLoadFactor")}
                </span>
                <span
                  className={`mt-1 font-mono text-sm font-bold ${avgLoadFactor >= 0.8 ? "text-emerald-400" : avgLoadFactor >= 0.6 ? "text-amber-400" : "text-rose-400"}`}
                >
                  {Math.round(avgLoadFactor * 100)}%
                </span>
              </div>
            </div>
          </div>
          {canManageLocalKey && showKeyTools && (
            <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-950/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
                {t("topbar.localAccountKey")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
                {t("topbar.exportRecoveryKey")}
              </p>
              <div className="mt-3">
                <EphemeralKeyBackupActions />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="hidden sm:block">{renderBankruptcyBanner()}</div>
      <div className="pointer-events-auto hidden w-full border-b border-border bg-background/80 px-4 py-3 backdrop-blur-xl sm:block sm:px-6 md:py-2">
        <div className="flex w-full flex-col gap-3 md:min-h-14 md:justify-between">
          <div className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-4">
              <div
                className="flex h-8 w-8 items-center justify-center rounded uppercase text-[10px] font-bold shadow-sm"
                style={{
                  backgroundColor: activeAirline.livery.primary,
                  color: activeAirline.livery.secondary,
                  border: `1px solid ${activeAirline.livery.secondary}40`,
                }}
              >
                {activeAirline.icaoCode}
              </div>
              <div className="min-w-0">
                <h1 className="text-sm leading-none font-bold tracking-tight text-foreground">
                  {activeAirline.name}
                </h1>
                <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                  {activeAirline.callsign}
                </p>
              </div>
              {isViewingOther && (
                <button
                  type="button"
                  onClick={() => {
                    viewAs(null);
                    navigate({ to: "/" });
                  }}
                  className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:border-primary/40 hover:text-foreground"
                >
                  {t("topbar.backToYourAirline")}
                </button>
              )}
              {canManageLocalKey && (
                <button
                  type="button"
                  onClick={() => setShowKeyTools((open) => !open)}
                  className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-200 transition hover:bg-amber-500/20"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" />
                    {showKeyTools ? t("topbar.hideKeyTools") : t("topbar.accountKey")}
                  </span>
                </button>
              )}
            </div>

            <div
              data-testid="topbar-metrics"
              className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:items-center md:space-x-6"
            >
              <output
                className="col-span-2 flex min-h-11 items-center gap-2 rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:border-0 md:bg-transparent md:p-0"
                aria-live="polite"
                title={
                  isConnected
                    ? t("topbar.relaysConnected", { count: relayCount })
                    : t("topbar.disconnectedWarning")
                }
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${isConnected ? "bg-emerald-400" : "animate-pulse bg-rose-500"}`}
                />
                <span className="text-[11px] font-medium text-muted-foreground">
                  {isConnected
                    ? t("topbar.relaysOnline", { count: relayCount })
                    : t("topbar.relaysOffline")}
                </span>
              </output>
              <div className="flex min-h-11 flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:items-end md:border-0 md:bg-transparent md:p-0">
                <span className="text-[10px] leading-none font-semibold uppercase text-muted-foreground">
                  {t("topbar.corporateBalance")}
                </span>
                <span className="mt-1 flex items-baseline gap-1.5">
                  <span className="font-mono text-sm font-bold text-green-400">
                    {fpFormat(activeAirline.corporateBalance)}
                  </span>
                  {cashFlowTicker}
                </span>
              </div>
              <div className="flex min-h-11 flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:items-end md:border-0 md:bg-transparent md:p-0">
                <span className="text-[10px] leading-none font-semibold uppercase text-muted-foreground">
                  {t("topbar.brandTier")}
                </span>
                <span className="mt-1 font-mono text-sm font-bold text-foreground md:text-right">
                  {(activeAirline.brandScore * 10).toFixed(1)}{" "}
                  <span className="text-muted-foreground">T{activeAirline.tier}</span>
                </span>
              </div>
              <div className="flex min-h-11 flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:items-end md:border-0 md:bg-transparent md:p-0">
                <span className="text-[10px] leading-none font-semibold uppercase text-muted-foreground">
                  {t("topbar.avgLoadFactor")}
                </span>
                <span
                  className={`mt-1 font-mono text-sm font-bold ${avgLoadFactor >= 0.8 ? "text-emerald-400" : avgLoadFactor >= 0.6 ? "text-amber-400" : "text-rose-400"}`}
                >
                  {Math.round(avgLoadFactor * 100)}%
                </span>
              </div>
            </div>
          </div>
          {canManageLocalKey && showKeyTools && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-950/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
                {t("topbar.localAccountKey")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
                {t("topbar.exportRecoveryKey")}
              </p>
              <div className="mt-3">
                <EphemeralKeyBackupActions />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
