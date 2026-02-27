#!/usr/bin/env node
/**
 * backfill-relay.ts
 *
 * Fetches all airtr-tagged Nostr events from public source relays and
 * re-broadcasts them (with original signatures intact) to a target relay.
 *
 * Usage:
 *   node --experimental-strip-types scripts/backfill-relay.ts [options]
 *
 * Options:
 *   --target <url>      Target relay URL (default: wss://nostr.acars.pub)
 *   --source <url>      Add a source relay (can be repeated; defaults to public relay list)
 *   --dry-run           Fetch and count events without publishing to target
 *   --author <hex>       Filter by author pubkey (can be repeated for multiple authors)
 *   --kinds <n,n,...>    Comma-separated event kinds to fetch (default: 30078,30079)
 *   --limit <n>         Events per page (default: 500)
 *   --max-pages <n>     Maximum pages to fetch per source relay (default: 50)
 *
 * This script requires no private keys — it re-broadcasts already-signed events.
 * Safe to run multiple times (idempotent via NIP-33 addressable events).
 */

// ── Constants (duplicated from @acars/nostr to keep script standalone) ──────

const WORLD_ID = "dev-v3";
const ACTION_D_PREFIX = `airtr:world:${WORLD_ID}:action:`;
const CHECKPOINT_D_TAG = `airtr:world:${WORLD_ID}:checkpoint`;
const MARKETPLACE_D_PREFIX = `airtr:world:${WORLD_ID}:marketplace:`;

const DEFAULT_SOURCE_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://offchain.pub",
  "wss://relay.nostr.net",
  "wss://relay.nos.social",
  "wss://nostr.land",
];

const DEFAULT_TARGET_RELAY = "wss://nostr.acars.pub";

// ── Types ───────────────────────────────────────────────────────────────────

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// ── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const sources: string[] = [];
  const authors: string[] = [];
  let target = DEFAULT_TARGET_RELAY;
  let dryRun = false;
  let kinds = [30078, 30079];
  let limit = 500;
  let maxPages = 50;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--target":
        target = args[++i];
        break;
      case "--source":
        sources.push(args[++i]);
        break;
      case "--author":
        authors.push(args[++i]);
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--kinds":
        kinds = args[++i].split(",").map(Number);
        break;
      case "--limit":
        limit = Number(args[++i]);
        break;
      case "--max-pages":
        maxPages = Number(args[++i]);
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  return {
    sources: sources.length > 0 ? sources : DEFAULT_SOURCE_RELAYS,
    authors,
    target,
    dryRun,
    kinds,
    limit,
    maxPages,
  };
}

// ── WebSocket Helpers ───────────────────────────────────────────────────────

function connectRelay(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Connection to ${url} timed out after 10s`));
    }, 10_000);

    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.addEventListener("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to connect to ${url}: ${err}`));
    });
  });
}

/**
 * Fetches events from a single relay using REQ with pagination via `until`.
 */
