import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetPermalinkAirport = vi.fn();
const mockSetPermalinkAircraft = vi.fn();

vi.mock("@acars/store", () => ({
  useEngineStore: {
    getState: () => ({
      setPermalinkAirport: mockSetPermalinkAirport,
      setPermalinkAircraft: mockSetPermalinkAircraft,
    }),
  },
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
  ],
}));

import { getDetailReturnTo, navigateToAircraft, navigateToAirport } from "./permalinkNavigation";

describe("permalinkNavigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/network?tab=active");
  });

  it("stores the previous workspace in airport detail links", () => {
    navigateToAirport("jfk", { airportTab: "flights" });

    expect(mockSetPermalinkAirport).toHaveBeenCalledWith("JFK");
    expect(window.location.pathname).toBe("/airport/JFK");
    expect(window.location.search).toBe("?airportTab=flights&returnTo=%2Fnetwork%3Ftab%3Dactive");
  });

  it("keeps the original return path when drilling deeper", () => {
    window.history.replaceState(
      null,
      "",
      "/airport/JFK?airportTab=flights&returnTo=%2Fnetwork%3Ftab%3Dactive",
    );

    navigateToAircraft("ship-1");

    expect(mockSetPermalinkAircraft).toHaveBeenCalledWith("ship-1");
    expect(window.location.search).toBe("?returnTo=%2Fnetwork%3Ftab%3Dactive");
    expect(getDetailReturnTo()).toBe("/network?tab=active");
  });
});
