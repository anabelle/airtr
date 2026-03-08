import type { LucideIcon } from "lucide-react";
import { ExternalLink, KeyRound, Sparkles, Wallet, X } from "lucide-react";
import { useState } from "react";

type NostrAccessCardProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  onConnect: () => void;
  onCreateFree?: () => void;
  onLoginWithNsec?: (nsec: string) => Promise<void>;
  isLoading?: boolean;
};

export function NostrAccessCard({
  icon: Icon,
  title,
  description,
  onConnect,
  onCreateFree,
  onLoginWithNsec,
  isLoading = false,
}: NostrAccessCardProps) {
  const [showNsecInput, setShowNsecInput] = useState(false);
  const [nsecError, setNsecError] = useState<string | null>(null);

  return (
    <div className="max-w-md space-y-4 rounded-2xl border border-border/60 bg-background/70 p-6 text-center shadow-2xl backdrop-blur-xl">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Icon className="h-6 w-6 text-primary" />
      </div>

      <div className="space-y-2">
        <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
          New to Nostr? Start here
        </span>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {showNsecInput && onLoginWithNsec ? (
        <form
          className="flex w-full flex-col gap-2 text-left"
          onSubmit={async (e) => {
            e.preventDefault();
            const normalized = (
              e.currentTarget.elements.namedItem("nsec") as HTMLInputElement | null
            )?.value
              ?.trim()
              ?.toLowerCase();
            if (!normalized?.startsWith("nsec1")) {
              setNsecError("Enter a valid nsec1 key.");
              return;
            }
            setNsecError(null);
            await onLoginWithNsec(normalized);
          }}
        >
          <label htmlFor="access-card-nsec" className="text-[11px] text-muted-foreground">
            Paste your Nostr secret key to sign in.
          </label>
          <input
            id="access-card-nsec"
            name="nsec"
            type="password"
            placeholder="nsec1…"
            autoComplete="off"
            className="min-h-11 w-full rounded-md border border-border bg-background/70 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/60 focus:outline-none"
          />
          <div className="flex w-full gap-2">
            <button
              type="submit"
              disabled={isLoading}
              className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-60"
            >
              {isLoading ? "Loading…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => {
                setNsecError(null);
                setShowNsecInput(false);
              }}
              aria-label="Cancel nsec login"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground transition hover:border-border hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {nsecError && <p className="text-[11px] font-medium text-rose-400">{nsecError}</p>}
        </form>
      ) : (
        <>
          {onCreateFree && (
            <button
              type="button"
              onClick={onCreateFree}
              disabled={isLoading}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-primary/50 bg-primary/15 px-3 py-2 text-sm font-bold text-primary transition hover:bg-primary/25 disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4 shrink-0" />
              {isLoading ? "Creating…" : "Play Free"}
            </button>
          )}

          <button
            type="button"
            onClick={onConnect}
            disabled={isLoading}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-60"
          >
            <Wallet className="h-4 w-4 shrink-0" />
            {isLoading ? "Connecting…" : "Browser wallet"}
          </button>

          {onLoginWithNsec && (
            <button
              type="button"
              onClick={() => {
                setNsecError(null);
                setShowNsecInput(true);
              }}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              <KeyRound className="h-4 w-4 shrink-0" />I already have an nsec key
            </button>
          )}

          <a
            href="https://nostr.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
          >
            What is Nostr?
            <ExternalLink className="h-4 w-4 shrink-0" />
          </a>
        </>
      )}
    </div>
  );
}