function fetchEvents(
  ws: WebSocket,
  filter: Record<string, unknown>,
  pageLimit: number,
  maxPages: number,
): Promise<Map<string, NostrEvent>> {
  const events = new Map<string, NostrEvent>();
  let page = 0;
  let until: number | undefined;

  function fetchPage(): Promise<NostrEvent[]> {
    return new Promise((resolve) => {
      const subId = `backfill-${Date.now()}-${page}`;
      const pageEvents: NostrEvent[] = [];
      const currentFilter = {
        ...filter,
        limit: pageLimit,
        ...(until !== undefined ? { until } : {}),
      };

      const timeout = setTimeout(() => {
        // Send CLOSE to be polite
        ws.send(JSON.stringify(["CLOSE", subId]));
        resolve(pageEvents);
      }, 15_000);

      const handler = (msg: MessageEvent) => {
        let data: unknown[];
        try {
          data = JSON.parse(String(msg.data));
        } catch {
          return;
        }

        if (!Array.isArray(data)) return;
        if (data[1] !== subId) return;

        if (data[0] === "EVENT" && data[2]) {
          pageEvents.push(data[2] as NostrEvent);
        } else if (data[0] === "EOSE") {
          clearTimeout(timeout);
          ws.removeEventListener("message", handler);
          ws.send(JSON.stringify(["CLOSE", subId]));
          resolve(pageEvents);
        } else if (data[0] === "CLOSED") {
          clearTimeout(timeout);
          ws.removeEventListener("message", handler);
          resolve(pageEvents);
        }
      };

      ws.addEventListener("message", handler);
      ws.send(JSON.stringify(["REQ", subId, currentFilter]));
    });
  }

  return (async () => {
    while (page < maxPages) {
      const pageEvents = await fetchPage();

      for (const ev of pageEvents) {
        if (!events.has(ev.id)) {
          events.set(ev.id, ev);
        }
      }

      // If we got fewer than the limit, we've exhausted this relay
      if (pageEvents.length < pageLimit) break;

      // Advance cursor to before the oldest event in this page
      const oldest = pageEvents.reduce(
        (min, ev) => (ev.created_at < min ? ev.created_at : min),
        pageEvents[0].created_at,
      );

      if (oldest <= 0) break;
      until = oldest - 1;
      page++;
    }

    return events;
  })();
}

/**
 * Publishes a pre-signed event to a relay. Returns true if accepted (OK true).
 */
function publishEvent(ws: WebSocket, event: NostrEvent): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener("message", handler);
      resolve({ ok: false, message: "timeout" });
    }, 10_000);

    const handler = (msg: MessageEvent) => {
      let data: unknown[];
      try {
        data = JSON.parse(String(msg.data));
      } catch {
        return;
      }

      if (!Array.isArray(data)) return;
      if (data[0] !== "OK" || data[1] !== event.id) return;

      clearTimeout(timeout);
      ws.removeEventListener("message", handler);
      resolve({
        ok: Boolean(data[2]),
        message: String(data[3] ?? ""),
      });
    };

    ws.addEventListener("message", handler);
    ws.send(JSON.stringify(["EVENT", event]));
  });
}

// ── Validation ──────────────────────────────────────────────────────────────

