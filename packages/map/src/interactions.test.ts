import { describe, expect, it, vi } from "vitest";
import {
  AIRPORT_INTERACTION_RADIUS_PX,
  buildHitbox,
  FLIGHT_INTERACTION_LAYERS,
  resolveMapSelection,
} from "./interactions.js";

describe("map interactions", () => {
  it("builds a square airport hitbox around the pointer", () => {
    expect(buildHitbox({ x: 50, y: 75 }, AIRPORT_INTERACTION_RADIUS_PX)).toEqual([
      [26, 51],
      [74, 99],
    ]);
  });

  it("prioritizes airports over overlapping aircraft and uses the expanded airport hitbox", () => {
    const queryRenderedFeatures = vi.fn().mockReturnValueOnce([
      {
        properties: {
          iata: "JFK",
          icao: "KJFK",
          name: "John F Kennedy",
          city: "New York",
          country: "US",
          latitude: 40.6413,
          longitude: -73.7781,
          population: 1,
          gdpPerCapita: 1,
          altitude: 13,
          timezone: "America/New_York",
          tags: [],
          id: "1",
        },
      },
    ]);

    expect(resolveMapSelection({ x: 100, y: 200 }, queryRenderedFeatures)).toEqual({
      type: "airport",
      airport: expect.objectContaining({ iata: "JFK" }),
    });
    expect(queryRenderedFeatures).toHaveBeenCalledWith(
      [
        [100 - AIRPORT_INTERACTION_RADIUS_PX, 200 - AIRPORT_INTERACTION_RADIUS_PX],
        [100 + AIRPORT_INTERACTION_RADIUS_PX, 200 + AIRPORT_INTERACTION_RADIUS_PX],
      ],
      { layers: ["airports-layer"] },
    );
    expect(queryRenderedFeatures).toHaveBeenCalledTimes(1);
  });

  it("falls back to aircraft selection when no airport is in range", () => {
    const queryRenderedFeatures = vi
      .fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ properties: { id: "ac-456" } }]);

    expect(resolveMapSelection({ x: 10, y: 20 }, queryRenderedFeatures)).toEqual({
      type: "aircraft",
      aircraftId: "ac-456",
    });
    expect(queryRenderedFeatures).toHaveBeenNthCalledWith(2, [10, 20], {
      layers: FLIGHT_INTERACTION_LAYERS,
    });
  });

  it("returns null when no interactive feature is found", () => {
    const queryRenderedFeatures = vi.fn().mockReturnValue([]);

    expect(resolveMapSelection({ x: 0, y: 0 }, queryRenderedFeatures)).toBeNull();
    expect(queryRenderedFeatures).toHaveBeenCalledTimes(2);
  });

  it("ignores malformed airport properties and falls back to aircraft selection", () => {
    const queryRenderedFeatures = vi
      .fn()
      .mockReturnValueOnce([{ properties: { iata: "JFK" } }])
      .mockReturnValueOnce([{ properties: { id: "ac-789" } }]);

    expect(resolveMapSelection({ x: 4, y: 8 }, queryRenderedFeatures)).toEqual({
      type: "aircraft",
      aircraftId: "ac-789",
    });
  });

  it("selects airports when tags are serialized as a string (MapLibre queryRenderedFeatures behavior)", () => {
    const queryRenderedFeatures = vi.fn().mockReturnValueOnce([
      {
        properties: {
          iata: "LAX",
          icao: "KLAX",
          name: "Los Angeles International",
          city: "Los Angeles",
          country: "US",
          latitude: 33.9425,
          longitude: -118.408,
          population: 3_979_576,
          gdpPerCapita: 65_000,
          altitude: 126,
          timezone: "America/Los_Angeles",
          tags: '["business"]',
          id: "3484",
        },
      },
    ]);

    expect(resolveMapSelection({ x: 50, y: 50 }, queryRenderedFeatures)).toEqual({
      type: "airport",
      airport: expect.objectContaining({ iata: "LAX" }),
    });
  });
});
