import type { AircraftInstance, FixedPoint, Route, TimelineEvent } from "@acars/core";
import {
  fp,
  fpAdd,
  fpFormat,
  fpScale,
  fpSub,
  GENESIS_TIME,
  getSuggestedFares,
  ROUTE_SLOT_FEE,
  TICK_DURATION,
} from "@acars/core";
import { airports, getAircraftById, getHubPricingForIata, HUB_CLASSIFICATIONS } from "@acars/data";

/** Module-level O(1) airport lookup */
const airportMap = new Map(airports.map((a) => [a.iata, a]));
import type { StateCreator } from "zustand";
import { publishActionWithChain } from "../actionChain";
import { useEngineStore } from "../engine";
import type { AirlineState } from "../types";

export type HubAction =
  | { type: "add"; iata: string }
  | { type: "switch"; iata: string }
  | { type: "remove"; iata: string };

export interface NetworkSlice {
  routes: Route[];
  modifyHubs: (action: HubAction) => Promise<void>;
  /** @deprecated Use modifyHubs instead */
  updateHub: (newHubIata: string) => Promise<void>;
  openRoute: (originIata: string, destinationIata: string, distanceKm: number) => Promise<void>;
  rebaseRoute: (routeId: string, newOriginIata: string) => Promise<void>;
  closeRoute: (routeId: string) => Promise<void>;
  assignAircraftToRoute: (aircraftId: string, routeId: string | null) => Promise<void>;
  updateRouteFares: (
    routeId: string,
    fares: { economy?: FixedPoint; business?: FixedPoint; first?: FixedPoint },
  ) => Promise<void>;
}

