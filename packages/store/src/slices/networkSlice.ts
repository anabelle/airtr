import { StateCreator } from 'zustand';
import { AirlineState } from '../types';
import { Route, fpSub, fp, TimelineEvent, GENESIS_TIME, TICK_DURATION, fpFormat } from '@airtr/core';
import { getAircraftById } from '@airtr/data';
import { publishAirline } from '@airtr/nostr';
import { useEngineStore } from '../engine';

export interface NetworkSlice {
    routes: Route[];
    updateHub: (newHubIata: string) => Promise<void>;
    openRoute: (originIata: string, destinationIata: string, distanceKm: number) => Promise<void>;
    assignAircraftToRoute: (aircraftId: string, routeId: string | null) => Promise<void>;
    updateRouteFares: (routeId: string, fares: { economy?: number; business?: number; first?: number }) => Promise<void>;
}

export const createNetworkSlice: StateCreator<
    AirlineState,
    [],
    [],
    NetworkSlice
> = (set, get) => ({
    routes: [],

    updateHub: async (targetHubIata: string) => {
        const { airline, fleet, routes } = get();
        if (!airline) return;

        const updatedAirline = {
            ...airline,
            hubs: [targetHubIata]
        };

        const currentTimeline = [...get().timeline];
        const currentTick = useEngineStore.getState().tick;
        const simulatedTimestamp = GENESIS_TIME + (currentTick * TICK_DURATION);

        const newEvent: TimelineEvent = {
            id: `evt-hub-${targetHubIata}-${currentTick}`,
            tick: currentTick,
            timestamp: simulatedTimestamp,
            type: 'delivery', // Re-using delivery for generic logistic shifts
            description: `Transferred main operations hub to ${targetHubIata}.`
        };

        set({
            airline: updatedAirline,
            timeline: [newEvent, ...currentTimeline].slice(0, 200)
        });

        try {
            await publishAirline({
                name: updatedAirline.name,
                icaoCode: updatedAirline.icaoCode,
                callsign: updatedAirline.callsign,
                hubs: updatedAirline.hubs,
                livery: updatedAirline.livery,
                corporateBalance: updatedAirline.corporateBalance,
                fleet: fleet,
                routes: routes,
                lastTick: useEngineStore.getState().tick,
            });
        } catch (error: any) {
            console.warn('Failed to publish hub change to Nostr:', error);
        }
    },

    openRoute: async (originIata: string, destinationIata: string, distanceKm: number) => {
        const { airline, routes, fleet, pubkey } = get();
        if (!airline || !pubkey) throw new Error("No airline loaded.");

        const SLOT_FEE = fp(100000);
        if (airline.corporateBalance < SLOT_FEE) {
            throw new Error("Insufficient funds to open route. Cost: $100,000");
        }

        const newRoute: Route = {
            id: `rt-${Date.now().toString(36)}`,
            originIata,
            destinationIata,
            airlinePubkey: pubkey,
            distanceKm,
            assignedAircraftIds: [],
            fareEconomy: fp(Math.round(distanceKm * 0.15 + 50)),
            fareBusiness: fp(Math.round(distanceKm * 0.4 + 150)),
            fareFirst: fp(Math.round(distanceKm * 0.8 + 400)),
            status: 'active',
        };

        const updatedAirline = {
            ...airline,
            corporateBalance: fpSub(airline.corporateBalance, SLOT_FEE),
            routeIds: [...airline.routeIds, newRoute.id]
        };

        const updatedRoutes = [...routes, newRoute];
        const currentTimeline = [...get().timeline];
        const currentTick = useEngineStore.getState().tick;
        const simulatedTimestamp = GENESIS_TIME + (currentTick * TICK_DURATION);

        const newEvent: TimelineEvent = {
            id: `evt-route-open-${newRoute.id}`,
            tick: currentTick,
            timestamp: simulatedTimestamp,
            type: 'purchase',
            routeId: newRoute.id,
            originIata: originIata,
            destinationIata: destinationIata,
            cost: SLOT_FEE,
            description: `Opened new route: ${originIata} ↔ ${destinationIata}. Slot fee: ${fpFormat(SLOT_FEE, 0)}`
        };

        set({
            airline: updatedAirline,
            routes: updatedRoutes,
            timeline: [newEvent, ...currentTimeline].slice(0, 200)
        });

        try {
            await publishAirline({
                ...updatedAirline,
                fleet,
                routes: updatedRoutes,
                lastTick: useEngineStore.getState().tick,
            });
        } catch (e) {
            console.error("Failed to sync route to Nostr:", e);
        }
    },

    assignAircraftToRoute: async (aircraftId: string, routeId: string | null) => {
        const { fleet, routes, airline } = get();

        const aircraft = fleet.find(ac => ac.id === aircraftId);
        const route = routes.find(r => r.id === routeId);

        if (aircraft && route) {
            const model = getAircraftById(aircraft.modelId);
            if (model && route.distanceKm > (model.rangeKm || 0)) {
                throw new Error(`${aircraft.name} does not have enough range for this route.`);
            }
        }

        const updatedFleet = fleet.map(ac => {
            if (ac.id === aircraftId) {
                return { ...ac, assignedRouteId: routeId };
            }
            return ac;
        });

        const updatedRoutes = routes.map(rt => {
            const assigned = rt.assignedAircraftIds.filter(id => id !== aircraftId);
            if (rt.id === routeId) {
                assigned.push(aircraftId);
            }
            return { ...rt, assignedAircraftIds: assigned };
        });

        const currentTimeline = [...get().timeline];
        const currentTick = useEngineStore.getState().tick;
        const simulatedTimestamp = GENESIS_TIME + (currentTick * TICK_DURATION);

        const aircraftName = aircraft?.name || 'Aircraft';
        const routeName = route ? `${route.originIata}-${route.destinationIata}` : 'None';

        const newEvent: TimelineEvent = {
            id: `evt-assign-${aircraftId}-${currentTick}`,
            tick: currentTick,
            timestamp: simulatedTimestamp,
            type: 'maintenance',
            aircraftId,
            aircraftName,
            routeId: routeId || undefined,
            description: routeId
                ? `Assigned ${aircraftName} to route ${routeName}.`
                : `Unassigned ${aircraftName} from all routes.`
        };

        set({
            fleet: updatedFleet,
            routes: updatedRoutes,
            timeline: [newEvent, ...currentTimeline].slice(0, 200)
        });

        if (airline) {
            try {
                await publishAirline({
                    ...airline,
                    fleet: updatedFleet,
                    routes: updatedRoutes,
                    lastTick: useEngineStore.getState().tick
                });
            } catch (e) {
                console.error("Failed to sync assignment to Nostr:", e);
            }
        }
    },

    updateRouteFares: async (routeId: string, fares: { economy?: number; business?: number; first?: number }) => {
        const { routes, airline, fleet } = get();

        const updatedRoutes = routes.map(rt => {
            if (rt.id === routeId) {
                return {
                    ...rt,
                    fareEconomy: fares.economy !== undefined ? fp(fares.economy) : rt.fareEconomy,
                    fareBusiness: fares.business !== undefined ? fp(fares.business) : rt.fareBusiness,
                    fareFirst: fares.first !== undefined ? fp(fares.first) : rt.fareFirst,
                };
            }
            return rt;
        });

        set({ routes: updatedRoutes });

        if (airline) {
            try {
                await publishAirline({
                    ...airline,
                    fleet,
                    routes: updatedRoutes,
                    lastTick: useEngineStore.getState().tick
                });
            } catch (e) {
                console.error("Failed to sync fares to Nostr:", e);
            }
        }
    },
});
