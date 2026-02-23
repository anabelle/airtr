import { create } from 'zustand';
import type { AirlineEntity, AircraftInstance, AircraftModel } from '@airtr/core';
import { fp, fpSub, fpAdd, calculateBookValue } from '@airtr/core';
import { getAircraftById } from '@airtr/data';
import {
    waitForNip07,
    getPubkey,
    attachSigner,
    ensureConnected,
    loadAirline,
    publishAirline,
    publishUsedAircraft,
    loadMarketplace,
    NDKEvent,
    getNDK,
    type AirlineConfig
} from '@airtr/nostr';
import { useEngineStore } from './engine';

/**
 * User paths:
 * 
 * 1. No NIP-07 extension → show "Install Extension" message, can't play
 * 2. Extension present, first visit → getPubkey() → no airline found → show Create form
 * 3. Extension present, return visit → getPubkey() → load airline → show dashboard
 * 4. Extension present, switch identity → reload → getPubkey() returns NEW pubkey → load THAT airline
 * 
 * Key invariant: we ALWAYS ask window.nostr.getPublicKey() fresh on each init.
 * We never cache the pubkey ourselves. The extension is the source of truth.
 */

export type IdentityStatus = 'checking' | 'no-extension' | 'ready';

export interface AirlineState {
    airline: AirlineEntity | null;
    fleet: AircraftInstance[];
    pubkey: string | null;
    identityStatus: IdentityStatus;
    isLoading: boolean;
    error: string | null;

    // Actions
    initializeIdentity: () => Promise<void>;
    createAirline: (params: AirlineConfig) => Promise<void>;
    updateHub: (newHubIata: string) => Promise<void>;
    purchaseAircraft: (model: AircraftModel, deliveryHubIata?: string, configuration?: { economy: number; business: number; first: number; cargoKg: number; }, customName?: string) => Promise<void>;
    sellAircraft: (aircraftId: string) => Promise<void>;
    purchaseUsedAircraft: (listing: any) => Promise<void>;
    processTick: (tick: number) => void;
}

