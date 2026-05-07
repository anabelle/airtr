import { useAirlineStore, useEngineStore } from "@acars/store";
import React from "react";
import { buildTimelineNotificationCandidate } from "./domain";
import { useNotificationSettings } from "./context";

// Keep per-batch forwarding conservative so catch-up bursts do not spam push delivery
// when the timeline updates with several events at once.
const MAX_NOTIFICATIONS_PER_BATCH = 5;

export function TimelinePushBridge(): null {
  const { dispatchNotificationCandidate } = useNotificationSettings();
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
      if (timeline === previousTimeline || !timeline.length) return;

      const lastSeen = lastEventIdRef.current;
      const stopIndex = lastSeen ? timeline.findIndex((event) => event.id === lastSeen) : -1;
      const freshEvents = (stopIndex === -1 ? timeline : timeline.slice(0, stopIndex))
        .slice(0, MAX_NOTIFICATIONS_PER_BATCH)
        .reverse();

      lastEventIdRef.current = timeline[0]?.id ?? lastSeen;

      if (isCatchupRef.current || freshEvents.length === 0) {
        return;
      }

      for (const event of freshEvents) {
        const candidate = buildTimelineNotificationCandidate(event);
        if (!candidate) continue;
        void dispatchNotificationCandidate(candidate);
      }
    });

    return () => {
      unsubscribeCatchup();
      unsubscribeTimeline();
    };
  }, [dispatchNotificationCandidate]);

  return null;
}
