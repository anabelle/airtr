import { describe, expect, it } from "vitest";
import { buildNotificationUrl, parseNotificationUrl } from "./deepLinks";

describe("notification deep links", () => {
  it("round-trips a corporate notifications target", () => {
    const url = buildNotificationUrl({ kind: "corporate", section: "notifications" });
    expect(url).toBe("/corporate#notifications");
    expect(parseNotificationUrl(url)).toEqual({ kind: "corporate", section: "notifications" });
  });

  it("round-trips all corporate sections", () => {
    expect(
      parseNotificationUrl(buildNotificationUrl({ kind: "corporate", section: "activity" })),
    ).toEqual({
      kind: "corporate",
      section: "activity",
    });
    expect(
      parseNotificationUrl(buildNotificationUrl({ kind: "corporate", section: "financials" })),
    ).toEqual({
      kind: "corporate",
      section: "financials",
    });
  });

  it("round-trips aircraft targets with tabs", () => {
    const url = buildNotificationUrl({ kind: "aircraft", id: "ac-123", tab: "route" });
    expect(parseNotificationUrl(url)).toEqual({ kind: "aircraft", id: "ac-123", tab: "route" });
  });

  it("accepts percent-encoded aircraft ids", () => {
    const url = buildNotificationUrl({ kind: "aircraft", id: "aircraft/with spaces", tab: "info" });
    expect(url).toBe("/aircraft/aircraft%2Fwith%20spaces?aircraftTab=info");
    expect(parseNotificationUrl(url)).toEqual({
      kind: "aircraft",
      id: "aircraft/with spaces",
      tab: "info",
    });
  });

  it("rejects off-origin or unknown routes", () => {
    expect(parseNotificationUrl("https://example.com/corporate")).toBeNull();
    expect(parseNotificationUrl("/totally-unknown")).toBeNull();
  });

  it("accepts corporate routes without a section and ignores invalid params", () => {
    expect(parseNotificationUrl("/corporate")).toEqual({ kind: "corporate", section: undefined });
    expect(parseNotificationUrl("/network?tab=bad")).toEqual({
      kind: "network",
      tab: undefined,
      routeFocus: undefined,
    });
  });

  it("accepts native app and production host deep links", () => {
    expect(
      parseNotificationUrl("acars://app/corporate#notifications", "capacitor://localhost"),
    ).toEqual({
      kind: "corporate",
      section: "notifications",
    });
    expect(
      parseNotificationUrl("https://acars.pub/corporate#financials", "capacitor://localhost"),
    ).toEqual({
      kind: "corporate",
      section: "financials",
    });
  });
});
