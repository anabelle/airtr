import { StateCreator } from 'zustand';
import { AirlineState } from '../types';
import { fp, GENESIS_TIME, AircraftInstance, Route, TimelineEvent } from '@airtr/core';
import { AirlineEntity } from '@airtr/core';
import {
    waitForNip07,
    getPubkey,
    attachSigner,
    ensureConnected,
    loadAirline,
    publishAirline,
    type AirlineConfig
} from '@airtr/nostr';
import { useEngineStore } from '../engine';

export interface IdentitySlice {
    pubkey: string | null;
    identityStatus: 'checking' | 'no-extension' | 'ready';
    isLoading: boolean;
    error: string | null;
    airline: AirlineEntity | null;
    fleet: AircraftInstance[];
    routes: Route[];
    timeline: TimelineEvent[];
    initializeIdentity: () => Promise<void>;
    createAirline: (params: AirlineConfig) => Promise<void>;
    updateAirlineHubs: (hubs: string[]) => Promise<void>;
}

export const createIdentitySlice: StateCreator<
    AirlineState,
    [],
    [],
    IdentitySlice
> = (set, get) => ({
    pubkey: null,
    identityStatus: 'checking',
    isLoading: false,
    error: null,
    airline: null,
    fleet: [],
    routes: [],
    timeline: [],

    initializeIdentity: async () => {
        set({ isLoading: true, error: null, airline: null, pubkey: null });

        const extensionReady = await waitForNip07();
        if (!extensionReady) {
            set({ identityStatus: 'no-extension', isLoading: false });
            return;
        }

        try {
            const pubkey = await getPubkey();

            if (!pubkey) {
                set({ identityStatus: 'no-extension', isLoading: false, error: 'Extension did not return a pubkey' });
                return;
            }

            attachSigner();
            ensureConnected();

            const existing = await loadAirline(pubkey);

            const maxPossibleHours = (Date.now() - GENESIS_TIME) / 3600000 + 48;

            const cleanFleet = existing && existing.fleet ? existing.fleet.map(ac => ({
                ...ac,
                flightHoursTotal: Math.min(ac.flightHoursTotal, maxPossibleHours),
                flightHoursSinceCheck: Math.min(ac.flightHoursSinceCheck, maxPossibleHours)
            })) : [];

            // Step 6: Bidirectional Route/Fleet Reconciliation
            // 6a. Ensure routes only list planes that actually exist
            const fleetIds = new Set(cleanFleet.map(ac => ac.id));
            const rawRoutes = existing && existing.routes ? existing.routes : [];
            const reconciledRoutes = rawRoutes.map(route => ({
                ...route,
                assignedAircraftIds: route.assignedAircraftIds.filter(id => fleetIds.has(id))
            }));

            // 6b. Ensure planes only point to routes that actually exist
            const routeIds = new Set(reconciledRoutes.map(r => r.id));
            const reconciledFleet = cleanFleet.map(ac => ({
                ...ac,
                assignedRouteId: ac.assignedRouteId && routeIds.has(ac.assignedRouteId) ? ac.assignedRouteId : null
            }));

            set({
                pubkey,
                airline: existing ? existing.airline : null,
                fleet: reconciledFleet,
                routes: reconciledRoutes,
                timeline: existing?.airline?.timeline || [],
                identityStatus: 'ready',
                isLoading: false,
            });
        } catch (error: any) {
            set({
                error: error.message,
                identityStatus: 'ready',
                isLoading: false,
            });
        }
    },

    createAirline: async (params: AirlineConfig) => {
        set({ isLoading: true, error: null });
        try {
            attachSigner();
            ensureConnected();

            const event = await publishAirline({
                ...params,
                corporateBalance: fp(100000000),
                lastTick: useEngineStore.getState().tick,
            });

            const pubkey = await getPubkey();
            if (!pubkey) throw new Error("No pubkey after extension ready");

            const airline: AirlineEntity = {
                id: event.id,
                foundedBy: pubkey,
                ceoPubkey: pubkey,
                name: params.name,
                icaoCode: params.icaoCode,
                callsign: params.callsign,
                hubs: params.hubs,
                livery: params.livery,
                status: 'private',
                sharesOutstanding: 10000000,
                shareholders: { [pubkey]: 10000000 },
                brandScore: 0.5,
                tier: 1,
                corporateBalance: fp(100000000),
                stockPrice: fp(10),
                fleetIds: [],
                routeIds: [],
                lastTick: useEngineStore.getState().tick,
            };

            set({ airline, isLoading: false, fleet: [], routes: [], timeline: [] });
        } catch (error: any) {
            set({ error: error.message, isLoading: false });
        }
    },

    updateAirlineHubs: async (hubs: string[]) => {
        const { airline, fleet, routes } = get();
        if (!airline) return;

        set({ isLoading: true });
        try {
            const updatedAirline = { ...airline, hubs };
            await publishAirline({
                ...updatedAirline,
                fleet,
                routes
            });
            set({ airline: updatedAirline, isLoading: false });
        } catch (error: any) {
            set({ error: error.message, isLoading: false });
        }
    },
});
