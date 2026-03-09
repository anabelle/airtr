import { airports as AIRPORTS } from "@acars/data";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
const mockGlobe = vi.fn();

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
      competitorHubColors: Map<string, string>;
    }) => {
      mockGlobe(props);
      return (
        <div>
          <button onClick={() => props.onAirportSelect(props.airports[0])}>Select Airport</button>
        </div>
      );
    },
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

afterEach(() => {
  cleanup();
  mockGlobe.mockClear();
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

  it("excludes inactive competitors from hub colors", () => {
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
      pubkey: "test-pubkey",
      competitors: new Map([
        [
          "inactive",
          {
            id: "inactive-airline",
            foundedBy: "founder",
            status: "private",
            ceoPubkey: "inactive",
            sharesOutstanding: 10000000,
            shareholders: { inactive: 10000000 },
            name: "Test Airline",
            icaoCode: "TST",
            callsign: "TEST",
            hubs: ["PVG"],
            livery: { primary: "#ff0000", secondary: "#00ff00", accent: "#0000ff" },
            brandScore: 0.7,
            tier: 1,
            cumulativeRevenue: 0,
            corporateBalance: 0,
            stockPrice: 0,
            fleetIds: [],
            routeIds: [],
            timeline: [],
          },
        ],
        [
          "active",
          {
            id: "active-airline",
            foundedBy: "founder",
            status: "private",
            ceoPubkey: "active",
            sharesOutstanding: 10000000,
            shareholders: { active: 10000000 },
            name: "Active Airline",
            icaoCode: "ACT",
            callsign: "ACTIVE",
            hubs: ["LAX"],
            livery: { primary: "#00ffff", secondary: "#00ff00", accent: "#0000ff" },
            brandScore: 0.7,
            tier: 1,
            cumulativeRevenue: 1,
            corporateBalance: 0,
            stockPrice: 0,
            fleetIds: [],
            routeIds: [],
            timeline: [],
          },
        ],
      ]),
      routes: [],
    });

    render(<WorldMap />);

    expect(mockGlobe).toHaveBeenCalled();
    const lastCall = mockGlobe.mock.calls[mockGlobe.mock.calls.length - 1]?.[0];
    expect(lastCall.competitorHubColors).toEqual(new Map([["LAX", "#00ffff"]]));
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
      pubkey: "test-pubkey",
      competitors: new Map(),
      routes: [],
    });

    render(<WorldMap />);
    fireEvent.click(screen.getByText("Select Airport"));
    expect(screen.getByText(`Focus: ${homeAirport.iata}`)).toBeInTheDocument();
    expect(screen.getByText(`Airport Panel ${homeAirport.iata}`)).toBeInTheDocument();
  });
});
