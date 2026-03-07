import { fp, fpToNumber } from "@acars/core";
import { describe, expect, it } from "vitest";
import { estimateRouteEconomics } from "./routeEconomics";

const mockAircraft = {
  speedKmh: 667,
  turnaroundTimeMinutes: 25,
  blockHoursPerDay: 16,
  capacity: { economy: 70, business: 0, first: 0, cargoKg: 0 },
  fuelBurnKgPerHour: 900,
  fuelBurnKgPerKm: 1.1,
  maxTakeoffWeight: 29257,
  wingspanM: 28,
  engineCount: 2 as const,
  maintCostPerHour: fp(400),
  crewRequired: { cockpit: 2, cabin: 2 },
  monthlyLease: fp(145000),
};

describe("estimateRouteEconomics", () => {
  it("projects profit, break-even load factor, and supply ratio", () => {
    const projection = estimateRouteEconomics({
      route: {
        originIata: "PTY",
        destinationIata: "BOG",
        distanceKm: 761,
        fareEconomy: fp(164),
        fareBusiness: fp(454),
        fareFirst: fp(1009),
      },
      addressableDemand: {
        origin: "PTY",
        destination: "BOG",
        economy: 4282,
        business: 1142,
        first: 285,
      },
      pressureMultiplier: 0.88,
      effectiveLoadFactor: 0.82,
      aircraft: mockAircraft,
      aircraftCount: 1,
      cabinConfig: mockAircraft.capacity,
      includeFixedCosts: true,
    });

    expect(projection.frequencyPerWeek).toBeGreaterThan(0);
    expect(projection.estimatedLoadFactor).toBeGreaterThan(0);
    expect(projection.breakEvenLoadFactor).toBeGreaterThan(0);
    expect(projection.supplyRatio).toBeGreaterThan(0);
    expect(fpToNumber(projection.costPerFlight)).toBeGreaterThan(0);
  });
});
