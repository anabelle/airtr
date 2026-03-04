import type { Airport } from "@acars/core";
import { airports as AIRPORTS } from "@acars/data";
import { useEngineStore } from "@acars/store";
import { useCallback } from "react";

const airportByIata = new Map<string, Airport>(AIRPORTS.map((a) => [a.iata, a]));

/**
 * Navigate to an airport permalink, focusing the map and opening the info panel.
 * Can be called from any component — no prop drilling needed.
 * @param searchParams - optional URL search params (e.g. { airportTab: "flights" })
 */
export function navigateToAirport(iata: string, searchParams?: Record<string, string>): void {
    const airport = airportByIata.get(iata.toUpperCase());
    if (!airport) return;
    useEngineStore.getState().setPermalinkAirport(iata.toUpperCase());
    const qs = searchParams ? `?${new URLSearchParams(searchParams).toString()}` : "";
    window.history.replaceState(null, "", `/airport/${iata.toUpperCase()}${qs}`);
}

/**
 * Navigate to an aircraft permalink, opening its info panel.
 * Can be called from any component — no prop drilling needed.
 */
export function navigateToAircraft(id: string): void {
    useEngineStore.getState().setPermalinkAircraft(id);
    window.history.replaceState(null, "", `/aircraft/${id}`);
}

/**
 * React hook that returns stable navigate functions for use in event handlers.
 */
export function usePermalinkNavigation() {
    const goToAirport = useCallback((iata: string) => navigateToAirport(iata), []);
    const goToAircraft = useCallback((id: string) => navigateToAircraft(id), []);
    return { goToAirport, goToAircraft };
}
