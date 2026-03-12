import type { TimelineEvent, TimelineEventType } from "@acars/core";
import { buildNotificationUrl, type NotificationDeepLinkTarget } from "./deepLinks";

export const PUSH_ELIGIBLE_TIMELINE_TYPES = [
  "bankruptcy",
  "competitor_hub",
  "delivery",
  "ferry",
  "financial_warning",
  "landing",
  "maintenance",
  "price_war",
  "purchase",
  "sale",
  "takeoff",
  "tier_upgrade",
] as const satisfies readonly TimelineEventType[];

export type NotificationCategory = (typeof PUSH_ELIGIBLE_TIMELINE_TYPES)[number];
export type NotificationUrgency = "high" | "normal" | "low";
export type NotificationTTLPolicy = "short" | "medium" | "long";

export interface NotificationPayload {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  urgency: NotificationUrgency;
  ttlPolicy: NotificationTTLPolicy;
  collapseKey: string;
  groupKey: string;
  deepLink: NotificationDeepLinkTarget;
  url: string;
  createdAt: number;
  sourceEventId?: string;
}

export interface NotificationCategoryMeta {
  category: NotificationCategory;
  title: string;
  description: string;
  defaultEnabled: boolean;
}

export const NOTIFICATION_CATEGORY_META: readonly NotificationCategoryMeta[] = [
  {
    category: "bankruptcy",
    title: "Bankruptcy filings",
    description: "Immediate warnings when your airline enters Chapter 11 or liquidation.",
    defaultEnabled: true,
  },
  {
    category: "financial_warning",
    title: "Financial warnings",
    description: "Critical balance and cash-flow alerts that may require urgent action.",
    defaultEnabled: true,
  },
  {
    category: "competitor_hub",
    title: "Competitor hub moves",
    description: "Competitive alerts when rivals expand into your markets.",
    defaultEnabled: true,
  },
  {
    category: "price_war",
    title: "Price wars",
    description: "Pricing pressure alerts on contested routes and markets.",
    defaultEnabled: true,
  },
  {
    category: "delivery",
    title: "Aircraft deliveries",
    description: "High-signal operations updates when purchased aircraft arrive.",
    defaultEnabled: true,
  },
  {
    category: "maintenance",
    title: "Maintenance",
    description: "Maintenance and grounding events for your aircraft.",
    defaultEnabled: false,
  },
  {
    category: "ferry",
    title: "Ferry flights",
    description: "Repositioning flights and non-revenue moves between hubs.",
    defaultEnabled: false,
  },
  {
    category: "takeoff",
    title: "Takeoffs",
    description: "Operations-heavy alerts when flights depart.",
    defaultEnabled: false,
  },
  {
    category: "landing",
    title: "Landings",
    description: "Operations-heavy alerts when flights complete successfully.",
    defaultEnabled: false,
  },
  {
    category: "tier_upgrade",
    title: "Tier upgrades",
    description: "Progression milestones when your airline reaches a new corporate tier.",
    defaultEnabled: true,
  },
  {
    category: "purchase",
    title: "Major purchases",
    description: "Important acquisition events such as aircraft purchases.",
    defaultEnabled: true,
  },
  {
    category: "sale",
    title: "Asset sales",
    description: "Important sales and fleet disposition events.",
    defaultEnabled: true,
  },
] as const;

export const TIMELINE_NOTIFICATION_TITLES: Partial<Record<TimelineEventType, string>> = {
  takeoff: "Flight departed",
  landing: "Flight landed",
  purchase: "Purchase completed",
  sale: "Asset sold",
  maintenance: "Maintenance update",
  delivery: "Delivery complete",
  ferry: "Ferry flight",
  competitor_hub: "Competitor alert",
  price_war: "Price war detected",
  tier_upgrade: "Tier upgraded",
  bankruptcy: "Bankruptcy filed",
  financial_warning: "Financial warning",
};

const isPushCategory = (type: TimelineEventType): type is NotificationCategory =>
  PUSH_ELIGIBLE_TIMELINE_TYPES.includes(type as NotificationCategory);

const getNotificationRoutingTarget = (event: TimelineEvent): NotificationDeepLinkTarget => {
  if (
    event.aircraftId &&
    ["delivery", "maintenance", "ferry", "purchase", "sale"].includes(event.type)
  ) {
    return { kind: "aircraft", id: event.aircraftId };
  }

  if (event.originIata && event.destinationIata) {
    return {
      kind: "network",
      tab: "active",
      routeFocus: {
        originIata: event.originIata,
        destinationIata: event.destinationIata,
      },
    };
  }

  if (event.originIata) {
    return { kind: "airport", iata: event.originIata, tab: "info" };
  }

  return { kind: "corporate", section: "activity" };
};

const getNotificationUrgency = (type: NotificationCategory): NotificationUrgency => {
  switch (type) {
    case "bankruptcy":
    case "financial_warning":
    case "price_war":
      return "high";
    case "takeoff":
    case "landing":
      return "low";
    default:
      return "normal";
  }
};

const getNotificationTTLPolicy = (type: NotificationCategory): NotificationTTLPolicy => {
  switch (type) {
    case "bankruptcy":
    case "financial_warning":
    case "price_war":
      return "short";
    case "takeoff":
    case "landing":
      return "medium";
    default:
      return "long";
  }
};

const getCollapseParts = (event: TimelineEvent, category: NotificationCategory) => {
  if (event.originIata && event.destinationIata) {
    const market = `${event.originIata}-${event.destinationIata}`;
    return { collapseKey: `${category}:${market}`, groupKey: `market:${market}` };
  }

  if (event.aircraftId) {
    return {
      collapseKey: `${category}:${event.aircraftId}`,
      groupKey: `aircraft:${event.aircraftId}`,
    };
  }

  return { collapseKey: `${category}:global`, groupKey: `category:${category}` };
};

export function buildTimelineNotificationCandidate(
  event: TimelineEvent,
): NotificationPayload | null {
  if (!isPushCategory(event.type)) return null;

  const { collapseKey, groupKey } = getCollapseParts(event, event.type);
  const deepLink = getNotificationRoutingTarget(event);

  return {
    id: event.id,
    category: event.type,
    title: TIMELINE_NOTIFICATION_TITLES[event.type] ?? "Operations update",
    body: event.description,
    urgency: getNotificationUrgency(event.type),
    ttlPolicy: getNotificationTTLPolicy(event.type),
    collapseKey,
    groupKey,
    deepLink,
    url: buildNotificationUrl(deepLink),
    createdAt: event.timestamp,
    sourceEventId: event.id,
  };
}

export function getNotificationCategoryMeta(
  category: NotificationCategory,
): NotificationCategoryMeta {
  const meta = NOTIFICATION_CATEGORY_META.find((item) => item.category === category);
  if (!meta) {
    throw new Error(`Unknown notification category: ${category}`);
  }
  return meta;
}
