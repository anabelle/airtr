import type { FixedPoint, Route, TimelineEvent } from "@airtr/core";
import { FP_ZERO, fp, fpSum, fpToNumber, TICKS_PER_HOUR } from "@airtr/core";
import { useMemo } from "react";

export interface RoutePerformanceEntry {
  routeId: string;
  label: string;
  fleetCount: number;
  avgLoadFactor: number;
  profitPerHour: FixedPoint;
}

export function useRoutePerformance(
  timeline: TimelineEvent[],
  routes: Route[],
): RoutePerformanceEntry[] {
  return useMemo(() => {
    const landings = timeline.filter(
      (event) =>
        event.type === "landing" &&
        event.details?.routeId &&
        event.profit !== undefined &&
        event.details?.loadFactor !== undefined,
    );

    const grouped = new Map<string, TimelineEvent[]>();
    for (const landing of landings) {
      const routeId = landing.details?.routeId;
      if (!routeId) continue;
      const bucket = grouped.get(routeId) ?? [];
      bucket.push(landing);
      grouped.set(routeId, bucket);
    }

    return Array.from(grouped.entries()).map(([routeId, events]) => {
      const latest = events[0];
      const totalProfit = fpSum(events.map((event) => event.profit ?? FP_ZERO));
      const avgLoadFactor =
        events.reduce((sum, event) => sum + (event.details?.loadFactor ?? 0), 0) / events.length;
      const newestTick = events[0]?.tick ?? 0;
      const oldestTick = events[events.length - 1]?.tick ?? newestTick;
      const spanTicks = Math.max(newestTick - oldestTick, 1);
      const spanHours = spanTicks / TICKS_PER_HOUR;
      const profitPerHour = fp(fpToNumber(totalProfit) / Math.max(spanHours, 0.01));

      const route = routes.find((item) => item.id === routeId);
      const fleetCount = route?.assignedAircraftIds.length ?? 0;
      const label = route
        ? `${route.originIata} → ${route.destinationIata}`
        : `${latest?.originIata ?? ""} → ${latest?.destinationIata ?? ""}`.trim();

      return {
        routeId,
        label,
        fleetCount,
        avgLoadFactor,
        profitPerHour,
      };
    });
  }, [routes, timeline]);
}
