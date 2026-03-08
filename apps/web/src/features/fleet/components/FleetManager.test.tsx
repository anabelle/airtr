import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FLEET_TWO_COLUMN_BREAKPOINT, FleetManager } from "./FleetManager";

vi.mock("@/shared/components/layout/panelScrollContext", () => ({
  usePanelScrollRef: () => ({ current: null }),
}));

type Selector<T> = (state: T) => unknown;
type AirlineStoreState = {
  airline: { hubs: string[] } | null;
  fleet: unknown[];
  routes: unknown[];
  timeline: unknown[];
  sellAircraft: () => void;
  buyoutAircraft: () => void;
  assignAircraftToRoute: () => void;
  listAircraft: () => void;
  cancelListing: () => void;
  ferryAircraft: () => void;
};
type EngineStoreState = { tick: number; tickProgress: number };

const mockUseAirlineStore = vi.fn();
const mockUseEngineStore = vi.fn();
const mockUseActiveAirline = vi.fn();
const mockMeasureElement = vi.fn();
let mockVirtualItems: Array<{ key: string; index: number; start: number }> = [];

vi.mock("@tanstack/react-virtual", () => {
  return {
    useVirtualizer: () => ({
      getVirtualItems: () => mockVirtualItems,
      getTotalSize: () => (mockVirtualItems.length > 0 ? 730 : 0),
      measureElement: mockMeasureElement,
      options: { scrollMargin: 0 },
    }),
  };
});

vi.mock("@acars/store", () => {
  return {
    useAirlineStore: (selector: Selector<AirlineStoreState>) =>
      selector(mockUseAirlineStore() as AirlineStoreState),
    useEngineStore: (selector: Selector<EngineStoreState>) =>
      selector(mockUseEngineStore() as EngineStoreState),
    useActiveAirline: () => mockUseActiveAirline(),
  };
});

vi.mock("@acars/map", () => {
  return {
    FAMILY_ICONS: {
      a320: { body: "<svg></svg>", accent: "<svg></svg>" },
    },
  };
});

