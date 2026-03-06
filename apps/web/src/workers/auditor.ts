import type { Checkpoint } from "@acars/core";
import {
  computeActionChainHash,
  computeCheckpointStateHash,
  decompressSnapshotString,
} from "@acars/core";
import { loadActionLog, loadAllSnapshots, type ActionLogEntry } from "@acars/nostr";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ACTIONS = 1500;

type AuditTrigger = "start" | "interval" | "manual";

type WorkerCommand =
  | "start"
  | "stop"
  | "run-now"
  | { type: "start"; intervalMs?: number; maxActions?: number }
  | { type: "stop" }
  | { type: "run-now" };

interface PeerAuditResult {
  pubkey: string;
  tick: number;
  stateHashValid: boolean;
  actionChainStatus: "verified" | "failed" | "inconclusive";
  expectedStateHash: string;
  computedStateHash: string;
  expectedActionChainHash: string;
  computedActionChainHash: string | null;
  issues: string[];
}

interface AuditCyclePayload {
  type: "audit-cycle";
  trigger: AuditTrigger;
  cycle: number;
  startedAt: number;
  finishedAt: number;
  peerCount: number;
  verifiedCount: number;
  failedCount: number;
  inconclusiveCount: number;
  results: PeerAuditResult[];
}

interface AuditErrorPayload {
  type: "audit-error";
  trigger: AuditTrigger;
  cycle: number;
  startedAt: number;
  finishedAt: number;
  error: string;
}

let interval: number | null = null;
let cycle = 0;
let cycleInFlight = false;
let maxActions = DEFAULT_MAX_ACTIONS;
let intervalMs = DEFAULT_INTERVAL_MS;

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const command = e.data;

  if (command === "start" || (typeof command === "object" && command?.type === "start")) {
    if (interval !== null) return;

    const requestedInterval =
      typeof command === "object" && typeof command.intervalMs === "number"
        ? Math.floor(command.intervalMs)
        : DEFAULT_INTERVAL_MS;
    intervalMs =
      Number.isFinite(requestedInterval) && requestedInterval > 0
        ? requestedInterval
        : DEFAULT_INTERVAL_MS;

    const requestedMaxActions =
      typeof command === "object" && typeof command.maxActions === "number"
        ? Math.floor(command.maxActions)
        : DEFAULT_MAX_ACTIONS;
    maxActions =
      Number.isFinite(requestedMaxActions) && requestedMaxActions > 0
        ? requestedMaxActions
        : DEFAULT_MAX_ACTIONS;

    interval = self.setInterval(() => {
      void runAuditCycle("interval");
    }, intervalMs);
    void runAuditCycle("start");
    return;
  }

  if (command === "run-now" || (typeof command === "object" && command?.type === "run-now")) {
    void runAuditCycle("manual");
    return;
  }

  if (command === "stop" || (typeof command === "object" && command?.type === "stop")) {
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  }
};

function isCheckpointLike(value: unknown): value is Checkpoint {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.actionChainHash === "string" &&
    typeof record.stateHash === "string" &&
    typeof record.tick === "number" &&
    Array.isArray(record.fleet) &&
    Array.isArray(record.routes) &&
    Array.isArray(record.timeline) &&
    typeof record.airline === "object" &&
    record.airline !== null
  );
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown audit error";
}

function groupActionsByPubkey(entries: ActionLogEntry[]): Map<string, ActionLogEntry[]> {
  const grouped = new Map<string, ActionLogEntry[]>();
  for (const entry of entries) {
    const pubkey = entry.event.author?.pubkey;
    if (!pubkey) continue;
    const list = grouped.get(pubkey) ?? [];
    list.push(entry);
    grouped.set(pubkey, list);
  }
  return grouped;
}

function sortActions(entries: ActionLogEntry[]): ActionLogEntry[] {
  return [...entries].sort((a, b) => {
    const aTime = a.event.created_at ?? 0;
    const bTime = b.event.created_at ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.event.id.localeCompare(b.event.id);
  });
}

