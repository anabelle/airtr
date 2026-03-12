import { buildPushHTTPRequest } from "@pushforge/builder";
import { verifyEvent } from "nostr-tools";

interface Env {
  NOTIFICATIONS_DB?: D1Database;
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;
  PUSH_CONTACT_EMAIL?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  CF_PAGES_BRANCH?: string;
}

type NotificationCategory =
  | "bankruptcy"
  | "competitor_hub"
  | "delivery"
  | "ferry"
  | "financial_warning"
  | "landing"
  | "maintenance"
  | "price_war"
  | "purchase"
  | "sale"
  | "takeoff"
  | "tier_upgrade";

type NotificationTTLPolicy = "short" | "medium" | "long";
type NotificationUrgency = "high" | "normal" | "low";

interface NotificationPayload {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  urgency: NotificationUrgency;
  ttlPolicy: NotificationTTLPolicy;
  collapseKey: string;
  groupKey: string;
  createdAt: number;
  url?: string;
}

interface NotificationPreferences {
  enabled?: boolean;
  categories?: Partial<Record<NotificationCategory, boolean>>;
  quietHours?: {
    enabled?: boolean;
    start?: string;
    end?: string;
    timezone?: string;
  };
}

interface NotificationRegistrationRecord {
  id: string;
  secret: string;
  pubkey: string;
  deviceId: string;
  platform: "browser" | "android";
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  fcmToken: string | null;
  preferencesJson: string;
  permissionState: string;
  timezone: string;
}

interface NostrHttpAuthEvent {
  id?: string;
  pubkey?: string;
  created_at?: number;
  kind?: number;
  tags?: string[][];
  content?: string;
  sig?: string;
}

const ALLOWED_ORIGINS = new Set([
  "https://acars.pub",
  "https://www.acars.pub",
  "http://localhost:5173",
  "http://localhost:4173",
]);
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;
const AUTH_MAX_AGE_SECONDS = 60;
const CRITICAL_CATEGORIES = new Set<NotificationCategory>(["bankruptcy", "financial_warning"]);
const MAX_VAPID_JWT_TTL_SECONDS = 24 * 60 * 60;
let fcmAccessTokenCache: { token: string; expiresAt: number } | null = null;
let webPushVapidJwkCache:
  | {
      publicKey: string;
      privateKey: string;
      jwk: JsonWebKey;
    }
  | null = null;
const FCM_ACCESS_TOKEN_CACHE_KEY = "fcm-access-token";
const NATIVE_ALLOWED_ORIGINS = new Set(["capacitor://localhost", "http://localhost"]);
const SAFE_NOTIFICATION_PATH_PREFIXES = [
  "/corporate",
  "/network",
  "/fleet",
  "/airport/",
  "/aircraft/",
];

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    headers: {
      "Cache-Control": "no-store",
    },
    ...init,
  });
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (NATIVE_ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.hostname.endsWith(".acars.pages.dev");
  } catch {
    return false;
  }
}

function getHeader(request: Request, name: string): string | null {
  return request.headers.get(name) ?? request.headers.get(name.toLowerCase());
}

function base64ToUtf8(value: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
}

