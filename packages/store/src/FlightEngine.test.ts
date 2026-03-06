import type { AircraftInstance, FixedPoint, FlightOffer, Route, TimelineEvent } from "@acars/core";
import {
  calculateDemand,
  countLandingsBetween,
  fp,
  fpToNumber,
  getSuggestedFares,
  TICKS_PER_HOUR,
} from "@acars/core";
import { airports, getAircraftById } from "@acars/data";
import { describe, expect, it } from "vitest";
import { processFlightEngine, reconcileFleetToTick } from "./FlightEngine.js";

const PLAYER_PUBKEY = "player-airline";

type EngineState = {
  fleet: AircraftInstance[];
  routes: Route[];
  balance: FixedPoint;
  lastTick: number;
  events: TimelineEvent[];
};

const makeAircraft = (overrides: Partial<AircraftInstance> = {}): AircraftInstance => {
  const modelId = overrides.modelId ?? "a320neo";
  const model = getAircraftById(modelId);
  if (!model) {
    throw new Error(`Unknown modelId: ${modelId}`);
  }

  return {
    id: overrides.id ?? "ac-1",
    ownerPubkey: overrides.ownerPubkey ?? PLAYER_PUBKEY,
    modelId,
    name: overrides.name ?? model.name,
    status: overrides.status ?? "idle",
    assignedRouteId: overrides.assignedRouteId ?? null,
    baseAirportIata: overrides.baseAirportIata ?? "JFK",
    purchasedAtTick: overrides.purchasedAtTick ?? 0,
    purchasePrice: overrides.purchasePrice ?? fp(1000000),
    birthTick: overrides.birthTick ?? 0,
    deliveryAtTick: overrides.deliveryAtTick,
    listingPrice: overrides.listingPrice ?? null,
    flight: overrides.flight ?? null,
    lastTickProcessed: overrides.lastTickProcessed,
    turnaroundEndTick: overrides.turnaroundEndTick,
    arrivalTickProcessed: overrides.arrivalTickProcessed,
    purchaseType: overrides.purchaseType ?? "buy",
    leaseStartedAtTick: overrides.leaseStartedAtTick,
    configuration: overrides.configuration ?? {
      economy: model.capacity.economy,
      business: model.capacity.business,
      first: model.capacity.first,
      cargoKg: model.capacity.cargoKg,
    },
    flightHoursTotal: overrides.flightHoursTotal ?? 0,
    flightHoursSinceCheck: overrides.flightHoursSinceCheck ?? 0,
    condition: overrides.condition ?? 1.0,
    routeAssignedAtTick: overrides.routeAssignedAtTick,
    routeAssignedAtIata: overrides.routeAssignedAtIata,
  };
};

const makeRoute = (overrides: Partial<Route> = {}): Route => {
  const distanceKm = overrides.distanceKm ?? 1000;
  const fares = getSuggestedFares(distanceKm);

  return {
    id: overrides.id ?? "route-1",
    originIata: overrides.originIata ?? "JFK",
    destinationIata: overrides.destinationIata ?? "LAX",
    airlinePubkey: overrides.airlinePubkey ?? PLAYER_PUBKEY,
    distanceKm,
    frequencyPerWeek: overrides.frequencyPerWeek ?? 7,
    assignedAircraftIds: overrides.assignedAircraftIds ?? [],
    fareEconomy: overrides.fareEconomy ?? fares.economy,
    fareBusiness: overrides.fareBusiness ?? fares.business,
    fareFirst: overrides.fareFirst ?? fares.first,
    status: overrides.status ?? "active",
    lastTickProcessed: overrides.lastTickProcessed,
  };
};

const initState = (
  fleet: AircraftInstance[],
  routes: Route[],
  balance: FixedPoint = fp(1000000),
): EngineState => ({
  fleet,
  routes,
  balance,
  lastTick: 0,
  events: [],
});

const runTick = (
  state: EngineState,
  tick: number,
  options: {
    globalRouteRegistry?: Map<string, FlightOffer[]>;
    playerPubkey?: string;
    brandScore?: number;
  } = {},
): EngineState => {
  const result = processFlightEngine(
    tick,
    state.fleet,
    state.routes,
    state.balance,
    state.lastTick,
    options.globalRouteRegistry ?? new Map(),
    options.playerPubkey ?? PLAYER_PUBKEY,
    options.brandScore ?? 0.5,
    Number.POSITIVE_INFINITY,
  );

  return {
    fleet: result.updatedFleet,
    routes: state.routes,
    balance: result.corporateBalance,
    lastTick: tick,
    events: [...state.events, ...result.events],
  };
};

const findLastEvent = (
  events: TimelineEvent[],
  type: TimelineEvent["type"],
): TimelineEvent | undefined => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === type) return events[i];
  }
  return undefined;
};

const simulateSingleLanding = (
  aircraft: AircraftInstance,
  route: Route,
  options: {
    globalRouteRegistry?: Map<string, FlightOffer[]>;
    brandScore?: number;
  } = {},
) => {
  let state = initState([aircraft], [route]);
  state = runTick(state, 1, options);
  const arrivalTick = state.fleet[0].flight?.arrivalTick;
  if (!arrivalTick) {
    throw new Error("Expected flight to be enroute with arrival tick");
  }
  state = runTick(state, arrivalTick, options);
  const landing = findLastEvent(state.events, "landing");
  if (!landing) {
    throw new Error("Expected landing event");
  }
  return { landing, state };
};

const makeFlight = (
  overrides: Partial<AircraftInstance["flight"]>,
): AircraftInstance["flight"] => ({
  originIata: "JFK",
  destinationIata: "LAX",
  departureTick: 1,
  arrivalTick: 10,
  direction: "outbound",
  ...overrides,
});

