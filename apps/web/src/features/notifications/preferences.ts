import type { NotificationPayload, NotificationCategory } from "./domain";
import { NOTIFICATION_CATEGORY_META, PUSH_ELIGIBLE_TIMELINE_TYPES } from "./domain";

export interface QuietHoursPreference {
  enabled: boolean;
  start: string;
  end: string;
  timezone: string;
}

export interface NotificationPreferences {
  enabled: boolean;
  categories: Record<NotificationCategory, boolean>;
  quietHours: QuietHoursPreference;
}

export const DEFAULT_QUIET_HOURS: QuietHoursPreference = {
  enabled: false,
  start: "22:00",
  end: "07:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
};

export const buildDefaultNotificationPreferences = (): NotificationPreferences => ({
  enabled: true,
  categories: Object.fromEntries(
    NOTIFICATION_CATEGORY_META.map((item) => [item.category, item.defaultEnabled]),
  ) as Record<NotificationCategory, boolean>,
  quietHours: { ...DEFAULT_QUIET_HOURS },
});

export function getNotificationPreferencesStorageKey(pubkey: string): string {
  return `acars:notifications:prefs:${pubkey}`;
}

export function loadNotificationPreferences(pubkey: string | null): NotificationPreferences {
  const defaults = buildDefaultNotificationPreferences();
  if (!pubkey || typeof window === "undefined") return defaults;

  try {
    const raw = localStorage.getItem(getNotificationPreferencesStorageKey(pubkey));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;

    const categories = Object.fromEntries(
      PUSH_ELIGIBLE_TIMELINE_TYPES.map((category) => [
        category,
        typeof parsed.categories?.[category] === "boolean"
          ? parsed.categories[category]
          : defaults.categories[category],
      ]),
    ) as Record<NotificationCategory, boolean>;

    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : defaults.enabled,
      categories,
      quietHours: {
        enabled:
          typeof parsed.quietHours?.enabled === "boolean"
            ? parsed.quietHours.enabled
            : defaults.quietHours.enabled,
        start:
          typeof parsed.quietHours?.start === "string"
            ? parsed.quietHours.start
            : defaults.quietHours.start,
        end:
          typeof parsed.quietHours?.end === "string"
            ? parsed.quietHours.end
            : defaults.quietHours.end,
        timezone:
          typeof parsed.quietHours?.timezone === "string"
            ? parsed.quietHours.timezone
            : defaults.quietHours.timezone,
      },
    };
  } catch {
    return defaults;
  }
}

export function saveNotificationPreferences(
  pubkey: string,
  preferences: NotificationPreferences,
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(getNotificationPreferencesStorageKey(pubkey), JSON.stringify(preferences));
}

const CRITICAL_CATEGORIES = new Set<NotificationCategory>(["bankruptcy", "financial_warning"]);

function parseMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

export function isWithinQuietHours(
  preferences: NotificationPreferences,
  now = new Date(),
): boolean {
  if (!preferences.quietHours.enabled) return false;

  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: preferences.quietHours.timezone,
  });

  const parts = formatter.formatToParts(now);
  const hours = Number.parseInt(parts.find((part) => part.type === "hour")?.value ?? "0", 10);
  const minutes = Number.parseInt(parts.find((part) => part.type === "minute")?.value ?? "0", 10);
  const currentMinutes = hours * 60 + minutes;
  const start = parseMinutes(preferences.quietHours.start);
  const end = parseMinutes(preferences.quietHours.end);

  if (start === end) return false;
  if (start < end) {
    return currentMinutes >= start && currentMinutes < end;
  }
  return currentMinutes >= start || currentMinutes < end;
}

export function shouldDeliverNotification(
  preferences: NotificationPreferences,
  payload: NotificationPayload,
  now = new Date(),
): boolean {
  if (!preferences.enabled) return false;
  if (!preferences.categories[payload.category]) return false;
  if (CRITICAL_CATEGORIES.has(payload.category)) return true;
  return !isWithinQuietHours(preferences, now);
}
