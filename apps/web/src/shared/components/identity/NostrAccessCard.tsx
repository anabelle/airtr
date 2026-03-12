import type { LucideIcon } from "lucide-react";
import { ExternalLink, KeyRound, Sparkles, Wallet, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation(["common", "identity"]);
  const [showNsecInput, setShowNsecInput] = useState(false);
  const [nsecError, setNsecError] = useState<string | null>(null);

  return (
    <div className="w-full max-w-sm space-y-4 rounded-[24px] border border-border/60 bg-background/74 p-5 text-center shadow-2xl backdrop-blur-xl sm:p-6">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Icon className="h-6 w-6 text-primary" />
      </div>

      <div className="space-y-2">
        <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
          {t("access.badge", { ns: "identity" })}
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
              setNsecError(t("topbar.enterValidNsec", { ns: "common" }));
              return;
            }
            setNsecError(null);
            await onLoginWithNsec(normalized);
          }}
        >
          <label htmlFor="access-card-nsec" className="text-[11px] text-muted-foreground">
            {t("access.nsecLabel", { ns: "identity" })}
          </label>
          <input
            id="access-card-nsec"
            name="nsec"
            type="password"
            placeholder={t("topbar.pasteNsec", { ns: "common" })}
            autoComplete="off"
            className="min-h-11 w-full rounded-md border border-border bg-background/70 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/60 focus:outline-none"
          />
          <div className="flex w-full gap-2">
            <button
              type="submit"
              disabled={isLoading}
              className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-60"
            >
              {isLoading
                ? t("topbar.loading", { ns: "common" })
                : t("topbar.signIn", { ns: "common" })}
            </button>
            <button
              type="button"
              onClick={() => {
                setNsecError(null);
                setShowNsecInput(false);
              }}
              aria-label={t("topbar.cancelNsecLogin", { ns: "common" })}
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
              {isLoading
                ? t("topbar.creating", { ns: "common" })
                : t("topbar.playFree", { ns: "common" })}
            </button>
          )}

          <button
            type="button"
            onClick={onConnect}
            disabled={isLoading}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-60"
          >
            <Wallet className="h-4 w-4 shrink-0" />
            {isLoading
              ? t("topbar.connecting", { ns: "common" })
              : t("topbar.browserWallet", { ns: "common" })}
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
              <KeyRound className="h-4 w-4 shrink-0" />
              {t("topbar.haveNsec", { ns: "common" })}
            </button>
          )}

          <a
            href="https://nostr.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
          >
            {t("topbar.whatIsNostr", { ns: "common" })}
            <ExternalLink className="h-4 w-4 shrink-0" />
          </a>
        </>
      )}
    </div>
  );
}
