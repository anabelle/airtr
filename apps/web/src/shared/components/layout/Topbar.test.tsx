import type { AirlineEntity } from "@airtr/core";
import { fp } from "@airtr/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Topbar } from "./Topbar";

const mockUseAirlineStore = vi.fn();

vi.mock("@airtr/store", () => {
  return {
    useAirlineStore: () => mockUseAirlineStore(),
  };
});

describe("Topbar", () => {
  it("renders connect prompt when no airline", () => {
    mockUseAirlineStore.mockReturnValue({
      airline: null,
      initializeIdentity: vi.fn(),
      isLoading: false,
    });
    render(<Topbar />);
    expect(screen.getByText("AirTR")).toBeInTheDocument();
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
      corporateBalance: fp(1000000),
      stockPrice: fp(12),
      fleetIds: [],
      routeIds: [],
    };

    mockUseAirlineStore.mockReturnValue({ airline });
    render(<Topbar />);
    expect(screen.getByText("Test Air")).toBeInTheDocument();
    expect(screen.getByText("TEST")).toBeInTheDocument();
    expect(screen.getByText(/T2/)).toBeInTheDocument();
  });
});