function isAirtrEvent(event: NostrEvent): boolean {
  const hasWorldTag = event.tags.some((t) => t[0] === "world" && t[1] === WORLD_ID);
  if (!hasWorldTag) return false;

  const dTag = event.tags.find((t) => t[0] === "d")?.[1];
  if (!dTag) return false;

  return (
    dTag.startsWith(ACTION_D_PREFIX) ||
    dTag === CHECKPOINT_D_TAG ||
    dTag.startsWith(MARKETPLACE_D_PREFIX)
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs(process.argv);

  console.log("=== ACARS Relay Backfill ===");
  console.log(`Target relay:  ${config.target}`);
  console.log(`Source relays: ${config.sources.length}`);
  console.log(
    `Authors:       ${config.authors.length > 0 ? config.authors.map((a) => a.slice(0, 12) + "...").join(", ") : "(all)"}`,
  );
  console.log(`Event kinds:   ${config.kinds.join(", ")}`);
  console.log(`Page limit:    ${config.limit}`);
  console.log(`Max pages:     ${config.maxPages}`);
  console.log(`Dry run:       ${config.dryRun}`);
  console.log();

  // ── Phase 1: Fetch from all source relays ──────────────────────────────
  //
  // Many public relays don't support filtering by arbitrary custom tags
  // (like #world). We use two strategies:
  //   1. Filter by kinds only (broadly supported), then validate client-side
  //   2. Also try #d prefix filtering where supported (NIP-33 standard)
  //
  // The client-side isAirtrEvent() check ensures only our events get through.

  const allEvents = new Map<string, NostrEvent>();

  for (const relayUrl of config.sources) {
    process.stdout.write(`Fetching from ${relayUrl}...`);
    let ws: WebSocket;
    try {
      ws = await connectRelay(relayUrl);
    } catch (err) {
      console.log(` FAILED (${(err as Error).message})`);
      continue;
    }

    try {
      // Fetch by kind and validate airtr tags client-side.
      // We can't rely on #world tag filtering being supported.
      const filter: Record<string, unknown> = {
        kinds: config.kinds,
        ...(config.authors.length > 0 ? { authors: config.authors } : {}),
      };

      const relayEvents = await fetchEvents(ws, filter, config.limit, config.maxPages);
      let newCount = 0;
      for (const [id, ev] of relayEvents) {
        if (!allEvents.has(id) && isAirtrEvent(ev)) {
          allEvents.set(id, ev);
          newCount++;
        }
      }
      console.log(` ${relayEvents.size} raw events, ${newCount} new airtr events`);
    } finally {
      ws.close();
    }
  }

  console.log();
  console.log(`Total unique events collected: ${allEvents.size}`);

  if (allEvents.size === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  // ── Breakdown by type ──────────────────────────────────────────────────

  let actions = 0;
  let checkpoints = 0;
  let marketplace = 0;
  const authors = new Set<string>();

  for (const ev of allEvents.values()) {
    authors.add(ev.pubkey);
    const dTag = ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
    if (dTag === CHECKPOINT_D_TAG) checkpoints++;
    else if (dTag.startsWith(MARKETPLACE_D_PREFIX)) marketplace++;
    else if (dTag.startsWith(ACTION_D_PREFIX)) actions++;
  }

  console.log(`  Actions:      ${actions}`);
  console.log(`  Checkpoints:  ${checkpoints}`);
  console.log(`  Marketplace:  ${marketplace}`);
  console.log(`  Authors:      ${authors.size}`);
  console.log();

  if (config.dryRun) {
    console.log("Dry run — skipping publish. Re-run without --dry-run to backfill.");
    return;
  }

  // ── Phase 2: Publish to target relay ───────────────────────────────────

  process.stdout.write(`Connecting to target ${config.target}...`);
  let targetWs: WebSocket;
  try {
    targetWs = await connectRelay(config.target);
    console.log(" connected");
  } catch (err) {
    console.log(` FAILED (${(err as Error).message})`);
    process.exit(1);
  }

  // Sort events chronologically for orderly insertion
  const sorted = Array.from(allEvents.values()).sort((a, b) => a.created_at - b.created_at);

  let accepted = 0;
  let rejected = 0;
  let duplicate = 0;
  let timedOut = 0;

  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];
    const result = await publishEvent(targetWs, ev);

    if (result.ok) {
      accepted++;
    } else if (result.message === "timeout") {
      timedOut++;
    } else if (
      result.message.includes("duplicate") ||
      result.message.includes("already have") ||
      result.message.includes("replaced")
    ) {
      duplicate++;
    } else {
      rejected++;
      if (rejected <= 10) {
        console.log(`  Rejected: ${ev.id.slice(0, 12)}... — ${result.message}`);
      }
    }

    // Progress every 100 events
    if ((i + 1) % 100 === 0 || i === sorted.length - 1) {
      process.stdout.write(
        `\r  Progress: ${i + 1}/${sorted.length} | accepted: ${accepted} | dup: ${duplicate} | rejected: ${rejected} | timeout: ${timedOut}`,
      );
    }
  }

  console.log(); // newline after progress
  targetWs.close();

  // ── Summary ────────────────────────────────────────────────────────────

  console.log();
  console.log("=== Backfill Complete ===");
  console.log(`  Total sent:  ${sorted.length}`);
  console.log(`  Accepted:    ${accepted}`);
  console.log(`  Duplicate:   ${duplicate}`);
  console.log(`  Rejected:    ${rejected}`);
  console.log(`  Timed out:   ${timedOut}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
