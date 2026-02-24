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
    fpFormat
} from '@airtr/core';
import { getAircraftById } from '@airtr/data';
import {
    attachSigner,
    ensureConnected,
    publishAirline,
    publishUsedAircraft,
    getNDK,
    NDKEvent
} from '@airtr/nostr';
import { useEngineStore } from '../engine';

export interface FleetSlice {
    fleet: AircraftInstance[];
    purchaseAircraft: (model: AircraftModel, deliveryHubIata?: string, configuration?: { economy: number; business: number; first: number; cargoKg: number; }, customName?: string, purchaseType?: 'buy' | 'lease') => Promise<void>;
    sellAircraft: (aircraftId: string) => Promise<void>;
    buyoutAircraft: (aircraftId: string) => Promise<void>;
    purchaseUsedAircraft: (listing: any) => Promise<void>;
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
        const resaleValue = isLease
            ? fp(0)
            : calculateBookValue(
                model,
                instance.flightHoursTotal,
                instance.condition,
                instance.birthTick || instance.purchasedAtTick,
                currentTick
            );

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

            if (!isLease) {
                await publishUsedAircraft(instance as any, resaleValue);
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

        const newInstanceId = `ac-resale-${Date.now().toString(36)}`;
        const newInstance: AircraftInstance = {
            ...listing,
            id: newInstanceId,
            ownerPubkey: pubkey,
            status: 'delivery',
            purchaseType: 'buy',
            baseAirportIata: targetHubIata,
            purchasedAtTick: engineStore.tick,
            birthTick: listing.birthTick || listing.purchasedAtTick,
            deliveryAtTick: engineStore.tick + 20,
            flight: null,
        };

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
            deletionEvent.tags = [['e', listing.id]];
            await deletionEvent.publish();
        } catch (e) {
            console.error('Failed to sync purchase to Nostr:', e);
        }
    },
});