function getTagValue(tags: string[][] | undefined, name: string): string | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (Array.isArray(tag) && tag[0] === name && typeof tag[1] === "string") {
      return tag[1];
    }
  }
  return null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateNotificationUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const parsed = new URL(trimmed, "https://acars.pub");
  if (parsed.origin !== "https://acars.pub") {
    throw new Error("Notification URL must stay within ACARS routes.");
  }

  if (!SAFE_NOTIFICATION_PATH_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))) {
    throw new Error("Notification URL must target a known ACARS route.");
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function requireAuthorizedPubkey(
  request: Request,
  expectedPubkey: string,
  requestBody: string,
): Promise<void> {
  const authorization = getHeader(request, "authorization");
  if (!authorization?.startsWith("Nostr ")) {
    throw new Error("Missing Nostr authorization header.");
  }

  const encodedEvent = authorization.slice("Nostr ".length).trim();
  if (!encodedEvent) {
    throw new Error("Missing Nostr authorization payload.");
  }

  let authEvent: NostrHttpAuthEvent;
  try {
    authEvent = JSON.parse(base64ToUtf8(encodedEvent)) as NostrHttpAuthEvent;
  } catch {
    throw new Error("Invalid Nostr authorization payload.");
  }

  if (authEvent.kind !== 27235) {
    throw new Error("Invalid Nostr authorization kind.");
  }
  if (typeof authEvent.pubkey !== "string" || authEvent.pubkey !== expectedPubkey) {
    throw new Error("Nostr authorization pubkey mismatch.");
  }
  if (typeof authEvent.created_at !== "number") {
    throw new Error("Missing Nostr authorization timestamp.");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - authEvent.created_at) > AUTH_MAX_AGE_SECONDS) {
    throw new Error("Expired Nostr authorization.");
  }

  const requestUrl = new URL(request.url);
  const absoluteUrl = requestUrl.toString();
  const signedUrl = getTagValue(authEvent.tags, "u");
  if (signedUrl !== absoluteUrl) {
    throw new Error("Nostr authorization URL mismatch.");
  }

  const signedMethod = getTagValue(authEvent.tags, "method");
  if (signedMethod?.toUpperCase() !== request.method.toUpperCase()) {
    throw new Error("Nostr authorization method mismatch.");
  }

  if (requestBody.length > 0) {
    const payloadTag = getTagValue(authEvent.tags, "payload");
    const expectedPayloadHash = await sha256Hex(requestBody);
    if (payloadTag !== expectedPayloadHash) {
      throw new Error("Nostr authorization payload mismatch.");
    }
  }

  if (
    !authEvent.id ||
    !authEvent.sig ||
    !verifyEvent(authEvent as Parameters<typeof verifyEvent>[0])
  ) {
    throw new Error("Invalid Nostr authorization signature.");
  }
}

async function isRateLimited(db: D1Database, key: string): Promise<boolean> {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const row = await db
    .prepare(`SELECT timestamps FROM notification_rate_limits WHERE key = ?1 LIMIT 1`)
    .bind(key)
    .first<{ timestamps: string }>();
  let storedTimestamps: number[] = [];
  if (row?.timestamps) {
    try {
      storedTimestamps = JSON.parse(row.timestamps) as number[];
    } catch (error) {
      console.warn("[notifications] Corrupted notification rate-limit entry.", error);
    }
  }
  const timestamps = storedTimestamps.filter((stamp) => stamp > cutoff);
  if (timestamps.length >= RATE_MAX_REQUESTS) {
    await db
      .prepare(
        `INSERT OR REPLACE INTO notification_rate_limits (key, timestamps, updated_at)
         VALUES (?1, ?2, ?3)`,
      )
      .bind(key, JSON.stringify(timestamps), now)
      .run();
    return true;
  }
  timestamps.push(now);
  await db
    .prepare(
      `INSERT OR REPLACE INTO notification_rate_limits (key, timestamps, updated_at)
       VALUES (?1, ?2, ?3)`,
    )
    .bind(key, JSON.stringify(timestamps), now)
    .run();
  return false;
}

function getDb(env: Env): D1Database {
  if (!env.NOTIFICATIONS_DB) {
    throw new Error(
      "Missing NOTIFICATIONS_DB binding. Create a D1 database and bind it as NOTIFICATIONS_DB.",
    );
  }
  return env.NOTIFICATIONS_DB;
}

