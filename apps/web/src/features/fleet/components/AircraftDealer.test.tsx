import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AircraftDealer } from "./AircraftDealer";

vi.mock("@/shared/components/layout/panelScrollContext", () => ({
  usePanelScrollRef: () => ({ current: null }),
}));

const { testAircraft, mockUseAirlineStore } = vi.hoisted(() => ({
  testAircraft: {
    id: "testliner-900",
    manufacturer: "TestCo",
    name: "Testliner 900",
    type: "narrowbody" as const,
    generation: "modern" as const,
    rangeKm: 5400,
    speedKmh: 880,
    maxTakeoffWeight: 79000,
    capacity: {
      economy: 150,
      business: 18,
      first: 8,
      cargoKg: 9000,
    },
    fuelBurnKgPerHour: 2700,
    fuelBurnKgPerKm: 3,
    blockHoursPerDay: 12,
    turnaroundTimeMinutes: 45,
    price: 98000000,
    monthlyLease: 950000,
    casm: 9,
    maintCostPerHour: 850,
    crewRequired: {
      cockpit: 2,
      cabin: 5,
    },
    economicLifeYears: 22,
    residualValuePercent: 20,
    unlockTier: 1,
    familyId: "testliner",
    deliveryTimeTicks: 2400,
  },
  mockUseAirlineStore: vi.fn(),
}));

type Selector<T> = (state: T) => unknown;
type AirlineStoreState = {
  airline: { hubs: string[]; tier: number; corporateBalance: number } | null;
  fleet: unknown[];
  purchaseAircraft: () => Promise<void>;
  purchaseUsedAircraft: () => Promise<void>;
};

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [{ key: "row-0", index: 0, start: 0, size: 430 }],
    getTotalSize: () => 430,
    options: { scrollMargin: 0 },
  }),
}));

vi.mock("@acars/store", () => ({
  useAirlineStore: (selector: Selector<AirlineStoreState>) =>
    selector(mockUseAirlineStore() as AirlineStoreState),
}));

vi.mock("@acars/data", () => ({
  aircraftModels: [testAircraft],
  getAircraftById: vi.fn(() => testAircraft),
}));

vi.mock("@acars/nostr", () => ({
  loadMarketplace: vi.fn(),
}));

vi.mock("@/shared/lib/useConfirm", () => ({
  useConfirm: () => vi.fn(async () => true),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./CatalogImage", () => ({
  CatalogImage: ({ model }: { model: { id: string; name: string } }) => (
    <div data-testid={`catalog-image-${model.id}`}>{model.name} catalog image</div>
  ),
}));

describe("AircraftDealer", () => {
  beforeEach(() => {
    mockUseAirlineStore.mockReturnValue({
      airline: { hubs: ["JFK"], tier: 3, corporateBalance: 1_000_000_000 },
      fleet: [],
      purchaseAircraft: vi.fn(async () => {}),
      purchaseUsedAircraft: vi.fn(async () => {}),
    });
  });

  it("renders richer factory card specs for aircraft comparison", () => {
    render(<AircraftDealer />);

    expect(screen.getByText("Testliner 900")).toBeInTheDocument();
    expect(screen.getByText("Speed")).toBeInTheDocument();
    expect(screen.getByText("880 km/h")).toBeInTheDocument();
    expect(screen.getByText("Cargo Capacity")).toBeInTheDocument();
    expect(screen.getByText("9,000 kg")).toBeInTheDocument();
    expect(screen.getByText("Fuel Burn")).toBeInTheDocument();
    expect(screen.getByText("2,700 kg/h")).toBeInTheDocument();
  });

  it("shows the expanded spec grid in the purchase modal", () => {
    render(<AircraftDealer />);

    fireEvent.click(screen.getAllByRole("button", { name: "Configure & Buy" })[0]);

    expect(screen.getByText("Aircraft Identity")).toBeInTheDocument();
    expect(screen.getAllByText("Cargo Capacity").length).toBeGreaterThan(1);
    expect(screen.getAllByText("9,000 kg").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Fuel Burn").length).toBeGreaterThan(1);
    expect(screen.getAllByText("2,700 kg/h").length).toBeGreaterThan(1);
  });
});
