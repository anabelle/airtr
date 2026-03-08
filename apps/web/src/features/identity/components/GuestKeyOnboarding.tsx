import { useAirlineStore } from "@acars/store";
import { Loader2, Plane, Sparkles, Zap } from "lucide-react";

/**
 * One-click "Create Free Account" flow for users with no Nostr identity.
 *
 * Generates a fresh keypair in-browser via createNewIdentity() and
 * sets the user up for immediate play. The SecurityUpgradeBanner
 * will then guide them to back up their key.
 */
export function GuestKeyOnboarding({ onExistingAccount }: { onExistingAccount?: () => void }) {
  const createNewIdentity = useAirlineStore((state) => state.createNewIdentity);
  const isLoading = useAirlineStore((state) => state.isLoading);
  const error = useAirlineStore((state) => state.error);

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Plane className="h-5 w-5 text-primary" />
          <h2 className="text-base font-bold tracking-tight text-foreground">Start your airline</h2>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          No account, no download, no crypto knowledge needed. Your progress is saved automatically.
        </p>
      </div>

      <button
        type="button"
        onClick={() => createNewIdentity()}
        disabled={isLoading}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/15 px-4 py-3 text-sm font-bold text-primary shadow-lg shadow-primary/10 transition hover:bg-primary/25 hover:border-primary/70 disabled:opacity-60"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating your account…
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Play for free — no sign-up required
          </>
        )}
      </button>

      {error && <p className="text-center text-[11px] font-medium text-rose-400">{error}</p>}

      <div className="grid grid-cols-2 gap-2">
        {[
          { icon: Plane, label: "Real-time flights", sub: "Routes resolve in actual hours" },
          { icon: Zap, label: "Earn Bitcoin", sub: "Real sats via Lightning zaps" },
        ].map((item) => (
          <div
            key={item.label}
            className="flex flex-col gap-1 rounded-lg border border-border/50 bg-background/40 p-3 backdrop-blur-sm"
          >
            <div className="flex items-center gap-1.5">
              <item.icon className="h-3.5 w-3.5 text-primary/70" />
              <span className="text-[11px] font-semibold text-foreground">{item.label}</span>
            </div>
            <span className="text-[10px] leading-snug text-muted-foreground">{item.sub}</span>
          </div>
        ))}
      </div>

      {onExistingAccount && (
        <button
          type="button"
          onClick={onExistingAccount}
          className="mt-1 text-center text-[11px] text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
        >
          I already have a Nostr account →
        </button>
      )}
    </div>
  );
}
