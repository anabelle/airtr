import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { buildPushHTTPRequestMock, verifyEventMock } = vi.hoisted(() => ({
  buildPushHTTPRequestMock: vi.fn(async () => ({
    endpoint: "https://push.example/sub",
    headers: new Headers(),
    body: new ArrayBuffer(0),
  })),
  verifyEventMock: vi.fn(() => true),
}));

vi.mock("@pushforge/builder", () => ({
  buildPushHTTPRequest: buildPushHTTPRequestMock,
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

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
            all: vi.fn(async () => {
              if (sql.includes("FROM notification_registrations")) {
                const pubkey = String(params[0]);
                const excludeRegistrationId = params[1] != null ? String(params[1]) : null;
                return {
                  results: Array.from(state.registrations.values()).filter(
                    (registration) =>
                      registration.pubkey === pubkey &&
                      (excludeRegistrationId == null || registration.id !== excludeRegistrationId),
                  ),
                };
              }
              return { results: [] };
            }),
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
    buildPushHTTPRequestMock.mockReset();
    buildPushHTTPRequestMock.mockResolvedValue({
      endpoint: "https://push.example/sub",
      headers: new Headers(),
      body: new ArrayBuffer(0),
    });
    verifyEventMock.mockReset();
    verifyEventMock.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("sends browser notifications with an edge-safe web push request", async () => {
    const { db, state } = createDbMock();
    const registration = {
      id: "reg-1",
      secret: "secret-1",
      pubkey: "pubkey-1",
      device_id: "device-1",
      platform: "browser",
      endpoint: "https://push.example/sub",
      p256dh: "browser-p256dh",
      auth: "browser-auth",
      fcm_token: null,
      preferences_json: JSON.stringify({
        enabled: true,
        categories: { delivery: true },
        quietHours: { enabled: false },
      }),
      permission_state: "granted",
      timezone: "UTC",
    };
    state.registrations.set(registration.secret, registration);
    state.registrationsByKey.set(
      `${registration.pubkey}:${registration.device_id}:${registration.platform}`,
      registration,
    );

    const vapidPublicKeyBytes = new Uint8Array(65);
    vapidPublicKeyBytes[0] = 0x04;
    for (let index = 1; index < vapidPublicKeyBytes.length; index += 1) {
      vapidPublicKeyBytes[index] = index;
    }
    const vapidPrivateKeyBytes = new Uint8Array(32);
    for (let index = 0; index < vapidPrivateKeyBytes.length; index += 1) {
      vapidPrivateKeyBytes[index] = index + 101;
    }
    const requestHeaders = new Headers();
    const requestBody = new ArrayBuffer(8);
    buildPushHTTPRequestMock.mockResolvedValue({
      endpoint: registration.endpoint,
      headers: requestHeaders,
      body: requestBody,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));

    const url = "https://acars.pub/api/notifications/send";
    const body = JSON.stringify({
      pubkey: "pubkey-1",
      registrationSecret: "secret-1",
      includeSource: true,
      notification: {
        id: "evt-1",
        category: "delivery",
        title: "Delivered",
        body: "Edge-safe",
        urgency: "normal",
        ttlPolicy: "long",
        collapseKey: "delivery:test",
        groupKey: "group:test",
        createdAt: 1,
        url: "/corporate?section=overview",
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
      env: {
        NOTIFICATIONS_DB: db as never,
        WEB_PUSH_VAPID_PUBLIC_KEY: encodeBase64Url(vapidPublicKeyBytes),
        WEB_PUSH_VAPID_PRIVATE_KEY: encodeBase64Url(vapidPrivateKeyBytes),
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      delivered: 1,
      skipped: 0,
      failed: 0,
    });
    expect(buildPushHTTPRequestMock).toHaveBeenCalledWith({
      privateJWK: {
        kty: "EC",
        crv: "P-256",
        x: encodeBase64Url(vapidPublicKeyBytes.subarray(1, 33)),
        y: encodeBase64Url(vapidPublicKeyBytes.subarray(33, 65)),
        d: encodeBase64Url(vapidPrivateKeyBytes),
        ext: true,
      },
      subscription: {
        endpoint: registration.endpoint,
        keys: {
          p256dh: registration.p256dh,
          auth: registration.auth,
        },
      },
      message: {
        payload: {
          id: "evt-1",
          title: "Delivered",
          body: "Edge-safe",
          category: "delivery",
          tag: "delivery:test",
          url: "/corporate?section=overview",
        },
        adminContact: "mailto:support@acars.pub",
        options: {
          ttl: 24 * 60 * 60,
          urgency: "normal",
          topic: "delivery:test",
        },
      },
    });
    expect(requestHeaders.get("TTL")).toBe(String(48 * 60 * 60));
    expect(fetchMock).toHaveBeenCalledWith(registration.endpoint, {
      method: "POST",
      headers: requestHeaders,
      body: requestBody,
    });
  });
});
