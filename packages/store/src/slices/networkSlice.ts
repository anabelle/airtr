import type { StateCreator } from 'zustand';
import type { AirlineState } from '../types';
import type { Route, FixedPoint, TimelineEvent } from '@airtr/core';
import { fpSub, fp, fpScale, GENESIS_TIME, TICK_DURATION, fpFormat, getSuggestedFares } from '@airtr/core';
import { getAircraftById } from '@airtr/data';
import { airports, HUB_CLASSIFICATIONS } from '@airtr/data';
import { publishAirline } from '@airtr/nostr';
import { useEngineStore } from '../engine';

export type HubAction =
    | { type: 'add'; iata: string }
    | { type: 'switch'; iata: string }
    | { type: 'remove'; iata: string };

export interface NetworkSlice {
    routes: Route[];
    modifyHubs: (action: HubAction) => Promise<void>;
    /** @deprecated Use modifyHubs instead */
    updateHub: (newHubIata: string) => Promise<void>;
    openRoute: (originIata: string, destinationIata: string, distanceKm: number) => Promise<void>;
    assignAircraftToRoute: (aircraftId: string, routeId: string | null) => Promise<void>;
    updateRouteFares: (routeId: string, fares: { economy?: FixedPoint; business?: FixedPoint; first?: FixedPoint }) => Promise<void>;
}

export const createNetworkSlice: StateCreator<
    AirlineState,
    [],
    [],
    NetworkSlice
