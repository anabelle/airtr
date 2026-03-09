import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultNotificationPreferences } from "./preferences";

const { signer, getNDK, rawEvent, eventSign } = vi.hoisted(() => {
  const signerUser = { pubkey: "pubkey-1" };
  const signer = {
    user: vi.fn(async () => signerUser),
  };
  const getNDK = vi.fn(() => ({ signer }));
  const rawEvent = {
    id: "auth-event-id",
    pubkey: "pubkey-1",
    created_at: 1,
    kind: 27235,
    tags: [] as string[][],
    content: "",
    sig: "signature",
  };
  const eventSign = vi.fn(async () => "signature");

  return { signer, getNDK, rawEvent, eventSign };
});

vi.mock("@acars/nostr", () => ({
  getNDK,
  NDKEvent: class {
    kind = 0;
    content = "";
    tags = [] as string[][];
    async sign() {
      rawEvent.kind = this.kind;
      rawEvent.content = this.content;
      rawEvent.tags = this.tags;
      return eventSign();
    }
    rawEvent() {
      return rawEvent;
    }
  },
}));

import {
  registerNotificationTarget,
  sendNotificationCandidate,
  unregisterNotificationTarget,
} from "./api";

describe("notifications api auth", () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          registrationId: "reg-1",
          registrationSecret: "secret-1",
          updatedAt: 1,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
  );

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", crypto);
    fetchMock.mockClear();
    getNDK.mockClear();
    signer.user.mockClear();
    eventSign.mockClear();
    rawEvent.tags = [];
    rawEvent.content = "";
    rawEvent.kind = 27235;
  });

  function getFetchCall(index: number): { url: string; init: RequestInit } {
    const call = fetchMock.mock.calls[index];
    expect(call).toBeDefined();
    const [url, init] = call as unknown as [unknown, unknown];
    expect(typeof url).toBe("string");
    expect(init).toBeTruthy();
    return { url: url as string, init: init as RequestInit };
  }

  function getHeader(init: RequestInit, name: string): string | null {
    const headers = init.headers;
    if (headers instanceof Headers) {
      return headers.get(name);
    }
    if (Array.isArray(headers)) {
      const match = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
      return match?.[1] ?? null;
    }
    if (headers && typeof headers === "object") {
      const entries = Object.entries(headers as Record<string, string>);
      const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
      return match?.[1] ?? null;
    }
    return null;
  }

  it("sends absolute URLs and Nostr auth for registration", async () => {
    const preferences = buildDefaultNotificationPreferences();
    await registerNotificationTarget({
      platform: "browser",
      pubkey: "pubkey-1",
      deviceId: "device-1",
      subscription: {
        endpoint: "https://push.example/sub",
        keys: { p256dh: "p256dh", auth: "auth" },
      },
      preferences,
      permissionState: "granted",
      timezone: "UTC",
    });

    const { url, init } = getFetchCall(0);
    expect(url).toBe("http://localhost:3000/api/notifications/register");
    expect(getHeader(init, "Authorization")).toMatch(/^Nostr /);
    expect(rawEvent.tags).toEqual([
      ["u", "http://localhost:3000/api/notifications/register"],
      ["method", "POST"],
      ["payload", expect.any(String)],
    ]);
  });

  it("includes the pubkey when forwarding a notification candidate", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await sendNotificationCandidate({
      pubkey: "pubkey-1",
      registrationSecret: "secret-1",
      includeSource: true,
      notification: {
        id: "evt-1",
        category: "delivery",
        title: "Ready",
        body: "Notification ready",
        urgency: "normal",
        ttlPolicy: "medium",
        collapseKey: "delivery:test",
        groupKey: "group:test",
        deepLink: { kind: "corporate", section: "notifications" },
        url: "/corporate#notifications",
        createdAt: 1,
      },
    });

    const { init } = getFetchCall(0);
    expect(typeof init.body).toBe("string");
    expect(JSON.parse(init.body as string)).toMatchObject({
      pubkey: "pubkey-1",
    });
    expect(rawEvent.tags[0]).toEqual(["u", "http://localhost:3000/api/notifications/send"]);
  });

  it("rejects auth creation when the active signer pubkey mismatches", async () => {
    signer.user.mockResolvedValueOnce({ pubkey: "other-pubkey" });

    await expect(
      unregisterNotificationTarget({
        deviceId: "device-1",
        platform: "browser",
        pubkey: "pubkey-1",
        registrationSecret: "secret-1",
      }),
    ).rejects.toThrow("active Nostr signer does not match");
  });
});
