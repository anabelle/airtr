import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Leaderboard } from "./Leaderboard";

type Selector<T> = (state: T) => unknown;
type AirlineStoreState = {
  competitors: Map<string, unknown>;
  airline: { id: string } | null;
  fleet: unknown[];
  routes: unknown[];
  fleetByOwner: Map<string, unknown[]>;
  routesByOwner: Map<string, unknown[]>;
  viewAs: (pubkey: string | null) => void;
};
type EngineStoreState = { tick: number };

const mockUseAirlineStore = vi.fn();
const mockUseEngineStore = vi.fn();

vi.mock("@acars/store", () => {
  return {
    useAirlineStore: (selector: Selector<AirlineStoreState>) =>
      selector(mockUseAirlineStore() as AirlineStoreState),
    useEngineStore: (selector: Selector<EngineStoreState>) =>
      selector(mockUseEngineStore() as EngineStoreState),
  };
});

vi.mock("@/features/competition/leaderboardMetrics", () => {
  return {
    buildLeaderboardRows: () => [
      {
        id: "airline-1",
        name: "Test Air",
        icaoCode: "TST",
        ceoPubkey: "pubkey",
        liveryPrimary: "#ff3333",
        balance: 0,
        fleet: 1,
        routes: 2,
        brand: 0.5,
        fleetValue: 0,
        networkDistance: 1000,
      },
    ],
    sortLeaderboardRows: <T,>(rows: T) => rows,
  };
});

vi.mock("@tanstack/react-virtual", () => {
  return {
    useVirtualizer: (opts: { count: number }) => ({
      getTotalSize: () => opts.count * 84,
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, index) => ({
          index,
          key: index,
          start: index * 84,
          size: 84,
        })),
      measureElement: () => {},
    }),
  };
});

vi.mock("@/shared/hooks/useNostrProfile", () => {
  return {
    useNostrProfile: () => ({
      name: null,
      displayName: null,
      image: null,
      nip05: null,
      lud16: null,
      npub: null,
      isLoading: false,
    }),
  };
});

describe("Leaderboard", () => {
  it("renders rows and toggles metrics", () => {
    mockUseAirlineStore.mockReturnValue({
      competitors: new Map(),
      airline: { id: "airline-1" },
      fleet: [],
      routes: [],
      fleetByOwner: new Map(),
      routesByOwner: new Map(),
      viewAs: vi.fn(),
    });
    mockUseEngineStore.mockReturnValue({ tick: 0 });

    render(<Leaderboard />);
    expect(screen.getByText("Test Air")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "fleet" } });
    expect(screen.getAllByText("Fleet Size").length).toBeGreaterThan(0);
  });
});
