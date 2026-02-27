import type { AircraftInstance, FixedPoint, FlightOffer, Route, TimelineEvent } from "@acars/core";
import {
  allocatePassengers,
  calculateDemand,
  calculateFlightCost,
  calculateFlightRevenue,
  calculateHubLandingFee,
  calculatePriceElasticity,
  calculateSupplyPressure,
  countLandingsBetween,
  detectPriceWar,
  fp,
  fpAdd,
  fpScale,
  fpSub,
  fpToNumber,
  GENESIS_TIME,
  getCyclePhase,
  getHubCongestionModifier,
  getHubDemandModifier,
  getProsperityIndex,
  getSeason,
  getSuggestedFares,
  NATURAL_LF_CEILING,
  PRICE_ELASTICITY_BUSINESS,
  PRICE_ELASTICITY_ECONOMY,
  PRICE_ELASTICITY_FIRST,
  scaleToAddressableMarket,
  TICK_DURATION,
  TICKS_PER_HOUR,
} from "@acars/core";
import { airports, getAircraftById, HUB_CLASSIFICATIONS } from "@acars/data";

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
  playerPubkey: string = "",
  playerBrandScore: number = 0.5,
): EngineTickResult {
  let hasChanges = false;
  let corporateBalance = initialBalance;
  const events: TimelineEvent[] = [];
  const simulatedTimestamp = GENESIS_TIME + tick * TICK_DURATION;

  const updatedFleetMap = new Map<string, AircraftInstance>(fleet.map((ac) => [ac.id, { ...ac }]));

  const airportTraffic = new Map<string, number>();
  const hubStats = new Map<string, { spokeCount: number; weeklyFrequency: number }>();

  for (const route of routes) {
    const weekly = route.frequencyPerWeek ?? 0;
    const hourly = weekly / (7 * 24);
    if (hourly > 0) {
      airportTraffic.set(route.originIata, (airportTraffic.get(route.originIata) ?? 0) + hourly);
      airportTraffic.set(
        route.destinationIata,
        (airportTraffic.get(route.destinationIata) ?? 0) + hourly,
      );
    }

    if (route.originIata) {
      const current = hubStats.get(route.originIata) ?? {
        spokeCount: 0,
        weeklyFrequency: 0,
      };
      current.spokeCount += 1;
      current.weeklyFrequency += weekly;
      hubStats.set(route.originIata, current);
    }
  }

  const hubStates = new Map<
    string,
    {
      hubIata: string;
      spokeCount: number;
      weeklyFrequency: number;
      avgFrequency: number;
    }
  >();
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
    if (ac.status === "delivery") {
      if (ac.deliveryAtTick !== undefined && tick >= ac.deliveryAtTick) {
        ac.status = "idle";
        hasChanges = true;
        const deliveryTick = ac.deliveryAtTick;
        events.push({
          id: `evt-delivery-${ac.id}-${deliveryTick}`,
          tick: deliveryTick,
          timestamp: GENESIS_TIME + deliveryTick * TICK_DURATION,
          type: "delivery",
          aircraftId: ac.id,
          aircraftName: ac.name,
          description: `${ac.name} has been delivered and is ready for operations.`,
        });
      }
      continue;
    }

    // Handle Maintenance (Placeholders for now)
    if (ac.status === "maintenance") continue;

    const model = getAircraftById(ac.modelId);
    if (!model) continue;

    // --- FLIGHT STATE MACHINE ---

    // State: IDLE -> Start Flight if assigned
    if (ac.status === "idle" && ac.assignedRouteId) {
      const route = routes.find((r) => r.id === ac.assignedRouteId);
      if (route && route.status === "active") {
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
              type: "maintenance",
              aircraftId: ac.id,
              aircraftName: ac.name,
              description: `[SAFETY ALERT] ${ac.name} is GROUNDED. Condition: ${Math.round(ac.condition * 100)}%. Hours since check: ${Math.round(ac.flightHoursSinceCheck)}. Maintenance required!`,
            });
          }
          continue; // Do not take off
        }

        // Safety check for range
        if (route.distanceKm > (model.rangeKm || 0)) {
          continue;
        }

        // Real-world duration calculation
        const isAtOrigin = ac.baseAirportIata === route.originIata;
        const isAtDestination = ac.baseAirportIata === route.destinationIata;
        if (!isAtOrigin && !isAtDestination) {
          continue;
        }

        const hours = route.distanceKm / (model.speedKmh || 800);
        const durationTicks = Math.ceil(hours * TICKS_PER_HOUR);
        const originIata = isAtOrigin ? route.originIata : route.destinationIata;
        const destinationIata = isAtOrigin ? route.destinationIata : route.originIata;

        ac.status = "enroute";
        ac.flight = {
          originIata,
          destinationIata,
          departureTick: tick,
          arrivalTick: tick + Math.max(1, durationTicks),
          direction: isAtOrigin ? "outbound" : "inbound",
        };
        hasChanges = true;

        events.push({
          id: `evt-takeoff-${ac.id}-${tick}`,
          tick,
          timestamp: simulatedTimestamp,
          type: "takeoff",
          aircraftId: ac.id,
          aircraftName: ac.name,
          routeId: route.id,
          originIata,
          destinationIata,
          description: `${ac.name} taking off: ${originIata} → ${destinationIata}`,
        });
      }
    }

    // State: ENROUTE -> Land if time reached
    else if (ac.status === "enroute" && ac.flight && tick >= ac.flight.arrivalTick) {
      // Guard: Don't land multiple times on the same arrival tick if somehow re-processed
      if (ac.arrivalTickProcessed === ac.flight.arrivalTick) {
        continue;
      }

      const isFerry = ac.flight?.purpose === "ferry";
      const route = !isFerry ? routes.find((r) => r.id === ac.assignedRouteId) : null;
      const isOrphan = !route && !isFerry && !!ac.flight;
      const hasFareSnapshot = !!(
        ac.flight?.fareEconomy !== undefined ||
        ac.flight?.fareBusiness !== undefined ||
        ac.flight?.fareFirst !== undefined
      );
      if (route || isFerry || isOrphan) {
        const originIata = route ? route.originIata : ac.flight?.originIata;
        const destinationIata = route ? route.destinationIata : ac.flight?.destinationIata;
        const origin = originIata ? airports.find((a) => a.iata === originIata) : null;
        const destination = destinationIata
          ? airports.find((a) => a.iata === destinationIata)
          : null;

        let weeklyDemandResult = {
          economy: 350,
          business: 35,
          first: 7,
          origin: originIata ?? "",
          destination: destinationIata ?? "",
        };

        if (origin && destination) {
          const now = new Date(simulatedTimestamp);
          const season = getSeason(destination.latitude, now);
          const prosperity = getProsperityIndex(tick);

          const originHub = originIata ? (HUB_CLASSIFICATIONS[originIata] ?? null) : null;
          const destHub = destinationIata ? (HUB_CLASSIFICATIONS[destinationIata] ?? null) : null;
          const originState = originHub && originIata ? (hubStates.get(originIata) ?? null) : null;
          const destState =
            destHub && destinationIata ? (hubStates.get(destinationIata) ?? null) : null;
          const hubModifier = getHubDemandModifier(
            originHub?.tier ?? null,
            destHub?.tier ?? null,
            originState,
            destState,
          );
          const originTraffic = originIata ? (airportTraffic.get(originIata) ?? 0) : 0;
          const destTraffic = destinationIata ? (airportTraffic.get(destinationIata) ?? 0) : 0;
          const originCapacity = originHub?.baseCapacityPerHour ?? 80;
          const destCapacity = destHub?.baseCapacityPerHour ?? 80;
          const originCongestion = getHubCongestionModifier(originCapacity, originTraffic);
          const destCongestion = getHubCongestionModifier(destCapacity, destTraffic);
          const congestionModifier = (originCongestion + destCongestion) / 2;
          const weeklyDemand = calculateDemand(
            origin,
            destination,
            season,
            prosperity,
            hubModifier,
          );
          weeklyDemandResult = {
            origin: originIata ?? "",
            destination: destinationIata ?? "",
            economy: Math.round(weeklyDemand.economy * congestionModifier),
            business: Math.round(weeklyDemand.business * congestionModifier),
            first: Math.round(weeklyDemand.first * congestionModifier),
          };
        }

        const seatConfig = {
          economy: ac.configuration?.economy ?? model.capacity.economy,
          business: ac.configuration?.business ?? model.capacity.business,
          first: ac.configuration?.first ?? model.capacity.first,
        };

        let rev = calculateFlightRevenue({
          passengersEconomy: 0,
          passengersBusiness: 0,
          passengersFirst: 0,
          fareEconomy: fp(0),
          fareBusiness: fp(0),
          fareFirst: fp(0),
          seatsOffered: seatConfig.economy + seatConfig.business + seatConfig.first,
        });

        if (route || (isOrphan && hasFareSnapshot)) {
          // --- NEW MP ALLOCATION LOGIC ---
          const routeKey = originIata && destinationIata ? `${originIata}-${destinationIata}` : "";
          const competitorOffers = route && routeKey ? globalRouteRegistry.get(routeKey) || [] : [];

          // Frequency for our offer: how many planes we (the player) have on this route?
          const ourFrequency = route
            ? Math.max(1, route.assignedAircraftIds.length * 7)
            : Math.max(1, ac.flight?.frequencyPerWeek ?? 7);

          // Travel time for our current aircraft
          const distanceForOffer = route?.distanceKm ?? ac.flight?.distanceKm ?? 0;
          const ourTravelTime = Math.round((distanceForOffer / (model.speedKmh || 800)) * 60);

          const fareEconomy = route?.fareEconomy ?? ac.flight?.fareEconomy ?? fp(0);
          const fareBusiness = route?.fareBusiness ?? ac.flight?.fareBusiness ?? fp(0);
          const fareFirst = route?.fareFirst ?? ac.flight?.fareFirst ?? fp(0);

          const ourOffer: FlightOffer = {
            airlinePubkey: playerPubkey,
            fareEconomy,
            fareBusiness,
            fareFirst,
            frequencyPerWeek: ourFrequency,
            travelTimeMinutes: ourTravelTime,
            stops: 0,
            serviceScore: 0.7,
            brandScore: playerBrandScore,
          };

          const allOffers = route ? [ourOffer, ...competitorOffers] : [ourOffer];

          // --- PRICE WAR DYNAMICS ---
          const pw = route
            ? detectPriceWar(allOffers)
            : { isPriceWar: false, lowPricedAirlines: [] as string[] };
          if (pw.isPriceWar && route) {
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
                type: "price_war",
                aircraftId: ac.id,
                aircraftName: ac.name,
                description: `[PRICE WAR] Extreme undercutting on ${route.originIata}-${route.destinationIata} is damaging your brand reputation.`,
              });
            }
          }

          const addressableDemand = scaleToAddressableMarket(weeklyDemandResult);
          const allocations = allocatePassengers(allOffers, addressableDemand);
          const ourWeeklyAllocation = allocations.get(playerPubkey) ?? {
            economy: 0,
            business: 0,
            first: 0,
          };

          const totalWeeklySeats =
            ourFrequency * (seatConfig.economy + seatConfig.business + seatConfig.first);
          const totalWeeklyDemand =
            ourWeeklyAllocation.economy + ourWeeklyAllocation.business + ourWeeklyAllocation.first;
          const pressureMultiplier = calculateSupplyPressure(totalWeeklySeats, totalWeeklyDemand);

          const referenceFares = getSuggestedFares(distanceForOffer);
          const elasticityEconomy = calculatePriceElasticity(
            fareEconomy,
            referenceFares.economy,
            PRICE_ELASTICITY_ECONOMY,
          );
          const elasticityBusiness = calculatePriceElasticity(
            fareBusiness,
            referenceFares.business,
            PRICE_ELASTICITY_BUSINESS,
          );
          const elasticityFirst = calculatePriceElasticity(
            fareFirst,
            referenceFares.first,
            PRICE_ELASTICITY_FIRST,
          );

          // Per-flight allocation (Weekly allocation / frequency), adjusted by supply pressure
          let paxE = Math.min(
            seatConfig.economy,
            Math.floor(
              (ourWeeklyAllocation.economy / ourFrequency) * pressureMultiplier * elasticityEconomy,
            ),
          );
          let paxB = Math.min(
            seatConfig.business,
            Math.floor(
              (ourWeeklyAllocation.business / ourFrequency) *
                pressureMultiplier *
                elasticityBusiness,
            ),
          );
          let paxF = Math.min(
            seatConfig.first,
            Math.floor(
              (ourWeeklyAllocation.first / ourFrequency) * pressureMultiplier * elasticityFirst,
            ),
          );

          const totalSeats = seatConfig.economy + seatConfig.business + seatConfig.first;
          const totalPax = paxE + paxB + paxF;
          const rawLoadFactor = totalSeats > 0 ? totalPax / totalSeats : 0;
          if (rawLoadFactor > NATURAL_LF_CEILING && totalPax > 0) {
            const scale = NATURAL_LF_CEILING / rawLoadFactor;
            paxE = Math.floor(paxE * scale);
            paxB = Math.floor(paxB * scale);
            paxF = Math.floor(paxF * scale);
          }
          // --- END NEW MP ALLOCATION ---

          rev = calculateFlightRevenue({
            passengersEconomy: paxE,
            passengersBusiness: paxB,
            passengersFirst: paxF,
            fareEconomy,
            fareBusiness,
            fareFirst,
            seatsOffered: seatConfig.economy + seatConfig.business + seatConfig.first,
          });

          ac.lastKnownLoadFactor = rev.loadFactor;
        }

        const originHub = originIata ? HUB_CLASSIFICATIONS[originIata] : undefined;
        const destHub = destinationIata ? HUB_CLASSIFICATIONS[destinationIata] : undefined;
        const originTraffic = originIata ? (airportTraffic.get(originIata) ?? 0) : 0;
        const destTraffic = destinationIata ? (airportTraffic.get(destinationIata) ?? 0) : 0;
        const originBaseFee = originHub ? fp(originHub.baseLandingFee) : fp(250);
        const destBaseFee = destHub ? fp(destHub.baseLandingFee) : fp(250);
        const originCapacity = originHub?.baseCapacityPerHour ?? 80;
        const destCapacity = destHub?.baseCapacityPerHour ?? 80;
        const originFee = calculateHubLandingFee(originBaseFee, originCapacity, originTraffic);
        const destFee = calculateHubLandingFee(destBaseFee, destCapacity, destTraffic);
        const avgFee = (fpToNumber(originFee) + fpToNumber(destFee)) / 2;
        const airportFeesMultiplier = avgFee / 250;

        const distanceKm = route ? route.distanceKm : (ac.flight?.distanceKm ?? 0);
        const cost = calculateFlightCost({
          distanceKm,
          aircraft: model,
          actualPassengers: rev.actualPassengers,
          blockHours: (ac.flight.arrivalTick - ac.flight.departureTick) / TICKS_PER_HOUR,
          airportFeesMultiplier,
        });

        const profit = fpSub(rev.revenueTotal, cost.costTotal);
        corporateBalance = fpAdd(corporateBalance, profit);

        // Wear and Tear
        const durationTicks = ac.flight.arrivalTick - ac.flight.departureTick;
        const flightHoursData = Math.min(24, durationTicks / TICKS_PER_HOUR); // Sanity cap: no flight > 24h

        ac.flightHoursTotal += flightHoursData;
        ac.flightHoursSinceCheck += flightHoursData;
        // Wear and Tear: 1.0 (100%) -> 0.0 (0%) over 20,000 flight hours (Realistic Mid-Life/D-Check interval)
        ac.condition = Math.max(0, ac.condition - 0.00005 * flightHoursData);

        // Set to Turnaround
        const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
        ac.status = "turnaround";
        ac.baseAirportIata = ac.flight.destinationIata;
        ac.arrivalTickProcessed = ac.flight.arrivalTick; // Mark THIS flight as landed
        ac.turnaroundEndTick = tick + Math.max(1, turnaroundTicks);
        hasChanges = true;

        const includePassengerDetails = !isFerry && (route || (isOrphan && hasFareSnapshot));
        const landingEvent: TimelineEvent = {
          id: `evt-landing-${ac.id}-${tick}`,
          tick,
          timestamp: simulatedTimestamp,
          type: isFerry ? "ferry" : "landing",
          aircraftId: ac.id,
          aircraftName: ac.name,
          routeId: route?.id,
          originIata: originIata ?? undefined,
          destinationIata: destinationIata ?? undefined,
          revenue: rev.revenueTotal,
          cost: cost.costTotal,
          profit: profit,
          description: `${ac.name} ${isFerry ? "ferried" : isOrphan ? "landed (orphaned route)" : "landed"} at ${ac.flight?.destinationIata}. Net Profit: ${profit > 0 ? "+" : ""}${fpToNumber(profit)}`,
          details: includePassengerDetails
            ? {
                passengers: {
                  economy: rev.actualEconomy,
                  business: rev.actualBusiness,
                  first: rev.actualFirst,
                  total: rev.actualPassengers,
                },
                seatsOffered: rev.seatsOffered,
                loadFactor: rev.loadFactor,
                spilledPassengers: rev.spilledPassengers,
                routeId: route?.id,
                flightDurationTicks: ac.flight.arrivalTick - ac.flight.departureTick,
                revenue: {
                  tickets: rev.revenueTicket,
                  economy: rev.revenueEconomy,
                  business: rev.revenueBusiness,
                  first: rev.revenueFirst,
                  ancillary: rev.revenueAncillary,
                },
                costs: {
                  fuel: cost.costFuel,
                  crew: cost.costCrew,
                  maintenance: cost.costMaintenance,
                  airport: cost.costAirport,
                  navigation: cost.costNavigation,
                  leasing: cost.costLeasing,
                  overhead: cost.costOverhead,
                },
              }
            : undefined,
        };
        events.push(landingEvent);
      }
    }

    // State: TURNAROUND -> Return flight
    else if (ac.status === "turnaround" && tick >= (ac.turnaroundEndTick || 0)) {
      if (ac.flight?.purpose === "ferry") {
        ac.status = "idle";
        ac.flight = null;
        hasChanges = true;
        continue;
      }

      const route = routes.find((r) => r.id === ac.assignedRouteId);
      if (route && ac.flight) {
        const hours = route.distanceKm / (model.speedKmh || 800);
        const durationTicks = Math.ceil(hours * TICKS_PER_HOUR);
        const isReturning = ac.flight.direction === "outbound";

        ac.status = "enroute";
        ac.arrivalTickProcessed = undefined;
        ac.flight = {
          originIata: isReturning ? route.destinationIata : route.originIata,
          destinationIata: isReturning ? route.originIata : route.destinationIata,
          departureTick: tick,
          arrivalTick: tick + Math.max(1, durationTicks),
          direction: isReturning ? "inbound" : "outbound",
        };
        hasChanges = true;

        events.push({
          id: `evt-takeoff-rtn-${ac.id}-${tick}`,
          tick,
          timestamp: simulatedTimestamp,
          type: "takeoff",
          aircraftId: ac.id,
          aircraftName: ac.name,
          routeId: route.id,
          originIata: ac.flight.originIata,
          destinationIata: ac.flight.destinationIata,
          description: `${ac.name} returning: ${ac.flight.originIata} → ${ac.flight.destinationIata}`,
        });
      } else {
        ac.status = "idle";
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
      if (ac.purchaseType === "lease") {
        const model = getAircraftById(ac.modelId);
        if (model) {
          for (let i = 0; i < numCycles; i++) {
            corporateBalance = fpSub(corporateBalance, model.monthlyLease);
            events.push({
              id: `evt-lease-${ac.id}-${tick}-${i}`,
              tick,
              timestamp: simulatedTimestamp,
              type: "lease_payment",
              aircraftId: ac.id,
              aircraftName: ac.name,
              cost: model.monthlyLease,
              description: `Monthly lease payment for ${ac.name}`,
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
    events,
  };
}

/**
 * Given a position within a round-trip cycle, apply the correct flight state
 * to the aircraft clone. This delegates to getCyclePhase from @acars/core
 * to ensure a single source of truth for cycle algebra.
 */
function applyCyclePhase(
  updated: AircraftInstance,
  route: Route,
  targetTick: number,
  positionInCycle: number,
  durationTicks: number,
  turnaroundTicks: number,
): void {
  const cycleStartTick = targetTick - positionInCycle;
  const phase = getCyclePhase(cycleStartTick, targetTick, durationTicks, turnaroundTicks, route);

  updated.status = phase.status;
  updated.flight = {
    originIata: phase.originIata,
    destinationIata: phase.destinationIata,
    departureTick: phase.departureTick,
    arrivalTick: phase.arrivalTick,
    direction: phase.direction,
  };
  updated.turnaroundEndTick = phase.turnaroundEndTick ?? undefined;
  updated.arrivalTickProcessed = phase.status === "turnaround" ? phase.arrivalTick : undefined;
  updated.baseAirportIata = phase.baseAirportIata;
}

function applyFlightHours(updated: AircraftInstance, hoursToAdd: number): void {
  if (hoursToAdd <= 0) return;
  updated.flightHoursTotal += hoursToAdd;
  updated.flightHoursSinceCheck += hoursToAdd;
  updated.condition = Math.max(0, updated.condition - 0.00005 * hoursToAdd);
}

const DEFAULT_RECONCILE_LOAD_FACTOR = 0.65;

/**
 * Compute the total profit delta for a batch of landings and accumulate it.
 * Extracted to deduplicate the identical pattern in reconcileFleetToTick.
 */
function accumulateLandingProfit(
  ac: AircraftInstance,
  route: Route,
  model: ReturnType<typeof getAircraftById>,
  hoursPerLeg: number,
  landings: number,
): FixedPoint {
  if (landings <= 0) return fp(0);
  const perLeg = estimateLandingFinancials(
    ac,
    route,
    model,
    hoursPerLeg,
    ac.lastKnownLoadFactor ?? DEFAULT_RECONCILE_LOAD_FACTOR,
  );
  return fpScale(perLeg.profit, landings);
}

const MIN_GROUNDED_CONDITION = 0.2;
const MAX_HOURS_SINCE_CHECK = 600;

function capLandingsForGrounding(
  ac: AircraftInstance,
  landings: number,
  hoursPerLeg: number,
  allowCurrentLeg: boolean,
): number {
  if (landings <= 0 || hoursPerLeg <= 0) return landings;
  const remainingHoursByCondition = (ac.condition - MIN_GROUNDED_CONDITION) / 0.00005;
  const remainingHoursByCheck = MAX_HOURS_SINCE_CHECK - ac.flightHoursSinceCheck;
  const remainingHours = Math.min(remainingHoursByCondition, remainingHoursByCheck);

  if (allowCurrentLeg) {
    if (remainingHours <= 0) return Math.min(1, landings);
    const remainingAfter = remainingHours - hoursPerLeg;
    const additionalLegs = remainingAfter > 0 ? Math.floor(remainingAfter / hoursPerLeg) : 0;
    return Math.min(landings, 1 + additionalLegs);
  }

  if (remainingHours <= 0) return 0;
  const allowed = Math.floor(remainingHours / hoursPerLeg);
  return Math.min(landings, Math.max(0, allowed));
}

/**
 * Estimate the financial result of a single landing using a simplified demand
 * model (load-factor based, no QSI / competitor data).
 *
 * Used by:
 * - `reconcileFleetToTick` for balance-delta estimation during fast-forward
 * - The recovery sweep in `engineSlice.processTick` to produce full-detail
 *   timeline events when a landing was missed during tick-by-tick catch-up
 *
 * Returns the full revenue/cost breakdown so callers can either just grab
 * `.profit` or build a complete `TimelineEvent.details` object.
 */
export interface LandingFinancialResult {
  profit: FixedPoint;
  revenue: ReturnType<typeof calculateFlightRevenue>;
  cost: ReturnType<typeof calculateFlightCost>;
  details: NonNullable<TimelineEvent["details"]>;
}

export function estimateLandingFinancials(
  ac: AircraftInstance,
  route: Route,
  model: ReturnType<typeof getAircraftById>,
  hoursPerLeg: number,
  loadFactor: number,
): LandingFinancialResult {
  if (!model || hoursPerLeg <= 0) {
    const zeroRevenue = calculateFlightRevenue({
      passengersEconomy: 0,
      passengersBusiness: 0,
      passengersFirst: 0,
      fareEconomy: fp(0),
      fareBusiness: fp(0),
      fareFirst: fp(0),
      seatsOffered: 0,
    });
    return {
      profit: fp(0),
      revenue: zeroRevenue,
      cost: {
        costTotal: fp(0),
        costFuel: fp(0),
        costCrew: fp(0),
        costMaintenance: fp(0),
        costAirport: fp(0),
        costNavigation: fp(0),
        costLeasing: fp(0),
        costOverhead: fp(0),
      },
      details: {
        passengers: { economy: 0, business: 0, first: 0, total: 0 },
        seatsOffered: 0,
        loadFactor: 0,
        spilledPassengers: 0,
        routeId: route.id,
        flightDurationTicks: Math.max(0, Math.ceil(hoursPerLeg * TICKS_PER_HOUR)),
        revenue: {
          tickets: fp(0),
          economy: fp(0),
          business: fp(0),
          first: fp(0),
          ancillary: fp(0),
        },
        costs: {
          fuel: fp(0),
          crew: fp(0),
          maintenance: fp(0),
          airport: fp(0),
          navigation: fp(0),
          leasing: fp(0),
          overhead: fp(0),
        },
      },
    };
  }

  const clampedLoad = Math.min(1, Math.max(0, loadFactor));
  const seatsEconomy = Math.max(0, ac.configuration?.economy ?? model.capacity.economy);
  const seatsBusiness = Math.max(0, ac.configuration?.business ?? model.capacity.business);
  const seatsFirst = Math.max(0, ac.configuration?.first ?? model.capacity.first);
  const seatsOffered = seatsEconomy + seatsBusiness + seatsFirst;
  const passengersEconomy = Math.floor(seatsEconomy * clampedLoad);
  const passengersBusiness = Math.floor(seatsBusiness * clampedLoad);
  const passengersFirst = Math.floor(seatsFirst * clampedLoad);

  const fareEconomy = route.fareEconomy ?? fp(0);
  const fareBusiness = route.fareBusiness ?? fp(0);
  const fareFirst = route.fareFirst ?? fp(0);

  const revenue = calculateFlightRevenue({
    passengersEconomy,
    passengersBusiness,
    passengersFirst,
    fareEconomy,
    fareBusiness,
    fareFirst,
    seatsOffered,
  });

  // Hub-aware airport fees (fall back to route IATA when ac.flight is null during recovery/backfill)
  const originIata = ac.flight?.originIata ?? route.originIata;
  const destinationIata = ac.flight?.destinationIata ?? route.destinationIata;
  const originHub = originIata ? HUB_CLASSIFICATIONS[originIata] : undefined;
  const destHub = destinationIata ? HUB_CLASSIFICATIONS[destinationIata] : undefined;
  const originBaseFee = originHub ? fp(originHub.baseLandingFee) : fp(250);
  const destBaseFee = destHub ? fp(destHub.baseLandingFee) : fp(250);
  // No live traffic data available; use 0 for baseline fees
  const originFee = calculateHubLandingFee(originBaseFee, originHub?.baseCapacityPerHour ?? 80, 0);
  const destFee = calculateHubLandingFee(destBaseFee, destHub?.baseCapacityPerHour ?? 80, 0);
  const avgFee = (fpToNumber(originFee) + fpToNumber(destFee)) / 2;
  const airportFeesMultiplier = avgFee / 250;

  const cost = calculateFlightCost({
    distanceKm: route.distanceKm,
    aircraft: model,
    actualPassengers: revenue.actualPassengers,
    blockHours: hoursPerLeg,
    airportFeesMultiplier,
  });

  const profit = fpSub(revenue.revenueTotal, cost.costTotal);

  const durationTicks = ac.flight
    ? ac.flight.arrivalTick - ac.flight.departureTick
    : Math.ceil(hoursPerLeg * TICKS_PER_HOUR);

  const details: NonNullable<TimelineEvent["details"]> = {
    passengers: {
      economy: revenue.actualEconomy,
      business: revenue.actualBusiness,
      first: revenue.actualFirst,
      total: revenue.actualPassengers,
    },
    seatsOffered: revenue.seatsOffered,
    loadFactor: revenue.loadFactor,
    spilledPassengers: revenue.spilledPassengers,
    routeId: route.id,
    flightDurationTicks: durationTicks,
    revenue: {
      tickets: revenue.revenueTicket,
      economy: revenue.revenueEconomy,
      business: revenue.revenueBusiness,
      first: revenue.revenueFirst,
      ancillary: revenue.revenueAncillary,
    },
    costs: {
      fuel: cost.costFuel,
      crew: cost.costCrew,
      maintenance: cost.costMaintenance,
      airport: cost.costAirport,
      navigation: cost.costNavigation,
      leasing: cost.costLeasing,
      overhead: cost.costOverhead,
    },
  };

  return { profit, revenue, cost, details };
}

/**
 * Fast-forward an aircraft's flight-cycle position to `targetTick` without
 * running the full engine.  Used when `lastTick` has been clamped forward
 * (e.g. after a long absence) and the fleet snapshot from the checkpoint is
 * older than `targetTick`.  Instead of letting every aircraft land/depart
 * simultaneously on the first tick of catchup, this places each aircraft at
 * the correct phase of its round-trip cycle at `targetTick`.
 *
 * Only touches aircraft that are actively flying a route (enroute/turnaround
 * with an assignedRouteId).  Revenue/cost is NOT calculated — this is purely
 * positional reconciliation.
 */
export function reconcileFleetToTick(
  fleet: AircraftInstance[],
  routes: Route[],
  targetTick: number,
): { fleet: AircraftInstance[]; balanceDelta: FixedPoint } {
  let balanceDelta = fp(0);
  const updatedFleet: AircraftInstance[] = fleet.map((ac): AircraftInstance => {
    // Handle delivery aircraft that have been delivered but have no route —
    // they just need to transition to idle.  This must happen before the
    // route guard below, which would otherwise return them unchanged.
    if (ac.status === "delivery" && !ac.assignedRouteId) {
      if (ac.deliveryAtTick != null && ac.deliveryAtTick <= targetTick) {
        return {
          ...ac,
          status: "idle" as const,
          lastTickProcessed: targetTick,
        };
      }
      return ac;
    }

    // Only reconcile aircraft that are on active routes and have a stale
    // flight state (arrivalTick or turnaroundEndTick in the past).
    const route = ac.assignedRouteId ? routes.find((r) => r.id === ac.assignedRouteId) : null;
    if (!route || route.status !== "active") return ac;

    const model = getAircraftById(ac.modelId);
    if (!model) return ac;

    const durationTicks = Math.max(
      1,
      Math.ceil((route.distanceKm / (model.speedKmh || 800)) * TICKS_PER_HOUR),
    );
    const turnaroundTicks = Math.max(
      1,
      Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR),
    );
    const roundTripTicks = durationTicks * 2 + turnaroundTicks * 2;

    // Determine the reference tick from which we know the aircraft's state.
    // For enroute aircraft, use departureTick; for turnaround, use arrivalTick;
    // for idle, use targetTick itself (will depart on first engine tick).
    let refTick: number;
    let refPhaseOffset: number; // offset within the round-trip cycle

    if (ac.status === "enroute" && ac.flight) {
      // Aircraft was mid-flight. Its cycle started at departureTick.
      refTick = ac.flight.departureTick;
      if (ac.flight.direction === "outbound") {
        refPhaseOffset = 0; // outbound starts at offset 0
      } else {
        // inbound starts after outbound + turnaround
        refPhaseOffset = durationTicks + turnaroundTicks;
      }
    } else if (ac.status === "turnaround" && ac.flight) {
      // Aircraft was in turnaround. Turnaround started at arrivalTick.
      const arrivalTick = ac.flight.arrivalTick;
      if (ac.flight.direction === "outbound") {
        // Outbound arrived → turnaround at offset = durationTicks
        refTick = arrivalTick;
        refPhaseOffset = durationTicks;
      } else {
        // Inbound arrived → turnaround at offset = durationTicks*2 + turnaroundTicks
        refTick = arrivalTick;
        refPhaseOffset = durationTicks * 2 + turnaroundTicks;
      }
    } else if (ac.status === "idle") {
      // Idle aircraft with an assigned route: compute where they should be
      // in their deterministic round-trip cycle using routeAssignedAtTick
      // (or purchasedAtTick as fallback) as the cycle anchor.
      if (!ac.assignedRouteId) return ac;

      const cycleStartTick = ac.routeAssignedAtTick ?? ac.purchasedAtTick;
      if (targetTick <= cycleStartTick) return ac;

      const elapsed = targetTick - cycleStartTick;
      const positionInCycle = ((elapsed % roundTripTicks) + roundTripTicks) % roundTripTicks;

      const updated = { ...ac };
      applyCyclePhase(updated, route, targetTick, positionInCycle, durationTicks, turnaroundTicks);
      updated.lastTickProcessed = targetTick;
      const referenceTick =
        typeof ac.lastTickProcessed === "number" ? ac.lastTickProcessed : cycleStartTick;
      let landings = countLandingsBetween(
        cycleStartTick,
        referenceTick,
        targetTick,
        durationTicks,
        turnaroundTicks,
      );
      const hoursPerLeg = Math.min(24, durationTicks / TICKS_PER_HOUR);
      landings = capLandingsForGrounding(updated, landings, hoursPerLeg, false);
      applyFlightHours(updated, landings * hoursPerLeg);
      balanceDelta = fpAdd(
        balanceDelta,
        accumulateLandingProfit(updated, route, model, hoursPerLeg, landings),
      );
      return updated;
    } else if (ac.status === "delivery") {
      // Delivery aircraft whose deliveryAtTick is in the past should be
      // transitioned.  This happens when replaying from scratch (no
      // checkpoint) — AIRCRAFT_PURCHASE sets status to "delivery" and
      // reconcileFleetToTick needs to place them correctly.
      if (ac.deliveryAtTick != null && ac.deliveryAtTick <= targetTick) {
        // Note: delivery aircraft without an assigned route are already
        // handled before the route guard at the top of this function.
        // At this point we know the aircraft has a route.
        // Compute cycle position from routeAssignedAtTick (or deliveryAtTick as fallback)
        const cycleStartTick = ac.routeAssignedAtTick ?? ac.deliveryAtTick;
        if (targetTick <= cycleStartTick) {
          return { ...ac, status: "idle", lastTickProcessed: targetTick };
        }

        const elapsed = targetTick - cycleStartTick;
        const positionInCycle = ((elapsed % roundTripTicks) + roundTripTicks) % roundTripTicks;
        const updated = { ...ac };
        applyCyclePhase(
          updated,
          route,
          targetTick,
          positionInCycle,
          durationTicks,
          turnaroundTicks,
        );
        updated.lastTickProcessed = targetTick;
        const referenceTick =
          typeof ac.lastTickProcessed === "number" ? ac.lastTickProcessed : cycleStartTick;
        let landings = countLandingsBetween(
          cycleStartTick,
          referenceTick,
          targetTick,
          durationTicks,
          turnaroundTicks,
        );
        const hoursPerLeg = Math.min(24, durationTicks / TICKS_PER_HOUR);
        landings = capLandingsForGrounding(updated, landings, hoursPerLeg, false);
        applyFlightHours(updated, landings * hoursPerLeg);
        balanceDelta = fpAdd(
          balanceDelta,
          accumulateLandingProfit(updated, route, model, hoursPerLeg, landings),
        );
        return updated;
      }
      // Still in delivery period — skip
      return ac;
    } else {
      // maintenance — skip
      return ac;
    }

    // If the aircraft's state is already current or in the future, no reconciliation needed.
    const nextTransitionTick =
      ac.status === "enroute" && ac.flight
        ? ac.flight.arrivalTick
        : (ac.turnaroundEndTick ?? targetTick);
    if (nextTransitionTick >= targetTick) return ac;

    // Compute the cycle-start tick (when the aircraft started its first
    // outbound leg of THIS cycle).
    const cycleStartTick = refTick - refPhaseOffset;

    // How far into the cycle is targetTick?
    const elapsed = targetTick - cycleStartTick;
    const positionInCycle = ((elapsed % roundTripTicks) + roundTripTicks) % roundTripTicks;

    const updated = { ...ac };
    applyCyclePhase(updated, route, targetTick, positionInCycle, durationTicks, turnaroundTicks);
    updated.lastTickProcessed = targetTick;
    const referenceTick =
      typeof ac.lastTickProcessed === "number" ? ac.lastTickProcessed : cycleStartTick;
    let landings = countLandingsBetween(
      cycleStartTick,
      referenceTick,
      targetTick,
      durationTicks,
      turnaroundTicks,
    );
    const hoursPerLeg = Math.min(24, durationTicks / TICKS_PER_HOUR);
    landings = capLandingsForGrounding(updated, landings, hoursPerLeg, ac.status === "enroute");
    applyFlightHours(updated, landings * hoursPerLeg);
    balanceDelta = fpAdd(
      balanceDelta,
      accumulateLandingProfit(updated, route, model, hoursPerLeg, landings),
    );

    return updated;
  });

  return { fleet: updatedFleet, balanceDelta };
}