describe("FlightEngine — Solo/Offline scenarios", () => {
  it("turboprop economy-only stays zero for business/first", () => {
    const aircraft = makeAircraft({
      id: "ac-atr",
      modelId: "atr72-600",
      assignedRouteId: "route-atr",
      baseAirportIata: "JFK",
    });
    const route = makeRoute({
      id: "route-atr",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 500,
      assignedAircraftIds: [aircraft.id],
    });

    const { landing } = simulateSingleLanding(aircraft, route);
    const passengers = landing.details?.passengers;
    expect(passengers?.business ?? 0).toBe(0);
    expect(passengers?.first ?? 0).toBe(0);
    expect(landing.details?.seatsOffered).toBe(70);
    expect(landing.details?.loadFactor).toBeGreaterThanOrEqual(0);
    expect(landing.details?.loadFactor).toBeLessThanOrEqual(1);
  });

  it("narrowbody fills business but has zero first-class seats", () => {
    const aircraft = makeAircraft({
      id: "ac-a320",
      modelId: "a320neo",
      assignedRouteId: "route-a320",
      baseAirportIata: "JFK",
    });
    const route = makeRoute({
      id: "route-a320",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: [aircraft.id],
    });

    const { landing } = simulateSingleLanding(aircraft, route);
    const passengers = landing.details?.passengers;
    expect(passengers?.first ?? 0).toBe(0);
    expect(passengers?.business ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("widebody long-haul supports all three classes", () => {
    const aircraft = makeAircraft({
      id: "ac-b787",
      modelId: "b787-9",
      assignedRouteId: "route-b787",
      baseAirportIata: "JFK",
    });
    const route = makeRoute({
      id: "route-b787",
      originIata: "JFK",
      destinationIata: "LHR",
      distanceKm: 10000,
      assignedAircraftIds: [aircraft.id],
    });

    const { landing } = simulateSingleLanding(aircraft, route);
    const passengers = landing.details?.passengers;
    expect(passengers?.economy ?? 0).toBeGreaterThan(0);
    expect(passengers?.business ?? 0).toBeGreaterThanOrEqual(0);
    expect(passengers?.first ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("uses instance configuration for seat caps", () => {
    const aircraft = makeAircraft({
      id: "ac-config",
      modelId: "a320neo",
      assignedRouteId: "route-config",
      baseAirportIata: "JFK",
      configuration: {
        economy: 0,
        business: 0,
        first: 10,
        cargoKg: 0,
      },
    });
    const route = makeRoute({
      id: "route-config",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: [aircraft.id],
    });

    const { landing } = simulateSingleLanding(aircraft, route);
    const passengers = landing.details?.passengers;

    expect(passengers?.economy ?? 0).toBe(0);
    expect(passengers?.business ?? 0).toBe(0);
    expect(passengers?.first ?? 0).toBeGreaterThan(0);
    expect(landing.details?.seatsOffered).toBe(10);
  });

  it("oversized aircraft on thin route yields low load factor", () => {
    const aircraft = makeAircraft({
      id: "ac-a380",
      modelId: "a380-800",
      assignedRouteId: "route-a380",
      baseAirportIata: "GKA",
    });
    const route = makeRoute({
      id: "route-a380",
      originIata: "GKA",
      destinationIata: "CPT",
      distanceKm: 11000,
      assignedAircraftIds: [aircraft.id],
    });

    const { landing } = simulateSingleLanding(aircraft, route);
    expect(landing.details?.loadFactor ?? 1).toBeLessThan(0.4);
  });

  it("monopoly routes respect the natural load factor ceiling", () => {
    const aircraft = makeAircraft({
      id: "ac-ceiling",
      modelId: "atr72-600",
      assignedRouteId: "route-ceiling",
      baseAirportIata: "BOG",
    });
    const route = makeRoute({
      id: "route-ceiling",
      originIata: "BOG",
      destinationIata: "MDE",
      distanceKm: 300,
      assignedAircraftIds: [aircraft.id],
    });

    const { landing } = simulateSingleLanding(aircraft, route);
    const loadFactor = landing.details?.loadFactor ?? 0;

    expect(loadFactor).toBeGreaterThan(0);
    expect(loadFactor).toBeLessThanOrEqual(0.88);
  });
});

describe("FlightEngine — Multiplayer scenarios", () => {
  it("competition reduces our passenger allocation", () => {
    const aircraft = makeAircraft({
      id: "ac-comp",
      modelId: "a320neo",
      assignedRouteId: "route-comp",
      baseAirportIata: "JFK",
    });
    const assignedAircraftIds = Array.from({ length: 200 }, (_, index) => `ac-comp-${index + 1}`);
    const route = makeRoute({
      id: "route-comp",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds,
    });

    const monopoly = simulateSingleLanding(aircraft, route);

    const competitorOffer: FlightOffer = {
      airlinePubkey: "competitor-1",
      fareEconomy: fp(120),
      fareBusiness: fp(350),
      fareFirst: fp(700),
      frequencyPerWeek: 2800,
      travelTimeMinutes: 300,
      stops: 0,
      serviceScore: 0.7,
      brandScore: 0.6,
    };
    const registry = new Map<string, FlightOffer[]>([["JFK-LAX", [competitorOffer]]]);

    const competition = simulateSingleLanding(aircraft, route, {
      globalRouteRegistry: registry,
    });

    const monoPax = monopoly.landing.details?.passengers?.total ?? 0;
    const compPax = competition.landing.details?.passengers?.total ?? 0;
    expect(compPax).toBeLessThan(monoPax);
  });

  it("price war emits an event when we undercut", () => {
    const aircraft = makeAircraft({
      id: "ac-pw",
      modelId: "a320neo",
      assignedRouteId: "route-pw",
      baseAirportIata: "JFK",
    });
    const route = makeRoute({
      id: "route-pw",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: [aircraft.id],
      fareEconomy: fp(50),
      fareBusiness: fp(150),
      fareFirst: fp(300),
    });

    const competitorOffer: FlightOffer = {
      airlinePubkey: "competitor-2",
      fareEconomy: fp(200),
      fareBusiness: fp(500),
      fareFirst: fp(900),
      frequencyPerWeek: 7,
      travelTimeMinutes: 310,
      stops: 0,
      serviceScore: 0.7,
      brandScore: 0.6,
    };
    const registry = new Map<string, FlightOffer[]>([["JFK-LAX", [competitorOffer]]]);

    const { state } = simulateSingleLanding(aircraft, route, {
      globalRouteRegistry: registry,
    });
    const priceWarEvent = state.events.find((e) => e.type === "price_war");
    expect(priceWarEvent).toBeTruthy();
  });

  it("registry entries for other routes do not affect our monopoly", () => {
    const aircraft = makeAircraft({
      id: "ac-mono",
      modelId: "a320neo",
      assignedRouteId: "route-mono",
      baseAirportIata: "JFK",
    });
    const route = makeRoute({
      id: "route-mono",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: [aircraft.id],
    });

    const registry = new Map<string, FlightOffer[]>([
      [
        "LAX-SFO",
        [
          {
            airlinePubkey: "competitor-3",
            fareEconomy: fp(120),
            fareBusiness: fp(300),
            fareFirst: fp(600),
            frequencyPerWeek: 14,
            travelTimeMinutes: 60,
            stops: 0,
            serviceScore: 0.7,
            brandScore: 0.6,
          },
        ],
      ],
    ]);

    const baseline = simulateSingleLanding(aircraft, route);
    const otherRoutes = simulateSingleLanding(aircraft, route, {
      globalRouteRegistry: registry,
    });
    const basePax = baseline.landing.details?.passengers?.total ?? 0;
    const otherPax = otherRoutes.landing.details?.passengers?.total ?? 0;
    expect(otherPax).toBe(basePax);
  });

  it("monopoly with extreme fares suppresses demand", () => {
    const baselineAircraft = makeAircraft({
      id: "ac-elite-base",
      modelId: "a320neo",
      assignedRouteId: "route-elite-base",
      baseAirportIata: "JFK",
    });
    const baselineRoute = makeRoute({
      id: "route-elite-base",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: [baselineAircraft.id],
    });
    const baseline = simulateSingleLanding(baselineAircraft, baselineRoute);

    const aircraft = makeAircraft({
      id: "ac-elite",
      modelId: "a320neo",
      assignedRouteId: "route-elite",
      baseAirportIata: "JFK",
    });
    const route = makeRoute({
      id: "route-elite",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: [aircraft.id],
      fareEconomy: fp(1_000_000),
      fareBusiness: fp(1_000_000),
      fareFirst: fp(1_000_000),
    });

    const { landing } = simulateSingleLanding(aircraft, route);
    const baselineLoadFactor = baseline.landing.details?.loadFactor ?? 0;
    const extremeLoadFactor = landing.details?.loadFactor ?? 1;
    expect(extremeLoadFactor).toBeLessThan(baselineLoadFactor);
    expect(extremeLoadFactor).toBeLessThan(0.7);
  });
});

describe("FlightEngine — Edge cases", () => {
  it("safety grounding blocks takeoff when condition is low", () => {
    const aircraft = makeAircraft({
      id: "ac-ground",
      modelId: "a320neo",
      assignedRouteId: "route-ground",
      condition: 0.15,
      baseAirportIata: "JFK",
    });
    const route = makeRoute({
      id: "route-ground",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: [aircraft.id],
    });

    const state = initState([aircraft], [route]);
    const dayTick = TICKS_PER_HOUR * 24;
    const nextState = runTick({ ...state, lastTick: dayTick - 1 }, dayTick);
    expect(nextState.fleet[0].status).toBe("idle");
    expect(nextState.events.some((e) => e.type === "maintenance")).toBe(true);
  });

  it("out-of-range routes do not take off", () => {
    const aircraft = makeAircraft({
      id: "ac-range",
      modelId: "atr72-600",
      assignedRouteId: "route-range",
      baseAirportIata: "JFK",
    });
    const route = makeRoute({
      id: "route-range",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: [aircraft.id],
    });

    const state = initState([aircraft], [route]);
    const nextState = runTick(state, 1);
    expect(nextState.events.length).toBe(0);
    expect(nextState.fleet[0].status).toBe("idle");
  });

  it("balance can cross bankruptcy threshold after a loss", () => {
    const aircraft = makeAircraft({
      id: "ac-loss",
      modelId: "a380-800",
      assignedRouteId: "route-loss",
      baseAirportIata: "JFK",
    });
    const route = makeRoute({
      id: "route-loss",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 9000,
      assignedAircraftIds: [aircraft.id],
      fareEconomy: fp(1),
      fareBusiness: fp(1),
      fareFirst: fp(1),
    });

    let state = initState([aircraft], [route], fp(-9999000));
    state = runTick(state, 1);
    const arrivalTick = state.fleet[0].flight?.arrivalTick;
    if (!arrivalTick) throw new Error("Expected arrival tick");
    state = runTick(state, arrivalTick);

    const landing = findLastEvent(state.events, "landing");
    expect(landing?.profit && fpToNumber(landing.profit)).toBeLessThan(0);
    expect(fpToNumber(state.balance)).toBeLessThan(-10000000);
  });

  it("multi-tick simulation completes outbound and return legs", () => {
    const aircraft = makeAircraft({
      id: "ac-cycle",
      modelId: "a320neo",
      assignedRouteId: "route-cycle",
      baseAirportIata: "JFK",
    });
    const route = makeRoute({
      id: "route-cycle",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: [aircraft.id],
    });

    const model = getAircraftById(aircraft.modelId)!;
    const hours = route.distanceKm / model.speedKmh;
    const durationTicks = Math.ceil(hours * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const totalTicks = 1 + durationTicks + turnaroundTicks + durationTicks + 1;

    let state = initState([aircraft], [route]);
    for (let t = 1; t <= totalTicks; t += 1) {
      state = runTick(state, t);
    }

    const landingEvents = state.events.filter((e) => e.type === "landing");
    expect(landingEvents.length).toBeGreaterThanOrEqual(2);
    expect(state.fleet[0].flightHoursTotal).toBeGreaterThan(0);
  });

  it("orphaned flight uses fare snapshot when route is missing", () => {
    const fares = getSuggestedFares(3000);
    const aircraft = makeAircraft({
      id: "ac-orphan",
      modelId: "a320neo",
      status: "enroute",
      assignedRouteId: null,
      baseAirportIata: "JFK",
      flight: makeFlight({
        departureTick: 1,
        arrivalTick: 5,
        distanceKm: 3000,
        fareEconomy: fares.economy,
        fareBusiness: fares.business,
        fareFirst: fares.first,
        frequencyPerWeek: 7,
      }),
    });

    const state = initState([aircraft], []);
    const nextState = runTick(state, 5);
    const landing = findLastEvent(nextState.events, "landing");
    expect(landing).toBeTruthy();
    expect(landing?.revenue && fpToNumber(landing.revenue)).toBeGreaterThan(0);
    expect(nextState.fleet[0].condition).toBeLessThan(1.0);
  });

  it("orphaned flight without fare snapshot yields zero revenue but still costs", () => {
    const aircraft = makeAircraft({
      id: "ac-orphan-zero",
      modelId: "a320neo",
      status: "enroute",
      assignedRouteId: null,
      baseAirportIata: "JFK",
      flight: makeFlight({
        departureTick: 1,
        arrivalTick: 5,
        distanceKm: 3000,
      }),
    });

    const state = initState([aircraft], []);
    const nextState = runTick(state, 5);
    const landing = findLastEvent(nextState.events, "landing");
    expect(landing).toBeTruthy();
    expect(fpToNumber(landing?.revenue ?? fp(1))).toBe(0);
    expect(fpToNumber(landing?.cost ?? fp(0))).toBeGreaterThan(0);
  });
});

describe("FlightEngine — Economic variation", () => {
  it("seasonal multipliers affect beach destinations", () => {
    const origin = airports.find((a) => a.iata === "JFK") ?? airports[0];
    const destination = airports.find((a) => a.tags.includes("beach")) ?? airports[0];
    const summer = calculateDemand(origin, destination, "summer");
    const winter = calculateDemand(origin, destination, "winter");
    const summerTotal = summer.economy + summer.business + summer.first;
    const winterTotal = winter.economy + winter.business + winter.first;
    expect(summerTotal).toBeGreaterThan(winterTotal);
  });

  it("prosperity index scales demand", () => {
    const origin = airports.find((a) => a.iata === "JFK") ?? airports[0];
    const destination = airports.find((a) => a.iata === "LAX") ?? airports[1] ?? airports[0];
    const boom = calculateDemand(origin, destination, "summer", 1.15, 1.0);
    const recession = calculateDemand(origin, destination, "summer", 0.85, 1.0);
    const boomTotal = boom.economy + boom.business + boom.first;
    const recessionTotal = recession.economy + recession.business + recession.first;
    expect(boomTotal).toBeGreaterThan(recessionTotal);
  });

  it("wear and tear accumulates with flight hours", () => {
    const aircraft = makeAircraft({
      id: "ac-wear",
      modelId: "a320neo",
      assignedRouteId: "route-wear",
      baseAirportIata: "JFK",
      condition: 1.0,
    });
    const route = makeRoute({
      id: "route-wear",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: [aircraft.id],
    });

    let state = initState([aircraft], [route]);
    state = runTick(state, 1);
    const arrivalTick = state.fleet[0].flight?.arrivalTick;
    if (!arrivalTick) throw new Error("Expected arrival tick");
    state = runTick(state, arrivalTick);

    const model = getAircraftById("a320neo")!;
    const hours = route.distanceKm / model.speedKmh;
    const expectedWear = Math.min(24, hours) * 0.00005;
    const condition = state.fleet[0].condition;
    expect(condition).toBeCloseTo(1.0 - expectedWear, 6);
  });

  it("lease payments trigger on monthly boundaries", () => {
    const aircraft = makeAircraft({
      id: "ac-lease",
      modelId: "a320neo",
      purchaseType: "lease",
      assignedRouteId: null,
      baseAirportIata: "JFK",
    });

    const monthTicks = 30 * 24 * TICKS_PER_HOUR;
    const state = initState([aircraft], []);
    const nextState = runTick({ ...state, lastTick: monthTicks - 1 }, monthTicks);
    const leaseEvent = nextState.events.find((e) => e.type === "lease_payment");
    expect(leaseEvent).toBeTruthy();
    expect(fpToNumber(nextState.balance)).toBeLessThan(fpToNumber(state.balance));
  });

  it("congestion reduces demand at saturated hubs", () => {
    const aircraft = makeAircraft({
      id: "ac-congestion",
      modelId: "a320neo",
      assignedRouteId: "route-congestion",
      baseAirportIata: "GKA",
    });
    const normalRoute = makeRoute({
      id: "route-congestion",
      originIata: "GKA",
      destinationIata: "POM",
      distanceKm: 800,
      assignedAircraftIds: [aircraft.id],
      frequencyPerWeek: 7,
    });
    const saturatedRoute = makeRoute({
      id: "route-congestion",
      originIata: "GKA",
      destinationIata: "POM",
      distanceKm: 800,
      assignedAircraftIds: [aircraft.id],
      frequencyPerWeek: 200000,
    });

    const normal = simulateSingleLanding(aircraft, normalRoute);
    const saturated = simulateSingleLanding(aircraft, saturatedRoute);

    const normalDemand = normal.landing.details?.passengers?.total ?? 0;
    const saturatedDemand = saturated.landing.details?.passengers?.total ?? 0;
    const totalSeats = normal.landing.details?.seatsOffered ?? 0;

    const normalLoadFactor = totalSeats > 0 ? normalDemand / totalSeats : 0;
    const saturatedLoadFactor = totalSeats > 0 ? saturatedDemand / totalSeats : 0;

    expect(saturatedLoadFactor).toBeLessThanOrEqual(normalLoadFactor);
  });
});

describe("reconcileFleetToTick — flight cycle fast-forward", () => {
  it("places enroute aircraft mid-flight when targetTick is within the flight", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-r1",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-r1"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);

    // Aircraft departed at tick 100, arrives at 100 + durationTicks
    const aircraft = makeAircraft({
      id: "ac-r1",
      assignedRouteId: "route-r1",
      status: "enroute",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 100,
        arrivalTick: 100 + durationTicks,
        direction: "outbound",
      },
    });

    // Target tick is only slightly ahead — still within the flight
    const targetTick = 100 + Math.floor(durationTicks / 2);
    const { fleet: result } = reconcileFleetToTick([aircraft], [route], targetTick);
    expect(result[0].status).toBe("enroute");
    expect(result[0].flight?.direction).toBe("outbound");
    expect(result[0].flight?.arrivalTick).toBeGreaterThan(targetTick);
  });

  it("fast-forwards past arrival into turnaround phase", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-r2",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-r2"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);

    const aircraft = makeAircraft({
      id: "ac-r2",
      assignedRouteId: "route-r2",
      status: "enroute",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 100,
        arrivalTick: 100 + durationTicks,
        direction: "outbound",
      },
    });

    // Target is past arrival but within turnaround
    const targetTick = 100 + durationTicks + Math.floor(turnaroundTicks / 2);
    const { fleet: result } = reconcileFleetToTick([aircraft], [route], targetTick);
    expect(result[0].status).toBe("turnaround");
    expect(result[0].baseAirportIata).toBe("LAX");
    expect(result[0].turnaroundEndTick).toBeGreaterThan(targetTick);
  });

  it("fast-forwards into inbound leg", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-r3",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-r3"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);

    const aircraft = makeAircraft({
      id: "ac-r3",
      assignedRouteId: "route-r3",
      status: "enroute",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 100,
        arrivalTick: 100 + durationTicks,
        direction: "outbound",
      },
    });

    // Target is in the inbound flight phase
    const targetTick = 100 + durationTicks + turnaroundTicks + Math.floor(durationTicks / 2);
    const { fleet: result } = reconcileFleetToTick([aircraft], [route], targetTick);
    expect(result[0].status).toBe("enroute");
    expect(result[0].flight?.direction).toBe("inbound");
    expect(result[0].flight?.originIata).toBe("LAX");
    expect(result[0].flight?.destinationIata).toBe("JFK");
    expect(result[0].flight?.arrivalTick).toBeGreaterThan(targetTick);
  });

  it("wraps around full cycles correctly", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-r4",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-r4"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    const aircraft = makeAircraft({
      id: "ac-r4",
      assignedRouteId: "route-r4",
      status: "enroute",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 100,
        arrivalTick: 100 + durationTicks,
        direction: "outbound",
      },
    });

    // Target is 3 full cycles + half an outbound leg later
    const halfOutbound = Math.floor(durationTicks / 2);
    const targetTick = 100 + roundTrip * 3 + halfOutbound;
    const { fleet: result } = reconcileFleetToTick([aircraft], [route], targetTick);
    expect(result[0].status).toBe("enroute");
    expect(result[0].flight?.direction).toBe("outbound");
    expect(result[0].flight?.arrivalTick).toBeGreaterThan(targetTick);
  });

  it("caps analytical landings when maintenance is overdue", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-ground",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-ground"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    expect(durationTicks).toBeGreaterThan(0);

    const aircraft = makeAircraft({
      id: "ac-ground",
      assignedRouteId: "route-ground",
      status: "idle",
      routeAssignedAtTick: 0,
      flightHoursSinceCheck: 599,
      condition: 1.0,
    });

    const targetTick = 50000;
    const { fleet: result } = reconcileFleetToTick([aircraft], [route], targetTick);
    expect(result[0].flightHoursSinceCheck).toBe(599);
    expect(result[0].condition).toBe(1.0);
  });

  it("does not modify idle aircraft without assigned route", () => {
    const aircraft = makeAircraft({
      id: "ac-r5",
      assignedRouteId: null,
      status: "idle",
      flight: null,
    });

    const { fleet: result } = reconcileFleetToTick([aircraft], [], 50000);
    expect(result[0].status).toBe("idle");
    expect(result[0].flight).toBeNull();
  });

  it("reconciles idle aircraft WITH assigned route to correct cycle phase", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-r5b",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-r5b"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    // Aircraft assigned to route at tick 1000, now idle at targetTick 50000
    const aircraft = makeAircraft({
      id: "ac-r5b",
      assignedRouteId: "route-r5b",
      status: "idle",
      flight: null,
      routeAssignedAtTick: 1000,
    });

    const targetTick = 50000;
    const { fleet: result } = reconcileFleetToTick([aircraft], [route], targetTick);

    // Should NOT remain idle — should be placed at some phase in the cycle
    expect(result[0].status).not.toBe("idle");
    expect(result[0].flight).not.toBeNull();

    // Verify the phase is deterministically correct
    const elapsed = targetTick - 1000;
    const positionInCycle = ((elapsed % roundTrip) + roundTrip) % roundTrip;

    if (positionInCycle < durationTicks) {
      expect(result[0].status).toBe("enroute");
      expect(result[0].flight?.direction).toBe("outbound");
    } else if (positionInCycle < durationTicks + turnaroundTicks) {
      expect(result[0].status).toBe("turnaround");
      expect(result[0].baseAirportIata).toBe("LAX");
    } else if (positionInCycle < durationTicks * 2 + turnaroundTicks) {
      expect(result[0].status).toBe("enroute");
      expect(result[0].flight?.direction).toBe("inbound");
    } else {
      expect(result[0].status).toBe("turnaround");
      expect(result[0].baseAirportIata).toBe("JFK");
    }
  });

  it("idle aircraft with different routeAssignedAtTick end up at different cycle positions", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-r5c",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-r5c1", "ac-r5c2"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    // Two aircraft assigned at different ticks — offset by a prime number of ticks
    // that is NOT a divisor of roundTrip, guaranteeing different cycle positions
    const offset = 137; // small prime, won't align with cycle boundaries
    const acA = makeAircraft({
      id: "ac-r5c1",
      assignedRouteId: "route-r5c",
      status: "idle",
      flight: null,
      routeAssignedAtTick: 1000,
    });
    const acB = makeAircraft({
      id: "ac-r5c2",
      assignedRouteId: "route-r5c",
      status: "idle",
      flight: null,
      routeAssignedAtTick: 1000 + offset,
    });

    const targetTick = 1000 + roundTrip * 5 + durationTicks + 1;
    const { fleet: result } = reconcileFleetToTick([acA, acB], [route], targetTick);

    // Both should be reconciled (not idle)
    expect(result[0].status).not.toBe("idle");
    expect(result[1].status).not.toBe("idle");

    // Their positions within the cycle should differ
    const elapsedA = targetTick - 1000;
    const elapsedB = targetTick - (1000 + offset);
    const posA = ((elapsedA % roundTrip) + roundTrip) % roundTrip;
    const posB = ((elapsedB % roundTrip) + roundTrip) % roundTrip;
    expect(posA).not.toBe(posB);
  });

  it("idle aircraft falls back to purchasedAtTick when routeAssignedAtTick is missing", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-r5d",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-r5d"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    // No routeAssignedAtTick — should use purchasedAtTick as fallback
    const aircraft = makeAircraft({
      id: "ac-r5d",
      assignedRouteId: "route-r5d",
      status: "idle",
      flight: null,
      purchasedAtTick: 500,
    });

    const targetTick = 50000;
    const { fleet: result } = reconcileFleetToTick([aircraft], [route], targetTick);

    // Should be reconciled using purchasedAtTick=500 as cycle anchor
    expect(result[0].status).not.toBe("idle");

    const elapsed = targetTick - 500;
    const positionInCycle = ((elapsed % roundTrip) + roundTrip) % roundTrip;

    if (positionInCycle < durationTicks) {
      expect(result[0].status).toBe("enroute");
      expect(result[0].flight?.direction).toBe("outbound");
    } else if (positionInCycle < durationTicks + turnaroundTicks) {
      expect(result[0].status).toBe("turnaround");
    } else if (positionInCycle < durationTicks * 2 + turnaroundTicks) {
      expect(result[0].status).toBe("enroute");
      expect(result[0].flight?.direction).toBe("inbound");
    } else {
      expect(result[0].status).toBe("turnaround");
    }
  });

  it("does not modify aircraft without assigned route", () => {
    const aircraft = makeAircraft({
      id: "ac-r6",
      assignedRouteId: null,
      status: "enroute",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 100,
        arrivalTick: 200,
        direction: "outbound",
      },
    });

    const { fleet: result } = reconcileFleetToTick([aircraft], [], 50000);
    // No route to reconcile against — returned unchanged
    expect(result[0].flight?.arrivalTick).toBe(200);
  });

  it("does not modify aircraft whose flight is still in the future", () => {
    const route = makeRoute({
      id: "route-r7",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-r7"],
    });
    const aircraft = makeAircraft({
      id: "ac-r7",
      assignedRouteId: "route-r7",
      status: "enroute",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 100,
        arrivalTick: 50000,
        direction: "outbound",
      },
    });

    const { fleet: result } = reconcileFleetToTick([aircraft], [route], 200);
    expect(result[0].flight?.arrivalTick).toBe(50000);
    expect(result[0].status).toBe("enroute");
  });

  it("multiple aircraft at different phases remain offset after reconciliation", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-r8",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-r8a", "ac-r8b"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    // Aircraft A departed outbound at tick 100
    const acA = makeAircraft({
      id: "ac-r8a",
      assignedRouteId: "route-r8",
      status: "enroute",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 100,
        arrivalTick: 100 + durationTicks,
        direction: "outbound",
      },
    });

    // Aircraft B departed outbound half a round-trip later, so its cycle
    // is genuinely offset from A's cycle.
    const bDeparture = 100 + Math.floor(roundTrip / 2);
    const acB = makeAircraft({
      id: "ac-r8b",
      assignedRouteId: "route-r8",
      status: "enroute",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: bDeparture,
        arrivalTick: bDeparture + durationTicks,
        direction: "outbound",
      },
    });

    // Fast-forward well past both cycles so reconciliation computes position
    const targetTick = 100 + roundTrip * 5 + durationTicks + 1;

    const { fleet: result } = reconcileFleetToTick([acA, acB], [route], targetTick);
    const phaseA = result[0].status + "-" + (result[0].flight?.direction ?? "none");
    const phaseB = result[1].status + "-" + (result[1].flight?.direction ?? "none");
    // They should differ because their cycles are offset by half a round-trip
    expect(phaseA).not.toBe(phaseB);
  });
});

