import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async () => undefined),
  },
}));

const { verifyEventMock } = vi.hoisted(() => ({
  verifyEventMock: vi.fn(() => true),
}));

vi.mock("nostr-tools", () => ({
  verifyEvent: verifyEventMock,
}));

import { onRequest } from "./[[path]]";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createDbMock() {
  const state = {
    registrations: new Map<string, any>(),
    registrationsByKey: new Map<string, any>(),
    rateLimits: new Map<string, { timestamps: string }>(),
  };

  const db = {
    exec: vi.fn(async () => undefined),
    prepare: vi.fn((sql: string) => {
      let params: unknown[] = [];
      return {
        bind: (...values: unknown[]) => {
          params = values;
          return {
            first: vi.fn(async () => {
              if (sql.includes("FROM notification_rate_limits")) {
                return state.rateLimits.get(String(params[0])) ?? null;
              }
              if (sql.includes("WHERE secret = ?1")) {
                return state.registrations.get(String(params[0])) ?? null;
              }
              if (sql.includes("WHERE pubkey = ?1 AND device_id = ?2 AND platform = ?3")) {
                return (
                  state.registrationsByKey.get(`${params[0]}:${params[1]}:${params[2]}`) ?? null
                );
              }
              return null;
            }),
            all: vi.fn(async () => ({ results: [] })),
            run: vi.fn(async () => {
              if (sql.includes("notification_rate_limits")) {
                state.rateLimits.set(String(params[0]), {
                  timestamps: String(params[1]),
                });
                return { meta: { changes: 1 } };
              }

              if (sql.includes("INSERT INTO notification_registrations")) {
                const record = {
                  id: params[0],
                  secret: params[1],
                  pubkey: params[2],
                  device_id: params[3],
                  platform: params[4],
                  endpoint: params[5],
                  p256dh: params[6],
                  auth: params[7],
                  fcm_token: params[8],
                  preferences_json: params[9],
                  permission_state: params[10],
                  timezone: params[11],
                };
                state.registrations.set(String(params[1]), record);
                state.registrationsByKey.set(`${params[2]}:${params[3]}:${params[4]}`, record);
                return { meta: { changes: 1 } };
              }

              if (sql.includes("DELETE FROM notification_registrations WHERE secret = ?1")) {
                state.registrations.delete(String(params[0]));
                return { meta: { changes: 1 } };
              }

              return { meta: { changes: 1 } };
            }),
          };
        },
      };
    }),
  };

  return { db, state };
}

async function createAuthorizationHeader(
  url: string,
  method: string,
  body: string,
  pubkey = "pubkey-1",
) {
  const payloadHashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const payloadHash = Array.from(new Uint8Array(payloadHashBuffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  const event = {
    id: "auth-event",
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 27235,
    tags: [
      ["u", url],
      ["method", method],
      ["payload", payloadHash],
    ],
    content: "",
    sig: "signature",
  };

  return `Nostr ${btoa(JSON.stringify(event))}`;
}

describe("notifications api auth", () => {
  beforeEach(() => {
    verifyEventMock.mockReset();
    verifyEventMock.mockReturnValue(true);
  });

  it("rejects register without valid Nostr auth", async () => {
    const { db } = createDbMock();
    const body = JSON.stringify({
      pubkey: "pubkey-1",
      deviceId: "device-1",
      platform: "browser",
      subscription: {
        endpoint: "https://push.example/sub",
        keys: { p256dh: "p256dh", auth: "auth" },
      },
      preferences: {
        enabled: true,
        categories: {},
        quietHours: { enabled: false },
      },
      permissionState: "granted",
      timezone: "UTC",
    });

    const response = await onRequest({
      request: new Request("https://acars.pub/api/notifications/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://acars.pub",
        },
        body,
      }),
      env: { NOTIFICATIONS_DB: db as never },
    } as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "Missing Nostr authorization header.",
    });
  });

  it("registers with valid Nostr auth", async () => {
    const { db, state } = createDbMock();
    const url = "https://acars.pub/api/notifications/register";
    const body = JSON.stringify({
      pubkey: "pubkey-1",
      deviceId: "device-1",
      platform: "browser",
      subscription: {
        endpoint: "https://push.example/sub",
        keys: { p256dh: "p256dh", auth: "auth" },
      },
      preferences: {
        enabled: true,
        categories: {},
        quietHours: { enabled: false },
      },
      permissionState: "granted",
      timezone: "UTC",
    });

    const response = await onRequest({
      request: new Request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://acars.pub",
          Authorization: await createAuthorizationHeader(url, "POST", body),
        },
        body,
      }),
      env: { NOTIFICATIONS_DB: db as never },
    } as never);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.registrationSecret).toBeTruthy();
    expect(state.registrations.size).toBe(1);
  });

  it("rejects send requests with unsafe notification urls", async () => {
    const { db, state } = createDbMock();
    state.registrations.set("secret-1", {
      id: "reg-1",
      secret: "secret-1",
      pubkey: "pubkey-1",
      device_id: "device-1",
      platform: "browser",
      endpoint: "https://push.example/sub",
      p256dh: "p256dh",
      auth: "auth",
      fcm_token: null,
      preferences_json: JSON.stringify({
        enabled: true,
        categories: { delivery: true },
        quietHours: { enabled: false },
      }),
      permission_state: "granted",
      timezone: "UTC",
    });

    const url = "https://acars.pub/api/notifications/send";
    const body = JSON.stringify({
      pubkey: "pubkey-1",
      registrationSecret: "secret-1",
      includeSource: true,
      notification: {
        id: "evt-1",
        category: "delivery",
        title: "Unsafe",
        body: "Bad url",
        urgency: "normal",
        ttlPolicy: "medium",
        collapseKey: "delivery:test",
        groupKey: "group:test",
        createdAt: 1,
        url: "https://evil.example/phish",
      },
    });

    const response = await onRequest({
      request: new Request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://acars.pub",
          Authorization: await createAuthorizationHeader(url, "POST", body),
        },
        body,
      }),
      env: { NOTIFICATIONS_DB: db as never },
    } as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "Notification URL must stay within ACARS routes.",
    });
  });
});
