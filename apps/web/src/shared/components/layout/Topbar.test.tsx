import type { AirlineEntity } from "@acars/core";
import { fp } from "@acars/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Topbar } from "./Topbar";

const mockUseAirlineStore = vi.fn();

const mockUseActiveAirline = vi.fn();
type MockAirlineStoreState = {
  airline: AirlineEntity | null;
  initializeIdentity: () => void;
  createNewIdentity?: () => void;
  loginWithNsec?: () => void;
  isLoading: boolean;
  isEphemeral: boolean;
  error?: string | null;
  viewAs: () => void;
};

vi.mock("@acars/store", () => {
  return {
    useAirlineStore: (selector?: (state: MockAirlineStoreState) => unknown) => {
      const state = mockUseAirlineStore();
      return selector ? selector(state) : state;
    },
    useActiveAirline: () => mockUseActiveAirline(),
  };
});

vi.mock("@tanstack/react-router", () => {
  return {
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@/features/identity/components/EphemeralKeyBackupActions", () => ({
  EphemeralKeyBackupActions: () => <div>Backup Actions</div>,
}));

afterEach(() => {
  cleanup();
  mockUseAirlineStore.mockReset();
  mockUseActiveAirline.mockReset();
});

describe("Topbar", () => {
  it("renders connect prompt when no airline", () => {
    mockUseAirlineStore.mockImplementation((selector?: (state: { airline: null }) => unknown) => {
      const state = {
        airline: null,
        initializeIdentity: vi.fn(),
        createNewIdentity: vi.fn(),
        loginWithNsec: vi.fn(),
        isLoading: false,
        isEphemeral: false,
        error: null,
        viewAs: vi.fn(),
      };
      return selector ? selector(state) : state;
    });
    mockUseActiveAirline.mockReturnValue({
      airline: null,
      timeline: [],
      isViewingOther: false,
    });
    render(<Topbar />);
    expect(screen.getAllByText("ACARS")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Play Free/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /I already have an nsec key/i })).toBeInTheDocument();
    expect(screen.getByText(/New here\? Start free in one click/i)).toBeInTheDocument();
  });

  it("renders airline metrics when available", () => {
    const airline: AirlineEntity = {
      id: "air-1",
      foundedBy: "founder",
      status: "private",
      ceoPubkey: "ceo",
      sharesOutstanding: 10000000,
      shareholders: { ceo: 10000000 },
      name: "Test Air",
      icaoCode: "TST",
      callsign: "TEST",
      hubs: ["JFK"],
      livery: { primary: "#111111", secondary: "#222222", accent: "#333333" },
      brandScore: 0.7,
      tier: 2,
      cumulativeRevenue: fp(0),
      corporateBalance: fp(1000000),
      stockPrice: fp(12),
      fleetIds: [],
      routeIds: [],
    };

    mockUseAirlineStore.mockImplementation(
      (selector?: (state: { airline: AirlineEntity }) => unknown) => {
        const state = {
          airline,
          initializeIdentity: vi.fn(),
          isLoading: false,
          isEphemeral: false,
          viewAs: vi.fn(),
        };
        return selector ? selector(state) : state;
      },
    );
    mockUseActiveAirline.mockReturnValue({
      airline,
      timeline: [],
      isViewingOther: false,
    });
    render(<Topbar />);
    expect(screen.getAllByText("Test Air")).toHaveLength(2);
    expect(screen.getByText("TEST")).toBeInTheDocument();
    expect(screen.getByText("Corporate Balance")).toBeInTheDocument();
    expect(screen.getByText(/T2/)).toBeInTheDocument();
    expect(screen.getByTestId("topbar-metrics").className).not.toMatch(/\bhidden\b/);
  });

  it("toggles the mobile airline drawer from a hamburger button", () => {
    const airline: AirlineEntity = {
      id: "air-1",
      foundedBy: "founder",
      status: "private",
      ceoPubkey: "ceo",
      sharesOutstanding: 10000000,
      shareholders: { ceo: 10000000 },
      name: "Test Air",
      icaoCode: "TST",
      callsign: "TEST",
      hubs: ["JFK"],
      livery: { primary: "#111111", secondary: "#222222", accent: "#333333" },
      brandScore: 0.7,
      tier: 2,
      cumulativeRevenue: fp(0),
      corporateBalance: fp(1000000),
      stockPrice: fp(12),
      fleetIds: [],
      routeIds: [],
    };

    mockUseAirlineStore.mockImplementation(
      (selector?: (state: { airline: AirlineEntity }) => unknown) => {
        const state = {
          airline,
          initializeIdentity: vi.fn(),
          isLoading: false,
          isEphemeral: false,
          viewAs: vi.fn(),
        };
        return selector ? selector(state) : state;
      },
    );
    mockUseActiveAirline.mockReturnValue({
      airline,
      timeline: [],
      isViewingOther: false,
    });

    render(<Topbar />);

    expect(screen.queryByRole("dialog", { name: /flight deck/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open flight deck/i }));
    expect(screen.getByRole("dialog", { name: /flight deck/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /close flight deck/i }));
    expect(screen.queryByRole("dialog", { name: /flight deck/i })).not.toBeInTheDocument();
  });

  it("shows persistent account key tools for ephemeral airlines", () => {
    const airline: AirlineEntity = {
      id: "air-1",
      foundedBy: "founder",
      status: "private",
      ceoPubkey: "ceo",
      sharesOutstanding: 10000000,
      shareholders: { ceo: 10000000 },
      name: "Test Air",
      icaoCode: "TST",
      callsign: "TEST",
      hubs: ["JFK"],
      livery: { primary: "#111111", secondary: "#222222", accent: "#333333" },
      brandScore: 0.7,
      tier: 2,
      cumulativeRevenue: fp(0),
      corporateBalance: fp(1000000),
      stockPrice: fp(12),
      fleetIds: [],
      routeIds: [],
    };

    mockUseAirlineStore.mockImplementation(
      (selector?: (state: { airline: AirlineEntity }) => unknown) => {
        const state = {
          airline,
          initializeIdentity: vi.fn(),
          isLoading: false,
          isEphemeral: true,
          viewAs: vi.fn(),
        };
        return selector ? selector(state) : state;
      },
    );
    mockUseActiveAirline.mockReturnValue({
      airline,
      timeline: [],
      isViewingOther: false,
    });

    render(<Topbar />);

    fireEvent.click(screen.getAllByRole("button", { name: /Account key/i })[0]);
    expect(screen.getByText("Local account key")).toBeInTheDocument();
    expect(screen.getByText("Backup Actions")).toBeInTheDocument();
  });
});
