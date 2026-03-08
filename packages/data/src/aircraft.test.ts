import { describe, expect, it } from "vitest";
import {
  aircraftByFamilyId,
  aircraftByTier,
  aircraftModels,
  getAircraftById,
  getAircraftByType,
} from "./aircraft.js";

const expectedWave1Ids = [
  "atr42-600",
  "dash8-300",
  "a220-100",
  "e175",
  "e195-e2",
  "a320-200",
  "a321lr",
  "a330-200",
  "b787-8",
  "b777-200er",
  "a350-1000",
] as const;

const expectedWave2Ids = [
  "e170",
  "e190",
  "a319neo",
  "a321xlr",
  "b737-700",
  "b737-900er",
  "b737-max9",
  "b787-10",
  "b777-200lr",
] as const;

describe("aircraft", () => {
  describe("aircraftModels", () => {
    it("contains aircraft models", () => {
      expect(aircraftModels.length).toBeGreaterThan(0);
      expect(aircraftModels.length).toBe(35);
    });

    it("each aircraft has required fields", () => {
      for (const aircraft of aircraftModels) {
        expect(aircraft.id).toBeDefined();
        expect(aircraft.manufacturer).toBeDefined();
        expect(aircraft.name).toBeDefined();
        if (aircraft.catalogImageUrl !== undefined) {
          expect(typeof aircraft.catalogImageUrl).toBe("string");
        }
        expect(aircraft.type).toBeDefined();
        expect(aircraft.rangeKm).toBeGreaterThan(0);
        expect(aircraft.speedKmh).toBeGreaterThan(0);
        expect(aircraft.wingspanM).toBeGreaterThan(0);
        expect(aircraft.maxTakeoffWeight).toBeGreaterThan(0);
        expect(aircraft.capacity).toBeDefined();
        expect(
          aircraft.capacity.economy + aircraft.capacity.business + aircraft.capacity.first,
        ).toBeGreaterThan(0);
        expect(aircraft.capacity.cargoKg).toBeGreaterThanOrEqual(0);
        expect(aircraft.fuelBurnKgPerHour).toBeGreaterThan(0);
        expect(aircraft.fuelBurnKgPerKm).toBeGreaterThan(0);
        expect(aircraft.turnaroundTimeMinutes).toBeGreaterThan(0);
        expect(aircraft.price).toBeDefined();
      }
    });

    it("includes the planned wave 1 and wave 2 models", () => {
      const ids = new Set(aircraftModels.map((aircraft) => aircraft.id));
      for (const id of [...expectedWave1Ids, ...expectedWave2Ids]) {
        expect(ids.has(id)).toBe(true);
      }
    });

    it("has unique aircraft ids", () => {
      const ids = aircraftModels.map((aircraft) => aircraft.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("has correct unlock tiers", () => {
      const tiers = new Set(aircraftModels.map((a) => a.unlockTier));
      expect(tiers.has(1)).toBe(true);
      expect(tiers.has(2)).toBe(true);
      expect(tiers.has(3)).toBe(true);
      expect(tiers.has(4)).toBe(true);
    });
  });

  describe("aircraftByFamilyId", () => {
    it("groups aircraft by family ID", () => {
      const a320Family = aircraftByFamilyId.get("a320");
      expect(a320Family).toBeDefined();
      expect(a320Family!.length).toBeGreaterThanOrEqual(6);
      expect(a320Family!.every((a) => a.familyId === "a320")).toBe(true);
    });

    it("includes atr family", () => {
      const atrFamily = aircraftByFamilyId.get("atr");
      expect(atrFamily).toBeDefined();
      expect(atrFamily!.length).toBeGreaterThanOrEqual(2);
    });

    it("preserves expected family counts for expanded families", () => {
      expect(aircraftByFamilyId.get("dash8")?.length).toBe(2);
      expect(aircraftByFamilyId.get("a220")?.length).toBe(2);
      expect(aircraftByFamilyId.get("ejet")?.length).toBe(5);
      expect(aircraftByFamilyId.get("a320")?.length).toBe(6);
      expect(aircraftByFamilyId.get("b737")?.length).toBe(5);
      expect(aircraftByFamilyId.get("a330")?.length).toBe(3);
      expect(aircraftByFamilyId.get("b787")?.length).toBe(3);
      expect(aircraftByFamilyId.get("b777")?.length).toBe(3);
      expect(aircraftByFamilyId.get("a350")?.length).toBe(2);
    });
  });

  describe("aircraftByTier", () => {
    it("groups aircraft by unlock tier", () => {
      const tier1 = aircraftByTier.get(1);
      expect(tier1).toBeDefined();
      expect(tier1!.length).toBeGreaterThan(0);
      expect(tier1!.every((a) => a.unlockTier === 1)).toBe(true);
    });

    it("matches the expanded tier distribution", () => {
      const tier1Count = aircraftByTier.get(1)!.length;
      const tier2Count = aircraftByTier.get(2)!.length;
      const tier3Count = aircraftByTier.get(3)!.length;
      const tier4Count = aircraftByTier.get(4)!.length;
      expect(tier1Count).toBe(4);
      expect(tier2Count).toBe(17);
      expect(tier3Count).toBe(9);
      expect(tier4Count).toBe(5);
    });
  });

  describe("getAircraftById", () => {
    it("finds aircraft by ID", () => {
      const aircraft = getAircraftById("a320neo");
      expect(aircraft).toBeDefined();
      expect(aircraft!.name).toBe("A320neo");
    });

    it("returns undefined for unknown ID", () => {
      const aircraft = getAircraftById("unknown-aircraft");
      expect(aircraft).toBeUndefined();
    });
  });

  describe("getAircraftByType", () => {
    it("filters by turboprop type", () => {
      const turboprops = getAircraftByType("turboprop");
      expect(turboprops.length).toBe(4);
      expect(turboprops.every((a) => a.type === "turboprop")).toBe(true);
    });

    it("filters by widebody type", () => {
      const widebodies = getAircraftByType("widebody");
      expect(widebodies.length).toBe(13);
      expect(widebodies.every((a) => a.type === "widebody")).toBe(true);
    });

    it("filters by narrowbody type", () => {
      const narrowbodies = getAircraftByType("narrowbody");
      expect(narrowbodies.length).toBe(11);
      expect(narrowbodies.every((a) => a.type === "narrowbody")).toBe(true);
    });

    it("filters by regional type", () => {
      const regionals = getAircraftByType("regional");
      expect(regionals.length).toBe(7);
      expect(regionals.every((a) => a.type === "regional")).toBe(true);
    });
  });
});
