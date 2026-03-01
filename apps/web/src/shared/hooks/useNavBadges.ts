import { useAirlineStore } from "@acars/store";
import { useMemo } from "react";

export interface NavBadges {
  fleetTotal: number;
  fleetUnassigned: number;
  networkTotal: number;
  networkUnassigned: number;
  /** 1-based rank position by corporate balance; 0 if unknown */
  leaderboardRank: number;
}

/**
 * Derives badge counts for nav items from the airline store.
 * All computations are O(N) on already-loaded arrays — safe for large fleets.
 * Returns all zeros when no airline is loaded.
 */
export function useNavBadges(): NavBadges {
  const airline = useAirlineStore((s) => s.airline);
  const fleet = useAirlineStore((s) => s.fleet);
  const routes = useAirlineStore((s) => s.routes);
  const competitors = useAirlineStore((s) => s.competitors);

  const fleetTotal = airline ? fleet.length : 0;

  const fleetUnassigned = useMemo(() => {
    if (!airline) return 0;
    return fleet.filter((ac) => ac.status === "idle" && ac.assignedRouteId === null).length;
  }, [fleet, airline]);

  const networkTotal = airline ? routes.length : 0;

  const networkUnassigned = useMemo(() => {
    if (!airline) return 0;
    return routes.filter((r) => r.status === "active" && r.assignedAircraftIds.length === 0).length;
  }, [routes, airline]);

  const leaderboardRank = useMemo(() => {
    if (!airline) return 0;
    const allAirlines = [...Array.from(competitors.values()), airline];
    const sorted = allAirlines.slice().sort((a, b) => b.corporateBalance - a.corporateBalance);
    const idx = sorted.findIndex((a) => a.id === airline.id);
    return idx === -1 ? 0 : idx + 1;
  }, [airline, competitors]);

  return { fleetTotal, fleetUnassigned, networkTotal, networkUnassigned, leaderboardRank };
}
