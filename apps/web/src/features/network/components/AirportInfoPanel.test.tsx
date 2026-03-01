import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AirportInfoPanel } from "./AirportInfoPanel";

type Selector<T> = (state: T) => unknown;
type AirlineStoreState = {
  airline: unknown;
  routes: unknown[];
  fleet: unknown[];
  fleetByOwner: Map<string, unknown[]>;
  competitors: Map<string, unknown>;
  modifyHubs: () => void;
  openRoute: () => void;
};
type EngineStoreState = { setHub: () => void };

const mockUseAirlineStore = vi.fn();
const mockUseEngineStore = vi.fn();

vi.mock("@acars/store", () => {
  return {
    useAirlineStore: () => mockUseAirlineStore() as AirlineStoreState,
    useEngineStore: (selector: Selector<EngineStoreState>) =>
      selector(mockUseEngineStore() as EngineStoreState),
  };
});

vi.mock("@tanstack/react-router", () => {
  return {
    useNavigate: () => vi.fn(),
    useSearch: () => ({ airportTab: "info" }),
  };
});

vi.mock("@/shared/lib/useConfirm", () => {
  return {
    useConfirm: () => vi.fn(async () => true),
  };
});

vi.mock("@/features/network/utils/groundTraffic", () => {
  return {
    buildGroundTraffic: () => ({ totalCount: 0, entries: [] }),
  };
});

vi.mock("@/features/network/utils/competitorHubs", () => {
  return {
    buildCompetitorHubEntries: () => [],
  };
});

vi.mock("@/features/network/components/FlightBoard", () => {
  return {
    FlightBoard: () => <div>Flight Board</div>,
  };
});

describe("AirportInfoPanel", () => {
  it("renders airport details and handles close", () => {
    const onClose = vi.fn();
    mockUseAirlineStore.mockReturnValue({
      airline: null,
      routes: [],
      fleet: [],
      fleetByOwner: new Map(),
      competitors: new Map(),
      modifyHubs: vi.fn(),
      openRoute: vi.fn(),
    });
    mockUseEngineStore.mockReturnValue({ setHub: vi.fn() });

    render(
      <AirportInfoPanel
        airport={{
          iata: "JFK",
          icao: "KJFK",
          name: "John F Kennedy",
          city: "New York",
          country: "US",
          latitude: 0,
          longitude: 0,
          population: 1000,
          gdpPerCapita: 1000,
          altitude: 0,
          timezone: "UTC",
          tags: [],
          id: "1",
        }}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("John F Kennedy")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close airport panel"));
    expect(onClose).toHaveBeenCalled();
  });
});
