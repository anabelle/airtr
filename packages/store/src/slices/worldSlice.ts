import type {
  AircraftInstance,
  AirlineEntity,
  FixedPoint,
  FlightOffer,
  Route,
  TimelineEvent,
} from "@acars/core";
import {
  fp,
  fpAdd,
  fpFormat,
  fpScale,
  fpSub,
  GENESIS_TIME,
  TICK_DURATION,
  TICKS_PER_HOUR,
} from "@acars/core";
import { getAircraftById, getHubPricingForIata } from "@acars/data";
import { getNDK, loadActionLog, loadCheckpoints, MARKETPLACE_KIND, NDKEvent } from "@acars/nostr";
import type { StateCreator } from "zustand";
import { replayActionLog } from "../actionReducer";
import { useEngineStore } from "../engine";
import { reconcileFleetToTick } from "../FlightEngine";
import { computeRejectedBuyEventIds } from "../marketplaceReplay";
import type { AirlineState } from "../types";

export interface WorldSlice {
  competitors: Map<string, AirlineEntity>;
  globalRouteRegistry: Map<string, FlightOffer[]>;
  globalFleet: AircraftInstance[];
  globalFleetByOwner: Map<string, AircraftInstance[]>;
  globalRoutes: Route[];
  globalRoutesByOwner: Map<string, Route[]>;
  viewAs: (pubkey: string | null) => void;
  syncWorld: (options?: { force?: boolean }) => Promise<void>;
  syncCompetitor: (competitorPubkey: string) => Promise<void>;
  /**
   * Re-project all competitor fleets to the given tick using the pure
   * `reconcileFleetToTick` function.  Called every tick from the pipeline
   * to keep competitor aircraft positions current between `syncWorld` calls.
   */
  projectCompetitorFleet: (tick: number) => void;
}

let isSyncingWorld = false;
let pendingSyncWorldOptions: { force?: boolean } | null = null;
const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;
const MONTH_TICKS = 30 * TICKS_PER_DAY;

/** @internal — test-only helper to reset module-level concurrency flags */
export function _resetWorldFlags() {
  isSyncingWorld = false;
  pendingSyncWorldOptions = null;
}

const buildFleetIndex = (fleet: AircraftInstance[]) => {
  const byOwner = new Map<string, AircraftInstance[]>();
  for (const aircraft of fleet) {
    const bucket = byOwner.get(aircraft.ownerPubkey);
    if (bucket) {
      bucket.push(aircraft);
    } else {
      byOwner.set(aircraft.ownerPubkey, [aircraft]);
    }
  }
  return byOwner;
};

