import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/* ——— mocks ——— */

const mockNavigate = vi.fn();
const mockSetPermalinkAirport = vi.fn();
let mockPermalinkIata: string | null = null;

vi.mock("@acars/store", () => ({
  useEngineStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      permalinkAirportIata: mockPermalinkIata,
      setPermalinkAirport: mockSetPermalinkAirport,
      homeAirport: { iata: "ATL", name: "Hartsfield-Jackson Atlanta International Airport" },
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ iata: mockIataParam }),
  useNavigate: () => mockNavigate,
}));

vi.mock("@acars/data", () => ({
  airports: [
    {
      iata: "JFK",
      icao: "KJFK",
      name: "John F Kennedy International Airport",
      city: "New York",
      country: "US",
      latitude: 40.6,
      longitude: -73.7,
      altitude: 13,
      timezone: "America/New_York",
      population: 8800000,
      gdpPerCapita: 84534,
      tags: [],
      id: "1",
    },
    {
      iata: "LAX",
      icao: "KLAX",
      name: "Los Angeles International Airport",
      city: "Los Angeles",
      country: "US",
      latitude: 33.9,
      longitude: -118.4,
      altitude: 126,
      timezone: "America/Los_Angeles",
      population: 3900000,
      gdpPerCapita: 84534,
      tags: [],
      id: "2",
    },
  ],
}));

let mockIataParam = "JFK";

import AirportPermalinkPage from "./-airport.$iata.lazy";

describe("Airport permalink route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermalinkIata = null;
    mockIataParam = "JFK";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets permalink airport on mount for valid IATA", () => {
    mockIataParam = "JFK";
    render(<AirportPermalinkPage />);

    expect(mockSetPermalinkAirport).toHaveBeenCalledWith("JFK");
  });

  it("normalizes lowercase IATA to uppercase", () => {
    mockIataParam = "jfk";
    render(<AirportPermalinkPage />);

    expect(mockSetPermalinkAirport).toHaveBeenCalledWith("JFK");
  });

  it("redirects to / for invalid IATA", () => {
    mockIataParam = "ZZZZ";
    render(<AirportPermalinkPage />);

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
    expect(mockSetPermalinkAirport).not.toHaveBeenCalled();
  });

  it("renders null (no visible output) for valid IATA", () => {
    mockIataParam = "LAX";
    const { container } = render(<AirportPermalinkPage />);

    expect(container.innerHTML).toBe("");
  });

  it("clears permalink airport on unmount", () => {
    mockIataParam = "JFK";
    const { unmount } = render(<AirportPermalinkPage />);

    // Clear mock calls from mount
    mockSetPermalinkAirport.mockClear();

    unmount();

    expect(mockSetPermalinkAirport).toHaveBeenCalledWith(null);
  });
});
