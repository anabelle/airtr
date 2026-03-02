import { fpFormat } from "@acars/core";
import { useAirlineStore } from "@acars/store";
import { AlertTriangle, Skull, X } from "lucide-react";
import React from "react";

export function BankruptcyOverlay() {
  const airline = useAirlineStore((s) => s.airline);
  const dissolveAirline = useAirlineStore((s) => s.dissolveAirline);
  const isLoading = useAirlineStore((s) => s.isLoading);
  const [dismissed, setDismissed] = React.useState(false);
  const [confirmDissolve, setConfirmDissolve] = React.useState(false);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const airlineId = airline?.id ?? null;
  const airlineStatus = airline?.status ?? null;
  const isOverlayStatus = airlineStatus === "chapter11" || airlineStatus === "liquidated";

  React.useEffect(() => {
    setDismissed(false);
    setConfirmDissolve(false);
  }, [airlineId, airlineStatus]);

  React.useEffect(() => {
    if (!isOverlayStatus) return;
    if (dismissed) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDismissed(true);
        return;
      }
      if (event.key !== "Tab") return;

      const container = dialogRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [dismissed, isOverlayStatus, airlineId]);

  if (!airline) return null;
  if (airline.status !== "chapter11" && airline.status !== "liquidated") return null;
  if (dismissed) return null;

  const isLiquidated = airline.status === "liquidated";

  const handleDissolve = async () => {
    await dissolveAirline();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        className="relative mx-4 max-w-md w-full rounded-2xl border border-rose-500/30 bg-background/95 p-6 shadow-2xl backdrop-blur-xl"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={() => setDismissed(true)}
          className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center text-center space-y-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/10 border border-rose-500/20">
            {isLiquidated ? (
              <Skull className="h-8 w-8 text-rose-500" />
            ) : (
              <AlertTriangle className="h-8 w-8 text-rose-500" />
            )}
          </div>

          <div className="space-y-1">
            <h2 id={titleId} className="text-lg font-bold text-rose-400">
              {isLiquidated ? "Airline Liquidated" : "Chapter 11 Bankruptcy"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {airline.icaoCode} — {airline.name}
            </p>
          </div>

          <div className="w-full rounded-lg border border-rose-500/10 bg-rose-950/30 p-4 text-left space-y-2">
            <p className="text-xs text-rose-300/80">
              {isLiquidated
                ? "This airline has been permanently dissolved. All aircraft have been grounded and operations have ceased."
                : "Your airline's debt has exceeded the critical threshold. All flight operations have been suspended and aircraft grounded."}
            </p>
            <div className="flex items-center justify-between border-t border-rose-500/10 pt-2">
              <span className="text-[10px] font-semibold uppercase text-rose-300/60">
                Corporate Balance
              </span>
              <span className="font-mono text-sm font-bold text-rose-400">
                {fpFormat(airline.corporateBalance)}
              </span>
            </div>
          </div>

          {!isLiquidated && !confirmDissolve && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              You can dissolve this airline and start fresh with a new company, or dismiss this to
              review your finances in the <strong className="text-foreground">Corporate</strong>{" "}
              tab.
            </p>
          )}

          {confirmDissolve && !isLiquidated && (
            <div className="w-full rounded-lg border border-rose-500/20 bg-rose-950/40 p-3 space-y-3">
              <p className="text-xs text-rose-300 font-semibold">
                This will permanently dissolve {airline.name}. All aircraft, routes, and hubs will
                be lost. You will start over with a new airline.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDissolve(false)}
                  className="flex-1 rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted/30"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDissolve}
                  disabled={isLoading}
                  className="flex-1 rounded-lg border border-rose-500/40 bg-rose-500/20 px-3 py-2 text-xs font-bold text-rose-300 transition hover:bg-rose-500/30 disabled:opacity-50"
                >
                  {isLoading ? "Dissolving..." : "Confirm Dissolution"}
                </button>
              </div>
            </div>
          )}

          <div className="w-full flex flex-col gap-2">
            {!isLiquidated && !confirmDissolve && (
              <button
                type="button"
                onClick={() => setConfirmDissolve(true)}
                className="w-full rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-rose-300 transition hover:bg-rose-500/20"
              >
                Dissolve & Start Fresh
              </button>
            )}
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="w-full rounded-lg border border-border/40 bg-background/50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition hover:bg-muted/30"
            >
              {isLiquidated ? "Acknowledged" : "Dismiss"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
