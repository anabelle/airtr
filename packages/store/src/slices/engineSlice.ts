import {
  CHAPTER11_BALANCE_THRESHOLD_USD,
  estimateHistoricRevenue,
  evaluateTier,
  fp,
  fpAdd,
  fpScale,
  fpSub,
  GENESIS_TIME,
  getMaxRouteDistanceKm,
  TICK_DURATION,
  TICKS_PER_HOUR,
  TICKS_PER_MONTH,
} from "@acars/core";
import { getAircraftById, getHubPricingForIata } from "@acars/data";
import type { StateCreator } from "zustand";
import { publishActionWithChain } from "../actionChain";
import { useEngineStore } from "../engine";
import { processFlightEngine, reconcileFleetToTick } from "../FlightEngine";
import type { AirlineState } from "../types";
import { AsyncMutex } from "../utils/asyncMutex";

export interface EngineSlice {
  processTick: (tick: number) => Promise<void>;
}

const tickMutex = new AsyncMutex();
const TICK_UPDATE_TIMELINE_EVENTS = 200;
const TICK_UPDATE_HEARTBEAT_TICKS = 20;
let skippedTickLockCount = 0;
const TICK_LOCK_LOG_BURST = 3;
const TICK_LOCK_LOG_SAMPLE = 100;
const CHAPTER11_BALANCE_THRESHOLD = fp(CHAPTER11_BALANCE_THRESHOLD_USD);
const lastTickUpdatePublishByAirline = new Map<string, number>();

function shouldPublishTickUpdate(params: {
  airlineId: string;
  tick: number;
  hasMaterialChange: boolean;
}): boolean {
  const { airlineId, tick, hasMaterialChange } = params;
  const lastPublishedTick = lastTickUpdatePublishByAirline.get(airlineId);
  if (lastPublishedTick == null) return true;
  if (hasMaterialChange) return true;
  return tick - lastPublishedTick >= TICK_UPDATE_HEARTBEAT_TICKS;
}

function markTickUpdatePublished(airlineId: string, tick: number): void {
  lastTickUpdatePublishByAirline.set(airlineId, tick);
}

/** @internal — test/diagnostic helper */
export function _getTickLockSkippedCount(): number {
  return skippedTickLockCount;
}

/** @internal — test/diagnostic helper */
export function _resetTickLockDiagnostics(): void {
  skippedTickLockCount = 0;
  lastTickUpdatePublishByAirline.clear();
  tickMutex.reset();
}

/**
 * Engine slice handles tick processing, tier progression, and sync cadence.
 */
