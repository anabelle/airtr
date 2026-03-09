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
  const response = await fetch("/api/notifications/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(registration),
  });
  return readJson<NotificationRegistrationResponse>(response);
}

export async function unregisterNotificationTarget(payload: {
  deviceId: string;
  platform: NotificationRegistrationPlatform;
  pubkey: string;
  registrationSecret?: string | null;
}): Promise<void> {
  const response = await fetch("/api/notifications/unregister", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await readJson<{ ok: true }>(response);
}

export async function sendNotificationCandidate(payload: {
  registrationSecret: string;
  includeSource: boolean;
  notification: NotificationPayload;
}): Promise<void> {
  const response = await fetch("/api/notifications/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await readJson<{ ok: true }>(response);
}
