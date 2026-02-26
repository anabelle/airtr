import type {
  AircraftInstance,
  AirlineEntity,
  Checkpoint,
  Route,
  TimelineEvent,
} from "@airtr/core";
import { fp, fpSub, GENESIS_TIME } from "@airtr/core";
import { getHubPricingForIata } from "@airtr/data";
import {
  attachSigner,
  ensureConnected,
  getPubkey,
  loadActionLog,
  loadCheckpoint,
  publishAction,
  waitForNip07,
} from "@airtr/nostr";
import type { StateCreator } from "zustand";
import { updateActionChainHashFromEvent } from "../actionChain";
import { replayActionLog } from "../actionReducer";
import { useEngineStore } from "../engine";
import type { AirlineState } from "../types";

export interface IdentitySlice {
  pubkey: string | null;
  identityStatus: "checking" | "no-extension" | "ready";
  isLoading: boolean;
  error: string | null;
  airline: AirlineEntity | null;
  fleet: AircraftInstance[];
  routes: Route[];
  timeline: TimelineEvent[];
  actionChainHash: string;
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
  latestCheckpoint: null,

  initializeIdentity: async () => {
    set({ isLoading: true, error: null, airline: null, pubkey: null });

    const extensionReady = await waitForNip07();
    if (!extensionReady) {
      set({ identityStatus: "no-extension", isLoading: false });
      return;
    }

    try {
      const pubkey = await getPubkey();

      if (!pubkey) {
        set({
          identityStatus: "no-extension",
          isLoading: false,
          error: "Extension did not return a pubkey",
        });
        return;
      }

      attachSigner();
      ensureConnected();

      const checkpoint = await loadCheckpoint(pubkey);
      const actions = await loadActionLog({
        authors: [pubkey],
        limit: 500,
        maxPages: 20,
      });
      let scopedActions = actions;
      if (checkpoint) {
        const checkpointCreatedAtSeconds = Math.floor(checkpoint.createdAt / 1000);
        scopedActions = actions.filter(
          (entry) => (entry.event.created_at ?? 0) > checkpointCreatedAtSeconds,
        );
        if (scopedActions.length === 0) scopedActions = actions;
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
      });

      const existing = replayed.airline ? replayed : null;

      if (!existing) {
        set({
          pubkey,
          airline: null,
          fleet: [],
          routes: [],
          timeline: [],
          actionChainHash: "",
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
      const reconciledFleet = cleanFleet.map((ac) => ({
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

      set({
        pubkey,
        airline: loadedAirline,
        fleet: reconciledFleet,
        routes: reconciledRoutes,
        timeline: loadedAirline?.timeline || [],
        actionChainHash: replayed.actionChainHash,
        latestCheckpoint: checkpoint,
        identityStatus: "ready",
        isLoading: false,
      });
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

      set({ airline, isLoading: false, fleet: [], routes: [], timeline: [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create airline.";
      set({ error: message, isLoading: false });
    }
  },
});
