import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const mockUseAirlineStore = vi.fn();

vi.mock("@airtr/store", () => {
  return {
    useAirlineStore: (selector?: (state: unknown) => unknown) => {
      const state = mockUseAirlineStore();
      return selector ? selector(state) : state;
    },
  };
});

vi.mock("@/shared/components/layout/PanelLayout", () => {
  return {
    PanelLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("@/features/network/components/RouteManager", () => {
  return {
    RouteManager: () => <div>Route Manager</div>,
  };
});

import NetworkRoute from "./-network.lazy";

describe("Network route", () => {
  it("renders route manager panel", () => {
    mockUseAirlineStore.mockReturnValue({
      airline: { id: "airline" },
      initializeIdentity: vi.fn(),
      isLoading: false,
      viewedPubkey: null,
    });
    render(<NetworkRoute />);
    expect(screen.getByText("Route Manager")).toBeInTheDocument();
  });
});
