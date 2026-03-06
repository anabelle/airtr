import type { AircraftInstance, AirlineEntity, Route } from "@acars/core";

export const getAircraftBaseHub = (
  aircraft: AircraftInstance,
  routes: Route[],
  airline: AirlineEntity | null,
): string => {
  const assignedRoute = aircraft.assignedRouteId
    ? routes.find((route) => route.id === aircraft.assignedRouteId)
    : null;

  const baseIata = aircraft.baseAirportIata?.trim();

  const resolvedBase = baseIata && baseIata.length > 0 ? baseIata : (airline?.hubs[0] ?? "");

  return assignedRoute?.originIata ?? resolvedBase;
};
