import {
    AircraftInstance,
    Route,
    fpAdd,
    fpSub,
    calculateFlightRevenue,
    calculateFlightCost,
    TICKS_PER_HOUR,
    FixedPoint,
    TimelineEvent,
    GENESIS_TIME,
    TICK_DURATION,
    calculateDemand,
    getSeason,
    getProsperityIndex
} from '@airtr/core';
import { getAircraftById, airports } from '@airtr/data';

/**
 * Result of the engine processing a single tick.
 */
export interface EngineTickResult {
    updatedFleet: AircraftInstance[];
    corporateBalance: FixedPoint;
    hasChanges: boolean;
    events: TimelineEvent[];
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
    const events: TimelineEvent[] = [];
    const simulatedTimestamp = GENESIS_TIME + (tick * TICK_DURATION);

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
                events.push({
                    id: `evt-delivery-${ac.id}-${tick}`,
                    tick,
                    timestamp: simulatedTimestamp,
                    type: 'delivery',
                    aircraftId: ac.id,
                    aircraftName: ac.name,
                    description: `${ac.name} has been delivered and is ready for operations.`
                });
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

                events.push({
                    id: `evt-takeoff-${ac.id}-${tick}`,
                    tick,
                    timestamp: simulatedTimestamp,
                    type: 'takeoff',
                    aircraftId: ac.id,
                    aircraftName: ac.name,
                    routeId: route.id,
                    originIata: route.originIata,
                    destinationIata: route.destinationIata,
                    description: `${ac.name} taking off: ${route.originIata} → ${route.destinationIata}`
                });
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
                // Realism injection: Actual Market Demand
                const origin = airports.find(a => a.iata === route.originIata);
                const destination = airports.find(a => a.iata === route.destinationIata);

                let demandResult = { economy: 50, business: 5, first: 1 }; // Fallback

                if (origin && destination) {
                    const simulatedTimestamp = GENESIS_TIME + (tick * TICK_DURATION);
                    const now = new Date(simulatedTimestamp);
                    const season = getSeason(destination.latitude, now);
                    const prosperity = getProsperityIndex(tick);

                    const weeklyDemand = calculateDemand(origin, destination, season, prosperity);
                    // Convert weekly to per-flight potential (assuming daily frequency for now, or scaled by some factor)
                    demandResult = {
                        economy: Math.floor(weeklyDemand.economy / 7),
                        business: Math.floor(weeklyDemand.business / 7),
                        first: Math.floor(weeklyDemand.first / 7),
                    };
                }

                // Capture Rate: How much of the demand we actually get
                // 0.85 is a high "monopoly" capture rate. 
                // Later this should be based on competition and QSI.
                const captureRate = 0.85;

                const paxE = Math.floor(Math.min(model.capacity.economy, demandResult.economy) * captureRate);
                const paxB = Math.floor(Math.min(model.capacity.business, demandResult.business) * captureRate);
                const paxF = Math.floor(Math.min(model.capacity.first, demandResult.first) * captureRate);

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

                const landingEvent: TimelineEvent = {
                    id: `evt-landing-${ac.id}-${tick}`,
                    tick,
                    timestamp: simulatedTimestamp,
                    type: 'landing',
                    aircraftId: ac.id,
                    aircraftName: ac.name,
                    routeId: route.id,
                    originIata: route.originIata,
                    destinationIata: route.destinationIata,
                    revenue: rev.revenueTotal,
                    cost: cost.costTotal,
                    profit: profit,
                    description: `${ac.name} landed at ${ac.flight?.destinationIata}. Net Profit: ${profit > 0 ? '+' : ''}${profit / 10000}`,
                    details: {
                        revenue: {
                            tickets: rev.revenueTicket,
                            ancillary: rev.revenueAncillary
                        },
                        costs: {
                            fuel: cost.costFuel,
                            crew: cost.costCrew,
                            maintenance: cost.costMaintenance,
                            airport: cost.costAirport,
                            navigation: cost.costNavigation,
                            leasing: cost.costLeasing,
                            overhead: cost.costOverhead
                        }
                    }
                };
                events.push(landingEvent);
                console.log(`[FlightEngine] Plane ${ac.name} landed. Event generated:`, landingEvent.id);
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

                events.push({
                    id: `evt-takeoff-rtn-${ac.id}-${tick}`,
                    tick,
                    timestamp: simulatedTimestamp,
                    type: 'takeoff',
                    aircraftId: ac.id,
                    aircraftName: ac.name,
                    routeId: route.id,
                    originIata: ac.flight.originIata,
                    destinationIata: ac.flight.destinationIata,
                    description: `${ac.name} returning: ${ac.flight.originIata} → ${ac.flight.destinationIata}`
                });
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
                        events.push({
                            id: `evt-lease-${ac.id}-${tick}-${i}`,
                            tick,
                            timestamp: simulatedTimestamp,
                            type: 'lease_payment',
                            aircraftId: ac.id,
                            aircraftName: ac.name,
                            cost: model.monthlyLease,
                            description: `Monthly lease payment for ${ac.name}`
                        });
                    }
                    hasChanges = true;
                }
            }
        }
    }

    return {
        updatedFleet: Array.from(updatedFleetMap.values()),
        corporateBalance,
        hasChanges,
        events
    };
}
