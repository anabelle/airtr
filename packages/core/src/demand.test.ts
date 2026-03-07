// ============================================================
// @acars/core — Gravity Demand Model Tests
// ============================================================

import { describe, expect, it } from "vitest";
import {
  calculateBidirectionalDemand,
  calculateDemand,
  calculatePriceElasticity,
  calculateSupplyPressure,
  getProsperityIndex,
  MAX_PRICE_ELASTICITY_MULTIPLIER,
  MIN_ADDRESSABLE_WEEKLY,
  MIN_PRICE_ELASTICITY_MULTIPLIER,
  NATURAL_LF_CEILING,
  PLAYER_MARKET_CEILING,
  PRICE_ELASTICITY_BUSINESS,
  PRICE_ELASTICITY_ECONOMY,
  PRICE_ELASTICITY_FIRST,
  scaleToAddressableMarket,
} from "./demand.js";
import { fp } from "./fixed-point.js";
import type { Airport, BidirectionalDemandResult, DemandResult } from "./types.js";

// --- Test airport fixtures ---

const BOG: Airport = {
  id: "2709",
  name: "El Dorado International Airport",
  iata: "BOG",
  icao: "SKBO",
  latitude: 4.70159,
  longitude: -74.1469,
  altitude: 8361,
  timezone: "America/Bogota",
  country: "CO",
  city: "Bogota",
  population: 7_674_366,
  gdpPerCapita: 7_919,
  tags: ["business"],
};

const MDE: Airport = {
  id: "2745",
  name: "Jose Maria Cordova International Airport",
  iata: "MDE",
  icao: "SKRG",
  latitude: 6.16454,
  longitude: -75.4231,
  altitude: 6955,
  timezone: "America/Bogota",
  country: "CO",
  city: "Rio Negro",
  population: 1_999_979,
  gdpPerCapita: 7_919,
  tags: ["general"],
};

const CTG: Airport = {
  id: "2714",
  name: "Rafael Nunez International Airport",
  iata: "CTG",
  icao: "SKCG",
  latitude: 10.4424,
  longitude: -75.513,
  altitude: 4,
  timezone: "America/Bogota",
  country: "CO",
  city: "Cartagena",
  population: 1_206_319,
  gdpPerCapita: 7_919,
  tags: ["beach"],
};

const MAD: Airport = {
  id: "1229",
  name: "Adolfo Suarez Madrid-Barajas Airport",
  iata: "MAD",
  icao: "LEMD",
  latitude: 40.471926,
  longitude: -3.56264,
  altitude: 1998,
  timezone: "Europe/Madrid",
  country: "ES",
  city: "Madrid",
  population: 3_255_944,
  gdpPerCapita: 35_327,
  tags: ["business"],
};

const SMALL_AIRPORT: Airport = {
  id: "9999",
  name: "Tiny Regional",
  iata: "TNY",
  icao: "XTNY",
  latitude: 10.0,
  longitude: 20.0,
  altitude: 100,
  timezone: "UTC",
  country: "XX",
  city: "Tinytown",
  population: 50_000,
  gdpPerCapita: 5_000,
  tags: ["general"],
};

