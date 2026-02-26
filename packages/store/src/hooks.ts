import type { AircraftInstance, AirlineEntity, Route, TimelineEvent } from "@airtr/core";
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
  const airline = useAirlineStore((state) => state.airline);
  const fleet = useAirlineStore((state) => state.fleet);
  const routes = useAirlineStore((state) => state.routes);
  const timeline = useAirlineStore((state) => state.timeline);
  const competitors = useAirlineStore((state) => state.competitors);
  const globalFleetByOwner = useAirlineStore((state) => state.globalFleetByOwner);
  const globalRoutesByOwner = useAirlineStore((state) => state.globalRoutesByOwner);

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

  return {
    airline: competitors.get(viewedPubkey) ?? null,
    fleet: globalFleetByOwner.get(viewedPubkey) ?? EMPTY_FLEET,
    routes: globalRoutesByOwner.get(viewedPubkey) ?? EMPTY_ROUTES,
    timeline: EMPTY_TIMELINE,
    isViewingOther: true,
    isGuest: !airline,
  };
}
