import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPublicKeyMock = vi.fn();
const signerMock = vi.fn();
const privateSignerCtorMock = vi.fn();
const privateSignerUserMock = vi.fn();
const ndk = { signer: null as unknown };
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};

vi.mock("@nostr-dev-kit/ndk", () => {
  return {
    NDKNip07Signer: class {
      constructor(...args: unknown[]) {
        signerMock(...args);
      }
    },
    NDKPrivateKeySigner: class {
      constructor(...args: unknown[]) {
        privateSignerCtorMock(...args);
      }

      user() {
        return privateSignerUserMock();
      }
    },
  };
});

vi.mock("./ndk.js", () => {
  return {
    getNDK: () => ndk,
  };
});

import {
  attachSigner,
  clearEphemeralKey,
  generateNewKeypair,
  getPubkey,
  hasNip07,
  loadEphemeralKey,
  loginWithNsec,
  saveEphemeralKey,
  waitForNip07,
} from "./identity.js";

describe("identity", () => {
  beforeEach(() => {
    getPublicKeyMock.mockReset();
    signerMock.mockReset();
    privateSignerCtorMock.mockReset();
    privateSignerUserMock.mockReset();
    localStorageMock.getItem.mockReset();
    localStorageMock.setItem.mockReset();
    localStorageMock.removeItem.mockReset();
    ndk.signer = null;
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects missing NIP-07 extension", () => {
    expect(hasNip07()).toBe(false);
  });

  it("detects available NIP-07 extension", () => {
    (globalThis as any).window = { nostr: { getPublicKey: getPublicKeyMock } };
    expect(hasNip07()).toBe(true);
  });

  it("waits for NIP-07 extension and resolves true when available", async () => {
    (globalThis as any).window = { nostr: { getPublicKey: getPublicKeyMock } };
    const result = await waitForNip07(10);
    expect(result).toBe(true);
  });

  it("returns null when getPublicKey times out", async () => {
    vi.useFakeTimers();
    (globalThis as any).window = {
      nostr: {
        getPublicKey: () => new Promise<string>(() => {}),
      },
    };

    const promise = getPubkey(4000);
    vi.advanceTimersByTime(4000);
    const result = await promise;
    expect(result).toBeNull();
  });

  it("attaches a new signer when available", () => {
    (globalThis as any).window = { nostr: { getPublicKey: getPublicKeyMock } };
    attachSigner();
    expect(signerMock).toHaveBeenCalledWith(15000);
  });

  it("does not override an active private-key signer unless forced", async () => {
    let resolveUser: ((value: { pubkey: string }) => void) | null = null;
    privateSignerUserMock.mockImplementation(
      () =>
        new Promise<{ pubkey: string }>((resolve) => {
          resolveUser = resolve;
        }),
    );

    const loginPromise = loginWithNsec("nsec1valid");
    if (!resolveUser) throw new Error("Expected signer.user resolver");
    resolveUser({ pubkey: "pubkey-1" });
    await loginPromise;

    const privateSigner = ndk.signer;
    (globalThis as any).window = { nostr: { getPublicKey: getPublicKeyMock } };

    attachSigner();
    expect(ndk.signer).toBe(privateSigner);
    expect(signerMock).not.toHaveBeenCalled();

    attachSigner(true);
    expect(signerMock).toHaveBeenCalledWith(15000);
    expect(ndk.signer).not.toBe(privateSigner);
  });

  it("loginWithNsec validates before attaching signer", async () => {
    let resolveUser: ((value: { pubkey: string }) => void) | null = null;
    privateSignerUserMock.mockImplementation(
      () =>
        new Promise<{ pubkey: string }>((resolve) => {
          resolveUser = resolve;
        }),
    );

    const promise = loginWithNsec("  nsec1valid  ");
    expect(privateSignerCtorMock).toHaveBeenCalledWith("nsec1valid");
    expect(ndk.signer).toBeNull();

    if (!resolveUser) throw new Error("Expected signer.user resolver");
    resolveUser({ pubkey: "pubkey-1" });

    await expect(promise).resolves.toBe("pubkey-1");
    expect(ndk.signer).not.toBeNull();
  });

  it("loginWithNsec keeps signer unset on invalid key", async () => {
    privateSignerUserMock.mockRejectedValueOnce(new Error("invalid nsec"));

    await expect(loginWithNsec("nsec1bad")).rejects.toThrow("invalid nsec");
    expect(ndk.signer).toBeNull();
  });

  it("persists and clears ephemeral keys from localStorage", () => {
    (globalThis as any).window = {};
    (globalThis as any).localStorage = localStorageMock;

    saveEphemeralKey("nsec1saved");
    expect(localStorageMock.setItem).toHaveBeenCalledWith("acars:ephemeral:nsec", "nsec1saved");

    localStorageMock.getItem.mockReturnValueOnce("nsec1saved");
    expect(loadEphemeralKey()).toBe("nsec1saved");

    clearEphemeralKey();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith("acars:ephemeral:nsec");
  });

  it("generates a valid nsec/pubkey pair", () => {
    const { nsec, pubkey } = generateNewKeypair();
    expect(nsec.startsWith("nsec1")).toBe(true);
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
  });
});
