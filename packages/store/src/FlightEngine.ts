import type {
    AircraftInstance,
    Route,
    FixedPoint,
    TimelineEvent,
    FlightOffer,
} from '@airtr/core';
import {
    fpAdd,
    fpSub,
    fpToNumber,
    calculateFlightRevenue,
    calculateFlightCost,
    calculateHubLandingFee,
    TICKS_PER_HOUR,
    GENESIS_TIME,
    TICK_DURATION,
    calculateDemand,
    getSeason,
    getProsperityIndex,
    allocatePassengers,
    detectPriceWar,
    getHubDemandModifier,
    fp
} from '@airtr/core';
import { getAircraftById, airports, HUB_CLASSIFICATIONS } from '@airtr/data';

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
    lastTick: number = tick - 1,
    globalRouteRegistry: Map<string, FlightOffer[]> = new Map(),
    playerPubkey: string = '',
    playerBrandScore: number = 0.5
): EngineTickResult {
    let hasChanges = false;
    let corporateBalance = initialBalance;
    const events: TimelineEvent[] = [];
    const simulatedTimestamp = GENESIS_TIME + (tick * TICK_DURATION);

    const updatedFleetMap = new Map<string, AircraftInstance>(
        fleet.map(ac => [ac.id, { ...ac }])
    );

    const airportTraffic = new Map<string, number>();
    const hubStats = new Map<string, { spokeCount: number; weeklyFrequency: number }>();

    for (const route of routes) {
        const weekly = route.frequencyPerWeek ?? 0;
        const hourly = weekly / (7 * 24);
        if (hourly > 0) {
            airportTraffic.set(route.originIata, (airportTraffic.get(route.originIata) ?? 0) + hourly);
            airportTraffic.set(route.destinationIata, (airportTraffic.get(route.destinationIata) ?? 0) + hourly);
        }

        if (route.originIata) {
            const current = hubStats.get(route.originIata) ?? { spokeCount: 0, weeklyFrequency: 0 };
            current.spokeCount += 1;
            current.weeklyFrequency += weekly;
            hubStats.set(route.originIata, current);
        }
    }

    const hubStates = new Map<string, { hubIata: string; spokeCount: number; weeklyFrequency: number; avgFrequency: number }>();
    for (const [hubIata, stats] of hubStats.entries()) {
        hubStates.set(hubIata, {
            hubIata,
            spokeCount: stats.spokeCount,
            weeklyFrequency: stats.weeklyFrequency,
            avgFrequency: stats.spokeCount > 0 ? stats.weeklyFrequency / stats.spokeCount : 0,
        });
    }


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
                // SAFETY GROUNDING CHECK
                const isGrounded = ac.condition < 0.2 || ac.flightHoursSinceCheck > 600;

                if (isGrounded) {
                    // Logic: If maintenance is ignored, the plane sits idle 
                    // and generates a warning event once per day (roughly)
                    if (tick % (TICKS_PER_HOUR * 24) === 0) {
                        events.push({
                            id: `evt-grounded-${ac.id}-${tick}`,
                            tick,
                            timestamp: simulatedTimestamp,
                            type: 'maintenance',
                            aircraftId: ac.id,
                            aircraftName: ac.name,
                            description: `[SAFETY ALERT] ${ac.name} is GROUNDED. Condition: ${Math.round(ac.condition * 100)}%. Hours since check: ${Math.round(ac.flightHoursSinceCheck)}. Maintenance required!`
                        });
                    }
                    continue; // Do not take off
                }

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

                let weeklyDemandResult = { economy: 350, business: 35, first: 7, origin: route.originIata, destination: route.destinationIata };

                if (origin && destination) {
                    const now = new Date(simulatedTimestamp);
                    const season = getSeason(destination.latitude, now);
                    const prosperity = getProsperityIndex(tick);

                    const originHub = HUB_CLASSIFICATIONS[route.originIata] ?? null;
                    const destHub = HUB_CLASSIFICATIONS[route.destinationIata] ?? null;
                    const originState = originHub ? hubStates.get(route.originIata) ?? null : null;
                    const destState = destHub ? hubStates.get(route.destinationIata) ?? null : null;
                    const hubModifier = getHubDemandModifier(
                        originHub?.tier ?? null,
                        destHub?.tier ?? null,
                        originState,
                        destState,
                    );
                    const weeklyDemand = calculateDemand(origin, destination, season, prosperity, hubModifier);
                    weeklyDemandResult = {
                        origin: route.originIata,
                        destination: route.destinationIata,
                        economy: weeklyDemand.economy,
                        business: weeklyDemand.business,
                        first: weeklyDemand.first,
                    };
                }

                // --- NEW MP ALLOCATION LOGIC ---
                const routeKey = `${route.originIata}-${route.destinationIata}`;
                const competitorOffers = globalRouteRegistry.get(routeKey) || [];

                // Frequency for our offer: how many planes we (the player) have on this route?
                const ourFrequency = Math.max(1, route.assignedAircraftIds.length * 7);

                // Travel time for our current aircraft
                const ourTravelTime = Math.round((route.distanceKm / (model.speedKmh || 800)) * 60);

                const ourOffer: FlightOffer = {
                    airlinePubkey: playerPubkey,
                    fareEconomy: route.fareEconomy,
                    fareBusiness: route.fareBusiness,
                    fareFirst: route.fareFirst,
                    frequencyPerWeek: ourFrequency,
                    travelTimeMinutes: ourTravelTime,
                    stops: 0,
                    serviceScore: 0.7,
                    brandScore: playerBrandScore,
                };

                const allOffers = [ourOffer, ...competitorOffers];

                // --- PRICE WAR DYNAMICS ---
                const pw = detectPriceWar(allOffers);
                if (pw.isPriceWar) {
                    // Stimulation: Increase route demand by 10%
                    weeklyDemandResult.economy = Math.floor(weeklyDemandResult.economy * 1.1);
                    weeklyDemandResult.business = Math.floor(weeklyDemandResult.business * 1.1);
                    weeklyDemandResult.first = Math.floor(weeklyDemandResult.first * 1.1);

                    // If we are undercutting, trigger a brand damage event
                    if (pw.lowPricedAirlines.includes(playerPubkey)) {
                        events.push({
                            id: `evt-pricewar-${ac.id}-${tick}`,
                            tick,
                            timestamp: simulatedTimestamp,
                            type: 'price_war',
                            aircraftId: ac.id,
                            aircraftName: ac.name,
                            description: `[PRICE WAR] Extreme undercutting on ${route.originIata}-${route.destinationIata} is damaging your brand reputation.`
                        });
                    }
                }

                const allocations = allocatePassengers(allOffers, weeklyDemandResult);
                const ourWeeklyAllocation = allocations.get(playerPubkey) || { economy: 0, business: 0, first: 0 };

                // Per-flight allocation (Weekly allocation / frequency)
                const paxE = Math.min(model.capacity.economy, Math.floor(ourWeeklyAllocation.economy / ourFrequency));
                const paxB = Math.min(model.capacity.business, Math.floor(ourWeeklyAllocation.business / ourFrequency));
                const paxF = Math.min(model.capacity.first, Math.floor(ourWeeklyAllocation.first / ourFrequency));
                // --- END NEW MP ALLOCATION ---

                const rev = calculateFlightRevenue({
                    passengersEconomy: paxE,
                    passengersBusiness: paxB,
                    passengersFirst: paxF,
                    fareEconomy: route.fareEconomy,
                    fareBusiness: route.fareBusiness,
                    fareFirst: route.fareFirst,
                    seatsOffered: model.capacity.economy + model.capacity.business + model.capacity.first
                });

                const originHub = HUB_CLASSIFICATIONS[route.originIata];
                const destHub = HUB_CLASSIFICATIONS[route.destinationIata];
                const originTraffic = airportTraffic.get(route.originIata) ?? 0;
                const destTraffic = airportTraffic.get(route.destinationIata) ?? 0;
                const originBaseFee = originHub ? fp(originHub.baseLandingFee) : fp(250);
                const destBaseFee = destHub ? fp(destHub.baseLandingFee) : fp(250);
                const originCapacity = originHub?.baseCapacityPerHour ?? 80;
                const destCapacity = destHub?.baseCapacityPerHour ?? 80;
                const originFee = calculateHubLandingFee(originBaseFee, originCapacity, originTraffic);
                const destFee = calculateHubLandingFee(destBaseFee, destCapacity, destTraffic);
                const avgFee = (fpToNumber(originFee) + fpToNumber(destFee)) / 2;
                const airportFeesMultiplier = avgFee / 250;

                const cost = calculateFlightCost({
                    distanceKm: route.distanceKm,
                    aircraft: model,
                    actualPassengers: rev.actualPassengers,
                    blockHours: (ac.flight.arrivalTick - ac.flight.departureTick) / TICKS_PER_HOUR,
                    airportFeesMultiplier
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
                ac.baseAirportIata = ac.flight.destinationIata;
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
                    description: `${ac.name} landed at ${ac.flight?.destinationIata}. Net Profit: ${profit > 0 ? '+' : ''}${fpToNumber(profit)}`,
                    details: {
                        passengers: {
                            economy: rev.actualEconomy,
                            business: rev.actualBusiness,
                            first: rev.actualFirst,
                            total: rev.actualPassengers,
                        },
                        seatsOffered: rev.seatsOffered,
                        loadFactor: rev.loadFactor,
                        spilledPassengers: rev.spilledPassengers,
                        flightDurationTicks: ac.flight.arrivalTick - ac.flight.departureTick,
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
