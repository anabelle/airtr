import type { Airport } from "@acars/core";
import { airports as AIRPORTS } from "@acars/data";
import { useEngineStore } from "@acars/store";
import { useCallback } from "react";

const airportByIata = new Map<string, Airport>(AIRPORTS.map((a) => [a.iata, a]));
const DETAIL_PATH_PREFIXES = ["/airport/", "/aircraft/"];

type DetailSearchParams = Record<string, string | undefined>;
type NavigationOptions = {
  replace?: boolean;
};

function dispatchNavigation(path: string, options?: NavigationOptions) {
  const method = options?.replace ? "replaceState" : "pushState";
  window.history[method](null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function normalizeReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith("/")) {
    return null;
  }

  return value;
}

function deriveReturnTo() {
  const currentUrl = new URL(window.location.href);
  const existingReturnTo = normalizeReturnTo(currentUrl.searchParams.get("returnTo"));

  if (existingReturnTo) {
    return existingReturnTo;
  }

  if (DETAIL_PATH_PREFIXES.some((prefix) => currentUrl.pathname.startsWith(prefix))) {
    return null;
  }

  const currentPath = `${currentUrl.pathname}${currentUrl.search}`;
  return currentPath === "/" ? null : currentPath;
}

function buildDetailPath(pathname: string, searchParams?: DetailSearchParams) {
  const nextUrl = new URL(pathname, window.location.origin);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (!value) {
        continue;
      }
      nextUrl.searchParams.set(key, value);
    }
  }

  const returnTo = deriveReturnTo();
  if (returnTo) {
    nextUrl.searchParams.set("returnTo", returnTo);
  }

  return `${nextUrl.pathname}${nextUrl.search}`;
}

export function getDetailReturnTo(): string {
  return normalizeReturnTo(new URL(window.location.href).searchParams.get("returnTo")) ?? "/";
}

export function navigateToPath(path: string, options?: NavigationOptions): void {
  dispatchNavigation(path, options);
}

/**
 * Navigate to an airport permalink, focusing the map and opening the info panel.
 * Can be called from any component — no prop drilling needed.
 * @param searchParams - optional URL search params (e.g. { airportTab: "flights" })
 */
export function navigateToAirport(iata: string, searchParams?: DetailSearchParams): void {
  const normalizedIata = iata.toUpperCase();
  const airport = airportByIata.get(normalizedIata);
  if (!airport) return;

  useEngineStore.getState().setPermalinkAirport(normalizedIata);
  dispatchNavigation(buildDetailPath(`/airport/${normalizedIata}`, searchParams));
}

/**
 * Navigate to an aircraft permalink, opening its info panel.
 * Can be called from any component — no prop drilling needed.
 */
export function navigateToAircraft(id: string, searchParams?: DetailSearchParams): void {
  useEngineStore.getState().setPermalinkAircraft(id);
  dispatchNavigation(buildDetailPath(`/aircraft/${encodeURIComponent(id)}`, searchParams));
}

/**
 * React hook that returns stable navigate functions for use in event handlers.
 */
export function usePermalinkNavigation() {
  const goToAirport = useCallback((iata: string) => navigateToAirport(iata), []);
  const goToAircraft = useCallback((id: string) => navigateToAircraft(id), []);
  return { goToAirport, goToAircraft };
}