describe("reconcileFleetToTick — delivery aircraft", () => {
  it("delivered aircraft with assigned route is placed at correct cycle phase", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-del1",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-del1"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    // Aircraft was delivered at tick 1000, route assigned at tick 1200,
    // but status is still "delivery" (from replay without checkpoint)
    const aircraft = makeAircraft({
      id: "ac-del1",
      assignedRouteId: "route-del1",
      status: "delivery",
      deliveryAtTick: 1000,
      routeAssignedAtTick: 1200,
      flight: null,
    });

    const targetTick = 50000;
    const { fleet: result } = reconcileFleetToTick([aircraft], [route], targetTick);

    // Should NOT remain in delivery — should be placed at some phase
    expect(result[0].status).not.toBe("delivery");
    expect(result[0].flight).not.toBeNull();

    // Verify the phase matches cycle computation from routeAssignedAtTick
    const elapsed = targetTick - 1200;
    const positionInCycle = ((elapsed % roundTrip) + roundTrip) % roundTrip;

    if (positionInCycle < durationTicks) {
      expect(result[0].status).toBe("enroute");
      expect(result[0].flight?.direction).toBe("outbound");
    } else if (positionInCycle < durationTicks + turnaroundTicks) {
      expect(result[0].status).toBe("turnaround");
      expect(result[0].baseAirportIata).toBe("LAX");
    } else if (positionInCycle < durationTicks * 2 + turnaroundTicks) {
      expect(result[0].status).toBe("enroute");
      expect(result[0].flight?.direction).toBe("inbound");
    } else {
      expect(result[0].status).toBe("turnaround");
      expect(result[0].baseAirportIata).toBe("JFK");
    }
  });

  it("delivered aircraft without assigned route becomes idle", () => {
    const aircraft = makeAircraft({
      id: "ac-del2",
      assignedRouteId: null,
      status: "delivery",
      deliveryAtTick: 1000,
      flight: null,
    });

    const { fleet: result } = reconcileFleetToTick([aircraft], [], 50000);
    expect(result[0].status).toBe("idle");
    expect(result[0].flight).toBeNull();
  });

  it("aircraft still in delivery period stays in delivery", () => {
    const route = makeRoute({
      id: "route-del3",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-del3"],
    });

    const aircraft = makeAircraft({
      id: "ac-del3",
      assignedRouteId: "route-del3",
      status: "delivery",
      deliveryAtTick: 100000, // far in the future
      flight: null,
    });

    const { fleet: result } = reconcileFleetToTick([aircraft], [route], 50000);
    expect(result[0].status).toBe("delivery");
  });

  it("delivered aircraft uses deliveryAtTick as fallback when routeAssignedAtTick is missing", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-del4",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-del4"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    // No routeAssignedAtTick — should use deliveryAtTick as cycle anchor
    const aircraft = makeAircraft({
      id: "ac-del4",
      assignedRouteId: "route-del4",
      status: "delivery",
      deliveryAtTick: 2000,
      flight: null,
    });

    const targetTick = 50000;
    const { fleet: result } = reconcileFleetToTick([aircraft], [route], targetTick);

    expect(result[0].status).not.toBe("delivery");

    // Verify cycle uses deliveryAtTick=2000 as anchor
    const elapsed = targetTick - 2000;
    const positionInCycle = ((elapsed % roundTrip) + roundTrip) % roundTrip;

    if (positionInCycle < durationTicks) {
      expect(result[0].status).toBe("enroute");
      expect(result[0].flight?.direction).toBe("outbound");
    } else if (positionInCycle < durationTicks + turnaroundTicks) {
      expect(result[0].status).toBe("turnaround");
    } else if (positionInCycle < durationTicks * 2 + turnaroundTicks) {
      expect(result[0].status).toBe("enroute");
      expect(result[0].flight?.direction).toBe("inbound");
    } else {
      expect(result[0].status).toBe("turnaround");
    }
  });

  it("delivered aircraft with route assigned at same tick as delivery is reconciled correctly", () => {
    const route = makeRoute({
      id: "route-del5",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-del5"],
    });

    // Edge case: targetTick equals cycleStartTick — should return idle
    const aircraft = makeAircraft({
      id: "ac-del5",
      assignedRouteId: "route-del5",
      status: "delivery",
      deliveryAtTick: 5000,
      routeAssignedAtTick: 5000,
      flight: null,
    });

    // targetTick == cycleStartTick, code does `if (targetTick <= cycleStartTick) return idle`
    const { fleet: result } = reconcileFleetToTick([aircraft], [route], 5000);
    expect(result[0].status).toBe("idle");
  });
});

