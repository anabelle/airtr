import type { AircraftInstance, AirlineEntity, FixedPoint, TimelineEvent } from "@acars/core";
import { fpAdd } from "@acars/core";
import { getAircraftById } from "@acars/data";
import { describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";
import type { AirlineState } from "../types";
import { createFleetSlice } from "./fleetSlice";

vi.mock("@acars/nostr", () => ({
  publishAction: vi.fn(() =>
    Promise.resolve({
      id: "evt-1",
      created_at: 1,
      author: { pubkey: "test-pubkey" },
    }),
  ),
  publishUsedAircraft: vi.fn(() => Promise.resolve()),
  attachSigner: vi.fn(),
  ensureConnected: vi.fn(),
  getNDK: vi.fn(() => ({
    connect: vi.fn(),
  })),
  NDKEvent: vi.fn(() => ({
    publish: vi.fn(),
  })),
  MARKETPLACE_KIND: 30079,
}));

vi.mock("../engine", () => ({
  useEngineStore: {
    getState: () => ({
      tick: 100,
    }),
  },
}));

const createSliceState = (overrides: Partial<AirlineState>) => {
  const state = {
    airline: null,
    fleet: [],
    routes: [],
    timeline: [],
    actionChainHash: "",
    actionSeq: 0,
    fleetDeletedDuringCatchup: [],
    latestCheckpoint: null,
    pubkey: "test-pubkey",
    identityStatus: "ready",
    isLoading: false,
    error: null,
    initializeIdentity: vi.fn(),
    createAirline: vi.fn(),
    modifyHubs: vi.fn(),
    purchaseAircraft: vi.fn(),
    sellAircraft: vi.fn(),
    buyoutAircraft: vi.fn(),
    purchaseUsedAircraft: vi.fn(),
    listAircraft: vi.fn(),
    cancelListing: vi.fn(),
    performMaintenance: vi.fn(),
    ferryAircraft: vi.fn(),
    openRoute: vi.fn(),
    rebaseRoute: vi.fn(),
    closeRoute: vi.fn(),
    assignAircraftToRoute: vi.fn(),
    updateRouteFares: vi.fn(),
    updateHub: vi.fn(),
    processTick: vi.fn(),
    competitors: new Map(),
    globalRouteRegistry: new Map(),
    globalFleet: [],
    globalFleetByOwner: new Map(),
    globalRoutes: [],
    globalRoutesByOwner: new Map(),
    syncWorld: vi.fn(),
    syncCompetitor: vi.fn(),
    processGlobalTick: vi.fn(),
  } as AirlineState;

  const set = vi.fn((partial: AirlineState | ((prev: AirlineState) => Partial<AirlineState>)) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    Object.assign(state, next);
  });
  const get = () => state;

  const slice = (createFleetSlice as StateCreator<AirlineState>)(set, get, {} as never);
  Object.assign(state, slice);
  Object.assign(state, overrides);
  return { state, set };
};

const makeAirline = (
  hubs: string[],
  balance: FixedPoint = 1000000000000 as FixedPoint,
): AirlineEntity => ({
  id: "airline-1",
  foundedBy: "test-pubkey",
  status: "private",
  ceoPubkey: "test-pubkey",
  sharesOutstanding: 10000000,
  shareholders: { "test-pubkey": 10000000 },
  name: "TestAir",
  icaoCode: "TST",
  callsign: "TEST",
  hubs,
  livery: { primary: "#000000", secondary: "#ffffff", accent: "#ffffff" },
  brandScore: 0.5,
  tier: 1,
  corporateBalance: balance,
  stockPrice: 0 as FixedPoint,
  fleetIds: [],
  routeIds: [],
});

const makeAircraft = (id: string, base: string): AircraftInstance => ({
  id,
  ownerPubkey: "test-pubkey",
  modelId: "atr72-600",
  name: "Plane",
  status: "idle",
  assignedRouteId: null,
  baseAirportIata: base,
  purchasedAtTick: 0,
  purchasePrice: 1000000 as FixedPoint,
  birthTick: 0,
  flight: null,
  purchaseType: "buy",
  configuration: { economy: 70, business: 0, first: 0, cargoKg: 0 },
  flightHoursTotal: 0,
  flightHoursSinceCheck: 0,
  condition: 1,
});

