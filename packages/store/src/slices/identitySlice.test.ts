import type { AirlineEntity, FixedPoint } from "@acars/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";
import type { AirlineState } from "../types";
import { createIdentitySlice } from "./identitySlice";

const replayActionLog = vi.fn();
const loadActionLog = vi.fn();
const loadCheckpoint = vi.fn();

vi.mock("@acars/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@acars/core")>();
  return {
    ...actual,
    // Always return true so tests don't need real state hashes
    verifyCheckpoint: vi.fn(() => Promise.resolve(true)),
  };
});

vi.mock("@acars/nostr", () => ({
  attachSigner: vi.fn(),
  ensureConnected: vi.fn(),
  getPubkey: vi.fn(() => Promise.resolve("pubkey-1")),
  loadActionLog: (...args: unknown[]) => loadActionLog(...args),
  loadCheckpoint: (...args: unknown[]) => loadCheckpoint(...args),
  publishAction: vi.fn(),
  waitForNip07: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../actionReducer", () => ({
  replayActionLog: (...args: unknown[]) => replayActionLog(...args),
}));

vi.mock("../engine", () => ({
  useEngineStore: {
    getState: vi.fn(() => ({
      tick: 100000,
    })),
  },
}));

const createSliceState = (overrides: Partial<AirlineState> = {}) => {
  const state = {
    pubkey: null,
    identityStatus: "checking",
    isLoading: false,
    error: null,
    airline: null,
    fleet: [],
    routes: [],
    timeline: [],
    actionChainHash: "",
    actionSeq: 0,
    latestCheckpoint: null,
    initializeIdentity: vi.fn(),
    createAirline: vi.fn(),
  } as AirlineState;

  const set = vi.fn((partial: AirlineState | ((prev: AirlineState) => Partial<AirlineState>)) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    Object.assign(state, next);
  });
  const get = () => state;

  const slice = (createIdentitySlice as StateCreator<AirlineState>)(set, get, {} as never);
  Object.assign(state, slice);
  Object.assign(state, overrides);
  return { state, set };
};

const makeAirline = (lastTick: number): AirlineEntity => ({
  id: "airline-1",
  foundedBy: "pubkey-1",
  status: "private",
  ceoPubkey: "pubkey-1",
  sharesOutstanding: 10000000,
  shareholders: { "pubkey-1": 10000000 },
  name: "Test Air",
  icaoCode: "TST",
  callsign: "TEST",
  hubs: ["JFK"],
  livery: { primary: "#000000", secondary: "#ffffff", accent: "#ffffff" },
  brandScore: 0.5,
  tier: 1,
  corporateBalance: 1000000000 as FixedPoint,
  stockPrice: 0 as FixedPoint,
  fleetIds: [],
  routeIds: [],
  lastTick,
  timeline: [],
});

beforeEach(() => {
  replayActionLog.mockReset();
  loadActionLog.mockReset();
  loadCheckpoint.mockReset();
  loadActionLog.mockResolvedValue([]);
  loadCheckpoint.mockResolvedValue(null);
});

describe("identitySlice initializeIdentity", () => {
  it("clamps stale lastTick to catchup window", async () => {
    loadActionLog.mockResolvedValueOnce([]);
    loadCheckpoint.mockResolvedValueOnce(null);
    replayActionLog.mockResolvedValueOnce({
      airline: makeAirline(1000),
      fleet: [],
      routes: [],
      actionChainHash: "hash",
    });

    const { state } = createSliceState();

    await state.initializeIdentity();

    expect(state.airline?.lastTick).toBe(50000);
  });

  it("filters action log entries using tick-based scoping (not wall-clock)", async () => {
    loadCheckpoint.mockResolvedValueOnce({
      schemaVersion: 1,
      tick: 10,
      createdAt: 2000,
      actionChainHash: "hash",
      stateHash: "state",
      airline: makeAirline(10),
      fleet: [],
      routes: [],
      timeline: [],
    });
    loadActionLog.mockResolvedValueOnce([
      {
        event: {
          id: "event-at-checkpoint-tick",
          created_at: 3, // wall-clock AFTER checkpoint, but tick == checkpoint
          author: { pubkey: "pubkey-1" },
        },
        action: { action: "TICK_UPDATE", payload: { tick: 10 } },
      },
      {
        event: {
          id: "event-after-checkpoint-tick",
          created_at: 2, // wall-clock AT checkpoint, but tick > checkpoint
          author: { pubkey: "pubkey-1" },
        },
        action: { action: "PURCHASE_AIRCRAFT", payload: { tick: 11 } },
      },
    ]);
    replayActionLog.mockResolvedValueOnce({
      airline: makeAirline(10),
      fleet: [],
      routes: [],
      actionChainHash: "hash",
    });

    const { state } = createSliceState();

    await state.initializeIdentity();

    // tick:10 should be excluded (== checkpoint tick, not >)
    // tick:11 should be included even though wall-clock (2) == checkpoint wall-clock (2)
    expect(replayActionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            eventId: "event-after-checkpoint-tick",
          }),
        ],
      }),
    );
  });

  it("falls back to wall-clock filtering for actions without tick field", async () => {
    loadCheckpoint.mockResolvedValueOnce({
      schemaVersion: 1,
      tick: 10,
      createdAt: 2000,
      actionChainHash: "hash",
      stateHash: "state",
      airline: makeAirline(10),
      fleet: [],
      routes: [],
      timeline: [],
    });
    loadActionLog.mockResolvedValueOnce([
      {
        event: {
          id: "event-no-tick-old",
          created_at: 1, // before checkpoint (createdAt 2000 => 2 seconds)
          author: { pubkey: "pubkey-1" },
        },
        action: { action: "LEGACY_ACTION", payload: {} },
      },
      {
        event: {
          id: "event-no-tick-new",
          created_at: 3, // after checkpoint
          author: { pubkey: "pubkey-1" },
        },
        action: { action: "LEGACY_ACTION", payload: {} },
      },
    ]);
    replayActionLog.mockResolvedValueOnce({
      airline: makeAirline(10),
      fleet: [],
      routes: [],
      actionChainHash: "hash",
    });

    const { state } = createSliceState();

    await state.initializeIdentity();

    expect(replayActionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            eventId: "event-no-tick-new",
          }),
        ],
      }),
    );
  });
});
