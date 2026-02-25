import type { StateCreator } from 'zustand';
import type { AirlineState } from '../types';
import type {
    AircraftInstance,
    AircraftModel,
    FixedPoint,
    TimelineEvent,
} from '@airtr/core';
import {
    fpSub,
    fpAdd,
    calculateBookValue,
    fpScale,
    fp,
    fpFormat,
    GENESIS_TIME,
    TICK_DURATION
} from '@airtr/core';
import { getAircraftById } from '@airtr/data';
import {
    attachSigner,
    ensureConnected,
    publishAirline,
    publishUsedAircraft,
    getNDK,
    NDKEvent,
    MARKETPLACE_KIND,
    type MarketplaceListing
} from '@airtr/nostr';
import { useEngineStore } from '../engine';

export interface FleetSlice {
    fleet: AircraftInstance[];
    purchaseAircraft: (model: AircraftModel, deliveryHubIata?: string, configuration?: { economy: number; business: number; first: number; cargoKg: number; }, customName?: string, purchaseType?: 'buy' | 'lease') => Promise<void>;
    sellAircraft: (aircraftId: string) => Promise<void>;
    buyoutAircraft: (aircraftId: string) => Promise<void>;
    purchaseUsedAircraft: (listing: MarketplaceListing) => Promise<void>;
    listAircraft: (aircraftId: string, price: FixedPoint) => Promise<void>;
    cancelListing: (aircraftId: string) => Promise<void>;
    performMaintenance: (aircraftId: string) => Promise<void>;
}

export const createFleetSlice: StateCreator<
    AirlineState,
    [],
    [],
    FleetSlice
