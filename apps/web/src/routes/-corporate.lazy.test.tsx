import { fp } from "@acars/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/components/layout/PanelLayout", () => {
  return {
    PanelLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("@/features/airline/components/Timeline", () => {
  return {
    AirlineTimeline: () => <div data-testid="full-timeline">Timeline</div>,
  };
});

const { routePerformanceMock, useVirtualizerMock } = vi.hoisted(() => ({
  routePerformanceMock: [] as Array<{
    routeId: string;
    label: string;
    fleetCount: number;
    avgLoadFactor: number;
    profitPerHour: number;
  }>,
  useVirtualizerMock: vi.fn(),
}));

vi.mock("@tanstack/react-virtual", () => {
  return {
    useVirtualizer: (args: { count: number }) => {
      useVirtualizerMock(args);
      return {
        getTotalSize: () => args.count * 44,
        getVirtualItems: () =>
          Array.from({ length: args.count }, (_, index) => ({
            index,
            size: 44,
            start: index * 44,
          })),
      };
    },
  };
});

vi.mock("@/features/corporate/hooks/useRoutePerformance", () => {
  return {
    RECENT_FLIGHT_COUNT: 10,
    useRoutePerformance: () => routePerformanceMock,
  };
});

const mockAirline = {
  hubs: ["JFK"],
  corporateBalance: 0,
  name: "Test Air",
  icaoCode: "TST",
  callsign: "TEST",
  livery: { primary: "#111111", secondary: "#222222", accent: "#333333" },
  status: "private",
  tier: 1,
  brandScore: 0.5,
  cumulativeRevenue: fp(0),
};

const mockTimeline = [
  {
    id: "evt-1",
    tick: 100,
    timestamp: Date.now(),
    type: "landing" as const,
    description: "Flight landed",
    originIata: "JFK",
    destinationIata: "LAX",
    revenue: 50000,
    cost: 30000,
    profit: 20000,
    details: { loadFactor: 0.82 },
  },
];

vi.mock("@acars/store", () => {
  return {
    useAirlineStore: (selector?: (s: unknown) => unknown) => {
      const state = {
        airline: mockAirline,
        modifyHubs: vi.fn(),
        initializeIdentity: vi.fn(),
        isLoading: false,
        viewedPubkey: null,
      };
      return selector ? selector(state) : state;
    },
    useActiveAirline: () => ({
      airline: mockAirline,
      timeline: mockTimeline,
      routes: [],
      fleet: [],
      isViewingOther: false,
    }),
    useEngineStore: (selector?: (s: unknown) => unknown) => {
      const state = { homeAirport: { iata: "JFK" }, tick: 200 };
      return selector ? selector(state) : state;
    },
  };
});

import CorporateRoute from "./-corporate.lazy";

describe("Corporate route", () => {
  beforeEach(() => {
    cleanup();
    routePerformanceMock.length = 0;
    useVirtualizerMock.mockClear();
  });

  it("renders financial pulse with corporate balance", () => {
    render(<CorporateRoute />);
    expect(screen.getByText("Corporate Balance")).toBeInTheDocument();
  });

  it("renders company profile with airline name and ICAO", () => {
    render(<CorporateRoute />);
    expect(screen.getByRole("heading", { name: "Test Air" })).toBeInTheDocument();
    expect(screen.getByText(/TST/)).toBeInTheDocument();
    expect(screen.getByText(/TEST/)).toBeInTheDocument();
  });

  it("renders status badge", () => {
    render(<CorporateRoute />);
    expect(screen.getAllByText("private").length).toBeGreaterThanOrEqual(1);
  });

  it("renders tier info", () => {
    render(<CorporateRoute />);
    expect(screen.getByText("Regional Startup")).toBeInTheDocument();
  });

  it("renders brand score bar", () => {
    render(<CorporateRoute />);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("renders hub operations", () => {
    render(<CorporateRoute />);
    expect(screen.getByText("JFK")).toBeInTheDocument();
  });

  it("renders livery strip", () => {
    render(<CorporateRoute />);
    expect(screen.getByText("Livery")).toBeInTheDocument();
  });

  it("renders activity log in collapsed state", () => {
    render(<CorporateRoute />);
    expect(screen.getByText("Activity Log")).toBeInTheDocument();
    expect(screen.getByText("View All")).toBeInTheDocument();
    expect(screen.queryByTestId("full-timeline")).not.toBeInTheDocument();
  });

  it("shows flight revenue rate when flights exist", () => {
    render(<CorporateRoute />);
    expect(screen.getByText("Flight Revenue Rate")).toBeInTheDocument();
  });

  it("shows billing cycle indicator", () => {
    render(<CorporateRoute />);
    expect(screen.getByText("Billing Cycle")).toBeInTheDocument();
    expect(screen.getByLabelText("Billing cycle progress")).toBeInTheDocument();
  });

  it("shows low-sample warning when financial sample is small", () => {
    render(<CorporateRoute />);
    expect(screen.getByText(/low financial sample/)).toBeInTheDocument();
  });

  it("expands activity log to show full timeline", async () => {
    const user = userEvent.setup();
    render(<CorporateRoute />);
    await user.click(screen.getByText("View All"));
    expect(screen.getByTestId("full-timeline")).toBeInTheDocument();
  });

  it("renders sorted route performance without truncating to six routes", () => {
    routePerformanceMock.push(
      {
        routeId: "r1",
        label: "A",
        fleetCount: 1,
        avgLoadFactor: 0.51,
        profitPerHour: fp(10),
      },
      {
        routeId: "r2",
        label: "B",
        fleetCount: 1,
        avgLoadFactor: 0.52,
        profitPerHour: fp(20),
      },
      {
        routeId: "r3",
        label: "C",
        fleetCount: 1,
        avgLoadFactor: 0.53,
        profitPerHour: fp(30),
      },
      {
        routeId: "r4",
        label: "D",
        fleetCount: 1,
        avgLoadFactor: 0.54,
        profitPerHour: fp(40),
      },
      {
        routeId: "r5",
        label: "E",
        fleetCount: 1,
        avgLoadFactor: 0.55,
        profitPerHour: fp(50),
      },
      {
        routeId: "r6",
        label: "F",
        fleetCount: 1,
        avgLoadFactor: 0.56,
        profitPerHour: fp(60),
      },
      {
        routeId: "r7",
        label: "G",
        fleetCount: 1,
        avgLoadFactor: 0.57,
        profitPerHour: fp(70),
      },
    );

    render(<CorporateRoute />);

    expect(useVirtualizerMock).toHaveBeenCalledWith(expect.objectContaining({ count: 7 }));
    expect(screen.getAllByText("1 aircraft")).toHaveLength(7);
    expect(screen.getByText("G")).toBeInTheDocument();
  });
});