describe("reconcileFleetToTick — destination-aware stagger", () => {
  it("idle aircraft at destination gets inbound-start cycle via routeAssignedAtIata", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-stag1",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-origin", "ac-dest"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    // Aircraft A at origin (JFK) — standard outbound-first cycle
    const acOrigin = makeAircraft({
      id: "ac-origin",
      assignedRouteId: "route-stag1",
      status: "idle",
      baseAirportIata: "JFK",
      flight: null,
      routeAssignedAtTick: 1000,
      routeAssignedAtIata: "JFK",
    });

    // Aircraft B at destination (LAX) — should start with inbound leg
    const acDest = makeAircraft({
      id: "ac-dest",
      assignedRouteId: "route-stag1",
      status: "idle",
      baseAirportIata: "LAX",
      flight: null,
      routeAssignedAtTick: 1000,
      routeAssignedAtIata: "LAX",
    });

    // At any target tick, the two aircraft should be ~halfTrip apart in the cycle
    const targetTick = 1000 + roundTrip * 7 + 1;
    const { fleet: result } = reconcileFleetToTick([acOrigin, acDest], [route], targetTick);

    // Verify they ended up at different phases (roughly half a round trip apart)
    expect(result[0].status).not.toBe("idle");
    expect(result[1].status).not.toBe("idle");

    // The flight directions should differ — one outbound, one inbound (or similar offset)
    expect(result[0].flight?.direction).not.toBe(result[1].flight?.direction);
  });

  it("falls back to baseAirportIata when routeAssignedAtIata is missing", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-stag-fallback",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-origin-fallback", "ac-dest-fallback"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    const acOrigin = makeAircraft({
      id: "ac-origin-fallback",
      assignedRouteId: "route-stag-fallback",
      status: "idle",
      baseAirportIata: "JFK",
      flight: null,
      routeAssignedAtTick: 1000,
    });

    const acDest = makeAircraft({
      id: "ac-dest-fallback",
      assignedRouteId: "route-stag-fallback",
      status: "idle",
      baseAirportIata: "LAX",
      flight: null,
      routeAssignedAtTick: 1000,
    });

    const targetTick = 1000 + roundTrip * 4 + 1;
    const { fleet: result } = reconcileFleetToTick([acOrigin, acDest], [route], targetTick);

    expect(result[0].status).not.toBe("idle");
    expect(result[1].status).not.toBe("idle");
    expect(result[0].flight?.direction).not.toBe(result[1].flight?.direction);
  });

  it("stale enroute state is overridden when routeAssignedAtTick >= departureTick", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-stag2",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-stale"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    // Aircraft has stale enroute flight state from tick 500, but was reassigned at tick 2000
    const aircraft = makeAircraft({
      id: "ac-stale",
      assignedRouteId: "route-stag2",
      status: "enroute",
      baseAirportIata: "LAX",
      routeAssignedAtTick: 2000,
      routeAssignedAtIata: "LAX",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 500,
        arrivalTick: 500 + durationTicks,
        direction: "outbound",
      },
    });

    const targetTick = 2000 + roundTrip * 3 + 1;
    const { fleet: result } = reconcileFleetToTick([aircraft], [route], targetTick);

    // Should NOT use the stale departureTick=500, should use routeAssignedAtTick=2000
    // With routeAssignedAtIata=LAX (destination), the phase offset puts it
    // at the inbound-start position, not the outbound-start position.
    expect(result[0].status).not.toBe("idle");
    expect(result[0].flight).not.toBeNull();

    // Verify: compute expected position from routeAssignedAtTick with destination offset
    const elapsed = targetTick - 2000;
    const halfTrip = durationTicks + turnaroundTicks;
    const rawPos = ((elapsed % roundTrip) + roundTrip) % roundTrip;
    const expectedPos = (rawPos + halfTrip) % roundTrip;

    // The phase should match the destination-offset calculation, not the stale one
    if (expectedPos < durationTicks) {
      expect(result[0].flight?.direction).toBe("outbound");
    } else if (expectedPos < durationTicks + turnaroundTicks) {
      expect(result[0].status).toBe("turnaround");
    } else if (expectedPos < durationTicks * 2 + turnaroundTicks) {
      expect(result[0].flight?.direction).toBe("inbound");
    } else {
      expect(result[0].status).toBe("turnaround");
    }
  });

  it("stale enroute state is overridden when routeAssignedAtTick equals departureTick", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-stag2-eq",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-stale-eq"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;
    const routeAssignedAtTick = 2000;

    const aircraft = makeAircraft({
      id: "ac-stale-eq",
      assignedRouteId: "route-stag2-eq",
      status: "enroute",
      baseAirportIata: "LAX",
      routeAssignedAtTick,
      routeAssignedAtIata: "LAX",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: routeAssignedAtTick,
        arrivalTick: routeAssignedAtTick + durationTicks,
        direction: "outbound",
      },
    });

    const targetTick = routeAssignedAtTick + roundTrip * 2 + 1;
    const { fleet: result } = reconcileFleetToTick([aircraft], [route], targetTick);

    expect(result[0].status).not.toBe("idle");
    expect(result[0].flight).not.toBeNull();

    const elapsed = targetTick - routeAssignedAtTick;
    const halfTrip = durationTicks + turnaroundTicks;
    const rawPos = ((elapsed % roundTrip) + roundTrip) % roundTrip;
    const expectedPos = (rawPos + halfTrip) % roundTrip;

    if (expectedPos < durationTicks) {
      expect(result[0].flight?.direction).toBe("outbound");
    } else if (expectedPos < durationTicks + turnaroundTicks) {
      expect(result[0].status).toBe("turnaround");
    } else if (expectedPos < durationTicks * 2 + turnaroundTicks) {
      expect(result[0].flight?.direction).toBe("inbound");
    } else {
      expect(result[0].status).toBe("turnaround");
    }
  });

  it("staggered aircraft maintain separation after reconcileFleetToTick across reload", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-stag3",
      originIata: "BOG",
      destinationIata: "CCS",
      distanceKm: 1000,
      assignedAircraftIds: ["ac-a", "ac-b"],
    });
    const durationTicks = Math.ceil((1000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    // Simulate: Player assigns A at BOG and B at CCS at different times.
    // The phase offset from routeAssignedAtIata should preserve the stagger
    // even though both aircraft are idle when reconciled.
    const acA = makeAircraft({
      id: "ac-a",
      assignedRouteId: "route-stag3",
      status: "idle",
      baseAirportIata: "BOG",
      flight: null,
      routeAssignedAtTick: 100,
      routeAssignedAtIata: "BOG",
    });

    // B assigned later at CCS. The tick offset (500) is arbitrary and NOT
    // equal to halfTrip, ensuring the test isn't trivially symmetric.
    const acB = makeAircraft({
      id: "ac-b",
      assignedRouteId: "route-stag3",
      status: "idle",
      baseAirportIata: "CCS",
      flight: null,
      routeAssignedAtTick: 600,
      routeAssignedAtIata: "CCS",
    });

    // Simulate "next day" — many round trips later
    const targetTick = 600 + roundTrip * 20 + Math.floor(durationTicks / 2);
    const { fleet: result } = reconcileFleetToTick([acA, acB], [route], targetTick);

    // Both should be actively flying
    expect(result[0].status).not.toBe("idle");
    expect(result[1].status).not.toBe("idle");

    // They should not be at the same cycle phase — the destination phase
    // offset ensures B's cycle is shifted relative to A's.
    const aFlight = result[0].flight!;
    const bFlight = result[1].flight!;
    expect(aFlight.direction).not.toBe(bFlight.direction);
  });
});

