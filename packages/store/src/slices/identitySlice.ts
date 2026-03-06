import { computeActionChainHash, fp, fpSub } from "@acars/core";
import type {
  AircraftInstance,
  AirlineEntity,
  Checkpoint,
  Route,
  TimelineEvent,
} from "@acars/core";
import { getHubPricingForIata } from "@acars/data";
import {
  attachSigner,
  ensureConnected,
  getPubkey,
  loginWithNsec as loginWithNsecNostr,
  publishAction,
  waitForNip07,
} from "@acars/nostr";
import type { StateCreator } from "zustand";
import { publishActionWithChain } from "../actionChain";
import { useEngineStore } from "../engine";
import type { AirlineState } from "../types";
import { hydrateIdentityFromStorage } from "../localLoader";

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
  loginWithNsec: (nsec: string) => Promise<void>;
  createAirline: (params: CreateAirlineParams) => Promise<void>;
  dissolveAirline: () => Promise<void>;
}

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
    const prevStatus = get().identityStatus;
    set({ isLoading: true, error: null, airline: null, pubkey: null });

    const extensionReady = await waitForNip07();
    if (!extensionReady) {
      set({ identityStatus: "no-extension", isLoading: false });
      return;
    }

    try {
      // On auto-init (page load), use a short timeout: if the site is already
      // authorized in nos2x, getPublicKey resolves instantly.  If not, nos2x
      // needs to open a popup which Chrome blocks without a user gesture, so
      // we fail fast and let the user click "Connect Wallet" to retry.
      // On explicit user click (prevStatus !== "checking"), use the full timeout
      // so nos2x has time to open its authorization popup.
      const isPassiveInit = prevStatus === "checking";
      const pubkey = await getPubkey(isPassiveInit ? 2000 : undefined);

      if (!pubkey) {
        set({
          identityStatus: "guest",
          isLoading: false,
          error: isPassiveInit ? null : "Extension did not return a pubkey — check nos2x popup",
        });
        return;
      }

      attachSigner();
      ensureConnected();

      await hydrateIdentityFromStorage(pubkey, set);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to initialize identity.";
      set({
        error: message,
        identityStatus: "ready",
        isLoading: false,
      });
    }
  },

  loginWithNsec: async (nsec: string) => {
    set({ isLoading: true, error: null, airline: null, pubkey: null });

    try {
      const pubkey = await loginWithNsecNostr(nsec);
      ensureConnected();

      await hydrateIdentityFromStorage(pubkey, set);
    } catch (error) {
      console.warn("[IdentitySlice] nsec login failed", error);
      set({ error: "Invalid nsec key.", identityStatus: "ready", isLoading: false });
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
      const currentChainHash = get().actionChainHash || "";
      const pubkey = event.author.pubkey;
      if (!pubkey) throw new Error("No pubkey after extension ready");
      const nextHash = await computeActionChainHash(currentChainHash, {
        id: event.id,
        createdAt: event.created_at ?? null,
        authorPubkey: pubkey,
        action,
      });
      set({ actionChainHash: nextHash });

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

      const newlyCreatedAirline = get().airline;
      if (newlyCreatedAirline) {
        try {
          await import("../db").then(({ db }) => db.airline.put(newlyCreatedAirline));
        } catch (e) {
          console.error("Failed to insert airline to IndexedDB", e);
        }
        // Publish initial NIP-33 snapshot so the airline is discoverable on relays
        try {
          const { publishCurrentStateSnapshot } = await import("../actionChain");
          await publishCurrentStateSnapshot(get());
        } catch (e) {
          console.error("Failed to publish initial snapshot", e);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create airline.";
      set({ error: message, isLoading: false });
    }
  },

  dissolveAirline: async () => {
    const { airline } = get();
    if (!airline) return;
    if (airline.status !== "chapter11" && airline.status !== "liquidated") return;

    set({ isLoading: true, error: null });
    try {
      const action = {
        schemaVersion: 2,
        action: "AIRLINE_DISSOLVE" as const,
        payload: {
          tick: useEngineStore.getState().tick,
        },
      };

      await publishActionWithChain({ action, get, set });

      set({
        airline: null,
        fleet: [],
        routes: [],
        timeline: [],
        fleetDeletedDuringCatchup: [],
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to dissolve airline.";
      set({ error: message, isLoading: false });
    }
  },
});
