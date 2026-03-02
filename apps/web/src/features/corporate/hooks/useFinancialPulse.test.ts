import type { TimelineEvent } from "@acars/core";
import { fp, fpToNumber } from "@acars/core";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFinancialPulse } from "./useFinancialPulse";

describe("useFinancialPulse", () => {
  it("uses total flight durations for net income rate", () => {
    const timeline: TimelineEvent[] = [
      {
        id: "evt-1",
        tick: 100,
        timestamp: 0,
        type: "landing",
        description: "Landing 1",
        revenue: fp(5000),
        cost: fp(3000),
        profit: fp(2000),
        details: {
          loadFactor: 0.9,
          flightDurationTicks: 600,
        },
      },
      {
        id: "evt-2",
        tick: 100,
        timestamp: 0,
        type: "landing",
        description: "Landing 2",
        revenue: fp(4000),
        cost: fp(3000),
        profit: fp(1000),
        details: {
          loadFactor: 0.8,
          flightDurationTicks: 600,
        },
      },
    ];

    const { result } = renderHook(() => useFinancialPulse(timeline));

    expect(fpToNumber(result.current.netIncomeRate)).toBeCloseTo(3000, 5);
    expect(result.current.flightCount).toBe(2);
    expect(result.current.financialFlightCount).toBe(2);
  });

  it("counts recent landings even when some legacy events lack financial fields", () => {
    const timeline: TimelineEvent[] = [
      {
        id: "evt-legacy",
        tick: 120,
        timestamp: 0,
        type: "landing",
        description: "Legacy landing without revenue/cost",
      },
      {
        id: "evt-financial",
        tick: 100,
        timestamp: 0,
        type: "landing",
        description: "Landing with financials",
        revenue: fp(3000),
        cost: fp(2000),
        profit: fp(1000),
        details: {
          flightDurationTicks: 1200,
        },
      },
    ];

    const { result } = renderHook(() => useFinancialPulse(timeline));

    expect(result.current.flightCount).toBe(2);
    expect(result.current.financialFlightCount).toBe(1);
  });
});
