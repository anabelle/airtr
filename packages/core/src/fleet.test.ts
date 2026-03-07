import { describe, expect, it } from "vitest";
import { fp, fpScale, fpToNumber } from "./fixed-point.js";
import { calculateBookValue, computeRouteFrequency } from "./fleet.js";

const mockModel = {
  id: "a320-neo",
  manufacturer: "Airbus",
  name: "A320neo",
  type: "narrowbody" as const,
  generation: "nextgen" as const,
  rangeKm: 6300,
  speedKmh: 903,
  maxTakeoffWeight: 79000,
  capacity: { economy: 156, business: 24, first: 0, cargoKg: 3700 },
  fuelBurnKgPerHour: 2200,
  fuelBurnKgPerKm: 2.5,
  blockHoursPerDay: 12,
  turnaroundTimeMinutes: 35,
  price: fp(110000000),
  monthlyLease: fp(380000),
  casm: fp(0.0008),
  maintCostPerHour: fp(850),
  crewRequired: { cockpit: 2, cabin: 4 },
  economicLifeYears: 25,
  residualValuePercent: 15,
  unlockTier: 2,
  familyId: "a320",
  deliveryTimeTicks: 120,
};

const TICKS_PER_HOUR = 1200;
const TICKS_PER_DAY = TICKS_PER_HOUR * 24;
const TICKS_PER_YEAR = TICKS_PER_DAY * 365;

describe("fleet", () => {
  describe("computeRouteFrequency", () => {
    it("caps weekly frequency using block hours per day instead of 24/7 utilization", () => {
      const frequency = computeRouteFrequency(539, 1, 667, 25, 16);
      expect(frequency).toBeLessThan(68);
      expect(frequency).toBe(45);
    });

    it("returns zero when no aircraft are assigned", () => {
      expect(computeRouteFrequency(1000, 0, 800, 35, 16)).toBe(0);
    });
  });

  describe("calculateBookValue", () => {
    it("returns full price for brand new aircraft", () => {
      const value = calculateBookValue(mockModel, 0, 1.0, 0, 0);
      expect(fpToNumber(value)).toBeCloseTo(110000000, 0);
    });

    it("applies depreciation over 1 year", () => {
      const manufactureTick = 0;
      const oneYearLater = TICKS_PER_YEAR;
      const value = calculateBookValue(mockModel, 0, 1.0, manufactureTick, oneYearLater);
      const expectedValue = fpToNumber(fpScale(mockModel.price, 0.9 ** 1));
      expect(fpToNumber(value)).toBeCloseTo(expectedValue, 0);
    });

    it("applies depreciation over 10 years", () => {
      const manufactureTick = 0;
      const tenYearsLater = TICKS_PER_YEAR * 10;
      const value = calculateBookValue(mockModel, 0, 1.0, manufactureTick, tenYearsLater);
      const expectedValue = fpToNumber(fpScale(mockModel.price, 0.9 ** 10));
      expect(fpToNumber(value)).toBeCloseTo(expectedValue, 0);
    });

    it("never goes below residual value (15%)", () => {
      const manufactureTick = 0;
      const veryOldAircraft = TICKS_PER_YEAR * 100; // 100 years
      const value = calculateBookValue(mockModel, 0, 1.0, manufactureTick, veryOldAircraft);
      const residualValue = fpToNumber(fpScale(mockModel.price, 0.15));
      expect(fpToNumber(value)).toBeCloseTo(residualValue, 0);
    });

    it("applies condition penalty for worn aircraft", () => {
      const manufactureTick = 0;
      const currentTick = TICKS_PER_YEAR * 5;
      const value = calculateBookValue(mockModel, 0, 0.5, manufactureTick, currentTick);
      const expectedBase = fpScale(mockModel.price, 0.9 ** 5);
      const expectedWithCondition = fpScale(expectedBase, 1 - (1 - 0.5) * 0.3);
      expect(fpToNumber(value)).toBeCloseTo(fpToNumber(expectedWithCondition), 0);
    });

    it("applies 0 penalty for perfect condition", () => {
      const manufactureTick = 0;
      const currentTick = TICKS_PER_YEAR * 5;
      const value = calculateBookValue(mockModel, 0, 1.0, manufactureTick, currentTick);
      const expectedBase = fpScale(mockModel.price, 0.9 ** 5);
      expect(fpToNumber(value)).toBeCloseTo(fpToNumber(expectedBase), 0);
    });

    it("applies high utilization penalty", () => {
      const manufactureTick = 0;
      const fiveYearsLater = TICKS_PER_YEAR * 5;
      const expectedHours = mockModel.blockHoursPerDay * 365 * 5;
      const highHours = expectedHours * 1.5; // 50% higher utilization
      const value = calculateBookValue(mockModel, highHours, 1.0, manufactureTick, fiveYearsLater);
      const baseWithoutPenalty = fpScale(mockModel.price, 0.9 ** 5);
      const expectedWithPenalty = fpScale(baseWithoutPenalty, 0.9);
      expect(fpToNumber(value)).toBeCloseTo(fpToNumber(expectedWithPenalty), 0);
    });

    it("does not penalize normal utilization", () => {
      const manufactureTick = 0;
      const fiveYearsLater = TICKS_PER_YEAR * 5;
      const expectedHours = mockModel.blockHoursPerDay * 365 * 5;
      const normalHours = expectedHours * 1.1; // Only 10% over, below threshold
      const value = calculateBookValue(
        mockModel,
        normalHours,
        1.0,
        manufactureTick,
        fiveYearsLater,
      );
      const expectedBase = fpScale(mockModel.price, 0.9 ** 5);
      expect(fpToNumber(value)).toBeCloseTo(fpToNumber(expectedBase), 0);
    });

    it("handles future manufacture date (negative age)", () => {
      const manufactureTick = TICKS_PER_YEAR;
      const currentTick = 0;
      const value = calculateBookValue(mockModel, 0, 1.0, manufactureTick, currentTick);
      expect(fpToNumber(value)).toBe(fpToNumber(mockModel.price));
    });

    it("combines all factors correctly", () => {
      const manufactureTick = 0;
      const tenYearsLater = TICKS_PER_YEAR * 10;
      const expectedHours = mockModel.blockHoursPerDay * 365 * 10;
      const highHours = expectedHours * 1.3;
      const value = calculateBookValue(mockModel, highHours, 0.7, manufactureTick, tenYearsLater);
      const depValue = fpScale(mockModel.price, 0.9 ** 10);
      const condValue = fpScale(depValue, 1 - (1 - 0.7) * 0.3);
      const utilValue = fpScale(condValue, 0.9);
      expect(fpToNumber(value)).toBeCloseTo(fpToNumber(utilValue), 0);
    });
  });
});
