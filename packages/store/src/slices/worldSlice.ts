import { StateCreator } from 'zustand';
import { AirlineState } from '../types';
import { AirlineEntity, FlightOffer, Route, AircraftInstance } from '@airtr/core';
import { loadGlobalAirlines } from '@airtr/nostr';
import { getAircraftById } from '@airtr/data';

export interface WorldSlice {
    competitors: Map<string, AirlineEntity>;
    globalRouteRegistry: Map<string, FlightOffer[]>;
    globalFleet: AircraftInstance[];
    globalRoutes: Route[];
    syncWorld: () => Promise<void>;
}

export const createWorldSlice: StateCreator<
    AirlineState,
    [],
    [],
    WorldSlice
> = (set, get) => ({
    competitors: new Map(),
    globalRouteRegistry: new Map(),
    globalFleet: [],
    globalRoutes: [],

    syncWorld: async () => {
        try {
            const results = await loadGlobalAirlines();
            const competitors = new Map<string, AirlineEntity>();
            const registry = new Map<string, FlightOffer[]>();
            const allGlobalFleet: AircraftInstance[] = [];
            const allGlobalRoutes: Route[] = [];

            // Process results into maps and flat arrays
            for (const { airline, fleet, routes } of results) {
                // Skip our own airline if it's in the global results
                if (airline.ceoPubkey === get().pubkey) continue;

                competitors.set(airline.ceoPubkey, airline);
                allGlobalFleet.push(...fleet);
                allGlobalRoutes.push(...routes);

                // For each route, create a FlightOffer
                for (const route of routes) {
                    if (route.status !== 'active') continue;

                    const key = `${route.originIata}-${route.destinationIata}`;
                    const offers = registry.get(key) || [];

                    const frequency = Math.max(0, route.assignedAircraftIds.length * 7);
                    if (frequency === 0) continue;

                    // Estimate travel time
                    let avgTravelTime = 0;
                    if (route.assignedAircraftIds.length > 0) {
                        const modelIds = route.assignedAircraftIds.map((id: string) => {
                            const ac = fleet.find((a: AircraftInstance) => a.id === id);
                            return ac?.modelId;
                        }).filter(Boolean);

                        const times = modelIds.map((mid: string | undefined) => {
                            const model = getAircraftById(mid!);
                            if (!model) return 480;
                            return (route.distanceKm / (model.speedKmh || 800)) * 60;
                        });
                        avgTravelTime = times.length > 0 ? times.reduce((a: number, b: number) => a + b, 0) / times.length : 480;
                    }

                    const offer: FlightOffer = {
                        airlinePubkey: airline.ceoPubkey,
                        fareEconomy: route.fareEconomy,
                        fareBusiness: route.fareBusiness,
                        fareFirst: route.fareFirst,
                        frequencyPerWeek: frequency,
                        travelTimeMinutes: Math.round(avgTravelTime) || 480,
                        stops: 0,
                        serviceScore: 0.7,
                        brandScore: airline.brandScore || 0.5,
                    };

                    offers.push(offer);
                    registry.set(key, offers);
                }
            }

            set({
                competitors,
                globalRouteRegistry: registry,
                globalFleet: allGlobalFleet,
                globalRoutes: allGlobalRoutes
            });
        } catch (error) {
            console.error('[WorldSlice] Failed to sync world:', error);
        }
    }
});
