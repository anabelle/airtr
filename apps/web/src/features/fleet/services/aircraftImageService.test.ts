import type { Airport } from "@acars/core";
import { getAircraftById } from "@acars/data";
import { describe, expect, it } from "vitest";
import {
  buildCatalogPrompt,
  buildSceneDescriptor,
  computeCatalogPromptHash,
  deriveWeather,
  fnv1aHash,
  isValidAircraftImagePrompt,
  SCENE_VERSION,
} from "./aircraftImageService";

// ---------------------------------------------------------------------------
// Helpers: minimal Airport stubs
// ---------------------------------------------------------------------------

function makeAirport(overrides: Partial<Airport> = {}): Airport {
  return {
    id: "1",
    name: "Test Airport",
    iata: "TST",
    icao: "KTST",
    latitude: 40.0,
    longitude: -74.0,
    altitude: 100,
    timezone: "America/New_York",
    country: "US",
    city: "Test City",
    population: 1_000_000,
    gdpPerCapita: 50_000,
    tags: ["business"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// fnv1aHash
// ---------------------------------------------------------------------------

describe("fnv1aHash", () => {
  it("returns a stable unsigned 32-bit integer for a given string", () => {
    const a = fnv1aHash("aircraft-001");
    const b = fnv1aHash("aircraft-001");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
  });

  it("produces different hashes for different inputs", () => {
    const a = fnv1aHash("aircraft-001");
    const b = fnv1aHash("aircraft-002");
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// buildSceneDescriptor
// ---------------------------------------------------------------------------

describe("buildSceneDescriptor", () => {
  it("returns deterministic scene for the same aircraft ID", () => {
    const a = buildSceneDescriptor("ac-abc123", "JFK");
    const b = buildSceneDescriptor("ac-abc123", "JFK");
    expect(a).toEqual(b);
  });

  it("returns different scenes for different aircraft IDs", () => {
    const a = buildSceneDescriptor("ac-001", "JFK");
    const b = buildSceneDescriptor("ac-002", "JFK");
    // At least one dimension should differ (extremely likely with FNV-1a)
    const isDifferent =
      a.activity !== b.activity || a.timeOfDay !== b.timeOfDay || a.weather !== b.weather;
    expect(isDifferent).toBe(true);
  });

  it("contains non-empty strings for all fields", () => {
    const scene = buildSceneDescriptor("ac-xyz", "LAX");
    expect(scene.activity.length).toBeGreaterThan(0);
    expect(scene.timeOfDay.length).toBeGreaterThan(0);
    expect(scene.weather.length).toBeGreaterThan(0);
  });

  it("produces high variety across dimensions with per-dimension hashing", () => {
    const activities = new Set<string>();
    const times = new Set<string>();
    const weathers = new Set<string>();
    // Generate scenes for 100 different aircraft IDs
    for (let i = 0; i < 100; i++) {
      const scene = buildSceneDescriptor(`aircraft-${i}`, "JFK");
      activities.add(scene.activity);
      times.add(scene.timeOfDay);
      weathers.add(scene.weather);
    }
    // With 7 activities, 7 times, and ~6 weather options for JFK,
    // 100 aircraft should hit at least 4 unique values in each dimension
    expect(activities.size).toBeGreaterThanOrEqual(4);
    expect(times.size).toBeGreaterThanOrEqual(4);
    expect(weathers.size).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// deriveWeather — geographic realism constraints
// ---------------------------------------------------------------------------

describe("deriveWeather", () => {
  it("never produces snow for a tropical airport", () => {
    const tropical = makeAirport({
      latitude: 1.35,
      country: "SG",
      tags: ["business"],
    });
    // Try many seeds — none should produce snow
    for (let seed = 0; seed < 200; seed++) {
      const weather = deriveWeather(tropical, seed);
      expect(weather.toLowerCase()).not.toContain("snow");
    }
  });

  it("never produces snow for a low-latitude country outside SNOW_COUNTRIES", () => {
    const mumbai = makeAirport({
      latitude: 19.09,
      country: "IN",
      tags: ["business"],
    });
    for (let seed = 0; seed < 200; seed++) {
      const weather = deriveWeather(mumbai, seed);
      expect(weather.toLowerCase()).not.toContain("snow");
    }
  });

  it("can produce snow for a high-latitude snow country", () => {
    const oslo = makeAirport({
      latitude: 60.19,
      country: "NO",
      tags: ["business"],
    });
    const weathers = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      weathers.add(deriveWeather(oslo, seed));
    }
    const hasSnow = [...weathers].some((w) => w.toLowerCase().includes("snow"));
    expect(hasSnow).toBe(true);
  });

  it("can produce snow for a ski-tagged airport even at moderate latitude", () => {
    const ski = makeAirport({
      latitude: 38.0,
      country: "TR", // Turkey — not in SNOW_COUNTRIES
      tags: ["ski"],
    });
    const weathers = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      weathers.add(deriveWeather(ski, seed));
    }
    const hasSnow = [...weathers].some((w) => w.toLowerCase().includes("snow"));
    expect(hasSnow).toBe(true);
  });

  it("never produces rain for an arid desert airport", () => {
    const riyadh = makeAirport({
      latitude: 24.77,
      country: "SA",
      tags: ["business"],
    });
    for (let seed = 0; seed < 200; seed++) {
      const weather = deriveWeather(riyadh, seed);
      expect(weather.toLowerCase()).not.toContain("rain");
    }
  });

  it("can produce tropical rain for a beach airport near the equator", () => {
    const bali = makeAirport({
      latitude: -8.75,
      country: "ID",
      tags: ["beach"],
    });
    const weathers = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      weathers.add(deriveWeather(bali, seed));
    }
    const hasTropicalRain = [...weathers].some((w) => w.toLowerCase().includes("tropical rain"));
    expect(hasTropicalRain).toBe(true);
  });

  it("returns a fallback for an unknown airport", () => {
    const weather = deriveWeather(undefined, 42);
    expect(weather).toBe("under clear skies");
  });

  it("can produce mountain scenery for high-altitude airports", () => {
    const highAlt = makeAirport({
      latitude: -16.5,
      country: "BO",
      altitude: 13325, // La Paz
      tags: ["general"],
    });
    const weathers = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      weathers.add(deriveWeather(highAlt, seed));
    }
    const hasMountain = [...weathers].some((w) => w.toLowerCase().includes("mountain"));
    expect(hasMountain).toBe(true);
  });

  it("can produce haze for a beach airport above 30° latitude", () => {
    const niceBeach = makeAirport({
      latitude: 43.66, // Nice, France — well above 30°
      country: "FR",
      tags: ["beach"],
    });
    const weathers = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      weathers.add(deriveWeather(niceBeach, seed));
    }
    const hasHaze = [...weathers].some((w) => w.toLowerCase().includes("haz"));
    expect(hasHaze).toBe(true);
  });

  it("does not produce haze for a non-beach airport above 30° latitude", () => {
    const inland = makeAirport({
      latitude: 48.0, // Paris-area, no beach tag
      country: "FR",
      tags: ["business"],
    });
    for (let seed = 0; seed < 200; seed++) {
      const weather = deriveWeather(inland, seed);
      expect(weather.toLowerCase()).not.toContain("humid hazy");
    }
  });
});

// ---------------------------------------------------------------------------
// SCENE_VERSION
// ---------------------------------------------------------------------------

describe("SCENE_VERSION", () => {
  it("is set to 3 after the per-dimension hashing and beach-haze fix", () => {
    expect(SCENE_VERSION).toBe(3);
  });
});

describe("catalog prompts", () => {
  it("builds a factory-sale prompt for catalog images", () => {
    const model = getAircraftById("a320neo");
    expect(model).toBeDefined();

    const prompt = buildCatalogPrompt(model!);

    expect(prompt).toContain("factory delivery configuration with manufacturer colors");
    expect(prompt).toContain("delivery hangar");
    expect(prompt).toContain("no airline branding");
    expect(prompt).toContain("premium catalogue presentation");
  });

  it("accepts catalog prompts in dual-mode validation", () => {
    const model = getAircraftById("b787-9");
    expect(model).toBeDefined();

    expect(isValidAircraftImagePrompt(buildCatalogPrompt(model!))).toBe(true);
  });

  it("hashes catalog prompts deterministically per model", async () => {
    const model = getAircraftById("a350-900");
    expect(model).toBeDefined();

    const hashA = await computeCatalogPromptHash(model!);
    const hashB = await computeCatalogPromptHash(model!);

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
  });
});
