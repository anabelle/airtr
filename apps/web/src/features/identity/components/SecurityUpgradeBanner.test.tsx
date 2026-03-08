import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SecurityUpgradeBanner } from "./SecurityUpgradeBanner";

type Selector<T> = (state: T) => unknown;
type AirlineStoreState = {
  initializeIdentity: () => Promise<void>;
  pubkey: string | null;
};

const mockUseAirlineStore = vi.fn();
const mockHasNip07 = vi.fn();
const mockLoadEphemeralKey = vi.fn();
const mockWriteText = vi.fn().mockResolvedValue(undefined);
const localStorageState = new Map<string, string>();
const sessionStorageState = new Map<string, string>();

function createMockStorage(state: Map<string, string>) {
  return {
    getItem: vi.fn((key: string) => state.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      state.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      state.delete(key);
    }),
    clear: vi.fn(() => {
      state.clear();
    }),
  };
}

vi.mock("@acars/store", () => ({
  useAirlineStore: (selector?: Selector<AirlineStoreState>) => {
    const state = mockUseAirlineStore() as AirlineStoreState;
    return selector ? selector(state) : state;
  },
}));

vi.mock("@acars/nostr", () => ({
  hasNip07: () => mockHasNip07(),
  loadEphemeralKey: () => mockLoadEphemeralKey(),
}));

describe("SecurityUpgradeBanner", () => {
  beforeEach(() => {
    localStorageState.clear();
    sessionStorageState.clear();
    Object.defineProperty(globalThis, "localStorage", {
      value: createMockStorage(localStorageState),
      configurable: true,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: createMockStorage(sessionStorageState),
      configurable: true,
    });
    mockUseAirlineStore.mockReturnValue({
      initializeIdentity: vi.fn().mockResolvedValue(undefined),
      pubkey: "pubkey-1",
    });
    mockHasNip07.mockReturnValue(false);
    mockLoadEphemeralKey.mockReturnValue("nsec1testvalue");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mockWriteText },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    mockUseAirlineStore.mockReset();
    mockHasNip07.mockReset();
    mockLoadEphemeralKey.mockReset();
    mockWriteText.mockReset();
    localStorageState.clear();
    sessionStorageState.clear();
  });

  it("persists banner dismissal for an account after copying the secret key", async () => {
    render(<SecurityUpgradeBanner />);

    fireEvent.click(screen.getByRole("button", { name: /Secure it/i }));
    fireEvent.click(screen.getByRole("button", { name: /Copy my secret key/i }));

    await waitFor(() => {
      expect(screen.queryByText(/isn't backed up yet/i)).not.toBeInTheDocument();
    });

    expect(mockWriteText).toHaveBeenCalledWith("nsec1testvalue");
    expect(localStorage.getItem("acars:banner:secured:pubkey-1")).toBe("1");
  });

  it("stays hidden when the current account was already secured", () => {
    localStorage.setItem("acars:banner:secured:pubkey-1", "1");

    render(<SecurityUpgradeBanner />);

    expect(screen.queryByText(/isn't backed up yet/i)).not.toBeInTheDocument();
  });
});
