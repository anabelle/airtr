import { describe, expect, it } from "vitest";
import { buildTimelineNotificationCandidate } from "./domain";

describe("timeline notification classification", () => {
  it("classifies delivery events with aircraft deep links", () => {
    const candidate = buildTimelineNotificationCandidate({
      id: "evt-delivery-1",
      tick: 120,
      timestamp: 1234567890,
      type: "delivery",
      description: "A320neo delivered to JFK",
      aircraftId: "ac-1",
      aircraftName: "Spirit of Nostr",
      originIata: "JFK",
      destinationIata: "LAX",
    });

    expect(candidate).toMatchObject({
      category: "delivery",
      urgency: "normal",
      ttlPolicy: "long",
      collapseKey: "delivery:JFK-LAX",
      url: "/aircraft/ac-1",
      deepLink: { kind: "aircraft", id: "ac-1" },
    });
  });

  it("returns null for non-push timeline types", () => {
    const candidate = buildTimelineNotificationCandidate({
      id: "evt-route-1",
      tick: 120,
      timestamp: 1234567890,
      type: "route_change",
      description: "Route updated",
    });

    expect(candidate).toBeNull();
  });
});