async function ensureSchema(db: D1Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notification_registrations (
      id TEXT PRIMARY KEY,
      secret TEXT NOT NULL UNIQUE,
      pubkey TEXT NOT NULL,
      device_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      endpoint TEXT,
      p256dh TEXT,
      auth TEXT,
      fcm_token TEXT,
      preferences_json TEXT NOT NULL,
      permission_state TEXT NOT NULL,
      timezone TEXT NOT NULL,
      user_agent TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      UNIQUE(pubkey, device_id, platform)
    );
    CREATE INDEX IF NOT EXISTS idx_notification_registrations_pubkey
      ON notification_registrations(pubkey);
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      registration_id TEXT NOT NULL,
      notification_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_error TEXT,
      PRIMARY KEY (registration_id, notification_id)
    );
    CREATE TABLE IF NOT EXISTS notification_rate_limits (
      key TEXT PRIMARY KEY,
      timestamps TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_cache (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

async function readRequestText(request: Request): Promise<string> {
  try {
    return await request.text();
  } catch {
    throw new Error("Unable to read request body.");
  }
}

function buildDefaultPreferences(): NotificationPreferences {
  return {
    enabled: true,
    categories: {
      bankruptcy: true,
      financial_warning: true,
      competitor_hub: true,
      price_war: true,
      delivery: true,
      maintenance: false,
      ferry: false,
      landing: false,
      takeoff: false,
      tier_upgrade: true,
      purchase: true,
      sale: true,
    },
    quietHours: {
      enabled: false,
      start: "22:00",
      end: "07:00",
      timezone: "UTC",
    },
  };
}

function normalizePreferences(input: unknown): NotificationPreferences {
  const defaults = buildDefaultPreferences();
  if (!input || typeof input !== "object") return defaults;
  const parsed = input as NotificationPreferences;
  return {
    enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : defaults.enabled,
    categories: {
      ...defaults.categories,
      ...(parsed.categories ?? {}),
    },
    quietHours: {
      ...defaults.quietHours,
      ...(parsed.quietHours ?? {}),
    },
  };
}

function parseMinutes(value: string | undefined): number {
  if (!value) return 0;
  const [hours, minutes] = value.split(":").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function isWithinQuietHours(preferences: NotificationPreferences, now = new Date()): boolean {
  if (!preferences.quietHours?.enabled) return false;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: preferences.quietHours.timezone || "UTC",
  });
  const parts = formatter.formatToParts(now);
  const hour = Number.parseInt(parts.find((part) => part.type === "hour")?.value ?? "0", 10);
  const minute = Number.parseInt(parts.find((part) => part.type === "minute")?.value ?? "0", 10);
  const current = hour * 60 + minute;
  const start = parseMinutes(preferences.quietHours.start);
  const end = parseMinutes(preferences.quietHours.end);
  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function shouldDeliver(
  preferences: NotificationPreferences,
  payload: NotificationPayload,
): boolean {
  if (!preferences.enabled) return false;
  if (preferences.categories?.[payload.category] !== true) return false;
  if (CRITICAL_CATEGORIES.has(payload.category)) return true;
  return !isWithinQuietHours(preferences);
}

function getAndroidChannelId(category: NotificationCategory): string {
  switch (category) {
    case "bankruptcy":
    case "financial_warning":
      return "acars-critical";
    case "competitor_hub":
    case "price_war":
      return "acars-competition";
    case "tier_upgrade":
    case "purchase":
    case "sale":
      return "acars-progression";
    default:
      return "acars-operations";
  }
}

function ttlSecondsForPolicy(policy: NotificationTTLPolicy): number {
  switch (policy) {
    case "short":
      return 15 * 60;
    case "medium":
      return 6 * 60 * 60;
    case "long":
      return 48 * 60 * 60;
  }
}

function priorityForUrgency(urgency: NotificationUrgency): "high" | "normal" {
  return urgency === "high" ? "high" : "normal";
}

function makeSecret(): string {
  return `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${field}.`);
  }
  return value.trim();
}

