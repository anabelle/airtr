import type { StateCreator } from 'zustand';
import type { AirlineState } from '../types';
import type { AircraftInstance, Route, TimelineEvent, AirlineEntity } from '@airtr/core';
import { fp, fpSub, GENESIS_TIME } from '@airtr/core';
import { getHubPricingForIata } from '@airtr/data';
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
}

export const createIdentitySlice: StateCreator<
    AirlineState,
    [],
    [],
    IdentitySlice
> = (set) => ({
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
            const activeHubs = new Set((existing?.airline?.hubs || []).filter(Boolean));
            const reconciledRoutes: Route[] = rawRoutes.map(route => {
                const hasActiveOrigin = activeHubs.size > 0
                    ? activeHubs.has(route.originIata)
                    : false;

                if (!hasActiveOrigin && route.status === 'active') {
                    return {
                        ...route,
                        status: 'suspended',
                        assignedAircraftIds: []
                    };
                }

                return {
                    ...route,
                    assignedAircraftIds: route.assignedAircraftIds.filter(id => fleetIds.has(id))
                };
            });

            // 6b. Ensure planes only point to routes that actually exist
            const routeIds = new Set(reconciledRoutes.map(r => r.id));
            const suspendedRouteIds = new Set(
                reconciledRoutes.filter(route => route.status === 'suspended').map(route => route.id)
            );
            const reconciledFleet = cleanFleet.map(ac => ({
                ...ac,
                assignedRouteId: ac.assignedRouteId && routeIds.has(ac.assignedRouteId) && !suspendedRouteIds.has(ac.assignedRouteId)
                    ? ac.assignedRouteId
                    : null
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
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to initialize identity.';
            set({
                error: message,
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

            const initialHub = params.hubs[0];
            if (!initialHub) throw new Error('Primary hub is required');
            const hubCost = fp(getHubPricingForIata(initialHub).openFee);
            const postHubBalance = fpSub(fp(100000000), hubCost);

            const event = await publishAirline({
                ...params,
                corporateBalance: postHubBalance,
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
                corporateBalance: postHubBalance,
                stockPrice: fp(10),
                fleetIds: [],
                routeIds: [],
                lastTick: useEngineStore.getState().tick,
            };

            set({ airline, isLoading: false, fleet: [], routes: [], timeline: [] });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to create airline.';
            set({ error: message, isLoading: false });
        }
    },
});
