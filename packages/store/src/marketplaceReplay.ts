import type { ActionLogEntry } from "@acars/nostr";

export function computeRejectedBuyEventIds(actions: ActionLogEntry[]): Set<string> {
  const buysByInstance = new Map<string, ActionLogEntry[]>();

  for (const entry of actions) {
    if (entry.action.action !== "AIRCRAFT_BUY_USED") continue;
    const instanceId = entry.action.payload?.instanceId;
    if (typeof instanceId !== "string" || !instanceId.trim()) continue;
    const bucket = buysByInstance.get(instanceId);
    if (bucket) {
      bucket.push(entry);
    } else {
      buysByInstance.set(instanceId, [entry]);
    }
  }

  const rejectedEventIds = new Set<string>();
  for (const entries of buysByInstance.values()) {
    if (entries.length < 2) continue;
    entries.sort((a, b) => {
      const aTime = a.event.created_at ?? 0;
      const bTime = b.event.created_at ?? 0;
      if (aTime !== bTime) return aTime - bTime;
      return a.event.id.localeCompare(b.event.id);
    });
    for (let i = 1; i < entries.length; i++) {
      rejectedEventIds.add(entries[i].event.id);
    }
  }

  return rejectedEventIds;
}
