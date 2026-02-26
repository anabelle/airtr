import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RouteManager } from "./RouteManager";

const mockUseAirlineStore = vi.fn();
const mockUseEngineStore = vi.fn();

vi.mock("@airtr/store", () => {
  return {
    useAirlineStore: () => mockUseAirlineStore(),
    useEngineStore: () => mockUseEngineStore(),
  };
});

vi.mock("@airtr/data", () => {
  return {
    airports: [
      {
        iata: "JFK",
        icao: "KJFK",
        city: "New York",
        name: "JFK",
        country: "US",
        latitude: 0,
        longitude: 0,
        population: 1,
      },
      {
        iata: "LAX",
        icao: "KLAX",
        city: "Los Angeles",
        name: "LAX",
        country: "US",
        latitude: 1,
        longitude: 1,
        population: 1,
      },
    ],
    HUB_CLASSIFICATIONS: { JFK: { baseCapacityPerHour: 100, slotControlled: false } },
  };
});

vi.mock("@/shared/lib/useConfirm", () => {
  return {
    useConfirm: () => vi.fn(async () => true),
  };
});

vi.mock("@tanstack/react-router", () => {
  return {
    useNavigate: () => vi.fn(),
    useSearch: () => ({ tab: "active" }),
  };
});

vi.mock("sonner", () => {
  return {
    toast: { success: vi.fn(), error: vi.fn() },
  };
});

describe("RouteManager", () => {
  it("returns null when airline or home airport missing", () => {
    mockUseAirlineStore.mockReturnValue({ airline: null, routes: [] });
    mockUseEngineStore.mockReturnValue({ homeAirport: null, tick: 0 });
    const { container } = render(<RouteManager />);
    expect(container.firstChild).toBeNull();
  });

  it("renders network manager when data available", () => {
    mockUseAirlineStore.mockReturnValue({
      airline: { hubs: ["JFK"], brandScore: 0.6 },
      pubkey: "pub",
      routes: [],
      openRoute: vi.fn(),
      updateRouteFares: vi.fn(),
      rebaseRoute: vi.fn(),
      closeRoute: vi.fn(),
      globalRouteRegistry: new Map(),
      competitors: new Map(),
    });
    mockUseEngineStore.mockReturnValue({
      homeAirport: {
        iata: "JFK",
        name: "JFK",
        city: "New York",
        country: "US",
        latitude: 0,
        longitude: 0,
      },
      tick: 0,
    });

    render(<RouteManager />);
    expect(screen.getByText("Network Manager")).toBeInTheDocument();
  });
});
