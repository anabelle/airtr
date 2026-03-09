import { describe, expect, it } from "vitest";
import type { NotificationPayload } from "./domain";
import {
  buildDefaultNotificationPreferences,
  isWithinQuietHours,
  shouldDeliverNotification,
} from "./preferences";

const basePayload: NotificationPayload = {
  id: "evt-1",
  category: "delivery",
  title: "Delivery complete",
  body: "Your aircraft arrived.",
  urgency: "normal",
  ttlPolicy: "medium",
  collapseKey: "delivery:ac-1",
  groupKey: "aircraft:ac-1",
  deepLink: { kind: "aircraft", id: "ac-1" },
  url: "/aircraft/ac-1",
  createdAt: Date.now(),
};

describe("notification preferences", () => {
  it("defaults to low-noise operations settings", () => {
    const preferences = buildDefaultNotificationPreferences();
    expect(preferences.enabled).toBe(true);
    expect(preferences.categories.bankruptcy).toBe(true);
    expect(preferences.categories.takeoff).toBe(false);
    expect(preferences.categories.landing).toBe(false);
  });

  it("suppresses non-critical alerts during quiet hours", () => {
    const preferences = buildDefaultNotificationPreferences();
    preferences.quietHours = {
      enabled: true,
      start: "22:00",
      end: "07:00",
      timezone: "UTC",
    };

    expect(isWithinQuietHours(preferences, new Date("2026-03-09T23:30:00Z"))).toBe(true);
    expect(
      shouldDeliverNotification(preferences, basePayload, new Date("2026-03-09T23:30:00Z")),
    ).toBe(false);
  });

  it("lets critical finance alerts bypass quiet hours", () => {
    const preferences = buildDefaultNotificationPreferences();
    preferences.quietHours = {
      enabled: true,
      start: "22:00",
      end: "07:00",
      timezone: "UTC",
    };

    const payload: NotificationPayload = {
      ...basePayload,
      category: "bankruptcy",
      urgency: "high",
      collapseKey: "bankruptcy:global",
      groupKey: "category:bankruptcy",
    };

    expect(shouldDeliverNotification(preferences, payload, new Date("2026-03-09T23:30:00Z"))).toBe(
      true,
    );
  });
});
