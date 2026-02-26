import type { StateCreator } from 'zustand';
import type { AirlineState } from '../types';
import type { AirlineEntity, FlightOffer, Route, AircraftInstance, TimelineEvent } from '@airtr/core';
import { fpAdd, fpFormat, GENESIS_TIME, TICK_DURATION } from '@airtr/core';
import { loadGlobalAirlines, publishAirline, getNDK, NDKEvent, MARKETPLACE_KIND } from '@airtr/nostr';
import { getAircraftById } from '@airtr/data';
import { useEngineStore } from '../engine';
import { processFlightEngine } from '../FlightEngine';

export interface WorldSlice {
    competitors: Map<string, AirlineEntity>;
    globalRouteRegistry: Map<string, FlightOffer[]>;
    globalFleet: AircraftInstance[];
    globalRoutes: Route[];
    syncWorld: () => Promise<void>;
    processGlobalTick: (tick: number) => void;
}



let isProcessingGlobal = false;

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

    processGlobalTick: (tick: number) => {
        if (isProcessingGlobal) return;

        const {
            competitors,
            globalFleet,
            globalRoutes,
            globalRouteRegistry,
            routes,
            fleet,
            pubkey: playerPubkey,
            airline: playerAirline
        } = get();
        if (competitors.size === 0) return;

        isProcessingGlobal = true;
        try {
            const MAX_CATCHUP = 1000;
            const updatedGlobalFleet: AircraftInstance[] = [];
            const updatedCompetitors = new Map(competitors);
            let anyChanges = false;

            const playerRouteRegistry = new Map<string, FlightOffer[]>();
            const playerBrandScore = playerAirline?.brandScore || 0.5;
            for (const route of routes) {
                if (route.status !== 'active') continue;

                const frequency = Math.max(0, route.assignedAircraftIds.length * 7);
                if (frequency === 0) continue;

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

                const key = `${route.originIata}-${route.destinationIata}`;
                const offers = playerRouteRegistry.get(key) || [];
                const offer: FlightOffer = {
                    airlinePubkey: playerPubkey || '',
                    fareEconomy: route.fareEconomy,
                    fareBusiness: route.fareBusiness,
                    fareFirst: route.fareFirst,
                    frequencyPerWeek: frequency,
                    travelTimeMinutes: Math.round(avgTravelTime) || 480,
                    stops: 0,
                    serviceScore: 0.7,
                    brandScore: playerBrandScore,
                };
                offers.push(offer);
                playerRouteRegistry.set(key, offers);
            }

            const globalRegistryEntries = [...globalRouteRegistry.entries()];

            for (const [competitorPubkey, airline] of competitors) {
                const airlineLastTick = airline.lastTick ?? (tick - 1);

                const compFleet = globalFleet.filter(ac => ac.ownerPubkey === competitorPubkey);
                const compRoutes = globalRoutes.filter(r => r.airlinePubkey === competitorPubkey);

                if (compFleet.length === 0) continue;

                if (airlineLastTick >= tick) {
                    updatedGlobalFleet.push(...compFleet);
                    continue;
                }

                let currentFleet = [...compFleet];
                let currentBalance = airline.corporateBalance;

                const targetTick = Math.min(tick, airlineLastTick + MAX_CATCHUP);
                const startTick = airlineLastTick + 1;

                const competitorRegistry = new Map<string, FlightOffer[]>();
                for (const [routeKey, offers] of globalRegistryEntries) {
                    const filtered = offers.filter(o => o.airlinePubkey !== competitorPubkey);
                    if (filtered.length > 0) competitorRegistry.set(routeKey, filtered);
                }
                for (const [routeKey, offers] of playerRouteRegistry) {
                    const existing = competitorRegistry.get(routeKey) || [];
                    competitorRegistry.set(routeKey, [...existing, ...offers]);
                }

                for (let t = startTick; t <= targetTick; t++) {
                    const result = processFlightEngine(
                        t,
                        currentFleet,
                        compRoutes,
                        currentBalance,
                        t - 1,
                        competitorRegistry,
                        competitorPubkey,
                        airline.brandScore || 0.5
                    );
                    currentFleet = result.updatedFleet;
                    currentBalance = result.corporateBalance;
                }

                updatedGlobalFleet.push(...currentFleet);
                updatedCompetitors.set(competitorPubkey, {
                    ...airline,
                    corporateBalance: currentBalance,
                    lastTick: targetTick
                });
                anyChanges = true;
            }

            if (!anyChanges) return;

            const updatedPubkeys = new Set(updatedCompetitors.keys());
            const finalFleet = [
                ...globalFleet.filter(ac => !updatedPubkeys.has(ac.ownerPubkey)),
                ...updatedGlobalFleet
            ];

            set({
                globalFleet: finalFleet,
                competitors: updatedCompetitors
            });
        } finally {
            isProcessingGlobal = false;
        }
    },

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

                // Just store as-is; processGlobalTick will catch up incrementally
                // This avoids race conditions between sync and tick processing
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

            // --- Seller-side settlement ---
            // Detect aircraft we listed for sale that now appear in a competitor's fleet.
            // This means the buyer purchased it; we must settle: remove from our fleet,
            // credit the listing price, delete our marketplace event (NIP-09 compliant),
            // and record a timeline event.
            await settleMarketplaceSales(get, set, allGlobalFleet);

        } catch (error) {
            console.error('[WorldSlice] Failed to sync world:', error);
        }
    }
});

