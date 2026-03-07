import { fpFormat } from "@acars/core";
import { useActiveAirline, useAirlineStore } from "@acars/store";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
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

  if (!airline) {
    return (
      <div className="pointer-events-auto flex h-14 w-full items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-xl">
        <div className="flex items-center space-x-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/20 text-xs font-bold text-primary">
            AT
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-foreground leading-none">ACARS</h1>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
              Aircraft Communication Addressing and Relay System
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showNsecInput ? (
            <form
              className="flex flex-col items-end gap-1"
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
              <div className="flex items-center gap-2">
                <input
                  name="nsec"
                  type="password"
                  placeholder="nsec1…"
                  autoComplete="off"
                  className="w-48 rounded-md border border-border bg-background/70 px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:border-primary/60 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary transition hover:bg-primary/20 disabled:opacity-60"
                >
                  {isLoading ? "Loading…" : "Login"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNsecInputError(null);
                    setShowNsecInput(false);
                  }}
                  aria-label="Cancel nsec login"
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              </div>
              {(nsecInputError || authError) && (
                <p className="text-[10px] font-medium text-rose-400">
                  {nsecInputError ?? authError}
                </p>
              )}
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setNsecInputError(null);
                  setShowNsecInput(true);
                }}
                className="rounded-md border border-border/50 bg-background/50 px-2 py-1.5 text-[10px] font-medium text-muted-foreground/70 transition hover:border-border hover:text-muted-foreground"
                title="Login with nsec key"
              >
                nsec
              </button>
              <button
                type="button"
                onClick={initializeIdentity}
                disabled={isLoading}
                className="rounded-md border border-border bg-background/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-60"
              >
                {isLoading ? "Connecting…" : "Connect Wallet"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!activeAirline) return null;

  const isBankrupt = activeAirline.status === "chapter11" || activeAirline.status === "liquidated";

  return (
    <>
      {isBankrupt && !isViewingOther && (
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
      )}
      <div className="pointer-events-auto flex h-14 w-full items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
        <div className="flex items-center space-x-4">
          {/* Livery Box */}
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
            <h1 className="text-sm font-bold tracking-tight text-foreground leading-none">
              {activeAirline.name}
            </h1>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
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
              className="ml-4 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              Back to Your Airline
            </button>
          )}
        </div>

        {/* Critical Macro Metrics */}
        <div className="hidden items-center space-x-8 md:flex">
          {/* Relay health indicator */}
          <output
            className="flex items-center gap-1.5"
            aria-live="polite"
            title={
              isConnected
                ? `${relayCount} relay${relayCount !== 1 ? "s" : ""} connected`
                : "Disconnected from Nostr — changes may not save"
            }
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${isConnected ? "bg-emerald-400" : "bg-rose-500 animate-pulse"}`}
            />
            {!isConnected && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-rose-400">
                Offline
              </span>
            )}
            <span className="sr-only">
              {isConnected
                ? `${relayCount} relay${relayCount !== 1 ? "s" : ""} connected`
                : "Relay offline"}
            </span>
          </output>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground leading-none">
              Corporate Balance
            </span>
            <span className="font-mono text-sm font-bold text-green-400 mt-1">
              {fpFormat(activeAirline.corporateBalance)}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground leading-none">
              Stock Price
            </span>
            <span className="font-mono text-sm font-bold text-primary mt-1">
              {fpFormat(activeAirline.stockPrice)}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground leading-none">
              Brand / Tier
            </span>
            <span className="font-mono text-sm font-bold text-foreground mt-1 text-right">
              {(activeAirline.brandScore * 10).toFixed(1)}{" "}
              <span className="text-muted-foreground">T{activeAirline.tier}</span>
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground leading-none">
              Avg Load Factor
            </span>
            <span
              className={`font-mono text-sm font-bold mt-1 ${avgLoadFactor >= 0.8 ? "text-emerald-400" : avgLoadFactor >= 0.6 ? "text-amber-400" : "text-rose-400"}`}
            >
              {Math.round(avgLoadFactor * 100)}%
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
