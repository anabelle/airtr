import { describe, expect, it } from "vitest";
import { buildNotificationUrl, parseNotificationUrl } from "./deepLinks";

describe("notification deep links", () => {
  it("round-trips a corporate notifications target", () => {
    const url = buildNotificationUrl({ kind: "corporate", section: "notifications" });
    expect(url).toBe("/corporate#notifications");
    expect(parseNotificationUrl(url)).toEqual({ kind: "corporate", section: "notifications" });
  });

  it("round-trips aircraft targets with tabs", () => {
    const url = buildNotificationUrl({ kind: "aircraft", id: "ac-123", tab: "route" });
    expect(parseNotificationUrl(url)).toEqual({ kind: "aircraft", id: "ac-123", tab: "route" });
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
});
