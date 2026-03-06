import type {
  AircraftInstance,
  AirlineEntity,
  Checkpoint,
  FixedPoint,
  FlightOffer,
  Route,
  TimelineEvent,
} from "@acars/core";
import {
  canonicalRouteKey,
  computeRouteFrequency,
  createLogger,
  fp,
  fpAdd,
  fpFormat,
  fpRaw,
  fpScale,
  fpSub,
  GENESIS_TIME,
  TICK_DURATION,
  TICKS_PER_MONTH,
} from "@acars/core";
import { getAircraftById, getHubPricingForIata } from "@acars/data";
import { getNDK, MARKETPLACE_KIND, NDKEvent } from "@acars/nostr";
import type { ActionLogEntry } from "@acars/nostr";
import type { StateCreator } from "zustand";
import { useEngineStore } from "../engine";
import { reconcileFleetToTick } from "../FlightEngine";
import type { AirlineState } from "../types";

export interface WorldSlice {
  competitors: Map<string, AirlineEntity>;
  globalRouteRegistry: Map<string, FlightOffer[]>;
  /** Unified fleet index: ALL players (including self) keyed by pubkey. */
  fleetByOwner: Map<string, AircraftInstance[]>;
  /** Unified routes index: ALL players (including self) keyed by pubkey. */
  routesByOwner: Map<string, Route[]>;
  viewAs: (pubkey: string | null) => void;
  syncWorld: (options?: { force?: boolean }) => Promise<void>;
  syncCompetitor: (competitorPubkey: string, liveEvents?: ActionLogEntry[]) => Promise<void>;
  /**
   * Re-project all competitor fleets to the given tick using the pure
   * `reconcileFleetToTick` function.  Called every tick from the pipeline
   * to keep competitor aircraft positions current between `syncWorld` calls.
   */
  projectCompetitorFleet: (tick: number) => void;
}

let isSyncingWorld = false;
let pendingSyncWorldOptions: { force?: boolean } | null = null;
const MONTH_TICKS = TICKS_PER_MONTH;
const worldLogger = createLogger("WorldSync");

export function _resetWorldFlags() {
  isSyncingWorld = false;
  pendingSyncWorldOptions = null;
}

const applyMonthlyCosts = (
  balance: FixedPoint,
  hubs: string[] | undefined,
  fleet: AircraftInstance[],
  fromTick: number,
  toTick: number,
): FixedPoint => {
  const cyclesPrevious = Math.floor(fromTick / MONTH_TICKS);
  const cyclesCurrent = Math.floor(toTick / MONTH_TICKS);
  if (cyclesCurrent <= cyclesPrevious) return balance;

  const numCycles = cyclesCurrent - cyclesPrevious;
  let opexTotal = 0;
  if (hubs && hubs.length > 0) {
    for (const hubIata of hubs) {
      opexTotal += getHubPricingForIata(hubIata).monthlyOpex;
    }
  }

  let leaseCost = fp(0);
  for (const ac of fleet) {
    if (ac.purchaseType !== "lease") continue;
    const model = getAircraftById(ac.modelId);
    if (model) {
      leaseCost = fpAdd(leaseCost, model.monthlyLease);
    }
  }

  const totalLeaseCost = fpScale(leaseCost, numCycles);
  const totalOpexCost = fpScale(fp(opexTotal), numCycles);
  const totalCost = fpAdd(totalLeaseCost, totalOpexCost);
  return fpSub(balance, totalCost);
};

