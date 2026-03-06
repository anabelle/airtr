import { describe, expect, it } from "vitest";
import { fp } from "./fixed-point";
import { evaluateTier, getMaxHubs, getMaxRouteDistanceKm, TIER_THRESHOLDS } from "./tier";

describe("tier progression", () => {
  it("keeps tier when requirements are unmet", () => {
    const tier = evaluateTier(1, fp(1_000_000), 1);
    expect(tier).toBe(1);
  });

  it("promotes to tier 2 when thresholds met", () => {
    const { minCumulativeRevenue, minActiveRoutes } = TIER_THRESHOLDS[2];
    const tier = evaluateTier(1, minCumulativeRevenue, minActiveRoutes);
    expect(tier).toBe(2);
  });

  it("promotes to tier 3 when thresholds met", () => {
    const { minCumulativeRevenue, minActiveRoutes } = TIER_THRESHOLDS[3];
    const tier = evaluateTier(2, minCumulativeRevenue, minActiveRoutes);
    expect(tier).toBe(3);
  });

  it("promotes multiple tiers when thresholds are met", () => {
    const tier = evaluateTier(1, fp(60_000_000), 12);
    expect(tier).toBe(3);
  });

  it("keeps tier when already above thresholds", () => {
    const tier = evaluateTier(4, fp(500_000_000), 40);
    expect(tier).toBe(4);
  });

  it("does not regress tiers when thresholds fall below", () => {
    const tier = evaluateTier(4, fp(1_000_000), 0);
    expect(tier).toBe(4);
  });
});

describe("tier limits", () => {
  it("returns distance limits by tier", () => {
    expect(getMaxRouteDistanceKm(1)).toBe(3000);
    expect(getMaxRouteDistanceKm(2)).toBe(7000);
    expect(getMaxRouteDistanceKm(3)).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns hub limits by tier", () => {
    expect(getMaxHubs(1)).toBe(1);
    expect(getMaxHubs(2)).toBe(3);
    expect(getMaxHubs(3)).toBe(5);
    expect(getMaxHubs(4)).toBe(Number.MAX_SAFE_INTEGER);
  });
});
