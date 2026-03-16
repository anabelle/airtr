import { fp, fpDiv, fpFormat, fpMul, fpSub, TICKS_PER_HOUR } from "@acars/core";
import { getAircraftById } from "@acars/data";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { MOBILE_BOTTOM_NAV_BOTTOM_CLASS } from "@/shared/components/layout/mobileLayout";
import { AircraftInfoPanel, RouteTab } from "./AircraftInfoPanel";

type Selector<T> = (state: T) => unknown;

type AirlineStoreState = {
  airline: {
    ceoPubkey: string;
    name: string;
    icaoCode: string;
    livery?: { primary?: string };
  } | null;
  fleet: unknown[];
  routesByOwner: Map<string, unknown[]>;
  competitors: Map<string, unknown>;
  timeline: unknown[];
};

type EngineStoreState = {
  tick: number;
  tickProgress: number;
};

const mockUseAirlineStore = vi.fn();
const mockUseEngineStore = vi.fn();
const mockNavigate = vi.fn();
const mockUseSearch = vi.fn();

vi.mock("@acars/store", () => ({
  useAirlineStore: (selector?: Selector<AirlineStoreState>) => {
    const state = mockUseAirlineStore() as AirlineStoreState;
    return selector ? selector(state) : state;
  },
  useEngineStore: (selector: Selector<EngineStoreState>) =>
    selector(mockUseEngineStore() as EngineStoreState),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => mockUseSearch(),
}));

vi.mock("@/features/fleet/components/AircraftLiveryImage", () => ({
  AircraftLiveryImage: () => <div data-testid="aircraft-livery-image" />,
}));

vi.mock("@acars/map", () => ({
  FAMILY_ICONS: {
    a320: { body: "<svg></svg>" },
    a320neo: { body: "<svg></svg>" },
  },
}));

describe("AircraftInfoPanel", () => {
  const model = getAircraftById("a320neo");

  if (!model) {
    throw new Error("Expected a320neo model fixture to exist");
  }

  const aircraft = {
    id: "ac-1",
    ownerPubkey: "owner-1",
    name: "Aurora 101",
    modelId: "a320neo",
    status: "idle" as const,
    assignedRouteId: "route-1",
    baseAirportIata: "JFK",
    configuration: { economy: 120, business: 16, first: 4, cargoKg: 0 },
    condition: 0.94,
    flightHoursTotal: 2150,
    flightHoursSinceCheck: 120,
    purchaseType: "lease" as const,
    purchasedAtTick: 0,
    birthTick: 0,
    purchasePrice: fp(95000000),
    lastKnownLoadFactor: 0.78,
    flight: null,
  };

  const route = {
    id: "route-1",
    airlinePubkey: "owner-1",
    originIata: "JFK",
    destinationIata: "LAX",
    distanceKm: 3983,
    status: "active" as const,
    assignedAircraftIds: ["ac-1"],
    fareEconomy: fp(180),
    fareBusiness: fp(540),
    fareFirst: fp(920),
  };

  const lastLanding = {
    id: "evt-landing-ac-1-1",
    tick: 1,
    timestamp: 1,
    type: "landing" as const,
    description: "Aurora 101 landed at LAX",
    aircraftId: "ac-1",
    originIata: "JFK",
    destinationIata: "LAX",
    profit: fp(2501),
    details: {
      flightDurationTicks: 1200,
      loadFactor: 0.86,
      passengers: { total: 31, economy: 25, business: 4, first: 2 },
    },
  };

  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseSearch.mockReturnValue({});
    mockUseAirlineStore.mockReturnValue({
      airline: { ceoPubkey: "owner-1", name: "Aurora Air", icaoCode: "AUR" },
      fleet: [aircraft],
      routesByOwner: new Map([["owner-1", [route]]]),
      competitors: new Map(),
      timeline: [lastLanding],
    });
    mockUseEngineStore.mockReturnValue({ tick: 5000, tickProgress: 0.5 });
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it("shows the current seat layout on the info tab", () => {
    render(<AircraftInfoPanel aircraft={aircraft} onClose={vi.fn()} />);

    expect(screen.getByText("Seat Layout")).toBeInTheDocument();
    expect(screen.getByText("Total Seats")).toBeInTheDocument();
    expect(screen.getByText("140")).toBeInTheDocument();
    expect(screen.getByText("Economy")).toBeInTheDocument();
    expect(screen.getByText("Business")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getAllByText("Y120 J16 F4").length).toBeGreaterThan(0);
    expect(screen.getByTestId("aircraft-livery-image")).toBeInTheDocument();
  });

  it("renders route endpoints as proper buttons", () => {
    render(
      <RouteTab
        route={route}
        siblings={[]}
        aircraft={aircraft}
        lastLanding={lastLanding}
        model={model}
      />,
    );

    expect(screen.getAllByRole("button", { name: "JFK" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "LAX" }).length).toBeGreaterThan(0);
  });

  it("shows recent profitability and cabin load details on the route tab", () => {
    const leaseForFlight = fpDiv(fpMul(model.monthlyLease, fp(1200)), fp(30 * 24 * TICKS_PER_HOUR));
    const trueProfit = fpSub(fp(2501), leaseForFlight);

    render(
      <RouteTab
        route={route}
        siblings={[]}
        aircraft={aircraft}
        lastLanding={lastLanding}
        model={model}
      />,
    );

    expect(screen.getByText("Recent Performance")).toBeInTheDocument();
    expect(screen.getByText("Last Flight Outcome")).toBeInTheDocument();
    expect(screen.getByText("True Profit")).toBeInTheDocument();
    expect(screen.getByText(fpFormat(trueProfit, 0))).toBeInTheDocument();
    expect(
      screen.getByText(
        i18n.t("fleet.leaseIncluded", {
          ns: "game",
          amount: fpFormat(leaseForFlight, 0),
        }),
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("86%").length).toBeGreaterThan(0);
    expect(screen.getByText((_, node) => node?.textContent === "31 pax")).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === "Y:25")).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === "J:4")).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === "F:2")).toBeInTheDocument();
  });

  it("hides recent performance when no completed-flight data exists", () => {
    render(
      <RouteTab route={route} siblings={[]} aircraft={aircraft} lastLanding={null} model={model} />,
    );

    expect(screen.queryByText("Recent Performance")).not.toBeInTheDocument();
    expect(screen.queryByText("Last Flight Outcome")).not.toBeInTheDocument();
  });

  it("reserves space above the mobile bottom navigation", () => {
    render(<AircraftInfoPanel aircraft={aircraft} onClose={vi.fn()} />);

    expect(screen.getByLabelText("Close aircraft panel").closest("aside")).toHaveClass(
      MOBILE_BOTTOM_NAV_BOTTOM_CLASS,
    );
  });

  it("uses a more opaque shell background for readability over the light map", () => {
    render(<AircraftInfoPanel aircraft={aircraft} onClose={vi.fn()} />);

    expect(screen.getByLabelText("Close aircraft panel").closest("aside")).toHaveClass(
      "bg-background/96",
    );
  });
});
