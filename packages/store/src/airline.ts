import { create } from 'zustand';
import type { AirlineEntity, AircraftInstance, AircraftModel, Route, FixedPoint } from '@airtr/core';
import {
    fp,
    fpSub,
    fpAdd,
    calculateBookValue,
    fpScale,
    fpFormat,
    calculateFlightRevenue,
    calculateFlightCost,
    TICKS_PER_HOUR,
    TICK_DURATION
} from '@airtr/core';
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
    routes: Route[];
    pubkey: string | null;
    identityStatus: IdentityStatus;
    isLoading: boolean;
    error: string | null;

    // Actions
    initializeIdentity: () => Promise<void>;
    createAirline: (params: AirlineConfig) => Promise<void>;
    updateHub: (newHubIata: string) => Promise<void>;
    purchaseAircraft: (model: AircraftModel, deliveryHubIata?: string, configuration?: { economy: number; business: number; first: number; cargoKg: number; }, customName?: string, purchaseType?: 'buy' | 'lease') => Promise<void>;
    sellAircraft: (aircraftId: string) => Promise<void>;
    buyoutAircraft: (aircraftId: string) => Promise<void>;
    purchaseUsedAircraft: (listing: any) => Promise<void>;
    openRoute: (originIata: string, destinationIata: string, distanceKm: number) => Promise<void>;
    assignAircraftToRoute: (aircraftId: string, routeId: string | null) => Promise<void>;
    processTick: (tick: number) => void;
}