async function verifyPeerSnapshot(
  pubkey: string,
  compressedData: string,
  expectedStateHash: string,
  actions: ActionLogEntry[],
): Promise<PeerAuditResult> {
  const issues: string[] = [];

  const decompressed = await decompressSnapshotString(compressedData);
  const parsed = JSON.parse(decompressed);
  if (!isCheckpointLike(parsed)) {
    throw new Error("Malformed snapshot checkpoint payload");
  }
  const checkpoint = parsed;

  const computedStateHash = await computeCheckpointStateHash({
    airline: checkpoint.airline,
    fleet: checkpoint.fleet,
    routes: checkpoint.routes,
    timeline: checkpoint.timeline,
  });
  const stateHashValid =
    computedStateHash === expectedStateHash && computedStateHash === checkpoint.stateHash;
  if (!stateHashValid) {
    issues.push("State hash mismatch");
  }

  let actionChainStatus: PeerAuditResult["actionChainStatus"] = "inconclusive";
  let computedActionChainHash: string | null = null;

  const sortedActions = sortActions(actions);
  if (sortedActions.length === 0) {
    issues.push("No actions available for chain verification");
  } else if (!sortedActions.some((entry) => entry.action.action === "AIRLINE_CREATE")) {
    issues.push("Action window does not include AIRLINE_CREATE; chain verification inconclusive");
  } else {
    let chainHash = "";
    for (const entry of sortedActions) {
      chainHash = await computeActionChainHash(chainHash, {
        id: entry.event.id,
        createdAt: entry.event.created_at ?? null,
        authorPubkey: pubkey,
        action: entry.action,
      });
    }
    computedActionChainHash = chainHash;
    if (chainHash === checkpoint.actionChainHash) {
      actionChainStatus = "verified";
    } else {
      actionChainStatus = "failed";
      issues.push("Action chain hash mismatch");
    }
  }

  return {
    pubkey,
    tick: checkpoint.tick,
    stateHashValid,
    actionChainStatus,
    expectedStateHash,
    computedStateHash,
    expectedActionChainHash: checkpoint.actionChainHash,
    computedActionChainHash,
    issues,
  };
}

async function runAuditCycle(trigger: AuditTrigger): Promise<void> {
  if (cycleInFlight) return;
  cycleInFlight = true;
  cycle += 1;
  const startedAt = Date.now();

  try {
    const snapshots = await loadAllSnapshots();
    const peerPubkeys = [...snapshots.keys()];
    const actions =
      peerPubkeys.length > 0
        ? await loadActionLog({
            authors: peerPubkeys,
            limit: maxActions,
            maxPages: 1,
          })
        : [];
    const groupedActions = groupActionsByPubkey(actions);

    const results: PeerAuditResult[] = [];
    for (const [pubkey, payload] of snapshots.entries()) {
      try {
        const result = await verifyPeerSnapshot(
          pubkey,
          payload.compressedData,
          payload.stateHash,
          groupedActions.get(pubkey) ?? [],
        );
        results.push(result);
      } catch (error) {
        results.push({
          pubkey,
          tick: payload.tick,
          stateHashValid: false,
          actionChainStatus: "inconclusive",
          expectedStateHash: payload.stateHash,
          computedStateHash: "",
          expectedActionChainHash: "",
          computedActionChainHash: null,
          issues: [normalizeError(error)],
        });
      }
    }

    const failedCount = results.filter(
      (result) => !result.stateHashValid || result.actionChainStatus === "failed",
    ).length;
    const inconclusiveCount = results.filter(
      (result) => result.stateHashValid && result.actionChainStatus === "inconclusive",
    ).length;
    const verifiedCount = results.filter(
      (result) => result.stateHashValid && result.actionChainStatus === "verified",
    ).length;

    const payload: AuditCyclePayload = {
      type: "audit-cycle",
      trigger,
      cycle,
      startedAt,
      finishedAt: Date.now(),
      peerCount: results.length,
      verifiedCount,
      failedCount,
      inconclusiveCount,
      results,
    };
    self.postMessage(payload);
  } catch (error) {
    const payload: AuditErrorPayload = {
      type: "audit-error",
      trigger,
      cycle,
      startedAt,
      finishedAt: Date.now(),
      error: normalizeError(error),
    };
    self.postMessage(payload);
  } finally {
    cycleInFlight = false;
  }
}
