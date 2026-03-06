import type { AircraftInstance, AirlineEntity, Route } from "@acars/core";

export const getAircraftBaseHub = (
  aircraft: AircraftInstance,
  routes: Route[],
  airline: AirlineEntity | null,
): string => {
  const assignedRoute = aircraft.assignedRouteId
    ? routes.find((route) => route.id === aircraft.assignedRouteId)
    : null;

  return assignedRoute?.originIata ?? aircraft.baseAirportIata ?? airline?.hubs[0];
};