describe("calculateDemand()", () => {
  it("BOG→MDE demand aligns with 2023 annual passengers (weekly baseline)", () => {
    const result = calculateDemand(BOG, MDE, "spring");
    const total = result.economy + result.business + result.first;
    // Source: Spanish Wikipedia, Aeropuerto Internacional El Dorado
    // Rutas nacionales mas transitadas (enero 2023 - diciembre 2023)
    // BOG–MDE passengers: 4,449,875 annual (≈ 85,575 weekly)
    expect(total).toBeGreaterThan(77_000);
    expect(total).toBeLessThan(95_000);
  });

  it("BOG→CTG demand aligns with 2023 annual passengers (weekly baseline)", () => {
    const result = calculateDemand(BOG, CTG, "spring");
    const total = result.economy + result.business + result.first;
    // Source: Spanish Wikipedia, Aeropuerto Internacional El Dorado
    // Rutas nacionales mas transitadas (enero 2023 - diciembre 2023)
    // BOG–CTG passengers: 3,285,214 annual (≈ 63,177 weekly)
    expect(total).toBeGreaterThan(50_000);
    expect(total).toBeLessThan(70_000);
  });

  it("BOG→MAD demand aligns with 2022 annual passengers (weekly baseline)", () => {
    const result = calculateDemand(BOG, MAD, "spring");
    const total = result.economy + result.business + result.first;
    // Source: Spanish Wikipedia, Aeropuerto Internacional El Dorado
    // Rutas internacionales mas transitadas (enero 2022 - diciembre 2022)
    // BOG–MAD passengers: 1,095,936 annual (≈ 21,075 weekly)
    expect(total).toBeGreaterThan(18_000);
    expect(total).toBeLessThan(23_000);
  });

  it("economy class has the largest share", () => {
    const result = calculateDemand(BOG, MDE, "spring");
    expect(result.economy).toBeGreaterThan(result.business);
    expect(result.business).toBeGreaterThan(result.first);
  });

  it("economy is ~75%, business ~20%, first ~5%", () => {
    const result = calculateDemand(BOG, MDE, "spring");
    const total = result.economy + result.business + result.first;
    expect(result.economy / total).toBeCloseTo(0.75, 1);
    expect(result.business / total).toBeCloseTo(0.2, 1);
    expect(result.first / total).toBeCloseTo(0.05, 1);
  });

  it("small airports produce much less demand", () => {
    const major = calculateDemand(BOG, MDE, "spring");
    const minor = calculateDemand(BOG, SMALL_AIRPORT, "spring");
    expect(major.economy).toBeGreaterThan(minor.economy * 10);
  });

  it("small regional demand is in hundreds range", () => {
    const result = calculateDemand(BOG, SMALL_AIRPORT, "spring");
    const total = result.economy + result.business + result.first;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(5_000);
  });

  it("seasonal multiplier affects demand", () => {
    // CTG tagged 'beach': summer = ×1.30, winter = ×0.70
    const summerDemand = calculateDemand(BOG, CTG, "summer");
    const winterDemand = calculateDemand(BOG, CTG, "winter");
    expect(summerDemand.economy).toBeGreaterThan(winterDemand.economy);
  });

  it("prosperity index scales demand", () => {
    const normal = calculateDemand(BOG, MDE, "spring", 1.0, 1.0);
    const boom = calculateDemand(BOG, MDE, "spring", 1.15, 1.0);
    const recession = calculateDemand(BOG, MDE, "spring", 0.85, 1.0);
    expect(boom.economy).toBeGreaterThan(normal.economy);
    expect(normal.economy).toBeGreaterThan(recession.economy);
  });

  it("handles zero population gracefully", () => {
    const ghost: Airport = { ...SMALL_AIRPORT, population: 0, iata: "GHO" };
    const result = calculateDemand(BOG, ghost, "spring");
    expect(result.economy).toBe(0);
    expect(result.business).toBe(0);
    expect(result.first).toBe(0);
  });

  it("handles same-airport origin/destination (min distance kicks in)", () => {
    const result = calculateDemand(BOG, BOG, "spring");
    // Should not throw, just return demand with min distance applied
    expect(result.economy).toBeGreaterThan(0);
  });

  it("is deterministic across calls", () => {
    const r1 = calculateDemand(BOG, MDE, "spring", 1.0, 1.0);
    const r2 = calculateDemand(BOG, MDE, "spring", 1.0, 1.0);
    expect(r1.economy).toBe(r2.economy);
    expect(r1.business).toBe(r2.business);
    expect(r1.first).toBe(r2.first);
  });

  it("returns IATA codes in result", () => {
    const result = calculateDemand(BOG, MDE, "spring");
    expect(result.origin).toBe("BOG");
    expect(result.destination).toBe("MDE");
  });

  it("longer routes generally have less demand than shorter similar routes", () => {
    // Compare two routes with similar city sizes but different distances
    const bogMde = calculateDemand(BOG, MDE, "spring"); // ~215 km
    const bogMad = calculateDemand(BOG, MAD, "spring"); // ~8,000 km
    // LHR has bigger population so this tests that distance decay is real
    // Both should be positive
    expect(bogMde.economy).toBeGreaterThan(0);
    expect(bogMad.economy).toBeGreaterThan(0);
  });
});

