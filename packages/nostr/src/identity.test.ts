import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPublicKeyMock = vi.fn();
const signerMock = vi.fn();

vi.mock("@nostr-dev-kit/ndk", () => {
  return {
    NDKNip07Signer: class {
      constructor(...args: unknown[]) {
        signerMock(...args);
      }
    },
  };
});

vi.mock("./ndk.js", () => {
  return {
    getNDK: () => ({ signer: null as unknown }),
  };
});

import { attachSigner, getPubkey, hasNip07, waitForNip07 } from "./identity.js";

describe("identity", () => {
  beforeEach(() => {
    getPublicKeyMock.mockReset();
    signerMock.mockReset();
    delete (globalThis as any).window;
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

    const promise = getPubkey();
    vi.advanceTimersByTime(4000);
    const result = await promise;
    expect(result).toBeNull();
  });

  it("attaches a new signer when available", () => {
    (globalThis as any).window = { nostr: { getPublicKey: getPublicKeyMock } };
    attachSigner();
    expect(signerMock).toHaveBeenCalledWith(4000);
  });
});
