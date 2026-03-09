import { describe, expect, it } from "vitest";
import { fpToNumber } from "./fixed-point.js";
import {
  FUEL_PRICE_MAX_PER_KG,
  FUEL_PRICE_MEAN_PER_KG,
  FUEL_PRICE_MIN_PER_KG,
  getFuelPriceAtTick,
  getFuelPriceHistory,
  stepFuelPrice,
} from "./fuel.js";

describe("fuel market", () => {
  it("returns the same price for the same tick", () => {
    expect(getFuelPriceAtTick(42)).toBe(getFuelPriceAtTick(42));
    expect(getFuelPriceAtTick(250_000)).toBe(getFuelPriceAtTick(250_000));
  });

  it("stays within configured bounds", () => {
    for (const tick of [0, 1, 12, 120, 10_000, 125_000, 980_000]) {
      const price = getFuelPriceAtTick(tick);
      expect(price).toBeGreaterThanOrEqual(FUEL_PRICE_MIN_PER_KG);
      expect(price).toBeLessThanOrEqual(FUEL_PRICE_MAX_PER_KG);
    }
  });

  it("starts at the configured mean", () => {
    expect(getFuelPriceAtTick(0)).toBe(FUEL_PRICE_MEAN_PER_KG);
  });

  it("returns ordered history ending at current tick", () => {
    const history = getFuelPriceHistory(1000, 8, 25);
    expect(history).toHaveLength(8);
    expect(history[0]?.tick).toBe(825);
    expect(history[history.length - 1]?.tick).toBe(1000);
  });

  it("mean reversion nudges extreme values back toward center", () => {
    const fromHigh = stepFuelPrice(fpToNumber(FUEL_PRICE_MAX_PER_KG), 10);
    const fromLow = stepFuelPrice(fpToNumber(FUEL_PRICE_MIN_PER_KG), 11);
    expect(fromHigh).toBeLessThanOrEqual(fpToNumber(FUEL_PRICE_MAX_PER_KG));
    expect(fromLow).toBeGreaterThanOrEqual(fpToNumber(FUEL_PRICE_MIN_PER_KG));
  });
});