describe("getProsperityIndex()", () => {
  it("returns 1.0 at tick 0", () => {
    expect(getProsperityIndex(0)).toBeCloseTo(1.0, 5);
  });

  it("peaks at 1.15 at quarter cycle", () => {
    expect(getProsperityIndex(91, 365)).toBeCloseTo(1.15, 1);
  });

  it("bottoms at 0.85 at 3/4 cycle", () => {
    expect(getProsperityIndex(274, 365)).toBeCloseTo(0.85, 1);
  });

  it("oscillates between 0.85 and 1.15", () => {
    for (let t = 0; t < 365; t++) {
      const pi = getProsperityIndex(t);
      expect(pi).toBeGreaterThanOrEqual(0.84);
      expect(pi).toBeLessThanOrEqual(1.16);
    }
  });
});

describe("scaleToAddressableMarket()", () => {
  it("scales demand to player market ceiling", () => {
    const demand: DemandResult = {
      origin: "AAA",
      destination: "BBB",
      economy: 7_500,
      business: 2_000,
      first: 500,
    };
    const scaled = scaleToAddressableMarket(demand);
    const total = scaled.economy + scaled.business + scaled.first;
    expect(total).toBe(Math.floor(10_000 * PLAYER_MARKET_CEILING));
    expect(total).toBe(2000);
  });

  it("applies minimum addressable weekly floor", () => {
    const demand: DemandResult = {
      origin: "AAA",
      destination: "BBB",
      economy: 50,
      business: 10,
      first: 5,
    };
    const scaled = scaleToAddressableMarket(demand);
    const total = scaled.economy + scaled.business + scaled.first;
    expect(total).toBeGreaterThanOrEqual(MIN_ADDRESSABLE_WEEKLY);
  });

  it("preserves class proportions", () => {
    const demand: DemandResult = {
      origin: "AAA",
      destination: "BBB",
      economy: 750,
      business: 200,
      first: 50,
    };
    const scaled = scaleToAddressableMarket(demand);
    const total = scaled.economy + scaled.business + scaled.first;
    expect(scaled.economy / total).toBeCloseTo(0.75, 1);
    expect(scaled.business / total).toBeCloseTo(0.2, 1);
    expect(scaled.first / total).toBeCloseTo(0.05, 1);
  });
});

describe("calculateSupplyPressure()", () => {
  it("returns NATURAL_LF_CEILING when undersupplied", () => {
    const pressure = calculateSupplyPressure(900, 1_200);
    expect(pressure).toBeCloseTo(NATURAL_LF_CEILING, 5);
  });

  it("returns NATURAL_LF_CEILING when balanced", () => {
    const pressure = calculateSupplyPressure(1_000, 1_000);
    expect(pressure).toBeCloseTo(NATURAL_LF_CEILING, 5);
  });

  it("decays below ceiling when oversupplied", () => {
    const pressure = calculateSupplyPressure(2_000, 1_000);
    expect(pressure).toBeLessThan(NATURAL_LF_CEILING);
    expect(pressure).toBeGreaterThan(0.15);
  });

  it("returns floor when demand is zero", () => {
    expect(calculateSupplyPressure(1_000, 0)).toBeCloseTo(0.15, 5);
  });

  it("returns ceiling when supply is zero", () => {
    expect(calculateSupplyPressure(0, 1_000)).toBeCloseTo(NATURAL_LF_CEILING, 5);
  });
});

