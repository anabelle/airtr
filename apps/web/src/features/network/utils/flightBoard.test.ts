import type { AircraftInstance, AirlineEntity } from "@acars/core";
import { fp } from "@acars/core";
import { describe, expect, it } from "vitest";
import { buildFlightBoardRows } from "./flightBoard";

const makeAirline = (overrides: Partial<AirlineEntity> = {}): AirlineEntity => ({
  id: "airline-1",
  foundedBy: "founder",
  status: "private",
  ceoPubkey: "player",
  sharesOutstanding: 10000000,
  shareholders: { player: 10000000 },
  name: "Test Air",
  icaoCode: "TST",
  callsign: "TEST",
  hubs: ["BOG"],
  livery: { primary: "#111111", secondary: "#222222", accent: "#333333" },
  brandScore: 0.7,
  tier: 1,
  cumulativeRevenue: fp(0),
  corporateBalance: fp(1000000),
  stockPrice: fp(0),
  fleetIds: [],
  routeIds: [],
  ...overrides,
});

const makeAircraft = (overrides: Partial<AircraftInstance> = {}): AircraftInstance => ({
  id: "ac-1",
  ownerPubkey: "player",
  modelId: "atr-72-600",
  name: "Ship 1",
  status: "idle",
  assignedRouteId: null,
  baseAirportIata: "BOG",
  purchasedAtTick: 0,
  purchasePrice: fp(100000000),
  birthTick: 0,
  purchaseType: "buy",
  configuration: { economy: 60, business: 0, first: 0, cargoKg: 0 },
  flightHoursTotal: 0,
  flightHoursSinceCheck: 0,
  condition: 1,
  flight: null,
  ...overrides,
});

describe("buildFlightBoardRows", () => {
  it("does not show aircraft on arrival board once they left destination", () => {
    const airline = makeAirline();
    const fleet = [
      makeAircraft({
        id: "ac-1",
        status: "idle",
        baseAirportIata: "MDE",
        flight: {
          originIata: "BOG",
          destinationIata: "MDE",
          departureTick: 100,
          arrivalTick: 200,
          direction: "outbound",
        },
      }),
    ];

    const rows = buildFlightBoardRows({
      airportIata: "BOG",
      airportTimezone: "America/Bogota",
      mode: "departures",
      fleet,
      globalFleet: [],
      airline,
      competitors: new Map(),
      tick: 250,
    });

    expect(rows).toHaveLength(0);
  });

  it("keeps enroute departures at the origin airport", () => {
    const airline = makeAirline();
    const fleet = [
      makeAircraft({
        id: "ac-2",
        status: "enroute",
        baseAirportIata: "BOG",
        flight: {
          originIata: "BOG",
          destinationIata: "MDE",
          departureTick: 100,
          arrivalTick: 200,
          direction: "outbound",
        },
      }),
    ];

    const rows = buildFlightBoardRows({
      airportIata: "BOG",
      airportTimezone: "America/Bogota",
      mode: "departures",
      fleet,
      globalFleet: [],
      airline,
      competitors: new Map(),
      tick: 150,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("En Route");
    expect(rows[0].otherIata).toBe("MDE");
  });

  it("shows arrivals only when enroute or on turnaround at destination", () => {
    const airline = makeAirline();
    const fleet = [
      makeAircraft({
        id: "ac-3",
        status: "turnaround",
        baseAirportIata: "BOG",
        flight: {
          originIata: "MDE",
          destinationIata: "BOG",
          departureTick: 100,
          arrivalTick: 200,
          direction: "outbound",
        },
        arrivalTickProcessed: 200,
        turnaroundEndTick: 260,
      }),
      makeAircraft({
        id: "ac-4",
        status: "idle",
        baseAirportIata: "BOG",
        flight: {
          originIata: "MDE",
          destinationIata: "BOG",
          departureTick: 100,
          arrivalTick: 200,
          direction: "outbound",
        },
      }),
    ];

    const rows = buildFlightBoardRows({
      airportIata: "BOG",
      airportTimezone: "America/Bogota",
      mode: "arrivals",
      fleet,
      globalFleet: [],
      airline,
      competitors: new Map(),
      tick: 210,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("Landed");
    expect(rows[0].otherIata).toBe("MDE");
  });

  it("shows arrivals while enroute before base updates", () => {
    const airline = makeAirline();
    const fleet = [
      makeAircraft({
        id: "ac-5",
        status: "enroute",
        baseAirportIata: "MDE",
        flight: {
          originIata: "MDE",
          destinationIata: "BOG",
          departureTick: 100,
          arrivalTick: 200,
          direction: "outbound",
        },
      }),
    ];

    const rows = buildFlightBoardRows({
      airportIata: "BOG",
      airportTimezone: "America/Bogota",
      mode: "arrivals",
      fleet,
      globalFleet: [],
      airline,
      competitors: new Map(),
      tick: 150,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("En Route");
    expect(rows[0].otherIata).toBe("MDE");
  });

  it("uses the active arrival tick for enroute arrivals", () => {
    const airline = makeAirline();
    const fleet = [
      makeAircraft({
        id: "ac-7",
        status: "enroute",
        baseAirportIata: "MDE",
        flight: {
          originIata: "MDE",
          destinationIata: "BOG",
          departureTick: 300,
          arrivalTick: 480,
          direction: "outbound",
        },
        arrivalTickProcessed: 200,
      }),
    ];

    const rows = buildFlightBoardRows({
      airportIata: "BOG",
      airportTimezone: "America/Bogota",
      mode: "arrivals",
      fleet,
      globalFleet: [],
      airline,
      competitors: new Map(),
      tick: 320,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].timeSort).toBe(480);
  });

  it("moves turnaround flights to departures after midpoint", () => {
    const airline = makeAirline();
    const fleet = [
      makeAircraft({
        id: "ac-6",
        status: "turnaround",
        baseAirportIata: "BOG",
        flight: {
          originIata: "MDE",
          destinationIata: "BOG",
          departureTick: 100,
          arrivalTick: 200,
          direction: "outbound",
        },
        arrivalTickProcessed: 200,
        turnaroundEndTick: 260,
      }),
    ];

    const arrivalsEarly = buildFlightBoardRows({
      airportIata: "BOG",
      airportTimezone: "America/Bogota",
      mode: "arrivals",
      fleet,
      globalFleet: [],
      airline,
      competitors: new Map(),
      tick: 220,
    });

    expect(arrivalsEarly).toHaveLength(1);

    const departuresLate = buildFlightBoardRows({
      airportIata: "BOG",
      airportTimezone: "America/Bogota",
      mode: "departures",
      fleet,
      globalFleet: [],
      airline,
      competitors: new Map(),
      tick: 235,
    });

    expect(departuresLate).toHaveLength(1);
    expect(departuresLate[0].status).toBe("Boarding");
    expect(departuresLate[0].otherIata).toBe("MDE");
  });

  it("deduplicates player aircraft that appear in global fleet", () => {
    const airline = makeAirline({ ceoPubkey: "player" });
    const aircraft = makeAircraft({
      id: "ac-dup",
      status: "enroute",
      flight: {
        originIata: "BOG",
        destinationIata: "MDE",
        departureTick: 100,
        arrivalTick: 200,
        direction: "outbound",
      },
    });

    const rows = buildFlightBoardRows({
      airportIata: "BOG",
      airportTimezone: "America/Bogota",
      mode: "departures",
      fleet: [aircraft],
      globalFleet: [{ ...aircraft }],
      airline,
      competitors: new Map(),
      tick: 150,
    });

    expect(rows).toHaveLength(1);
  });
});