export const createWorldSlice: StateCreator<AirlineState, [], [], WorldSlice> = (set, get) => ({
  competitors: new Map(),
  globalRouteRegistry: new Map(),
  fleetByOwner: new Map(),
  routesByOwner: new Map(),
  viewAs: (pubkey) => set({ viewedPubkey: pubkey }),

  /**
   * Lightweight tick-driven re-projection of competitor fleets.
   *
   * Instead of simulating competitor aircraft tick-by-tick (the old
   * `processGlobalTick`), this synchronously re-runs `reconcileFleetToTick`
   * on the stored fleet/routes snapshot.  Because the flight engine is fully
   * deterministic, this produces the correct aircraft positions for any tick
   * without requiring incremental simulation.
   *
   * IMPORTANT: This function updates `fleetByOwner` with projected positions
   * for competitors.  Player fleet is NOT re-projected here — it is kept in
   * sync by identitySlice/fleetSlice/engineSlice.
   *
   * reconcileFleetToTick updates lastTickProcessed on individual aircraft,
   * preventing double-counted landings on subsequent projection calls.
   */
  projectCompetitorFleet: (tick: number) => {
    const { competitors, fleetByOwner, routesByOwner } = get();
    if (competitors.size === 0) return;

    let anyChanges = false;
    const updatedFleetByOwner = new Map(fleetByOwner);

    for (const [pubkey, airline] of competitors) {
      const compFleet = fleetByOwner.get(pubkey) || [];
      const compRoutes = routesByOwner.get(pubkey) || [];

      // Match player semantics: bankrupt/liquidated airlines do not advance.
      if (airline.status === "chapter11" || airline.status === "liquidated") {
        continue;
      }

      if (compFleet.length === 0) {
        continue;
      }

      // Already at or ahead of this tick — carry forward as-is
      if (airline.lastTick != null && airline.lastTick >= tick) {
        continue;
      }

      // Project fleet positions and update the per-owner index.
      const { fleet: projectedFleet } = reconcileFleetToTick(compFleet, compRoutes, tick);
      updatedFleetByOwner.set(pubkey, projectedFleet);
      anyChanges = true;
    }

    if (!anyChanges) return;

    set({ fleetByOwner: updatedFleetByOwner });
  },

  syncWorld: async (options?: { force?: boolean }) => {
    if (isSyncingWorld) {
      if (options?.force || pendingSyncWorldOptions?.force) {
        pendingSyncWorldOptions = { force: true };
      } else {
        pendingSyncWorldOptions = pendingSyncWorldOptions ?? {};
      }
      return;
    }
    isSyncingWorld = true;
    try {
      try {
        const existingState = get();
        // Load completely from Snapshot Rollups! Wait...
        const { loadAllSnapshots } = await import("@acars/nostr");
        const { decompressSnapshotString } = await import("@acars/core");

        const allSnapshots = await loadAllSnapshots();

        const currentTick = useEngineStore.getState().tick;
        const myPubkey = existingState.pubkey;

        const competitors = new Map<string, AirlineEntity>(existingState.competitors);
        const registry = new Map<string, FlightOffer[]>();
        const updatedFleetByOwner = new Map<string, AircraftInstance[]>(existingState.fleetByOwner);
        const updatedRoutesByOwner = new Map<string, Route[]>(existingState.routesByOwner);
        const newTimelineEvents: TimelineEvent[] = [];
        const myHubs = new Set(existingState.airline?.hubs || []);

        // Seed player data into the unified maps
        if (myPubkey) {
          updatedFleetByOwner.set(myPubkey, existingState.fleet || []);
          updatedRoutesByOwner.set(myPubkey, existingState.routes || []);
        }

        for (const [pubkey, payload] of allSnapshots.entries()) {
          if (pubkey === myPubkey) continue;

          try {
            const decompressedStr = await decompressSnapshotString(payload.compressedData);
            const { airline, fleet, routes } = JSON.parse(decompressedStr) as Checkpoint;

            if (airline.status === "chapter11" || airline.status === "liquidated") {
              competitors.set(pubkey, airline);
              updatedFleetByOwner.set(pubkey, fleet);
              updatedRoutesByOwner.set(pubkey, routes);
              continue; // Do not advance bankrupt airlines
            }

            // Alert if they opened a hub in our territory
            const prevComp = existingState.competitors.get(pubkey);
            for (const hub of airline.hubs) {
              if (myHubs.has(hub) && (!prevComp || !prevComp.hubs.includes(hub))) {
                newTimelineEvents.push({
                  id: `evt-comp-hub-${pubkey}-${hub}-${currentTick}`,
                  tick: currentTick,
                  timestamp: GENESIS_TIME + currentTick * TICK_DURATION,
                  type: "competitor_hub",
                  description: `Competitor ${airline.name} just opened a hub at ${hub}!`,
                });
              }
            }

            let finalAirline = airline;
            let finalFleet = fleet;

            if (
              currentTick > 0 &&
              finalAirline.lastTick != null &&
              currentTick > finalAirline.lastTick
            ) {
              const { fleet: projectedFleet, balanceDelta } = reconcileFleetToTick(
                fleet,
                routes,
                currentTick,
              );
              finalFleet = projectedFleet;
              finalAirline = {
                ...finalAirline,
                corporateBalance: applyMonthlyCosts(
                  fpAdd(finalAirline.corporateBalance, balanceDelta),
                  finalAirline.hubs,
                  finalFleet,
                  finalAirline.lastTick ?? 0,
                  currentTick,
                ),
                lastTick: currentTick,
              };
            }

            competitors.set(pubkey, finalAirline);
            updatedFleetByOwner.set(pubkey, finalFleet);
            updatedRoutesByOwner.set(pubkey, routes);

            // Update global route registry
            for (const route of routes) {
              if (route.status !== "active") continue;

              const key = canonicalRouteKey(route.originIata, route.destinationIata);
              const offers = registry.get(key) || [];

              let avgSpeed = 800;
              let avgTravelTime = 0;
              if (route.assignedAircraftIds.length > 0) {
                const models = route.assignedAircraftIds
                  .map((id: string) => {
                    const ac = finalFleet.find((a: AircraftInstance) => a.id === id);
                    return ac ? getAircraftById(ac.modelId) : null;
                  })
                  .filter(Boolean);
                if (models.length > 0) {
                  avgSpeed =
                    models.reduce((sum, m) => sum + (m!.speedKmh || 800), 0) / models.length;
                  avgTravelTime = (route.distanceKm / avgSpeed) * 60;
                }
              }

              const frequency = computeRouteFrequency(
                route.distanceKm,
                route.assignedAircraftIds.length,
                avgSpeed,
              );
              if (frequency === 0) continue;

              const offer: FlightOffer = {
                airlinePubkey: finalAirline.ceoPubkey,
                fareEconomy: route.fareEconomy,
                fareBusiness: route.fareBusiness,
                fareFirst: route.fareFirst,
                frequencyPerWeek: frequency,
                travelTimeMinutes: Math.round(avgTravelTime) || 480,
                stops: 0,
                serviceScore: 0.7,
                brandScore: finalAirline.brandScore || 0.5,
              };

              offers.push(offer);
              registry.set(key, offers);
            }
          } catch (e) {
            worldLogger.warn(`Failed parsing snapshot for competitor ${pubkey}`, e);
          }
        }

        set({
          competitors,
          fleetByOwner: updatedFleetByOwner,
          routesByOwner: updatedRoutesByOwner,
          globalRouteRegistry: registry,
        });

        if (newTimelineEvents.length > 0 && myPubkey) {
          set({
            timeline: [...newTimelineEvents, ...existingState.timeline].slice(0, 1000),
          });
        }

        await settleMarketplaceSales(get, set);
        useEngineStore.setState({ catchupProgress: null });
      } catch (error) {
        console.error("[WorldSlice] Failed to sync world:", error);
        useEngineStore.setState({ catchupProgress: null });
      }
    } finally {
      isSyncingWorld = false;
      if (pendingSyncWorldOptions) {
        const queuedOptions = pendingSyncWorldOptions;
        pendingSyncWorldOptions = null;
        void get().syncWorld(queuedOptions);
      }
    }
  },

  syncCompetitor: async () => {
    return await get().syncWorld();
  },
});

