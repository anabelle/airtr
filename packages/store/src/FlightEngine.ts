import {
    AircraftInstance,
    Route,
    fpAdd,
    fpSub,
    calculateFlightRevenue,
    calculateFlightCost,
    TICKS_PER_HOUR,
    FixedPoint
} from '@airtr/core';
import { getAircraftById } from '@airtr/data';

/**
 * Result of the engine processing a single tick.
 */
export interface EngineTickResult {
    updatedFleet: AircraftInstance[];
    corporateBalance: FixedPoint;
    hasChanges: boolean;
}

/**
 * PURE ENGINE LOGIC
 * Separated from Zustand/Nostr to allow for headless simulation,
 * future worker-offloading, and easier testing.
 */
export function processFlightEngine(
    tick: number,
    fleet: AircraftInstance[],
    routes: Route[],
    initialBalance: FixedPoint,
    lastTick: number = tick - 1
): EngineTickResult {
    let hasChanges = false;
    let corporateBalance = initialBalance;
    const updatedFleetMap = new Map<string, AircraftInstance>(
        fleet.map(ac => [ac.id, { ...ac }])
    );


    // 1. Process each aircraft
    for (const ac of updatedFleetMap.values()) {
        // Optimization: Already processed this tick?
        if (ac.lastTickProcessed === tick) continue;
        ac.lastTickProcessed = tick;

        // Handle Delivery
        if (ac.status === 'delivery') {
            if (ac.deliveryAtTick !== undefined && tick >= ac.deliveryAtTick) {
                ac.status = 'idle';
                hasChanges = true;
            }
            continue;
        }

        // Handle Maintenance (Placeholders for now)
        if (ac.status === 'maintenance') continue;

        const model = getAircraftById(ac.modelId);
        if (!model) continue;

        // --- FLIGHT STATE MACHINE ---

        // State: IDLE -> Start Flight if assigned
        if (ac.status === 'idle' && ac.assignedRouteId) {
            const route = routes.find(r => r.id === ac.assignedRouteId);
            if (route && route.status === 'active') {
                // Safety check for range
                if (route.distanceKm > (model.rangeKm || 0)) {
                    continue;
                }

                // Real-world duration calculation
                const hours = route.distanceKm / (model.speedKmh || 800);
                const durationTicks = Math.ceil(hours * TICKS_PER_HOUR);

                ac.status = 'enroute';
                ac.flight = {
                    originIata: route.originIata,
                    destinationIata: route.destinationIata,
                    departureTick: tick,
                    arrivalTick: tick + Math.max(1, durationTicks),
                    direction: 'outbound'
                };
                hasChanges = true;
            }
        }

        // State: ENROUTE -> Land if time reached
        else if (ac.status === 'enroute' && ac.flight && tick >= ac.flight.arrivalTick) {
            // Guard: Don't land multiple times on the same arrival tick if somehow re-processed
            if (ac.arrivalTickProcessed === ac.flight.arrivalTick) {
                continue;
            }

            const route = routes.find(r => r.id === ac.assignedRouteId);
            if (route) {
                // LANDING & REVENUE PROCESSING
                const dailyDemand = 500; // Placeholder
                const captureRate = 0.85;
                const paxE = Math.floor(Math.min(model.capacity.economy, dailyDemand * 0.8) * captureRate);
                const paxB = Math.floor(Math.min(model.capacity.business, dailyDemand * 0.15) * captureRate);
                const paxF = Math.floor(Math.min(model.capacity.first, dailyDemand * 0.05) * captureRate);

                const rev = calculateFlightRevenue({
                    passengersEconomy: paxE,
                    passengersBusiness: paxB,
                    passengersFirst: paxF,
                    fareEconomy: route.fareEconomy,
                    fareBusiness: route.fareBusiness,
                    fareFirst: route.fareFirst,
                    seatsOffered: model.capacity.economy + model.capacity.business + model.capacity.first
                });

                const cost = calculateFlightCost({
                    distanceKm: route.distanceKm,
                    aircraft: model,
                    actualPassengers: rev.actualPassengers,
                    blockHours: (ac.flight.arrivalTick - ac.flight.departureTick) / TICKS_PER_HOUR
                });

                const profit = fpSub(rev.revenueTotal, cost.costTotal);
                corporateBalance = fpAdd(corporateBalance, profit);

                // Wear and Tear
                const durationTicks = (ac.flight.arrivalTick - ac.flight.departureTick);
                const flightHoursData = Math.min(24, durationTicks / TICKS_PER_HOUR); // Sanity cap: no flight > 24h

                ac.flightHoursTotal += flightHoursData;
                ac.flightHoursSinceCheck += flightHoursData;
                // Wear and Tear: 1.0 (100%) -> 0.0 (0%) over 20,000 flight hours (Realistic Mid-Life/D-Check interval)
                ac.condition = Math.max(0, ac.condition - (0.00005 * flightHoursData));

                // Set to Turnaround
                const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
                ac.status = 'turnaround';
                ac.arrivalTickProcessed = ac.flight.arrivalTick; // Mark THIS flight as landed
                ac.turnaroundEndTick = tick + Math.max(1, turnaroundTicks);
                hasChanges = true;
            }
        }

        // State: TURNAROUND -> Return flight
        else if (ac.status === 'turnaround' && tick >= (ac.turnaroundEndTick || 0)) {
            const route = routes.find(r => r.id === ac.assignedRouteId);
            if (route && ac.flight) {
                const hours = route.distanceKm / (model.speedKmh || 800);
                const durationTicks = Math.ceil(hours * TICKS_PER_HOUR);
                const isReturning = ac.flight.direction === 'outbound';

                ac.status = 'enroute';
                ac.flight = {
                    originIata: isReturning ? route.destinationIata : route.originIata,
                    destinationIata: isReturning ? route.originIata : route.destinationIata,
                    departureTick: tick,
                    arrivalTick: tick + Math.max(1, durationTicks),
                    direction: isReturning ? 'inbound' : 'outbound'
                };
                hasChanges = true;
            } else {
                ac.status = 'idle';
                ac.flight = null;
                hasChanges = true;
            }
        }
    }

    // 2. Lease deductions (Robust logic for catch-up)
    const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;
    const MONTH_TICKS = 30 * TICKS_PER_DAY;

    const cyclesPrevious = Math.floor(lastTick / MONTH_TICKS);
    const cyclesCurrent = Math.floor(tick / MONTH_TICKS);

    if (cyclesCurrent > cyclesPrevious) {
        const numCycles = cyclesCurrent - cyclesPrevious;
        for (const ac of updatedFleetMap.values()) {
            if (ac.purchaseType === 'lease') {
                const model = getAircraftById(ac.modelId);
                if (model) {
                    for (let i = 0; i < numCycles; i++) {
                        corporateBalance = fpSub(corporateBalance, model.monthlyLease);
                    }
                    hasChanges = true;
                }
            }
        }
    }

    return {
        updatedFleet: Array.from(updatedFleetMap.values()),
        corporateBalance,
        hasChanges
    };
}
