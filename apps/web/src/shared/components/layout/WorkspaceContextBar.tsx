import { useActiveAirline, useAirlineStore } from "@acars/store";
import { useRouterState } from "@tanstack/react-router";
import { Compass, Radar, ShieldAlert, Target, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const DISMISSED_UNTIL_KEY = "acars:workspace-context:dismissed-until";
const DISMISS_DURATION_MS = 1000 * 60 * 60 * 24 * 30;

function getDismissedUntil(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(DISMISSED_UNTIL_KEY);
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function persistDismissal(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DISMISSED_UNTIL_KEY, String(Date.now() + DISMISS_DURATION_MS));
}

type WorkspaceCopy = {
  title: string;
  description: string;
};

function getWorkspaceCopy(
  pathname: string,
  t: ReturnType<typeof useTranslation>["t"],
): WorkspaceCopy {
  if (pathname.startsWith("/airport/")) {
    return {
      title: t("workspace.airportTitle"),
      description: t("workspace.airportDescription"),
    };
  }

  if (pathname.startsWith("/aircraft/")) {
    return {
      title: t("workspace.aircraftTitle"),
      description: t("workspace.aircraftDescription"),
    };
  }

  if (pathname.startsWith("/fleet")) {
    return {
      title: t("nav.fleet"),
      description: t("workspace.fleetDescription"),
    };
  }

  if (pathname.startsWith("/network")) {
    return {
      title: t("nav.network"),
      description: t("workspace.networkDescription"),
    };
  }

  if (pathname.startsWith("/leaderboard")) {
    return {
      title: t("nav.leaderboard"),
      description: t("workspace.leaderboardDescription"),
    };
  }

  if (pathname.startsWith("/corporate")) {
    return {
      title: t("nav.corporate"),
      description: t("workspace.corporateDescription"),
    };
  }

  if (pathname.startsWith("/about")) {
    return {
      title: t("nav.about"),
      description: t("workspace.aboutDescription"),
    };
  }

  return {
    title: t("nav.map"),
    description: t("workspace.cockpitDescription"),
  };
}

export function WorkspaceContextBar() {
  const { t } = useTranslation("common");
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { airline, isViewingOther } = useActiveAirline();
  const identityStatus = useAirlineStore((state) => state.identityStatus);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(getDismissedUntil() > Date.now());
  }, []);

  const workspace = useMemo(() => getWorkspaceCopy(pathname, t), [pathname, t]);
  const mode = useMemo(() => {
    if (isViewingOther) {
      return {
        icon: Target,
        tone: "border-amber-500/25 bg-amber-500/10 text-amber-200",
        title: t("workspace.modeCompetitor"),
        detail: t("workspace.modeCompetitorDetail"),
      };
    }

    if (!airline) {
      return {
        icon: Compass,
        tone: "border-sky-500/25 bg-sky-500/10 text-sky-200",
        title: identityStatus === "guest" ? t("workspace.modeGuest") : t("workspace.modeObserver"),
        detail:
          identityStatus === "guest"
            ? t("workspace.modeGuestDetail")
            : t("workspace.modeObserverDetail"),
      };
    }

    if (airline.status === "chapter11" || airline.status === "liquidated") {
      return {
        icon: ShieldAlert,
        tone: "border-rose-500/25 bg-rose-500/10 text-rose-200",
        title: t("workspace.modeRestricted"),
        detail: t("workspace.modeRestrictedDetail"),
      };
    }

    return {
      icon: Radar,
      tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
      title: t("workspace.modeLive"),
      detail: t("workspace.modeLiveDetail"),
    };
  }, [airline, identityStatus, isViewingOther, t]);

  const ModeIcon = mode.icon;

  if (dismissed) return null;

  return (
    <div className="pointer-events-auto border-b border-border/50 bg-background/66 px-4 py-1.5 backdrop-blur-xl sm:px-6 sm:py-2">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">
              {workspace.title}
            </span>
            <span className="hidden text-border sm:inline">/</span>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              {workspace.description}
            </p>
          </div>
        </div>

        <div
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 ${mode.tone}`}
          title={mode.detail}
        >
          <ModeIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]">{mode.title}</p>
        </div>

        <button
          type="button"
          onClick={() => {
            persistDismissal();
            setDismissed(true);
          }}
          aria-label={t("actions.close")}
          title={t("actions.close")}
          className="shrink-0 rounded-full p-1 text-muted-foreground/70 transition hover:bg-background/60 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