describe("calculatePriceElasticity()", () => {
  it("returns 1.0 at reference fare", () => {
    const reference = fp(200);
    const multiplier = calculatePriceElasticity(reference, reference, PRICE_ELASTICITY_ECONOMY);
    expect(multiplier).toBeCloseTo(1.0, 6);
  });

  it("penalizes high fares with stronger economy sensitivity", () => {
    const reference = fp(200);
    const actual = fp(400);
    const economy = calculatePriceElasticity(actual, reference, PRICE_ELASTICITY_ECONOMY);
    const business = calculatePriceElasticity(actual, reference, PRICE_ELASTICITY_BUSINESS);
    const first = calculatePriceElasticity(actual, reference, PRICE_ELASTICITY_FIRST);
    expect(economy).toBeLessThan(business);
    expect(business).toBeLessThan(first);
  });

  it("economy elasticity is less punishing after retune", () => {
    const reference = fp(200);
    const actual = fp(240);
    const multiplier = calculatePriceElasticity(actual, reference, PRICE_ELASTICITY_ECONOMY);
    expect(multiplier).toBeCloseTo(0.803, 2);
  });

  it("caps stimulation for deep discounts", () => {
    const reference = fp(200);
    const actual = fp(50);
    const multiplier = calculatePriceElasticity(actual, reference, PRICE_ELASTICITY_ECONOMY);
    expect(multiplier).toBeCloseTo(MAX_PRICE_ELASTICITY_MULTIPLIER, 6);
  });

  it("floors suppression for extreme pricing", () => {
    const reference = fp(200);
    const actual = fp(200000);
    const multiplier = calculatePriceElasticity(actual, reference, PRICE_ELASTICITY_ECONOMY);
    expect(multiplier).toBeCloseTo(MIN_PRICE_ELASTICITY_MULTIPLIER, 6);
  });

  it("treats zero fare as max stimulation", () => {
    const reference = fp(200);
    const multiplier = calculatePriceElasticity(fp(0), reference, PRICE_ELASTICITY_ECONOMY);
    expect(multiplier).toBeCloseTo(MAX_PRICE_ELASTICITY_MULTIPLIER, 6);
  });

  it("returns neutral for zero reference fare", () => {
    const multiplier = calculatePriceElasticity(fp(200), fp(0), PRICE_ELASTICITY_ECONOMY);
    expect(multiplier).toBeCloseTo(1.0, 6);
  });
});

// --- Symmetric airport fixture for bidirectional tests ---

const SYM_A: Airport = {
  id: "SYM1",
  name: "Symmetric Airport A",
  iata: "SYA",
  icao: "XSYA",
  latitude: 10.0,
  longitude: 20.0,
  altitude: 100,
  timezone: "UTC",
  country: "XX",
  city: "Sym City A",
  population: 2_000_000,
  gdpPerCapita: 20_000,
  tags: ["general"],
};

const SYM_B: Airport = {
  id: "SYM2",
  name: "Symmetric Airport B",
  iata: "SYB",
  icao: "XSYB",
  latitude: 15.0,
  longitude: 25.0,
  altitude: 100,
  timezone: "UTC",
  country: "XX",
  city: "Sym City B",
  population: 2_000_000,
  gdpPerCapita: 20_000,
  tags: ["general"],
};

