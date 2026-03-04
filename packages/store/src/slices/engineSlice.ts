import {
  CHAPTER11_BALANCE_THRESHOLD_USD,
  computeCheckpointStateHash,
  fp,
  fpAdd,
  fpScale,
  fpSub,
  fpToNumber,
  getCyclePhase,
  GENESIS_TIME,
  TICK_DURATION,
  TICKS_PER_HOUR,
  TICKS_PER_MONTH,
} from "@acars/core";
import { getAircraftById, getHubPricingForIata } from "@acars/data";
import { publishCheckpoint } from "@acars/nostr";
import type { StateCreator } from "zustand";
import { publishActionWithChain } from "../actionChain";
import { useEngineStore } from "../engine";
import {
  estimateLandingFinancials,
  processFlightEngine,
  reconcileFleetToTick,
} from "../FlightEngine";
import type { AirlineState } from "../types";
import { AsyncMutex } from "../utils/asyncMutex";

export interface EngineSlice {
  processTick: (tick: number) => Promise<void>;
}

const tickMutex = new AsyncMutex();
const CHECKPOINT_INTERVAL = 1200;
const CHECKPOINT_TIMELINE_EVENTS = 1000;
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
        set({ airline: updatedAirline, fleet: groundedFleet, timeline: updatedTimeline });
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
      const currentHubs = airline.hubs || [];
      let currentTimeline = [...get().timeline];
      const timelineEventIds = new Set(currentTimeline.map((event) => event.id));
      const initialAirlineStatus = airline.status;

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
        const previousCheckpointTick = Math.floor(lastTick / CHECKPOINT_INTERVAL);
        const nextCheckpointTick = Math.floor(tickUpdateTick / CHECKPOINT_INTERVAL);
        if (nextCheckpointTick > previousCheckpointTick) {
          void (async () => {
            const checkpointState = get();
            const checkpointAirline = checkpointState.airline;
            if (!checkpointAirline) return;
            const stateHash = await computeCheckpointStateHash({
              airline: checkpointAirline,
              fleet: checkpointState.fleet,
              routes: checkpointState.routes,
              timeline: checkpointState.timeline,
            });
            const { timeline: _omitTimeline, ...airlineWithoutTimeline } = checkpointAirline;
            void _omitTimeline;
            const checkpoint = {
              schemaVersion: 1,
              tick: checkpointAirline.lastTick ?? tickUpdateTick,
              createdAt: Date.now(),
              actionChainHash: checkpointState.actionChainHash,
              stateHash,
              airline: airlineWithoutTimeline,
              fleet: checkpointState.fleet,
              routes: checkpointState.routes,
              timeline: checkpointState.timeline.slice(0, CHECKPOINT_TIMELINE_EVENTS),
            };
            await publishCheckpoint(checkpoint);
            set({ latestCheckpoint: checkpoint });
          })().catch((e) => console.error("Checkpoint publish failed", e));
        }
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
      if (targetTick - lastTick > 1) {
        const { fleet: projectedFleet } = reconcileFleetToTick(fleet, routes, targetTick);
        set({ fleet: projectedFleet });
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

        if (result.events && result.events.length > 0) {
          // Handle Price War Brand Damage
          const pwEvents = result.events.filter((e) => e.type === "price_war");
          if (pwEvents.length > 0) {
            currentBrandScore = Math.max(0.1, currentBrandScore - 0.005 * pwEvents.length);
          }

          // Deduplicate events by ID before merging into the timeline
          const newEvents = result.events.filter((e) => !timelineEventIds.has(e.id));

          if (newEvents.length > 0) {
            currentTimeline = [...newEvents, ...currentTimeline].slice(0, 1000);
            timelineEventIds.clear();
            for (const event of currentTimeline) timelineEventIds.add(event.id);
          }
        }

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

      const simulatedTimestamp = GENESIS_TIME + targetTick * TICK_DURATION;
      const deliveryEvents: typeof currentTimeline = [];
      const recoveryEvents: typeof currentTimeline = [];

      // Deterministic timeline backfill: reconstruct landing events for all
      // completed round-trips using cycle algebra.  This runs for EVERY
      // aircraft with an assigned route regardless of its current status,
      // because reconcileFleetToTick (run earlier during identity load) may
      // have already changed idle→enroute/turnaround.
      //
      // These events are DISPLAY-ONLY — the balance was already adjusted by
      // reconcileFleetToTick and will be further adjusted by the tick loop.
      // Event IDs use the same format as processFlightEngine so duplicates
      // produced later by the tick loop are automatically filtered out.
      const MAX_BACKFILL_PER_AIRCRAFT = 40;
      const routeById = new Map(routes.map((route) => [route.id, route]));
      for (const ac of currentFleet) {
        if (!ac.assignedRouteId) continue;
        const route = routeById.get(ac.assignedRouteId);
        const model = getAircraftById(ac.modelId);
        if (!route || route.status !== "active" || !model) continue;
        if (route.distanceKm > (model.rangeKm || 0)) continue;
        const cycleAnchor = ac.routeAssignedAtTick ?? ac.purchasedAtTick;
        if (cycleAnchor == null || cycleAnchor >= targetTick) continue;

        const hours = route.distanceKm / (model.speedKmh || 800);
        const durationTicks = Math.max(1, Math.ceil(hours * TICKS_PER_HOUR));
        const turnaroundTicks = Math.max(
          1,
          Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR),
        );
        const roundTripTicks = durationTicks * 2 + turnaroundTicks * 2;
        const flightHoursPerLeg = Math.min(24, durationTicks / TICKS_PER_HOUR);

        // Two landing offsets per cycle: outbound at durationTicks,
        // inbound at 2*durationTicks + turnaroundTicks
        const legInfos = [
          {
            offset: durationTicks,
            originIata: route.originIata,
            destinationIata: route.destinationIata,
          },
          {
            offset: durationTicks * 2 + turnaroundTicks,
            originIata: route.destinationIata,
            destinationIata: route.originIata,
          },
        ];

        const historicalLandings: Array<{
          tick: number;
          originIata: string;
          destinationIata: string;
        }> = [];

        for (const leg of legInfos) {
          const firstLandingTick = cycleAnchor + leg.offset;
          if (firstLandingTick > targetTick) continue;

          // Walk backwards from the most recent landing to collect up to
          // MAX_BACKFILL_PER_AIRCRAFT events per aircraft.
          const totalCompleted = Math.floor((targetTick - firstLandingTick) / roundTripTicks) + 1;
          const startIdx = Math.max(0, totalCompleted - MAX_BACKFILL_PER_AIRCRAFT);
          for (let idx = totalCompleted - 1; idx >= startIdx; idx--) {
            const landingTick = firstLandingTick + idx * roundTripTicks;
            if (landingTick > targetTick) continue;
            historicalLandings.push({
              tick: landingTick,
              originIata: leg.originIata,
              destinationIata: leg.destinationIata,
            });
          }
        }

        // Process oldest → newest so load-factor state evolves forward in time.
        historicalLandings.sort((a, b) => a.tick - b.tick);
        const capped = historicalLandings.slice(-MAX_BACKFILL_PER_AIRCRAFT);

        for (const landing of capped) {
          // Use the same ID format as processFlightEngine so the tick loop's
          // duplicate events are automatically deduplicated.
          const eventId = `evt-landing-${ac.id}-${landing.tick}`;
          if (timelineEventIds.has(eventId)) continue;

          const landingResult = estimateLandingFinancials(
            ac,
            route,
            model,
            flightHoursPerLeg,
            ac.lastKnownLoadFactor ?? 0.65,
          );

          ac.lastKnownLoadFactor = landingResult.revenue.loadFactor;

          recoveryEvents.push({
            id: eventId,
            tick: landing.tick,
            timestamp: GENESIS_TIME + landing.tick * TICK_DURATION,
            type: "landing",
            aircraftId: ac.id,
            aircraftName: ac.name,
            routeId: route.id,
            originIata: landing.originIata,
            destinationIata: landing.destinationIata,
            revenue: landingResult.revenue.revenueTotal,
            cost: landingResult.cost.costTotal,
            profit: landingResult.profit,
            description: `${ac.name} landed at ${landing.destinationIata}. Net Profit: ${fpToNumber(landingResult.profit) > 0 ? "+" : ""}${fpToNumber(landingResult.profit)}`,
            details: landingResult.details,
          });
        }
      }

      // Merge backfill events into timeline AFTER the tick loop catch-up work;
      // processFlightEngine duplicate landing events are deduplicated by ID.
      if (recoveryEvents.length > 0) {
        const newEvents = recoveryEvents.filter((e) => !timelineEventIds.has(e.id));
        if (newEvents.length > 0) {
          currentTimeline = [...newEvents, ...currentTimeline]
            .sort((a, b) => b.tick - a.tick)
            .slice(0, 1000);
          timelineEventIds.clear();
          for (const event of currentTimeline) timelineEventIds.add(event.id);
        }
        recoveryEvents.length = 0;
      }

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

      for (const ac of currentFleet) {
        if (ac.status === "idle" && ac.assignedRouteId) {
          const route = routeById.get(ac.assignedRouteId);
          const model = getAircraftById(ac.modelId);
          if (!route || route.status !== "active" || !model) continue;
          const isGrounded = ac.condition < 0.2 || ac.flightHoursSinceCheck > 600;
          if (isGrounded) continue;
          if (route.distanceKm > (model.rangeKm || 0)) continue;

          const hours = route.distanceKm / (model.speedKmh || 800);
          const durationTicks = Math.max(1, Math.ceil(hours * TICKS_PER_HOUR));
          const turnaroundTicks = Math.max(
            1,
            Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR),
          );
          const roundTripTicks = durationTicks * 2 + turnaroundTicks * 2;

          // Use deterministic cycle algebra to place the aircraft at the correct
          // round-trip position rather than forcing every idle aircraft to depart
          // at the same targetTick (which causes the synchronized-departure bug).
          const cycleAnchor = ac.routeAssignedAtTick ?? ac.purchasedAtTick;
          if (cycleAnchor != null && cycleAnchor > targetTick) {
            // Assignment is in the future relative to this recovery tick — skip.
            continue;
          }
          if (cycleAnchor != null && cycleAnchor < targetTick) {
            const elapsed = targetTick - cycleAnchor;
            // If the aircraft was at the destination when assigned, offset by
            // half a round-trip so the cycle starts with an inbound leg.
            const assignedAtAirportIata = ac.routeAssignedAtIata ?? ac.baseAirportIata;
            const assignedAtDest =
              assignedAtAirportIata != null && assignedAtAirportIata === route.destinationIata;
            const sweepPhaseOffset = assignedAtDest ? durationTicks + turnaroundTicks : 0;
            const rawSweepPos = elapsed % roundTripTicks;
            const positionInCycle = (rawSweepPos + sweepPhaseOffset) % roundTripTicks;
            const cycleStartTick = targetTick - positionInCycle;
            const phase = getCyclePhase(
              cycleStartTick,
              targetTick,
              durationTicks,
              turnaroundTicks,
              route,
            );
            ac.status = phase.status;
            ac.flight = {
              originIata: phase.originIata,
              destinationIata: phase.destinationIata,
              departureTick: phase.departureTick,
              arrivalTick: phase.arrivalTick,
              direction: phase.direction,
            };
            ac.turnaroundEndTick = phase.turnaroundEndTick ?? undefined;
            ac.arrivalTickProcessed = phase.status === "turnaround" ? phase.arrivalTick : undefined;
            ac.baseAirportIata = phase.baseAirportIata;
          } else {
            // No cycle anchor yet (brand-new assignment): depart from current
            // position using the legacy isAtOrigin safety check.
            const isAtOrigin = ac.baseAirportIata === route.originIata;
            const isAtDestination = ac.baseAirportIata === route.destinationIata;
            if (!isAtOrigin && !isAtDestination) continue;
            const originIata = isAtOrigin ? route.originIata : route.destinationIata;
            const destinationIata = isAtOrigin ? route.destinationIata : route.originIata;
            ac.status = "enroute";
            ac.flight = {
              originIata,
              destinationIata,
              departureTick: targetTick,
              arrivalTick: targetTick + durationTicks,
              direction: isAtOrigin ? "outbound" : "inbound",
            };
            ac.arrivalTickProcessed = undefined;
            ac.turnaroundEndTick = undefined;
          }
          if (ac.status === "enroute" && ac.flight) {
            recoveryEvents.push({
              id: `evt-recovery-takeoff-${ac.id}-${ac.flight.departureTick}`,
              tick: ac.flight.departureTick,
              timestamp: GENESIS_TIME + ac.flight.departureTick * TICK_DURATION,
              type: "takeoff",
              aircraftId: ac.id,
              aircraftName: ac.name,
              routeId: route.id,
              originIata: ac.flight.originIata,
              destinationIata: ac.flight.destinationIata,
              description: `${ac.name} recovery takeoff: ${ac.flight.originIata} → ${ac.flight.destinationIata}`,
            });
          }
        }

        if (ac.status === "enroute" && ac.flight && ac.flight.arrivalTick <= targetTick) {
          const model = getAircraftById(ac.modelId);
          if (!model) continue;
          const turnaroundTicks = Math.max(
            1,
            Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR),
          );
          const durationTicks = ac.flight.arrivalTick - ac.flight.departureTick;
          const flightHoursData = Math.min(24, durationTicks / TICKS_PER_HOUR);
          if (flightHoursData > 0) {
            ac.flightHoursTotal += flightHoursData;
            ac.flightHoursSinceCheck += flightHoursData;
            ac.condition = Math.max(0, ac.condition - 0.00005 * flightHoursData);
          }

          // Look up the route to calculate full financial breakdown
          const isFerry = ac.flight?.purpose === "ferry";
          const route = !isFerry && ac.assignedRouteId ? routeById.get(ac.assignedRouteId) : null;

          // Calculate financials BEFORE mutating aircraft state so ac.flight is intact
          let landingResult: ReturnType<typeof estimateLandingFinancials> | null = null;
          if (route && !isFerry) {
            landingResult = estimateLandingFinancials(
              ac,
              route,
              model,
              flightHoursData,
              ac.lastKnownLoadFactor ?? 0.65,
            );
          }

          ac.status = "turnaround";
          ac.baseAirportIata = ac.flight.destinationIata;
          ac.arrivalTickProcessed = ac.flight.arrivalTick;
          ac.turnaroundEndTick = ac.flight.arrivalTick + turnaroundTicks;

          if (landingResult) {
            // Full financial breakdown using recovery helper
            currentBalance = fpAdd(currentBalance, landingResult.profit);
            ac.lastKnownLoadFactor = landingResult.revenue.loadFactor;

            // Skip the timeline event if the backfill already generated one
            // for this exact landing (same aircraft + arrival tick).
            const backfillId = `evt-landing-${ac.id}-${ac.flight.arrivalTick}`;
            if (!timelineEventIds.has(backfillId)) {
              const arrivalTick = ac.flight.arrivalTick;
              recoveryEvents.push({
                id: `evt-recovery-landing-${ac.id}-${arrivalTick}`,
                tick: arrivalTick,
                timestamp: GENESIS_TIME + arrivalTick * TICK_DURATION,
                type: "landing",
                aircraftId: ac.id,
                aircraftName: ac.name,
                routeId: route!.id,
                originIata: ac.flight.originIata,
                destinationIata: ac.flight.destinationIata,
                revenue: landingResult.revenue.revenueTotal,
                cost: landingResult.cost.costTotal,
                profit: landingResult.profit,
                description: `${ac.name} landed at ${ac.flight.destinationIata}. Net Profit: ${fpToNumber(landingResult.profit) > 0 ? "+" : ""}${fpToNumber(landingResult.profit)}`,
                details: landingResult.details,
              });
            }
          } else {
            // Ferry or no route — bare event (no financials to calculate)
            const arrivalTick = ac.flight.arrivalTick;
            recoveryEvents.push({
              id: `evt-recovery-landing-${ac.id}-${arrivalTick}`,
              tick: arrivalTick,
              timestamp: GENESIS_TIME + arrivalTick * TICK_DURATION,
              type: isFerry ? "ferry" : "landing",
              aircraftId: ac.id,
              aircraftName: ac.name,
              originIata: ac.flight.originIata,
              destinationIata: ac.flight.destinationIata,
              description: `${ac.name} ${isFerry ? "ferried" : "recovery landing"} at ${ac.flight.destinationIata}.`,
            });
          }
        }

        if (ac.status === "turnaround" && (ac.turnaroundEndTick || 0) <= targetTick) {
          const route = ac.assignedRouteId ? routeById.get(ac.assignedRouteId) : undefined;
          const model = getAircraftById(ac.modelId);
          if (route && ac.flight && model) {
            const hours = route.distanceKm / (model.speedKmh || 800);
            const durationTicks = Math.ceil(hours * TICKS_PER_HOUR);
            const isReturning = ac.flight.direction === "outbound";
            // Use the actual turnaround-end tick as the departure time so that
            // aircraft with different turnaround schedules do not all depart at
            // the same targetTick (which causes the synchronized-departure bug).
            const actualDeparture = ac.turnaroundEndTick ?? targetTick;

            ac.status = "enroute";
            ac.arrivalTickProcessed = undefined;
            ac.flight = {
              originIata: isReturning ? route.destinationIata : route.originIata,
              destinationIata: isReturning ? route.originIata : route.destinationIata,
              departureTick: actualDeparture,
              arrivalTick: actualDeparture + Math.max(1, durationTicks),
              direction: isReturning ? "inbound" : "outbound",
            };
            recoveryEvents.push({
              id: `evt-recovery-takeoff-rtn-${ac.id}-${actualDeparture}`,
              tick: actualDeparture,
              timestamp: GENESIS_TIME + actualDeparture * TICK_DURATION,
              type: "takeoff",
              aircraftId: ac.id,
              aircraftName: ac.name,
              routeId: route.id,
              originIata: ac.flight.originIata,
              destinationIata: ac.flight.destinationIata,
              description: `${ac.name} recovery return: ${ac.flight.originIata} → ${ac.flight.destinationIata}`,
            });
          } else {
            ac.status = "idle";
            ac.flight = null;
            recoveryEvents.push({
              id: `evt-recovery-idle-${ac.id}-${targetTick}`,
              tick: targetTick,
              timestamp: simulatedTimestamp,
              type: "maintenance",
              aircraftId: ac.id,
              aircraftName: ac.name,
              description: `${ac.name} recovery transition to idle (route missing).`,
            });
          }
        }
      }

      if (recoveryEvents.length > 0) {
        const newEvents = recoveryEvents.filter((e) => !timelineEventIds.has(e.id));
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
      const previousCheckpointTick = Math.floor(lastTick / CHECKPOINT_INTERVAL);
      const nextCheckpointTick = Math.floor(tickUpdateTick / CHECKPOINT_INTERVAL);
      if (nextCheckpointTick > previousCheckpointTick) {
        void (async () => {
          const checkpointState = get();
          const checkpointAirline = checkpointState.airline;
          if (!checkpointAirline) return;
          const stateHash = await computeCheckpointStateHash({
            airline: checkpointAirline,
            fleet: checkpointState.fleet,
            routes: checkpointState.routes,
            timeline: checkpointState.timeline,
          });
          const { timeline: _omitTimeline, ...airlineWithoutTimeline } = checkpointAirline;
          void _omitTimeline;
          const checkpoint = {
            schemaVersion: 1,
            tick: checkpointAirline.lastTick ?? tickUpdateTick,
            createdAt: Date.now(),
            actionChainHash: checkpointState.actionChainHash,
            stateHash,
            airline: airlineWithoutTimeline,
            fleet: checkpointState.fleet,
            routes: checkpointState.routes,
            timeline: checkpointState.timeline.slice(0, CHECKPOINT_TIMELINE_EVENTS),
          };
          await publishCheckpoint(checkpoint);
          set({ latestCheckpoint: checkpoint });
        })().catch((e) => console.error("Checkpoint publish failed", e));
      }

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
