import type { Checkpoint } from "@acars/core";
import type { ActionLogEntry } from "@acars/nostr";

/**
 * Scope an action log to only entries newer than a checkpoint, while
 * defensively including any AIRCRAFT_PURCHASE or ROUTE_OPEN actions whose
 * entities are missing from the checkpoint state — and any
 * ROUTE_ASSIGN_AIRCRAFT / ROUTE_UNASSIGN_AIRCRAFT actions that reference
 * those rescued entities.
 *
 * This prevents a self-reinforcing corrupt-checkpoint loop: if a checkpoint
 * was saved with a stale fleet (e.g. after an app reload that itself loaded
 * from an older stale checkpoint), purchase and route-creation actions whose
 * ticks fall before the checkpoint tick would normally be filtered out,
 * perpetuating the data loss.  By cross-referencing the action log against
 * the checkpoint fleet/route IDs, we rescue those orphaned actions.
 *
 * The rescue is a two-pass process:
 *   Pass 1 — Identify rescued aircraft IDs (purchases missing from
 *            checkpoint fleet) and rescued route IDs (opens missing from
 *            checkpoint routes).  Also detect AIRCRAFT_SELL / ROUTE_CLOSE
 *            actions below the checkpoint tick and exclude those IDs —
 *            they are correctly absent, not stale.
 *   Pass 2 — Filter actions using the standard time-based rule, plus
 *            rescue rules for purchases, route opens, and assignment/
 *            unassignment actions that reference rescued aircraft.
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

  // --- Pass 1: identify rescued entity IDs ---
  //
  // We must also detect AIRCRAFT_SELL / ROUTE_CLOSE actions below the
  // checkpoint tick.  If an aircraft was purchased then sold (or a route
  // opened then closed) before the stale checkpoint, neither entity would
  // appear in the checkpoint — but rescuing the purchase/open without the
  // sell/close would resurrect a zombie entity.  We exclude sold/closed
  // IDs from the rescue sets to prevent this.
  const candidateAircraftIds = new Set<string>();
  const candidateRouteIds = new Set<string>();
  const soldBeforeCheckpointIds = new Set<string>();
  const closedBeforeCheckpointIds = new Set<string>();

  for (const entry of actions) {
    const payload = entry.action.payload as Record<string, unknown>;
    const actionTick = payload?.tick;

    // Only consider actions at or below the checkpoint tick — actions
    // newer than the checkpoint are always included and don't need rescue.
    const isNewer =
      typeof actionTick === "number" && Number.isFinite(actionTick)
        ? actionTick > checkpointTick
        : (entry.event.created_at ?? 0) > checkpointCreatedAtSeconds;

    if (isNewer) continue;

    if (entry.action.action === "AIRCRAFT_PURCHASE") {
      const instanceId = payload?.instanceId;
      if (typeof instanceId === "string" && !checkpointFleetIds.has(instanceId)) {
        candidateAircraftIds.add(instanceId);
      }
    }

    if (entry.action.action === "AIRCRAFT_SELL") {
      const instanceId = payload?.instanceId;
      if (typeof instanceId === "string") {
        soldBeforeCheckpointIds.add(instanceId);
      }
    }

    if (entry.action.action === "ROUTE_OPEN") {
      const routeId = payload?.routeId;
      if (typeof routeId === "string" && !checkpointRouteIds.has(routeId)) {
        candidateRouteIds.add(routeId);
      }
    }

    if (entry.action.action === "ROUTE_CLOSE") {
      const routeId = payload?.routeId;
      if (typeof routeId === "string") {
        closedBeforeCheckpointIds.add(routeId);
      }
    }
  }

  // Final rescue sets: exclude aircraft that were sold and routes that
  // were closed before the checkpoint — those are correctly absent.
  const rescuedAircraftIds = new Set<string>();
  for (const id of candidateAircraftIds) {
    if (!soldBeforeCheckpointIds.has(id)) {
      rescuedAircraftIds.add(id);
    }
  }
  const rescuedRouteIds = new Set<string>();
  for (const id of candidateRouteIds) {
    if (!closedBeforeCheckpointIds.has(id)) {
      rescuedRouteIds.add(id);
    }
  }

  // --- Pass 2: filter with rescue rules ---
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
    // not present in the checkpoint fleet.
    if (entry.action.action === "AIRCRAFT_PURCHASE") {
      const instanceId = payload?.instanceId;
      if (typeof instanceId === "string" && rescuedAircraftIds.has(instanceId)) {
        return true;
      }
    }

    // Rescue ROUTE_OPEN actions for routes missing from the checkpoint.
    if (entry.action.action === "ROUTE_OPEN") {
      const routeId = payload?.routeId;
      if (typeof routeId === "string" && rescuedRouteIds.has(routeId)) {
        return true;
      }
    }

    // Rescue ROUTE_ASSIGN_AIRCRAFT / ROUTE_UNASSIGN_AIRCRAFT actions that
    // reference a rescued aircraft OR a rescued route.  Without this,
    // rescued entities appear as idle/unassigned instead of flying because
    // the assignment action's tick is below the checkpoint tick.
    if (
      entry.action.action === "ROUTE_ASSIGN_AIRCRAFT" ||
      entry.action.action === "ROUTE_UNASSIGN_AIRCRAFT"
    ) {
      const aircraftId = payload?.aircraftId;
      const routeId = payload?.routeId;
      if (
        (typeof aircraftId === "string" && rescuedAircraftIds.has(aircraftId)) ||
        (typeof routeId === "string" && rescuedRouteIds.has(routeId))
      ) {
        return true;
      }
    }

    return false;
  });
}