describe("ferryAircraft", () => {
  it("sets aircraft enroute with ferry flight state", async () => {
    const airline = makeAirline(["BOG"]);
    const fleet = [makeAircraft("ac-1", "BOG")];

    const { state } = createSliceState({ airline, fleet, timeline: [] });

    await state.ferryAircraft("ac-1", "MDE");

    const updated = state.fleet.find((ac) => ac.id === "ac-1");
    expect(updated?.status).toBe("enroute");
    expect(updated?.flight?.purpose).toBe("ferry");
    expect(updated?.flight?.originIata).toBe("BOG");
    expect(updated?.flight?.destinationIata).toBe("MDE");
  });

  it("rejects ferry when already at destination", async () => {
    const airline = makeAirline(["BOG"]);
    const fleet = [makeAircraft("ac-1", "BOG")];

    const { state } = createSliceState({ airline, fleet, timeline: [] });

    await expect(state.ferryAircraft("ac-1", "BOG")).rejects.toThrow("already at that airport");
  });
});

describe("sellAircraft", () => {
  it("blocks scrapping when aircraft is not idle", async () => {
    const airline = makeAirline(["BOG"]);
    const fleet = [{ ...makeAircraft("ac-1", "BOG"), status: "enroute" as const }];

    const { state } = createSliceState({ airline, fleet, timeline: [] });

    await expect(state.sellAircraft("ac-1")).rejects.toThrow(
      "Aircraft can only be scrapped while idle.",
    );
  });

  it("rolls back purchase without clobbering concurrent airline updates", async () => {
    const airline = { ...makeAirline(["BOG"]), lastTick: 10 };
    const { state } = createSliceState({ airline, fleet: [], timeline: [] });
    const model = getAircraftById("atr72-600");
    expect(model).toBeTruthy();

    const { publishAction } = await import("@acars/nostr");
    vi.mocked(publishAction).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("publish failed")), 0);
        }),
    );

    const pendingPurchase = state.purchaseAircraft(model!, "BOG");
    state.airline = { ...(state.airline as AirlineEntity), lastTick: 777 };
    await pendingPurchase;

    expect(state.airline?.lastTick).toBe(777);
    expect(state.fleet).toHaveLength(0);
  });

  it("purchase rollback preserves concurrent fleet condition changes", async () => {
    const airline = makeAirline(["BOG"]);
    const existingAc = { ...makeAircraft("existing-1", "BOG"), condition: 0.8 };
    const { state } = createSliceState({
      airline,
      fleet: [existingAc],
      timeline: [],
    });
    const model = getAircraftById("atr72-600");
    expect(model).toBeTruthy();

    const { publishAction } = await import("@acars/nostr");
    vi.mocked(publishAction).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("publish failed")), 0);
        }),
    );

    const pendingPurchase = state.purchaseAircraft(model!, "BOG");

    // Simulate concurrent tick processing changing existing aircraft condition
    const currentFleet = state.fleet as AircraftInstance[];
    state.fleet = currentFleet.map((ac) =>
      ac.id === "existing-1" ? { ...ac, condition: 0.6 } : ac,
    );

    await pendingPurchase;

    // The new aircraft should be rolled back
    expect(state.fleet.find((ac) => ac.id !== "existing-1")).toBeUndefined();
    // The concurrent condition change should be preserved
    expect(state.fleet.find((ac) => ac.id === "existing-1")?.condition).toBe(0.6);
  });

  it("purchase rollback refunds balance using arithmetic, not snapshot", async () => {
    const initialBalance = 1000000000000 as FixedPoint;
    const airline = makeAirline(["BOG"], initialBalance);
    const { state } = createSliceState({ airline, fleet: [], timeline: [] });
    const model = getAircraftById("atr72-600");
    expect(model).toBeTruthy();

    const { publishAction } = await import("@acars/nostr");
    vi.mocked(publishAction).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("publish failed")), 0);
        }),
    );

    const pendingPurchase = state.purchaseAircraft(model!, "BOG");

    // Simulate concurrent balance change from tick revenue
    const concurrentRevenue = 5000000 as FixedPoint;
    state.airline = {
      ...(state.airline as AirlineEntity),
      corporateBalance: fpAdd((state.airline as AirlineEntity).corporateBalance, concurrentRevenue),
    };

    await pendingPurchase;

    // Balance should be: initial - cost + concurrent revenue + refund = initial + concurrent revenue
    expect(state.airline?.corporateBalance).toBe(fpAdd(initialBalance, concurrentRevenue));
  });

  it("purchase rollback preserves concurrently-added timeline events", async () => {
    const airline = makeAirline(["BOG"]);
    const { state } = createSliceState({ airline, fleet: [], timeline: [] });
    const model = getAircraftById("atr72-600");
    expect(model).toBeTruthy();

    const { publishAction } = await import("@acars/nostr");
    vi.mocked(publishAction).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("publish failed")), 0);
        }),
    );

    const pendingPurchase = state.purchaseAircraft(model!, "BOG");

    // Simulate a concurrent timeline event added by processTick (e.g., a landing event)
    const concurrentEvent: TimelineEvent = {
      id: "evt-concurrent-landing",
      tick: 101,
      timestamp: 0,
      type: "landing",
      description: "Concurrent landing event from tick processing",
    };
    state.timeline = [concurrentEvent, ...(state.timeline as TimelineEvent[])];

    await pendingPurchase;

    // The new aircraft should be rolled back
    expect(state.fleet).toHaveLength(0);
    // The concurrently-added timeline event should be preserved
    expect(state.timeline.some((evt) => evt.id === "evt-concurrent-landing")).toBe(true);
  });
});

