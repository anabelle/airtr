import { useActiveAirline } from "@acars/store";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Radar, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { OperationsCockpit } from "@/features/cockpit/components/OperationsCockpit";

export default function HomeRoute() {
  const { t } = useTranslation(["common", "game"]);
  const navigate = useNavigate();
  const { panel } = useSearch({ from: "/" });
  const { airline } = useActiveAirline();

  if (panel === "cockpit") {
    return <OperationsCockpit />;
  }

  if (panel === "map") {
    return null;
  }

  if (airline) {
    return (
      <div className="pointer-events-none flex h-full w-full items-end justify-center px-3 pb-24 sm:justify-start sm:px-6 sm:pb-6">
        <div className="pointer-events-auto flex w-full max-w-[22rem] flex-col gap-3 overflow-y-auto rounded-[24px] border border-border/70 bg-background/74 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-2xl max-h-[calc(100dvh-10.75rem-env(safe-area-inset-bottom))] sm:max-h-none sm:max-w-sm sm:p-5">
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
              onClick={() => navigate({ to: "/", search: { panel: "map" } })}
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

          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
              {t("home.mapChipAircraft", { ns: "game" })}
            </span>
            <span className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
              {t("home.mapChipAirports", { ns: "game" })}
            </span>
          </div>

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
    <div className="pointer-events-none flex h-full w-full items-end justify-center px-3 pb-24 sm:items-end sm:justify-start sm:px-6 sm:pb-6">
      <div className="pointer-events-auto flex w-full max-w-[23rem] flex-col gap-3 overflow-y-auto rounded-[24px] border border-border/70 bg-background/76 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-2xl max-h-[calc(100dvh-10.75rem-env(safe-area-inset-bottom))] sm:max-h-none sm:max-w-sm sm:p-5">
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
            onClick={() => navigate({ to: "/", search: { panel: "map" } })}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            title={t("panel.closeTitle", { ns: "common" })}
            aria-label={t("panel.closeAria", { ns: "common" })}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
            {t("home.mapChipAircraft", { ns: "game" })}
          </span>
          <span className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
            {t("home.mapChipAirports", { ns: "game" })}
          </span>
          <span className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
            {t("home.mapChipPanels", { ns: "game" })}
          </span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            to="/"
            search={{ panel: "cockpit" }}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition-transform hover:scale-[1.01] active:scale-[0.99]}"
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
