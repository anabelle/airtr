import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const mockUseAirlineStore = vi.fn();

vi.mock("@acars/store", () => {
  return {
    useAirlineStore: (selector?: (state: unknown) => unknown) => {
      const state = mockUseAirlineStore();
      return selector ? selector(state) : state;
    },
    useActiveAirline: () => {
      const state = mockUseAirlineStore();
      return {
        airline: state.airline,
        fleet: state.fleet ?? [],
        routes: state.routes ?? [],
        timeline: state.timeline ?? [],
        isViewingOther: false,
        isGuest: !state.airline,
      };
    },
  };
});

vi.mock("@/shared/components/layout/PanelLayout", () => {
  return {
    PanelLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("@/features/fleet/components/FleetManager", () => {
  return {
    FleetManager: () => <div>Fleet Manager</div>,
  };
});

import FleetRoute from "./-fleet.lazy";

describe("Fleet route", () => {
  it("renders fleet manager panel", () => {
    mockUseAirlineStore.mockReturnValue({
      airline: { id: "airline" },
      initializeIdentity: vi.fn(),
      isLoading: false,
      viewedPubkey: null,
      fleet: [],
    });
    render(<FleetRoute />);
    expect(screen.getAllByText("Fleet Manager").length).toBeGreaterThan(0);
  });
});
