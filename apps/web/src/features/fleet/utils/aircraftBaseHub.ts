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

  return assignedRoute?.originIata ?? baseIata ?? airline?.hubs[0] ?? "";
};
