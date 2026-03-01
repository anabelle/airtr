import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./engine.js", () => {
  return {
    useEngineStore: {
      subscribe: vi.fn(),
      getState: vi.fn(() => ({
        tick: 0,
      })),
    },
  };
});

describe("airline store", () => {
  it("creates a zustand store with slices", async () => {
    const { useAirlineStore } = await import("./airline.js");
    const state = useAirlineStore.getState();
    expect(state).toBeDefined();
    expect(typeof state.initializeIdentity).toBe("function");
    expect(typeof state.processTick).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Buffering tests – require fresh module state per test so we can control
// the timing of the initial sync and observe the buffer population/replay.
// ---------------------------------------------------------------------------
describe("airline store – event buffering during initial sync", () => {
  // Captured handles set during beforeEach, available in each test.
  let capturedOnEvent:
    | ((entry: { event: { author: { pubkey: string } }; action: { action: string } }) => void)
    | null;
  let resolveSyncWorld: (() => void) | null;
  let syncCompetitorSpy: ReturnType<typeof vi.fn>;
  // Lets each test control which competitors are "known" after the sync.
  let syncWorldCompetitors: Map<string, unknown>;

  beforeEach(async () => {
    vi.resetModules();
    capturedOnEvent = null;
    resolveSyncWorld = null;
    syncCompetitorSpy = vi.fn().mockResolvedValue(undefined);
    syncWorldCompetitors = new Map(); // overridden per test as needed

    // Deferred promise: keeps initialSyncComplete false until resolveSyncWorld() is called.
    const syncWorldDeferred = new Promise<void>((resolve) => {
      resolveSyncWorld = resolve;
    });

    vi.doMock("./engine.js", () => ({
      useEngineStore: {
        subscribe: vi.fn(),
        getState: vi.fn(() => ({ tick: 0 })),
        setState: vi.fn(),
      },
    }));

    vi.doMock("@acars/nostr", () => ({
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      connectedRelayCount: vi.fn().mockReturnValue(1),
      reconnectIfNeeded: vi.fn().mockResolvedValue(false),
      subscribeActions: vi.fn(
        async ({
          onEvent,
        }: {
          onEvent: (e: {
            event: { author: { pubkey: string } };
            action: { action: string };
          }) => void;
          onClose: () => void;
          since: number;
        }) => {
          capturedOnEvent = onEvent;
          return () => {};
        },
      ),
    }));

    // Mock worldSlice so syncWorld suspends until resolveSyncWorld() is called,
    // then sets the competitors map to syncWorldCompetitors.  This gives tests
    // a clean window to push events into the buffer before sync finishes.
    vi.doMock("./slices/worldSlice.js", () => ({
      _resetWorldFlags: vi.fn(),
      createWorldSlice: (set: (partial: Record<string, unknown>) => void) => ({
        competitors: new Map<string, unknown>(),
        globalRouteRegistry: new Map<string, unknown[]>(),
        fleetByOwner: new Map<string, unknown[]>(),
        routesByOwner: new Map<string, unknown[]>(),
        viewAs: vi.fn(),
        syncWorld: vi.fn(async () => {
          await syncWorldDeferred;
          set({ competitors: syncWorldCompetitors });
        }),
        syncCompetitor: syncCompetitorSpy,
        projectCompetitorFleet: vi.fn(),
      }),
    }));

    // Import the module — this triggers the IIFE which will:
    // 1. ensureConnected() → resolves immediately
    // 2. startActionSubscription() → sets capturedOnEvent, returns
    // 3. syncWorld() → suspends on syncWorldDeferred
    await import("./airline.js");

    // The IIFE reaches the syncWorld await asynchronously.  Poll until the
    // subscription callback is registered (capturedOnEvent is set).
    await vi.waitFor(() => expect(capturedOnEvent).not.toBeNull(), {
      timeout: 2000,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("buffers competitor events that arrive before initial sync completes", async () => {
    const { _getEventBuffer } = await import("./airline.js");

    capturedOnEvent!({
      event: { author: { pubkey: "competitor-aaa" } },
      action: { action: "purchase_aircraft" },
    });

    expect(_getEventBuffer()).toContain("competitor-aaa");
  });

  it("does not buffer own events (own pubkey is skipped before buffer check)", async () => {
    const { useAirlineStore: store, _getEventBuffer } = await import("./airline.js");

    store.setState({ pubkey: "own-pubkey-111" });

    capturedOnEvent!({
      event: { author: { pubkey: "own-pubkey-111" } },
      action: { action: "purchase_aircraft" },
    });

    expect(_getEventBuffer()).not.toContain("own-pubkey-111");
  });

  it("clears the buffer after initial sync completes", async () => {
    const { _getEventBuffer } = await import("./airline.js");

    capturedOnEvent!({
      event: { author: { pubkey: "competitor-bbb" } },
      action: { action: "open_route" },
    });
    expect(_getEventBuffer().length).toBeGreaterThan(0);

    // Ensure syncWorld returns at least one competitor so the retry loop exits.
    syncWorldCompetitors = new Map([["any-synced-comp", {}]]);

    // Unblock syncWorld → initialSyncComplete becomes true → buffer is flushed.
    resolveSyncWorld!();

    // Flush microtasks until the IIFE completes its async chain.
    await vi.waitFor(() => expect(_getEventBuffer()).toHaveLength(0), {
      timeout: 3000,
    });
  });

  it("deduplicates buffer entries and skips competitors already captured by syncWorld", async () => {
    const { _getEventBuffer } = await import("./airline.js");

    // Simulate a burst of events from the same pubkey before sync finishes.
    for (let i = 0; i < 5; i++) {
      capturedOnEvent!({
        event: { author: { pubkey: "competitor-ccc" } },
        action: { action: "purchase_aircraft" },
      });
    }
    // A second, distinct competitor that syncWorld will NOT have captured.
    capturedOnEvent!({
      event: { author: { pubkey: "competitor-ddd" } },
      action: { action: "open_route" },
    });

    // Mark competitor-ccc as already known (captured by syncWorld).
    syncWorldCompetitors = new Map([["competitor-ccc", {}]]);

    // Install fake timers BEFORE unblocking syncWorld so that the
    // setTimeout inside queueCompetitorSync (called by flushEventBuffer)
    // is captured by the fake timer infrastructure.
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      // Unblock syncWorld.
      resolveSyncWorld!();

      // Wait for the buffer to be cleared.
      await vi.waitFor(() => expect(_getEventBuffer()).toHaveLength(0), {
        timeout: 3000,
      });

      // Advance past LIVE_SYNC_BATCH_MS (1 000 ms) so that
      // flushPendingCompetitorSyncs fires and calls syncCompetitor.
      await vi.advanceTimersByTimeAsync(1100);
    } finally {
      vi.useRealTimers();
    }

    const syncedPubkeys = syncCompetitorSpy.mock.calls.map((c) => c[0] as string);

    // competitor-ccc was already captured by syncWorld → must NOT be re-synced.
    expect(syncedPubkeys).not.toContain("competitor-ccc");

    // competitor-ddd is genuinely new → must be synced exactly once.
    expect(syncedPubkeys.filter((pk) => pk === "competitor-ddd")).toHaveLength(1);
  });
});