const buildRoutesIndex = (routes: Route[]) => {
  const byOwner = new Map<string, Route[]>();
  for (const route of routes) {
    const bucket = byOwner.get(route.airlinePubkey);
    if (bucket) {
      bucket.push(route);
    } else {
      byOwner.set(route.airlinePubkey, [route]);
    }
  }
  return byOwner;
};

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
  globalFleet: [],
  globalFleetByOwner: new Map(),
  globalRoutes: [],
  globalRoutesByOwner: new Map(),
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
   * IMPORTANT: This function only updates the combined globalFleet for
   * display purposes. It does NOT mutate globalFleetByOwner (authoritative
   * fleet by owner) or the competitors map (lastTick, corporateBalance).
   * Authoritative state is written exclusively by syncWorld/syncCompetitor,
   * which also apply monthly recurring costs via applyMonthlyCosts.
   *
   * reconcileFleetToTick updates lastTickProcessed on individual aircraft,
   * preventing double-counted landings on subsequent projection calls.
   */
  projectCompetitorFleet: (tick: number) => {
    const { competitors, globalFleetByOwner, globalRoutesByOwner, fleet: playerFleet } = get();
    if (competitors.size === 0 && (!playerFleet || playerFleet.length === 0)) return;

    const updatedGlobalFleet: AircraftInstance[] = [];
    let anyChanges = false;

    // Include player's own fleet in the display fleet (they're always at current tick)
    if (playerFleet && playerFleet.length > 0) {
      updatedGlobalFleet.push(...playerFleet);
    }

    for (const [pubkey, airline] of competitors) {
      const compFleet = globalFleetByOwner.get(pubkey) || [];
      const compRoutes = globalRoutesByOwner.get(pubkey) || [];

      if (compFleet.length === 0) {
        continue;
      }

      // Already at or ahead of this tick — carry forward as-is
      if (airline.lastTick != null && airline.lastTick >= tick) {
        updatedGlobalFleet.push(...compFleet);
        continue;
      }

      // Project fleet positions for display only. This does NOT update
      // globalFleetByOwner (authoritative) — only the combined display fleet.
      const { fleet: projectedFleet } = reconcileFleetToTick(compFleet, compRoutes, tick);
      updatedGlobalFleet.push(...projectedFleet);
      anyChanges = true;
    }

    // Skip update if no changes and no player fleet to display
    if (!anyChanges && (!playerFleet || playerFleet.length === 0)) {
      return;
    }

    // Write to globalFleet (display) only — NOT globalFleetByOwner (authoritative).
    // This keeps the per-owner index clean for syncWorld reconciliation.
    set({
      globalFleet: updatedGlobalFleet,
    });
  },

  syncWorld: async (options?: { force?: boolean }) => {
    if (isSyncingWorld) {
      // Queue at most one follow-up sync instead of silently dropping.
      // Preserve force if either the queued or current request uses it.
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
        const actions = await loadActionLog({ limit: 500, maxPages: 20 });
        const authorPubkeys = Array.from(
          new Set(actions.map((entry) => entry.event.author.pubkey)),
        );
        const checkpoints = await loadCheckpoints(authorPubkeys);
        // Seed from existing state so competitors not returned by this
        // relay fetch are preserved instead of silently dropped.
        const fetchedPubkeys = new Set<string>();
        const competitors = new Map<string, AirlineEntity>(existingState.competitors);
        const registry = new Map<string, FlightOffer[]>();
        const allGlobalFleet: AircraftInstance[] = [];
        const allGlobalRoutes: Route[] = [];

        const rejectedBuyEventIds = computeRejectedBuyEventIds(actions);

        const actionsByPubkey = new Map<string, typeof actions>();
        for (const entry of actions) {
          const author = entry.event.author.pubkey;
          const bucket = actionsByPubkey.get(author) || [];
          bucket.push(entry);
          actionsByPubkey.set(author, bucket);
        }

        for (const [authorPubkey, entries] of actionsByPubkey.entries()) {
          if (authorPubkey === existingState.pubkey) continue;

          const checkpoint = checkpoints.get(authorPubkey) ?? null;
          let scopedEntries = entries;
          if (checkpoint) {
            const checkpointTick = checkpoint.tick;
            const checkpointCreatedAtSeconds = Math.floor(checkpoint.createdAt / 1000);
            scopedEntries = entries.filter((entry) => {
              const actionTick = (entry.action.payload as Record<string, unknown>)?.tick;
              return typeof actionTick === "number" && Number.isFinite(actionTick)
                ? actionTick > checkpointTick
                : (entry.event.created_at ?? 0) > checkpointCreatedAtSeconds;
            });
            // No fallback: if no actions are newer than checkpoint, checkpoint
            // state is authoritative.  Replaying ALL actions would push lastTick
            // ahead of the checkpoint fleet state, causing the synchronized-
            // departure bug (all aircraft land/depart simultaneously on reload).
          }
          const replayed = await replayActionLog({
            pubkey: authorPubkey,
            actions: scopedEntries.map((entry) => ({
              action: entry.action,
              eventId: entry.event.id,
              authorPubkey: entry.event.author.pubkey,
              createdAt: entry.event.created_at ?? null,
            })),
            checkpoint,
            rejectedEventIds: rejectedBuyEventIds,
          });

          if (!replayed.airline) continue;

          const airline = replayed.airline;
          const fleet = replayed.fleet;
          const routes = replayed.routes;

          const existingCompetitor = existingState.competitors.get(authorPubkey) ?? null;
          const existingLastTick = existingCompetitor?.lastTick ?? -1;
          const parsedLastTick = airline.lastTick ?? 0;

          const resolvedAirline =
            existingCompetitor && existingLastTick > parsedLastTick ? existingCompetitor : airline;
          let resolvedFleet =
            existingCompetitor && existingLastTick > parsedLastTick
              ? existingState.globalFleetByOwner.get(authorPubkey) || []
              : fleet;
          const resolvedRoutes =
            existingCompetitor && existingLastTick > parsedLastTick
              ? existingState.globalRoutesByOwner.get(authorPubkey) || []
              : routes;

          // Reconcile fleet positions to lastTick — same fix as player identity.
          // Without this, checkpoint fleet has stale arrivalTick/turnaroundEndTick
          // values while lastTick was pushed ahead by TICK_UPDATE actions, causing
          // all competitor aircraft to land and depart simultaneously on load.
          if (resolvedAirline.lastTick != null && resolvedFleet.length > 0) {
            const { fleet: reconciledFleet, balanceDelta } = reconcileFleetToTick(
              resolvedFleet,
              resolvedRoutes,
              resolvedAirline.lastTick,
            );
            resolvedFleet = reconciledFleet;
            resolvedAirline.corporateBalance = fpAdd(
              resolvedAirline.corporateBalance,
              balanceDelta,
            );
          }

          competitors.set(authorPubkey, resolvedAirline);
          fetchedPubkeys.add(authorPubkey);
          allGlobalFleet.push(...resolvedFleet);
          allGlobalRoutes.push(...resolvedRoutes);

          for (const route of resolvedRoutes) {
            if (route.status !== "active") continue;

            const key = `${route.originIata}-${route.destinationIata}`;
            const offers = registry.get(key) || [];

            const frequency = Math.max(0, route.assignedAircraftIds.length * 7);
            if (frequency === 0) continue;

            let avgTravelTime = 0;
            if (route.assignedAircraftIds.length > 0) {
              const modelIds = route.assignedAircraftIds
                .map((id: string) => {
                  const ac = resolvedFleet.find((a: AircraftInstance) => a.id === id);
                  return ac?.modelId;
                })
                .filter(Boolean);

              const times = modelIds.map((mid: string | undefined) => {
                const model = getAircraftById(mid!);
                if (!model) return 480;
                return (route.distanceKm / (model.speedKmh || 800)) * 60;
              });
              avgTravelTime =
                times.length > 0
                  ? times.reduce((a: number, b: number) => a + b, 0) / times.length
                  : 480;
            }

            const offer: FlightOffer = {
              airlinePubkey: resolvedAirline.ceoPubkey,
              fareEconomy: route.fareEconomy,
              fareBusiness: route.fareBusiness,
              fareFirst: route.fareFirst,
              frequencyPerWeek: frequency,
              travelTimeMinutes: Math.round(avgTravelTime) || 480,
              stops: 0,
              serviceScore: 0.7,
              brandScore: resolvedAirline.brandScore || 0.5,
            };

            offers.push(offer);
            registry.set(key, offers);
          }
        }

        // Preserve fleet, routes, and registry entries for competitors
        // that were NOT returned by this relay fetch.  Without this,
        // a partial/empty relay response silently drops them from state.
        for (const [pubkey, airline] of competitors) {
          if (fetchedPubkeys.has(pubkey)) continue;
          // This competitor was already in state but missing from the
          // current fetch — carry forward its existing fleet & routes.
          const preservedFleet = existingState.globalFleetByOwner.get(pubkey) || [];
          const preservedRoutes = existingState.globalRoutesByOwner.get(pubkey) || [];
          allGlobalFleet.push(...preservedFleet);
          allGlobalRoutes.push(...preservedRoutes);

          for (const route of preservedRoutes) {
            if (route.status !== "active") continue;
            const key = `${route.originIata}-${route.destinationIata}`;
            const offers = registry.get(key) || [];
            const frequency = Math.max(0, route.assignedAircraftIds.length * 7);
            if (frequency === 0) continue;

            let avgTravelTime = 0;
            if (route.assignedAircraftIds.length > 0) {
              const modelIds = route.assignedAircraftIds
                .map((id: string) => {
                  const ac = preservedFleet.find((a: AircraftInstance) => a.id === id);
                  return ac?.modelId;
                })
                .filter(Boolean);
              const times = modelIds.map((mid: string | undefined) => {
                const model = getAircraftById(mid!);
                if (!model) return 480;
                return (route.distanceKm / (model.speedKmh || 800)) * 60;
              });
              avgTravelTime =
                times.length > 0
                  ? times.reduce((a: number, b: number) => a + b, 0) / times.length
                  : 480;
            }

            const offer: FlightOffer = {
              airlinePubkey: airline.ceoPubkey,
              fareEconomy: route.fareEconomy,
              fareBusiness: route.fareBusiness,
              fareFirst: route.fareFirst,
              frequencyPerWeek: frequency,
              travelTimeMinutes: Math.round(avgTravelTime) || 480,
              stops: 0,
              serviceScore: 0.7,
              brandScore: airline.brandScore || 0.5,
            };
            offers.push(offer);
            registry.set(key, offers);
          }
        }

        // Project all competitor fleets to the current tick using the
        // deterministic reconcile function, replacing the old tick-by-tick
        // catch-up loop.  This is O(N) per aircraft instead of O(N*T).
        const currentTick = useEngineStore.getState().tick;

        // Include player's fleet in the display globalFleet
        const playerFleet = existingState.fleet || [];

        if (currentTick > 0 && competitors.size > 0) {
          const allFleetByOwner = buildFleetIndex(allGlobalFleet);
          const allRoutesByOwner = buildRoutesIndex(allGlobalRoutes);
          const updatedGlobalFleet: AircraftInstance[] = [...playerFleet];
          const updatedCompetitors = new Map(competitors);

          for (const [competitorPubkey, airline] of competitors) {
            const compFleet = allFleetByOwner.get(competitorPubkey) || [];
            const compRoutes = allRoutesByOwner.get(competitorPubkey) || [];

            // Apply monthly costs even for competitors with zero aircraft.
            // They may have hub opex that needs to be charged.
            if (compFleet.length === 0) {
              if (airline.lastTick == null || airline.lastTick < currentTick) {
                updatedCompetitors.set(competitorPubkey, {
                  ...airline,
                  corporateBalance: applyMonthlyCosts(
                    airline.corporateBalance,
                    airline.hubs,
                    [],
                    airline.lastTick ?? 0,
                    currentTick,
                  ),
                  lastTick: currentTick,
                });
              }
              continue;
            }

            if (airline.lastTick != null && airline.lastTick >= currentTick) {
              updatedGlobalFleet.push(...compFleet);
              continue;
            }

            const { fleet: projectedFleet, balanceDelta } = reconcileFleetToTick(
              compFleet,
              compRoutes,
              currentTick,
            );
            updatedGlobalFleet.push(...projectedFleet);

            const projectedBalance = applyMonthlyCosts(
              fpAdd(airline.corporateBalance, balanceDelta),
              airline.hubs,
              projectedFleet,
              airline.lastTick ?? 0,
              currentTick,
            );
            updatedCompetitors.set(competitorPubkey, {
              ...airline,
              corporateBalance: projectedBalance,
              lastTick: currentTick,
            });
          }

          // Include fleet for competitors that had no entries in the fetched
          // data but were already in allGlobalFleet (shouldn't happen, but
          // defensive).
          const finalFleet = updatedGlobalFleet;

          // Build globalFleetByOwner from competitor fleet only (authoritative index).
          // Do NOT include player fleet here - it's in a separate slice.
          const competitorFleet = finalFleet.filter(
            (ac) => ac.ownerPubkey !== existingState.pubkey,
          );

          set({
            competitors: updatedCompetitors,
            globalFleet: finalFleet,
            globalFleetByOwner: buildFleetIndex(competitorFleet),
            globalRoutes: allGlobalRoutes,
            globalRoutesByOwner: buildRoutesIndex(allGlobalRoutes),
            globalRouteRegistry: registry,
          });

          await settleMarketplaceSales(get, set, finalFleet);
          return;
        }

        set({
          competitors,
          globalRouteRegistry: registry,
          globalFleet: [...playerFleet, ...allGlobalFleet],
          globalFleetByOwner: buildFleetIndex(allGlobalFleet),
          globalRoutes: allGlobalRoutes,
          globalRoutesByOwner: buildRoutesIndex(allGlobalRoutes),
        });
        useEngineStore.setState({ catchupProgress: null });

        // --- Competitor Alerts ---
        const myAirline = existingState.airline;
        if (myAirline) {
          const myHubs = new Set(myAirline.hubs || []);
          const newTimelineEvents: TimelineEvent[] = [];
          const currentTick = useEngineStore.getState().tick;

          for (const [pubkey, comp] of competitors) {
            if (pubkey === existingState.pubkey) continue;
            const prevComp = existingState.competitors.get(pubkey);
            for (const hub of comp.hubs) {
              if (myHubs.has(hub) && (!prevComp || !prevComp.hubs.includes(hub))) {
                newTimelineEvents.push({
                  id: `evt-comp-hub-${pubkey}-${hub}-${currentTick}`,
                  tick: currentTick,
                  timestamp: Date.now(),
                  type: "competitor_hub",
                  description: `Competitor ${comp.name} just opened a hub at ${hub}!`,
                });
              }
            }
          }

          if (newTimelineEvents.length > 0) {
            set({
              timeline: [...newTimelineEvents, ...existingState.timeline].slice(0, 1000),
            });
          }
        }

        // --- Seller-side settlement ---
        // Detect aircraft we listed for sale that now appear in a competitor's fleet.
        // This means the buyer purchased it; we must settle: remove from our fleet,
        // credit the listing price, delete our marketplace event (NIP-09 compliant),
        // and record a timeline event.
        await settleMarketplaceSales(get, set, allGlobalFleet);
      } catch (error) {
        console.error("[WorldSlice] Failed to sync world:", error);
        useEngineStore.setState({ catchupProgress: null });
      }
    } finally {
      isSyncingWorld = false;
      // Drain the queue: if a sync was requested while we were busy, run it now.
      if (pendingSyncWorldOptions) {
        const queuedOptions = pendingSyncWorldOptions;
        pendingSyncWorldOptions = null;
        void get().syncWorld(queuedOptions);
      }
    }
  },

  syncCompetitor: async (competitorPubkey: string) => {
    const existingState = get();
    if (competitorPubkey === existingState.pubkey) return;

    try {
      // Targeted fetch for this competitor plus global marketplace buys for replay filtering.
      const [actions, checkpoints, globalActions] = await Promise.all([
        loadActionLog({
          authors: [competitorPubkey],
          limit: 500,
          maxPages: 20,
        }),
        loadCheckpoints([competitorPubkey]),
        loadActionLog({ limit: 500, maxPages: 20 }),
      ]);

      if (actions.length === 0 && checkpoints.size === 0) return;

      const checkpoint = checkpoints.get(competitorPubkey) ?? null;
      let scopedEntries = actions;
      if (checkpoint) {
        const checkpointTick = checkpoint.tick;
        const checkpointCreatedAtSeconds = Math.floor(checkpoint.createdAt / 1000);
        scopedEntries = actions.filter((entry) => {
          const actionTick = (entry.action.payload as Record<string, unknown>)?.tick;
          return typeof actionTick === "number" && Number.isFinite(actionTick)
            ? actionTick > checkpointTick
            : (entry.event.created_at ?? 0) > checkpointCreatedAtSeconds;
        });
      }

      const rejectedBuyEventIds = computeRejectedBuyEventIds(globalActions);

      const replayed = await replayActionLog({
        pubkey: competitorPubkey,
        actions: scopedEntries.map((entry) => ({
          action: entry.action,
          eventId: entry.event.id,
          authorPubkey: entry.event.author.pubkey,
          createdAt: entry.event.created_at ?? null,
        })),
        checkpoint,
        rejectedEventIds: rejectedBuyEventIds,
      });

      if (!replayed.airline) return;

      const airline = replayed.airline;
      let resolvedFleet = replayed.fleet;
      const resolvedRoutes = replayed.routes;

      // Reconcile fleet positions to lastTick
      if (airline.lastTick != null && resolvedFleet.length > 0) {
        const { fleet: reconciledFleet, balanceDelta } = reconcileFleetToTick(
          resolvedFleet,
          resolvedRoutes,
          airline.lastTick,
        );
        resolvedFleet = reconciledFleet;
        airline.corporateBalance = fpAdd(airline.corporateBalance, balanceDelta);
      }

      // Project fleet forward to the current tick so the stored state is
      // up-to-date.  This replaces the old processGlobalTick catch-up.
      const currentTick = useEngineStore.getState().tick;
      if (currentTick > 0 && (airline.lastTick == null || currentTick > airline.lastTick)) {
        const { fleet: projectedFleet, balanceDelta } = reconcileFleetToTick(
          resolvedFleet,
          resolvedRoutes,
          currentTick,
        );
        resolvedFleet = projectedFleet;
        airline.corporateBalance = fpAdd(airline.corporateBalance, balanceDelta);
        // Apply monthly recurring costs (hub opex, lease payments) for any
        // month boundaries crossed during projection — mirrors syncWorld logic.
        airline.corporateBalance = applyMonthlyCosts(
          airline.corporateBalance,
          airline.hubs,
          resolvedFleet,
          airline.lastTick ?? 0,
          currentTick,
        );
        airline.lastTick = currentTick;
      }

      // Merge into existing state — only replace this competitor's data
      const freshState = get();
      const updatedCompetitors = new Map(freshState.competitors);
      updatedCompetitors.set(competitorPubkey, airline);

      // Rebuild global fleet: remove old entries for this competitor, add new ones
      // Note: globalFleet includes player + competitor aircraft for display
      const updatedGlobalFleet = [
        ...freshState.globalFleet.filter((ac) => ac.ownerPubkey !== competitorPubkey),
        ...resolvedFleet,
      ];

      // Build globalFleetByOwner from competitor fleet only (authoritative index).
      // Do NOT include player fleet here - it's in a separate slice.
      const competitorFleet = updatedGlobalFleet.filter(
        (ac) => ac.ownerPubkey !== freshState.pubkey,
      );

      // Rebuild global routes: remove old entries for this competitor, add new ones
      const updatedGlobalRoutes = [
        ...freshState.globalRoutes.filter((rt) => rt.airlinePubkey !== competitorPubkey),
        ...resolvedRoutes,
      ];

      // Rebuild route registry: remove old offers from this competitor, add new ones
      const updatedRegistry = new Map(freshState.globalRouteRegistry);
      // Remove all offers from this competitor
      for (const [key, offers] of updatedRegistry) {
        const filtered = offers.filter((o) => o.airlinePubkey !== competitorPubkey);
        if (filtered.length > 0) {
          updatedRegistry.set(key, filtered);
        } else {
          updatedRegistry.delete(key);
        }
      }
      // Add new offers from this competitor
      for (const route of resolvedRoutes) {
        if (route.status !== "active") continue;
        const frequency = Math.max(0, route.assignedAircraftIds.length * 7);
        if (frequency === 0) continue;

        let avgTravelTime = 0;
        if (route.assignedAircraftIds.length > 0) {
          const modelIds = route.assignedAircraftIds
            .map((id: string) => {
              const ac = resolvedFleet.find((a: AircraftInstance) => a.id === id);
              return ac?.modelId;
            })
            .filter(Boolean);
          const times = modelIds.map((mid: string | undefined) => {
            const model = getAircraftById(mid!);
            if (!model) return 480;
            return (route.distanceKm / (model.speedKmh || 800)) * 60;
          });
          avgTravelTime =
            times.length > 0
              ? times.reduce((a: number, b: number) => a + b, 0) / times.length
              : 480;
        }

        const key = `${route.originIata}-${route.destinationIata}`;
        const offers = updatedRegistry.get(key) || [];
        const offer: FlightOffer = {
          airlinePubkey: airline.ceoPubkey,
          fareEconomy: route.fareEconomy,
          fareBusiness: route.fareBusiness,
          fareFirst: route.fareFirst,
          frequencyPerWeek: frequency,
          travelTimeMinutes: Math.round(avgTravelTime) || 480,
          stops: 0,
          serviceScore: 0.7,
          brandScore: airline.brandScore || 0.5,
        };
        offers.push(offer);
        updatedRegistry.set(key, offers);
      }

      set({
        competitors: updatedCompetitors,
        globalFleet: updatedGlobalFleet,
        globalFleetByOwner: buildFleetIndex(competitorFleet),
        globalRoutes: updatedGlobalRoutes,
        globalRoutesByOwner: buildRoutesIndex(updatedGlobalRoutes),
        globalRouteRegistry: updatedRegistry,
      });
    } catch (error) {
      console.error(
        `[WorldSlice] Failed to sync competitor ${competitorPubkey.slice(0, 8)}...:`,
        error,
      );
    }
  },
});

/**
 * Seller-side marketplace settlement.
 *
 * For each aircraft in our fleet that has a `listingPrice` set, check if the
 * same instanceId now exists in a competitor's fleet (globalFleet). If so,
 * the buyer has claimed it — settle the transaction on our side.
 */
async function settleMarketplaceSales(
  get: () => AirlineState,
  set: (state: Partial<AirlineState>) => void,
  globalFleet: AircraftInstance[],
): Promise<void> {
  const { airline, fleet, routes, timeline, pubkey } = get();
  if (!airline || !pubkey) return;

  // Build a set of all aircraft IDs owned by competitors
  const competitorAircraftIds = new Set(globalFleet.map((ac) => ac.id));

  // Find our listed aircraft that now appear in a competitor's fleet
  const soldAircraft = fleet.filter(
    (ac) => ac.listingPrice != null && ac.listingPrice > 0 && competitorAircraftIds.has(ac.id),
  );

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
