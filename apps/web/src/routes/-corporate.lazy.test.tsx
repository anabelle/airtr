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
});