async function upsertRegistration(
  db: D1Database,
  record: Omit<NotificationRegistrationRecord, "id" | "secret"> & {
    secret?: string | null;
  },
): Promise<NotificationRegistrationRecord> {
  const now = Date.now();
  const existing = await db
    .prepare(
      `SELECT id, secret, pubkey, device_id, platform, endpoint, p256dh, auth, fcm_token,
              preferences_json, permission_state, timezone
         FROM notification_registrations
        WHERE pubkey = ?1 AND device_id = ?2 AND platform = ?3
        LIMIT 1`,
    )
    .bind(record.pubkey, record.deviceId, record.platform)
    .first<{
      id: string;
      secret: string;
      pubkey: string;
      device_id: string;
      platform: "browser" | "android";
      endpoint: string | null;
      p256dh: string | null;
      auth: string | null;
      fcm_token: string | null;
      preferences_json: string;
      permission_state: string;
      timezone: string;
    }>();

  const id = existing?.id ?? crypto.randomUUID();
  const secret = record.secret || existing?.secret || makeSecret();

  await db
    .prepare(
      `INSERT INTO notification_registrations (
         id, secret, pubkey, device_id, platform, endpoint, p256dh, auth, fcm_token,
         preferences_json, permission_state, timezone, user_agent, created_at, updated_at, last_seen_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
       ON CONFLICT(pubkey, device_id, platform) DO UPDATE SET
         secret = excluded.secret,
         endpoint = excluded.endpoint,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         fcm_token = excluded.fcm_token,
         preferences_json = excluded.preferences_json,
         permission_state = excluded.permission_state,
         timezone = excluded.timezone,
         user_agent = excluded.user_agent,
         updated_at = excluded.updated_at,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(
      id,
      secret,
      record.pubkey,
      record.deviceId,
      record.platform,
      record.endpoint,
      record.p256dh,
      record.auth,
      record.fcmToken,
      record.preferencesJson,
      record.permissionState,
      record.timezone,
      null,
      now,
      now,
      now,
    )
    .run();

  return {
    id,
    secret,
    pubkey: record.pubkey,
    deviceId: record.deviceId,
    platform: record.platform,
    endpoint: record.endpoint,
    p256dh: record.p256dh,
    auth: record.auth,
    fcmToken: record.fcmToken,
    preferencesJson: record.preferencesJson,
    permissionState: record.permissionState,
    timezone: record.timezone,
  };
}

async function deleteRegistrationBySecretOrIdentity(
  db: D1Database,
  payload: {
    pubkey: string;
    deviceId: string;
    platform: string;
    registrationSecret?: string | null;
  },
): Promise<void> {
  if (payload.registrationSecret) {
    await db
      .prepare(`DELETE FROM notification_registrations WHERE secret = ?1`)
      .bind(payload.registrationSecret)
      .run();
    return;
  }
  await db
    .prepare(
      `DELETE FROM notification_registrations WHERE pubkey = ?1 AND device_id = ?2 AND platform = ?3`,
    )
    .bind(payload.pubkey, payload.deviceId, payload.platform)
    .run();
}

async function loadSourceRegistration(
  db: D1Database,
  secret: string,
): Promise<NotificationRegistrationRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, secret, pubkey, device_id, platform, endpoint, p256dh, auth, fcm_token,
              preferences_json, permission_state, timezone
         FROM notification_registrations
        WHERE secret = ?1
        LIMIT 1`,
    )
    .bind(secret)
    .first<{
      id: string;
      secret: string;
      pubkey: string;
      device_id: string;
      platform: "browser" | "android";
      endpoint: string | null;
      p256dh: string | null;
      auth: string | null;
      fcm_token: string | null;
      preferences_json: string;
      permission_state: string;
      timezone: string;
    }>();

  if (!row) return null;
  return {
    id: row.id,
    secret: row.secret,
    pubkey: row.pubkey,
    deviceId: row.device_id,
    platform: row.platform,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    fcmToken: row.fcm_token,
    preferencesJson: row.preferences_json,
    permissionState: row.permission_state,
    timezone: row.timezone,
  };
}

