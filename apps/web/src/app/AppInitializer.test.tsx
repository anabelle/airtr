import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppInitializer } from "./AppInitializer";

const mockUseAirlineStore = vi.hoisted(() => vi.fn());
const mockUseEngineStore = vi.hoisted(() => vi.fn());
const mockFindPreferredHub = vi.hoisted(() => vi.fn());

type Selector<T> = (state: T) => unknown;
type AirlineStoreState = {
  airline: unknown;
  identityStatus: string;
  initializeIdentity: () => void;
  competitors: Map<string, unknown>;
};
type EngineStoreState = {
  homeAirport: unknown;
  userLocation: {
    latitude: number;
    longitude: number;
    source: "gps" | "timezone" | "manual";
  } | null;
  setHub: (...args: unknown[]) => void;
  startEngine: () => void;
};

vi.mock("@acars/store", () => {
  const useAirlineStore = Object.assign(
    (selector?: Selector<AirlineStoreState>) => {
      const state = mockUseAirlineStore() as AirlineStoreState;
      return selector ? selector(state) : state;
    },
    { getState: () => mockUseAirlineStore() as AirlineStoreState },
  );
  const useEngineStore = Object.assign(
    (selector: Selector<EngineStoreState>) => selector(mockUseEngineStore() as EngineStoreState),
    { getState: () => mockUseEngineStore() as EngineStoreState },
  );
  return {
    useAirlineStore,
    useEngineStore,
  };
});

vi.mock("@acars/data", () => {
  return {
    airports: [
      {
        iata: "JFK",
        latitude: 0,
        longitude: 0,
        timezone: "UTC",
        city: "City",
        population: 1,
      },
      {
        iata: "EWR",
        latitude: 1,
        longitude: 1,
        timezone: "UTC",
        city: "City",
        population: 1,
      },
    ],
    findPreferredHub: mockFindPreferredHub,
  };
});