> = (set, get) => ({
    routes: [],

    modifyHubs: async (action: HubAction) => {
        const { airline, fleet, routes } = get();
        if (!airline) return;

        const currentHubs = airline.hubs || [];
        let newHubs: string[];
        let description: string;
        let hubFee = fp(0);

        const getHubTierCost = (iata: string) => {
            const tier = HUB_CLASSIFICATIONS[iata]?.tier ?? 'regional';
            switch (tier) {
                case 'global':
                    return fp(5000000);
                case 'international':
                    return fp(2000000);
                case 'national':
                    return fp(750000);
                default:
                    return fp(250000);
            }
        };

        switch (action.type) {
            case 'add': {
                if (currentHubs.includes(action.iata)) return;
                newHubs = [...currentHubs, action.iata];
                hubFee = getHubTierCost(action.iata);
                description = `Opened new operations hub at ${action.iata}. Hub development fee: ${fpFormat(hubFee, 0)}.`;
                break;
            }
            case 'switch': {
                if (currentHubs[0] === action.iata) return; // Already active
                newHubs = [action.iata, ...currentHubs.filter(h => h !== action.iata)];
                hubFee = fpScale(getHubTierCost(action.iata), 0.25);
                description = `Transferred main operations hub to ${action.iata}. Relocation fee: ${fpFormat(hubFee, 0)}.`;
                break;
            }
            case 'remove': {
                if (!currentHubs.includes(action.iata)) return;
                if (currentHubs.length <= 1) return; // Can't remove last hub
                newHubs = currentHubs.filter(h => h !== action.iata);
                description = `Closed operations hub at ${action.iata}.`;
                break;
            }
        }

        if (hubFee > airline.corporateBalance) {
            throw new Error(`Insufficient funds to modify hub. Required: ${fpFormat(hubFee, 0)}`);
        }

        const currentTimeline = [...get().timeline];
        const currentTick = useEngineStore.getState().tick;
        const simulatedTimestamp = GENESIS_TIME + (currentTick * TICK_DURATION);

        const newEvent: TimelineEvent = {
            id: `evt-hub-${action.type}-${action.iata}-${currentTick}`,
            tick: currentTick,
            timestamp: simulatedTimestamp,
            type: 'hub_change',
            description,
            cost: hubFee,
        };

        const finalTimeline = [newEvent, ...currentTimeline].slice(0, 200);

        const updatedAirline = {
            ...airline,
            hubs: newHubs,
            corporateBalance: fpSub(airline.corporateBalance, hubFee),
            timeline: finalTimeline,
        };

        const previousState = { airline, fleet, routes, timeline: get().timeline };

        set({
            airline: updatedAirline,
            timeline: finalTimeline,
        });

        // Atomically sync engine homeAirport to hubs[0]
        const activeIata = newHubs[0];
        const activeAirport = airports.find(a => a.iata === activeIata);
        if (activeAirport) {
            useEngineStore.getState().setHub(
                activeAirport,
                { latitude: activeAirport.latitude, longitude: activeAirport.longitude, source: 'manual' },
                `hub ${action.type}`
            );
        }

        try {
            await publishAirline({
                ...updatedAirline,
                fleet,
                routes,
                timeline: finalTimeline,
                lastTick: currentTick,
            });
        } catch (error: any) {
            set(previousState);
            // Roll back engine hub too
            const rollbackIata = previousState.airline.hubs[0];
            const rollbackAirport = airports.find(a => a.iata === rollbackIata);
            if (rollbackAirport) {
                useEngineStore.getState().setHub(
                    rollbackAirport,
                    { latitude: rollbackAirport.latitude, longitude: rollbackAirport.longitude, source: 'manual' },
                    'hub rollback'
                );
            }
            console.warn('Failed to publish hub change to Nostr:', error);
        }
    },

    // Thin wrapper for backward compat — delegates to modifyHubs
    updateHub: async (targetHubIata: string) => {
        await get().modifyHubs({ type: 'switch', iata: targetHubIata });
    },

    openRoute: async (originIata: string, destinationIata: string, distanceKm: number) => {
        const { airline, routes, fleet, pubkey } = get();
        if (!airline || !pubkey) throw new Error("No airline loaded.");

        const SLOT_FEE = fp(100000);
        if (airline.corporateBalance < SLOT_FEE) {
            throw new Error("Insufficient funds to open route. Cost: $100,000");
        }

        const suggested = getSuggestedFares(distanceKm);

        const newRoute: Route = {
            id: `rt-${Date.now().toString(36)}`,
            originIata,
            destinationIata,
            airlinePubkey: pubkey,
            distanceKm,
            assignedAircraftIds: [],
            fareEconomy: suggested.economy,
            fareBusiness: suggested.business,
            fareFirst: suggested.first,
            status: 'active',
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

        const finalTimeline = [newEvent, ...currentTimeline].slice(0, 200);
        const updatedAirline = {
            ...airline,
            corporateBalance: fpSub(airline.corporateBalance, SLOT_FEE),
            routeIds: [...airline.routeIds, newRoute.id],
            timeline: finalTimeline
        };

        const previousState = { airline, fleet, routes, timeline: get().timeline };

        set({
            airline: updatedAirline,
            routes: updatedRoutes,
            timeline: finalTimeline
        });

        try {
            await publishAirline({
                ...updatedAirline,
                fleet,
                routes: updatedRoutes,
                timeline: finalTimeline,
                lastTick: currentTick,
            });
        } catch (e) {
            set(previousState);
            console.error("Failed to sync route to Nostr:", e);
        }
    },

    assignAircraftToRoute: async (aircraftId: string, routeId: string | null) => {
        const { fleet, routes, airline } = get();
        if (!airline) return;

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

        const finalTimeline = [newEvent, ...currentTimeline].slice(0, 200);
        const updatedAirline = {
            ...airline,
            timeline: finalTimeline
        };

        const previousState = { airline, fleet, routes, timeline: get().timeline };

        set({
            airline: updatedAirline,
            fleet: updatedFleet,
            routes: updatedRoutes,
            timeline: finalTimeline
        });

        try {
            await publishAirline({
                ...updatedAirline,
                fleet: updatedFleet,
                routes: updatedRoutes,
                timeline: finalTimeline,
                lastTick: currentTick
            });
        } catch (e) {
            set(previousState);
            console.error("Failed to sync assignment to Nostr:", e);
        }
    },

    updateRouteFares: async (routeId: string, fares: { economy?: FixedPoint; business?: FixedPoint; first?: FixedPoint }) => {
        const { routes, airline, fleet } = get();
        if (!airline) return;

        const updatedRoutes = routes.map(rt => {
            if (rt.id === routeId) {
                return {
                    ...rt,
                    fareEconomy: fares.economy !== undefined ? fares.economy : rt.fareEconomy,
                    fareBusiness: fares.business !== undefined ? fares.business : rt.fareBusiness,
                    fareFirst: fares.first !== undefined ? fares.first : rt.fareFirst,
                };
            }
            return rt;
        });

        const currentTimeline = get().timeline;
        const updatedAirline = {
            ...airline,
            timeline: currentTimeline
        };

        const previousState = { airline, fleet, routes, timeline: get().timeline };

        set({ routes: updatedRoutes, airline: updatedAirline });

        try {
            await publishAirline({
                ...updatedAirline,
                fleet,
                routes: updatedRoutes,
                timeline: currentTimeline,
                lastTick: useEngineStore.getState().tick
            });
        } catch (e) {
            set(previousState);
            console.error("Failed to sync fares to Nostr:", e);
        }
    },
});
