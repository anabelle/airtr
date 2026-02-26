import type {
  AircraftInstance,
  AirlineEntity,
  FixedPoint,
  FlightOffer,
  Route,
  TimelineEvent,
} from "@airtr/core";
import {
  fp,
  fpAdd,
  fpFormat,
  fpScale,
  fpSub,
  GENESIS_TIME,
  TICK_DURATION,
  TICKS_PER_HOUR,
} from "@airtr/core";
import { getAircraftById, getHubPricingForIata } from "@airtr/data";
import { getNDK, loadActionLog, loadCheckpoints, MARKETPLACE_KIND, NDKEvent } from "@airtr/nostr";
import type { StateCreator } from "zustand";
import { replayActionLog } from "../actionReducer";
import { useEngineStore } from "../engine";
import { processFlightEngine, reconcileFleetToTick } from "../FlightEngine";
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
  processGlobalTick: (tick: number) => Promise<void>;
}

let isProcessingGlobal = false;
let isSyncingWorld = false;
let pendingSyncWorldOptions: { force?: boolean } | null = null;
const GLOBAL_CATCHUP_CHUNK = 200;
const MAX_COMPETITOR_CATCHUP = 1000;
const MAX_TOTAL_COMPETITOR_TICKS = 5000;
const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;
const MONTH_TICKS = 30 * TICKS_PER_DAY;