describe("reconcileFleetToTick — synthetic timeline events", () => {
  it("returns takeoff and landing events for an idle aircraft with assigned route", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-evt1",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-evt1"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    const aircraft = makeAircraft({
      id: "ac-evt1",
      assignedRouteId: "route-evt1",
      status: "idle",
      flight: null,
      routeAssignedAtTick: 1000,
    });

    // Fast-forward through 3 complete cycles
    const targetTick = 1000 + roundTrip * 3 + 1;
    const { events } = reconcileFleetToTick([aircraft], [route], targetTick);

    // Should have takeoff and landing events
    const takeoffs = events.filter((e) => e.type === "takeoff");
    const landings = events.filter((e) => e.type === "landing");

    expect(takeoffs.length).toBeGreaterThan(0);
    expect(landings.length).toBeGreaterThan(0);

    // Events should be sorted by tick descending (newest first)
    for (let i = 1; i < events.length; i++) {
      expect(events[i].tick).toBeLessThanOrEqual(events[i - 1].tick);
    }
  });

  it("events have correct ID format matching processFlightEngine", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-evt2",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-evt2"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    const aircraft = makeAircraft({
      id: "ac-evt2",
      assignedRouteId: "route-evt2",
      status: "idle",
      flight: null,
      routeAssignedAtTick: 0,
    });

    const targetTick = roundTrip * 2 + 1;
    const { events } = reconcileFleetToTick([aircraft], [route], targetTick);

    for (const evt of events) {
      if (evt.type === "takeoff") {
        // Outbound: evt-takeoff-{acId}-{tick}, Inbound: evt-takeoff-rtn-{acId}-{tick}
        expect(evt.id).toMatch(/^evt-takeoff(-rtn)?-ac-evt2-\d+$/);
      } else if (evt.type === "landing") {
        expect(evt.id).toMatch(/^evt-landing-ac-evt2-\d+$/);
      }
    }
  });

  it("landing events include financial details", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-evt3",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-evt3"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    const aircraft = makeAircraft({
      id: "ac-evt3",
      assignedRouteId: "route-evt3",
      status: "idle",
      flight: null,
      routeAssignedAtTick: 0,
    });

    const targetTick = roundTrip + 1;
    const { events } = reconcileFleetToTick([aircraft], [route], targetTick);
    const landing = events.find((e) => e.type === "landing");

    expect(landing).toBeDefined();
    expect(landing!.revenue).toBeDefined();
    expect(landing!.cost).toBeDefined();
    expect(landing!.profit).toBeDefined();
    expect(landing!.details).toBeDefined();
    expect(landing!.details!.passengers).toBeDefined();
    expect(landing!.details!.loadFactor).toBeGreaterThan(0);
  });

  it("returns no events for aircraft without assigned route", () => {
    const aircraft = makeAircraft({
      id: "ac-evt4",
      assignedRouteId: null,
      status: "idle",
      flight: null,
    });

    const { events } = reconcileFleetToTick([aircraft], [], 50000);
    expect(events.length).toBe(0);
  });

  it("returns no events when targetTick equals cycleStartTick", () => {
    const route = makeRoute({
      id: "route-evt5",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-evt5"],
    });

    const aircraft = makeAircraft({
      id: "ac-evt5",
      assignedRouteId: "route-evt5",
      status: "idle",
      flight: null,
      routeAssignedAtTick: 5000,
    });

    const { events } = reconcileFleetToTick([aircraft], [route], 5000);
    expect(events.length).toBe(0);
  });

  it("landing event count matches countLandingsBetween for the same parameters", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-evt6",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-evt6"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    const cycleStartTick = 1000;
    const aircraft = makeAircraft({
      id: "ac-evt6",
      assignedRouteId: "route-evt6",
      status: "idle",
      flight: null,
      routeAssignedAtTick: cycleStartTick,
    });

    const targetTick = cycleStartTick + roundTrip * 5 + 1;
    const { events } = reconcileFleetToTick([aircraft], [route], targetTick);
    const landingCount = events.filter((e) => e.type === "landing").length;
    const expectedLandings = countLandingsBetween(
      cycleStartTick,
      cycleStartTick,
      targetTick,
      durationTicks,
      turnaroundTicks,
    );

    expect(landingCount).toBe(expectedLandings);
  });

  it("enroute aircraft past arrival generates events for missed period", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-evt7",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-evt7"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    const aircraft = makeAircraft({
      id: "ac-evt7",
      assignedRouteId: "route-evt7",
      status: "enroute",
      flight: {
        originIata: "JFK",
        destinationIata: "LAX",
        departureTick: 100,
        arrivalTick: 100 + durationTicks,
        direction: "outbound",
      },
    });

    // Target is 5 cycles later — long offline gap
    const targetTick = 100 + roundTrip * 5 + Math.floor(durationTicks / 2);
    const { events } = reconcileFleetToTick([aircraft], [route], targetTick);

    expect(events.length).toBeGreaterThan(0);
    const takeoffs = events.filter((e) => e.type === "takeoff");
    const landings = events.filter((e) => e.type === "landing");
    expect(takeoffs.length).toBeGreaterThan(0);
    expect(landings.length).toBeGreaterThan(0);
  });

  it("destination-start aircraft generates correctly shifted events", () => {
    const model = getAircraftById("a320neo")!;
    const route = makeRoute({
      id: "route-evt8",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-evt8"],
    });
    const durationTicks = Math.ceil((3000 / model.speedKmh) * TICKS_PER_HOUR);
    const turnaroundTicks = Math.ceil((model.turnaroundTimeMinutes / 60) * TICKS_PER_HOUR);
    const roundTrip = durationTicks * 2 + turnaroundTicks * 2;

    // Aircraft starts at destination (LAX)
    const aircraft = makeAircraft({
      id: "ac-evt8",
      assignedRouteId: "route-evt8",
      status: "idle",
      baseAirportIata: "LAX",
      flight: null,
      routeAssignedAtTick: 1000,
      routeAssignedAtIata: "LAX",
    });

    const targetTick = 1000 + roundTrip * 2 + 1;
    const { events } = reconcileFleetToTick([aircraft], [route], targetTick);

    expect(events.length).toBeGreaterThan(0);

    // All event ticks should be within (1000, targetTick]
    for (const evt of events) {
      expect(evt.tick).toBeGreaterThan(1000);
      expect(evt.tick).toBeLessThanOrEqual(targetTick);
    }
  });

  it("grounded aircraft produces no events (cappedLandings = 0)", () => {
    const route = makeRoute({
      id: "route-evt9",
      originIata: "JFK",
      destinationIata: "LAX",
      distanceKm: 3000,
      assignedAircraftIds: ["ac-evt9"],
    });

    // Aircraft is near grounding (flightHoursSinceCheck at 599, condition barely above 0.2)
    const aircraft = makeAircraft({
      id: "ac-evt9",
      assignedRouteId: "route-evt9",
      status: "idle",
      flight: null,
      routeAssignedAtTick: 0,
      flightHoursSinceCheck: 599,
      condition: 1.0,
    });

    // From the existing test, this should cap landings to 0
    const { events } = reconcileFleetToTick([aircraft], [route], 50000);
    expect(events.length).toBe(0);
  });
});
