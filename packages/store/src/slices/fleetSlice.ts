import type { AircraftInstance, AircraftModel, FixedPoint, TimelineEvent } from "@acars/core";
import {
  calculateBookValue,
  createLogger,
  fp,
  fpAdd,
  fpFormat,
  fpScale,
  fpSub,
  GENESIS_TIME,
  haversineDistance,
  TICK_DURATION,
  TICKS_PER_HOUR,
} from "@acars/core";
import { airports, getAircraftById } from "@acars/data";

/** Module-level O(1) airport lookup */
const airportMap = new Map(airports.map((a) => [a.iata, a]));
import {
  attachSigner,
  ensureConnected,
  getNDK,
  MARKETPLACE_KIND,
  type MarketplaceListing,
  NDKEvent,
  publishUsedAircraft,
} from "@acars/nostr";
import type { StateCreator } from "zustand";
import { publishActionWithChain } from "../actionChain";
import { useEngineStore } from "../engine";
import type { AirlineState } from "../types";

export interface FleetSlice {
  fleet: AircraftInstance[];
  fleetDeletedDuringCatchup: string[];
  purchaseAircraft: (
    model: AircraftModel,
    deliveryHubIata?: string,
    configuration?: {
      economy: number;
      business: number;
      first: number;
      cargoKg: number;
    },
    customName?: string,
    purchaseType?: "buy" | "lease",
  ) => Promise<void>;
  sellAircraft: (aircraftId: string) => Promise<void>;
  buyoutAircraft: (aircraftId: string) => Promise<void>;
  purchaseUsedAircraft: (listing: MarketplaceListing) => Promise<void>;
  listAircraft: (aircraftId: string, price: FixedPoint) => Promise<void>;
  cancelListing: (aircraftId: string) => Promise<void>;
  performMaintenance: (aircraftId: string) => Promise<void>;
  ferryAircraft: (aircraftId: string, destinationIata: string) => Promise<void>;
  updateAircraftLivery: (aircraftId: string, imageUrl: string, promptHash: string) => Promise<void>;
}

const logger = createLogger("Fleet");

// Module-level guard: prevents duplicate purchases when the user clicks
// "Buy" rapidly before the first publish is acknowledged.  Keyed by
// modelId:purchaseType so the same model can't be bought twice in flight.
const purchasesInFlight = new Set<string>();

