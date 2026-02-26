import type { FixedPoint, TimelineEvent } from "@airtr/core";
import { FP_ZERO, fp, fpSub, fpSum, fpToNumber, TICKS_PER_HOUR } from "@airtr/core";
import { useMemo } from "react";

export const RECENT_FLIGHT_COUNT = 20;

export interface FinancialPulse {
  /** Net income rate in FixedPoint per hour */
  netIncomeRate: FixedPoint;
  /** Whether net income rate is positive */
  isPositive: boolean;
  /** Total revenue from recent flights (FP) */
  totalRevenue: FixedPoint;
  /** Total costs from recent flights (FP) */
  totalCosts: FixedPoint;
  /** Average load factor (0-1) */
  avgLoadFactor: number;
  /** Average profit per flight (FP) */
  avgProfitPerFlight: FixedPoint;
  /** Number of flights analyzed */
  flightCount: number;
}

export function useFinancialPulse(timeline: TimelineEvent[]): FinancialPulse {
  return useMemo(() => {
    const landings = timeline
      .filter((e) => e.type === "landing" && e.revenue !== undefined && e.cost !== undefined)
      .slice(0, RECENT_FLIGHT_COUNT);

    if (landings.length === 0) {
      return {
        netIncomeRate: FP_ZERO,
        isPositive: true,
        totalRevenue: FP_ZERO,
        totalCosts: FP_ZERO,
        avgLoadFactor: 0,
        avgProfitPerFlight: FP_ZERO,
        flightCount: 0,
      };
    }

    const revenues = landings.map((e) => e.revenue!);
    const costs = landings.map((e) => e.cost!);
    const profits = landings.map((e) => e.profit ?? fpSub(e.revenue!, e.cost!));

    const totalRevenue = fpSum(revenues);
    const totalCosts = fpSum(costs);
    const totalProfit = fpSum(profits);

    // Load factors (plain numbers, not FP)
    const loadFactors = landings
      .map((e) => e.details?.loadFactor)
      .filter((lf): lf is number => lf !== undefined);
    const avgLoadFactor =
      loadFactors.length > 0
        ? loadFactors.reduce((sum, lf) => sum + lf, 0) / loadFactors.length
        : 0;

    // Time span in ticks between newest and oldest flight
    const newestTick = landings[0]!.tick;
    const oldestTick = landings[landings.length - 1]!.tick;
    const spanTicks = Math.max(newestTick - oldestTick, 1);
    const spanHours = spanTicks / TICKS_PER_HOUR;

    // Net income rate = total profit / span hours
    // We compute in regular numbers then convert back to FP for display
    const netIncomeRateNum = fpToNumber(totalProfit) / Math.max(spanHours, 0.01);
    const netIncomeRate = fp(netIncomeRateNum);

    // Avg profit per flight
    const avgProfitNum = fpToNumber(totalProfit) / landings.length;
    const avgProfitPerFlight = fp(avgProfitNum);

    return {
      netIncomeRate,
      isPositive: totalProfit >= 0,
      totalRevenue,
      totalCosts,
      avgLoadFactor,
      avgProfitPerFlight,
      flightCount: landings.length,
    };
  }, [timeline]);
}