/**
 * Seller-side marketplace settlement.
 *
 * For each aircraft in our fleet that has a `listingPrice` set, check if the
 * same instanceId now exists in a competitor's fleet (fleetByOwner). If so,
 * the buyer has claimed it — settle the transaction on our side.
 */
async function settleMarketplaceSales(
  get: () => AirlineState,
  set: (state: Partial<AirlineState>) => void,
): Promise<void> {
  const { airline, fleet, routes, timeline, pubkey, fleetByOwner } = get();
  if (!airline || !pubkey) return;

  // Build a map of competitor aircraft: ID -> { ownerPubkey, purchasePrice }
  const competitorAircraft = new Map<string, { ownerPubkey: string; purchasePrice: FixedPoint }>();
  for (const [ownerPubkey, ownerFleet] of fleetByOwner) {
    if (ownerPubkey === pubkey) continue;
    for (const ac of ownerFleet) {
      competitorAircraft.set(ac.id, { ownerPubkey, purchasePrice: ac.purchasePrice });
    }
  }

  // Find our listed aircraft that now appear in a competitor's fleet,
  // AND verify the buyer paid the correct price (within 1 FP unit tolerance).
  const soldAircraft = fleet.filter((ac) => {
    if (ac.listingPrice == null || ac.listingPrice <= 0) return false;
    const buyerEntry = competitorAircraft.get(ac.id);
    if (!buyerEntry) return false;
    // Verify the buyer's recorded purchasePrice matches our listingPrice.
    // Allow at most a 1-unit raw fixed-point delta for rounding differences.
    const priceDiff =
      buyerEntry.purchasePrice >= ac.listingPrice
        ? fpSub(buyerEntry.purchasePrice, ac.listingPrice)
        : fpSub(ac.listingPrice, buyerEntry.purchasePrice);
    const tolerance = fpRaw(1);
    if (priceDiff > tolerance) {
      console.warn(
        `[WorldSlice] Settlement rejected for ${ac.id}: buyer price ${fpFormat(buyerEntry.purchasePrice)} != listing ${fpFormat(ac.listingPrice)}`,
      );
      return false;
    }
    return true;
  });

  if (soldAircraft.length === 0) return;

  console.info(`[WorldSlice] Detected ${soldAircraft.length} sold aircraft requiring settlement.`);

  const currentTick = useEngineStore.getState().tick;
  let updatedFleet = [...fleet];
  let updatedBalance = airline.corporateBalance;
  const newTimelineEvents: TimelineEvent[] = [];

  for (const sold of soldAircraft) {
    const salePrice = sold.listingPrice!;
    updatedBalance = fpAdd(updatedBalance, salePrice);

    // Remove from fleet
    updatedFleet = updatedFleet.filter((ac) => ac.id !== sold.id);

    // Remove from any assigned routes
    const simulatedTimestamp = GENESIS_TIME + currentTick * TICK_DURATION;

    const saleEvent: TimelineEvent = {
      id: `evt-marketplace-sale-${sold.id}-${currentTick}`,
      tick: currentTick,
      timestamp: simulatedTimestamp,
      type: "sale",
      aircraftId: sold.id,
      aircraftName: sold.name,
      revenue: salePrice,
      description: `Sold ${sold.name} on marketplace for ${fpFormat(salePrice, 0)}. Settlement completed.`,
    };

    newTimelineEvents.push(saleEvent);
    console.info(
      `[WorldSlice] Settled sale of ${sold.name} (${sold.id}) for ${fpFormat(salePrice, 0)}`,
    );
  }

  // Clean up routes that referenced sold aircraft
  const soldIds = new Set(soldAircraft.map((ac) => ac.id));
  const updatedRoutes = routes.map((rt) => {
    const cleaned = rt.assignedAircraftIds.filter((id) => !soldIds.has(id));
    return cleaned.length !== rt.assignedAircraftIds.length
      ? { ...rt, assignedAircraftIds: cleaned }
      : rt;
  });

  const updatedAirline = {
    ...airline,
    corporateBalance: updatedBalance,
    fleetIds: updatedFleet.map((ac) => ac.id),
  };

  const finalTimeline = [...newTimelineEvents, ...timeline].slice(0, 1000);

  // Optimistic update
  set({
    airline: updatedAirline,
    fleet: updatedFleet,
    routes: updatedRoutes,
    timeline: finalTimeline,
  });

  // Publish updated airline state + delete marketplace listings (seller-signed, NIP-09 compliant)
  try {
    // Delete our own marketplace listings (we are the author, so NIP-09 allows this)
    const ndk = getNDK();
    for (const sold of soldAircraft) {
      try {
        const deletionEvent = new NDKEvent(ndk);
        deletionEvent.kind = 5;
        deletionEvent.tags = [["a", `${MARKETPLACE_KIND}:${pubkey}:airtr:marketplace:${sold.id}`]];
        await deletionEvent.publish();
        console.info(`[WorldSlice] Published NIP-09 deletion for marketplace listing: ${sold.id}`);
      } catch (e) {
        // Non-critical: listing will be filtered by ownership verification on other clients
        console.warn(`[WorldSlice] Failed to publish deletion for listing ${sold.id}:`, e);
      }
    }
  } catch (e) {
    // Rollback on publish failure
    console.error("[WorldSlice] Failed to publish marketplace settlement:", e);
    set({ airline, fleet, routes, timeline });
  }
}
