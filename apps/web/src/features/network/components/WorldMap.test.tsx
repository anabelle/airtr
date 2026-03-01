import { airports as AIRPORTS } from "@acars/data";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorldMap } from "./WorldMap";

type Selector<T> = (state: T) => unknown;
type EngineStoreState = {
  homeAirport: { iata: string } | null;
  tick: number;
  tickProgress: number;
};
type AirlineStoreState = {
  airline: {
    hubs: string[];
    livery: { primary: string; secondary: string };
  } | null;
  fleet: unknown[];
  fleetByOwner: Map<string, unknown[]>;
  routesByOwner: Map<string, unknown[]>;
  pubkey: string | null;
  competitors: Map<string, unknown>;
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

vi.mock("@acars/map", () => {
  return {
    Globe: (props: {
      airports: Array<{ iata: string }>;
      onAirportSelect: (airport: { iata: string }) => void;
    }) => (
      <div>
        <button onClick={() => props.onAirportSelect(props.airports[0])}>Select Airport</button>
      </div>
    ),
  };
});

vi.mock("@/features/network/components/AirportInfoPanel", () => {
  return {
    AirportInfoPanel: ({ airport }: { airport: { iata: string } }) => (
      <div>Airport Panel {airport.iata}</div>
    ),
  };
});

vi.mock("@/features/network/utils/groundTraffic", () => {
  return {
    buildGroundPresenceByAirport: () => ({ totals: {}, presence: {} }),
  };
});

describe("WorldMap", () => {
  it("renders nothing when no home airport", () => {
    mockUseEngineStore.mockReturnValue({
      homeAirport: null,
      tick: 0,
      tickProgress: 0,
    });
    mockUseAirlineStore.mockReturnValue({
      airline: null,
      fleet: [],
      fleetByOwner: new Map(),
      routesByOwner: new Map(),
      pubkey: null,
      competitors: new Map(),
      routes: [],
    });

    const { container } = render(<WorldMap />);
    expect(container.firstChild).toBeNull();
  });

  it("renders focus label after selecting airport", () => {
    const homeAirport = AIRPORTS[0];
    mockUseEngineStore.mockReturnValue({
      homeAirport,
      tick: 0,
      tickProgress: 0,
    });
    mockUseAirlineStore.mockReturnValue({
      airline: {
        hubs: [homeAirport.iata],
        livery: { primary: "#111", secondary: "#222" },
      },
      fleet: [],
      fleetByOwner: new Map(),
      routesByOwner: new Map(),
      competitors: new Map(),
      routes: [],
    });

    render(<WorldMap />);
    fireEvent.click(screen.getByText("Select Airport"));
    expect(screen.getByText(`Focus: ${homeAirport.iata}`)).toBeInTheDocument();
    expect(screen.getByText(`Airport Panel ${homeAirport.iata}`)).toBeInTheDocument();
  });
});
