import { StateCreator } from 'zustand';
import { AirlineState } from '../types';
import {
    AircraftInstance,
    AircraftModel,
    fpSub,
    fpAdd,
    calculateBookValue,
    fpScale,
    fp,
    fpFormat,
    fpToNumber,
    FixedPoint
} from '@airtr/core';
import { getAircraftById } from '@airtr/data';
import {
    attachSigner,
    ensureConnected,
    publishAirline,
    publishUsedAircraft,
    getNDK,
    NDKEvent,
    MARKETPLACE_KIND
} from '@airtr/nostr';
import { useEngineStore } from '../engine';

export interface FleetSlice {
    fleet: AircraftInstance[];
    purchaseAircraft: (model: AircraftModel, deliveryHubIata?: string, configuration?: { economy: number; business: number; first: number; cargoKg: number; }, customName?: string, purchaseType?: 'buy' | 'lease') => Promise<void>;
    sellAircraft: (aircraftId: string) => Promise<void>;
    buyoutAircraft: (aircraftId: string) => Promise<void>;
    purchaseUsedAircraft: (listing: any) => Promise<void>;
    listAircraft: (aircraftId: string, price: FixedPoint) => Promise<void>;
    cancelListing: (aircraftId: string) => Promise<void>;
}

export const createFleetSlice: StateCreator<
    AirlineState,
    [],
    [],
    FleetSlice
> = (set, get) => ({
    fleet: [],

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

        set({
            airline: updatedAirline,
            fleet: updatedFleet
        });

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
                lastTick: engineStore.tick,
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

        set({
            airline: updatedAirline,
            fleet: updatedFleet
        });

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
                lastTick: currentTick,
            });

            // If it was listed, we should delete the listing too
            if (instance.listingPrice) {
                const ndk = getNDK();
                const deletionEvent = new NDKEvent(ndk);
                deletionEvent.kind = 5;
                // Important: We need the NIP-33 address for the replaceable event
                deletionEvent.tags = [['e', aircraftId], ['a', `${MARKETPLACE_KIND}:${instance.ownerPubkey}:airtr:marketplace:${aircraftId}`]];
                await deletionEvent.publish();
            }
        } catch (e) {
            console.error('Failed to sync aircraft selling or marketplace listing to Nostr:', e);
            alert("Failed to sync fleet change to Nostr.");
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

        const price = Number(listing.marketplacePrice);
        if (isNaN(price)) throw new Error("Invalid price on marketplace listing.");

        if (airline.corporateBalance < price) {
            throw new Error(`Insufficient corporate balance: ${fpFormat(airline.corporateBalance)} vs ${fpFormat(price as any)}`);
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
        const inheritedBirthTick = listing.birthTick || listing.purchasedAtTick || engineStore.tick;

        console.log(`[Fleet] Purchasing used ${listing.name} (ID: ${listing.instanceId}) for ${fpFormat(price as any)}`);

        // 3. Create or Update the instance
        const { marketplacePrice, listedAt, sellerPubkey, isOptimistic, source, ...cleanedAircraft } = listing;

        let updatedFleet: AircraftInstance[];

        if (existingInstance) {
            // Self-purchase: Just update the existing record
            updatedFleet = fleet.map(ac =>
                ac.id === listing.instanceId
                    ? {
                        ...ac,
                        listingPrice: null,
                        purchasePrice: price as any,
                        purchasedAtTick: engineStore.tick,
                        status: 'idle' // Don't put it in delivery if we already have it
                    }
                    : ac
            );
        } else {
            // New purchase: Create new instance (Keep original airframe ID if possible)
            const newInstance: AircraftInstance = {
                ...cleanedAircraft,
                id: listing.instanceId, // Keep original ID to maintain airframe identity
                ownerPubkey: pubkey,
                status: 'delivery',
                purchaseType: 'buy',
                baseAirportIata: targetHubIata,
                purchasedAtTick: engineStore.tick,
                purchasePrice: price as any,
                listingPrice: null, // CLEAR LISTING PRICE
                birthTick: inheritedBirthTick,
                deliveryAtTick: engineStore.tick + 20,
                flight: null,
            };
            updatedFleet = [...fleet, newInstance];
        }

        const updatedBalance = fpSub(airline.corporateBalance, price as any);
        console.log(`[Fleet] Balance: ${fpFormat(airline.corporateBalance)} -> ${fpFormat(updatedBalance)}`);

        const updatedAirline = {
            ...airline,
            corporateBalance: updatedBalance,
            fleetIds: updatedFleet.map(ac => ac.id)
        };

        set({
            airline: updatedAirline,
            fleet: updatedFleet
        });

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

            const ndk = getNDK();
            const deletionEvent = new NDKEvent(ndk);
            deletionEvent.kind = 5;
            // Delete by event ID and by address if it's a replaceable event
            deletionEvent.tags = [
                ['e', listing.id],
                ['a', `${MARKETPLACE_KIND}:${listing.sellerPubkey}:airtr:marketplace:${listing.instanceId}`]
            ];
            await deletionEvent.publish();
        } catch (e) {
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

        // 1. Price Ceiling: Max 120% of Factory MSRP
        const msrp = fpToNumber(model.price);
        const maxPrice = msrp * 1.2;
        const requestedPrice = Number(price);

        if (requestedPrice > maxPrice) {
            throw new Error(`Listing price too high. Maximum allowed is ${fpFormat(fp(maxPrice))} (120% of MSRP).`);
        }

        // 2. Listing Fee: 0.5% non-refundable tax
        const fee = fp(requestedPrice * 0.005);
        if (airline.corporateBalance < fee) {
            throw new Error(`Insufficient funds for the marketplace listing fee (${fpFormat(fee)}).`);
        }

        const updatedBalance = fpSub(airline.corporateBalance, fee);
        const updatedFleet = fleet.map(ac =>
            ac.id === aircraftId ? { ...ac, listingPrice: price } : ac
        );

        set({
            airline: { ...airline, corporateBalance: updatedBalance },
            fleet: updatedFleet
        });

        try {
            attachSigner();
            ensureConnected();

            // 3. Update Airline State
            await publishAirline({
                ...airline,
                corporateBalance: updatedBalance,
                fleet: updatedFleet,
                routes,
                lastTick: useEngineStore.getState().tick
            });

            // 2. Publish to Marketplace
            await publishUsedAircraft({ ...instance, listingPrice: price }, price);

            alert(`Aircraft ${instance.name} listed on Marketplace for ${fpFormat(price)}`);
        } catch (e) {
            console.error("Listing failed:", e);
            alert("Failed to publish listing to Nostr.");
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

        set({ fleet: updatedFleet });

        try {
            attachSigner();
            ensureConnected();

            // 1. Update Airline State
            await publishAirline({
                ...airline,
                fleet: updatedFleet,
                routes,
                lastTick: useEngineStore.getState().tick
            });

            // 2. Delete Marketplace Entry
            const ndk = getNDK();
            const deletionEvent = new NDKEvent(ndk);
            deletionEvent.kind = 5;
            deletionEvent.tags = [['a', `${MARKETPLACE_KIND}:${airline.ceoPubkey}:airtr:marketplace:${aircraftId}`]];
            await deletionEvent.publish();

            alert("Listing cancelled.");
        } catch (e) {
            console.error("Cancellation failed:", e);
            alert("Failed to remove listing from Nostr.");
        }
    }
});