> = (set, get) => ({
    fleet: [],
    timeline: [],

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
            purchasePrice: upfrontCost, // Deposit or full price
            birthTick: engineStore.tick,
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

        const currentTimeline = [...get().timeline];
        const simulatedTimestamp = GENESIS_TIME + (engineStore.tick * TICK_DURATION);

        const newEvent: TimelineEvent = {
            id: `evt-purchase-${newInstanceId}`,
            tick: engineStore.tick,
            timestamp: simulatedTimestamp,
            type: 'purchase',
            aircraftId: newInstanceId,
            aircraftName: newInstance.name,
            cost: upfrontCost,
            description: `Purchased ${model.name} for ${fpFormat(upfrontCost, 0)}.`
        };

        const finalTimeline = [newEvent, ...currentTimeline].slice(0, 200);

        const previousState = { airline, fleet, routes, timeline: get().timeline };

        set({
            airline: updatedAirline,
            fleet: updatedFleet,
            timeline: finalTimeline
        });

        try {
            await publishAirline({
                ...updatedAirline,
                fleet: updatedFleet,
                routes: routes,
                timeline: finalTimeline,
                lastTick: engineStore.tick,
            });
        } catch (e) {
            set(previousState);
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

        const isLease = instance.purchaseType === 'lease';
        const marketValue = isLease
            ? fp(0)
            : calculateBookValue(
                model,
                instance.flightHoursTotal,
                instance.condition,
                instance.birthTick || instance.purchasedAtTick,
                currentTick
            );

        // SCRAP / QUICK-SALE PENALTY (30%)
        // You only get 70% of book value when selling instantly to the "scrap yard".
        // To get full value, you must list it on the used marketplace.
        const resaleValue = fpScale(marketValue, 0.7);

        const updatedAirline = {
            ...airline,
            corporateBalance: fpAdd(airline.corporateBalance, resaleValue),
            fleetIds: airline.fleetIds.filter(id => id !== aircraftId)
        };

        const updatedFleet = [...fleet];
        updatedFleet.splice(instanceIndex, 1);

        const updatedRoutes = routes.map(rt => ({
            ...rt,
            assignedAircraftIds: rt.assignedAircraftIds.filter(id => id !== aircraftId)
        }));

        const currentTimeline = [...get().timeline];
        const simulatedTimestamp = GENESIS_TIME + (currentTick * TICK_DURATION);

        const newEvent: TimelineEvent = {
            id: `evt-sale-${aircraftId}-${currentTick}`,
            tick: currentTick,
            timestamp: simulatedTimestamp,
            type: 'sale',
            aircraftId,
            aircraftName: instance.name,
            revenue: resaleValue,
            description: `Sold ${instance.name} for scrap. Recovered ${fpFormat(resaleValue, 0)}.`
        };

        const previousState = { airline, fleet, routes, timeline: get().timeline };
        const nextTimeline = [newEvent, ...currentTimeline].slice(0, 200);

        set({
            airline: updatedAirline,
            fleet: updatedFleet,
            routes: updatedRoutes,
            timeline: nextTimeline
        });

        try {
            attachSigner();
            ensureConnected();

            await publishAirline({
                ...updatedAirline,
                fleet: updatedFleet,
                routes: updatedRoutes,
                timeline: nextTimeline,
                lastTick: currentTick,
            });

            // If it was listed, we should delete the listing too
            if (instance.listingPrice) {
                const ndk = getNDK();
                const deletionEvent = new NDKEvent(ndk);
                deletionEvent.kind = 5;
                // NIP-33 addressable event deletion: use ['a', ...] tag only.
                // We don't have the Nostr event ID, and ['e', aircraftId] was using
                // the app-level ID which is invalid for the 'e' tag.
                deletionEvent.tags = [['a', `${MARKETPLACE_KIND}:${instance.ownerPubkey}:airtr:marketplace:${aircraftId}`]];
                await deletionEvent.publish();
            }
        } catch (e) {
            set(previousState);
            console.error('Failed to sync aircraft selling or marketplace listing to Nostr:', e);
            throw new Error('Failed to sync fleet change to Nostr.');
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
        const cost = calculateBookValue(model, instance.flightHoursTotal, instance.condition, instance.birthTick || instance.purchasedAtTick, engineStore.tick);

        if (airline.corporateBalance < cost) {
            throw new Error(`Insufficient funds for buyout of ${instance.name}. Needed: ${fpFormat(cost)}`);
        }

        const updatedFleet = fleet.map(ac =>
            ac.id === aircraftId ? { ...ac, purchaseType: 'buy' as const } : ac
        );

        const newBalance = fpSub(airline.corporateBalance, cost);
        const updatedAirline = { ...airline, corporateBalance: newBalance };

        const currentTimeline = [...get().timeline];
        const currentTick = useEngineStore.getState().tick;
        const simulatedTimestamp = GENESIS_TIME + (currentTick * TICK_DURATION);

        const newEvent: TimelineEvent = {
            id: `evt-buyout-${aircraftId}-${currentTick}`,
            tick: currentTick,
            timestamp: simulatedTimestamp,
            type: 'purchase',
            aircraftId,
            aircraftName: instance.name,
            cost: cost,
            description: `Lease buyout for ${instance.name}. Paid remaining balance: ${fpFormat(cost, 0)}.`
        };

        const finalTimeline = [newEvent, ...currentTimeline].slice(0, 200);

        const previousState = { airline, fleet, routes, timeline: get().timeline };

        set({
            airline: updatedAirline,
            fleet: updatedFleet,
            timeline: finalTimeline
        });

        try {
            await publishAirline({
                ...updatedAirline,
                fleet: updatedFleet,
                routes: routes,
                timeline: finalTimeline,
                lastTick: engineStore.tick
            });
        } catch (e) {
            set(previousState);
            console.error('Failed to sync buyout to Nostr:', e);
        }
    },

    purchaseUsedAircraft: async (listing: MarketplaceListing) => {
        const { airline, pubkey, fleet, routes } = get();
        if (!airline || !pubkey) throw new Error("No active identity or airline loaded.");

        // Price is already validated as FixedPoint by parseMarketplaceListing
        const price = listing.marketplacePrice;

        if (airline.corporateBalance < price) {
            throw new Error(`Insufficient corporate balance: ${fpFormat(airline.corporateBalance)} vs ${fpFormat(price)}`);
        }

        const engineStore = useEngineStore.getState();
        const homeAirport = engineStore.homeAirport;
        const targetHubIata = homeAirport?.iata || (airline.hubs.length > 0 ? airline.hubs[0] : null);

        if (!targetHubIata) {
            throw new Error("You must establish a Hub airport before purchasing aircraft.");
        }

        // 1. Check if we already own this aircraft (self-purchase or re-purchase)
        const existingInstance = fleet.find(ac => ac.id === listing.instanceId);

        // 2. Inheritance: Take original manufacture date (birthTick) if available
        // Use ?? so that 0 is preserved as valid tick
        const inheritedBirthTick = listing.birthTick ?? listing.purchasedAtTick ?? engineStore.tick;

        console.log(`[Fleet] Purchasing used ${listing.name} (ID: ${listing.instanceId}) for ${fpFormat(price)}`);

        let updatedFleet: AircraftInstance[];

        if (existingInstance) {
            // Already owned check
            if (!existingInstance.listingPrice) {
                throw new Error("You already own this aircraft. The marketplace listing may be stale.");
            }
            // Self-purchase: Just update the existing record
            updatedFleet = fleet.map(ac =>
                ac.id === listing.instanceId
                    ? {
                        ...ac,
                        listingPrice: null,
                        purchasePrice: price,
                        purchasedAtTick: engineStore.tick,
                        status: 'idle' as const
                    }
                    : ac
            );
        } else {
            // New purchase: Construct AircraftInstance explicitly from validated fields
            const newInstance: AircraftInstance = {
                id: listing.instanceId,
                ownerPubkey: pubkey,
                modelId: listing.modelId,
                name: listing.name,
                status: 'delivery',
                purchaseType: 'buy',
                assignedRouteId: null,
                baseAirportIata: targetHubIata,
                purchasedAtTick: engineStore.tick,
                purchasePrice: price,
                listingPrice: null,
                birthTick: inheritedBirthTick,
                deliveryAtTick: engineStore.tick + 20,
                flight: null,
                configuration: { ...listing.configuration },
                flightHoursTotal: listing.flightHoursTotal,
                flightHoursSinceCheck: listing.flightHoursSinceCheck,
                condition: listing.condition,
            };
            updatedFleet = [...fleet, newInstance];
        }

        const updatedBalance = fpSub(airline.corporateBalance, price);
        console.log(`[Fleet] Balance: ${fpFormat(airline.corporateBalance)} -> ${fpFormat(updatedBalance)}`);

        const updatedAirline = {
            ...airline,
            corporateBalance: updatedBalance,
            fleetIds: updatedFleet.map(ac => ac.id)
        };

        const currentTimeline = [...get().timeline];
        const simulatedTimestamp = GENESIS_TIME + (engineStore.tick * TICK_DURATION);

        const newEvent: TimelineEvent = {
            id: `evt-purchase-used-${listing.instanceId}-${engineStore.tick}`,
            tick: engineStore.tick,
            timestamp: simulatedTimestamp,
            type: 'purchase',
            aircraftId: listing.instanceId,
            aircraftName: listing.name,
            cost: price,
            description: `Purchased used ${listing.name} from marketplace for ${fpFormat(price, 0)}.`
        };

        const finalTimeline = [newEvent, ...currentTimeline].slice(0, 200);

        const previousState = { airline, fleet, routes, timeline: get().timeline };

        set({
            airline: updatedAirline,
            fleet: updatedFleet,
            timeline: finalTimeline
        });

        try {
            attachSigner();
            ensureConnected();

            await publishAirline({
                ...updatedAirline,
                fleet: updatedFleet,
                routes: routes,
                timeline: finalTimeline,
                lastTick: engineStore.tick,
            });

            // NOTE: We intentionally do NOT publish a kind-5 deletion event here.
            // Per NIP-09, only the original author (seller) can delete their own events.
            // Buyer-signed deletions are rejected by compliant relays.
            // The seller's client will detect the sale via syncWorld() and clean up
            // their own listing (seller-side settlement).
        } catch (e) {
            set(previousState);
            console.error('Failed to sync purchase to Nostr:', e);
        }
    },

    listAircraft: async (aircraftId: string, price: FixedPoint) => {
        const { fleet, airline, routes } = get();
        if (!airline) throw new Error("No airline loaded.");

        const instance = fleet.find(f => f.id === aircraftId);
        if (!instance) throw new Error("Aircraft not found.");
        if (instance.status === 'enroute') throw new Error("Cannot list an aircraft while it is enroute.");

        const model = getAircraftById(instance.modelId);
        if (!model) throw new Error("Model not found.");

        // 1. Price Floor: Minimum $1,000 (10% of scrap value or $1k, whichever is higher)
        const MIN_LISTING_PRICE = fp(1000);
        if (price < MIN_LISTING_PRICE) {
            throw new Error(`Listing price too low. Minimum allowed is ${fpFormat(MIN_LISTING_PRICE)}.`);
        }

        // 2. Price Ceiling: Max 120% of Factory MSRP
        const maxPrice = fpScale(model.price, 1.2);

        if (price > maxPrice) {
            throw new Error(`Listing price too high. Maximum allowed is ${fpFormat(maxPrice)} (120% of MSRP).`);
        }

        // 2. Listing Fee: 0.5% non-refundable tax
        const fee = fpScale(price, 0.005);
        if (airline.corporateBalance < fee) {
            throw new Error(`Insufficient funds for the marketplace listing fee (${fpFormat(fee)}).`);
        }

        const updatedBalance = fpSub(airline.corporateBalance, fee);
        const updatedFleet = fleet.map(ac =>
            ac.id === aircraftId ? { ...ac, listingPrice: price } : ac
        );

        const previousState = { airline, fleet, routes, timeline: get().timeline };
        const updatedAirline = { ...airline, corporateBalance: updatedBalance };

        set({
            airline: updatedAirline,
            fleet: updatedFleet
        });

        try {
            attachSigner();
            ensureConnected();

            // 3. Update Airline State
            await publishAirline({
                ...updatedAirline,
                fleet: updatedFleet,
                routes,
                timeline: get().timeline,
                lastTick: useEngineStore.getState().tick
            });

            // 2. Publish to Marketplace
            await publishUsedAircraft({ ...instance, listingPrice: price }, price);
        } catch (e) {
            set(previousState);
            console.error("Listing failed:", e);
            throw new Error('Failed to publish listing to Nostr.');
        }
    },

    cancelListing: async (aircraftId: string) => {
        const { fleet, airline, routes } = get();
        if (!airline) throw new Error("No airline loaded.");

        const instance = fleet.find(f => f.id === aircraftId);
        if (!instance) throw new Error("Aircraft not found.");

        const updatedFleet = fleet.map(ac =>
            ac.id === aircraftId ? { ...ac, listingPrice: null } : ac
        );

        const previousState = { airline, fleet, routes, timeline: get().timeline };

        set({ fleet: updatedFleet });

        try {
            attachSigner();
            ensureConnected();

            // 1. Update Airline State
            await publishAirline({
                ...airline,
                fleet: updatedFleet,
                routes,
                timeline: get().timeline,
                lastTick: useEngineStore.getState().tick
            });

            // 2. Delete Marketplace Entry
            const ndk = getNDK();
            const deletionEvent = new NDKEvent(ndk);
            deletionEvent.kind = 5;
            deletionEvent.tags = [['a', `${MARKETPLACE_KIND}:${airline.ceoPubkey}:airtr:marketplace:${aircraftId}`]];
            await deletionEvent.publish();
        } catch (e) {
            set(previousState);
            console.error("Cancellation failed:", e);
            throw new Error('Failed to remove listing from Nostr.');
        }
    },

    performMaintenance: async (aircraftId: string) => {
        const { fleet, airline, routes } = get();
        if (!airline) throw new Error("No airline loaded.");

        const instanceIndex = fleet.findIndex(f => f.id === aircraftId);
        if (instanceIndex === -1) throw new Error("Aircraft not found.");
        const instance = fleet[instanceIndex];

        if (instance.status === 'enroute') {
            throw new Error("Cannot perform maintenance while aircraft is enroute.");
        }

        const model = getAircraftById(instance.modelId);
        if (!model) throw new Error("Model not found.");

        // Formula: Base fee ($15k) + Wear Repair (10% of MSRP for zero-condition)
        const baseFee = fp(15000);
        const repairCost = fpScale(model.price, (1 - instance.condition) * 0.1);
        const totalCost = fpAdd(baseFee, repairCost);

        if (airline.corporateBalance < totalCost) {
            throw new Error(`Insufficient funds for maintenance. Required: ${fpFormat(totalCost)}`);
        }

        const updatedFleet = [...fleet];
        updatedFleet[instanceIndex] = {
            ...instance,
            condition: 1.0,
            flightHoursSinceCheck: 0,
            status: 'maintenance',
            turnaroundEndTick: useEngineStore.getState().tick + (6 * 60) / 10 // 6 hour downtime
        };

        const updatedAirline = {
            ...airline,
            corporateBalance: fpSub(airline.corporateBalance, totalCost)
        };

        const currentTimeline = [...get().timeline];
        const currentTick = useEngineStore.getState().tick;
        const simulatedTimestamp = GENESIS_TIME + (currentTick * TICK_DURATION);

        const newEvent: TimelineEvent = {
            id: `evt-maint-${aircraftId}-${currentTick}`,
            tick: currentTick,
            timestamp: simulatedTimestamp,
            type: 'maintenance',
            aircraftId,
            aircraftName: instance.name,
            cost: totalCost,
            description: `Performed heavy maintenance (D-Check) on ${instance.name}. Cost: ${fpFormat(totalCost, 0)}. Condition restored to 100%.`
        };

        const finalTimeline = [newEvent, ...currentTimeline].slice(0, 200);

        const previousState = { airline, fleet, routes, timeline: get().timeline };

        set({
            airline: { ...updatedAirline, timeline: finalTimeline },
            fleet: updatedFleet,
            timeline: finalTimeline
        });

        try {
            await publishAirline({
                ...updatedAirline,
                fleet: updatedFleet,
                routes,
                timeline: finalTimeline,
                lastTick: currentTick
            });
        } catch (e) {
            set(previousState);
            console.error("Maintenance sync failed:", e);
        }
    }
});
