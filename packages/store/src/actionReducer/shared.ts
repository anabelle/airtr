import type { AirlineEntity, FixedPoint, TimelineEventType } from "@acars/core";
import { fp } from "@acars/core";

export const MAX_TIMELINE_EVENTS = 1000;

export const DEFAULT_LIVERY = {
  primary: "#1f2937",
  secondary: "#3b82f6",
  accent: "#f59e0b",
};

export const MAX_NAME_LENGTH = 64;
export const MAX_CODE_LENGTH = 8;
export const MAX_HUBS = 12;
export const MAX_DISTANCE_KM = 20000;
export const MAX_FARE = fp(10000);
export const MAX_PRICE = fp(1000000000);
export const MIN_BALANCE = fp(-1000000000);
export const MAX_BALANCE = fp(1000000000);
export const VALID_STATUSES: AirlineEntity["status"][] = [
  "private",
  "public",
  "chapter11",
  "liquidated",
];
export const TIMELINE_EVENT_TYPES: ReadonlySet<TimelineEventType> = new Set([
  "takeoff",
  "landing",
  "purchase",
  "sale",
  "lease_payment",
  "maintenance",
  "delivery",
  "hub_change",
  "route_change",
  "ferry",
  "competitor_hub",
  "price_war",
  "tier_upgrade",
  "bankruptcy",
  "financial_warning",
]);

export const asString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const isTimelineEventType = (value: string): value is TimelineEventType =>
  TIMELINE_EVENT_TYPES.has(value as TimelineEventType);

export const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const clampInt = (value: unknown, min: number, max: number): number | null => {
  const numeric = asNumber(value);
  if (numeric === null) return null;
  const rounded = Math.floor(numeric);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
};

export const clampNumber = (value: unknown, min: number, max: number): number | null => {
  const numeric = asNumber(value);
  if (numeric === null) return null;
  if (numeric < min) return min;
  if (numeric > max) return max;
  return numeric;
};

export const clampString = (value: unknown, maxLength: number): string | null => {
  const str = asString(value);
  if (!str) return null;
  return str.slice(0, maxLength);
};

export const sanitizeIata = (value: unknown): string | null => {
  const str = asString(value);
  if (!str) return null;
  const trimmed = str.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(trimmed)) return null;
  return trimmed;
};

export const clampFixedPoint = (
  value: unknown,
  min: FixedPoint,
  max: FixedPoint,
): FixedPoint | null => {
  const numeric = asNumber(value);
  if (numeric === null) return null;
  const rounded = Math.round(numeric);
  const clamped = Math.min(Math.max(rounded, min), max);
  return clamped as FixedPoint;
};

export const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => asString(item)).filter((item): item is string => Boolean(item))
    : [];

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

export const buildAircraftName = (modelName: string | undefined, index: number) =>
  `${modelName ?? "Aircraft"} ${index}`;
