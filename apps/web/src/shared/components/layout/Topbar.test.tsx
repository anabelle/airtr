import type { AirlineEntity } from "@acars/core";
import { fp } from "@acars/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Topbar } from "./Topbar";

const mockUseAirlineStore = vi.fn();

const mockUseActiveAirline = vi.fn();

vi.mock("@acars/store", () => {
  return {
    useAirlineStore: (selector?: (state: { airline: AirlineEntity | null }) => unknown) => {
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

describe("Topbar", () => {
  it("renders connect prompt when no airline", () => {
    mockUseAirlineStore.mockImplementation((selector?: (state: { airline: null }) => unknown) => {
      const state = {
        airline: null,
        initializeIdentity: vi.fn(),
        isLoading: false,
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
    expect(screen.getByText("ACARS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect Wallet/i })).toBeInTheDocument();
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
    expect(screen.getByText("Test Air")).toBeInTheDocument();
    expect(screen.getByText("TEST")).toBeInTheDocument();
    expect(screen.getByText(/T2/)).toBeInTheDocument();
  });
});