async function listTargetRegistrations(
  db: D1Database,
  pubkey: string,
  excludeRegistrationId?: string,
): Promise<NotificationRegistrationRecord[]> {
  const query = excludeRegistrationId
    ? `SELECT id, secret, pubkey, device_id, platform, endpoint, p256dh, auth, fcm_token,
              preferences_json, permission_state, timezone
         FROM notification_registrations
        WHERE pubkey = ?1 AND id != ?2`
    : `SELECT id, secret, pubkey, device_id, platform, endpoint, p256dh, auth, fcm_token,
              preferences_json, permission_state, timezone
         FROM notification_registrations
        WHERE pubkey = ?1`;
  const result = await (excludeRegistrationId
    ? db.prepare(query).bind(pubkey, excludeRegistrationId)
    : db.prepare(query).bind(pubkey)
  ).all<{
    id: string;
    secret: string;
    pubkey: string;
    device_id: string;
    platform: "browser" | "android";
    endpoint: string | null;
    p256dh: string | null;
    auth: string | null;
    fcm_token: string | null;
    preferences_json: string;
    permission_state: string;
    timezone: string;
  }>();

  return (result.results ?? []).map((row) => ({
    id: row.id,
    secret: row.secret,
    pubkey: row.pubkey,
    deviceId: row.device_id,
    platform: row.platform,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    fcmToken: row.fcm_token,
    preferencesJson: row.preferences_json,
    permissionState: row.permission_state,
    timezone: row.timezone,
  }));
}

async function markDeliveryAttempt(
  db: D1Database,
  registrationId: string,
  notificationId: string,
): Promise<boolean> {
  const now = Date.now();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO notification_deliveries (
         registration_id, notification_id, status, created_at, updated_at
       ) VALUES (?1, ?2, 'pending', ?3, ?3)`,
    )
    .bind(registrationId, notificationId, now)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

async function updateDeliveryStatus(
  db: D1Database,
  registrationId: string,
  notificationId: string,
  status: "delivered" | "failed",
  lastError?: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE notification_deliveries
          SET status = ?3, updated_at = ?4, last_error = ?5
        WHERE registration_id = ?1 AND notification_id = ?2`,
    )
    .bind(registrationId, notificationId, status, Date.now(), lastError ?? null)
    .run();
}

