import { TICKS_PER_DAY, TICKS_PER_MONTH } from "@acars/core";
import { useEngineStore } from "@acars/store";
import { useMemo } from "react";

export interface BillingCycle {
  /** Days elapsed in the current billing cycle */
  daysElapsed: number;
  /** Days remaining until next monthly deduction */
  daysRemaining: number;
  /** Progress through the current cycle (0–1) */
  progress: number;
}

export function useBillingCycle(): BillingCycle {
  const tick = useEngineStore((s) => s.tick);

  return useMemo(() => {
    const ticksIntoCycle = tick % TICKS_PER_MONTH;
    const cycleDays = Math.floor(TICKS_PER_MONTH / TICKS_PER_DAY);
    const daysElapsed = Math.floor(ticksIntoCycle / TICKS_PER_DAY);
    const daysRemaining = Math.max(0, cycleDays - daysElapsed);
    const progress = ticksIntoCycle / TICKS_PER_MONTH;

    return { daysElapsed, daysRemaining, progress };
  }, [tick]);
}
