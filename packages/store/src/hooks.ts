import type { AircraftInstance, AirlineEntity, Route, TimelineEvent } from "@acars/core";
import { useAirlineStore } from "./airline.js";

const EMPTY_FLEET: AircraftInstance[] = [];
const EMPTY_ROUTES: Route[] = [];
const EMPTY_TIMELINE: TimelineEvent[] = [];

export type ActiveAirlineView = {
  airline: AirlineEntity | null;
  fleet: AircraftInstance[];
  routes: Route[];
  timeline: TimelineEvent[];
  isViewingOther: boolean;
  isGuest: boolean;
};

export function useActiveAirline(): ActiveAirlineView {
  const viewedPubkey = useAirlineStore((state) => state.viewedPubkey);
  const pubkey = useAirlineStore((state) => state.pubkey);
  const airline = useAirlineStore((state) => state.airline);
  const fleet = useAirlineStore((state) => state.fleet);
  const routes = useAirlineStore((state) => state.routes);
  const timeline = useAirlineStore((state) => state.timeline);
  const competitors = useAirlineStore((state) => state.competitors);
  const fleetByOwner = useAirlineStore((state) => state.fleetByOwner);
  const routesByOwner = useAirlineStore((state) => state.routesByOwner);

  if (!viewedPubkey) {
    return {
      airline,
      fleet,
      routes,
      timeline,
      isViewingOther: false,
      isGuest: !airline,
    };
  }

  // When viewing our own airline via viewAs, use canonical player state
  if (viewedPubkey === pubkey) {
    return {
      airline,
      fleet,
      routes,
      timeline,
      isViewingOther: false,
      isGuest: !airline,
    };
  }

  return {
    airline: competitors.get(viewedPubkey) ?? null,
    fleet: fleetByOwner.get(viewedPubkey) ?? EMPTY_FLEET,
    routes: routesByOwner.get(viewedPubkey) ?? EMPTY_ROUTES,
    timeline: EMPTY_TIMELINE,
    isViewingOther: true,
    isGuest: !airline,
  };
}
