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
import { useConfirm } from "@/shared/lib/useConfirm";

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gridColumns, setGridColumns] = useState(1);

  useEffect(() => {
    const updateColumns = () => {
      const width = scrollRef.current?.clientWidth ?? 0;
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
  const rowCount = Math.ceil(listItems.length / gridColumns);
  const rowHeight = displayMode === "factory" ? 360 : displayMode === "used-loading" ? 260 : 320;
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 2,
  });

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Mode Switcher */}
      <div className="flex items-center gap-2 border-b border-border/40 pb-4">
        <button
          type="button"
          onClick={() => setMode("factory")}
          className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${mode === "factory" ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "text-muted-foreground hover:bg-accent/40"}`}
        >
          <ShoppingBag className="h-4 w-4" />
          Factory New
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("marketplace");
            fetchUsed();
          }}
          className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${mode === "marketplace" ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "text-muted-foreground hover:bg-accent/40"}`}
        >
          <History className={`h-4 w-4 ${isLoadingUsed ? "animate-spin" : ""}`} />
          Used Marketplace
        </button>
      </div>

      {/* Header & Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl bg-card border border-border/40 p-4 shadow-sm backdrop-blur-xl">
        <div className="flex items-center gap-3 flex-1 min-w-0">
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
              className="h-10 px-4 rounded-xl border border-orange-500/20 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-all font-bold text-xs flex items-center gap-2 disabled:opacity-50"
            >
              <History className={`h-4 w-4 ${isLoadingUsed ? "animate-spin" : ""}`} />
              Refresh
            </button>
          )}
        </div>

        {mode === "factory" && (
          <div className="flex items-center space-x-2 bg-background p-1 rounded-xl border border-border/50">
            <button
              type="button"
              onClick={() => setSelectedTier("all")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
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
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1 ${
                  selectedTier === tier
                    ? "bg-primary/20 text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                Tier {tier}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-10">
        {displayMode === "used-empty" ? (
          <div className="py-20 text-center flex flex-col items-center border border-dashed border-border/50 rounded-2xl bg-card/20">
            <History className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
            <p className="text-muted-foreground">
              No used aircraft currently listed on the Marketplace.
            </p>
          </div>
        ) : (
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((row) => {
              const startIndex = row.index * gridColumns;
              const rowItems = listItems.slice(startIndex, startIndex + gridColumns);

              return (
                <div
                  key={row.key}
                  className="grid gap-6"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${row.size}px`,
                    transform: `translateY(${row.start}px)`,
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
      className={`group relative flex flex-col rounded-2xl bg-card border border-border overflow-hidden transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.5)] hover:border-border/80 ${
        isLocked ? "opacity-60" : ""
      }`}
    >
      {/* Top Image Splash */}
      <div
        className={`h-32 w-full bg-gradient-to-br ${bgGradient} relative flex items-center justify-center border-b border-border/30`}
      >
        <div className="absolute top-4 left-4 flex gap-2">
          <span className="inline-flex items-center rounded-full bg-background/80 backdrop-blur-md px-2.5 py-0.5 text-xs font-semibold text-foreground border border-border/50">
            Tier {aircraft.unlockTier}
          </span>
          <span className="inline-flex items-center rounded-full bg-background/80 backdrop-blur-md px-2.5 py-0.5 text-xs font-semibold uppercase text-muted-foreground border border-border/50">
            {aircraft.type}
          </span>
        </div>
        <Plane className="h-16 w-16 text-foreground/20 rotate-[-15deg] group-hover:scale-110 group-hover:text-foreground/40 transition-all duration-500" />
      </div>

      <div className="flex flex-col flex-1 p-5">
        <div className="mb-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
            {aircraft.manufacturer}
          </p>
          <h3 className="text-xl font-bold text-foreground">{aircraft.name}</h3>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6 mt-auto">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/30 text-accent-foreground border border-accent/20">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Capacity</p>
              <p className="text-sm font-medium">{totalCapacity} pax</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/30 text-accent-foreground border border-accent/20">
              <ArrowRight className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Range</p>
              <p className="text-sm font-medium">{aircraft.rangeKm.toLocaleString()} km</p>
            </div>
          </div>

          <div className="flex items-center gap-3 col-span-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
              <Timer className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">
                Factory Lead Time
              </p>
              <p className="text-sm font-medium text-yellow-500">
                ~{Math.floor((aircraft.deliveryTimeTicks * TICK_DURATION) / 1000 / 60)} minutes
              </p>
            </div>
          </div>
        </div>

        <div className="h-px w-full bg-border/50 mb-4" />

        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">
              List Price
            </p>
            <p className="text-lg font-bold text-primary group-hover:text-primary-foreground transition-colors group-hover:-translate-y-0.5 transform duration-300 drop-shadow-[0_0_10px_rgba(16,185,129,0.2)]">
              {fpFormat(aircraft.price, 0)}
            </p>
          </div>

          <button
            type="button"
            onClick={onSelect}
            disabled={isLocked}
            className={`relative overflow-hidden rounded-xl px-4 py-2 text-sm font-bold transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background ${
              isLocked
                ? "bg-muted/40 text-muted-foreground cursor-not-allowed"
                : "bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] focus:ring-primary"
            }`}
          >
            <span className="relative flex items-center gap-2">
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
    <div className="group relative flex flex-col rounded-2xl bg-card border border-orange-500/20 overflow-hidden transition-all duration-300 hover:shadow-[0_8px_30px_rgb(249,115,22,0.2)] hover:border-orange-500/40">
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

      <div className="flex flex-col flex-1 p-4">
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

        <div className="flex items-end justify-between pt-2">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground font-bold mb-0.5">
              Asking Price
            </p>
            <p className="text-lg font-bold text-orange-400 drop-shadow-[0_0_10px_rgba(249,115,22,0.2)]">
              {fpFormat(listing.marketplacePrice || FP_ZERO, 0)}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5 italic line-clamp-1">
              Seller: {listing.sellerPubkey?.slice(0, 8)}...
            </p>
          </div>

          <button
            type="button"
            onClick={onBuy}
            disabled={isLocked}
            className={`rounded-lg px-4 py-2 text-xs font-bold transition-all ${
              isLocked
                ? "bg-muted/40 text-muted-foreground cursor-not-allowed"
                : "bg-orange-500 text-white hover:bg-orange-600 hover:shadow-[0_0_15px_rgba(249,115,22,0.4)]"
            }`}
          >
            {isLocked ? `Requires Tier ${model.unlockTier}` : "Purchase"}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header Graphic */}
        <div
          className={`h-32 w-full bg-gradient-to-br ${bgGradient} relative flex items-center justify-between p-6 border-b border-border/30 shrink-0`}
        >
          <div className="z-10">
            <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
              {aircraft.manufacturer}
            </span>
            <h2 className="text-3xl font-bold text-foreground drop-shadow-sm">{aircraft.name}</h2>
          </div>
          <Plane className="h-24 w-24 text-foreground/10 rotate-[-15deg] absolute right-6 top-4" />

          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-background/20 hover:bg-background/40 backdrop-blur-md transition-colors z-20"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-8">
          {/* Identification */}
          <div className="space-y-4">
            <h4 className="text-sm font-bold flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" />
              Aircraft Identity
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  placeholder={`e.g. ${aircraft.name} 1`}
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

          {/* Acquisition Type */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-primary" />
              Acquisition Method
            </h4>
            <div className="flex p-1 bg-background/50 border border-border/50 rounded-xl w-full">
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
              <p className="text-[10px] text-muted-foreground italic px-2">
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

            <div className="border border-border/50 rounded-xl p-5 bg-background/50 space-y-6">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor={firstSliderId}
                  className="text-[10px] font-semibold text-muted-foreground uppercase flex justify-between"
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
                  className="w-full accent-primary h-2 bg-border/50 rounded-lg appearance-none cursor-pointer hover:bg-border transition-colors"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor={businessSliderId}
                  className="text-[10px] font-semibold text-muted-foreground uppercase flex justify-between"
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
                  className="w-full accent-primary h-2 bg-border/50 rounded-lg appearance-none cursor-pointer hover:bg-border transition-colors"
                />
              </div>

              <div className="flex flex-col mt-4 pt-4 border-t border-border/50">
                <div className="flex items-center justify-between text-sm mb-2">
                  <div className="text-center flex-1">
                    <span className="text-muted-foreground text-[10px] block uppercase font-bold mb-1">
                      First
                    </span>
                    <span className="font-mono font-bold line-clamp-1 text-lg">{firstSeats}</span>
                  </div>
                  <div className="text-center flex-1 border-x border-border/50">
                    <span className="text-muted-foreground text-[10px] block uppercase font-bold mb-1">
                      Business
                    </span>
                    <span className="font-mono font-bold line-clamp-1 text-lg">{busSeats}</span>
                  </div>
                  <div className="text-center flex-1">
                    <span className="text-muted-foreground text-[10px] block uppercase font-bold mb-1">
                      Economy
                    </span>
                    <span className="font-mono font-bold text-primary line-clamp-1 text-lg">
                      {econSeats}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center text-xs mt-4 px-4 py-2 bg-accent/20 rounded-lg border border-accent/20">
                  <span className="text-accent-foreground font-semibold uppercase text-[10px]">
                    Total Passengers
                  </span>
                  <span className="font-mono font-bold text-accent-foreground">
                    {totalCapacity}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Action */}
        <div className="p-4 sm:p-6 border-t border-border/50 bg-background/50 flex flex-col sm:flex-row items-stretch sm:items-center gap-4 sm:justify-between shrink-0">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">
              {purchaseType === "buy" ? "Full Purchase Price" : "Security Deposit (10%)"}
            </p>
            <p
              className={`text-2xl font-bold drop-shadow-[0_0_10px_rgba(16,185,129,0.2)] ${canAfford ? "text-primary" : "text-red-500"}`}
            >
              {fpFormat(upfrontCost, 0)}
            </p>
            {purchaseType === "lease" && (
              <p className="text-[10px] font-bold text-orange-400 uppercase mt-0.5">
                + {fpFormat(aircraft.monthlyLease, 0)} / month
              </p>
            )}
            <p className="text-xs text-yellow-500 font-medium mt-1 flex items-center gap-1">
              <Timer className="h-3 w-3" /> Ready in ~
              {Math.floor((aircraft.deliveryTimeTicks * TICK_DURATION) / 1000 / 60)}
              :00
            </p>
          </div>

          <button
            type="button"
            onClick={handlePurchase}
            disabled={isPurchasing || !canAfford || (hubs.length > 0 && !selectedHub)}
            className={`relative overflow-hidden rounded-xl px-8 py-3 text-base font-bold transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
              isPurchasing
                ? "bg-primary text-primary-foreground opacity-90 scale-95"
                : !canAfford
                  ? "bg-red-500/10 text-red-500 cursor-not-allowed border border-red-500/20"
                  : "bg-primary text-primary-foreground hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:opacity-90"
            }`}
          >
            <span className="relative flex items-center gap-2">
              {isPurchasing ? (
                <>
                  <Check className="h-5 w-5 animate-pulse" />
                  Purchasing...
                </>
              ) : !canAfford ? (
                <>Insufficient Funds</>
              ) : (
                <>
                  <Coins className="h-5 w-5" />
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
