import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockUseAirlineStore = vi.fn();

vi.mock("@acars/store", () => {
  return {
    useAirlineStore: (selector?: (state: unknown) => unknown) => {
      const state = mockUseAirlineStore();
      return selector ? selector(state) : state;
    },
  };
});

vi.mock("@/shared/components/layout/PanelLayout", () => {
  return {
    PanelLayout: ({ children }: { children: ReactNode }) => (
      <div data-testid="panel-scroll-root">{children}</div>
    ),
  };
});

vi.mock("@/shared/components/layout/panelScrollContext", () => ({
  usePanelScrollRef: () => ({ current: null }),
}));

vi.mock("@/features/network/components/RouteManager", () => {
  return {
    RouteManager: () => <div>Route Manager</div>,
  };
});

import NetworkRoute from "./-network.lazy";

describe("Network route", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders route manager panel", () => {
    mockUseAirlineStore.mockReturnValue({
      airline: { id: "airline" },
      initializeIdentity: vi.fn(),
      createNewIdentity: vi.fn(),
      loginWithNsec: vi.fn(),
      isLoading: false,
      viewedPubkey: null,
    });
    render(<NetworkRoute />);
    expect(screen.getByText("Route Manager")).toBeInTheDocument();
  });

  it("renders beginner-friendly locked state when no airline is connected", () => {
    mockUseAirlineStore.mockReturnValue({
      airline: null,
      initializeIdentity: vi.fn(),
      createNewIdentity: vi.fn(),
      loginWithNsec: vi.fn(),
      isLoading: false,
      viewedPubkey: null,
    });
    render(<NetworkRoute />);
    expect(screen.getByText("Network access locked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play Free/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Browser wallet/i })).toBeInTheDocument();
    expect(screen.getAllByTestId("panel-scroll-root").length).toBeGreaterThan(0);
    expect(screen.getByText("What is Nostr?").closest("a")).toHaveAttribute(
      "href",
      "https://nostr.com",
    );
  });
});
