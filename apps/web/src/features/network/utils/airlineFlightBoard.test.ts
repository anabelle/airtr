import type { AircraftInstance, AirlineEntity } from "@acars/core";
import { fp } from "@acars/core";
import { describe, expect, it } from "vitest";
import { buildAirlineFlightBoardRows, countAirlineFlightBoardRows } from "./airlineFlightBoard";

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

describe("airlineFlightBoard", () => {
  it("returns the same window slice as the full sorted board", () => {
    const airline = makeAirline();
    const tick = 190;
    const fleet = [
      makeAircraft({
        id: "ac-late",
        flight: {
          originIata: "BOG",
          destinationIata: "MDE",
          departureTick: 320,
          arrivalTick: 420,
          direction: "outbound",
        },
      }),
      makeAircraft({
        id: "ac-turn",
        status: "turnaround",
        baseAirportIata: "MDE",
        arrivalTickProcessed: 150,
        turnaroundEndTick: 250,
        flight: {
          originIata: "BOG",
          destinationIata: "MDE",
          departureTick: 100,
          arrivalTick: 150,
          direction: "outbound",
        },
      }),
      makeAircraft({
        id: "ac-early",
        status: "enroute",
        flight: {
          originIata: "BOG",
          destinationIata: "CLO",
          departureTick: 80,
          arrivalTick: 180,
          direction: "outbound",
        },
      }),
      makeAircraft({
        id: "ac-mid",
        flight: {
          originIata: "BOG",
          destinationIata: "CTG",
          departureTick: 260,
          arrivalTick: 360,
          direction: "outbound",
        },
      }),
    ];

    const fullRows = buildAirlineFlightBoardRows(fleet, airline, tick);
    const windowRows = buildAirlineFlightBoardRows(fleet, airline, tick, { start: 1, end: 2 });

    expect(windowRows).toEqual(fullRows.slice(1, 3));
  });

  it("counts only aircraft that can appear on the board", () => {
    const fleet = [
      makeAircraft({
        id: "eligible-1",
        flight: {
          originIata: "BOG",
          destinationIata: "MDE",
          departureTick: 100,
          arrivalTick: 200,
          direction: "outbound",
        },
      }),
      makeAircraft({
        id: "eligible-2",
        status: "enroute",
        flight: {
          originIata: "MDE",
          destinationIata: "BOG",
          departureTick: 120,
          arrivalTick: 260,
          direction: "outbound",
        },
      }),
      makeAircraft({
        id: "no-flight",
      }),
      makeAircraft({
        id: "maintenance",
        status: "maintenance",
        flight: {
          originIata: "BOG",
          destinationIata: "MDE",
          departureTick: 140,
          arrivalTick: 240,
          direction: "outbound",
        },
      }),
      makeAircraft({
        id: "delivery",
        status: "delivery",
        flight: {
          originIata: "BOG",
          destinationIata: "MDE",
          departureTick: 160,
          arrivalTick: 280,
          direction: "outbound",
        },
      }),
    ];

    expect(countAirlineFlightBoardRows(fleet)).toBe(2);
  });
});
