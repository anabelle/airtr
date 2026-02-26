import { describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";
import type { AirlineEntity, FixedPoint } from "@airtr/core";
import type { AirlineState } from "../types";
import { createIdentitySlice } from "./identitySlice";

const replayActionLog = vi.fn();

vi.mock("@airtr/nostr", () => ({
  attachSigner: vi.fn(),
  ensureConnected: vi.fn(),
  getPubkey: vi.fn(() => Promise.resolve("pubkey-1")),
  loadActionLog: vi.fn(() => Promise.resolve([])),
  loadCheckpoint: vi.fn(() => Promise.resolve(null)),
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

describe("identitySlice initializeIdentity", () => {
  it("clamps stale lastTick to catchup window", async () => {
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
});
