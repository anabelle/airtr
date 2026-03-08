import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateCreator } from "zustand";
import type { AirlineState } from "../types";
import { createIdentitySlice } from "./identitySlice";
import { hydrateIdentityFromStorage } from "../localLoader";

vi.mock("../localLoader", () => ({
  hydrateIdentityFromStorage: vi.fn(),
}));

const loginWithNsecMock = vi.fn();
const attachSignerMock = vi.fn();
const clearEphemeralKeyMock = vi.fn();
const ensureConnectedMock = vi.fn();
const generateNewKeypairMock = vi.fn(() => ({
  nsec: "nsec1generated",
  pubkey: "generated-pubkey",
}));
const getPubkeyMock = vi.fn(() => Promise.resolve("pubkey-1"));
const loadEphemeralKeyMock = vi.fn(() => null);
const resetSignerMock = vi.fn();
const saveEphemeralKeyMock = vi.fn();
const waitForNip07Mock = vi.fn(() => Promise.resolve(true));

vi.mock("@acars/nostr", () => ({
  attachSigner: (...args: unknown[]) => attachSignerMock(...args),
  clearEphemeralKey: (...args: unknown[]) => clearEphemeralKeyMock(...args),
  ensureConnected: (...args: unknown[]) => ensureConnectedMock(...args),
  generateNewKeypair: (...args: unknown[]) => generateNewKeypairMock(...args),
  getPubkey: (...args: unknown[]) => getPubkeyMock(...args),
  loadEphemeralKey: (...args: unknown[]) => loadEphemeralKeyMock(...args),
  loginWithNsec: (...args: unknown[]) => loginWithNsecMock(...args),
  publishAction: vi.fn(),
  resetSigner: (...args: unknown[]) => resetSignerMock(...args),
  saveEphemeralKey: (...args: unknown[]) => saveEphemeralKeyMock(...args),
  waitForNip07: (...args: unknown[]) => waitForNip07Mock(...args),
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
    isEphemeral: false,
    isLoading: false,
    error: null,
    airline: null,
    fleet: [],
    routes: [],
    timeline: [],
    actionChainHash: "",
    actionSeq: 0,
    latestCheckpoint: null,
    fleetDeletedDuringCatchup: [],
    initializeIdentity: vi.fn(),
    createAirline: vi.fn(),
    createNewIdentity: vi.fn(),
    loginWithNsec: vi.fn(),
  } as unknown as AirlineState;

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

beforeEach(() => {
  vi.mocked(hydrateIdentityFromStorage).mockReset();
  attachSignerMock.mockReset();
  clearEphemeralKeyMock.mockReset();
  ensureConnectedMock.mockReset();
  generateNewKeypairMock.mockClear();
  generateNewKeypairMock.mockReturnValue({
    nsec: "nsec1generated",
    pubkey: "generated-pubkey",
  });
  getPubkeyMock.mockReset();
  getPubkeyMock.mockResolvedValue("pubkey-1");
  loadEphemeralKeyMock.mockReset();
  loadEphemeralKeyMock.mockResolvedValue(null);
  loginWithNsecMock.mockReset();
  ensureConnectedMock.mockResolvedValue(undefined);
  resetSignerMock.mockReset();
  saveEphemeralKeyMock.mockReset();
  waitForNip07Mock.mockReset();
  waitForNip07Mock.mockResolvedValue(true);
});

describe("identitySlice initializeIdentity", () => {
  it("initializes identity and calls hydrateIdentityFromStorage", async () => {
    const { state } = createSliceState();

    await state.initializeIdentity();

    // It should have resolved the pubkey-1 from the nostr mock
    expect(hydrateIdentityFromStorage).toHaveBeenCalledWith("pubkey-1", expect.any(Function));
    // The state isn't explicitly changed to ready here because hydrateIdentityFromStorage handles the set() calls now
  });

  it("forces NIP-07 signer refresh and clears ephemeral state on successful extension auth", async () => {
    const { state } = createSliceState({ identityStatus: "ready", isEphemeral: true });

    await state.initializeIdentity();

    expect(attachSignerMock).toHaveBeenCalledWith(true);
    expect(clearEphemeralKeyMock).toHaveBeenCalled();
    expect(state.isEphemeral).toBe(false);
    expect(hydrateIdentityFromStorage).toHaveBeenCalledWith("pubkey-1", expect.any(Function));
  });

  it("sets guest status if extension returns no pubkey", async () => {
    getPubkeyMock.mockResolvedValueOnce(null);

    const { state } = createSliceState();

    await state.initializeIdentity();

    expect(state.identityStatus).toBe("guest");
    expect(hydrateIdentityFromStorage).not.toHaveBeenCalled();
  });

  it("preserves a ready ephemeral session when extension upgrade is cancelled", async () => {
    getPubkeyMock.mockResolvedValueOnce(null);

    const { state } = createSliceState({
      identityStatus: "ready",
      isEphemeral: true,
      pubkey: "ephemeral-pubkey",
      airline: { id: "airline-1" } as AirlineState["airline"],
    });

    await state.initializeIdentity();

    expect(state.identityStatus).toBe("ready");
    expect(state.isEphemeral).toBe(true);
    expect(state.error).toBe("Extension did not return a pubkey — check nos2x popup");
  });

  it("restores a saved ephemeral key when no extension is available", async () => {
    waitForNip07Mock.mockResolvedValueOnce(false);
    loadEphemeralKeyMock.mockResolvedValueOnce("nsec1saved");
    loginWithNsecMock.mockResolvedValueOnce("pubkey-ephemeral");

    const { state } = createSliceState();

    await state.initializeIdentity();

    expect(loginWithNsecMock).toHaveBeenCalledWith("nsec1saved");
    expect(state.isEphemeral).toBe(true);
    expect(clearEphemeralKeyMock).not.toHaveBeenCalled();
    expect(hydrateIdentityFromStorage).toHaveBeenCalledWith(
      "pubkey-ephemeral",
      expect.any(Function),
    );
  });

  it("clears corrupt saved ephemeral keys and falls back to no-extension", async () => {
    waitForNip07Mock.mockResolvedValueOnce(false);
    loadEphemeralKeyMock.mockResolvedValueOnce("nsec1corrupt");
    loginWithNsecMock.mockRejectedValueOnce(new Error("invalid key"));

    const { state } = createSliceState();

    await state.initializeIdentity();

    expect(clearEphemeralKeyMock).toHaveBeenCalled();
    expect(state.identityStatus).toBe("no-extension");
  });

  it("resets the signer but preserves a saved key when restore fails after login succeeds", async () => {
    waitForNip07Mock.mockResolvedValueOnce(false);
    loadEphemeralKeyMock.mockResolvedValueOnce("nsec1saved");
    loginWithNsecMock.mockResolvedValueOnce("pubkey-ephemeral");
    vi.mocked(hydrateIdentityFromStorage).mockRejectedValueOnce(new Error("hydrate failed"));

    const { state } = createSliceState();

    await state.initializeIdentity();

    expect(resetSignerMock).toHaveBeenCalled();
    expect(clearEphemeralKeyMock).not.toHaveBeenCalled();
    expect(state.identityStatus).toBe("no-extension");
    expect(state.error).toBe("Saved browser account could not be restored right now.");
  });

  it("preserves a ready session when the browser wallet extension is unavailable", async () => {
    waitForNip07Mock.mockResolvedValueOnce(false);

    const { state } = createSliceState({
      identityStatus: "ready",
      isEphemeral: true,
      pubkey: "ephemeral-pubkey",
      airline: { id: "airline-1" } as AirlineState["airline"],
    });

    await state.initializeIdentity();

    expect(state.identityStatus).toBe("ready");
    expect(state.isEphemeral).toBe(true);
    expect(state.error).toBe("Browser wallet extension is unavailable.");
  });
});

describe("identitySlice loginWithNsec", () => {
  it("hydrates identity after successful nsec login", async () => {
    loginWithNsecMock.mockResolvedValueOnce("pubkey-2");

    const { state } = createSliceState({
      pubkey: "old-pubkey",
      identityStatus: "ready",
      isEphemeral: true,
    });

    await state.loginWithNsec("nsec1valid");

    expect(loginWithNsecMock).toHaveBeenCalledWith("nsec1valid");
    expect(clearEphemeralKeyMock).toHaveBeenCalled();
    expect(state.isEphemeral).toBe(false);
    expect(hydrateIdentityFromStorage).toHaveBeenCalledWith("pubkey-2", expect.any(Function));
  });

  it("exposes a fixed user-facing error when nsec login fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    loginWithNsecMock.mockRejectedValueOnce(new Error("library details"));
    const { state } = createSliceState({ identityStatus: "ready" });

    await state.loginWithNsec("bad-key");

    expect(state.error).toBe("Invalid nsec key.");
    expect(state.identityStatus).toBe("ready");
    expect(state.isLoading).toBe(false);
    warnSpy.mockRestore();
  });
});

describe("identitySlice createNewIdentity", () => {
  it("generates, saves, and hydrates a new ephemeral identity", async () => {
    loginWithNsecMock.mockResolvedValueOnce("pubkey-new");

    const { state } = createSliceState();

    await state.createNewIdentity();

    expect(generateNewKeypairMock).toHaveBeenCalled();
    expect(saveEphemeralKeyMock).toHaveBeenCalledWith("nsec1generated");
    expect(loginWithNsecMock).toHaveBeenCalledWith("nsec1generated");
    expect(state.isEphemeral).toBe(true);
    expect(hydrateIdentityFromStorage).toHaveBeenCalledWith("pubkey-new", expect.any(Function));
  });

  it("keeps a valid new key and resets the signer when post-login setup fails", async () => {
    loginWithNsecMock.mockResolvedValueOnce("pubkey-new");
    ensureConnectedMock.mockRejectedValueOnce(new Error("relay unavailable"));

    const { state } = createSliceState();

    await state.createNewIdentity();

    expect(resetSignerMock).toHaveBeenCalled();
    expect(clearEphemeralKeyMock).not.toHaveBeenCalled();
    expect(state.pubkey).toBe("pubkey-new");
    expect(state.identityStatus).toBe("ready");
    expect(state.isEphemeral).toBe(true);
    expect(state.error).toBe("relay unavailable");
  });
});
