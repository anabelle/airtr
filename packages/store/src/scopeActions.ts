import type { Checkpoint } from "@acars/core";
import type { ActionLogEntry } from "@acars/nostr";

/**
 * Scope an action log to only entries newer than a checkpoint, while
 * defensively including any AIRCRAFT_PURCHASE or ROUTE_OPEN actions whose
 * entities are missing from the checkpoint state.
 *
 * This prevents a self-reinforcing corrupt-checkpoint loop: if a checkpoint
 * was saved with a stale fleet (e.g. after an app reload that itself loaded
 * from an older stale checkpoint), purchase and route-creation actions whose
 * ticks fall before the checkpoint tick would normally be filtered out,
 * perpetuating the data loss.  By cross-referencing the action log against
 * the checkpoint fleet/route IDs, we rescue those orphaned actions.
 */
export function scopeActionsToCheckpoint(
  actions: ActionLogEntry[],
  checkpoint: Checkpoint,
): ActionLogEntry[] {
  const checkpointTick = checkpoint.tick;
  const checkpointCreatedAtSeconds = Math.floor(checkpoint.createdAt / 1000);

  // Build lookup sets of entity IDs present in the checkpoint.
  const checkpointFleetIds = new Set(checkpoint.fleet.map((ac) => ac.id));
  const checkpointRouteIds = new Set(checkpoint.routes.map((rt) => rt.id));

  return actions.filter((entry) => {
    const payload = entry.action.payload as Record<string, unknown>;
    const actionTick = payload?.tick;

    // Standard time-based filter: include actions newer than checkpoint.
    const isNewer =
      typeof actionTick === "number" && Number.isFinite(actionTick)
        ? actionTick > checkpointTick
        : (entry.event.created_at ?? 0) > checkpointCreatedAtSeconds;

    if (isNewer) return true;

    // Defensive rescue: include AIRCRAFT_PURCHASE actions for aircraft
    // not present in the checkpoint fleet.  Without this, a stale
    // checkpoint that omitted a purchase would permanently lose the
    // aircraft because the purchase action's tick is below the checkpoint
    // tick and gets filtered out.
    if (entry.action.action === "AIRCRAFT_PURCHASE") {
      const instanceId = payload?.instanceId;
      if (typeof instanceId === "string" && !checkpointFleetIds.has(instanceId)) {
        return true;
      }
    }

    // Same for ROUTE_OPEN — rescue routes missing from the checkpoint.
    if (entry.action.action === "ROUTE_OPEN") {
      const routeId = payload?.routeId;
      if (typeof routeId === "string" && !checkpointRouteIds.has(routeId)) {
        return true;
      }
    }

    return false;
  });
}
