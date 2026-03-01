import type {
  AircraftInstance,
  AirlineEntity,
  Checkpoint,
  Route,
  TimelineEvent,
} from "@acars/core";
import { fp, fpAdd, fpSub, GENESIS_TIME, verifyCheckpoint } from "@acars/core";
import { getHubPricingForIata } from "@acars/data";
import {
  attachSigner,
  ensureConnected,
  getPubkey,
  loadActionLog,
  loadCheckpoint,
  publishAction,
  waitForNip07,
} from "@acars/nostr";
import type { StateCreator } from "zustand";
import { updateActionChainHashFromEvent } from "../actionChain";
import { replayActionLog } from "../actionReducer";
import { useEngineStore } from "../engine";
import { reconcileFleetToTick } from "../FlightEngine";
import { computeRejectedBuyEventIds } from "../marketplaceReplay";
import type { AirlineState } from "../types";

export interface IdentitySlice {
  pubkey: string | null;
  identityStatus: "checking" | "no-extension" | "guest" | "ready";
  isLoading: boolean;
  error: string | null;
  airline: AirlineEntity | null;
  fleet: AircraftInstance[];
  routes: Route[];
  timeline: TimelineEvent[];
  actionChainHash: string;
  actionSeq: number;
  latestCheckpoint: Checkpoint | null;
  initializeIdentity: () => Promise<void>;
  createAirline: (params: CreateAirlineParams) => Promise<void>;
}

const MAX_PLAYER_CATCHUP = 50000;

export type CreateAirlineParams = Pick<
  AirlineEntity,
  "name" | "icaoCode" | "callsign" | "hubs" | "livery"
>;

