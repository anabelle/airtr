import type { FixedPoint, TimelineEvent } from "@acars/core";
import { FP_ZERO, fp, fpSub, fpSum, fpToNumber, TICKS_PER_HOUR } from "@acars/core";
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
  /** Number of flights with complete financial fields (revenue+cost) */
  financialFlightCount: number;
}

export function useFinancialPulse(timeline: TimelineEvent[]): FinancialPulse {
  return useMemo(() => {
    const landings = timeline.filter((e) => e.type === "landing").slice(0, RECENT_FLIGHT_COUNT);
    const financialLandings = landings.filter(
      (e) => e.revenue !== undefined && e.cost !== undefined,
    );

    if (landings.length === 0) {
      return {
        netIncomeRate: FP_ZERO,
        isPositive: true,
        totalRevenue: FP_ZERO,
        totalCosts: FP_ZERO,
        avgLoadFactor: 0,
        avgProfitPerFlight: FP_ZERO,
        flightCount: 0,
        financialFlightCount: 0,
      };
    }

    const revenues = financialLandings.map((e) => e.revenue!);
    const costs = financialLandings.map((e) => e.cost!);
    const profits = financialLandings.map((e) => e.profit ?? fpSub(e.revenue!, e.cost!));

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

    // Total flight time from actual flight durations
    const totalFlightTicks = financialLandings.reduce(
      (sum, event) => sum + (event.details?.flightDurationTicks ?? 0),
      0,
    );
    const totalFlightHours = totalFlightTicks / TICKS_PER_HOUR;

    // Net income rate = total profit / total flight hours
    // We compute in regular numbers then convert back to FP for display
    const netIncomeRateNum = totalFlightHours > 0 ? fpToNumber(totalProfit) / totalFlightHours : 0;
    const netIncomeRate = fp(netIncomeRateNum);

    // Avg profit per flight
    const avgProfitNum =
      financialLandings.length > 0 ? fpToNumber(totalProfit) / financialLandings.length : 0;
    const avgProfitPerFlight = fp(avgProfitNum);

    return {
      netIncomeRate,
      isPositive: totalProfit >= 0,
      totalRevenue,
      totalCosts,
      avgLoadFactor,
      avgProfitPerFlight,
      flightCount: landings.length,
      financialFlightCount: financialLandings.length,
    };
  }, [timeline]);
}