vi.mock("sonner", () => {
  return {
    toast: {
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock("@/shared/lib/useConfirm", () => {
  return {
    useConfirm: () => vi.fn(async () => true),
  };
});

vi.mock("@/features/network/hooks/useRouteDemand", () => {
  return {
    getRouteDemandSnapshot: vi.fn(() => ({
      totalDemand: {
        origin: "JFK",
        destination: "LAX",
        economy: 0,
        business: 0,
        first: 0,
      },
      addressableDemand: {
        origin: "JFK",
        destination: "LAX",
        economy: 0,
        business: 0,
        first: 0,
      },
      pressureMultiplier: 0.7,
      totalWeeklySeats: 0,
      suggestedFleetDelta: 0,
      isOversupplied: false,
      elasticityEconomy: 1,
      elasticityBusiness: 1,
      elasticityFirst: 1,
      referenceFareEconomy: 0,
      referenceFareBusiness: 0,
      referenceFareFirst: 0,
      effectiveLoadFactor: 0.92,
    })),
  };
});

vi.mock("./AircraftLiveryImage", () => {
  return {
    AircraftLiveryImage: () => null,
  };
});

vi.mock("./CatalogImage", () => {
  return {
    CatalogImage: ({ model }: { model: { id: string; name: string } }) => (
      <div data-testid={`catalog-image-${model.id}`}>{model.name} catalog image</div>
    ),
  };
});

describe("FleetManager", () => {
  beforeEach(() => {
    mockMeasureElement.mockClear();
    mockVirtualItems = [];
  });

  it("measures virtual rows so taller cards expand the row height", () => {
    mockVirtualItems = [{ key: "row-0", index: 0, start: 0 }];

    mockUseAirlineStore.mockReturnValue({
      sellAircraft: vi.fn(),
      buyoutAircraft: vi.fn(),
      assignAircraftToRoute: vi.fn(),
      listAircraft: vi.fn(),
      cancelListing: vi.fn(),
      ferryAircraft: vi.fn(),
    });
    mockUseActiveAirline.mockReturnValue({
      airline: { hubs: ["JFK"] },
      fleet: [
        {
          id: "ac-1",
          name: "Tall Card Jet",
          modelId: "a320neo",
          status: "idle",
          assignedRouteId: null,
          baseAirportIata: "JFK",
          configuration: { economy: 120, business: 0, first: 0, cargoKg: 0 },
          condition: 1,
          flightHoursTotal: 0,
          flightHoursSinceCheck: 0,
          purchaseType: "buy",
          purchasedAtTick: 0,
          birthTick: 0,
          purchasePrice: 100000,
          flight: null,
        },
      ],
      routes: [],
      timeline: [
        {
          type: "landing",
          aircraftId: "ac-1",
          originIata: "JFK",
          destinationIata: "LAX",
          profit: 1000,
          details: {
            flightDurationTicks: 1200,
            loadFactor: 0.9,
            passengers: { total: 100, economy: 100, business: 0, first: 0 },
            spilledPassengers: 0,
          },
        },
      ],
      isViewingOther: false,
    });
    mockUseEngineStore.mockReturnValue({ tick: 0, tickProgress: 0 });

    render(<FleetManager />);

    expect(mockMeasureElement).toHaveBeenCalled();
    expect(screen.getByText("Last Flight Outcome")).toBeInTheDocument();
  });

  it("renders empty state when fleet is empty", () => {
    mockUseAirlineStore.mockReturnValue({
      sellAircraft: vi.fn(),
      buyoutAircraft: vi.fn(),
      assignAircraftToRoute: vi.fn(),
      listAircraft: vi.fn(),
      cancelListing: vi.fn(),
      ferryAircraft: vi.fn(),
    });
    mockUseActiveAirline.mockReturnValue({
      airline: { hubs: ["JFK"] },
      fleet: [],
      routes: [],
      timeline: [],
      isViewingOther: false,
    });
    mockUseEngineStore.mockReturnValue({ tick: 0, tickProgress: 0 });

    render(<FleetManager />);

    expect(mockMeasureElement).not.toHaveBeenCalled();
    expect(screen.getByText("Your hangar is empty")).toBeInTheDocument();
    expect(screen.getByText("Open Global Marketplace")).toBeInTheDocument();
  });

  it("uses elasticity-adjusted load factor in route options", () => {
    mockUseAirlineStore.mockReturnValue({
      sellAircraft: vi.fn(),
      buyoutAircraft: vi.fn(),
      assignAircraftToRoute: vi.fn(),
      listAircraft: vi.fn(),
      cancelListing: vi.fn(),
      ferryAircraft: vi.fn(),
    });
    mockUseActiveAirline.mockReturnValue({
      airline: { hubs: ["JFK"] },
      fleet: [
        {
          id: "ac-1",
          name: "Test Jet",
          modelId: "a320neo",
          status: "idle",
          assignedRouteId: null,
          baseAirportIata: "JFK",
          configuration: { economy: 120, business: 0, first: 0, cargoKg: 0 },
          condition: 1,
          flightHoursTotal: 0,
          flightHoursSinceCheck: 0,
          purchaseType: "buy",
          purchasedAtTick: 0,
          birthTick: 0,
          purchasePrice: 100000,
          flight: null,
        },
      ],
      routes: [
        {
          id: "route-1",
          originIata: "JFK",
          destinationIata: "LAX",
          airlinePubkey: "pub",
          distanceKm: 500,
          assignedAircraftIds: [],
          fareEconomy: 200,
          fareBusiness: 400,
          fareFirst: 800,
          status: "active",
        },
      ],
      timeline: [],
      isViewingOther: false,
    });
    mockUseEngineStore.mockReturnValue({ tick: 0, tickProgress: 0 });

    render(<FleetManager />);

    expect(screen.getByText(/92% Healthy/)).toBeInTheDocument();
  });

  it("renders two fleet cards per row on large screens", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === `(min-width: ${FLEET_TWO_COLUMN_BREAKPOINT}px)`,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList,
    );

    mockUseAirlineStore.mockReturnValue({
      sellAircraft: vi.fn(),
      buyoutAircraft: vi.fn(),
      assignAircraftToRoute: vi.fn(),
      listAircraft: vi.fn(),
      cancelListing: vi.fn(),
      ferryAircraft: vi.fn(),
    });
    mockUseActiveAirline.mockReturnValue({
      airline: { hubs: ["JFK"] },
      fleet: [
        {
          id: "ac-1",
          name: "Test Jet 1",
          modelId: "a320neo",
          status: "idle",
          assignedRouteId: null,
          baseAirportIata: "JFK",
          configuration: { economy: 120, business: 0, first: 0, cargoKg: 0 },
          condition: 1,
          flightHoursTotal: 0,
          flightHoursSinceCheck: 0,
          purchaseType: "buy",
          purchasedAtTick: 0,
          birthTick: 0,
          purchasePrice: 100000,
          flight: null,
        },
        {
          id: "ac-2",
          name: "Test Jet 2",
          modelId: "a320neo",
          status: "idle",
          assignedRouteId: null,
          baseAirportIata: "JFK",
          configuration: { economy: 120, business: 0, first: 0, cargoKg: 0 },
          condition: 1,
          flightHoursTotal: 0,
          flightHoursSinceCheck: 0,
          purchaseType: "buy",
          purchasedAtTick: 0,
          birthTick: 0,
          purchasePrice: 100000,
          flight: null,
        },
      ],
      routes: [],
      timeline: [],
      isViewingOther: false,
    });
    mockUseEngineStore.mockReturnValue({ tick: 0, tickProgress: 0 });

    render(<FleetManager />);
    const jet1Heading = screen.getByRole("heading", { name: "Test Jet 1" });
    const jet2Heading = screen.getByRole("heading", { name: "Test Jet 2" });
    const jet1Row = jet1Heading.closest('[data-testid="fleet-row"]');
    const jet2Row = jet2Heading.closest('[data-testid="fleet-row"]');
    const rowGrid = jet1Row?.querySelector("div.grid");

    expect(jet1Row).toBeTruthy();
    expect(jet2Row).toBeTruthy();
    expect(jet1Row).toBe(jet2Row);
    expect(rowGrid).toHaveClass("grid-cols-2");
  });

  it("renders shared catalog images in the purchase aircraft dealer", () => {
    mockVirtualItems = [];
    mockUseAirlineStore.mockReturnValue({
      airline: { tier: 2, corporateBalance: 500000000, hubs: ["JFK"] },
      fleet: [],
      purchaseAircraft: vi.fn(),
      purchaseUsedAircraft: vi.fn(),
      sellAircraft: vi.fn(),
      buyoutAircraft: vi.fn(),
      assignAircraftToRoute: vi.fn(),
      listAircraft: vi.fn(),
      cancelListing: vi.fn(),
      ferryAircraft: vi.fn(),
    });
    mockUseActiveAirline.mockReturnValue({
      airline: { hubs: ["JFK"] },
      fleet: [],
      routes: [],
      timeline: [],
      isViewingOther: false,
    });
    mockUseEngineStore.mockReturnValue({ tick: 0, tickProgress: 0 });

    render(<FleetManager />);

    fireEvent.click(screen.getAllByRole("button", { name: "Open Global Marketplace" })[0]);

    expect(screen.getByText("Factory New")).toBeInTheDocument();
    expect(screen.getByTestId("catalog-image-atr72-600")).toBeInTheDocument();
  });
});