describe("AppInitializer", () => {
  const originalGeolocation = navigator.geolocation;
  const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  let airlineState: AirlineStoreState;
  let engineState: EngineStoreState;

  beforeEach(() => {
    airlineState = {
      airline: null,
      identityStatus: "ready",
      initializeIdentity: vi.fn(),
      competitors: new Map(),
    };
    engineState = {
      homeAirport: null,
      userLocation: null,
      setHub: vi.fn(),
      startEngine: vi.fn(),
    };
    mockUseAirlineStore.mockImplementation(() => airlineState);
    mockUseEngineStore.mockImplementation(() => engineState);
    mockFindPreferredHub.mockReturnValue({
      iata: "JFK",
      latitude: 0,
      longitude: 0,
    });
    Intl.DateTimeFormat.prototype.resolvedOptions = vi.fn(() => ({
      locale: "en-US",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Etc/GMT+5",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    })) as typeof Intl.DateTimeFormat.prototype.resolvedOptions;
    (navigator as unknown as { geolocation?: Geolocation }).geolocation = undefined;
  });

  afterEach(() => {
    (navigator as unknown as { geolocation?: Geolocation }).geolocation = originalGeolocation;
    Intl.DateTimeFormat.prototype.resolvedOptions = originalResolvedOptions;
    vi.restoreAllMocks();
  });

  it("initializes identity on mount", () => {
    const initializeIdentity = vi.fn();
    airlineState.initializeIdentity = initializeIdentity;

    (navigator as unknown as { geolocation?: Geolocation }).geolocation = {
      getCurrentPosition: vi.fn(),
      clearWatch: vi.fn(),
      watchPosition: vi.fn(),
    } as Geolocation;

    render(
      <AppInitializer>
        <div>App</div>
      </AppInitializer>,
    );

    expect(initializeIdentity).toHaveBeenCalled();
  });

  it("falls back to timezone when geolocation unavailable", () => {
    const setHub = vi.fn();
    const startEngine = vi.fn();
    engineState.setHub = setHub;
    engineState.startEngine = startEngine;
    delete (navigator as unknown as { geolocation?: Geolocation }).geolocation;

    render(
      <AppInitializer>
        <div>App</div>
      </AppInitializer>,
    );

    expect(setHub).toHaveBeenCalled();
    expect(startEngine).toHaveBeenCalled();
  });

  it("avoids occupied timezone hubs when competitor hubs are already known", () => {
    const setHub = vi.fn();
    const startEngine = vi.fn();
    engineState.setHub = setHub;
    engineState.startEngine = startEngine;
    airlineState.competitors = new Map([["comp-1", { hubs: ["JFK"] }]]);
    Intl.DateTimeFormat.prototype.resolvedOptions = vi.fn(() => ({
      locale: "en-US",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "UTC",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    })) as typeof Intl.DateTimeFormat.prototype.resolvedOptions;
    delete (navigator as unknown as { geolocation?: Geolocation }).geolocation;

    render(
      <AppInitializer>
        <div>App</div>
      </AppInitializer>,
    );

    expect(setHub).toHaveBeenCalledWith(
      expect.objectContaining({ iata: "EWR" }),
      { latitude: 1, longitude: 1, source: "timezone" },
      "timezone (UTC)",
    );
    expect(startEngine).toHaveBeenCalled();
  });

  it("re-evaluates an occupied suggested hub once competitors and location are available", () => {
    const setHub = vi.fn();
    engineState.homeAirport = { iata: "JFK" };
    engineState.userLocation = null;
    engineState.setHub = setHub;
    airlineState.competitors = new Map([["comp-1", { hubs: ["JFK"] }]]);
    mockFindPreferredHub.mockReturnValue({
      iata: "EWR",
      latitude: 1,
      longitude: 1,
    });

    const view = render(
      <AppInitializer>
        <div>App</div>
      </AppInitializer>,
    );

    expect(setHub).not.toHaveBeenCalledWith(
      expect.objectContaining({ iata: "EWR" }),
      expect.anything(),
      "auto-distributed",
    );

    engineState.userLocation = {
      latitude: 40.6,
      longitude: -73.7,
      source: "gps",
    };
    view.rerender(
      <AppInitializer>
        <div>App</div>
      </AppInitializer>,
    );

    const lastFindCall =
      mockFindPreferredHub.mock.calls[mockFindPreferredHub.mock.calls.length - 1];
    expect(lastFindCall?.[0]).toBe(40.6);
    expect(lastFindCall?.[1]).toBe(-73.7);
    expect(lastFindCall?.[2]).toBeUndefined();
    expect(lastFindCall?.[3]).toBeInstanceOf(Set);
    expect((lastFindCall?.[3] as Set<string>).has("JFK")).toBe(true);
    expect(setHub).toHaveBeenCalledWith(
      expect.objectContaining({ iata: "EWR" }),
      { latitude: 40.6, longitude: -73.7, source: "gps" },
      "auto-distributed",
    );
  });

  it("does not overwrite a manual hub while geolocation is still in flight", () => {
    const setHub = vi.fn();
    const startEngine = vi.fn();
    let onSuccess: ((pos: GeolocationPosition) => void) | undefined;

    engineState.setHub = setHub;
    engineState.startEngine = startEngine;
    (navigator as unknown as { geolocation?: Geolocation }).geolocation = {
      getCurrentPosition: vi.fn((success: PositionCallback) => {
        onSuccess = success;
      }),
      clearWatch: vi.fn(),
      watchPosition: vi.fn(),
    } as Geolocation;

    render(
      <AppInitializer>
        <div>App</div>
      </AppInitializer>,
    );

    engineState.userLocation = {
      latitude: 10,
      longitude: 20,
      source: "manual",
    };

    onSuccess?.({
      coords: {
        latitude: 40.6,
        longitude: -73.7,
      },
    } as GeolocationPosition);

    expect(setHub).not.toHaveBeenCalledWith(
      expect.objectContaining({ iata: "JFK" }),
      expect.objectContaining({ source: "gps" }),
      "GPS",
    );
    expect(startEngine).toHaveBeenCalled();
  });
});
