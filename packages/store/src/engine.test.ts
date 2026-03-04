import { GENESIS_TIME, TICK_DURATION } from "@acars/core";
import { airports as AIRPORTS } from "@acars/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEngineStore } from "./engine.js";

describe("engine store", () => {
  const initialState = useEngineStore.getState();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    useEngineStore.setState(initialState, true);
    vi.useRealTimers();
  });

  it("syncTick updates tick and progress from system time", () => {
    vi.setSystemTime(GENESIS_TIME + 2.5 * TICK_DURATION);
    useEngineStore.getState().syncTick();
    const { tick, tickProgress } = useEngineStore.getState();
    expect(tick).toBe(2);
    expect(tickProgress).toBeCloseTo(0.5, 5);
  });

  it("setHub assigns home airport and generates routes", () => {
    vi.setSystemTime(GENESIS_TIME + 10 * TICK_DURATION);
    const hub = AIRPORTS[0];
    useEngineStore.getState().setHub(
      hub,
      {
        latitude: hub.latitude,
        longitude: hub.longitude,
        source: "manual",
      },
      "manual",
    );

    const { homeAirport, routes } = useEngineStore.getState();
    expect(homeAirport?.iata).toBe(hub.iata);
    expect(routes.length).toBeGreaterThanOrEqual(4);
  });

  it("startEngine and stopEngine toggle running state", () => {
    const store = useEngineStore.getState();
    store.startEngine();
    expect(useEngineStore.getState().isEngineRunning).toBe(true);

    store.stopEngine();
    expect(useEngineStore.getState().isEngineRunning).toBe(false);
  });

  it("startEngine aligns timeout to next tick boundary", () => {
    vi.setSystemTime(GENESIS_TIME + TICK_DURATION + 1200);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    try {
      useEngineStore.getState().startEngine();

      expect(timeoutSpy).toHaveBeenCalled();
      expect(Number(timeoutSpy.mock.calls[0]?.[1])).toBeGreaterThan(TICK_DURATION - 1200);
      expect(Number(timeoutSpy.mock.calls[0]?.[1])).toBeLessThanOrEqual(TICK_DURATION - 1200 + 100);
    } finally {
      useEngineStore.getState().stopEngine();
      timeoutSpy.mockRestore();
    }
  });

  it("tickProgress continues updating while engine runs", () => {
    vi.setSystemTime(GENESIS_TIME + TICK_DURATION + 1000);

    try {
      useEngineStore.getState().startEngine();
      const initialProgress = useEngineStore.getState().tickProgress;

      vi.advanceTimersByTime(1000);

      expect(useEngineStore.getState().tickProgress).not.toBe(initialProgress);
    } finally {
      useEngineStore.getState().stopEngine();
    }
  });

  it("permalinkAirportIata defaults to null", () => {
    expect(useEngineStore.getState().permalinkAirportIata).toBeNull();
  });

  it("setPermalinkAirport sets the IATA code", () => {
    useEngineStore.getState().setPermalinkAirport("JFK");
    expect(useEngineStore.getState().permalinkAirportIata).toBe("JFK");
  });

  it("setPermalinkAirport can clear back to null", () => {
    useEngineStore.getState().setPermalinkAirport("LAX");
    expect(useEngineStore.getState().permalinkAirportIata).toBe("LAX");

    useEngineStore.getState().setPermalinkAirport(null);
    expect(useEngineStore.getState().permalinkAirportIata).toBeNull();
  });

  it("permalinkAircraftId defaults to null", () => {
    expect(useEngineStore.getState().permalinkAircraftId).toBeNull();
  });

  it("setPermalinkAircraft sets the aircraft id", () => {
    useEngineStore.getState().setPermalinkAircraft("abc-123");
    expect(useEngineStore.getState().permalinkAircraftId).toBe("abc-123");
  });

  it("setPermalinkAircraft can clear back to null", () => {
    useEngineStore.getState().setPermalinkAircraft("xyz-456");
    expect(useEngineStore.getState().permalinkAircraftId).toBe("xyz-456");

    useEngineStore.getState().setPermalinkAircraft(null);
    expect(useEngineStore.getState().permalinkAircraftId).toBeNull();
  });
});
