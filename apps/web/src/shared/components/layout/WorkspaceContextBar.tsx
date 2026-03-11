import { useActiveAirline, useAirlineStore } from "@acars/store";
import { useRouterState } from "@tanstack/react-router";
import { Compass, Radar, ShieldAlert, Target } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

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

  return (
    <div className="pointer-events-auto border-b border-border/60 bg-background/72 px-4 py-2 backdrop-blur-xl sm:px-6 sm:py-2.5">
      <div className="flex flex-col gap-2 sm:gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">
              {workspace.title}
            </span>
          </div>
          <p className="mt-1 hidden text-xs leading-relaxed text-muted-foreground sm:block">
            {workspace.description}
          </p>
        </div>

        <div className={`inline-flex items-start gap-2 rounded-2xl border px-3 py-2 ${mode.tone}`}>
          <ModeIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em]">{mode.title}</p>
            <p className="mt-0.5 hidden text-[11px] leading-relaxed text-current/80 sm:block">
              {mode.detail}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
