import type { Airport } from "@acars/core";
import { fp, fpFormat } from "@acars/core";
import { airports as AIRPORTS, getHubPricingForIata, HUB_CLASSIFICATIONS } from "@acars/data";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MapPin, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { MOBILE_OVERLAY_MAX_HEIGHT_CLASS } from "@/shared/components/layout/mobileLayout";

export function HubPicker({
  currentHub,
  onSelect,
}: {
  currentHub: Airport | null;
  onSelect: (airport: Airport | null) => void;
}) {
  const { t } = useTranslation(["common", "game"]);
  const [open, setOpen] = useState(false);
  const [selectedAirport, setSelectedAirport] = useState<Airport | null>(null);
  const [search, setSearch] = useState("");
  const [deferredSearch, setDeferredSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const base = AIRPORTS.filter((a) => a.iata && a.city && a.name);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const prioritized = base.filter((a) => a.timezone === tz);
    const prioritizedSorted = prioritized
      .filter((a) => (a.population || 0) > 0)
      .sort((a, b) => (b.population || 0) - (a.population || 0));
    const prioritizedSet = new Set(prioritizedSorted.map((a) => a.iata));
    const remaining = base
      .filter((a) => !prioritizedSet.has(a.iata))
      .sort((a, b) => (b.population || 0) - (a.population || 0));

    if (!deferredSearch) {
      return [...prioritizedSorted, ...remaining];
    }
    const q = deferredSearch.toLowerCase();
    return base
      .filter(
        (a) =>
          a.iata.toLowerCase().includes(q) ||
          a.city.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          a.country.toLowerCase().includes(q),
      )
      .sort((a, b) => (b.population || 0) - (a.population || 0));
  }, [deferredSearch]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64, // Approximate row height
    overscan: 5,
  });

  const handleSearchChange = (val: string) => {
    setSearch(val);
    startTransition(() => {
      setDeferredSearch(val);
    });
  };

  const selectedPricing = selectedAirport ? getHubPricingForIata(selectedAirport.iata) : null;

  const getTierBadge = (tier: string) => {
    switch (tier) {
      case "global":
        return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
      case "international":
        return "bg-sky-500/10 text-sky-300 border-sky-500/20";
      case "national":
        return "bg-amber-500/10 text-amber-300 border-amber-500/20";
      default:
        return "bg-slate-500/10 text-slate-300 border-slate-500/20";
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background h-10 px-4 py-2"
        title={t("hubPicker.changeTitle", { ns: "game" })}
      >
        <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {currentHub
          ? t("hubPicker.pickDifferent", { ns: "game" })
          : t("hubPicker.chooseManually", { ns: "game" })}
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
            {/* Backdrop */}
            <button
              type="button"
              className="fixed inset-0 bg-background/80 backdrop-blur-sm"
              onClick={() => setOpen(false)}
              aria-label={t("hubPicker.closeSearch", { ns: "game" })}
            />
            {/* Modal — full-height sheet on mobile, centered dialog on sm+ */}
            <div
              role="dialog"
              aria-modal="true"
              className={`relative z-50 flex w-full flex-col ${MOBILE_OVERLAY_MAX_HEIGHT_CLASS} rounded-t-xl border bg-card text-card-foreground shadow-lg sm:mx-4 sm:max-w-[480px] sm:max-h-[85dvh] sm:rounded-xl`}
            >
              <div className="flex flex-col space-y-1 px-5 pt-5 pb-3 shrink-0">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold leading-none tracking-tight">
                    {t("hubPicker.dialogTitle", { ns: "game" })}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-sm p-1 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label={t("hubPicker.closeDialog", { ns: "game" })}
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("hubPicker.dialogDescription", { ns: "game" })}
                </p>
              </div>

              <div className="px-5 pb-2 shrink-0">
                <div className="relative flex items-center rounded-lg border border-input bg-background/50 px-3">
                  <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
                  <input
                    ref={inputRef}
                    className="flex h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder={t("hubPicker.searchPlaceholder", { ns: "game" })}
                    aria-label={t("hubPicker.searchAria", { ns: "game" })}
                    name="airport-search"
                    value={search}
                    onChange={(e) => handleSearchChange(e.target.value)}
                  />
                </div>
              </div>

              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                <div
                  className="relative w-full"
                  style={{ height: `${virtualizer.getTotalSize()}px` }}
                >
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const airport = filtered[virtualRow.index];
                    const isActive = currentHub && airport.iata === currentHub.iata;
                    const isSelected = selectedAirport?.iata === airport.iata;
                    const pricing = getHubPricingForIata(airport.iata);
                    const hubMeta = HUB_CLASSIFICATIONS[airport.iata];
                    const isSlotControlled = hubMeta?.slotControlled ?? false;
                    const capacityPerHour = hubMeta?.baseCapacityPerHour ?? null;
                    const openFee = fpFormat(fp(pricing.openFee), 0);
                    const monthlyOpex = fpFormat(fp(pricing.monthlyOpex), 0);
                    const tierLabel = pricing.tier.toUpperCase();

                    return (
                      <button
                        type="button"
                        key={airport.iata}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                        className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                          isSelected
                            ? "bg-primary/15 ring-1 ring-primary/40"
                            : isActive
                              ? "bg-primary/10 text-primary"
                              : ""
                        }`}
                        onClick={() => {
                          setSelectedAirport(airport);
                        }}
                      >
                        <div className="flex flex-col overflow-hidden">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-foreground">{airport.iata}</span>
                            <span className="truncate text-muted-foreground">{airport.city}</span>
                            <span
                              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${getTierBadge(pricing.tier)}`}
                            >
                              {tierLabel}
                            </span>
                          </div>
                          <span className="truncate text-xs text-muted-foreground opacity-70">
                            {airport.name}
                          </span>
                        </div>
                        <div className="ml-2 shrink-0 flex flex-col items-end text-[10px] font-semibold uppercase opacity-70">
                          <span>{airport.country}</span>
                          <span className="text-[9px] text-muted-foreground">Setup {openFee}</span>
                          <span className="text-[9px] text-muted-foreground">
                            OPEX {monthlyOpex}/mo
                          </span>
                          <span className="text-[9px] text-muted-foreground">
                            Cap {capacityPerHour ?? "—"}/hr
                          </span>
                          {isSlotControlled && (
                            <span className="text-[9px] text-amber-300">Slot Ctrl</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {filtered.length === 0 && !isPending && (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {t("hubPicker.noMatches", { ns: "game", query: search })}
                  </div>
                )}
                {isPending && (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {t("hubPicker.searching", { ns: "game" })}
                  </div>
                )}
              </div>
              {selectedAirport && selectedPricing && (
                <div className="border-t border-border px-5 py-4 shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase text-muted-foreground">
                        {t("hubPicker.selected", { ns: "game" })}
                      </p>
                      <p className="text-sm font-semibold text-foreground truncate">
                        {selectedAirport.iata} — {selectedAirport.city}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${getTierBadge(selectedPricing.tier)}`}
                    >
                      {selectedPricing.tier}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-border/50 bg-muted/30 p-2">
                      <p className="text-[10px] uppercase text-muted-foreground">
                        {t("hubPicker.setupFee", { ns: "game" })}
                      </p>
                      <p className="mt-0.5 text-sm font-mono font-bold text-foreground">
                        {fpFormat(fp(selectedPricing.openFee), 0)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-muted/30 p-2">
                      <p className="text-[10px] uppercase text-muted-foreground">
                        {t("hubPicker.monthlyCost", { ns: "game" })}
                      </p>
                      <p className="mt-0.5 text-sm font-mono font-bold text-foreground">
                        {fpFormat(fp(selectedPricing.monthlyOpex), 0)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setSelectedAirport(null)}
                    >
                      {t("bankruptcy.cancel", { ns: "common" })}
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded-md bg-primary px-3 py-2 text-xs font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        onSelect(selectedAirport);
                        setSelectedAirport(null);
                        setOpen(false);
                        setSearch("");
                        setDeferredSearch("");
                      }}
                    >
                      {t("hubPicker.confirm", { ns: "game" })}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