export const createIdentitySlice: StateCreator<AirlineState, [], [], IdentitySlice> = (
  set,
  get,
) => ({
  pubkey: null,
  identityStatus: "checking",
  isLoading: false,
  error: null,
  airline: null,
  fleet: [],
  routes: [],
  timeline: [],
  actionChainHash: "",
  actionSeq: 0,
  fleetDeletedDuringCatchup: [],
  latestCheckpoint: null,

  initializeIdentity: async () => {
    set({ isLoading: true, error: null, airline: null, pubkey: null });

    const extensionReady = await waitForNip07();
    if (!extensionReady) {
      set({ identityStatus: "guest", isLoading: false });
      return;
    }

    try {
      const pubkey = await getPubkey();

      if (!pubkey) {
        set({
          identityStatus: "guest",
          isLoading: false,
          error: "Extension did not return a pubkey",
        });
        return;
      }

      attachSigner();
      ensureConnected();

      // Allow force-replaying from scratch by adding ?forceReplay to the URL.
      // This ignores the saved checkpoint and rebuilds state entirely from the
      // action log — useful to recover from a corrupted checkpoint.
      const forceReplay =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).has("forceReplay");

      let checkpoint = forceReplay ? null : await loadCheckpoint(pubkey);
      if (forceReplay) {
        console.warn("[IdentitySlice] forceReplay: ignoring checkpoint, replaying all actions");
      }
      if (checkpoint) {
        // At load time we can only verify the state hash — the action chain hash cannot
        // be independently recomputed without replaying the full event log from genesis.
        // The actionChainHash comparison is therefore deferred to after replay (see below).
        const checkpointOk = await verifyCheckpoint({
          actionChainHash: checkpoint.actionChainHash,
          expectedActionChainHash: checkpoint.actionChainHash,
          expectedStateHash: checkpoint.stateHash,
          airline: checkpoint.airline,
          fleet: checkpoint.fleet,
          routes: checkpoint.routes,
          timeline: checkpoint.timeline,
        });
        if (!checkpointOk) {
          console.warn(
            "[IdentitySlice] Checkpoint state hash mismatch — falling back to full log replay",
          );
          checkpoint = null;
        }
      }
      const [actions, globalActions] = await Promise.all([
        loadActionLog({
          authors: [pubkey],
          limit: 500,
          maxPages: checkpoint ? 20 : 100,
        }),
        loadActionLog({
          limit: 500,
          maxPages: 20,
        }),
      ]);
      const rejectedEventIds = computeRejectedBuyEventIds(globalActions);

      let scopedActions = actions;
      if (checkpoint) {
        const checkpointTick = checkpoint.tick;
        const checkpointCreatedAtSeconds = Math.floor(checkpoint.createdAt / 1000);
        scopedActions = actions.filter((entry) => {
          const actionTick = (entry.action.payload as Record<string, unknown>)?.tick;
          return typeof actionTick === "number" && Number.isFinite(actionTick)
            ? actionTick > checkpointTick
            : (entry.event.created_at ?? 0) > checkpointCreatedAtSeconds;
        });
        // If no actions are newer than the checkpoint, the checkpoint
        // state is authoritative — do NOT fall back to replaying all
        // actions, as that overwrites live flight state (status, flight,
        // turnaroundEndTick, etc.) with initial "delivery" values.
      }
      const replayed = await replayActionLog({
        pubkey,
        actions: scopedActions.map((entry) => ({
          action: entry.action,
          eventId: entry.event.id,
          authorPubkey: entry.event.author.pubkey,
          createdAt: entry.event.created_at ?? null,
        })),
        checkpoint,
        rejectedEventIds,
      });

      // When the checkpoint was used and no newer actions existed, the replayed
      // actionChainHash must equal the checkpoint's — any mismatch means the
      // checkpoint data was tampered with or the reducer logic changed.
      if (checkpoint && scopedActions.length === 0) {
        if (replayed.actionChainHash !== checkpoint.actionChainHash) {
          console.warn(
            "[IdentitySlice] Post-replay action chain hash mismatch — checkpoint may be corrupted",
          );
        }
      }

      const existing = replayed.airline ? replayed : null;

      if (!existing) {
        set({
          pubkey,
          airline: null,
          fleet: [],
          routes: [],
          timeline: [],
          actionChainHash: "",
          actionSeq: 0,
          fleetDeletedDuringCatchup: [],
          latestCheckpoint: checkpoint,
          identityStatus: "ready",
          isLoading: false,
        });
        return;
      }

      const maxPossibleHours = (Date.now() - GENESIS_TIME) / 3600000 + 48;

      const cleanFleet =
        existing && existing.fleet
          ? existing.fleet.map((ac) => ({
              ...ac,
              flightHoursTotal: Math.min(ac.flightHoursTotal, maxPossibleHours),
              flightHoursSinceCheck: Math.min(ac.flightHoursSinceCheck, maxPossibleHours),
            }))
          : [];

      // Step 6: Bidirectional Route/Fleet Reconciliation
      // 6a. Ensure routes only list planes that actually exist
      const fleetIds = new Set(cleanFleet.map((ac) => ac.id));
      const rawRoutes = existing && existing.routes ? existing.routes : [];
      const activeHubs = new Set((existing?.airline?.hubs || []).filter(Boolean));
      const reconciledRoutes: Route[] = rawRoutes.map((route) => {
        const hasActiveOrigin = activeHubs.size > 0 ? activeHubs.has(route.originIata) : false;

        if (!hasActiveOrigin && route.status === "active") {
          return {
            ...route,
            status: "suspended",
            assignedAircraftIds: [],
          };
        }

        return {
          ...route,
          assignedAircraftIds: route.assignedAircraftIds.filter((id) => fleetIds.has(id)),
        };
      });

      // 6b. Ensure planes only point to routes that actually exist
      const routeIds = new Set(reconciledRoutes.map((r) => r.id));
      const suspendedRouteIds = new Set(
        reconciledRoutes.filter((route) => route.status === "suspended").map((route) => route.id),
      );
      let reconciledFleet = cleanFleet.map((ac) => ({
        ...ac,
        assignedRouteId:
          ac.assignedRouteId &&
          routeIds.has(ac.assignedRouteId) &&
          !suspendedRouteIds.has(ac.assignedRouteId)
            ? ac.assignedRouteId
            : null,
      }));

      const engineTick = useEngineStore.getState().tick;
      let loadedAirline = existing ? existing.airline : null;
      if (
        loadedAirline &&
        (loadedAirline.lastTick == null || loadedAirline.lastTick === 0) &&
        (reconciledFleet.length > 0 || reconciledRoutes.length > 0)
      ) {
        const fallbackLastTick = Math.max(0, engineTick - MAX_PLAYER_CATCHUP);
        console.warn(
          "[IdentitySlice] lastTick missing, clamping to recent history to avoid excessive catchup",
          {
            pubkey,
            engineTick,
            fallbackLastTick,
          },
        );
        loadedAirline = {
          ...loadedAirline,
          lastTick: fallbackLastTick,
        };
      }

      if (loadedAirline?.lastTick != null) {
        const oldestAllowedTick = Math.max(0, engineTick - MAX_PLAYER_CATCHUP);
        if (loadedAirline.lastTick < oldestAllowedTick) {
          console.warn("[IdentitySlice] lastTick stale, clamping to catchup window", {
            pubkey,
            engineTick,
            lastTick: loadedAirline.lastTick,
            oldestAllowedTick,
          });
          loadedAirline = {
            ...loadedAirline,
            lastTick: oldestAllowedTick,
          };
        }
      }

      // Step 7: Reconcile fleet flight-cycle positions to lastTick.
      // The checkpoint saves the fleet at a specific tick, but post-checkpoint
      // TICK_UPDATE actions may push airline.lastTick ahead.  Without this,
      // all in-flight aircraft would land simultaneously on the first tick of
      // catchup because their arrivalTick/turnaroundEndTick is behind lastTick.
      // reconcileFleetToTick fast-forwards each aircraft's deterministic
      // round-trip cycle so catchup resumes from the correct phase.
      if (loadedAirline?.lastTick != null && reconciledFleet.length > 0) {
        const { fleet: reconciled, balanceDelta } = reconcileFleetToTick(
          reconciledFleet,
          reconciledRoutes,
          loadedAirline.lastTick,
        );
        reconciledFleet = reconciled;
        loadedAirline = {
          ...loadedAirline,
          corporateBalance: fpAdd(loadedAirline.corporateBalance, balanceDelta),
        };
      }

      set({
        pubkey,
        airline: loadedAirline,
        fleet: reconciledFleet,
        routes: reconciledRoutes,
        timeline: loadedAirline?.timeline || [],
        actionChainHash: replayed.actionChainHash,
        actionSeq: actions.length,
        fleetDeletedDuringCatchup: [],
        latestCheckpoint: checkpoint,
        identityStatus: "ready",
        isLoading: false,
      });

      // Remove the forceReplay param from the URL so subsequent refreshes
      // don't keep replaying.  A fresh checkpoint will be published on the
      // next checkpoint interval, replacing the corrupted one.
      if (forceReplay && typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("forceReplay");
        window.history.replaceState({}, "", url.toString());
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to initialize identity.";
      set({
        error: message,
        identityStatus: "ready",
        isLoading: false,
      });
    }
  },

  createAirline: async (params: CreateAirlineParams) => {
    set({ isLoading: true, error: null });
    try {
      attachSigner();
      ensureConnected();

      const initialHub = params.hubs[0];
      if (!initialHub) throw new Error("Primary hub is required");
      const hubCost = fp(getHubPricingForIata(initialHub).openFee);
      const postHubBalance = fpSub(fp(100000000), hubCost);

      const currentTick = useEngineStore.getState().tick;
      const action = {
        schemaVersion: 2,
        action: "AIRLINE_CREATE" as const,
        payload: {
          name: params.name,
          icaoCode: params.icaoCode,
          callsign: params.callsign,
          hubs: params.hubs,
          livery: params.livery,
          corporateBalance: postHubBalance,
          tick: currentTick,
        },
      };
      const event = await publishAction(action);
      await updateActionChainHashFromEvent({ action, event, get, set });

      const pubkey = await getPubkey();
      if (!pubkey) throw new Error("No pubkey after extension ready");

      const airline: AirlineEntity = {
        id: `action:${pubkey}:${currentTick}`,
        foundedBy: pubkey,
        ceoPubkey: pubkey,
        name: params.name,
        icaoCode: params.icaoCode,
        callsign: params.callsign,
        hubs: params.hubs,
        livery: params.livery,
        status: "private",
        sharesOutstanding: 10000000,
        shareholders: { [pubkey]: 10000000 },
        brandScore: 0.5,
        tier: 1,
        corporateBalance: postHubBalance,
        stockPrice: fp(10),
        fleetIds: [],
        routeIds: [],
        lastTick: useEngineStore.getState().tick,
      };

      set({
        airline,
        isLoading: false,
        fleet: [],
        routes: [],
        timeline: [],
        fleetDeletedDuringCatchup: [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create airline.";
      set({ error: message, isLoading: false });
    }
  },
});
