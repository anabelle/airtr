import { airports as AIRPORTS } from "@acars/data";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorldMap } from "./WorldMap";

const MAP_THEME_STORAGE_KEY = "acars:map:theme";

type Selector<T> = (state: T) => unknown;
type EngineStoreState = {
  homeAirport: { iata: string } | null;
  tick: number;
  tickProgress: number;
  permalinkAirportIata?: string | null;
  permalinkAircraftId?: string | null;
  setPermalinkAirport?: (iata: string | null) => void;
  setPermalinkAircraft?: (id: string | null) => void;
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
const mockSetPermalinkAirport = vi.fn();
const mockSetPermalinkAircraft = vi.fn();

function buildEngineState(overrides: Partial<EngineStoreState>): EngineStoreState {
  return {
    homeAirport: null,
    tick: 0,
    tickProgress: 0,
    permalinkAirportIata: null,
    permalinkAircraftId: null,
    setPermalinkAirport: mockSetPermalinkAirport,
    setPermalinkAircraft: mockSetPermalinkAircraft,
    ...overrides,
  };
}

vi.mock("@acars/store", () => {
  const useEngineStore = (selector: Selector<EngineStoreState>) =>
    selector(mockUseEngineStore() as EngineStoreState);

  useEngineStore.getState = () => mockUseEngineStore() as EngineStoreState;

  return {
    useEngineStore,
    useAirlineStore: () => mockUseAirlineStore() as AirlineStoreState,
  };
});

vi.mock("@acars/map", () => {
  return {
    DEFAULT_MAP_THEME: "dark",
    Globe: (props: {
      airports: Array<{ iata: string }>;
      onAirportSelect: (airport: { iata: string }) => void;
      competitorHubColors: Map<string, string>;
      theme: "dark" | "light";
    }) => {
      mockGlobe(props);
      return (
        <div>
          <button type="button" onClick={() => props.onAirportSelect(props.airports[0])}>
            Select Airport
          </button>
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
  mockSetPermalinkAirport.mockClear();
  mockSetPermalinkAircraft.mockClear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("WorldMap", () => {
  it("renders nothing when no home airport", () => {
    mockUseEngineStore.mockReturnValue(buildEngineState({ homeAirport: null }));
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
    mockUseEngineStore.mockReturnValue(buildEngineState({ homeAirport }));
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
            livery: {
              primary: "#ff0000",
              secondary: "#00ff00",
              accent: "#0000ff",
            },
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
            livery: {
              primary: "#00ffff",
              secondary: "#00ff00",
              accent: "#0000ff",
            },
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
    mockUseEngineStore.mockReturnValue(buildEngineState({ homeAirport }));
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
    expect(window.location.pathname).toBe(`/airport/${homeAirport.iata}`);
  });

  it("defaults to dark theme with black background", () => {
    const homeAirport = AIRPORTS[0];
    mockUseEngineStore.mockReturnValue(buildEngineState({ homeAirport }));
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

    const { container } = render(<WorldMap />);

    expect(mockGlobe).toHaveBeenCalled();
    const lastCall = mockGlobe.mock.calls[mockGlobe.mock.calls.length - 1]?.[0];
    expect(lastCall.theme).toBe("dark");
    expect(container.firstChild).toHaveClass("bg-black");
  });

  it("restores a saved map theme from localStorage", () => {
    const homeAirport = AIRPORTS[0];
    window.localStorage.setItem(MAP_THEME_STORAGE_KEY, "light");
    mockUseEngineStore.mockReturnValue(buildEngineState({ homeAirport }));
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

    const lastCall = mockGlobe.mock.calls[mockGlobe.mock.calls.length - 1]?.[0];
    expect(lastCall.theme).toBe("light");
  });

  it("toggles the map theme and persists the new choice", () => {
    const homeAirport = AIRPORTS[0];
    mockUseEngineStore.mockReturnValue(buildEngineState({ homeAirport }));
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

    fireEvent.click(screen.getByRole("button", { name: "Switch to light map theme" }));

    const lastCall = mockGlobe.mock.calls[mockGlobe.mock.calls.length - 1]?.[0];
    expect(lastCall.theme).toBe("light");
    expect(window.localStorage.getItem(MAP_THEME_STORAGE_KEY)).toBe("light");
  });

  it("returns to the previous workspace when closing a detail route", () => {
    const homeAirport = AIRPORTS[0];
    window.history.replaceState(null, "", "/network?tab=active");

    mockUseEngineStore.mockReturnValue(buildEngineState({ homeAirport }));
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

    const lastCall = mockGlobe.mock.calls[mockGlobe.mock.calls.length - 1]?.[0];
    lastCall.onMapClick();

    expect(window.location.pathname).toBe("/network");
    expect(window.location.search).toBe("?tab=active");
  });
});