export const createNetworkSlice: StateCreator<AirlineState, [], [], NetworkSlice> = (set, get) => ({
  routes: [],

  modifyHubs: async (action: HubAction) => {
    const { airline, fleet, routes } = get();
    if (!airline) return;

    const currentHubs = airline.hubs || [];
    let newHubs: string[];
    let description: string;
    let hubFee = fp(0);

    const getHubTierCost = (iata: string) => fp(getHubPricingForIata(iata).openFee);

    switch (action.type) {
      case "add": {
        if (currentHubs.includes(action.iata)) return;
        newHubs = [...currentHubs, action.iata];
        hubFee = getHubTierCost(action.iata);
        description = `Opened new operations hub at ${action.iata}. Hub development fee: ${fpFormat(hubFee, 0)}.`;
        break;
      }
      case "switch": {
        if (currentHubs[0] === action.iata) return; // Already active
        newHubs = [action.iata, ...currentHubs.filter((h) => h !== action.iata)];
        hubFee = fpScale(getHubTierCost(action.iata), 0.25);
        description = `Transferred main operations hub to ${action.iata}. Relocation fee: ${fpFormat(hubFee, 0)}.`;
        break;
      }
      case "remove": {
        if (!currentHubs.includes(action.iata)) return;
        if (currentHubs.length <= 1) return; // Can't remove last hub
        newHubs = currentHubs.filter((h) => h !== action.iata);
        description = `Closed operations hub at ${action.iata}.`;
        break;
      }
    }

    if (hubFee > airline.corporateBalance) {
      throw new Error(`Insufficient funds to modify hub. Required: ${fpFormat(hubFee, 0)}`);
    }

    const currentTimeline = [...get().timeline];
    const currentTick = useEngineStore.getState().tick;
    const simulatedTimestamp = GENESIS_TIME + currentTick * TICK_DURATION;

    const newEvent: TimelineEvent = {
      id: `evt-hub-${action.type}-${action.iata}-${currentTick}`,
      tick: currentTick,
      timestamp: simulatedTimestamp,
      type: "hub_change",
      description,
      cost: hubFee,
    };

    const removedHubs = action.type === "remove" ? new Set([action.iata]) : new Set<string>();

    const updatedRoutes: Route[] =
      removedHubs.size > 0
        ? routes.map((route) => {
            if (route.status !== "active") return route;
            if (!removedHubs.has(route.originIata)) return route;
            return {
              ...route,
              status: "suspended",
              assignedAircraftIds: [],
            };
          })
        : routes;

    const routeEvents: TimelineEvent[] = [];
    if (removedHubs.size > 0) {
      for (const route of routes) {
        if (route.status !== "active") continue;
        if (!removedHubs.has(route.originIata)) continue;
        routeEvents.push({
          id: `evt-route-suspend-${route.id}-${currentTick}`,
          tick: currentTick,
          timestamp: simulatedTimestamp,
          type: "route_change",
          routeId: route.id,
          originIata: route.originIata,
          destinationIata: route.destinationIata,
          description: `Route ${route.originIata} ↔ ${route.destinationIata} suspended after hub closure at ${action.iata}.`,
        });
      }
    }

    const finalTimeline = [newEvent, ...routeEvents, ...currentTimeline].slice(0, 1000);

    const suspendedRouteIds = new Set<string>();
    for (const route of updatedRoutes) {
      if (route.status === "suspended") suspendedRouteIds.add(route.id);
    }

    const routeById = new Map<string, Route>();
    for (const route of routes) {
      routeById.set(route.id, route);
    }

    const updatedFleet =
      removedHubs.size > 0
        ? fleet.map((aircraft) => {
            if (!aircraft.assignedRouteId || !suspendedRouteIds.has(aircraft.assignedRouteId)) {
              return aircraft;
            }

            const assignedRoute = routeById.get(aircraft.assignedRouteId);

            if (aircraft.status === "enroute") {
              return {
                ...aircraft,
                assignedRouteId: null,
                flight:
                  aircraft.flight && assignedRoute
                    ? {
                        ...aircraft.flight,
                        fareEconomy: assignedRoute.fareEconomy,
                        fareBusiness: assignedRoute.fareBusiness,
                        fareFirst: assignedRoute.fareFirst,
                        distanceKm: assignedRoute.distanceKm,
                        frequencyPerWeek: assignedRoute.frequencyPerWeek ?? 7,
                      }
                    : aircraft.flight,
              };
            }

            if (aircraft.status === "turnaround") {
              return {
                ...aircraft,
                assignedRouteId: null,
                status: "idle" as const,
                flight: null,
              };
            }

            return { ...aircraft, assignedRouteId: null };
          })
        : fleet;

    const updatedAirline = {
      ...airline,
      hubs: newHubs,
      corporateBalance: fpSub(airline.corporateBalance, hubFee),
      timeline: finalTimeline,
      routeIds: updatedRoutes.map((route) => route.id),
    };

    // Capture which specific entities were changed for surgical rollback
    const previousAirline = airline;
    const changedRouteIds = new Set<string>();
    const changedAircraftIds = new Set<string>();
    const addedTimelineIds = new Set<string>();

    for (let i = 0; i < updatedRoutes.length; i++) {
      if (updatedRoutes[i] !== routes[i]) changedRouteIds.add(updatedRoutes[i].id);
    }
    for (let i = 0; i < updatedFleet.length; i++) {
      if (updatedFleet[i] !== fleet[i]) changedAircraftIds.add(updatedFleet[i].id);
    }
    addedTimelineIds.add(newEvent.id);
    for (const evt of routeEvents) addedTimelineIds.add(evt.id);

    // Build lookup for previous route/aircraft state
    const previousRouteMap = new Map(routes.map((r) => [r.id, r]));
    const previousAircraftMap = new Map(fleet.map((ac) => [ac.id, ac]));

    set({
      airline: updatedAirline,
      routes: updatedRoutes,
      fleet: updatedFleet,
      timeline: finalTimeline,
    });

    // Atomically sync engine homeAirport to hubs[0]
    const activeIata = newHubs[0];
    const activeAirport = airportMap.get(activeIata);
    if (activeAirport) {
      useEngineStore.getState().setHub(
        activeAirport,
        {
          latitude: activeAirport.latitude,
          longitude: activeAirport.longitude,
          source: "manual",
        },
        `hub ${action.type}`,
      );
    }

    try {
      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action:
            action.type === "add"
              ? "HUB_ADD"
              : action.type === "remove"
                ? "HUB_REMOVE"
                : "HUB_SWITCH",
          payload: {
            iata: action.iata,
            fee: hubFee,
            tick: currentTick,
          },
        },
        get,
        set,
      });
    } catch (error: any) {
      set((state) => {
        // Merge-safe rollback: only revert the specific fields changed by
        // this hub modification, preserving concurrent tick updates.
        const restoredAirline =
          state.airline && previousAirline
            ? {
                ...state.airline,
                hubs: previousAirline.hubs,
                corporateBalance: previousAirline.corporateBalance,
                routeIds: previousAirline.routeIds,
              }
            : previousAirline;

        // Restore only the routes we suspended, leaving other routes as-is
        const restoredRoutes = state.routes.map((rt) => {
          if (changedRouteIds.has(rt.id)) {
            return previousRouteMap.get(rt.id) ?? rt;
          }
          return rt;
        });

        // Restore only the aircraft we unassigned, leaving other aircraft as-is
        const restoredFleet = state.fleet.map((ac) => {
          if (changedAircraftIds.has(ac.id)) {
            return previousAircraftMap.get(ac.id) ?? ac;
          }
          return ac;
        });

        // Remove only the timeline events we added
        const restoredTimeline = state.timeline.filter((evt) => !addedTimelineIds.has(evt.id));

        return {
          airline: restoredAirline,
          fleet: restoredFleet,
          routes: restoredRoutes,
          timeline: restoredTimeline,
        };
      });
      // Roll back engine hub too
      const rollbackIata = previousAirline.hubs[0];
      const rollbackAirport = airportMap.get(rollbackIata);
      if (rollbackAirport) {
        useEngineStore.getState().setHub(
          rollbackAirport,
          {
            latitude: rollbackAirport.latitude,
            longitude: rollbackAirport.longitude,
            source: "manual",
          },
          "hub rollback",
        );
      }
      console.warn("Failed to publish hub change to Nostr:", error);
    }
  },

  // Thin wrapper for backward compat — delegates to modifyHubs
  updateHub: async (targetHubIata: string) => {
    await get().modifyHubs({ type: "switch", iata: targetHubIata });
  },

  rebaseRoute: async (routeId: string, newOriginIata: string) => {
    const { airline, routes, fleet } = get();
    if (!airline) return;
    if (!airline.hubs.includes(newOriginIata)) {
      throw new Error("Selected hub is not in your active hub list.");
    }

    const targetRoute = routes.find((route) => route.id === routeId);
    if (!targetRoute) return;
    if (targetRoute.destinationIata === newOriginIata) {
      throw new Error("Route origin and destination cannot be the same.");
    }
    if (targetRoute.status !== "suspended") {
      throw new Error("Only suspended routes can be rebased.");
    }

    const currentTick = useEngineStore.getState().tick;
    const simulatedTimestamp = GENESIS_TIME + currentTick * TICK_DURATION;
    const currentTimeline = [...get().timeline];

    const updatedRoutes: Route[] = routes.map((route) => {
      if (route.id !== routeId) return route;
      return {
        ...route,
        originIata: newOriginIata,
        status: "active",
        assignedAircraftIds: [],
      };
    });

    const updatedFleet = fleet.map((aircraft) => {
      if (aircraft.assignedRouteId !== routeId) {
        return aircraft;
      }

      if (aircraft.status === "enroute") {
        return {
          ...aircraft,
          assignedRouteId: null,
          flight: aircraft.flight
            ? {
                ...aircraft.flight,
                fareEconomy: targetRoute.fareEconomy,
                fareBusiness: targetRoute.fareBusiness,
                fareFirst: targetRoute.fareFirst,
                distanceKm: targetRoute.distanceKm,
                frequencyPerWeek: targetRoute.frequencyPerWeek ?? 7,
              }
            : aircraft.flight,
        };
      }

      if (aircraft.status === "turnaround") {
        return {
          ...aircraft,
          assignedRouteId: null,
          status: "idle" as const,
          flight: null,
        };
      }

      return { ...aircraft, assignedRouteId: null };
    });

    const newEvent: TimelineEvent = {
      id: `evt-route-rebase-${routeId}-${currentTick}`,
      tick: currentTick,
      timestamp: simulatedTimestamp,
      type: "route_change",
      routeId,
      originIata: newOriginIata,
      destinationIata: targetRoute.destinationIata,
      description: `Route rebased to ${newOriginIata} ↔ ${targetRoute.destinationIata}.`,
    };

    const finalTimeline = [newEvent, ...currentTimeline].slice(0, 1000);
    const updatedAirline = {
      ...airline,
      timeline: finalTimeline,
    };

    // Track which entities were changed for surgical rollback
    const changedRouteId = routeId;
    const changedAircraftIds = new Set<string>();
    const previousRouteState = targetRoute;
    const previousAircraftMap = new Map<string, (typeof fleet)[0]>();

    for (let i = 0; i < updatedFleet.length; i++) {
      if (updatedFleet[i] !== fleet[i]) {
        changedAircraftIds.add(updatedFleet[i].id);
        previousAircraftMap.set(fleet[i].id, fleet[i]);
      }
    }

    set({
      airline: updatedAirline,
      routes: updatedRoutes,
      fleet: updatedFleet,
      timeline: finalTimeline,
    });

    try {
      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: "ROUTE_REBASE",
          payload: {
            routeId,
            originIata: newOriginIata,
            destinationIata: targetRoute.destinationIata,
            tick: currentTick,
          },
        },
        get,
        set,
      });
    } catch (error: any) {
      set((state) => {
        // Merge-safe rollback: only revert the specific route and aircraft
        const restoredRoutes = state.routes.map((rt) => {
          if (rt.id === changedRouteId) return previousRouteState;
          return rt;
        });

        const restoredFleet = state.fleet.map((ac) => {
          if (changedAircraftIds.has(ac.id)) {
            return previousAircraftMap.get(ac.id) ?? ac;
          }
          return ac;
        });

        // Remove only the optimistic rebase timeline event
        const restoredTimeline = state.timeline.filter((evt) => evt.id !== newEvent.id);

        return {
          airline: state.airline ? { ...state.airline, timeline: restoredTimeline } : state.airline,
          fleet: restoredFleet,
          routes: restoredRoutes,
          timeline: restoredTimeline,
        };
      });
      console.warn("Failed to publish route rebase to Nostr:", error);
    }
  },

  closeRoute: async (routeId: string) => {
    const { airline, routes, fleet } = get();
    if (!airline) return;

    const targetRoute = routes.find((route) => route.id === routeId);
    if (!targetRoute) return;

    const currentTick = useEngineStore.getState().tick;
    const simulatedTimestamp = GENESIS_TIME + currentTick * TICK_DURATION;
    const currentTimeline = [...get().timeline];

    const updatedRoutes: Route[] = routes.filter((route) => route.id !== routeId);
    const updatedFleet = fleet.map((aircraft) => {
      if (aircraft.assignedRouteId !== routeId) {
        return aircraft;
      }

      if (aircraft.status === "enroute") {
        return {
          ...aircraft,
          assignedRouteId: null,
          flight: aircraft.flight
            ? {
                ...aircraft.flight,
                fareEconomy: targetRoute.fareEconomy,
                fareBusiness: targetRoute.fareBusiness,
                fareFirst: targetRoute.fareFirst,
                distanceKm: targetRoute.distanceKm,
                frequencyPerWeek: targetRoute.frequencyPerWeek ?? 7,
              }
            : aircraft.flight,
        };
      }

      if (aircraft.status === "turnaround") {
        return {
          ...aircraft,
          assignedRouteId: null,
          status: "idle" as const,
          flight: null,
        };
      }

      return { ...aircraft, assignedRouteId: null };
    });

    const newEvent: TimelineEvent = {
      id: `evt-route-close-${routeId}-${currentTick}`,
      tick: currentTick,
      timestamp: simulatedTimestamp,
      type: "route_change",
      routeId,
      originIata: targetRoute.originIata,
      destinationIata: targetRoute.destinationIata,
      description: `Route closed: ${targetRoute.originIata} ↔ ${targetRoute.destinationIata}.`,
    };

    const finalTimeline = [newEvent, ...currentTimeline].slice(0, 1000);
    const updatedAirline = {
      ...airline,
      timeline: finalTimeline,
      routeIds: updatedRoutes.map((route) => route.id),
    };

    // Track changed aircraft for surgical rollback
    const changedAircraftIds = new Set<string>();
    const previousAircraftMap = new Map<string, (typeof fleet)[0]>();

    for (let i = 0; i < updatedFleet.length; i++) {
      if (updatedFleet[i] !== fleet[i]) {
        changedAircraftIds.add(updatedFleet[i].id);
        previousAircraftMap.set(fleet[i].id, fleet[i]);
      }
    }

    set({
      airline: updatedAirline,
      routes: updatedRoutes,
      fleet: updatedFleet,
      timeline: finalTimeline,
    });

    try {
      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: "ROUTE_CLOSE",
          payload: {
            routeId,
            originIata: targetRoute.originIata,
            destinationIata: targetRoute.destinationIata,
            tick: currentTick,
          },
        },
        get,
        set,
      });
    } catch (error: any) {
      set((state) => {
        // Merge-safe rollback: re-add the closed route, restore affected
        // aircraft, and remove the optimistic timeline event.
        const restoredAirline = state.airline
          ? {
              ...state.airline,
              routeIds: [...state.airline.routeIds, routeId],
            }
          : state.airline;

        // Restore only the aircraft whose assignments we changed
        const restoredFleet = state.fleet.map((ac) => {
          if (changedAircraftIds.has(ac.id)) {
            return previousAircraftMap.get(ac.id) ?? ac;
          }
          return ac;
        });

        // Re-add the removed route
        const restoredRoutes = [...state.routes, targetRoute];

        // Remove only the optimistic close event
        const restoredTimeline = state.timeline.filter((evt) => evt.id !== newEvent.id);

        return {
          airline: restoredAirline
            ? { ...restoredAirline, timeline: restoredTimeline }
            : restoredAirline,
          fleet: restoredFleet,
          routes: restoredRoutes,
          timeline: restoredTimeline,
        };
      });
      console.warn("Failed to publish route closure to Nostr:", error);
    }
  },

  openRoute: async (originIata: string, destinationIata: string, distanceKm: number) => {
    const { airline, routes, pubkey } = get();
    if (!airline || !pubkey) throw new Error("No airline loaded.");

    if (airline.corporateBalance < ROUTE_SLOT_FEE) {
      throw new Error(`Insufficient funds to open route. Cost: ${fpFormat(ROUTE_SLOT_FEE, 0)}`);
    }

    if (
      routes.some(
        (route) => route.originIata === originIata && route.destinationIata === destinationIata,
      )
    ) {
      throw new Error(`Route ${originIata} → ${destinationIata} already exists.`);
    }

    const newWeeklyFrequency = 7;
    const newHourlyFrequency = newWeeklyFrequency / (7 * 24);
    const getHourlyTraffic = (iata: string) =>
      routes.reduce((total, route) => {
        if (route.originIata !== iata && route.destinationIata !== iata) return total;
        const weekly = route.frequencyPerWeek ?? 0;
        return total + weekly / (7 * 24);
      }, 0);

    const originHub = HUB_CLASSIFICATIONS[originIata];
    if (originHub?.slotControlled) {
      const projected = getHourlyTraffic(originIata) + newHourlyFrequency;
      if (projected > originHub.baseCapacityPerHour) {
        throw new Error(
          `Slot capacity exceeded at ${originIata}. Reduce frequency or pick another hub.`,
        );
      }
    }

    const destHub = HUB_CLASSIFICATIONS[destinationIata];
    if (destHub?.slotControlled) {
      const projected = getHourlyTraffic(destinationIata) + newHourlyFrequency;
      if (projected > destHub.baseCapacityPerHour) {
        throw new Error(
          `Slot capacity exceeded at ${destinationIata}. Reduce frequency or pick another hub.`,
        );
      }
    }

    const suggested = getSuggestedFares(distanceKm);

    const newRoute: Route = {
      id: `rt-${Date.now().toString(36)}`,
      originIata,
      destinationIata,
      airlinePubkey: pubkey,
      distanceKm,
      frequencyPerWeek: newWeeklyFrequency,
      assignedAircraftIds: [],
      fareEconomy: suggested.economy,
      fareBusiness: suggested.business,
      fareFirst: suggested.first,
      status: "active",
    };

    const updatedRoutes = [...routes, newRoute];
    const currentTimeline = [...get().timeline];
    const currentTick = useEngineStore.getState().tick;
    const simulatedTimestamp = GENESIS_TIME + currentTick * TICK_DURATION;

    const newEvent: TimelineEvent = {
      id: `evt-route-open-${newRoute.id}`,
      tick: currentTick,
      timestamp: simulatedTimestamp,
      type: "purchase",
      routeId: newRoute.id,
      originIata: originIata,
      destinationIata: destinationIata,
      cost: ROUTE_SLOT_FEE,
      description: `Opened new route: ${originIata} ↔ ${destinationIata}. Slot fee: ${fpFormat(ROUTE_SLOT_FEE, 0)}`,
    };

    const finalTimeline = [newEvent, ...currentTimeline].slice(0, 1000);
    const updatedAirline = {
      ...airline,
      corporateBalance: fpSub(airline.corporateBalance, ROUTE_SLOT_FEE),
      routeIds: [...airline.routeIds, newRoute.id],
      timeline: finalTimeline,
    };

    set({
      airline: updatedAirline,
      routes: updatedRoutes,
      timeline: finalTimeline,
    });

    try {
      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: "ROUTE_OPEN",
          payload: {
            routeId: newRoute.id,
            originIata,
            destinationIata,
            distanceKm,
            fares: {
              economy: suggested.economy,
              business: suggested.business,
              first: suggested.first,
            },
            frequencyPerWeek: newWeeklyFrequency,
            tick: currentTick,
          },
        },
        get,
        set,
      });
    } catch (e) {
      set((state) => {
        if (!state.airline) return state;

        // Merge-safe rollback: remove only the new route, refund slot fee
        return {
          airline: {
            ...state.airline,
            corporateBalance: fpAdd(state.airline.corporateBalance, ROUTE_SLOT_FEE),
            routeIds: state.airline.routeIds.filter((id) => id !== newRoute.id),
          },
          routes: state.routes.filter((rt) => rt.id !== newRoute.id),
          timeline: state.timeline.filter((evt) => evt.id !== newEvent.id),
        };
      });
      console.error("Failed to sync route to Nostr:", e);
    }
  },

  assignAircraftToRoute: async (aircraftId: string, routeId: string | null) => {
    const { fleet, routes, airline } = get();
    if (!airline) return;

    const aircraft = fleet.find((ac) => ac.id === aircraftId);
    const route = routes.find((r) => r.id === routeId);

    if (aircraft && aircraft.status === "enroute" && routeId !== aircraft.assignedRouteId) {
      throw new Error("Cannot change assignment while enroute.");
    }

    if (aircraft && routeId && !airline.hubs.includes(aircraft.baseAirportIata)) {
      throw new Error("Aircraft must be at an active hub to be assigned to a route.");
    }

    if (aircraft && route) {
      const isAtOrigin = aircraft.baseAirportIata === route.originIata;
      const isAtDestination = aircraft.baseAirportIata === route.destinationIata;
      if (!isAtOrigin && !isAtDestination) {
        throw new Error(
          `${aircraft.name} must be at ${route.originIata} or ${route.destinationIata} to assign this route.`,
        );
      }
    }

    if (aircraft && route) {
      const model = getAircraftById(aircraft.modelId);
      if (model && route.distanceKm > (model.rangeKm || 0)) {
        throw new Error(`${aircraft.name} does not have enough range for this route.`);
      }
    }

    const currentTick = useEngineStore.getState().tick;
    const updatedFleet = fleet.map((ac) => {
      if (ac.id !== aircraftId) return ac;

      if (routeId && routeId !== ac.assignedRouteId) {
        const nextAircraft: AircraftInstance = {
          ...ac,
          assignedRouteId: routeId,
          routeAssignedAtTick: currentTick,
          routeAssignedAtIata: ac.baseAirportIata,
        };
        if (nextAircraft.flight && currentTick >= nextAircraft.flight.departureTick) {
          nextAircraft.status = "idle";
          nextAircraft.flight = null;
          nextAircraft.turnaroundEndTick = undefined;
          nextAircraft.arrivalTickProcessed = undefined;
        }
        return nextAircraft;
      }

      return { ...ac, assignedRouteId: routeId };
    });

    const updatedRoutes = routes.map((rt) => {
      const assigned = rt.assignedAircraftIds.filter((id) => id !== aircraftId);
      if (rt.id === routeId) {
        assigned.push(aircraftId);
      }
      return { ...rt, assignedAircraftIds: assigned };
    });

    const currentTimeline = [...get().timeline];
    const simulatedTimestamp = GENESIS_TIME + currentTick * TICK_DURATION;

    const aircraftName = aircraft?.name || "Aircraft";
    const routeName = route ? `${route.originIata}-${route.destinationIata}` : "None";

    const newEvent: TimelineEvent = {
      id: `evt-assign-${aircraftId}-${currentTick}`,
      tick: currentTick,
      timestamp: simulatedTimestamp,
      type: "maintenance",
      aircraftId,
      aircraftName,
      routeId: routeId || undefined,
      description: routeId
        ? `Assigned ${aircraftName} to route ${routeName}.`
        : `Unassigned ${aircraftName} from all routes.`,
    };

    const finalTimeline = [newEvent, ...currentTimeline].slice(0, 1000);
    const updatedAirline = {
      ...airline,
      timeline: finalTimeline,
    };

    // Capture the previous assignment state for surgical rollback
    const previousAircraft = aircraft
      ? {
          assignedRouteId: aircraft.assignedRouteId,
          routeAssignedAtTick: aircraft.routeAssignedAtTick,
          routeAssignedAtIata: aircraft.routeAssignedAtIata,
          status: aircraft.status,
          flight: aircraft.flight,
          turnaroundEndTick: aircraft.turnaroundEndTick,
          arrivalTickProcessed: aircraft.arrivalTickProcessed,
        }
      : null;
    const previousRouteAssignments = new Map(
      routes.map((rt) => [rt.id, [...rt.assignedAircraftIds]]),
    );

    set({
      airline: updatedAirline,
      fleet: updatedFleet,
      routes: updatedRoutes,
      timeline: finalTimeline,
    });

    try {
      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: routeId ? "ROUTE_ASSIGN_AIRCRAFT" : "ROUTE_UNASSIGN_AIRCRAFT",
          payload: {
            aircraftId,
            routeId,
            tick: currentTick,
          },
        },
        get,
        set,
      });
    } catch (e) {
      set((state) => {
        // Merge-safe rollback: only revert the specific aircraft assignment state
        // and route assignedAircraftIds, preserving concurrent updates.
        const restoredFleet = state.fleet.map((ac) => {
          if (ac.id === aircraftId && previousAircraft) {
            return {
              ...ac,
              assignedRouteId: previousAircraft.assignedRouteId,
              routeAssignedAtTick: previousAircraft.routeAssignedAtTick,
              routeAssignedAtIata: previousAircraft.routeAssignedAtIata,
              status: previousAircraft.status,
              flight: previousAircraft.flight,
              turnaroundEndTick: previousAircraft.turnaroundEndTick,
              arrivalTickProcessed: previousAircraft.arrivalTickProcessed,
            };
          }
          return ac;
        });

        const restoredRoutes = state.routes.map((rt) => {
          const prevAssigned = previousRouteAssignments.get(rt.id);
          if (prevAssigned) {
            return { ...rt, assignedAircraftIds: prevAssigned };
          }
          return rt;
        });

        // Remove only the optimistic assignment timeline event
        const restoredTimeline = state.timeline.filter((evt) => evt.id !== newEvent.id);

        return {
          airline: state.airline ? { ...state.airline, timeline: restoredTimeline } : state.airline,
          fleet: restoredFleet,
          routes: restoredRoutes,
          timeline: restoredTimeline,
        };
      });
      console.error("Failed to sync assignment to Nostr:", e);
    }
  },

  updateRouteFares: async (
    routeId: string,
    fares: { economy?: FixedPoint; business?: FixedPoint; first?: FixedPoint },
  ) => {
    const { routes, airline } = get();
    if (!airline) return;

    const updatedRoutes = routes.map((rt) => {
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
      timeline: currentTimeline,
    };

    // Capture previous fares for merge-safe rollback
    const targetRoute = routes.find((rt) => rt.id === routeId);
    const previousFares = targetRoute
      ? {
          fareEconomy: targetRoute.fareEconomy,
          fareBusiness: targetRoute.fareBusiness,
          fareFirst: targetRoute.fareFirst,
        }
      : null;

    set({ routes: updatedRoutes, airline: updatedAirline });

    try {
      await publishActionWithChain({
        action: {
          schemaVersion: 2,
          action: "ROUTE_UPDATE_FARES",
          payload: {
            routeId,
            fares,
            tick: useEngineStore.getState().tick,
          },
        },
        get,
        set,
      });
    } catch (e) {
      // Merge-safe rollback: restore only the fares on the specific route
      set((state) => ({
        routes: state.routes.map((rt) =>
          rt.id === routeId && previousFares ? { ...rt, ...previousFares } : rt,
        ),
      }));
      console.error("Failed to sync fares to Nostr:", e);
    }
  },
});
