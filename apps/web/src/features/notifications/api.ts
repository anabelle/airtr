import { getNDK, NDKEvent } from "@acars/nostr";
import type { NotificationPayload } from "./domain";
import type { NotificationPreferences } from "./preferences";

export type NotificationRegistrationPlatform = "browser" | "android";

interface NotificationRegistrationBase {
  pubkey: string;
  deviceId: string;
  platform: NotificationRegistrationPlatform;
  preferences: NotificationPreferences;
  permissionState: string;
  timezone: string;
  registrationSecret?: string | null;
}

export interface BrowserNotificationRegistration extends NotificationRegistrationBase {
  platform: "browser";
  subscription: PushSubscriptionJSON;
}

export interface AndroidNotificationRegistration extends NotificationRegistrationBase {
  platform: "android";
  token: string;
}

export type NotificationRegistration =
  | BrowserNotificationRegistration
  | AndroidNotificationRegistration;

export interface NotificationRegistrationResponse {
  registrationId: string;
  registrationSecret: string;
  updatedAt: number;
}

const DEFAULT_NOTIFICATIONS_API_ORIGIN = "https://acars.pub";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getNotificationsApiOrigin(): string {
  const env = import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  };
  const configuredOrigin = env.env?.VITE_NOTIFICATIONS_API_ORIGIN?.trim();
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/, "");
  }

  if (typeof window === "undefined") {
    return DEFAULT_NOTIFICATIONS_API_ORIGIN;
  }

  const origin = window.location.origin;
  try {
    const parsed = new URL(origin);
    if (
      parsed.protocol.startsWith("http") &&
      (parsed.hostname === "acars.pub" ||
        parsed.hostname === "www.acars.pub" ||
        parsed.hostname === "localhost" ||
        parsed.hostname.endsWith(".acars.pages.dev"))
    ) {
      return parsed.origin;
    }
  } catch {
    // Fall back to the production host for native shells or unusual origins.
  }

  return DEFAULT_NOTIFICATIONS_API_ORIGIN;
}

function buildNotificationsApiUrl(path: string): string {
  return new URL(path, getNotificationsApiOrigin()).toString();
}

async function createNostrAuthorizationHeader(
  absoluteUrl: string,
  method: string,
  body: string,
  expectedPubkey: string,
): Promise<string> {
  const ndk = getNDK();
  const signer = ndk.signer;
  if (!signer) {
    throw new Error("A Nostr signer is required before notifications can sync.");
  }

  const signerUser = await signer.user();
  if (signerUser.pubkey !== expectedPubkey) {
    throw new Error("The active Nostr signer does not match the current airline identity.");
  }

  const event = new NDKEvent(ndk);
  event.kind = 27235;
  event.content = "";
  event.tags = [
    ["u", absoluteUrl],
    ["method", method.toUpperCase()],
  ];

  if (body.length > 0) {
    event.tags.push(["payload", await sha256Hex(body)]);
  }

  await event.sign(signer);
  return `Nostr ${bytesToBase64(new TextEncoder().encode(JSON.stringify(event.rawEvent())))}`;
}

async function postNotificationsJson<TResponse>(
  path: string,
  body: string,
  pubkey: string,
): Promise<TResponse> {
  const absoluteUrl = buildNotificationsApiUrl(path);
  const response = await fetch(absoluteUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: await createNostrAuthorizationHeader(absoluteUrl, "POST", body, pubkey),
    },
    body,
  });
  return readJson<TResponse>(response);
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Notification request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function registerNotificationTarget(
  registration: NotificationRegistration,
): Promise<NotificationRegistrationResponse> {
  const body = JSON.stringify(registration);
  return postNotificationsJson<NotificationRegistrationResponse>(
    "/api/notifications/register",
    body,
    registration.pubkey,
  );
}

export async function unregisterNotificationTarget(payload: {
  deviceId: string;
  platform: NotificationRegistrationPlatform;
  pubkey: string;
  registrationSecret?: string | null;
}): Promise<void> {
  const body = JSON.stringify(payload);
  await postNotificationsJson<{ ok: true }>("/api/notifications/unregister", body, payload.pubkey);
}

export async function sendNotificationCandidate(payload: {
  pubkey: string;
  registrationSecret: string;
  includeSource: boolean;
  notification: NotificationPayload;
}): Promise<void> {
  const body = JSON.stringify(payload);
  await postNotificationsJson<{ ok: true }>("/api/notifications/send", body, payload.pubkey);
}