export const createFleetSlice: StateCreator<AirlineState, [], [], FleetSlice> = (set, get) => ({
  fleet: [],
  fleetDeletedDuringCatchup: [],
  timeline: [],

  purchaseAircraft: async (
    model: AircraftModel,
    deliveryHubIata?: string,
    configuration?: {
      economy: number;
      business: number;
      first: number;
      cargoKg: number;
    },
    customName?: string,
    purchaseType: "buy" | "lease" = "buy",
  ) => {
    const { airline, pubkey, fleet } = get();
    if (!airline || !pubkey) throw new Error("No active identity or airline loaded.");

    const purchaseKey = `${model.id}:${purchaseType}`;
    if (purchasesInFlight.has(purchaseKey)) {
      throw new Error("A purchase for this aircraft model is already in progress.");
    }

    const upfrontCost = purchaseType === "buy" ? model.price : fpScale(model.price, 0.1);

    if (airline.corporateBalance < upfrontCost) {
      const label = purchaseType === "buy" ? "purchase" : "lease deposit";
      throw new Error(`Insufficient corporate balance for ${label} of ${model.name}.`);
    }

    const engineStore = useEngineStore.getState();
    const homeAirport = engineStore.homeAirport;
    const targetHubIata = deliveryHubIata || homeAirport?.iata;

    if (!targetHubIata) {
      throw new Error("You must establish a Hub airport before purchasing aircraft.");
    }

    const newInstanceId = `ac-${pubkey.slice(0, 8)}-${Date.now().toString(36)}`;

    const newInstance: AircraftInstance = {
      id: newInstanceId,
      ownerPubkey: pubkey,
      modelId: model.id,
      name:
        customName && customName.trim() !== "" ? customName : `${model.name} ${fleet.length + 1}`,
      status: "delivery",
      purchaseType,
      leaseStartedAtTick: purchaseType === "lease" ? engineStore.tick : undefined,
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
      fleetIds: [...airline.fleetIds, newInstanceId],
    };

    const currentTimeline = [...get().timeline];
    const currentTick = engineStore.tick;
    const simulatedTimestamp = GENESIS_TIME + currentTick * TICK_DURATION;

    const newEvent: TimelineEvent = {
      id: `evt-purchase-${newInstanceId}`,
      tick: currentTick,
      timestamp: simulatedTimestamp,
      type: "purchase",
      aircraftId: newInstanceId,
      aircraftName: newInstance.name,
      cost: upfrontCost,
      description: `Purchased ${model.name} for ${fpFormat(upfrontCost, 0)}.`,
    };

    const finalTimeline = [newEvent, ...currentTimeline].slice(0, 1000);

    purchasesInFlight.add(purchaseKey);
    set({
      airline: updatedAirline,
      fleet: updatedFleet,
      timeline: finalTimeline,
    });

    try {
      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_PURCHASE",
          payload: {
            instanceId: newInstanceId,
            modelId: model.id,
            purchaseType,
            deliveryHubIata: targetHubIata,
            configuration: newInstance.configuration,
            price: upfrontCost,
            name: newInstance.name,
            tick: currentTick,
          },
        },
        get,
        set,
      });
    } catch (e) {
      set((state) => {
        if (!state.airline) return state;

        // Merge-safe rollback: remove only the newly-created aircraft,
        // refund the cost, and clean up the optimistic timeline event,
        // preserving concurrent changes to other fleet entries.
        return {
          airline: {
            ...state.airline,
            corporateBalance: fpAdd(state.airline.corporateBalance, upfrontCost),
            fleetIds: state.airline.fleetIds.filter((id) => id !== newInstanceId),
          },
          fleet: state.fleet.filter((ac) => ac.id !== newInstanceId),
          timeline: state.timeline.filter((evt) => evt.id !== newEvent.id),
        };
      });
      console.error("Failed to sync aircraft purchase to Nostr:", e);
      throw e;
    } finally {
      purchasesInFlight.delete(purchaseKey);
    }
  },

  ferryAircraft: async (aircraftId: string, destinationIata: string) => {
    const { airline, fleet } = get();
    if (!airline) throw new Error("No active airline loaded.");

    const instance = fleet.find((ac) => ac.id === aircraftId);
    if (!instance) throw new Error("Aircraft not found.");

    if (instance.status !== "idle") {
      throw new Error("Aircraft must be idle to ferry.");
    }

    if (instance.baseAirportIata === destinationIata) {
      throw new Error("Aircraft is already at that airport.");
    }

    const model = getAircraftById(instance.modelId);
    if (!model) throw new Error("Aircraft model not found.");

    const originAirport = airportMap.get(instance.baseAirportIata);
    const destinationAirport = airportMap.get(destinationIata);
    if (!originAirport || !destinationAirport) {
      throw new Error("Invalid origin or destination airport.");
    }

    const distanceKm = haversineDistance(
      originAirport.latitude,
      originAirport.longitude,
      destinationAirport.latitude,
      destinationAirport.longitude,
    );

    if (distanceKm > model.rangeKm) {
      throw new Error(`Destination out of range for ${model.name}.`);
    }

    const currentTick = useEngineStore.getState().tick;
    const simulatedTimestamp = GENESIS_TIME + currentTick * TICK_DURATION;

    const hours = distanceKm / (model.speedKmh || 800);
    const durationTicks = Math.ceil(hours * TICKS_PER_HOUR);

    const updatedFleet = fleet.map((ac) => {
      if (ac.id !== aircraftId) return ac;
      return {
        ...ac,
        assignedRouteId: null,
        status: "enroute" as const,
        flight: {
          originIata: originAirport.iata,
          destinationIata: destinationAirport.iata,
          departureTick: currentTick,
          arrivalTick: currentTick + Math.max(1, durationTicks),
          direction: "outbound" as const,
          purpose: "ferry" as const,
          distanceKm,
        },
      };
    });

    const newEvent: TimelineEvent = {
      id: `evt-ferry-${aircraftId}-${currentTick}`,
      tick: currentTick,
      timestamp: simulatedTimestamp,
      type: "ferry",
      aircraftId: aircraftId,
      aircraftName: instance.name,
      originIata: originAirport.iata,
      destinationIata: destinationAirport.iata,
      description: `${instance.name} ferrying: ${originAirport.iata} → ${destinationAirport.iata}`,
    };

    const currentTimeline = [...get().timeline];
    const finalTimeline = [newEvent, ...currentTimeline].slice(0, 1000);
    const updatedAirline = { ...airline, timeline: finalTimeline };

    set({
      airline: updatedAirline,
      fleet: updatedFleet,
      timeline: finalTimeline,
    });

    try {
      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_FERRY",
          payload: {
            instanceId: aircraftId,
            originIata: originAirport.iata,
            destinationIata: destinationAirport.iata,
            distanceKm,
            tick: currentTick,
          },
        },
        get,
        set,
      });
    } catch (e) {
      set((state) => {
        // Merge-safe rollback: restore only the ferried aircraft
        const restoredFleet = state.fleet.map((ac) => {
          if (ac.id === aircraftId) return instance;
          return ac;
        });

        // Remove only the optimistic ferry event
        const restoredTimeline = state.timeline.filter((evt) => evt.id !== newEvent.id);

        return {
          airline: state.airline ? { ...state.airline, timeline: restoredTimeline } : state.airline,
          fleet: restoredFleet,
          timeline: restoredTimeline,
        };
      });
      console.error("Failed to sync ferry flight to Nostr:", e);
      throw new Error("Failed to sync ferry flight.");
    }
  },

  sellAircraft: async (aircraftId: string) => {
    const { airline, fleet, routes } = get();
    if (!airline) throw new Error("No active identity or airline loaded.");

    const instanceIndex = fleet.findIndex((f) => f.id === aircraftId);
    if (instanceIndex === -1) throw new Error("Aircraft not found in operational fleet.");

    const instance = fleet[instanceIndex];
    if (instance.status !== "idle") {
      throw new Error("Aircraft can only be scrapped while idle.");
    }
    const model = getAircraftById(instance.modelId);
    if (!model) throw new Error("Aircraft catalog model not found.");

    const currentTick = useEngineStore.getState().tick;

    const isLease = instance.purchaseType === "lease";
    const marketValue = isLease
      ? fp(0)
      : calculateBookValue(
          model,
          instance.flightHoursTotal,
          instance.condition,
          instance.birthTick || instance.purchasedAtTick,
          currentTick,
        );

    // SCRAP / QUICK-SALE PENALTY (30%)
    // You only get 70% of book value when selling instantly to the "scrap yard".
    // To get full value, you must list it on the used marketplace.
    const resaleValue = fpScale(marketValue, 0.7);

    const updatedAirline = {
      ...airline,
      corporateBalance: fpAdd(airline.corporateBalance, resaleValue),
      fleetIds: airline.fleetIds.filter((id) => id !== aircraftId),
    };

    const updatedFleet = [...fleet];
    updatedFleet.splice(instanceIndex, 1);

    const updatedRoutes = routes.map((rt) => ({
      ...rt,
      assignedAircraftIds: rt.assignedAircraftIds.filter((id) => id !== aircraftId),
    }));

    const currentTimeline = [...get().timeline];
    const simulatedTimestamp = GENESIS_TIME + currentTick * TICK_DURATION;

    const newEvent: TimelineEvent = {
      id: `evt-sale-${aircraftId}-${currentTick}`,
      tick: currentTick,
      timestamp: simulatedTimestamp,
      type: "sale",
      aircraftId,
      aircraftName: instance.name,
      revenue: resaleValue,
      description: `Sold ${instance.name} for scrap. Recovered ${fpFormat(resaleValue, 0)}.`,
    };

    const nextTimeline = [newEvent, ...currentTimeline].slice(0, 1000);

    set({
      airline: updatedAirline,
      fleet: updatedFleet,
      routes: updatedRoutes,
      timeline: nextTimeline,
      fleetDeletedDuringCatchup: (() => {
        const deleted = get().fleetDeletedDuringCatchup;
        return deleted.includes(aircraftId) ? deleted : [...deleted, aircraftId];
      })(),
    });

    try {
      attachSigner();
      ensureConnected();

      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_SELL",
          payload: {
            instanceId: aircraftId,
            price: resaleValue,
            tick: currentTick,
          },
        },
        get,
        set,
      });

      // If it was listed, we should delete the listing too
      if (instance.listingPrice) {
        const ndk = getNDK();
        const deletionEvent = new NDKEvent(ndk);
        deletionEvent.kind = 5;
        // NIP-33 addressable event deletion: use ['a', ...] tag only.
        // We don't have the Nostr event ID, and ['e', aircraftId] was using
        // the app-level ID which is invalid for the 'e' tag.
        deletionEvent.tags = [
          ["a", `${MARKETPLACE_KIND}:${instance.ownerPubkey}:airtr:marketplace:${aircraftId}`],
        ];
        await deletionEvent.publish();
      }
    } catch (e) {
      set((state) => {
        // Merge-safe rollback: re-add the sold aircraft and restore only
        // the route assignments we changed, preserving concurrent updates.
        const restoredAirline = state.airline
          ? {
              ...state.airline,
              corporateBalance: fpSub(state.airline.corporateBalance, resaleValue),
              fleetIds: [...state.airline.fleetIds, aircraftId],
            }
          : state.airline;

        // Re-add the removed aircraft, preserving other fleet entries
        const restoredFleet = [...state.fleet, instance];

        // Restore only the route assignments we changed: re-add aircraftId
        // to any route that originally had it assigned
        const restoredRoutes = state.routes.map((rt) => {
          // Only restore if we removed this aircraftId during the optimistic update
          const originalRoute = routes.find((pr) => pr.id === rt.id);
          if (originalRoute && originalRoute.assignedAircraftIds.includes(aircraftId)) {
            return {
              ...rt,
              assignedAircraftIds: rt.assignedAircraftIds.includes(aircraftId)
                ? rt.assignedAircraftIds
                : [...rt.assignedAircraftIds, aircraftId],
            };
          }
          return rt;
        });

        // Remove only the optimistic sale event
        const restoredTimeline = state.timeline.filter((evt) => evt.id !== newEvent.id);

        return {
          airline: restoredAirline,
          fleet: restoredFleet,
          routes: restoredRoutes,
          timeline: restoredTimeline,
          fleetDeletedDuringCatchup: state.fleetDeletedDuringCatchup.filter(
            (id) => id !== aircraftId,
          ),
        };
      });
      console.error("Failed to sync aircraft selling or marketplace listing to Nostr:", e);
      throw new Error("Failed to sync fleet change to Nostr.");
    }
  },

  buyoutAircraft: async (aircraftId: string) => {
    const { airline, fleet } = get();
    if (!airline) throw new Error("No airline found.");

    const instance = fleet.find((f) => f.id === aircraftId);
    if (!instance) throw new Error("Aircraft not found.");
    if (instance.purchaseType === "buy") throw new Error("Aircraft is already owned.");

    const model = getAircraftById(instance.modelId);
    if (!model) throw new Error("Aircraft model not found.");

    const engineStore = useEngineStore.getState();
    const cost = calculateBookValue(
      model,
      instance.flightHoursTotal,
      instance.condition,
      instance.birthTick || instance.purchasedAtTick,
      engineStore.tick,
    );

    if (airline.corporateBalance < cost) {
      throw new Error(
        `Insufficient funds for buyout of ${instance.name}. Needed: ${fpFormat(cost)}`,
      );
    }

    const updatedFleet = fleet.map((ac) =>
      ac.id === aircraftId ? { ...ac, purchaseType: "buy" as const } : ac,
    );

    const newBalance = fpSub(airline.corporateBalance, cost);
    const updatedAirline = { ...airline, corporateBalance: newBalance };

    const currentTimeline = [...get().timeline];
    const currentTick = useEngineStore.getState().tick;
    const simulatedTimestamp = GENESIS_TIME + currentTick * TICK_DURATION;

    const newEvent: TimelineEvent = {
      id: `evt-buyout-${aircraftId}-${currentTick}`,
      tick: currentTick,
      timestamp: simulatedTimestamp,
      type: "purchase",
      aircraftId,
      aircraftName: instance.name,
      cost: cost,
      description: `Lease buyout for ${instance.name}. Paid remaining balance: ${fpFormat(cost, 0)}.`,
    };

    const finalTimeline = [newEvent, ...currentTimeline].slice(0, 1000);

    set({
      airline: updatedAirline,
      fleet: updatedFleet,
      timeline: finalTimeline,
    });

    try {
      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_BUYOUT",
          payload: {
            instanceId: aircraftId,
            price: cost,
            tick: currentTick,
          },
        },
        get,
        set,
      });
    } catch (e) {
      set((state) => {
        if (!state.airline) return state;

        // Merge-safe rollback: revert only the buyout changes, preserving
        // concurrent fleet/balance mutations from tick processing.
        return {
          airline: {
            ...state.airline,
            corporateBalance: fpAdd(state.airline.corporateBalance, cost),
          },
          fleet: state.fleet.map((ac) =>
            ac.id === aircraftId ? { ...ac, purchaseType: "lease" as const } : ac,
          ),
          timeline: state.timeline.filter((evt) => evt.id !== newEvent.id),
        };
      });
      console.error("Failed to sync buyout to Nostr:", e);
    }
  },

  purchaseUsedAircraft: async (listing: MarketplaceListing) => {
    const { airline, pubkey, fleet } = get();
    if (!airline || !pubkey) throw new Error("No active identity or airline loaded.");

    // Price is already validated as FixedPoint by parseMarketplaceListing
    const price = listing.marketplacePrice;

    if (airline.corporateBalance < price) {
      throw new Error(
        `Insufficient corporate balance: ${fpFormat(airline.corporateBalance)} vs ${fpFormat(price)}`,
      );
    }

    const engineStore = useEngineStore.getState();
    const homeAirport = engineStore.homeAirport;
    const targetHubIata = homeAirport?.iata || (airline.hubs.length > 0 ? airline.hubs[0] : null);

    if (!targetHubIata) {
      throw new Error("You must establish a Hub airport before purchasing aircraft.");
    }

    // 1. Check if we already own this aircraft (self-purchase or re-purchase)
    const existingInstance = fleet.find((ac) => ac.id === listing.instanceId);

    // 2. Inheritance: Take original manufacture date (birthTick) if available
    // Use ?? so that 0 is preserved as valid tick
    const inheritedBirthTick = listing.birthTick ?? listing.purchasedAtTick ?? engineStore.tick;

    logger.info(
      `Purchasing used ${listing.name} (ID: ${listing.instanceId}) for ${fpFormat(price)}`,
    );

    let updatedFleet: AircraftInstance[];

    if (existingInstance) {
      // Already owned check
      if (!existingInstance.listingPrice) {
        throw new Error("You already own this aircraft. The marketplace listing may be stale.");
      }
      // Self-purchase: Just update the existing record
      updatedFleet = fleet.map((ac) =>
        ac.id === listing.instanceId
          ? {
              ...ac,
              listingPrice: null,
              purchasePrice: price,
              purchasedAtTick: engineStore.tick,
              status: "idle" as const,
            }
          : ac,
      );
    } else {
      // New purchase: Construct AircraftInstance explicitly from validated fields
      const newInstance: AircraftInstance = {
        id: listing.instanceId,
        ownerPubkey: pubkey,
        modelId: listing.modelId,
        name: listing.name,
        status: "delivery",
        purchaseType: "buy",
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
    logger.info(`Balance: ${fpFormat(airline.corporateBalance)} -> ${fpFormat(updatedBalance)}`);

    const updatedAirline = {
      ...airline,
      corporateBalance: updatedBalance,
      fleetIds: updatedFleet.map((ac) => ac.id),
    };

    const currentTimeline = [...get().timeline];
    const currentTick = engineStore.tick;
    const simulatedTimestamp = GENESIS_TIME + currentTick * TICK_DURATION;

    const newEvent: TimelineEvent = {
      id: `evt-purchase-used-${listing.instanceId}-${engineStore.tick}`,
      tick: currentTick,
      timestamp: simulatedTimestamp,
      type: "purchase",
      aircraftId: listing.instanceId,
      aircraftName: listing.name,
      cost: price,
      description: `Purchased used ${listing.name} from marketplace for ${fpFormat(price, 0)}.`,
    };

    const finalTimeline = [newEvent, ...currentTimeline].slice(0, 1000);

    // Capture whether this is a self-purchase (existing) or new purchase for rollback
    const wasExistingInstance = !!existingInstance;
    const previousFleetIds = airline.fleetIds;

    set({
      airline: updatedAirline,
      fleet: updatedFleet,
      timeline: finalTimeline,
    });

    try {
      attachSigner();
      ensureConnected();

      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_BUY_USED",
          payload: {
            instanceId: listing.instanceId,
            listingId: listing.id,
            modelId: listing.modelId,
            name: listing.name,
            condition: listing.condition,
            flightHoursTotal: listing.flightHoursTotal,
            flightHoursSinceCheck: listing.flightHoursSinceCheck,
            configuration: listing.configuration,
            baseAirportIata: targetHubIata,
            birthTick: listing.birthTick,
            price,
            tick: currentTick,
          },
        },
        get,
        set,
      });

      // NOTE: We intentionally do NOT publish a kind-5 deletion event here.
      // Per NIP-09, only the original author (seller) can delete their own events.
      // Buyer-signed deletions are rejected by compliant relays.
      // The seller's client will detect the sale via syncWorld() and clean up
      // their own listing (seller-side settlement).
    } catch (e) {
      set((state) => {
        if (!state.airline) return state;

        // Merge-safe rollback: undo only what we changed, preserving concurrent
        // fleet/balance mutations from tick processing.
        let rolledBackFleet: AircraftInstance[];
        if (wasExistingInstance) {
          // Self-purchase: restore the original fields on the existing instance
          rolledBackFleet = state.fleet.map((ac) =>
            ac.id === listing.instanceId && existingInstance
              ? {
                  ...ac,
                  listingPrice: existingInstance.listingPrice,
                  purchasePrice: existingInstance.purchasePrice,
                  purchasedAtTick: existingInstance.purchasedAtTick,
                  status: existingInstance.status,
                }
              : ac,
          );
        } else {
          // New purchase: remove only the added aircraft
          rolledBackFleet = state.fleet.filter((ac) => ac.id !== listing.instanceId);
        }

        return {
          airline: {
            ...state.airline,
            corporateBalance: fpAdd(state.airline.corporateBalance, price),
            fleetIds: previousFleetIds,
          },
          fleet: rolledBackFleet,
          timeline: state.timeline.filter((evt) => evt.id !== newEvent.id),
        };
      });
      console.error("Failed to sync purchase to Nostr:", e);
    }
  },

  listAircraft: async (aircraftId: string, price: FixedPoint) => {
    const { fleet, airline } = get();
    if (!airline) throw new Error("No airline loaded.");

    const instance = fleet.find((f) => f.id === aircraftId);
    if (!instance) throw new Error("Aircraft not found.");
    if (instance.status === "enroute")
      throw new Error("Cannot list an aircraft while it is enroute.");

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
      throw new Error(
        `Listing price too high. Maximum allowed is ${fpFormat(maxPrice)} (120% of MSRP).`,
      );
    }

    // 2. Listing Fee: 0.5% non-refundable tax
    const fee = fpScale(price, 0.005);
    if (airline.corporateBalance < fee) {
      throw new Error(`Insufficient funds for the marketplace listing fee (${fpFormat(fee)}).`);
    }

    const updatedBalance = fpSub(airline.corporateBalance, fee);
    const updatedFleet = fleet.map((ac) =>
      ac.id === aircraftId ? { ...ac, listingPrice: price } : ac,
    );

    // Capture original listing price for rollback
    const previousListingPrice = instance.listingPrice ?? null;
    const updatedAirline = { ...airline, corporateBalance: updatedBalance };

    set({
      airline: updatedAirline,
      fleet: updatedFleet,
    });

    try {
      attachSigner();
      ensureConnected();

      // 2. Publish to Marketplace
      await publishUsedAircraft({ ...instance, listingPrice: price }, price);
      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_LIST",
          payload: {
            instanceId: aircraftId,
            price,
            tick: useEngineStore.getState().tick,
          },
        },
        get,
        set,
      });
    } catch (e) {
      set((state) => {
        if (!state.airline) return state;

        // Merge-safe rollback: refund the fee and revert only the listing price
        // on the specific aircraft, preserving concurrent fleet/balance changes.
        return {
          airline: {
            ...state.airline,
            corporateBalance: fpAdd(state.airline.corporateBalance, fee),
          },
          fleet: state.fleet.map((ac) =>
            ac.id === aircraftId ? { ...ac, listingPrice: previousListingPrice } : ac,
          ),
        };
      });
      console.error("Listing failed:", e);
      throw new Error("Failed to publish listing to Nostr.");
    }
  },

  cancelListing: async (aircraftId: string) => {
    const { fleet, airline } = get();
    if (!airline) throw new Error("No airline loaded.");

    const instance = fleet.find((f) => f.id === aircraftId);
    if (!instance) throw new Error("Aircraft not found.");

    const updatedFleet = fleet.map((ac) =>
      ac.id === aircraftId ? { ...ac, listingPrice: null } : ac,
    );

    // Capture original listing price for merge-safe rollback
    const previousListingPrice = instance.listingPrice ?? null;

    set({ fleet: updatedFleet });

    try {
      attachSigner();
      ensureConnected();

      // 2. Delete Marketplace Entry
      const ndk = getNDK();
      const deletionEvent = new NDKEvent(ndk);
      deletionEvent.kind = 5;
      deletionEvent.tags = [
        ["a", `${MARKETPLACE_KIND}:${airline.ceoPubkey}:airtr:marketplace:${aircraftId}`],
      ];
      await deletionEvent.publish();
      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_CANCEL_LIST",
          payload: {
            instanceId: aircraftId,
            tick: useEngineStore.getState().tick,
          },
        },
        get,
        set,
      });
    } catch (e) {
      // Merge-safe rollback: restore only the listing price on the specific
      // aircraft, preserving concurrent fleet mutations.
      set((state) => ({
        fleet: state.fleet.map((ac) =>
          ac.id === aircraftId ? { ...ac, listingPrice: previousListingPrice } : ac,
        ),
      }));
      console.error("Cancellation failed:", e);
      throw new Error("Failed to remove listing from Nostr.");
    }
  },

  performMaintenance: async (aircraftId: string) => {
    const { fleet, airline } = get();
    if (!airline) throw new Error("No airline loaded.");

    const instanceIndex = fleet.findIndex((f) => f.id === aircraftId);
    if (instanceIndex === -1) throw new Error("Aircraft not found.");
    const instance = fleet[instanceIndex];

    if (instance.status === "enroute") {
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
      status: "maintenance",
      maintenanceStartTick: useEngineStore.getState().tick,
      turnaroundEndTick: useEngineStore.getState().tick + (6 * 60) / 10, // 6 hour downtime
    };

    const updatedAirline = {
      ...airline,
      corporateBalance: fpSub(airline.corporateBalance, totalCost),
    };

    const currentTimeline = [...get().timeline];
    const currentTick = useEngineStore.getState().tick;
    const simulatedTimestamp = GENESIS_TIME + currentTick * TICK_DURATION;

    const newEvent: TimelineEvent = {
      id: `evt-maint-${aircraftId}-${currentTick}`,
      tick: currentTick,
      timestamp: simulatedTimestamp,
      type: "maintenance",
      aircraftId,
      aircraftName: instance.name,
      cost: totalCost,
      description: `Performed heavy maintenance (D-Check) on ${instance.name}. Cost: ${fpFormat(totalCost, 0)}. Condition restored to 100%.`,
    };

    const finalTimeline = [newEvent, ...currentTimeline].slice(0, 1000);

    // Capture pre-maintenance aircraft fields for merge-safe rollback
    const previousCondition = instance.condition;
    const previousFlightHoursSinceCheck = instance.flightHoursSinceCheck;
    const previousStatus = instance.status;
    const previousMaintenanceStartTick = instance.maintenanceStartTick;
    const previousTurnaroundEndTick = instance.turnaroundEndTick;

    set({
      airline: { ...updatedAirline, timeline: finalTimeline },
      fleet: updatedFleet,
      timeline: finalTimeline,
    });

    try {
      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_MAINTENANCE",
          payload: {
            instanceId: aircraftId,
            cost: totalCost,
            tick: currentTick,
          },
        },
        get,
        set,
      });
    } catch (e) {
      set((state) => {
        if (!state.airline) return state;

        // Merge-safe rollback: restore only the maintained aircraft's fields
        // and refund the cost, preserving concurrent fleet/balance changes.
        return {
          airline: {
            ...state.airline,
            corporateBalance: fpAdd(state.airline.corporateBalance, totalCost),
          },
          fleet: state.fleet.map((ac) =>
            ac.id === aircraftId
              ? {
                  ...ac,
                  condition: previousCondition,
                  flightHoursSinceCheck: previousFlightHoursSinceCheck,
                  status: previousStatus,
                  maintenanceStartTick: previousMaintenanceStartTick,
                  turnaroundEndTick: previousTurnaroundEndTick,
                }
              : ac,
          ),
          timeline: state.timeline.filter((evt) => evt.id !== newEvent.id),
        };
      });
      console.error("Maintenance sync failed:", e);
    }
  },

  updateAircraftLivery: async (aircraftId: string, imageUrl: string, promptHash: string) => {
    const { fleet } = get();
    const idx = fleet.findIndex((f) => f.id === aircraftId);
    if (idx === -1) return;
    const previousLiveryImageUrl = fleet[idx].liveryImageUrl;
    const previousLiveryPromptHash = fleet[idx].liveryPromptHash;

    const updatedFleet = [...fleet];
    updatedFleet[idx] = {
      ...fleet[idx],
      liveryImageUrl: imageUrl,
      liveryPromptHash: promptHash,
    };
    set({ fleet: updatedFleet });

    try {
      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: "AIRCRAFT_UPDATE_LIVERY",
          payload: {
            instanceId: aircraftId,
            imageUrl,
            promptHash,
            tick: useEngineStore.getState().tick,
          },
        },
        get,
        set,
      });
    } catch (e) {
      set((state) => ({
        fleet: state.fleet.map((ac) =>
          ac.id === aircraftId &&
          ac.liveryImageUrl === imageUrl &&
          ac.liveryPromptHash === promptHash
            ? {
                ...ac,
                liveryImageUrl: previousLiveryImageUrl,
                liveryPromptHash: previousLiveryPromptHash,
              }
            : ac,
        ),
      }));
      console.warn("Failed to sync livery update to Nostr action chain:", e);
    }
  },
});