export const useAirlineStore = create<AirlineState>((set, get) => ({
    airline: null,
    fleet: [],
    routes: [],
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
                routes: existing ? existing.routes : [],
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

    createAirline: async (params: AirlineConfig) => {
        set({ isLoading: true, error: null });
        try {
            attachSigner();
            ensureConnected();

            const event = await publishAirline({
                ...params,
                corporateBalance: fp(100000000), // Start with $100M
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

            set({ airline, isLoading: false, fleet: [], routes: [] });
        } catch (error: any) {
            set({ error: error.message, isLoading: false });
        }
    },

    updateHub: async (targetHubIata: string) => {
        const { airline, fleet, routes } = get();
        if (!airline) return;

        const updatedAirline = {
            ...airline,
            hubs: [targetHubIata] // For MVP, we only support one hub
        };

        set({ airline: updatedAirline });

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
            // Optimistic update already applied — will sync next publish
        }
    },

    purchaseAircraft: async (model: AircraftModel, deliveryHubIata?: string, configuration?: { economy: number; business: number; first: number; cargoKg: number; }, customName?: string, purchaseType: 'buy' | 'lease' = 'buy') => {
        const { airline, pubkey, fleet, routes } = get();
        if (!airline || !pubkey) throw new Error("No active identity or airline loaded.");

        const upfrontCost = purchaseType === 'buy'
            ? model.price
            : fpScale(model.price, 0.1);

        if (airline.corporateBalance < upfrontCost) {
            const label = purchaseType === 'buy' ? 'purchase' : 'lease deposit';
            throw new Error(`Insufficient corporate balance for ${label} of ${model.name}.`);
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
            purchaseType,
            leaseStartedAtTick: purchaseType === 'lease' ? engineStore.tick : undefined,
            assignedRouteId: null,
            baseAirportIata: targetHubIata,
            purchasedAtTick: engineStore.tick,
            deliveryAtTick: engineStore.tick + model.deliveryTimeTicks,
            flight: null,
            configuration: configuration || { ...model.capacity },
            flightHoursTotal: 0,
            flightHoursSinceCheck: 0,
            condition: 1.0,
        };

        const updatedFleet = [...fleet, newInstance];
        const updatedAirline = {
            ...airline,
            corporateBalance: fpSub(airline.corporateBalance, upfrontCost),
            fleetIds: [...airline.fleetIds, newInstanceId]
        };

        set({
            airline: updatedAirline,
            fleet: updatedFleet
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
                fleet: updatedFleet,
                routes: routes,
                lastTick: useEngineStore.getState().tick,
            });
        } catch (e) {
            console.error('Failed to sync aircraft purchase to Nostr:', e);
        }
    },

    sellAircraft: async (aircraftId: string) => {
        const { airline, fleet, routes } = get();
        if (!airline) throw new Error("No active identity or airline loaded.");

        const instanceIndex = fleet.findIndex(f => f.id === aircraftId);
        if (instanceIndex === -1) throw new Error("Aircraft not found in operational fleet.");

        const instance = fleet[instanceIndex];
        const model = getAircraftById(instance.modelId);
        if (!model) throw new Error("Aircraft catalog model not found.");

        const currentTick = useEngineStore.getState().tick;

        // 1. Calculate the market book value
        const isLease = instance.purchaseType === 'lease';
        const resaleValue = isLease
            ? fp(0)
            : calculateBookValue(
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

            // 1. Update the airline event (removing the aircraft from fleet)
            await publishAirline({
                name: updatedAirline.name,
                icaoCode: updatedAirline.icaoCode,
                callsign: updatedAirline.callsign,
                hubs: updatedAirline.hubs,
                livery: updatedAirline.livery,
                corporateBalance: updatedAirline.corporateBalance,
                fleet: updatedFleet,
                routes: routes,
                lastTick: currentTick,
            });

            // 2. Publish to Global Marketplace only if it was owned
            if (!isLease) {
                console.info(`[Marketplace] Listing aircraft ${instance.id} for ${resaleValue}...`);
                await publishUsedAircraft(instance as any, resaleValue);
                console.info(`[Marketplace] Successfully listed ${instance.id} for sale.`);
            } else {
                console.info(`[Fleet] Leased aircraft ${instance.id} returned to lessor.`);
            }
        } catch (e) {
            console.error('Failed to sync aircraft selling or marketplace listing to Nostr:', e);
            alert("Failed to sync fleet change to Nostr. The local state is updated, but global sync may be delayed.");
        }
    },

    buyoutAircraft: async (aircraftId: string) => {
        const { airline, fleet, routes } = get();
        if (!airline) throw new Error('No airline found.');

        const instance = fleet.find(f => f.id === aircraftId);
        if (!instance) throw new Error('Aircraft not found.');
        if (instance.purchaseType === 'buy') throw new Error('Aircraft is already owned.');

        const model = getAircraftById(instance.modelId);
        if (!model) throw new Error('Aircraft model not found.');

        const engineStore = useEngineStore.getState();
        const cost = calculateBookValue(model, instance.flightHoursTotal, instance.condition, instance.purchasedAtTick, engineStore.tick);

        if (airline.corporateBalance < cost) {
            throw new Error(`Insufficient funds for buyout of ${instance.name}. Needed: ${fpFormat(cost)}`);
        }

        const updatedFleet = fleet.map(ac =>
            ac.id === aircraftId ? { ...ac, purchaseType: 'buy' as const } : ac
        );

        const newBalance = fpSub(airline.corporateBalance, cost);
        const updatedAirline = { ...airline, corporateBalance: newBalance };

        set({ airline: updatedAirline, fleet: updatedFleet });

        try {
            await publishAirline({
                ...updatedAirline,
                fleet: updatedFleet,
                routes: routes,
                lastTick: engineStore.tick
            });
        } catch (e) {
            console.error('Failed to sync buyout to Nostr:', e);
        }
    },

    purchaseUsedAircraft: async (listing: any) => {
        const { airline, pubkey, fleet, routes } = get();
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
            purchaseType: 'buy',
            baseAirportIata: targetHubIata,
            purchasedAtTick: engineStore.tick,
            deliveryAtTick: engineStore.tick + 20,
            flight: null,
        };

        // Remove marketplace metadata
        delete (newInstance as any).marketplacePrice;
        delete (newInstance as any).listedAt;
        delete (newInstance as any).sellerPubkey;
        delete (newInstance as any).isOptimistic;
        delete (newInstance as any).source;

        const updatedBalance = fpSub(airline.corporateBalance, price);
        const updatedFleet = [...fleet, newInstance];
        const updatedAirline = {
            ...airline,
            corporateBalance: updatedBalance,
            fleetIds: [...airline.fleetIds, newInstance.id]
        };

        set({
            airline: updatedAirline,
            fleet: updatedFleet
        });

        // 2. Publish to Nostr
        try {
            attachSigner();
            ensureConnected();

            await publishAirline({
                name: updatedAirline.name,
                icaoCode: updatedAirline.icaoCode,
                callsign: updatedAirline.callsign,
                hubs: updatedAirline.hubs,
                livery: updatedAirline.livery,
                corporateBalance: updatedAirline.corporateBalance,
                fleet: updatedFleet,
                routes: routes,
                lastTick: engineStore.tick,
            });

            // 3. Mark the marketplace listing as sold (by deleting it or updating it)
            // For Kind 30079, deletion is standard.
            const ndk = getNDK();
            const deletionEvent = new NDKEvent(ndk);
            deletionEvent.kind = 5; // Event deletion
            deletionEvent.tags = [['e', listing.id]];
            await deletionEvent.publish();
            console.info('[Marketplace] Listing deleted from Network.');
        } catch (e) {
            console.error('Failed to sync purchase to Nostr:', e);
        }
    },

    openRoute: async (originIata: string, destinationIata: string, distanceKm: number) => {
        const { airline, routes, fleet, pubkey } = get();
        if (!airline || !pubkey) throw new Error("No airline loaded.");

        const SLOT_FEE = fp(100000); // $100k to open a route
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
            fareEconomy: fp(Math.round(distanceKm * 0.15 + 50)), // Basic heuristic pricing
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

        set({ airline: updatedAirline, routes: updatedRoutes });

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

        const updatedFleet = fleet.map(ac => {
            if (ac.id === aircraftId) {
                return { ...ac, assignedRouteId: routeId };
            }
            return ac;
        });

        const updatedRoutes = routes.map(rt => {
            // Remove aircraft from ANY route it was on
            const assigned = rt.assignedAircraftIds.filter(id => id !== aircraftId);
            // Add if match
            if (rt.id === routeId) {
                assigned.push(aircraftId);
            }
            return { ...rt, assignedAircraftIds: assigned };
        });

        set({ fleet: updatedFleet, routes: updatedRoutes });

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

    processTick: async (tick: number) => {
        const { fleet, airline, routes } = get();
        if (!airline) return;

        let hasChanges = false;
        let corporateBalance = airline.corporateBalance;
        const updatedFleetMap = new Map(fleet.map(ac => [ac.id, { ...ac }]));

        // 1. Process each aircraft
        for (const [id, ac] of updatedFleetMap) {
            // Already processed this tick?
            if (ac.lastTickProcessed === tick) continue;
            ac.lastTickProcessed = tick;

            // Handle Delivery
            if (ac.status === 'delivery') {
                if (ac.deliveryAtTick !== undefined && tick >= ac.deliveryAtTick) {
                    ac.status = 'idle';
                    hasChanges = true;
                }
                continue;
            }

            // Handle Maintenance (Placeholders for now)
            if (ac.status === 'maintenance') continue;

            const model = getAircraftById(ac.modelId);
            if (!model) continue;

            // --- FLIGHT STATE MACHINE ---

            // State: IDLE -> Start Flight if assigned
            if (ac.status === 'idle' && ac.assignedRouteId) {
                const route = routes.find(r => r.id === ac.assignedRouteId);
                if (route && route.status === 'active') {
                    // Real-world duration calculation
                    const hours = route.distanceKm / (model.speedKmh || 800);
                    const durationTicks = Math.ceil(hours * TICKS_PER_HOUR);

                    ac.status = 'enroute';
                    ac.flight = {
                        originIata: route.originIata,
                        destinationIata: route.destinationIata,
                        departureTick: tick,
                        arrivalTick: tick + Math.max(1, durationTicks),
                        direction: 'outbound'
                    };
                    hasChanges = true;
                }
            }

            // State: ENROUTE -> Land if time reached
            else if (ac.status === 'enroute' && ac.flight && tick >= ac.flight.arrivalTick) {
                const route = routes.find(r => r.id === ac.assignedRouteId);
                if (route) {
                    // LANDING & REVENUE PROCESSING
                    // For now, simplify pax: use 85% of capacity or capped by route demand/7
                    const dailyDemand = 500; // Placeholder until we link real demand data per route
                    const captureRate = 0.85;
                    const paxE = Math.floor(Math.min(model.capacity.economy, dailyDemand * 0.8) * captureRate);
                    const paxB = Math.floor(Math.min(model.capacity.business, dailyDemand * 0.15) * captureRate);
                    const paxF = Math.floor(Math.min(model.capacity.first, dailyDemand * 0.05) * captureRate);

                    const rev = calculateFlightRevenue({
                        passengersEconomy: paxE,
                        passengersBusiness: paxB,
                        passengersFirst: paxF,
                        fareEconomy: route.fareEconomy,
                        fareBusiness: route.fareBusiness,
                        fareFirst: route.fareFirst,
                        seatsOffered: model.capacity.economy + model.capacity.business + model.capacity.first
                    });

                    const cost = calculateFlightCost({
                        distanceKm: route.distanceKm,
                        aircraft: model,
                        actualPassengers: rev.actualPassengers,
                        blockHours: (ac.flight.arrivalTick - ac.flight.departureTick) / TICKS_PER_HOUR
                    });

                    const profit = fpSub(rev.revenueTotal, cost.costTotal);
                    corporateBalance = fpAdd(corporateBalance, profit);

                    // Wear and Tear
                    const flightHours = (ac.flight.arrivalTick - ac.flight.departureTick) / TICKS_PER_HOUR;
                    ac.flightHoursTotal += flightHours;
                    ac.condition = Math.max(0, ac.condition - (0.001 * flightHours)); // 0.1% wear per hour

                    // Set to Turnaround
                    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
                    ac.status = 'turnaround';
                    ac.arrivalTickProcessed = tick; // Custom marker for turnaround end
                    ac.turnaroundEndTick = tick + Math.max(1, turnaroundTicks);
                    hasChanges = true;
                }
            }

            // State: TURNAROUND -> Return flight
            else if (ac.status === 'turnaround' && tick >= (ac.turnaroundEndTick || 0)) {
                const route = routes.find(r => r.id === ac.assignedRouteId);
                if (route && ac.flight) {
                    const hours = route.distanceKm / (model.speedKmh || 800);
                    const durationTicks = Math.ceil(hours * TICKS_PER_HOUR);
                    const isReturning = ac.flight.direction === 'outbound';

                    ac.status = 'enroute';
                    ac.flight = {
                        originIata: isReturning ? route.destinationIata : route.originIata,
                        destinationIata: isReturning ? route.originIata : route.destinationIata,
                        departureTick: tick,
                        arrivalTick: tick + Math.max(1, durationTicks),
                        direction: isReturning ? 'inbound' : 'outbound'
                    };
                    hasChanges = true;
                } else {
                    ac.status = 'idle';
                    ac.flight = null;
                    hasChanges = true;
                }
            }
        }

        // 2. Lease deductions (Every 30 REAL Days)
        const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;
        const MONTH_TICKS = 30 * TICKS_PER_DAY;
        if (tick > 0 && tick % MONTH_TICKS === 0) {
            for (const ac of updatedFleetMap.values()) {
                if (ac.purchaseType === 'lease') {
                    const model = getAircraftById(ac.modelId);
                    if (model) {
                        corporateBalance = fpSub(corporateBalance, model.monthlyLease);
                        hasChanges = true;
                    }
                }
            }
        }

        if (hasChanges) {
            const updatedFleet = Array.from(updatedFleetMap.values());
            const updatedAirline = { ...airline, corporateBalance, lastTick: tick };
            set({ fleet: updatedFleet, airline: updatedAirline });

            publishAirline({
                ...updatedAirline,
                fleet: updatedFleet,
                routes
            }).catch(e => console.error("Auto-sync tick failed", e));
        }
    },
}));

// Automatically process fleet ticks when engine ticks advance
useEngineStore.subscribe((state, prevState) => {
    if (state.tick !== prevState.tick) {
        useAirlineStore.getState().processTick(state.tick);
    }
});