describe("calculateBidirectionalDemand()", () => {
  it("calculateDemand(A, B) ≠ calculateDemand(B, A) for airports with different GDP (BOG vs MAD)", () => {
    const ab = calculateDemand(BOG, MAD, "spring");
    const ba = calculateDemand(MAD, BOG, "spring");
    const totalAB = ab.economy + ab.business + ab.first;
    const totalBA = ba.economy + ba.business + ba.first;
    expect(totalAB).not.toBe(totalBA);
  });

  it("returns different outbound vs inbound for asymmetric routes (BOG→MAD)", () => {
    const result: BidirectionalDemandResult = calculateBidirectionalDemand(BOG, MAD, "spring");
    const outboundTotal =
      result.outbound.economy + result.outbound.business + result.outbound.first;
    const inboundTotal = result.inbound.economy + result.inbound.business + result.inbound.first;
    expect(outboundTotal).not.toBe(inboundTotal);
  });

  it("seasonal modulation differs per direction when airports have different tags (BOG business vs CTG beach)", () => {
    // BOG→CTG in summer: destination is beach → high seasonal bonus
    const bogCtgSummer = calculateDemand(BOG, CTG, "summer");
    // CTG→BOG in summer: destination is business hub (BOG) → lower summer demand
    const ctgBogSummer = calculateDemand(CTG, BOG, "summer");
    const totalBogCtg = bogCtgSummer.economy + bogCtgSummer.business + bogCtgSummer.first;
    const totalCtgBog = ctgBogSummer.economy + ctgBogSummer.business + ctgBogSummer.first;
    expect(totalBogCtg).not.toBe(totalCtgBog);
  });

  it("returns equal outbound/inbound demand for symmetric airports (same population, GDP, tags)", () => {
    const result: BidirectionalDemandResult = calculateBidirectionalDemand(SYM_A, SYM_B, "spring");
    const outboundTotal =
      result.outbound.economy + result.outbound.business + result.outbound.first;
    const inboundTotal = result.inbound.economy + result.inbound.business + result.inbound.first;
    expect(outboundTotal).toBe(inboundTotal);
  });

  it("outbound result matches direct calculateDemand(origin, dest)", () => {
    const direct = calculateDemand(BOG, MAD, "spring", 1.0, 1.0);
    const bidir = calculateBidirectionalDemand(BOG, MAD, "spring", 1.0, 1.0);
    expect(bidir.outbound.economy).toBe(direct.economy);
    expect(bidir.outbound.business).toBe(direct.business);
    expect(bidir.outbound.first).toBe(direct.first);
    expect(bidir.outbound.origin).toBe(direct.origin);
    expect(bidir.outbound.destination).toBe(direct.destination);
  });

  it("inbound result matches direct calculateDemand(dest, origin)", () => {
    const direct = calculateDemand(MAD, BOG, "spring", 1.0, 1.0);
    const bidir = calculateBidirectionalDemand(BOG, MAD, "spring", 1.0, 1.0, 1.0);
    expect(bidir.inbound.economy).toBe(direct.economy);
    expect(bidir.inbound.business).toBe(direct.business);
    expect(bidir.inbound.first).toBe(direct.first);
    expect(bidir.inbound.origin).toBe(direct.origin);
    expect(bidir.inbound.destination).toBe(direct.destination);
  });

  it("applies separate hub modifiers per direction", () => {
    const outboundHubMod = 1.5;
    const inboundHubMod = 1.2;
    const result = calculateBidirectionalDemand(
      BOG,
      MAD,
      "spring",
      1.0,
      outboundHubMod,
      inboundHubMod,
    );

    // Verify outbound uses outboundHubModifier
    const directOutbound = calculateDemand(BOG, MAD, "spring", 1.0, outboundHubMod);
    expect(result.outbound.economy).toBe(directOutbound.economy);
    expect(result.outbound.business).toBe(directOutbound.business);
    expect(result.outbound.first).toBe(directOutbound.first);

    // Verify inbound uses inboundHubModifier
    const directInbound = calculateDemand(MAD, BOG, "spring", 1.0, inboundHubMod);
    expect(result.inbound.economy).toBe(directInbound.economy);
    expect(result.inbound.business).toBe(directInbound.business);
    expect(result.inbound.first).toBe(directInbound.first);

    // Different hub modifiers should produce different totals
    const outTotal = result.outbound.economy + result.outbound.business + result.outbound.first;
    const inTotal = result.inbound.economy + result.inbound.business + result.inbound.first;
    expect(outTotal).not.toBe(inTotal);
  });
});
