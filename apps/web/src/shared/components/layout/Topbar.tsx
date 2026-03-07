import { fpFormat } from "@acars/core";
import { useActiveAirline, useAirlineStore } from "@acars/store";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CircleHelp, KeyRound, Menu, Wallet, X } from "lucide-react";
import { useState } from "react";
import { useFinancialPulse } from "@/features/corporate/hooks/useFinancialPulse";
import { useRelayHealth } from "@/shared/hooks/useRelayHealth";

export function Topbar() {
  const airline = useAirlineStore((state) => state.airline);
  const initializeIdentity = useAirlineStore((state) => state.initializeIdentity);
  const loginWithNsec = useAirlineStore((state) => state.loginWithNsec);
  const authError = useAirlineStore((state) => state.error);
  const isLoading = useAirlineStore((state) => state.isLoading);
  const viewAs = useAirlineStore((state) => state.viewAs);
  const { airline: activeAirline, timeline, isViewingOther } = useActiveAirline();
  const navigate = useNavigate();
  const { isConnected, relayCount } = useRelayHealth();
  const safeTimeline = Array.isArray(timeline) ? timeline : [];
  const pulse = useFinancialPulse(safeTimeline);
  const avgLoadFactor = pulse.avgLoadFactor;
  const [showNsecInput, setShowNsecInput] = useState(false);
  const [nsecInputError, setNsecInputError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const mobilePanelTitle = airline ? "Flight deck" : "Identity";
  const mobilePanelLabel = mobilePanelTitle.toLowerCase();

  function renderMobileToggle(summary: React.ReactNode) {
    return (
      <div className="pointer-events-auto absolute top-3 left-3 right-3 z-30 sm:hidden">
        <button
          type="button"
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-topbar-panel"
          aria-label={`${mobileMenuOpen ? "Close" : "Open"} ${mobilePanelLabel}`}
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
            ? "Chapter 11 Bankruptcy — All operations suspended"
            : "Airline Liquidated — This airline has ceased operations"}
        </span>
        <button
          type="button"
          onClick={() => navigate({ to: "/corporate" })}
          className="ml-2 shrink-0 rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-300 transition hover:bg-rose-500/20"
        >
          Details
        </button>
      </div>
    ) : null;
  }

  if (!airline) {
    return (
      <>
        {renderMobileToggle(
          <>
            <h1 className="truncate text-sm leading-none font-bold tracking-tight text-foreground">
              ACARS
            </h1>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              Open identity controls
            </p>
          </>,
        )}

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
                      Aircraft Communication Addressing and Relay System
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground sm:hidden">
                      Build your airline on Nostr. New here? Start with a browser wallet.
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
                          setNsecInputError("Enter a valid nsec1 key.");
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
                        Already have a Nostr secret key? Paste your nsec1 to sign in.
                      </label>
                      <input
                        id="topbar-nsec"
                        name="nsec"
                        type="password"
                        placeholder="Paste your nsec1 key"
                        autoComplete="off"
                        className="min-h-11 w-full rounded-md border border-border bg-background/70 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/60 focus:outline-none"
                      />
                      <div className="flex w-full gap-2 sm:justify-end">
                        <button
                          type="submit"
                          disabled={isLoading}
                          className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-60 sm:flex-none"
                        >
                          {isLoading ? "Loading…" : "Sign in"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNsecInputError(null);
                            setShowNsecInput(false);
                          }}
                          aria-label="Cancel nsec login"
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
                        New to Nostr? Start with a browser wallet. Already have a key? Import it
                        directly.
                      </p>
                      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                        <button
                          type="button"
                          onClick={initializeIdentity}
                          disabled={isLoading}
                          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-60 sm:w-auto"
                        >
                          <Wallet className="h-4 w-4 shrink-0" />
                          {isLoading ? "Connecting…" : "Continue with browser wallet"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNsecInputError(null);
                            setShowNsecInput(true);
                          }}
                          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground sm:w-auto"
                          title="Sign in with an existing nsec key"
                        >
                          <KeyRound className="h-4 w-4 shrink-0" />I already have an nsec key
                        </button>
                      </div>
                      <a
                        href="https://nostr.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center gap-2 self-start rounded-md border border-border/60 bg-background/50 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-border hover:text-foreground sm:self-end"
                      >
                        <CircleHelp className="h-4 w-4 shrink-0" />
                        What is Nostr?
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="pointer-events-auto hidden w-full border-b border-border bg-background/80 px-4 py-3 backdrop-blur-xl sm:block sm:px-6">
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
                  Aircraft Communication Addressing and Relay System
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground sm:hidden">
                  Build your airline on Nostr. New here? Start with a browser wallet.
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
                      setNsecInputError("Enter a valid nsec1 key.");
                      return;
                    }
                    setNsecInputError(null);
                    await loginWithNsec(normalized);
                    if (useAirlineStore.getState().airline) {
                      setShowNsecInput(false);
                    }
                  }}
                >
                  <label
                    htmlFor="topbar-nsec"
                    className="text-[11px] text-muted-foreground sm:max-w-xs sm:text-right"
                  >
                    Already have a Nostr secret key? Paste your nsec1 to sign in.
                  </label>
                  <input
                    id="topbar-nsec"
                    name="nsec"
                    type="password"
                    placeholder="Paste your nsec1 key"
                    autoComplete="off"
                    className="min-h-11 w-full rounded-md border border-border bg-background/70 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/60 focus:outline-none"
                  />
                  <div className="flex w-full gap-2 sm:justify-end">
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-60 sm:flex-none"
                    >
                      {isLoading ? "Loading…" : "Sign in"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNsecInputError(null);
                        setShowNsecInput(false);
                      }}
                      aria-label="Cancel nsec login"
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
                    New to Nostr? Start with a browser wallet. Already have a key? Import it
                    directly.
                  </p>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <button
                      type="button"
                      onClick={initializeIdentity}
                      disabled={isLoading}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-60 sm:w-auto"
                    >
                      <Wallet className="h-4 w-4 shrink-0" />
                      {isLoading ? "Connecting…" : "Continue with browser wallet"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNsecInputError(null);
                        setShowNsecInput(true);
                      }}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground sm:w-auto"
                      title="Sign in with an existing nsec key"
                    >
                      <KeyRound className="h-4 w-4 shrink-0" />I already have an nsec key
                    </button>
                  </div>
                  <a
                    href="https://nostr.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-2 self-start rounded-md border border-border/60 bg-background/50 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-border hover:text-foreground sm:self-end"
                  >
                    <CircleHelp className="h-4 w-4 shrink-0" />
                    What is Nostr?
                  </a>
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
          <div className="flex w-full flex-col gap-3 md:h-14 md:flex-row md:items-center md:justify-between">
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
                  Back to Your Airline
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
                    ? `${relayCount} relay${relayCount !== 1 ? "s" : ""} connected`
                    : "Disconnected from Nostr — changes may not save"
                }
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${isConnected ? "bg-emerald-400" : "animate-pulse bg-rose-500"}`}
                />
                <span className="text-[11px] font-medium text-muted-foreground">
                  {isConnected
                    ? `${relayCount} relay${relayCount !== 1 ? "s" : ""} online`
                    : "Nostr relays offline"}
                </span>
              </output>
              <div className="flex min-h-11 flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:items-end md:border-0 md:bg-transparent md:p-0">
                <span className="text-[10px] leading-none font-semibold uppercase text-muted-foreground">
                  Corporate Balance
                </span>
                <span className="mt-1 font-mono text-sm font-bold text-green-400">
                  {fpFormat(activeAirline.corporateBalance)}
                </span>
              </div>
              <div className="flex min-h-11 flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:items-end md:border-0 md:bg-transparent md:p-0">
                <span className="text-[10px] leading-none font-semibold uppercase text-muted-foreground">
                  Stock Price
                </span>
                <span className="mt-1 font-mono text-sm font-bold text-primary">
                  {fpFormat(activeAirline.stockPrice)}
                </span>
              </div>
              <div className="flex min-h-11 flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:items-end md:border-0 md:bg-transparent md:p-0">
                <span className="text-[10px] leading-none font-semibold uppercase text-muted-foreground">
                  Brand / Tier
                </span>
                <span className="mt-1 font-mono text-sm font-bold text-foreground md:text-right">
                  {(activeAirline.brandScore * 10).toFixed(1)}{" "}
                  <span className="text-muted-foreground">T{activeAirline.tier}</span>
                </span>
              </div>
              <div className="flex min-h-11 flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:items-end md:border-0 md:bg-transparent md:p-0">
                <span className="text-[10px] leading-none font-semibold uppercase text-muted-foreground">
                  Avg Load Factor
                </span>
                <span
                  className={`mt-1 font-mono text-sm font-bold ${avgLoadFactor >= 0.8 ? "text-emerald-400" : avgLoadFactor >= 0.6 ? "text-amber-400" : "text-rose-400"}`}
                >
                  {Math.round(avgLoadFactor * 100)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="hidden sm:block">{renderBankruptcyBanner()}</div>
      <div className="pointer-events-auto hidden w-full border-b border-border bg-background/80 px-4 py-3 backdrop-blur-xl sm:block sm:px-6 md:py-2">
        <div className="flex w-full flex-col gap-3 md:h-14 md:flex-row md:items-center md:justify-between">
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
                Back to Your Airline
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
                  ? `${relayCount} relay${relayCount !== 1 ? "s" : ""} connected`
                  : "Disconnected from Nostr — changes may not save"
              }
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${isConnected ? "bg-emerald-400" : "animate-pulse bg-rose-500"}`}
              />
              <span className="text-[11px] font-medium text-muted-foreground">
                {isConnected
                  ? `${relayCount} relay${relayCount !== 1 ? "s" : ""} online`
                  : "Nostr relays offline"}
              </span>
            </output>
            <div className="flex min-h-11 flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:items-end md:border-0 md:bg-transparent md:p-0">
              <span className="text-[10px] leading-none font-semibold uppercase text-muted-foreground">
                Corporate Balance
              </span>
              <span className="mt-1 font-mono text-sm font-bold text-green-400">
                {fpFormat(activeAirline.corporateBalance)}
              </span>
            </div>
            <div className="flex min-h-11 flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:items-end md:border-0 md:bg-transparent md:p-0">
              <span className="text-[10px] leading-none font-semibold uppercase text-muted-foreground">
                Stock Price
              </span>
              <span className="mt-1 font-mono text-sm font-bold text-primary">
                {fpFormat(activeAirline.stockPrice)}
              </span>
            </div>
            <div className="flex min-h-11 flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:items-end md:border-0 md:bg-transparent md:p-0">
              <span className="text-[10px] leading-none font-semibold uppercase text-muted-foreground">
                Brand / Tier
              </span>
              <span className="mt-1 font-mono text-sm font-bold text-foreground md:text-right">
                {(activeAirline.brandScore * 10).toFixed(1)}{" "}
                <span className="text-muted-foreground">T{activeAirline.tier}</span>
              </span>
            </div>
            <div className="flex min-h-11 flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 md:min-h-0 md:items-end md:border-0 md:bg-transparent md:p-0">
              <span className="text-[10px] leading-none font-semibold uppercase text-muted-foreground">
                Avg Load Factor
              </span>
              <span
                className={`mt-1 font-mono text-sm font-bold ${avgLoadFactor >= 0.8 ? "text-emerald-400" : avgLoadFactor >= 0.6 ? "text-amber-400" : "text-rose-400"}`}
              >
                {Math.round(avgLoadFactor * 100)}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
