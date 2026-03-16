import { useActiveAirline } from "@acars/store";
import { Link, useSearch } from "@tanstack/react-router";
import { Radar, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OperationsCockpit } from "@/features/cockpit/components/OperationsCockpit";

const LIVE_WORLD_DISMISSED_UNTIL_KEY = "acars:home:live-world:dismissed-until";
const LIVE_WORLD_DISMISS_DURATION_MS = 1000 * 60 * 60 * 24 * 15;

function getLiveWorldDismissedUntil(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(LIVE_WORLD_DISMISSED_UNTIL_KEY);
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function persistLiveWorldDismissal(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    LIVE_WORLD_DISMISSED_UNTIL_KEY,
    String(Date.now() + LIVE_WORLD_DISMISS_DURATION_MS),
  );
}

export default function HomeRoute() {
  const { t } = useTranslation(["common", "game"]);
  const { panel } = useSearch({ from: "/" });
  const { airline } = useActiveAirline();
  const [dismissed, setDismissed] = useState(() => getLiveWorldDismissedUntil() > Date.now());

  function dismissLiveWorldIntro() {
    persistLiveWorldDismissal();
    setDismissed(true);
  }

  if (panel === "cockpit") {
    return <OperationsCockpit />;
  }

  if (panel === "map" || dismissed) {
    return null;
  }

  if (airline) {
    return (
      <div className="pointer-events-none flex h-full w-full items-start justify-start px-3 pt-2 pb-24 sm:items-end sm:px-6 sm:pt-0 sm:pb-6">
        <div className="pointer-events-auto flex max-h-full w-full max-w-[22rem] flex-col gap-3 overflow-y-auto rounded-[24px] border border-border/70 bg-background/74 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:max-h-none sm:max-w-sm sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/80">
                {t("home.mapKicker", { ns: "game" })}
              </p>
              <h1 className="mt-2 truncate text-lg font-black tracking-tight text-foreground sm:text-xl">
                {airline.name}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {airline.icaoCode} / {airline.callsign}
              </p>
            </div>
            <button
              type="button"
              onClick={dismissLiveWorldIntro}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              title={t("panel.closeTitle", { ns: "common" })}
              aria-label={t("panel.closeAria", { ns: "common" })}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("home.mapDescription", { ns: "game" })}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Link
              to="/"
              search={{ panel: "cockpit" }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition-transform hover:scale-[1.01] active:scale-[0.99]"
            >
              <Radar className="h-4 w-4" aria-hidden="true" />
              {t("home.openCockpit", { ns: "game" })}
            </Link>
            <Link
              to="/network"
              search={{ tab: "active" }}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-border/60 bg-background/55 px-4 py-3 text-center text-xs font-semibold leading-relaxed text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("nav.network", { ns: "common" })}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none flex h-full w-full items-start justify-start px-3 pt-2 pb-24 sm:items-end sm:justify-start sm:px-6 sm:pt-0 sm:pb-6">
      <div className="pointer-events-auto flex max-h-full w-full max-w-[23rem] flex-col gap-3 overflow-y-auto rounded-[24px] border border-border/70 bg-background/76 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:max-h-none sm:max-w-sm sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/80">
              {t("home.mapKicker", { ns: "game" })}
            </p>
            <h1 className="mt-2 text-xl font-black tracking-tight text-foreground sm:text-[1.75rem]">
              {t("home.mapTitle", { ns: "game" })}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:max-w-[30ch]">
              {t("home.mapDescription", { ns: "game" })}
            </p>
          </div>
          <button
            type="button"
            onClick={dismissLiveWorldIntro}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            title={t("panel.closeTitle", { ns: "common" })}
            aria-label={t("panel.closeAria", { ns: "common" })}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            to="/"
            search={{ panel: "cockpit" }}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition-transform hover:scale-[1.01] active:scale-[0.99]"
          >
            <Radar className="h-4 w-4" aria-hidden="true" />
            {t("home.openCockpit", { ns: "game" })}
          </Link>
          <div className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl border border-border/60 bg-background/55 px-4 py-3 text-center text-xs leading-relaxed text-muted-foreground sm:max-w-[12rem]">
            {t("home.mapSecondary", { ns: "game" })}
          </div>
        </div>
      </div>
    </div>
  );
}