describe("buyoutAircraft", () => {
  it("rollback reverts only the specific aircraft purchaseType", async () => {
    const airline = makeAirline(["BOG"]);
    const leasedAc = {
      ...makeAircraft("ac-lease", "BOG"),
      purchaseType: "lease" as const,
    };
    const otherAc = { ...makeAircraft("ac-other", "BOG"), condition: 0.9 };
    const { state } = createSliceState({
      airline: { ...airline, fleetIds: ["ac-lease", "ac-other"] },
      fleet: [leasedAc, otherAc],
      timeline: [],
    });

    const { publishAction } = await import("@acars/nostr");
    vi.mocked(publishAction).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("publish failed")), 0);
        }),
    );

    const pendingBuyout = state.buyoutAircraft("ac-lease");

    // Simulate concurrent condition change on the other aircraft
    state.fleet = (state.fleet as AircraftInstance[]).map((ac) =>
      ac.id === "ac-other" ? { ...ac, condition: 0.7 } : ac,
    );

    await pendingBuyout;

    // Buyout should be reverted
    expect(state.fleet.find((ac) => ac.id === "ac-lease")?.purchaseType).toBe("lease");
    // Concurrent change preserved
    expect(state.fleet.find((ac) => ac.id === "ac-other")?.condition).toBe(0.7);
  });
});

describe("performMaintenance", () => {
  it("rollback restores only the maintained aircraft fields", async () => {
    const airline = makeAirline(["BOG"]);
    const wornAc = {
      ...makeAircraft("ac-worn", "BOG"),
      condition: 0.5,
      flightHoursSinceCheck: 100,
    };
    const otherAc = { ...makeAircraft("ac-other", "BOG"), condition: 0.8 };
    const { state } = createSliceState({
      airline,
      fleet: [wornAc, otherAc],
      timeline: [],
    });

    const { publishAction } = await import("@acars/nostr");
    vi.mocked(publishAction).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("publish failed")), 0);
        }),
    );

    const pendingMaint = state.performMaintenance("ac-worn");

    // Simulate concurrent condition degradation on the other aircraft
    state.fleet = (state.fleet as AircraftInstance[]).map((ac) =>
      ac.id === "ac-other" ? { ...ac, condition: 0.6 } : ac,
    );

    await pendingMaint;

    // Maintenance should be reverted: original condition/hours restored
    const rolledBack = state.fleet.find((ac) => ac.id === "ac-worn");
    expect(rolledBack?.condition).toBe(0.5);
    expect(rolledBack?.flightHoursSinceCheck).toBe(100);
    expect(rolledBack?.status).toBe("idle");

    // Concurrent change on other aircraft preserved
    expect(state.fleet.find((ac) => ac.id === "ac-other")?.condition).toBe(0.6);
  });

  it("rollback removes only the optimistic maintenance timeline event", async () => {
    const airline = makeAirline(["BOG"]);
    const wornAc = { ...makeAircraft("ac-worn", "BOG"), condition: 0.5 };
    const existingEvent = {
      id: "evt-existing",
      tick: 50,
      timestamp: 0,
      type: "purchase" as const,
      description: "Existing event",
    };
    const { state } = createSliceState({
      airline,
      fleet: [wornAc],
      timeline: [existingEvent],
    });

    const { publishAction } = await import("@acars/nostr");
    vi.mocked(publishAction).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("publish failed")), 0);
        }),
    );

    await state.performMaintenance("ac-worn");

    // Existing timeline event should be preserved
    expect(state.timeline.some((evt) => evt.id === "evt-existing")).toBe(true);
    // Maintenance event should be removed
    expect(state.timeline.some((evt) => evt.id === "evt-maint-ac-worn-100")).toBe(false);
  });
});