function base64UrlEncodeBytes(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeText(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlDecodeBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4 || 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function createWebPushVapidJwk(publicKey: string, privateKey: string): JsonWebKey {
  const publicKeyBytes = base64UrlDecodeBytes(publicKey);
  if (publicKeyBytes.byteLength !== 65 || publicKeyBytes[0] !== 0x04) {
    throw new Error("WEB_PUSH_VAPID_PUBLIC_KEY must be a P-256 uncompressed point.");
  }

  const privateKeyBytes = base64UrlDecodeBytes(privateKey);
  if (privateKeyBytes.byteLength !== 32) {
    throw new Error("WEB_PUSH_VAPID_PRIVATE_KEY must be a 32-byte base64url private key.");
  }

  return {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncodeBytes(publicKeyBytes.subarray(1, 33)),
    y: base64UrlEncodeBytes(publicKeyBytes.subarray(33, 65)),
    d: base64UrlEncodeBytes(privateKeyBytes),
    ext: true,
  };
}

function getWebPushVapidJwk(env: Env): JsonWebKey {
  const publicKey = requireString(env.WEB_PUSH_VAPID_PUBLIC_KEY, "WEB_PUSH_VAPID_PUBLIC_KEY");
  const privateKey = requireString(env.WEB_PUSH_VAPID_PRIVATE_KEY, "WEB_PUSH_VAPID_PRIVATE_KEY");

  if (
    webPushVapidJwkCache &&
    webPushVapidJwkCache.publicKey === publicKey &&
    webPushVapidJwkCache.privateKey === privateKey
  ) {
    return webPushVapidJwkCache.jwk;
  }

  const jwk = createWebPushVapidJwk(publicKey, privateKey);
  webPushVapidJwkCache = {
    publicKey,
    privateKey,
    jwk,
  };
  return jwk;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, "\n");
  const cleaned = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function getFcmAccessToken(env: Env): Promise<string> {
  if (fcmAccessTokenCache && Date.now() < fcmAccessTokenCache.expiresAt - 60_000) {
    return fcmAccessTokenCache.token;
  }

  try {
    const db = getDb(env);
    const cached = await db
      .prepare(
        `SELECT value_json, expires_at
           FROM notification_cache
          WHERE key = ?1
          LIMIT 1`,
      )
      .bind(FCM_ACCESS_TOKEN_CACHE_KEY)
      .first<{ value_json: string; expires_at: number }>();

    if (cached && Date.now() < cached.expires_at - 60_000) {
      const parsed = JSON.parse(cached.value_json) as { token?: string };
      if (parsed.token) {
        fcmAccessTokenCache = {
          token: parsed.token,
          expiresAt: cached.expires_at,
        };
        return parsed.token;
      }
    }
  } catch (error) {
    console.warn("[notifications] Unable to read persistent FCM cache.", error);
  }

  const clientEmail = requireString(env.FIREBASE_CLIENT_EMAIL, "FIREBASE_CLIENT_EMAIL");
  const privateKey = requireString(env.FIREBASE_PRIVATE_KEY, "FIREBASE_PRIVATE_KEY");
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64UrlEncodeText(
    JSON.stringify({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsignedToken = `${header}.${claimSet}`;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken),
  );
  const assertion = `${unsignedToken}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`FCM token exchange failed (${response.status}).`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  const token = requireString(data.access_token, "FCM access token");
  const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  fcmAccessTokenCache = {
    token,
    expiresAt,
  };

  try {
    const db = getDb(env);
    await db
      .prepare(
        `INSERT OR REPLACE INTO notification_cache (key, value_json, expires_at, updated_at)
         VALUES (?1, ?2, ?3, ?4)`,
      )
      .bind(FCM_ACCESS_TOKEN_CACHE_KEY, JSON.stringify({ token }), expiresAt, Date.now())
      .run();
  } catch (error) {
    console.warn("[notifications] Unable to persist FCM cache.", error);
  }

  return token;
}

async function sendWebPush(
  env: Env,
  registration: NotificationRegistrationRecord,
  payload: NotificationPayload,
) {
  if (!registration.endpoint || !registration.p256dh || !registration.auth) {
    throw new Error("Missing web push subscription keys.");
  }

  const ttl = ttlSecondsForPolicy(payload.ttlPolicy);
  const request = await buildPushHTTPRequest({
    privateJWK: getWebPushVapidJwk(env),
    subscription: {
      endpoint: registration.endpoint,
      keys: {
        p256dh: registration.p256dh,
        auth: registration.auth,
      },
    },
    message: {
      payload: {
        id: payload.id,
        title: payload.title,
        body: payload.body,
        category: payload.category,
        tag: payload.collapseKey,
        url: payload.url ?? "/corporate#notifications",
      },
      adminContact: `mailto:${env.PUSH_CONTACT_EMAIL ?? "support@acars.pub"}`,
      options: {
        ttl: Math.min(ttl, MAX_VAPID_JWT_TTL_SECONDS),
        urgency: payload.urgency,
        topic: payload.collapseKey,
      },
    },
  });

  if (request.headers instanceof Headers) {
    request.headers.set("TTL", String(ttl));
  } else {
    request.headers.TTL = String(ttl);
  }

  const response = await fetch(request.endpoint, {
    method: "POST",
    headers: request.headers,
    body: request.body,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Web push send failed (${response.status}).`);
  }
}

async function sendAndroidPush(
  env: Env,
  registration: NotificationRegistrationRecord,
  payload: NotificationPayload,
) {
  if (!registration.fcmToken) {
    throw new Error("Missing Android FCM token.");
  }
  const projectId = requireString(env.FIREBASE_PROJECT_ID, "FIREBASE_PROJECT_ID");
  const accessToken = await getFcmAccessToken(env);
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: registration.fcmToken,
          data: {
            id: payload.id,
            category: payload.category,
            title: payload.title,
            body: payload.body,
            url: payload.url ?? "/corporate#notifications",
          },
          notification: {
            title: payload.title,
            body: payload.body,
          },
          android: {
            ttl: `${ttlSecondsForPolicy(payload.ttlPolicy)}s`,
            priority: priorityForUrgency(payload.urgency),
            notification: {
              channel_id: getAndroidChannelId(payload.category),
              click_action: "FCM_PLUGIN_ACTIVITY",
              tag: payload.collapseKey,
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `FCM send failed (${response.status}).`);
  }
}

async function pruneRegistration(db: D1Database, registrationId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM notification_registrations WHERE id = ?1`)
    .bind(registrationId)
    .run();
}

function isStalePushError(message: string): boolean {
  return /410|404|unregistered|not\s*found|invalid\s*registration|registration-token-not-registered/i.test(
    message,
  );
}

async function handleRegister(context: EventContext<Env, string, unknown>): Promise<Response> {
  const db = getDb(context.env);
  await ensureSchema(db);
  const requestBody = await readRequestText(context.request);
  const body = await parseJson<{
    pubkey?: string;
    deviceId?: string;
    platform?: "browser" | "android";
    subscription?: PushSubscriptionJSON;
    token?: string;
    preferences?: NotificationPreferences;
    permissionState?: string;
    timezone?: string;
    registrationSecret?: string | null;
  }>(
    new Request(context.request.url, {
      method: context.request.method,
      headers: context.request.headers,
      body: requestBody,
    }),
  );

  const pubkey = requireString(body.pubkey, "pubkey");
  await requireAuthorizedPubkey(context.request, pubkey, requestBody);
  const deviceId = requireString(body.deviceId, "deviceId");
  const platform =
    body.platform === "android" ? "android" : body.platform === "browser" ? "browser" : null;
  if (!platform) {
    return json({ error: "Invalid platform." }, { status: 400 });
  }

  const preferences = normalizePreferences(body.preferences);
  const permissionState =
    typeof body.permissionState === "string" ? body.permissionState : "granted";
  const timezone = typeof body.timezone === "string" && body.timezone ? body.timezone : "UTC";

  const subscription =
    body.subscription && typeof body.subscription === "object" ? body.subscription : null;
  const endpoint =
    platform === "browser" ? requireString(subscription?.endpoint, "subscription.endpoint") : null;
  const p256dh =
    platform === "browser"
      ? requireString(subscription?.keys?.p256dh, "subscription.keys.p256dh")
      : null;
  const auth =
    platform === "browser"
      ? requireString(subscription?.keys?.auth, "subscription.keys.auth")
      : null;
  const fcmToken = platform === "android" ? requireString(body.token, "token") : null;

  const stored = await upsertRegistration(db, {
    secret: body.registrationSecret,
    pubkey,
    deviceId,
    platform,
    endpoint,
    p256dh,
    auth,
    fcmToken,
    preferencesJson: JSON.stringify(preferences),
    permissionState,
    timezone,
  });

  return json({
    registrationId: stored.id,
    registrationSecret: stored.secret,
    updatedAt: Date.now(),
  });
}

async function handleUnregister(context: EventContext<Env, string, unknown>): Promise<Response> {
  const db = getDb(context.env);
  await ensureSchema(db);
  const requestBody = await readRequestText(context.request);
  const body = await parseJson<{
    pubkey?: string;
    deviceId?: string;
    platform?: string;
    registrationSecret?: string | null;
  }>(
    new Request(context.request.url, {
      method: context.request.method,
      headers: context.request.headers,
      body: requestBody,
    }),
  );

  const pubkey = requireString(body.pubkey, "pubkey");
  await requireAuthorizedPubkey(context.request, pubkey, requestBody);

  await deleteRegistrationBySecretOrIdentity(db, {
    pubkey,
    deviceId: requireString(body.deviceId, "deviceId"),
    platform: requireString(body.platform, "platform"),
    registrationSecret: body.registrationSecret,
  });

  return json({ ok: true });
}

async function handleSend(context: EventContext<Env, string, unknown>): Promise<Response> {
  const db = getDb(context.env);
  await ensureSchema(db);
  const requestBody = await readRequestText(context.request);
  const body = await parseJson<{
    pubkey?: string;
    registrationSecret?: string;
    includeSource?: boolean;
    notification?: NotificationPayload;
  }>(
    new Request(context.request.url, {
      method: context.request.method,
      headers: context.request.headers,
      body: requestBody,
    }),
  );

  const pubkey = requireString(body.pubkey, "pubkey");
  await requireAuthorizedPubkey(context.request, pubkey, requestBody);

  const secret = requireString(body.registrationSecret, "registrationSecret");
  const source = await loadSourceRegistration(db, secret);
  if (!source) {
    return json({ error: "Unknown registration secret." }, { status: 403 });
  }
  if (source.pubkey !== pubkey) {
    return json(
      { error: "Registration secret does not match the authorized pubkey." },
      { status: 403 },
    );
  }

  const notification = body.notification;
  if (!notification || typeof notification !== "object") {
    return json({ error: "Missing notification payload." }, { status: 400 });
  }
  notification.id = requireString(notification.id, "notification.id");
  notification.title = requireString(notification.title, "notification.title");
  notification.body = requireString(notification.body, "notification.body");
  notification.url = validateNotificationUrl(notification.url);

  const targets = await listTargetRegistrations(
    db,
    source.pubkey,
    body.includeSource ? undefined : source.id,
  );

  let delivered = 0;
  let skipped = 0;
  let failed = 0;

  for (const registration of targets) {
    const preferences = normalizePreferences(JSON.parse(registration.preferencesJson));
    if (!shouldDeliver(preferences, notification)) {
      skipped += 1;
      continue;
    }

    const firstAttempt = await markDeliveryAttempt(db, registration.id, notification.id);
    if (!firstAttempt) {
      skipped += 1;
      continue;
    }

    try {
      if (registration.platform === "browser") {
        await sendWebPush(context.env, registration, notification);
      } else {
        await sendAndroidPush(context.env, registration, notification);
      }
      await updateDeliveryStatus(db, registration.id, notification.id, "delivered");
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Push send failed.";
      await updateDeliveryStatus(db, registration.id, notification.id, "failed", message);
      if (isStalePushError(message)) {
        await pruneRegistration(db, registration.id);
      }
      failed += 1;
    }
  }

  return json({ ok: true, delivered, skipped, failed });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const db = getDb(context.env);
  await ensureSchema(db);

  const origin = context.request.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const limiterKey =
    context.request.headers.get("cf-connecting-ip") ??
    context.request.headers.get("x-real-ip") ??
    origin ??
    "unknown";
  if (await isRateLimited(db, limiterKey)) {
    return json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  try {
    const pathname = new URL(context.request.url).pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/register")) {
      return await handleRegister(context);
    }
    if (pathname.endsWith("/unregister")) {
      return await handleUnregister(context);
    }
    if (pathname.endsWith("/send")) {
      return await handleSend(context);
    }
    return json({ error: "Unknown notifications endpoint." }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected notifications error.";
    return json({ error: message }, { status: 500 });
  }
};