/**
 * Seller-side marketplace settlement.
 *
 * For each aircraft in our fleet that has a `listingPrice` set, check if the
 * same instanceId now exists in a competitor's fleet (globalFleet). If so,
 * the buyer has claimed it — settle the transaction on our side.
 */
async function settleMarketplaceSales(
    get: () => AirlineState,
    set: (state: Partial<AirlineState>) => void,
    globalFleet: AircraftInstance[]
): Promise<void> {
    const { airline, fleet, routes, timeline, pubkey } = get();
    if (!airline || !pubkey) return;

    // Build a set of all aircraft IDs owned by competitors
    const competitorAircraftIds = new Set(globalFleet.map(ac => ac.id));

    // Find our listed aircraft that now appear in a competitor's fleet
    const soldAircraft = fleet.filter(ac =>
        ac.listingPrice != null &&
        ac.listingPrice > 0 &&
        competitorAircraftIds.has(ac.id)
    );

    if (soldAircraft.length === 0) return;

    console.info(`[WorldSlice] Detected ${soldAircraft.length} sold aircraft requiring settlement.`);

    const currentTick = useEngineStore.getState().tick;
    let updatedFleet = [...fleet];
    let updatedBalance = airline.corporateBalance;
    const newTimelineEvents: TimelineEvent[] = [];

    for (const sold of soldAircraft) {
        const salePrice = sold.listingPrice!;
        updatedBalance = fpAdd(updatedBalance, salePrice);

        // Remove from fleet
        updatedFleet = updatedFleet.filter(ac => ac.id !== sold.id);

        // Remove from any assigned routes
        const simulatedTimestamp = GENESIS_TIME + (currentTick * TICK_DURATION);

        const saleEvent: TimelineEvent = {
            id: `evt-marketplace-sale-${sold.id}-${currentTick}`,
            tick: currentTick,
            timestamp: simulatedTimestamp,
            type: 'sale',
            aircraftId: sold.id,
            aircraftName: sold.name,
            revenue: salePrice,
            description: `Sold ${sold.name} on marketplace for ${fpFormat(salePrice, 0)}. Settlement completed.`
        };

        newTimelineEvents.push(saleEvent);
        console.info(`[WorldSlice] Settled sale of ${sold.name} (${sold.id}) for ${fpFormat(salePrice, 0)}`);
    }

    // Clean up routes that referenced sold aircraft
    const soldIds = new Set(soldAircraft.map(ac => ac.id));
    const updatedRoutes = routes.map(rt => {
        const cleaned = rt.assignedAircraftIds.filter(id => !soldIds.has(id));
        return cleaned.length !== rt.assignedAircraftIds.length
            ? { ...rt, assignedAircraftIds: cleaned }
            : rt;
    });

    const updatedAirline = {
        ...airline,
        corporateBalance: updatedBalance,
        fleetIds: updatedFleet.map(ac => ac.id)
    };

    const finalTimeline = [...newTimelineEvents, ...timeline].slice(0, 1000);

    // Optimistic update
    set({
        airline: updatedAirline,
        fleet: updatedFleet,
        routes: updatedRoutes,
        timeline: finalTimeline
    });

    // Publish updated airline state + delete marketplace listings (seller-signed, NIP-09 compliant)
    try {
        await publishAirline({
            ...updatedAirline,
            fleet: updatedFleet,
            routes: updatedRoutes,
            timeline: finalTimeline,
            lastTick: currentTick,
        });

        // Delete our own marketplace listings (we are the author, so NIP-09 allows this)
        const ndk = getNDK();
        for (const sold of soldAircraft) {
            try {
                const deletionEvent = new NDKEvent(ndk);
                deletionEvent.kind = 5;
                deletionEvent.tags = [
                    ['a', `${MARKETPLACE_KIND}:${pubkey}:airtr:marketplace:${sold.id}`]
                ];
                await deletionEvent.publish();
                console.info(`[WorldSlice] Published NIP-09 deletion for marketplace listing: ${sold.id}`);
            } catch (e) {
                // Non-critical: listing will be filtered by ownership verification on other clients
                console.warn(`[WorldSlice] Failed to publish deletion for listing ${sold.id}:`, e);
            }
        }
    } catch (e) {
        // Rollback on publish failure
        console.error('[WorldSlice] Failed to publish marketplace settlement:', e);
        set({ airline, fleet, routes, timeline });
    }
}
