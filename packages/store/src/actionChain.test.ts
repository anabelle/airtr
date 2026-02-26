import { describe, expect, it, vi } from "vitest";

vi.mock("@airtr/core", () => {
  return {
    computeActionChainHash: vi.fn(),
  };
});

vi.mock("@airtr/nostr", () => {
  return {
    publishAction: vi.fn(),
  };
});

import { computeActionChainHash } from "@airtr/core";
import { publishActionWithChain } from "./actionChain.js";
import { publishAction } from "@airtr/nostr";

describe("publishActionWithChain", () => {
  it("serializes action chain hash updates", async () => {
    const deferred: Array<(value: string) => void> = [];
    const computeMock = vi.mocked(computeActionChainHash);
    computeMock.mockImplementation(async () => {
      return await new Promise<string>((resolve) => {
        deferred.push(resolve);
      });
    });

    const publishMock = vi.mocked(publishAction);
    let eventCounter = 0;
    publishMock.mockImplementation(() => {
      eventCounter += 1;
      return {
        id: `event-${eventCounter}`,
        created_at: 1,
        author: { pubkey: `pubkey-${eventCounter}` },
      } as never;
    });

    const state = { actionChainHash: "" };
    const get = () => state as never;
    const set = (next: { actionChainHash?: string }) => {
      state.actionChainHash = next.actionChainHash ?? state.actionChainHash;
    };

    const firstAction = { type: "first" } as never;
    const secondAction = { type: "second" } as never;

    const first = publishActionWithChain({ action: firstAction, get, set });
    const second = publishActionWithChain({ action: secondAction, get, set });

    await Promise.resolve();
    await Promise.resolve();
    expect(computeMock).toHaveBeenCalledTimes(1);
    expect(computeMock.mock.calls[0]?.[0]).toBe("");

    deferred[0]?.("hash-1");
    await first;
    expect(state.actionChainHash).toBe("hash-1");

    await Promise.resolve();
    expect(computeMock).toHaveBeenCalledTimes(2);
    expect(computeMock.mock.calls[1]?.[0]).toBe("hash-1");

    deferred[1]?.("hash-2");
    await second;

    expect(state.actionChainHash).toBe("hash-2");
  });
});
