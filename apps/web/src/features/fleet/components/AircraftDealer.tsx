import type { AircraftModel } from "@acars/core";
import { createLogger, FP_ZERO, fpFormat, fpScale, TICK_DURATION } from "@acars/core";
import { aircraftModels, getAircraftById } from "@acars/data";
import { loadMarketplace, type MarketplaceListing, type SellerFleetIndex } from "@acars/nostr";
import { useAirlineStore } from "@acars/store";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowRight,
  Check,
  Coins,
  History,
  MapPin,
  Plane,
  Search,
  ShoppingBag,
  Tag,
  Timer,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { usePanelScrollRef } from "@/shared/components/layout/panelScrollContext";
import { useConfirm } from "@/shared/lib/useConfirm";
import { CatalogImage } from "./CatalogImage";

/**
 * Renders the aircraft dealer with factory and marketplace listings.
 */
export function AircraftDealer({ onPurchaseSuccess }: { onPurchaseSuccess?: () => void }) {
  const logger = useMemo(() => createLogger("AircraftDealer"), []);
  const [mode, setMode] = useState<"factory" | "marketplace">("factory");
  const [search, setSearch] = useState("");
  const [selectedTier, setSelectedTier] = useState<number | "all">("all");
  const [selectedModel, setSelectedModel] = useState<AircraftModel | null>(null);
  const [usedListings, setUsedListings] = useState<MarketplaceListing[]>([]);
  const [isLoadingUsed, setIsLoadingUsed] = useState(false);
  const purchaseUsed = useAirlineStore((state) => state.purchaseUsedAircraft);
  const fleet = useAirlineStore((state) => state.fleet);
  const airlineTier = useAirlineStore((state) => state.airline?.tier ?? 1);
  const confirm = useConfirm();
  const skeletonKeys = useMemo(
    () => Array.from({ length: 6 }, (_, index) => `skeleton-${index}`),
    [],
  );
  const panelScrollRef = usePanelScrollRef();
  const measureRef = useRef<HTMLDivElement>(null);
  const [gridColumns, setGridColumns] = useState(1);

  useEffect(() => {
    const updateColumns = () => {
      const width = measureRef.current?.clientWidth ?? 0;
      if (width >= 1536) {
        setGridColumns(3);
      } else if (width >= 1280) {
        setGridColumns(2);
      } else {
        setGridColumns(1);
      }
    };

    updateColumns();
    window.addEventListener("resize", updateColumns);
    return () => window.removeEventListener("resize", updateColumns);
  }, []);

  const handleBuyUsed = async (listing: MarketplaceListing) => {
    const approved = await confirm({
      title: "Purchase used aircraft?",
      description: `Confirm purchase for ${fpFormat(listing.marketplacePrice, 0)}. Delivery starts immediately.`,
      confirmLabel: "Purchase",
      cancelLabel: "Cancel",
      tone: "default",
    });
    if (!approved) return;

    try {
      await purchaseUsed(listing);
      fetchUsed(); // Refresh the list
      if (onPurchaseSuccess) onPurchaseSuccess();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      toast.error("Purchase failed", {
        description: message,
      });
    }
  };

  const filteredFactory = useMemo(() => {
    let list = aircraftModels;
    if (selectedTier !== "all") {
      list = list.filter((a) => a.unlockTier === selectedTier);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) => a.name.toLowerCase().includes(q) || a.manufacturer.toLowerCase().includes(q),
      );
    }
    return list;
  }, [search, selectedTier]);

  const fetchUsed = async () => {
    setIsLoadingUsed(true);
    logger.debug("fetchUsed triggered");
    try {
      // Build seller fleet index from world state for ownership verification
      const state = useAirlineStore.getState();
      const sellerFleets: SellerFleetIndex = new Map();

      // Add all known competitors' fleets
      if (state.competitors.size > 0) {
        for (const [pubkey, airline] of state.competitors) {
          sellerFleets.set(pubkey, new Set(airline.fleetIds));
        }
      }

      // Add our own fleet (in case we listed something and it was sold)
      if (state.pubkey && state.fleet.length > 0) {
        sellerFleets.set(state.pubkey, new Set(state.fleet.map((ac) => ac.id)));
      }

      const listings = await loadMarketplace(sellerFleets);
      logger.debug(`fetchUsed raw count: ${listings.length}`);
      listings.forEach((listing) => {
        const model = getAircraftById(listing.modelId);
        logger.debug(
          `Listing ${listing.instanceId}: Model ${listing.modelId} (${model ? "Found" : "NOT FOUND"})`,
        );
      });
      setUsedListings(listings);
    } catch (error) {
      logger.error("fetchUsed error:", error);
    } finally {
      setIsLoadingUsed(false);
    }
  };

  const filteredUsed = useMemo(() => {
    let list = usedListings.filter((l) => !fleet.some((f) => f.id === l.instanceId));

    // Tier filter
    if (selectedTier && selectedTier !== "all") {
      list = list.filter((l) => {
        const model = getAircraftById(l.modelId);
        return model?.unlockTier === selectedTier;
      });
    }

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) => l.modelId.toLowerCase().includes(q) || l.name.toLowerCase().includes(q),
      );
    }

    return list;
  }, [search, usedListings, selectedTier, fleet]);

  const displayMode =
    mode === "factory"
      ? "factory"
      : isLoadingUsed
        ? "used-loading"
        : filteredUsed.length > 0
          ? "used"
          : "used-empty";

  const listItems =
    displayMode === "factory"
      ? filteredFactory
      : displayMode === "used-loading"
        ? skeletonKeys
        : displayMode === "used"
          ? filteredUsed
          : [];
  const useVirtualGrid = gridColumns > 1;
  const rowCount = Math.ceil(listItems.length / gridColumns);
  const rowHeight =
    displayMode === "factory"
      ? gridColumns === 1
        ? 380
        : 360
      : displayMode === "used-loading"
        ? gridColumns === 1
          ? 300
          : 260
        : gridColumns === 1
          ? 372
          : 320;
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => panelScrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 2,
    scrollMargin: measureRef.current?.offsetTop ?? 0,
  });

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      {/* Mode Switcher */}
      <div className="grid grid-cols-2 gap-2 border-b border-border/40 pb-4">
        <button
          type="button"
          onClick={() => setMode("factory")}
          className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${mode === "factory" ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "text-muted-foreground hover:bg-accent/40"}`}
        >
          <ShoppingBag className="h-4 w-4" />
          <span className="truncate">Factory New</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("marketplace");
            fetchUsed();
          }}
          className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${mode === "marketplace" ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "text-muted-foreground hover:bg-accent/40"}`}
        >
          <History className={`h-4 w-4 ${isLoadingUsed ? "animate-spin" : ""}`} />
          <span className="truncate">Used Marketplace</span>
        </button>
      </div>

      {/* Header & Filters */}
      <div className="rounded-2xl border border-border/40 bg-card p-3 shadow-sm backdrop-blur-xl sm:p-4">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
            <input
              className="h-10 w-full rounded-xl bg-background border border-border/50 pl-10 pr-4 text-sm transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground outline-none"
              placeholder={
                mode === "factory" ? "Search aircraft models..." : "Search marketplace listings..."
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {mode === "marketplace" && (
            <button
              type="button"
              onClick={fetchUsed}
              disabled={isLoadingUsed}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-orange-500/20 bg-orange-500/10 px-4 text-xs font-bold text-orange-400 transition-all hover:bg-orange-500/20 disabled:opacity-50 sm:self-start"
            >
              <History className={`h-4 w-4 ${isLoadingUsed ? "animate-spin" : ""}`} />
              Refresh
            </button>
          )}

          {mode === "factory" && (
            <div className="overflow-x-auto pb-1">
              <div className="flex min-w-max items-center gap-2 rounded-xl border border-border/50 bg-background p-1">
                <button
                  type="button"
                  onClick={() => setSelectedTier("all")}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                    selectedTier === "all"
                      ? "bg-primary/20 text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  All
                </button>
                {[1, 2, 3, 4].map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setSelectedTier(tier)}
                    className={`flex items-center gap-1 rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                      selectedTier === tier
                        ? "bg-primary/20 text-primary shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    Tier {tier}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Grid */}
      <div ref={measureRef} className="overflow-x-hidden pb-8 sm:pr-2 sm:pb-10">
        {displayMode === "used-empty" ? (
          <div className="py-20 text-center flex flex-col items-center border border-dashed border-border/50 rounded-2xl bg-card/20">
            <History className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
            <p className="text-muted-foreground">
              No used aircraft currently listed on the Marketplace.
            </p>
          </div>
        ) : !useVirtualGrid ? (
          <div className="space-y-4">
            {listItems.map((item) => {
              if (displayMode === "factory") {
                const aircraft = item as AircraftModel;
                return (
                  <AircraftCard
                    key={aircraft.id}
                    aircraft={aircraft}
                    airlineTier={airlineTier}
                    onSelect={() => setSelectedModel(aircraft)}
                  />
                );
              }

              if (displayMode === "used-loading") {
                const key = item as string;
                return (
                  <div
                    key={key}
                    className="h-64 rounded-2xl border border-border/40 bg-card animate-pulse"
                  />
                );
              }

              const listing = item as MarketplaceListing;
              return (
                <UsedAircraftCard
                  key={listing.id}
                  listing={listing}
                  airlineTier={airlineTier}
                  onBuy={() => handleBuyUsed(listing)}
                />
              );
            })}
          </div>
        ) : (
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((row) => {
              const startIndex = row.index * gridColumns;
              const rowItems = listItems.slice(startIndex, startIndex + gridColumns);

              return (
                <div
                  key={row.key}
                  className="grid gap-4 sm:gap-6"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${row.size}px`,
                    transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
                    gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
                  }}
                >
                  {rowItems.map((item) => {
                    if (displayMode === "factory") {
                      const aircraft = item as AircraftModel;
                      return (
                        <AircraftCard
                          key={aircraft.id}
                          aircraft={aircraft}
                          airlineTier={airlineTier}
                          onSelect={() => setSelectedModel(aircraft)}
                        />
                      );
                    }

                    if (displayMode === "used-loading") {
                      const key = item as string;
                      return (
                        <div
                          key={key}
                          className="h-64 rounded-2xl bg-card animate-pulse border border-border/40"
                        />
                      );
                    }

                    const listing = item as MarketplaceListing;
                    return (
                      <UsedAircraftCard
                        key={listing.id}
                        listing={listing}
                        airlineTier={airlineTier}
                        onBuy={() => handleBuyUsed(listing)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Purchase Modal */}
      {selectedModel && (
        <PurchaseModal
          aircraft={selectedModel}
          onClose={() => setSelectedModel(null)}
          onPurchaseSuccess={onPurchaseSuccess}
        />
      )}
    </div>
  );
}

/**
 * Shows a factory aircraft card with tier gating.
 */
function AircraftCard({
  aircraft,
  airlineTier,
  onSelect,
}: {
  aircraft: AircraftModel;
  airlineTier: number;
  onSelect: () => void;
}) {
  const gradientMap: Record<string, string> = {
    Airbus: "from-blue-500/20 via-blue-900/10 to-transparent",
    Boeing: "from-indigo-500/20 via-purple-900/10 to-transparent",
    Embraer: "from-emerald-500/20 via-green-900/10 to-transparent",
    ATR: "from-orange-500/20 via-red-900/10 to-transparent",
    "De Havilland": "from-red-500/20 via-rose-900/10 to-transparent",
  };
  const bgGradient =
    gradientMap[aircraft.manufacturer] || "from-zinc-500/20 via-zinc-900/10 to-transparent";
  const totalCapacity =
    aircraft.capacity.economy + aircraft.capacity.business + aircraft.capacity.first;
  const isLocked = aircraft.unlockTier > airlineTier;

  return (
    <div
      className={`group relative flex min-w-0 flex-col rounded-2xl border border-border bg-card overflow-hidden transition-all duration-300 hover:border-border/80 hover:shadow-[0_8px_30px_rgb(0,0,0,0.5)] ${
        isLocked ? "opacity-60" : ""
      }`}
    >
      {/* Top Image Splash */}
      <div
        className={`relative flex h-20 w-full items-center justify-center border-b border-border/30 bg-gradient-to-br ${bgGradient} sm:h-32`}
      >
        <div className="absolute left-3 top-3 flex gap-2 sm:left-4 sm:top-4">
          <span className="inline-flex items-center rounded-full bg-background/80 backdrop-blur-md px-2.5 py-0.5 text-xs font-semibold text-foreground border border-border/50">
            Tier {aircraft.unlockTier}
          </span>
          <span className="inline-flex items-center rounded-full bg-background/80 backdrop-blur-md px-2.5 py-0.5 text-xs font-semibold uppercase text-muted-foreground border border-border/50">
            {aircraft.type}
          </span>
        </div>
        <CatalogImage
          model={aircraft}
          className="h-full w-full object-cover"
          fallback={
            <Plane className="h-10 w-10 rotate-[-15deg] text-foreground/20 transition-all duration-500 group-hover:scale-110 group-hover:text-foreground/40 sm:h-16 sm:w-16" />
          }
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5">
        <div className="mb-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
            {aircraft.manufacturer}
          </p>
          <h3 className="truncate text-xl font-bold leading-tight text-foreground sm:text-xl">
            {aircraft.name}
          </h3>
        </div>

        <div className="mt-auto grid grid-cols-2 gap-3 pb-5 sm:mb-6 sm:gap-4 sm:pb-0">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/30 text-accent-foreground border border-accent/20">
              <Users className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Capacity</p>
              <p className="truncate text-base font-medium sm:text-sm">{totalCapacity} pax</p>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/30 text-accent-foreground border border-accent/20">
              <ArrowRight className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Range</p>
              <p className="truncate text-base font-medium sm:text-sm">
                {aircraft.rangeKm.toLocaleString()} km
              </p>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3 col-span-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
              <Timer className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">
                Factory Lead Time
              </p>
              <p className="truncate text-base font-medium text-yellow-500 sm:text-sm">
                ~{Math.floor((aircraft.deliveryTimeTicks * TICK_DURATION) / 1000 / 60)} minutes
              </p>
            </div>
          </div>
        </div>

        <div className="mb-4 h-px w-full bg-border/50" />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">
              List Price
            </p>
            <p className="truncate text-xl font-bold text-primary transition-colors duration-300 drop-shadow-[0_0_10px_rgba(16,185,129,0.2)] group-hover:-translate-y-0.5 group-hover:text-primary-foreground sm:text-lg">
              {fpFormat(aircraft.price, 0)}
            </p>
          </div>

          <button
            type="button"
            onClick={onSelect}
            disabled={isLocked}
            className={`relative w-full shrink-0 overflow-hidden rounded-xl px-4 py-3 text-sm font-bold transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background sm:w-auto sm:py-2 ${
              isLocked
                ? "bg-muted/40 text-muted-foreground cursor-not-allowed"
                : "bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] focus:ring-primary"
            }`}
          >
            <span className="relative flex items-center justify-center gap-2 truncate">
              {isLocked ? `Requires Tier ${aircraft.unlockTier}` : "Configure & Buy"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ...
type UsedListingCardProps = {
  listing: MarketplaceListing;
  airlineTier: number;
  onBuy: () => void;
};

/**
 * Shows a used aircraft listing with tier gating.
 */
function UsedAircraftCard({ listing, airlineTier, onBuy }: UsedListingCardProps) {
  const model = getAircraftById(listing.modelId);
  if (!model) return null;
  const isLocked = model.unlockTier > airlineTier;

  const bgGradient = "from-orange-500/10 via-orange-900/5 to-transparent";

  return (
    <div className="group relative flex min-w-0 flex-col rounded-2xl bg-card border border-orange-500/20 overflow-hidden transition-all duration-300 hover:shadow-[0_8px_30px_rgb(249,115,22,0.2)] hover:border-orange-500/40">
      <div
        className={`h-28 w-full bg-gradient-to-br ${bgGradient} relative flex items-center justify-center border-b border-orange-500/10`}
      >
        <div className="absolute top-3 left-3 flex gap-2">
          <span className="inline-flex items-center rounded-full bg-orange-500/20 backdrop-blur-md px-2 py-0.5 text-[10px] font-bold text-orange-400 border border-orange-500/20 uppercase">
            Used
          </span>
          <span className="inline-flex items-center rounded-full bg-background/80 backdrop-blur-md px-2 py-0.5 text-[10px] font-semibold text-muted-foreground border border-border/50">
            Tier {model.unlockTier}
          </span>
        </div>

        <Plane className="h-12 w-12 text-orange-500/20 rotate-[-15deg] group-hover:scale-110 group-hover:text-orange-500/40 transition-all duration-500" />
      </div>

      <div className="flex min-w-0 flex-col flex-1 p-4">
        <div className="mb-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">
            {model.manufacturer}
          </p>
          <h3 className="text-lg font-bold text-foreground line-clamp-1">{listing.name}</h3>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4 mt-auto bg-background/40 p-3 rounded-xl border border-border/20">
          <div>
            <p className="text-[9px] uppercase text-muted-foreground font-bold">Condition</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-border/50 overflow-hidden">
                <div
                  className={`h-full ${listing.condition > 0.8 ? "bg-emerald-500" : listing.condition > 0.5 ? "bg-orange-500" : "bg-red-500"}`}
                  style={{ width: `${listing.condition * 100}%` }}
                />
              </div>
              <span className="text-[10px] font-mono font-bold">
                {(listing.condition * 100).toFixed(0)}%
              </span>
            </div>
          </div>
          <div>
            <p className="text-[9px] uppercase text-muted-foreground font-bold">Flight Hours</p>
            <p className="text-xs font-mono font-bold">
              {(listing.flightHoursTotal || 0).toLocaleString()}h
            </p>
          </div>
          <div className="col-span-2 pt-1 border-t border-border/10 mt-1 flex items-center justify-between">
            <p className="text-[9px] uppercase text-muted-foreground font-bold flex items-center gap-1">
              <Timer className="h-3 w-3" /> Delivery Time
            </p>
            <p className="text-[10px] font-bold text-orange-400">~1:00m</p>
          </div>
        </div>

        <div className="flex min-w-0 items-end justify-between gap-3 pt-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase text-muted-foreground font-bold mb-0.5">
              Asking Price
            </p>
            <p className="truncate text-lg font-bold text-orange-400 drop-shadow-[0_0_10px_rgba(249,115,22,0.2)]">
              {fpFormat(listing.marketplacePrice || FP_ZERO, 0)}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5 italic truncate">
              Seller: {listing.sellerPubkey?.slice(0, 8)}...
            </p>
          </div>

          <button
            type="button"
            onClick={onBuy}
            disabled={isLocked}
            className={`shrink-0 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
              isLocked
                ? "bg-muted/40 text-muted-foreground cursor-not-allowed"
                : "bg-orange-500 text-white hover:bg-orange-600 hover:shadow-[0_0_15px_rgba(249,115,22,0.4)]"
            }`}
          >
            {isLocked ? `Tier ${model.unlockTier}` : "Purchase"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Captures configuration and confirms aircraft purchase.
 */
function PurchaseModal({
  aircraft,
  onClose,
  onPurchaseSuccess,
}: {
  aircraft: AircraftModel;
  onClose: () => void;
  onPurchaseSuccess?: () => void;
}) {
  const hubs = useAirlineStore((state) => state.airline?.hubs || []);
  const purchaseAircraft = useAirlineStore((state) => state.purchaseAircraft);
  const corporateBalance = useAirlineStore((state) => state.airline?.corporateBalance);

  const [selectedHub, setSelectedHub] = useState<string>(hubs[0] || "");
  const [customName, setCustomName] = useState("");
  const [purchaseType, setPurchaseType] = useState<"buy" | "lease">("buy");
  const [isPurchasing, setIsPurchasing] = useState(false);

  const [busSeats, setBusSeats] = useState(aircraft.capacity.business);
  const [firstSeats, setFirstSeats] = useState(aircraft.capacity.first);
  const modalKey = aircraft.id.replace(/[^a-zA-Z0-9-_]/g, "");
  const nameInputId = `aircraft-name-${modalKey}`;
  const hubSelectId = `aircraft-hub-${modalKey}`;
  const firstSliderId = `aircraft-first-${modalKey}`;
  const businessSliderId = `aircraft-business-${modalKey}`;

  // Calculate space dynamics based on fleet manager plan
  const baseEconSpace =
    aircraft.capacity.economy + aircraft.capacity.business * 2.5 + aircraft.capacity.first * 4;
  const econSeats = Math.floor(baseEconSpace - busSeats * 2.5 - firstSeats * 4);
  const totalCapacity = econSeats + busSeats + firstSeats;

  const maxFirstClass = Math.floor(baseEconSpace / 4);
  const maxBusinessClass = Math.floor((baseEconSpace - firstSeats * 4) / 2.5);

  const handlePurchase = async () => {
    setIsPurchasing(true);
    try {
      await purchaseAircraft(
        aircraft,
        selectedHub,
        {
          economy: econSeats,
          business: busSeats,
          first: firstSeats,
          cargoKg: aircraft.capacity.cargoKg,
        },
        customName,
        purchaseType,
      );
      toast.success(`${aircraft.name} ordered`, {
        description: `Your ${purchaseType === "lease" ? "lease" : "purchase"} is confirmed. Check the fleet list for delivery status.`,
      });
      setIsPurchasing(false);
      onClose();
      if (onPurchaseSuccess) onPurchaseSuccess();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Purchase failed", {
        description: message,
      });
      setIsPurchasing(false);
    }
  };

  const gradientMap: Record<string, string> = {
    Airbus: "from-blue-500/20 via-blue-900/10 to-transparent",
    Boeing: "from-indigo-500/20 via-purple-900/10 to-transparent",
    Embraer: "from-emerald-500/20 via-green-900/10 to-transparent",
    ATR: "from-orange-500/20 via-red-900/10 to-transparent",
    "De Havilland": "from-red-500/20 via-rose-900/10 to-transparent",
  };
  const bgGradient =
    gradientMap[aircraft.manufacturer] || "from-zinc-500/20 via-zinc-900/10 to-transparent";

  const upfrontCost = purchaseType === "buy" ? aircraft.price : fpScale(aircraft.price, 0.1); // 10% Deposit
  const canAfford = typeof corporateBalance === "number" ? corporateBalance >= upfrontCost : true;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 p-0 backdrop-blur-sm animate-in fade-in duration-200 sm:items-center sm:p-4">
      <div className="relative flex h-[calc(100dvh-3.5rem-env(safe-area-inset-bottom))] w-full min-w-0 flex-col overflow-hidden rounded-t-[24px] border border-border/80 bg-card shadow-2xl sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl">
        {/* Header Graphic */}
        <div
          className={`relative flex w-full shrink-0 items-center justify-between border-b border-border/30 bg-gradient-to-br ${bgGradient} p-4 sm:h-32 sm:p-6`}
        >
          <div className="z-10 min-w-0 flex-1">
            <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
              {aircraft.manufacturer}
            </span>
            <h2 className="truncate pr-10 text-2xl font-bold text-foreground drop-shadow-sm sm:text-3xl">
              {aircraft.name}
            </h2>
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-40 overflow-hidden border-l border-border/10 sm:block">
            <CatalogImage
              model={aircraft}
              className="h-full w-full object-cover opacity-80"
              fallback={
                <div className="flex h-full w-full items-center justify-center">
                  <Plane className="h-24 w-24 rotate-[-15deg] text-foreground/10" />
                </div>
              }
            />
            <div className="absolute inset-0 bg-gradient-to-l from-transparent via-background/20 to-background/75" />
          </div>

          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-20 rounded-full bg-background/20 p-2 backdrop-blur-md transition-colors hover:bg-background/40"
            aria-label="Close purchase modal"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 pb-24 space-y-6 sm:p-6 sm:pb-28 sm:space-y-8">
          {/* Identification */}
          <div className="space-y-4">
            <h4 className="text-sm font-bold flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" />
              Aircraft Identity
            </h4>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5 border border-border/50 rounded-xl p-3 bg-background/50 focus-within:border-primary/50 transition-colors">
                <label
                  htmlFor={nameInputId}
                  className="text-[10px] font-semibold text-muted-foreground uppercase block"
                >
                  Registration / Name (Optional)
                </label>
                <input
                  id={nameInputId}
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder={`e.g. ${aircraft.name} 1…`}
                  className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/50"
                />
              </div>

              {hubs.length > 0 && (
                <div className="space-y-1.5 border border-border/50 rounded-xl p-3 bg-background/50 focus-within:border-primary/50 transition-colors">
                  <label
                    htmlFor={hubSelectId}
                    className="text-[10px] font-semibold text-muted-foreground uppercase block flex items-center gap-1"
                  >
                    <MapPin className="h-3 w-3" /> Delivery Hub
                  </label>
                  <select
                    id={hubSelectId}
                    value={selectedHub}
                    onChange={(e) => setSelectedHub(e.target.value)}
                    className="w-full bg-transparent text-sm font-medium outline-none cursor-pointer"
                  >
                    {hubs.map((hub) => (
                      <option key={hub} value={hub} className="bg-background text-foreground">
                        {hub}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border/50 bg-background/40 p-4 sm:p-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="min-w-0 overflow-hidden rounded-xl border border-border/50 bg-background/60 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Range
                </p>
                <p className="mt-1 truncate text-base font-mono font-bold text-foreground">
                  {aircraft.rangeKm.toLocaleString()} km
                </p>
              </div>
              <div className="min-w-0 overflow-hidden rounded-xl border border-border/50 bg-background/60 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Speed
                </p>
                <p className="mt-1 truncate text-base font-mono font-bold text-foreground">
                  {aircraft.speedKmh.toLocaleString()} km/h
                </p>
              </div>
              <div className="min-w-0 overflow-hidden rounded-xl border border-border/50 bg-background/60 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Base Seats
                </p>
                <p className="mt-1 truncate text-base font-mono font-bold text-foreground">
                  {aircraft.capacity.economy + aircraft.capacity.business + aircraft.capacity.first}
                </p>
              </div>
              <div className="min-w-0 overflow-hidden rounded-xl border border-border/50 bg-background/60 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Lead Time
                </p>
                <p className="mt-1 truncate text-base font-mono font-bold text-foreground">
                  ~{Math.floor((aircraft.deliveryTimeTicks * TICK_DURATION) / 1000 / 60)}m
                </p>
              </div>
            </div>
          </div>

          {/* Acquisition Type */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-primary" />
              Acquisition Method
            </h4>
            <div className="grid w-full grid-cols-2 gap-0 rounded-xl border border-border/50 bg-background/50 p-1">
              <button
                type="button"
                onClick={() => setPurchaseType("buy")}
                className={`flex-1 py-2 px-4 rounded-lg text-xs font-bold transition-all ${
                  purchaseType === "buy"
                    ? "bg-primary text-primary-foreground shadow-lg"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                }`}
              >
                Cash Purchase
              </button>
              <button
                type="button"
                onClick={() => setPurchaseType("lease")}
                className={`flex-1 py-2 px-4 rounded-lg text-xs font-bold transition-all ${
                  purchaseType === "lease"
                    ? "bg-orange-500 text-white shadow-lg"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                }`}
              >
                Lease Agreement
              </button>
            </div>
            {purchaseType === "lease" && (
              <p className="px-2 text-[10px] italic text-muted-foreground">
                * Lease requires a 10% refundable security deposit and monthly payments of{" "}
                {fpFormat(aircraft.monthlyLease, 0)}.
              </p>
            )}
          </div>

          <div className="h-px w-full bg-border/50" />

          {/* Seat Configuration */}
          <div className="space-y-4">
            <h4 className="text-sm font-bold flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-primary" />
              Cabin Configuration
            </h4>

            <div className="space-y-6 rounded-xl border border-border/50 bg-background/50 p-4 sm:p-5">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor={firstSliderId}
                  className="flex justify-between text-[10px] font-semibold uppercase text-muted-foreground"
                >
                  <span>First Class (4x space)</span>
                  <span className={firstSeats > 0 ? "text-primary" : ""}>{firstSeats} seats</span>
                </label>
                <input
                  id={firstSliderId}
                  type="range"
                  min="0"
                  max={maxFirstClass}
                  step="1"
                  value={firstSeats}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    if (baseEconSpace - busSeats * 2.5 - val * 4 >= 0) {
                      setFirstSeats(val);
                    } else {
                      setBusSeats(Math.floor((baseEconSpace - val * 4) / 2.5));
                      setFirstSeats(val);
                    }
                  }}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-border/50 accent-primary transition-colors hover:bg-border"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor={businessSliderId}
                  className="flex justify-between text-[10px] font-semibold uppercase text-muted-foreground"
                >
                  <span>Business Class (2.5x space)</span>
                  <span className={busSeats > 0 ? "text-primary" : ""}>{busSeats} seats</span>
                </label>
                <input
                  id={businessSliderId}
                  type="range"
                  min="0"
                  max={maxBusinessClass}
                  step="1"
                  value={busSeats}
                  onChange={(e) => setBusSeats(parseInt(e.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-border/50 accent-primary transition-colors hover:bg-border"
                />
              </div>

              <div className="flex flex-col mt-4 pt-4 border-t border-border/50">
                <div className="mb-2 flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0 flex-1 overflow-hidden text-center">
                    <span className="text-muted-foreground text-[10px] block uppercase font-bold mb-1">
                      First
                    </span>
                    <span className="font-mono text-lg font-bold truncate block">{firstSeats}</span>
                  </div>
                  <div className="min-w-0 flex-1 overflow-hidden border-x border-border/50 text-center">
                    <span className="text-muted-foreground text-[10px] block uppercase font-bold mb-1">
                      Business
                    </span>
                    <span className="font-mono text-lg font-bold truncate block">{busSeats}</span>
                  </div>
                  <div className="min-w-0 flex-1 overflow-hidden text-center">
                    <span className="text-muted-foreground text-[10px] block uppercase font-bold mb-1">
                      Economy
                    </span>
                    <span className="font-mono text-lg font-bold text-primary truncate block">
                      {econSeats}
                    </span>
                  </div>
                </div>
                <div className="flex min-w-0 justify-between items-center text-xs mt-4 px-4 py-2 bg-accent/20 rounded-lg border border-accent/20">
                  <span className="truncate text-accent-foreground font-semibold uppercase text-[10px]">
                    Total Passengers
                  </span>
                  <span className="shrink-0 font-mono font-bold text-accent-foreground">
                    {totalCapacity}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/50 bg-background/40 p-4 overflow-hidden">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {purchaseType === "buy" ? "Full Purchase Price" : "Security Deposit (10%)"}
                </p>
                <p
                  className={`mt-1 truncate text-3xl font-black ${canAfford ? "text-primary" : "text-red-500"}`}
                >
                  {fpFormat(upfrontCost, 0)}
                </p>
                {purchaseType === "lease" ? (
                  <p className="mt-1 truncate text-xs font-bold uppercase text-orange-400">
                    + {fpFormat(aircraft.monthlyLease, 0)} / month
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 text-right text-xs text-yellow-500">
                <p className="font-semibold">Ready in</p>
                <p className="font-mono font-bold">
                  ~{Math.floor((aircraft.deliveryTimeTicks * TICK_DURATION) / 1000 / 60)}
                  :00
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Action */}
        <div className="flex shrink-0 min-w-0 flex-col gap-3 overflow-hidden border-t border-border/50 bg-background/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur-md sm:flex-row sm:items-center sm:justify-end sm:p-6">
          <p className="truncate text-center text-xs text-muted-foreground sm:mr-auto sm:text-left">
            Review your configuration above, then confirm the order.
          </p>
          <button
            type="button"
            onClick={handlePurchase}
            disabled={isPurchasing || !canAfford || (hubs.length > 0 && !selectedHub)}
            className={`relative w-full shrink-0 overflow-hidden rounded-xl px-8 py-3 text-base font-bold transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background sm:w-auto ${
              isPurchasing
                ? "bg-primary text-primary-foreground opacity-90 scale-95"
                : !canAfford
                  ? "bg-red-500/10 text-red-500 cursor-not-allowed border border-red-500/20"
                  : "bg-primary text-primary-foreground hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:opacity-90"
            }`}
          >
            <span className="relative flex items-center justify-center gap-2 truncate">
              {isPurchasing ? (
                <>
                  <Check className="h-5 w-5 shrink-0 animate-pulse" />
                  Purchasing…
                </>
              ) : !canAfford ? (
                <>Insufficient Funds</>
              ) : (
                <>
                  <Coins className="h-5 w-5 shrink-0" />
                  Confirm Order
                </>
              )}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
