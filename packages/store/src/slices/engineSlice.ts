import {
  computeCheckpointStateHash,
  fp,
  fpAdd,
  fpScale,
  fpSub,
  fpToNumber,
  GENESIS_TIME,
  TICK_DURATION,
  TICKS_PER_HOUR,
} from "@airtr/core";
import { getAircraftById, getHubPricingForIata } from "@airtr/data";
import { publishCheckpoint } from "@airtr/nostr";
import type { StateCreator } from "zustand";
import { publishActionWithChain } from "../actionChain";
import { useEngineStore } from "../engine";
import { processFlightEngine } from "../FlightEngine";
import type { AirlineState } from "../types";

export interface EngineSlice {
  processTick: (tick: number) => Promise<void>;
}

let isProcessing = false;
const CHECKPOINT_INTERVAL = 1200;

export const createEngineSlice: StateCreator<AirlineState, [], [], EngineSlice> = (set, get) => ({
  processTick: async (tick: number) => {
    if (isProcessing) return;

    const { fleet, airline, routes } = get();
    if (!airline || airline.status === "liquidated") return;

    // EMERGENCY BANKRUPTCY CHECK
    // If balance is severely negative (e.g. -$10M), auto-pause operations
    if (fpToNumber(airline.corporateBalance) < -10000000 && airline.status !== "chapter11") {
      const updatedAirline = { ...airline, status: "chapter11" as const };
      const previousState = { airline, fleet, routes, timeline: get().timeline };
      set({ airline: updatedAirline });
      publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: "TICK_UPDATE",
          payload: {
            status: "chapter11",
            tick,
          },
        },
        get,
        set,
      }).catch((e) => {
        set(previousState);
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

    isProcessing = true;
    try {
      // 2. Catch up simulation
      // Safety cap: Never simulate more than 50,000 ticks (~40 hours) in one frame
      // to avoid freezing the browser. If the jump is larger, we will catch up
      // incrementally in subsequent frames until synchronized.
      const MAX_CATCHUP = 50000;
      const CATCHUP_CHUNK = 2000;
      const targetTick = Math.min(tick, lastTick + MAX_CATCHUP);
      useEngineStore.setState({
        catchupProgress: { current: lastTick, target: targetTick, phase: "player" },
      });

      let currentFleet = [...fleet];
      let currentBalance = airline.corporateBalance;
      let currentBrandScore = airline.brandScore || 0.5;
      const currentHubs = airline.hubs || [];
      let currentTimeline = [...get().timeline];
      const timelineEventIds = new Set(currentTimeline.map((event) => event.id));
      let anyChanges = false;

      const ticksPerDay = 24 * TICKS_PER_HOUR;
      const ticksPerMonth = ticksPerDay * 30;

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
            anyChanges = true;
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
        set({ fleet: currentFleet, airline: updatedAirline, timeline: currentTimeline });
        const previousCheckpointTick = Math.floor(lastTick / CHECKPOINT_INTERVAL);
        const nextCheckpointTick = Math.floor(targetTick / CHECKPOINT_INTERVAL);
        if (nextCheckpointTick > previousCheckpointTick) {
          const { actionChainHash } = get();
          computeCheckpointStateHash({
            airline: updatedAirline,
            fleet: currentFleet,
            routes,
            timeline: currentTimeline,
          })
            .then(async (stateHash) => {
              const checkpoint = {
                schemaVersion: 1,
                tick: targetTick,
                createdAt: Date.now(),
                actionChainHash,
                stateHash,
                airline: updatedAirline,
                fleet: currentFleet,
                routes,
                timeline: currentTimeline.slice(0, 200),
              };
              await publishCheckpoint(checkpoint);
              set({ latestCheckpoint: checkpoint });
            })
            .catch((e) => console.error("Checkpoint publish failed", e));
        }
        if (anyChanges) {
          publishActionWithChain({
            action: {
              schemaVersion: 2,
              action: "TICK_UPDATE",
              payload: {
                tick: targetTick,
              },
            },
            get,
            set,
          }).catch((e) => console.error("Auto-sync tick failed", e));
        }
        useEngineStore.setState({ catchupProgress: null });
        return;
      }

      for (let t = lastTick + 1; t <= targetTick; t++) {
        const result = processFlightEngine(
          t,
          currentFleet,
          routes,
          currentBalance,
          t - 1,
          get().globalRouteRegistry,
          get().pubkey || "",
          currentBrandScore,
        );
        currentFleet = result.updatedFleet;
        currentBalance = result.corporateBalance;

        if (result.events && result.events.length > 0) {
          // Handle Price War Brand Damage
          const pwEvents = result.events.filter((e) => e.type === "price_war");
          if (pwEvents.length > 0) {
            currentBrandScore = Math.max(0.1, currentBrandScore - 0.005 * pwEvents.length);
            anyChanges = true;
          }

          // Deduplicate events by ID before merging into the timeline
          const newEvents = result.events.filter((e) => !timelineEventIds.has(e.id));

          if (newEvents.length > 0) {
            currentTimeline = [...newEvents, ...currentTimeline].slice(0, 1000);
            timelineEventIds.clear();
            for (const event of currentTimeline) timelineEventIds.add(event.id);
          }
        }

        if (result.hasChanges) anyChanges = true;

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
            anyChanges = true;
          }
        }

        if (CATCHUP_CHUNK > 0 && (t - lastTick) % CATCHUP_CHUNK === 0 && t < targetTick) {
          useEngineStore.setState({
            catchupProgress: { current: t, target: targetTick, phase: "player" },
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      // 3. Update state - We move lastTick to targetTick (which might be less than global tick)
      const refreshedAirline = get().airline;
      const updatedAirline = {
        ...(refreshedAirline ?? airline),
        corporateBalance: currentBalance,
        brandScore: currentBrandScore,
        lastTick: targetTick,
        timeline: currentTimeline,
      };
      set({ fleet: currentFleet, airline: updatedAirline, timeline: currentTimeline });
      const previousCheckpointTick = Math.floor(lastTick / CHECKPOINT_INTERVAL);
      const nextCheckpointTick = Math.floor(targetTick / CHECKPOINT_INTERVAL);
      if (nextCheckpointTick > previousCheckpointTick) {
        const { actionChainHash } = get();
        computeCheckpointStateHash({
          airline: updatedAirline,
          fleet: currentFleet,
          routes,
          timeline: currentTimeline,
        })
          .then(async (stateHash) => {
            const checkpoint = {
              schemaVersion: 1,
              tick: targetTick,
              createdAt: Date.now(),
              actionChainHash,
              stateHash,
              airline: updatedAirline,
              fleet: currentFleet,
              routes,
              timeline: currentTimeline.slice(0, 200),
            };
            await publishCheckpoint(checkpoint);
            set({ latestCheckpoint: checkpoint });
          })
          .catch((e) => console.error("Checkpoint publish failed", e));
      }

      // 4. Sync to Nostr only if significant events happened
      if (anyChanges) {
        // Re-read current state at publish time to avoid overwriting
        // concurrent changes (e.g. hub modifications during tick processing).
        // We merge the tick's computed values with the fresh airline identity.
        publishActionWithChain({
          action: {
            schemaVersion: 2,
            action: "TICK_UPDATE",
            payload: {
              tick: targetTick,
            },
          },
          get,
          set,
        }).catch((e) => console.error("Auto-sync tick failed", e));
      }
      useEngineStore.setState({ catchupProgress: null });
    } finally {
      isProcessing = false;
      useEngineStore.setState({ catchupProgress: null });
    }
  },
});
