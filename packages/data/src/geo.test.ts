import { describe, it, expect } from "vitest";
import { findPreferredHub } from "./geo.js";

const airports = [
  { iata: "SM1", country: "AA", latitude: 10, longitude: 10, population: 100000 },
  { iata: "SM2", country: "AA", latitude: 12, longitude: 10, population: 200000 },
  { iata: "BIG", country: "AA", latitude: 30, longitude: 30, population: 1000000 },
  { iata: "BIG2", country: "AA", latitude: 31, longitude: 30, population: 1000000 },
  { iata: "FAR", country: "AA", latitude: 80, longitude: 80, population: 900000 },
  { iata: "BB1", country: "BB", latitude: -10, longitude: -10, population: 900000 },
  { iata: "BB2", country: "BB", latitude: -11, longitude: -11, population: 1000000 },
  { iata: "NONE", country: "CC", latitude: 5, longitude: 5, population: 0 },
  { iata: "NONE2", country: "CC", latitude: 6, longitude: 6, population: 0 },
] as const;

describe("findPreferredHub", () => {
  it("prefers largest city in nearest country", () => {
    const result = findPreferredHub(10.2, 10.1, airports as any);
    expect(result.iata).toBe("BIG");
  });

  it("uses distance to break ties for largest city", () => {
    const result = findPreferredHub(30.6, 30.0, airports as any);
    expect(result.iata).toBe("BIG2");
  });

  it("falls back to nearest when country population missing", () => {
    const result = findPreferredHub(5.1, 5.1, airports as any);
    expect(result.iata).toBe("NONE");
  });

  it("chooses nearest country by geography, not max population", () => {
    const result = findPreferredHub(-10.2, -10.1, airports as any);
    expect(result.country).toBe("BB");
  });

  it("returns nearest when country is unknown", () => {
    const unknownAirports = [
      { iata: "UNK1", country: "XX", latitude: 1, longitude: 1, population: 100 },
      { iata: "UNK2", country: "XX", latitude: 2, longitude: 2, population: 200 },
    ] as const;
    const result = findPreferredHub(1.1, 1.1, unknownAirports as any);
    expect(result.iata).toBe("UNK1");
  });

  it("behaves identically when occupiedIatas is empty", () => {
    const result = findPreferredHub(10.2, 10.1, airports as any, new Set());
    expect(result.iata).toBe("BIG");
  });

  it("skips occupied largest city and falls back to second largest in-country", () => {
    const occupied = new Set(["BIG", "BIG2"]);
    const result = findPreferredHub(10.2, 10.1, airports as any, occupied);
    // FAR (900k) > SM2 (200k) > SM1 (100k)
    expect(result.iata).toBe("FAR");
  });

  it("skips occupied airports in order and picks next biggest", () => {
    const occupied = new Set(["BIG", "BIG2", "FAR"]);
    const result = findPreferredHub(10.2, 10.1, airports as any, occupied);
    // SM2 (200k) > SM1 (100k)
    expect(result.iata).toBe("SM2");
  });

  it("expands globally when all in-country airports are occupied", () => {
    const occupied = new Set(["BIG", "BIG2", "FAR", "SM1", "SM2"]);
    // User near AA (lat 10, lon 10) — all AA airports occupied.
    // BB1 (-10,-10) pop 900k, BB2 (-11,-11) pop 1M → BB2 wins on population/distance score.
    const result = findPreferredHub(10.2, 10.1, airports as any, occupied);
    expect(result.country).toBe("BB");
  });

  it("falls back to biggest in-country when everything globally is occupied", () => {
    const allIatas = new Set(airports.map((a) => a.iata));
    const result = findPreferredHub(10.2, 10.1, airports as any, allIatas);
    // Falls back to the biggest city in nearest country (BIG)
    expect(result.iata).toBe("BIG");
  });

  it("keeps zero-population domestic airports in the in-country fallback", () => {
    const result = findPreferredHub(5.1, 5.1, airports as any, new Set(["NONE"]));
    expect(result.iata).toBe("NONE2");
  });

  it("prefers close smaller city over far megacity when expanding globally", () => {
    // Airports: close small city vs far megacity
    const testAirports = [
      { iata: "HOME", country: "XX1", latitude: 0, longitude: 0, population: 500000 },
      { iata: "NEAR", country: "YY", latitude: 2, longitude: 2, population: 800000 },
      { iata: "MEGA", country: "ZZ", latitude: 60, longitude: 60, population: 5000000 },
    ] as const;
    const occupied = new Set(["HOME"]);
    const result = findPreferredHub(0.1, 0.1, testAirports as any, occupied);
    // NEAR is much closer → score(NEAR) should beat score(MEGA)
    expect(result.iata).toBe("NEAR");
  });

  it("distributes Colombian-style scenario across cities", () => {
    // Simulates the exact user scenario: multiple friends in Colombia
    const colombiaAirports = [
      { iata: "BOG", country: "CO", latitude: 4.7, longitude: -74.14, population: 7400000 },
      { iata: "MDE", country: "CO", latitude: 6.17, longitude: -75.43, population: 2500000 },
      { iata: "CLO", country: "CO", latitude: 3.54, longitude: -76.38, population: 2200000 },
      { iata: "BAQ", country: "CO", latitude: 10.89, longitude: -74.78, population: 1200000 },
      { iata: "CTG", country: "CO", latitude: 10.39, longitude: -75.51, population: 900000 },
    ] as const;

    // All users are near Bogota
    const lat = 4.65;
    const lon = -74.1;

    // First user → Bogota (biggest)
    const r1 = findPreferredHub(lat, lon, colombiaAirports as any, new Set());
    expect(r1.iata).toBe("BOG");

    // Second user → Medellin (second biggest)
    const r2 = findPreferredHub(lat, lon, colombiaAirports as any, new Set(["BOG"]));
    expect(r2.iata).toBe("MDE");

    // Third user → Cali (third biggest)
    const r3 = findPreferredHub(lat, lon, colombiaAirports as any, new Set(["BOG", "MDE"]));
    expect(r3.iata).toBe("CLO");

    // Fourth user → Barranquilla
    const r4 = findPreferredHub(lat, lon, colombiaAirports as any, new Set(["BOG", "MDE", "CLO"]));
    expect(r4.iata).toBe("BAQ");

    // Fifth user → Cartagena
    const r5 = findPreferredHub(
      lat,
      lon,
      colombiaAirports as any,
      new Set(["BOG", "MDE", "CLO", "BAQ"]),
    );
    expect(r5.iata).toBe("CTG");
  });
});