/** @internal — test-only helper to reset module-level concurrency flags */
export function _resetWorldFlags() {
  isProcessingGlobal = false;
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

  processGlobalTick: async (tick: number) => {
    if (isProcessingGlobal) return;

    const {
      competitors,
      globalFleetByOwner,
      globalRoutesByOwner,
      globalRouteRegistry,
      routes,
      fleet,
      pubkey: playerPubkey,
      airline: playerAirline,
    } = get();
    if (competitors.size === 0) return;

    isProcessingGlobal = true;
    try {
      const updatedGlobalFleet: AircraftInstance[] = [];
      const updatedCompetitors = new Map(competitors);
      const processedPubkeys = new Set<string>();
      let anyChanges = false;
      useEngineStore.setState({ catchupProgress: { current: 0, target: 0, phase: "competitor" } });

      const playerRouteRegistry = new Map<string, FlightOffer[]>();
      const playerBrandScore = playerAirline?.brandScore || 0.5;
      for (const route of routes) {
        if (route.status !== "active") continue;

        const frequency = Math.max(0, route.assignedAircraftIds.length * 7);
        if (frequency === 0) continue;

        let avgTravelTime = 0;
        if (route.assignedAircraftIds.length > 0) {
          const modelIds = route.assignedAircraftIds
            .map((id: string) => {
              const ac = fleet.find((a: AircraftInstance) => a.id === id);
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
        const offers = playerRouteRegistry.get(key) || [];
        const offer: FlightOffer = {
          airlinePubkey: playerPubkey || "",
          fareEconomy: route.fareEconomy,
          fareBusiness: route.fareBusiness,
          fareFirst: route.fareFirst,
          frequencyPerWeek: frequency,
          travelTimeMinutes: Math.round(avgTravelTime) || 480,
          stops: 0,
          serviceScore: 0.7,
          brandScore: playerBrandScore,
        };
        offers.push(offer);
        playerRouteRegistry.set(key, offers);
      }

      const globalRegistryEntries = [...globalRouteRegistry.entries()];

      let totalTicksProcessed = 0;
      const competitorList = [...competitors.entries()];
      competitorList.sort(([, aAirline], [, bAirline]) => {
        const aLast = aAirline.lastTick ?? tick - 1;
        const bLast = bAirline.lastTick ?? tick - 1;
        return tick - bLast - (tick - aLast);
      });

      for (const [competitorPubkey, airline] of competitorList) {
        if (totalTicksProcessed >= MAX_TOTAL_COMPETITOR_TICKS) break;
        const airlineLastTick = airline.lastTick ?? tick - 1;
        const compFleet = globalFleetByOwner.get(competitorPubkey) || [];
        const compRoutes = globalRoutesByOwner.get(competitorPubkey) || [];

        if (compFleet.length === 0) continue;

        if (airlineLastTick >= tick) {
          updatedGlobalFleet.push(...compFleet);
          processedPubkeys.add(competitorPubkey);
          continue;
        }

        let currentFleet = [...compFleet];
        let currentBalance = airline.corporateBalance;

        const remainingBudget = Math.max(0, MAX_TOTAL_COMPETITOR_TICKS - totalTicksProcessed);
        const backlog = tick - airlineLastTick;
        const tickBudget = Math.min(backlog, MAX_COMPETITOR_CATCHUP, remainingBudget);
        const analyticalTarget = tick - tickBudget;
        const startTick = analyticalTarget + 1;

        const competitorRegistry = new Map<string, FlightOffer[]>();
        for (const [routeKey, offers] of globalRegistryEntries) {
          const filtered = offers.filter((o) => o.airlinePubkey !== competitorPubkey);
          if (filtered.length > 0) competitorRegistry.set(routeKey, filtered);
        }
        for (const [routeKey, offers] of playerRouteRegistry) {
          const existing = competitorRegistry.get(routeKey) || [];
          competitorRegistry.set(routeKey, [...existing, ...offers]);
        }

        if (analyticalTarget > airlineLastTick) {
          const { fleet: reconciledFleet, balanceDelta } = reconcileFleetToTick(
            currentFleet,
            compRoutes,
            analyticalTarget,
          );
          currentFleet = reconciledFleet;
          currentBalance = fpAdd(currentBalance, balanceDelta);
          currentBalance = applyMonthlyCosts(
            currentBalance,
            airline.hubs,
            currentFleet,
            airlineLastTick,
            analyticalTarget,
          );
        }

        if (tickBudget > 0) {
          for (let t = startTick; t <= tick; t++) {
            const result = processFlightEngine(
              t,
              currentFleet,
              compRoutes,
              currentBalance,
              t - 1,
              competitorRegistry,
              competitorPubkey,
              airline.brandScore || 0.5,
            );
            currentFleet = result.updatedFleet;
            currentBalance = result.corporateBalance;

            if (
              GLOBAL_CATCHUP_CHUNK > 0 &&
              (t - startTick + 1) % GLOBAL_CATCHUP_CHUNK === 0 &&
              t < tick
            ) {
              useEngineStore.setState({
                catchupProgress: {
                  current: totalTicksProcessed + (t - startTick + 1),
                  target: MAX_TOTAL_COMPETITOR_TICKS,
                  phase: "competitor",
                },
              });
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }
        }

        totalTicksProcessed += Math.max(0, tickBudget);

        updatedGlobalFleet.push(...currentFleet);
        processedPubkeys.add(competitorPubkey);
        updatedCompetitors.set(competitorPubkey, {
          ...airline,
          corporateBalance: currentBalance,
          lastTick: tick,
        });
        anyChanges = true;
      }

      if (!anyChanges) {
        useEngineStore.setState({ catchupProgress: null });
        return;
      }

      const updatedPubkeys = processedPubkeys;
      const finalFleet = [
        ...updatedGlobalFleet,
        ...Array.from(globalFleetByOwner.entries())
          .filter(([pubkey]) => !updatedPubkeys.has(pubkey))
          .flatMap(([, aircraft]) => aircraft),
      ];

      set({
        globalFleet: finalFleet,
        globalFleetByOwner: buildFleetIndex(finalFleet),
        competitors: updatedCompetitors,
      });
      useEngineStore.setState({ catchupProgress: null });
    } finally {
      isProcessingGlobal = false;
    }
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
    if (isProcessingGlobal && !options?.force) return;
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
            const checkpointCreatedAtSeconds = Math.floor(checkpoint.createdAt / 1000);
            scopedEntries = entries.filter(
              (entry) => (entry.event.created_at ?? 0) > checkpointCreatedAtSeconds,
            );
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

        const initialTick = useEngineStore.getState().tick;
        const MAX_INITIAL_CATCHUP = 10000;

        if (initialTick > 0 && competitors.size > 0) {
          const playerRouteRegistry = new Map<string, FlightOffer[]>();
          const playerBrandScore = existingState.airline?.brandScore || 0.5;
          for (const route of existingState.routes) {
            if (route.status !== "active") continue;

            const frequency = Math.max(0, route.assignedAircraftIds.length * 7);
            if (frequency === 0) continue;

            let avgTravelTime = 0;
            if (route.assignedAircraftIds.length > 0) {
              const modelIds = route.assignedAircraftIds
                .map((id: string) => {
                  const ac = existingState.fleet.find((a: AircraftInstance) => a.id === id);
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
            const offers = playerRouteRegistry.get(key) || [];
            const offer: FlightOffer = {
              airlinePubkey: existingState.pubkey || "",
              fareEconomy: route.fareEconomy,
              fareBusiness: route.fareBusiness,
              fareFirst: route.fareFirst,
              frequencyPerWeek: frequency,
              travelTimeMinutes: Math.round(avgTravelTime) || 480,
              stops: 0,
              serviceScore: 0.7,
              brandScore: playerBrandScore,
            };
            offers.push(offer);
            playerRouteRegistry.set(key, offers);
          }

          const globalRegistryEntries = [...registry.entries()];
          const updatedGlobalFleet: AircraftInstance[] = [];
          const updatedCompetitors = new Map(competitors);
          const processedPubkeys = new Set<string>();

          let totalTicksProcessed = 0;
          useEngineStore.setState({
            catchupProgress: {
              current: 0,
              target: MAX_TOTAL_COMPETITOR_TICKS,
              phase: "competitor",
            },
          });
          const competitorList = [...competitors.entries()];
          competitorList.sort(([, aAirline], [, bAirline]) => {
            const aLast = aAirline.lastTick ?? initialTick - 1;
            const bLast = bAirline.lastTick ?? initialTick - 1;
            return initialTick - bLast - (initialTick - aLast);
          });

          const allFleetByOwner = buildFleetIndex(allGlobalFleet);
          const allRoutesByOwner = buildRoutesIndex(allGlobalRoutes);

          for (const [competitorPubkey, airline] of competitorList) {
            const airlineLastTick = airline.lastTick ?? initialTick - 1;
            const compFleet = allFleetByOwner.get(competitorPubkey) || [];
            const compRoutes = allRoutesByOwner.get(competitorPubkey) || [];

            if (compFleet.length === 0) continue;

            if (airlineLastTick >= initialTick) {
              updatedGlobalFleet.push(...compFleet);
              processedPubkeys.add(competitorPubkey);
              continue;
            }

            const remainingBudget = Math.max(0, MAX_TOTAL_COMPETITOR_TICKS - totalTicksProcessed);
            const backlog = initialTick - airlineLastTick;
            const tickBudget = Math.min(backlog, MAX_INITIAL_CATCHUP, remainingBudget);
            const analyticalTarget = initialTick - tickBudget;
            const competitorRegistry = new Map<string, FlightOffer[]>();
            for (const [routeKey, offers] of globalRegistryEntries) {
              const filtered = offers.filter((o) => o.airlinePubkey !== competitorPubkey);
              if (filtered.length > 0) competitorRegistry.set(routeKey, filtered);
            }
            for (const [routeKey, offers] of playerRouteRegistry) {
              const existing = competitorRegistry.get(routeKey) || [];
              competitorRegistry.set(routeKey, [...existing, ...offers]);
            }

            let currentFleet = [...compFleet];
            let currentBalance = airline.corporateBalance;
            const startTick = analyticalTarget + 1;

            if (analyticalTarget > airlineLastTick) {
              const { fleet: reconciledFleet, balanceDelta } = reconcileFleetToTick(
                currentFleet,
                compRoutes,
                analyticalTarget,
              );
              currentFleet = reconciledFleet;
              currentBalance = fpAdd(currentBalance, balanceDelta);
              currentBalance = applyMonthlyCosts(
                currentBalance,
                airline.hubs,
                currentFleet,
                airlineLastTick,
                analyticalTarget,
              );
            }

            if (tickBudget > 0) {
              for (let t = startTick; t <= initialTick; t++) {
                const result = processFlightEngine(
                  t,
                  currentFleet,
                  compRoutes,
                  currentBalance,
                  t - 1,
                  competitorRegistry,
                  competitorPubkey,
                  airline.brandScore || 0.5,
                );
                currentFleet = result.updatedFleet;
                currentBalance = result.corporateBalance;

                if (
                  GLOBAL_CATCHUP_CHUNK > 0 &&
                  (t - startTick + 1) % GLOBAL_CATCHUP_CHUNK === 0 &&
                  t < initialTick
                ) {
                  useEngineStore.setState({
                    catchupProgress: {
                      current: totalTicksProcessed + (t - startTick + 1),
                      target: MAX_TOTAL_COMPETITOR_TICKS,
                      phase: "competitor",
                    },
                  });
                  await new Promise((resolve) => setTimeout(resolve, 0));
                }
              }
            }

            totalTicksProcessed += Math.max(0, tickBudget);

            updatedGlobalFleet.push(...currentFleet);
            processedPubkeys.add(competitorPubkey);
            updatedCompetitors.set(competitorPubkey, {
              ...airline,
              corporateBalance: currentBalance,
              lastTick: initialTick,
            });
          }

          const updatedPubkeys = processedPubkeys;
          const finalFleet = [
            ...allGlobalFleet.filter((ac) => !updatedPubkeys.has(ac.ownerPubkey)),
            ...updatedGlobalFleet,
          ];

          set({
            competitors: updatedCompetitors,
            globalFleet: finalFleet,
            globalFleetByOwner: buildFleetIndex(finalFleet),
            globalRoutes: allGlobalRoutes,
            globalRoutesByOwner: buildRoutesIndex(allGlobalRoutes),
            globalRouteRegistry: registry,
          });
          useEngineStore.setState({ catchupProgress: null });

          await settleMarketplaceSales(get, set, finalFleet);
          return;
        }

        set({
          competitors,
          globalRouteRegistry: registry,
          globalFleet: allGlobalFleet,
          globalFleetByOwner: buildFleetIndex(allGlobalFleet),
          globalRoutes: allGlobalRoutes,
          globalRoutesByOwner: buildRoutesIndex(allGlobalRoutes),
        });
        useEngineStore.setState({ catchupProgress: null });

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
      // Targeted fetch: only this competitor's actions + checkpoint
      const [actions, checkpoints] = await Promise.all([
        loadActionLog({ authors: [competitorPubkey], limit: 500, maxPages: 5 }),
        loadCheckpoints([competitorPubkey]),
      ]);

      if (actions.length === 0 && checkpoints.size === 0) return;

      const checkpoint = checkpoints.get(competitorPubkey) ?? null;
      let scopedEntries = actions;
      if (checkpoint) {
        const checkpointCreatedAtSeconds = Math.floor(checkpoint.createdAt / 1000);
        scopedEntries = actions.filter(
          (entry) => (entry.event.created_at ?? 0) > checkpointCreatedAtSeconds,
        );
      }

      const replayed = await replayActionLog({
        pubkey: competitorPubkey,
        actions: scopedEntries.map((entry) => ({
          action: entry.action,
          eventId: entry.event.id,
          authorPubkey: entry.event.author.pubkey,
          createdAt: entry.event.created_at ?? null,
        })),
        checkpoint,
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

      // Merge into existing state — only replace this competitor's data
      const freshState = get();
      const updatedCompetitors = new Map(freshState.competitors);
      updatedCompetitors.set(competitorPubkey, airline);

      // Rebuild global fleet: remove old entries for this competitor, add new ones
      const updatedGlobalFleet = [
        ...freshState.globalFleet.filter((ac) => ac.ownerPubkey !== competitorPubkey),
        ...resolvedFleet,
      ];

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
        globalFleetByOwner: buildFleetIndex(updatedGlobalFleet),
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
