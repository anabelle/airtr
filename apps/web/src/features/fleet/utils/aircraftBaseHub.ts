import type { AirlineEntity, AircraftInstance, Route } from '@airtr/core';

export const getAircraftBaseHub = (
    aircraft: AircraftInstance,
    routes: Route[],
    airline: AirlineEntity | null,
): string => {
    const assignedRoute = aircraft.assignedRouteId
        ? routes.find(route => route.id === aircraft.assignedRouteId)
        : null;

    return assignedRoute?.originIata ?? airline?.hubs[0] ?? aircraft.baseAirportIata;
};
