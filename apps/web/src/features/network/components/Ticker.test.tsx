import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Ticker } from "./Ticker";

type Selector<T> = (state: T) => unknown;
type EngineStoreState = {
  routes: Array<{ season: string }>;
  tick: number;
  homeAirport: { iata: string } | null;
  tickProgress: number;
  catchupProgress: number | null;
};
type AirlineStoreState = {
  competitors: Map<string, unknown>;
  fleetByOwner: Map<string, unknown[]>;
  routesByOwner: Map<string, unknown[]>;
  fleet: unknown[];
  routes: unknown[];
};

const mockUseEngineStore = vi.fn();
const mockUseAirlineStore = vi.fn();

vi.mock("@acars/store", () => {
  return {
    useEngineStore: (selector: Selector<EngineStoreState>) =>
      selector(mockUseEngineStore() as EngineStoreState),
    useAirlineStore: () => mockUseAirlineStore() as AirlineStoreState,
  };
});

vi.mock("@acars/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@acars/core")>();
  return {
    ...original,
    getProsperityIndex: () => 1.05,
  };
});

vi.mock("@acars/data", () => {
  return {
    airports: new Array(10).fill(null),
  };
});

describe("Ticker", () => {
  it("renders null when no home airport", () => {
    mockUseEngineStore.mockReturnValue({
      routes: [],
      tick: 0,
      homeAirport: null,
      tickProgress: 0,
      catchupProgress: null,
    });
    mockUseAirlineStore.mockReturnValue({
      competitors: new Map(),
      fleetByOwner: new Map(),
      routesByOwner: new Map(),
      fleet: [],
      routes: [],
    });
    const { container } = render(<Ticker />);
    expect(container.firstChild).toBeNull();
  });

  it("renders live metrics when home airport present", () => {
    mockUseEngineStore.mockReturnValue({
      routes: [{ season: "summer" }],
      tick: 10,
      homeAirport: { iata: "JFK" },
      tickProgress: 0.5,
      catchupProgress: null,
    });
    mockUseAirlineStore.mockReturnValue({
      competitors: new Map(),
      fleetByOwner: new Map(),
      routesByOwner: new Map(),
      fleet: [],
      routes: [],
    });

    render(<Ticker />);
    expect(screen.getByText("summer")).toBeInTheDocument();
    expect(screen.getByText(/Live Data/i)).toBeInTheDocument();
  });
});
