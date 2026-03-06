import type { TimelineEvent, TimelineEventType } from "@acars/core";
import { useAirlineStore, useEngineStore } from "@acars/store";
import React from "react";
import { toast } from "sonner";

const MAX_TOASTS_PER_BATCH = 5;

const EVENT_TITLES: Record<TimelineEventType, string> = {
  takeoff: "Flight Departed",
  landing: "Flight Landed",
  purchase: "Purchase Completed",
  sale: "Asset Sold",
  lease_payment: "Lease Payment",
  maintenance: "Maintenance Update",
  delivery: "Delivery Complete",
  hub_change: "Hub Updated",
  route_change: "Route Updated",
  ferry: "Ferry Flight",
  competitor_hub: "Competitor Alert",
  price_war: "Price War Detected",
  tier_upgrade: "Tier Upgraded",
  bankruptcy: "⚠️ BANKRUPTCY FILED",
  financial_warning: "Financial Warning",
};

const EVENT_TOAST_KIND: Record<TimelineEventType, "success" | "info" | "warning"> = {
  takeoff: "info",
  landing: "success",
  purchase: "success",
  sale: "success",
  lease_payment: "warning",
  maintenance: "warning",
  delivery: "success",
  hub_change: "info",
  route_change: "info",
  ferry: "info",
  competitor_hub: "warning",
  price_war: "warning",
  tier_upgrade: "success",
  bankruptcy: "warning",
  financial_warning: "warning",
};

const showTimelineToast = (event: TimelineEvent) => {
  const title = EVENT_TITLES[event.type] ?? "Operations Update";
  const description = event.description;
  const kind = EVENT_TOAST_KIND[event.type] ?? "info";

  if (event.type === "bankruptcy") {
    toast.error(title, { description, duration: 15000 });
    return;
  }
  if (kind === "success") {
    toast.success(title, { description, duration: 4000 });
    return;
  }
  if (kind === "warning") {
    toast.warning(title, { description, duration: 6000 });
    return;
  }
  toast.info(title, { description, duration: 4000 });
};

export const TimelineToastBridge = (): null => {
  const lastEventIdRef = React.useRef<string | null>(null);
  const isCatchupRef = React.useRef(false);

  React.useEffect(() => {
    lastEventIdRef.current = useAirlineStore.getState().timeline[0]?.id ?? null;
    isCatchupRef.current = !!useEngineStore.getState().catchupProgress;

    const unsubscribeCatchup = useEngineStore.subscribe((state) => {
      isCatchupRef.current = !!state.catchupProgress;
    });

    const unsubscribeTimeline = useAirlineStore.subscribe((state, prevState) => {
      const timeline = state.timeline;
      const previousTimeline = prevState.timeline;
      if (timeline === previousTimeline) return;

      if (!timeline.length) {
        lastEventIdRef.current = null;
        return;
      }

      if (isCatchupRef.current) {
        lastEventIdRef.current = timeline[0]?.id ?? null;
        return;
      }

      const latestId = timeline[0]?.id ?? null;
      if (!latestId || latestId === lastEventIdRef.current) return;

      const lastSeenId = lastEventIdRef.current;
      let newEvents: TimelineEvent[] = [];
      if (!lastSeenId) {
        newEvents = [timeline[0]];
      } else {
        const lastIndex = timeline.findIndex((event) => event.id === lastSeenId);
        newEvents =
          lastIndex === -1 ? timeline.slice(0, MAX_TOASTS_PER_BATCH) : timeline.slice(0, lastIndex);
      }

      lastEventIdRef.current = latestId;

      if (!newEvents.length) return;
      const limitedEvents = newEvents.slice(0, MAX_TOASTS_PER_BATCH).reverse();
      for (const event of limitedEvents) {
        showTimelineToast(event);
      }
    });

    return () => {
      unsubscribeCatchup();
      unsubscribeTimeline();
    };
  }, []);

  return null;
};