export const useAirlineStore = create<AirlineState>((set, get) => ({
    airline: null,
    fleet: [],
    pubkey: null,
    identityStatus: 'checking',
    isLoading: false,
    error: null,

    initializeIdentity: async () => {
        set({ isLoading: true, error: null, airline: null, pubkey: null });

        // Step 1: Wait for NIP-07 extension to inject (up to 1.5s)
        const extensionReady = await waitForNip07();
        if (!extensionReady) {
            set({ identityStatus: 'no-extension', isLoading: false });
            return;
        }

        try {
            // Step 2: Get pubkey from extension (fresh every time — no caching)
            const pubkey = await getPubkey();

            if (!pubkey) {
                set({ identityStatus: 'no-extension', isLoading: false, error: 'Extension did not return a pubkey' });
                return;
            }

            // Step 3: Attach signer to NDK (fresh instance to avoid cached identity)
            attachSigner();

            // Step 4: Start relay connections (fire-and-forget, NDK handles reconnection)
            ensureConnected();

            // Step 5: Try to load existing airline for this pubkey
            const existing = await loadAirline(pubkey);

            set({
                pubkey,
                airline: existing ? existing.airline : null,
                fleet: existing ? existing.fleet : [],
                identityStatus: 'ready',
                isLoading: false,
            });
        } catch (error: any) {
            set({
                error: error.message,
                identityStatus: 'ready', // Extension works, just failed to load
                isLoading: false,
            });
        }
    },

    createAirline: async (params) => {
        set({ isLoading: true, error: null });
        try {
            // Ensure signer is attached and relays connected
            attachSigner();
            ensureConnected();

            await publishAirline(params);

            // Get current pubkey (should already be known)
            const pubkey = await getPubkey();
            if (!pubkey) throw new Error('Lost identity during publish');

            const newAirline: AirlineEntity = {
                id: pubkey, // We'll just use pubkey as ID for the MVP store testing locally
                foundedBy: pubkey,
                status: 'private',
                ceoPubkey: pubkey,
                sharesOutstanding: 10000000,
                shareholders: { [pubkey]: 10000000 },
                ...params,
                brandScore: 0.5,
                tier: 1,
                corporateBalance: fp(100000000),
                stockPrice: fp(10),
                fleetIds: [],
                routeIds: [],
                lastTick: useEngineStore.getState().tick
            };

            set({ airline: newAirline, pubkey, isLoading: false });
        } catch (error: any) {
            set({ error: error.message, isLoading: false });
        }
    },

    updateHub: async (newHubIata: string) => {
        const { airline } = get();
        if (!airline) return;

        const updated = { ...airline, hubs: [newHubIata] };
        set({ airline: updated });

        // Republish to Nostr so the hub change persists
        try {
            attachSigner();
            ensureConnected();
            await publishAirline({
                name: updated.name,
                icaoCode: updated.icaoCode,
                callsign: updated.callsign,
                hubs: updated.hubs,
                livery: updated.livery,
                corporateBalance: updated.corporateBalance,
                fleet: get().fleet,
                lastTick: useEngineStore.getState().tick,
            });
        } catch (error: any) {
            console.warn('Failed to publish hub change to Nostr:', error);
            // Optimistic update already applied — will sync next publish
        }
    },

    purchaseAircraft: async (model: AircraftModel, deliveryHubIata?: string, configuration?: { economy: number; business: number; first: number; cargoKg: number; }, customName?: string) => {
        const { airline, pubkey, fleet } = get();
        if (!airline || !pubkey) throw new Error("No active identity or airline loaded.");

        if (airline.corporateBalance < model.price) {
            throw new Error(`Insufficient corporate balance to purchase ${model.name}.`);
        }

        const engineStore = useEngineStore.getState();
        const homeAirport = engineStore.homeAirport;
        const targetHubIata = deliveryHubIata || homeAirport?.iata;

        if (!targetHubIata) {
            throw new Error("You must establish a Hub airport before purchasing aircraft.");
        }

        const newInstanceId = `ac-${Date.now().toString(36)}`;

        const newInstance: AircraftInstance = {
            id: newInstanceId,
            ownerPubkey: pubkey,
            modelId: model.id,
            name: customName && customName.trim() !== '' ? customName : `${model.name} ${fleet.length + 1}`,
            status: 'delivery',
            assignedRouteId: null,
            baseAirportIata: targetHubIata,
            purchasedAtTick: engineStore.tick,
            deliveryAtTick: engineStore.tick + model.deliveryTimeTicks,
            configuration: configuration || { ...model.capacity },
            flightHoursTotal: 0,
            flightHoursSinceCheck: 0,
            condition: 1.0,
        };

        const updatedAirline = {
            ...airline,
            corporateBalance: fpSub(airline.corporateBalance, model.price),
            fleetIds: [...airline.fleetIds, newInstanceId]
        };

        set({
            airline: updatedAirline,
            fleet: [...fleet, newInstance]
        });

        // Publish to Nostr to persist
        try {
            await publishAirline({
                name: updatedAirline.name,
                icaoCode: updatedAirline.icaoCode,
                callsign: updatedAirline.callsign,
                hubs: updatedAirline.hubs,
                livery: updatedAirline.livery,
                corporateBalance: updatedAirline.corporateBalance,
                fleet: [...fleet, newInstance],
                lastTick: useEngineStore.getState().tick,
            });
        } catch (e) {
            console.error('Failed to sync aircraft purchase to Nostr:', e);
        }
    },

    sellAircraft: async (aircraftId: string) => {
        const { airline, fleet } = get();
        if (!airline) throw new Error("No active identity or airline loaded.");

        const instanceIndex = fleet.findIndex(f => f.id === aircraftId);
        if (instanceIndex === -1) throw new Error("Aircraft not found in operational fleet.");

        const instance = fleet[instanceIndex];
        const model = getAircraftById(instance.modelId);
        if (!model) throw new Error("Aircraft catalog model not found.");

        const currentTick = useEngineStore.getState().tick;

        // 1. Calculate the market book value
        const resaleValue = calculateBookValue(
            model,
            instance.flightHoursTotal,
            instance.condition,
            instance.purchasedAtTick,
            currentTick
        );

        // 2. Liquidate asset -> update corporate balance & fleet array
        const updatedAirline = {
            ...airline,
            corporateBalance: fpAdd(airline.corporateBalance, resaleValue),
            fleetIds: airline.fleetIds.filter(id => id !== aircraftId)
        };

        const updatedFleet = [...fleet];
        updatedFleet.splice(instanceIndex, 1);

        set({
            airline: updatedAirline,
            fleet: updatedFleet
        });

        // Persist to nostalgia
        try {
            // Ensure identity is attached for signing the sale and listing
            attachSigner();
            ensureConnected();

            console.info(`[Marketplace] Listing aircraft ${instance.id} for ${resaleValue}...`);

            // 1. Update the airline event (removing the aircraft from fleet)
            await publishAirline({
                name: updatedAirline.name,
                icaoCode: updatedAirline.icaoCode,
                callsign: updatedAirline.callsign,
                hubs: updatedAirline.hubs,
                livery: updatedAirline.livery,
                corporateBalance: updatedAirline.corporateBalance,
                fleet: updatedFleet,
                lastTick: currentTick,
            });

            // 2. Publish to Global Marketplace for others to buy
            await publishUsedAircraft(instance as any, resaleValue);

            console.info(`[Marketplace] Successfully listed ${instance.id} for sale.`);
        } catch (e) {
            console.error('Failed to sync aircraft selling or marketplace listing to Nostr:', e);
            alert("Failed to sync sale to Nostr. The local state is updated, but the global marketplace listing may be missing.");
        }
    },

    purchaseUsedAircraft: async (listing: any) => {
        const { airline, pubkey, fleet } = get();
        if (!airline || !pubkey) throw new Error("No active identity or airline loaded.");

        const price = listing.marketplacePrice;
        if (airline.corporateBalance < price) {
            throw new Error(`Insufficient corporate balance to purchase this aircraft.`);
        }

        const engineStore = useEngineStore.getState();
        const homeAirport = engineStore.homeAirport;
        const targetHubIata = homeAirport?.iata || (airline.hubs.length > 0 ? airline.hubs[0] : null);

        if (!targetHubIata) {
            throw new Error("You must establish a Hub airport before purchasing aircraft.");
        }

        // 1. Prepare the instance for its new life
        const newInstanceId = `ac-resale-${Date.now().toString(36)}`;
        const newInstance: AircraftInstance = {
            ...listing,
            id: newInstanceId,
            ownerPubkey: pubkey,
            status: 'delivery',
            baseAirportIata: targetHubIata,
            purchasedAtTick: engineStore.tick,
            deliveryAtTick: engineStore.tick + 20,
        };

        // Remove marketplace metadata
        delete (newInstance as any).marketplacePrice;
        delete (newInstance as any).listedAt;
        delete (newInstance as any).sellerPubkey;
        delete (newInstance as any).isOptimistic;
        delete (newInstance as any).source;

        const updatedBalance = fpSub(airline.corporateBalance, price);
        const updatedAirline = {
            ...airline,
            corporateBalance: updatedBalance,
            fleetIds: [...airline.fleetIds, newInstance.id]
        };

        const updatedFleet = [...fleet, newInstance];

        set({
            airline: updatedAirline,
            fleet: updatedFleet
        });

        // 2. Persist state to Nostr
        try {
            console.info('[Marketplace] Purchasing used aircraft...', newInstance.id);
            attachSigner();
            ensureConnected();

            // A. Update airline fleet and balance
            await publishAirline({
                name: updatedAirline.name,
                icaoCode: updatedAirline.icaoCode,
                callsign: updatedAirline.callsign,
                hubs: updatedAirline.hubs,
                livery: updatedAirline.livery,
                corporateBalance: updatedAirline.corporateBalance,
                fleet: updatedFleet,
                lastTick: engineStore.tick,
            });

            // B. Deletion request for the marketplace listing (Kind 5)
            const eventIdToDelete = listing.id;
            if (eventIdToDelete && !eventIdToDelete.startsWith('local-')) {
                const ndk = getNDK();
                const deletionEvent = new NDKEvent(ndk);
                deletionEvent.kind = 5;
                deletionEvent.tags = [['e', eventIdToDelete]];
                deletionEvent.content = "Aircraft Sold (AirTR Marketplace)";
                await deletionEvent.publish();
                console.info('[Marketplace] Listing deleted from Network.');
            }
        } catch (e) {
            console.error('Failed to sync purchase to Nostr:', e);
        }
    },

    processTick: (tick: number) => {
        const { fleet, airline } = get();
        let hasChanges = false;
        const updatedFleet = fleet.map(ac => {
            if (ac.status === 'delivery' && ac.deliveryAtTick !== undefined && tick >= ac.deliveryAtTick) {
                hasChanges = true;
                return { ...ac, status: 'idle' as const };
            }
            return ac;
        });

        if (hasChanges) {
            set({ fleet: updatedFleet });
            if (airline) {
                publishAirline({
                    ...airline,
                    corporateBalance: airline.corporateBalance,
                    fleet: updatedFleet,
                    lastTick: tick,
                }).catch(e => console.error("Auto-sync tick failed", e));
            }
        }
    },
}));

// Automatically process fleet ticks when engine ticks advance
useEngineStore.subscribe((state, prevState) => {
    if (state.tick !== prevState.tick) {
        useAirlineStore.getState().processTick(state.tick);
    }
});
