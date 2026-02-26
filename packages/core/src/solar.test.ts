import { describe, expect, it } from "vitest";
import { computeNightOverlay, getSolarDeclination, getSubsolarPoint } from "./solar.js";

describe("solar", () => {
  describe("getSolarDeclination", () => {
    it("is near zero at March equinox", () => {
      const decl = getSolarDeclination(new Date("2024-03-20T12:00:00Z"));
      expect(Math.abs(decl)).toBeLessThan(1.0);
    });

    it("is near +23.4 at June solstice", () => {
      const decl = getSolarDeclination(new Date("2024-06-20T12:00:00Z"));
      expect(decl).toBeGreaterThan(22.0);
      expect(decl).toBeLessThan(24.5);
    });

    it("is near -23.4 at December solstice", () => {
      const decl = getSolarDeclination(new Date("2024-12-21T12:00:00Z"));
      expect(decl).toBeLessThan(-22.0);
      expect(decl).toBeGreaterThan(-24.5);
    });
  });

  describe("getSubsolarPoint", () => {
    it("returns latitude close to declination", () => {
      const date = new Date("2024-09-22T12:00:00Z");
      const decl = getSolarDeclination(date);
      const { lat } = getSubsolarPoint(date);
      expect(lat).toBeCloseTo(decl, 6);
    });
  });

  describe("computeNightOverlay", () => {
    it("builds a feature collection with three bands", () => {
      const overlay = computeNightOverlay(new Date("2024-03-20T12:00:00Z"));
      expect(overlay.type).toBe("FeatureCollection");
      expect(overlay.features).toHaveLength(3);
      expect(overlay.features.map((f) => f.properties.band)).toEqual(["civil", "astro", "core"]);
    });

    it("produces valid polygon rings", () => {
      const overlay = computeNightOverlay(new Date("2024-06-20T12:00:00Z"), 5);
      for (const feature of overlay.features) {
        const [outer, ...holes] = feature.geometry.coordinates;
        expect(outer.length).toBeGreaterThan(3);
        expect(outer[0]).toEqual(outer[outer.length - 1]);
        expect(holes.length).toBeGreaterThan(0);
        for (const hole of holes) {
          expect(hole.length).toBeGreaterThanOrEqual(3);
          expect(hole[0]).toEqual(hole[hole.length - 1]);
        }
      }
    });
  });
});