export const createEngineSlice: StateCreator<AirlineState, [], [], EngineSlice> = (set, get) => ({
  processTick: async (tick: number) => {
    if (!tickMutex.tryLock()) {
      skippedTickLockCount += 1;
      if (
        skippedTickLockCount <= TICK_LOCK_LOG_BURST ||
        skippedTickLockCount % TICK_LOCK_LOG_SAMPLE === 0
      ) {
        console.debug("[EngineSlice] Tick lock contention; skipping overlapping processTick", {
          tick,
          skippedTickLockCount,
        });
      }
      return;
    }

    try {
      const { fleet, airline, routes } = get();
      if (!airline || airline.status === "liquidated") return;

      // EMERGENCY BANKRUPTCY CHECK
      // If balance breaches chapter11 threshold, auto-pause operations
      if (
        airline.corporateBalance < CHAPTER11_BALANCE_THRESHOLD &&
        airline.status !== "chapter11"
      ) {
        // Ground all in-flight aircraft and clear active flight state.
        const groundedFleet = fleet.map((ac) => {
          if (ac.status === "enroute") {
            return {
              ...ac,
              status: "idle" as const,
              baseAirportIata: ac.flight?.originIata ?? ac.baseAirportIata,
              flight: null,
              turnaroundEndTick: undefined,
              arrivalTickProcessed: undefined,
            };
          }
          if (ac.status === "turnaround") {
            return {
              ...ac,
              status: "idle" as const,
              flight: null,
              turnaroundEndTick: undefined,
              arrivalTickProcessed: undefined,
            };
          }
          return ac;
        });

        const bankruptcyEvent: import("@acars/core").TimelineEvent = {
          id: `bankruptcy-${tick}`,
          tick,
          timestamp: GENESIS_TIME + tick * TICK_DURATION,
          type: "bankruptcy",
          description: `${airline.name} has filed for Chapter 11 bankruptcy. All operations suspended.`,
        };

        const updatedTimeline = [bankruptcyEvent, ...get().timeline];
        const updatedAirline = {
          ...airline,
          status: "chapter11" as const,
          lastTick: Math.max(airline.lastTick ?? 0, tick),
        };
        const previousState = {
          airline,
          fleet,
          routes,
          timeline: get().timeline,
        };
        set({
          airline: updatedAirline,
          fleet: groundedFleet,
          timeline: updatedTimeline,
        });
        publishActionWithChain({
          action: {
            schemaVersion: 2,
            action: "TICK_UPDATE",
            payload: {
              status: "chapter11",
              tick,
              corporateBalance: updatedAirline.corporateBalance,
              fleetIds: groundedFleet.map((ac) => ac.id),
              routeIds: routes.map((r) => r.id),
              timeline: get().timeline.slice(0, TICK_UPDATE_TIMELINE_EVENTS),
              // Airline identity for bootstrap when AIRLINE_CREATE is missing from relays
              airlineName: updatedAirline.name,
              icaoCode: updatedAirline.icaoCode,
              callsign: updatedAirline.callsign,
              hubs: updatedAirline.hubs,
              livery: updatedAirline.livery,
              brandScore: updatedAirline.brandScore,
              cumulativeRevenue: updatedAirline.cumulativeRevenue,
              tier: updatedAirline.tier,
            },
          },
          get,
          set,
        }).catch((e) => {
          const current = get();
          if (
            current.airline === updatedAirline &&
            current.fleet === groundedFleet &&
            current.timeline === updatedTimeline
          ) {
            set(previousState);
          }
          console.error("Bankruptcy sync failed", e);
        });
        return;
      }

      // Prevent processing flights for a bankrupt airline
      if (airline.status === "chapter11") return;

      // 1. Determine where we are vs where we need to be
      const lastTick = airline.lastTick ?? tick - 1;

      // If we are already caught up, skip.
      if (lastTick >= tick) return;
      // 2. Catch up simulation
      // Safety cap: Never simulate more than 50,000 ticks (~40 hours) in one frame
      // to avoid freezing the browser. If the jump is larger, we will catch up
      // incrementally in subsequent frames until synchronized.
      const MAX_CATCHUP = 50000;
      const CATCHUP_CHUNK = 2000;
      const targetTick = Math.min(tick, lastTick + MAX_CATCHUP);
      useEngineStore.setState({
        catchupProgress: {
          current: lastTick,
          target: targetTick,
          phase: "player",
        },
      });

      let currentFleet = [...fleet];
      let currentBalance = airline.corporateBalance;
      let currentBrandScore = airline.brandScore || 0.5;
      let currentCumulativeRevenue = airline.cumulativeRevenue ?? fp(0);
      const currentHubs = airline.hubs || [];
      let currentTimeline = [...get().timeline];
      const timelineEventIds = new Set(currentTimeline.map((event) => event.id));
      const initialAirlineStatus = airline.status;
      let evaluatedTier = airline.tier;
      const distanceLimitKm = getMaxRouteDistanceKm(airline.tier);
      const brandScorePerTick = 0.002 / TICKS_PER_HOUR;
      const brandPenaltyPerTick = 0.003 / TICKS_PER_HOUR;

      if (airline.cumulativeRevenue == null) {
        currentCumulativeRevenue = estimateHistoricRevenue(currentFleet, routes);
      }

      let consumedDeletedFleetIds = new Set<string>();

      const ticksPerMonth = TICKS_PER_MONTH;

      const hasActiveRoutes = routes.some((route) => route.status === "active");
      const hasAssignedRoutes = currentFleet.some((ac) => !!ac.assignedRouteId);
      const hasNonIdleAircraft = currentFleet.some((ac) => ac.status !== "idle");
      const canFastPath = !hasActiveRoutes && !hasAssignedRoutes && !hasNonIdleAircraft;

      if (canFastPath) {
        const cyclesPrevious = Math.floor(lastTick / ticksPerMonth);
        const cyclesCurrent = Math.floor(targetTick / ticksPerMonth);
        if (cyclesCurrent > cyclesPrevious) {
          const numCycles = cyclesCurrent - cyclesPrevious;
          let opexTotal = 0;
          for (const hubIata of currentHubs) {
            opexTotal += getHubPricingForIata(hubIata).monthlyOpex;
          }

          let leaseCost = fp(0);
          for (const ac of currentFleet) {
            if (ac.purchaseType !== "lease") continue;
            const model = getAircraftById(ac.modelId);
            if (model) {
              leaseCost = fpAdd(leaseCost, model.monthlyLease);
            }
          }

          if (leaseCost !== 0 || opexTotal > 0) {
            const totalLeaseCost = fpScale(leaseCost, numCycles);
            const totalOpexCost = fpScale(fp(opexTotal), numCycles);
            const totalCost = fpAdd(totalLeaseCost, totalOpexCost);
            currentBalance = fpSub(currentBalance, totalCost);

            const simulatedTimestamp = GENESIS_TIME + targetTick * TICK_DURATION;
            const newEvent = {
              id: `evt-idle-catchup-${targetTick}`,
              tick: targetTick,
              timestamp: simulatedTimestamp,
              type: "hub_change" as const,
              description: `Idle catchup applied ${numCycles} monthly cycle(s) of lease and hub OPEX.`,
              cost: totalCost,
            };
            currentTimeline = [newEvent, ...currentTimeline].slice(0, 1000);
          }
        }

        const refreshedAirline = get().airline;
        const updatedAirline = {
          ...(refreshedAirline ?? airline),
          corporateBalance: currentBalance,
          brandScore: currentBrandScore,
          cumulativeRevenue: currentCumulativeRevenue,
          tier: evaluatedTier,
          lastTick: targetTick,
          timeline: currentTimeline,
        };
        const tickUpdateTick = updatedAirline.lastTick ?? targetTick;
        set({
          fleet: currentFleet,
          airline: updatedAirline,
          timeline: currentTimeline,
          // Clear stale deletion tracking on fast-path too, so IDs don't
          // accumulate indefinitely when the slow-path is never reached.
          fleetDeletedDuringCatchup: [],
        });
        // Removed legacy checkpointing
        // Only status changes (e.g. chapter 11) are truly material.
        // Routine flight events (landings, takeoffs, turnarounds) are
        // deterministic — other clients recompute them — so they ride
        // the 60-second heartbeat cadence instead of publishing every tick.
        const hasMaterialTickUpdate = updatedAirline.status !== initialAirlineStatus;
        if (
          shouldPublishTickUpdate({
            airlineId: updatedAirline.id,
            tick: tickUpdateTick,
            hasMaterialChange: hasMaterialTickUpdate,
          })
        ) {
          markTickUpdatePublished(updatedAirline.id, tickUpdateTick);
          publishActionWithChain({
            action: {
              schemaVersion: 2,
              action: "TICK_UPDATE",
              payload: {
                tick: tickUpdateTick,
                corporateBalance: updatedAirline.corporateBalance,
                cumulativeRevenue: updatedAirline.cumulativeRevenue,
                fleetIds: currentFleet.map((ac) => ac.id),
                routeIds: routes.map((r) => r.id),
                timeline: currentTimeline.slice(0, TICK_UPDATE_TIMELINE_EVENTS),
                // Airline identity for bootstrap when AIRLINE_CREATE is missing from relays
                airlineName: updatedAirline.name,
                icaoCode: updatedAirline.icaoCode,
                callsign: updatedAirline.callsign,
                hubs: updatedAirline.hubs,
                livery: updatedAirline.livery,
                status: updatedAirline.status,
                tier: updatedAirline.tier,
                brandScore: currentBrandScore,
              },
            },
            get,
            set,
          }).catch((e) => console.error("Auto-sync tick failed", e));
        }
        useEngineStore.setState({ catchupProgress: null });
        return;
      }

      // Immediate visual reconciliation: project fleet to target tick using
      // deterministic cycle algebra so the map shows correct positions while
      // the tick-by-tick financial simulation catches up. Without this, the
      // fleet appears stuck at stale arrivalTick positions during catch-up.
      const shouldSeedSyntheticEvents = targetTick - lastTick > 1 && routes.length === 0;
      if (targetTick - lastTick > 1) {
        const { fleet: projectedFleet, events: reconciledEvents } = reconcileFleetToTick(
          fleet,
          routes,
          targetTick,
        );
        set({ fleet: projectedFleet });

        // Merge synthetic timeline events from reconciliation so the activity
        // log is immediately populated even before the tick-by-tick loop runs.
        if (shouldSeedSyntheticEvents && reconciledEvents.length > 0) {
          const newEvents = reconciledEvents.filter((e) => !timelineEventIds.has(e.id));
          if (newEvents.length > 0) {
            currentTimeline = [...newEvents, ...currentTimeline].slice(0, 1000);
            timelineEventIds.clear();
            for (const event of currentTimeline) timelineEventIds.add(event.id);
          }
        }
      }

      let processingError = false;
      let lastProcessedTick = lastTick;
      for (let t = lastTick + 1; t <= targetTick; t++) {
        let result: ReturnType<typeof processFlightEngine>;
        try {
          result = processFlightEngine(
            t,
            currentFleet,
            routes,
            currentBalance,
            t - 1,
            get().globalRouteRegistry,
            get().pubkey || "",
            currentBrandScore,
            distanceLimitKm,
          );
        } catch (error) {
          processingError = true;
          console.error("[EngineSlice] processFlightEngine failed", {
            tick: t,
            lastTick,
            targetTick,
            error,
          });
          break;
        }

        lastProcessedTick = t;
        currentFleet = result.updatedFleet;
        currentBalance = result.corporateBalance;
        currentCumulativeRevenue = fpAdd(currentCumulativeRevenue, result.tickRevenue);

        if (result.events && result.events.length > 0) {
          // Handle Price War Brand Damage
          const pwEvents = result.events.filter((e) => e.type === "price_war");
          if (pwEvents.length > 0) {
            currentBrandScore = Math.max(0.1, currentBrandScore - 0.005 * pwEvents.length);
          }

          let landingCount = 0;
          let landingLoadFactorTotal = 0;
          for (const event of result.events) {
            if (event.type !== "landing") continue;
            const loadFactor = event.details?.loadFactor;
            if (loadFactor == null) continue;
            landingCount += 1;
            landingLoadFactorTotal += loadFactor;
          }
          if (landingCount > 0) {
            const avgLoadFactor = landingLoadFactorTotal / landingCount;
            if (avgLoadFactor > 0.85) {
              currentBrandScore += brandScorePerTick;
            }
            if (avgLoadFactor < 0.5) {
              currentBrandScore -= brandPenaltyPerTick;
            }
          }

          // Deduplicate events by ID before merging into the timeline
          const newEvents = result.events.filter((e) => !timelineEventIds.has(e.id));

          if (newEvents.length > 0) {
            currentTimeline = [...newEvents, ...currentTimeline].slice(0, 1000);
            timelineEventIds.clear();
            for (const event of currentTimeline) timelineEventIds.add(event.id);
          }
        }

        currentBrandScore = Math.max(0, Math.min(1, currentBrandScore));

        // Monthly hub OPEX
        if (t % ticksPerMonth === 0 && currentHubs.length > 0) {
          let opexTotal = 0;
          for (const hubIata of currentHubs) {
            opexTotal += getHubPricingForIata(hubIata).monthlyOpex;
          }
          if (opexTotal > 0) {
            const opexCost = fp(opexTotal);
            currentBalance = fpSub(currentBalance, opexCost);
            const currentTick = t;
            const simulatedTimestamp = GENESIS_TIME + currentTick * TICK_DURATION;
            const newEvent = {
              id: `evt-hub-opex-${currentTick}`,
              tick: currentTick,
              timestamp: simulatedTimestamp,
              type: "hub_change" as const,
              description: `Monthly hub operations cost charged for ${currentHubs.length} hub(s).`,
              cost: opexCost,
            };
            currentTimeline = [newEvent, ...currentTimeline].slice(0, 1000);
            timelineEventIds.clear();
            for (const event of currentTimeline) timelineEventIds.add(event.id);
          }
        }

        if (CATCHUP_CHUNK > 0 && (t - lastTick) % CATCHUP_CHUNK === 0 && t < targetTick) {
          useEngineStore.setState({
            catchupProgress: {
              current: t,
              target: targetTick,
              phase: "player",
            },
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      const activeRouteCount = routes.filter((route) => route.status === "active").length;
      if (activeRouteCount > 20) {
        currentBrandScore = Math.min(1, currentBrandScore + 0.001);
      }

      currentBrandScore = Math.max(0, Math.min(1, currentBrandScore));

      evaluatedTier = evaluateTier(airline.tier, currentCumulativeRevenue, activeRouteCount);
      let tierUpgradeEvent: (typeof currentTimeline)[number] | null = null;
      if (evaluatedTier > airline.tier) {
        currentBrandScore = Math.min(1, currentBrandScore + 0.05);
        tierUpgradeEvent = {
          id: `evt-tier-up-${evaluatedTier}-${targetTick}`,
          tick: targetTick,
          timestamp: GENESIS_TIME + targetTick * TICK_DURATION,
          type: "tier_upgrade" as const,
          description: `Your airline has been promoted to Tier ${evaluatedTier}.`,
        };
      }

      if (tierUpgradeEvent && !timelineEventIds.has(tierUpgradeEvent.id)) {
        currentTimeline = [tierUpgradeEvent, ...currentTimeline].slice(0, 1000);
      }

      const latestFleet = get().fleet;
      const deletedFleetIds = new Set(get().fleetDeletedDuringCatchup);
      consumedDeletedFleetIds = deletedFleetIds;
      if (latestFleet.length > 0) {
        const mergedFleet = new Map(currentFleet.map((ac) => [ac.id, ac]));
        for (const ac of latestFleet) {
          if (!mergedFleet.has(ac.id)) mergedFleet.set(ac.id, ac);
        }
        // currentFleet may still include pre-catchup aircraft that were
        // optimistically sold while catchup was running. Remove those IDs.
        currentFleet = Array.from(mergedFleet.values()).filter((ac) => !deletedFleetIds.has(ac.id));
      } else if (deletedFleetIds.size > 0) {
        currentFleet = currentFleet.filter((ac) => !deletedFleetIds.has(ac.id));
      }

      const deliveryEvents: typeof currentTimeline = [];

      for (const ac of currentFleet) {
        if (ac.status !== "delivery") continue;
        if (ac.deliveryAtTick == null || ac.deliveryAtTick > targetTick) continue;
        ac.status = "idle";
        const deliveryTick = ac.deliveryAtTick;
        deliveryEvents.push({
          id: `evt-delivery-${ac.id}-${deliveryTick}`,
          tick: deliveryTick,
          timestamp: GENESIS_TIME + deliveryTick * TICK_DURATION,
          type: "delivery",
          aircraftId: ac.id,
          aircraftName: ac.name,
          description: `${ac.name} has been delivered and is ready for operations.`,
        });
      }

      if (deliveryEvents.length > 0) {
        const newEvents = deliveryEvents.filter((e) => !timelineEventIds.has(e.id));
        if (newEvents.length > 0) {
          currentTimeline = [...newEvents, ...currentTimeline].slice(0, 1000);
          timelineEventIds.clear();
          for (const event of currentTimeline) timelineEventIds.add(event.id);
        }
      }

      // 3. Update state - We move lastTick to targetTick (which might be less than global tick)
      const refreshedAirline = get().airline;
      const updatedAirline = {
        ...(refreshedAirline ?? airline),
        corporateBalance: currentBalance,
        brandScore: currentBrandScore,
        cumulativeRevenue: currentCumulativeRevenue,
        tier: evaluatedTier,
        lastTick: processingError ? lastProcessedTick : targetTick,
        timeline: currentTimeline,
      };
      set({
        fleet: currentFleet,
        airline: updatedAirline,
        timeline: currentTimeline,
        fleetDeletedDuringCatchup: get().fleetDeletedDuringCatchup.filter(
          (id) => !consumedDeletedFleetIds.has(id),
        ),
      });
      const tickUpdateTick = updatedAirline.lastTick ?? lastProcessedTick;
      // Removed legacy checkpoint publishing logic

      // 4. Sync to Nostr on status changes or heartbeat cadence.
      // Routine flight events are deterministic and do not need
      // immediate publish — they ride the 60-second heartbeat.
      const hasMaterialTickUpdate = updatedAirline.status !== initialAirlineStatus;
      if (
        shouldPublishTickUpdate({
          airlineId: updatedAirline.id,
          tick: tickUpdateTick,
          hasMaterialChange: hasMaterialTickUpdate,
        })
      ) {
        markTickUpdatePublished(updatedAirline.id, tickUpdateTick);
        // Re-read current state at publish time to avoid overwriting
        // concurrent changes (e.g. hub modifications during tick processing).
        // We merge the tick's computed values with the fresh airline identity.
        publishActionWithChain({
          action: {
            schemaVersion: 2,
            action: "TICK_UPDATE",
            payload: {
              tick: tickUpdateTick,
              corporateBalance: currentBalance,
              cumulativeRevenue: currentCumulativeRevenue,
              fleetIds: currentFleet.map((ac) => ac.id),
              routeIds: routes.map((r) => r.id),
              timeline: currentTimeline.slice(0, TICK_UPDATE_TIMELINE_EVENTS),
              // Airline identity for bootstrap when AIRLINE_CREATE is missing from relays
              airlineName: updatedAirline.name,
              icaoCode: updatedAirline.icaoCode,
              callsign: updatedAirline.callsign,
              hubs: updatedAirline.hubs,
              livery: updatedAirline.livery,
              status: updatedAirline.status,
              tier: updatedAirline.tier,
              brandScore: currentBrandScore,
            },
          },
          get,
          set,
        }).catch((e) => console.error("Auto-sync tick failed", e));
      }
      useEngineStore.setState({ catchupProgress: null });
    } finally {
      tickMutex.unlock();
      useEngineStore.setState({ catchupProgress: null });
    }
  },
});
