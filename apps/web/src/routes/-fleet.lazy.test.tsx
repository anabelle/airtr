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
    PanelHeader: ({ title }: { title: string }) => <div>{title}</div>,
    PanelBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("@/shared/components/layout/panelScrollContext", () => ({
  usePanelScrollRef: () => ({ current: null }),
}));

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

  it("renders beginner-friendly locked state when no airline is connected", () => {
    mockUseAirlineStore.mockReturnValue({
      airline: null,
      initializeIdentity: vi.fn(),
      createNewIdentity: vi.fn(),
      loginWithNsec: vi.fn(),
      isLoading: false,
      viewedPubkey: null,
      fleet: [],
    });
    render(<FleetRoute />);
    expect(screen.getByText("Fleet access locked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play Free/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Browser wallet/i })).toBeInTheDocument();
    expect(screen.getByText("What is Nostr?").closest("a")).toHaveAttribute(
      "href",
      "https://nostr.com",
    );
  });
});
