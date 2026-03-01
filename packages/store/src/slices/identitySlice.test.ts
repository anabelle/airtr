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

  it("filters action log entries after checkpoint timestamp", async () => {
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
          id: "event-old",
          created_at: 1,
          author: { pubkey: "pubkey-1" },
        },
        action: { action: "TICK_UPDATE", payload: { tick: 10 } },
      },
      {
        event: {
          id: "event-new",
          created_at: 3,
          author: { pubkey: "pubkey-1" },
        },
        action: { action: "TICK_UPDATE", payload: { tick: 11 } },
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
            eventId: "event-new",
          }),
        ],
      }),
    );
  });
});
