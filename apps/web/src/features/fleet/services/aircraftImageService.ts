import type { AircraftModel, AirlineEntity, Airport } from "@acars/core";
import { airports } from "@acars/data";

// Model candidates sent to the server proxy (tries in order)
const MODEL_CANDIDATES = ["imagen-4.0-generate-001", "imagen-3.0-generate-002"];
const GENERATE_TIMEOUT_MS = 20_000;
const LIVERY_PROXY_ENDPOINTS = ["/api/generate-livery"];

/**
 * Bump this constant to force regeneration of all livery images.
 * It is included in the prompt hash, so changing it invalidates every cache entry.
 */
export const SCENE_VERSION = 3;
export const CATALOG_VERSION = 1;

/** Circuit breaker: once the API reports a missing secret we stop retrying. */
let apiSecretMissing = false;
export function isLiveryApiUnavailable(): boolean {
  return apiSecretMissing;
}

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

/** Convert a hex color to a human-readable color name for image prompts. */
function hexToColorName(hex: string): string {
  const h = hex.replace("#", "");
  const r = Number.parseInt(h.substring(0, 2), 16);
  const g = Number.parseInt(h.substring(2, 4), 16);
  const b = Number.parseInt(h.substring(4, 6), 16);

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2 / 255;

  if (max - min < 20) {
    if (l > 0.9) return "white";
    if (l < 0.15) return "black";
    return "gray";
  }

  const d = max - min;
  let hue = 0;
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) hue = ((b - r) / d + 2) * 60;
  else hue = ((r - g) / d + 4) * 60;

  const sat = d / 255;

  if (sat < 0.15) {
    if (l > 0.7) return "light gray";
    if (l < 0.3) return "dark gray";
    return "gray";
  }

  const prefix = l > 0.75 ? "light " : l < 0.3 ? "dark " : "";

  if (hue < 15 || hue >= 345) return `${prefix}red`;
  if (hue < 40) return `${prefix}orange`;
  if (hue < 70) return `${prefix}yellow`;
  if (hue < 85) return `${prefix}lime green`;
  if (hue < 160) return `${prefix}green`;
  if (hue < 185) return `${prefix}teal`;
  if (hue < 200) return `${prefix}cyan`;
  if (hue < 250) return `${prefix}blue`;
  if (hue < 290) return `${prefix}purple`;
  if (hue < 330) return `${prefix}magenta`;
  return `${prefix}pink`;
}

// ---------------------------------------------------------------------------
// Airport helpers
// ---------------------------------------------------------------------------

/** Look up full airport record by IATA code. */
function getAirport(iata: string): Airport | undefined {
  return airports.find((a) => a.iata === iata);
}

/** Look up airport display name by IATA code. */
function getAirportName(iata: string): string {
  const airport = getAirport(iata);
  return airport ? `${airport.name} (${airport.city})` : iata;
}

/** Map aircraft type to a human-readable description. */
function describeAircraftType(type: AircraftModel["type"]): string {
  switch (type) {
    case "turboprop":
      return "turboprop";
    case "regional":
      return "regional jet";
    case "narrowbody":
      return "narrow-body";
    case "widebody":
      return "wide-body";
  }
}

function describeManufacturerLivery(manufacturer: string): string {
  switch (manufacturer) {
    case "Airbus":
      return "white with deep blue tail accents and subtle silver detailing";
    case "Boeing":
      return "white with signature blue striping and a dark blue tail";
    case "Embraer":
      return "white with dark blue and gold manufacturer accents";
    case "ATR":
      return "white with blue factory presentation striping";
    case "De Havilland":
      return "white with bold red manufacturer presentation accents";
    default:
      return "white with tasteful manufacturer presentation graphics";
  }
}

// ---------------------------------------------------------------------------
// Deterministic seed from aircraft ID (pure integer hash, no crypto needed)
// ---------------------------------------------------------------------------

/**
 * Simple FNV-1a 32-bit hash that turns an arbitrary string into a stable
 * integer. Used to deterministically pick scene attributes per aircraft
 * without needing async crypto.
 */
export function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0; // unsigned 32-bit
}

/** Pick an element from an array using a seed integer. */
function pickFromSeed<T>(arr: readonly T[], seed: number): T {
  return arr[seed % arr.length];
}

// ---------------------------------------------------------------------------
// Scene variation: activity, time of day, weather/climate
// ---------------------------------------------------------------------------

const AIRCRAFT_ACTIVITIES = [
  "landing on the runway with landing gear deployed, slight tire smoke",
  "taking off from the runway, nose pitched up, gear retracting",
  "taxiing on a taxiway near the terminal buildings",
  "parked at the gate with a jet bridge connected, ground crew visible",
  "pushing back from the gate with a tug attached",
  "on final approach low over the airport with gear down",
  "climbing after takeoff with gear retracting, airport visible below",
] as const;

const TIMES_OF_DAY = [
  "during golden sunrise, warm orange and pink sky on the horizon",
  "on a bright clear morning, soft blue sky with gentle light",
  "at midday under a high bright sun, vivid colors and sharp shadows",
  "during golden hour before sunset, long warm shadows and amber light",
  "at sunset with a vivid orange and purple sky behind the aircraft",
  "at dusk with deep blue twilight, runway lights glowing",
  "at night with runway and taxiway lights illuminating the scene, dark sky",
] as const;

/**
 * Countries/regions where snow is realistic at airports.
 * ISO 3166-1 alpha-2 codes of countries that regularly receive snow at
 * airport elevations. This is deliberately conservative — equatorial and
 * low-latitude countries are excluded even if they have mountain snow,
 * because airport infrastructure is almost always at lower elevations.
 */
const SNOW_COUNTRIES = new Set([
  // North America
  "CA",
  "US",
  // Europe
  "IS",
  "NO",
  "SE",
  "FI",
  "DK",
  "GB",
  "IE",
  "NL",
  "BE",
  "DE",
  "AT",
  "CH",
  "CZ",
  "SK",
  "PL",
  "LT",
  "LV",
  "EE",
  "RU",
  "UA",
  "BY",
  "MD",
  "RO",
  "HU",
  "SI",
  "HR",
  "BA",
  "RS",
  "ME",
  "MK",
  "BG",
  "FR",
  "LU",
  // East Asia
  "JP",
  "KR",
  "KP",
  "MN",
  "CN",
  // Central Asia
  "KZ",
  "KG",
  "TJ",
  "UZ",
  // South America (southern high altitude/latitude)
  "AR",
  "CL",
  // Oceania
  "NZ",
]);

/** Minimum absolute latitude (degrees) for snow to be plausible at an airport. */
const SNOW_MIN_LATITUDE = 35;

/** Countries in arid/desert climate zones where rain is very rare. */
const ARID_COUNTRIES = new Set([
  "SA",
  "AE",
  "QA",
  "BH",
  "KW",
  "OM",
  "YE",
  "EG",
  "LY",
  "DZ",
  "TN",
  "MA",
  "MR",
  "ML",
  "NE",
  "TD",
  "SD",
  "ER",
  "DJ",
  "SO",
]);

export interface SceneDescriptor {
  activity: string;
  timeOfDay: string;
  weather: string;
}

/**
 * Derives a realistic weather/climate description for an airport, seeded
 * deterministically from the aircraft ID. The function uses the airport's
 * latitude, country code, tags, and altitude to constrain weather choices
 * so that e.g. tropical airports never get snow and desert airports rarely
 * get rain.
 */
export function deriveWeather(airport: Airport | undefined, seed: number): string {
  if (!airport) return "under clear skies";

  const absLat = Math.abs(airport.latitude);
  const country = airport.country;
  const isBeach = airport.tags.includes("beach");
  const isSki = airport.tags.includes("ski");
  const isArid = ARID_COUNTRIES.has(country);

  // Build a pool of plausible weather conditions weighted by geography
  const pool: string[] = [];

  // Clear/sunny — universally plausible, always in the pool
  pool.push("under clear blue skies");
  pool.push("with a few scattered white clouds in the sky");

  // Overcast — plausible everywhere except extreme desert
  if (!isArid) {
    pool.push("under an overcast grey sky with diffused soft light");
  }

  // Rain — plausible in non-arid regions
  if (!isArid) {
    pool.push("during light rain, wet reflective tarmac and runway");
    if (isBeach || absLat < 25) {
      // Tropical regions get heavier rain options
      pool.push("during a tropical rain shower, lush green surroundings");
    }
  }

  // Haze/humidity — tropical, subtropical, and coastal beach airports
  if ((absLat < 30 || isBeach) && !isArid) {
    pool.push("in humid hazy conditions, warm tropical atmosphere");
  }

  // Snow — only where geographically realistic
  const snowPlausible = (SNOW_COUNTRIES.has(country) && absLat >= SNOW_MIN_LATITUDE) || isSki;
  if (snowPlausible) {
    pool.push("with snow covering the ground and airport surroundings, cold winter atmosphere");
    pool.push("with light snowfall, dusting of snow on taxiways and grass areas");
  }

  // Fog/mist — plausible in temperate and coastal regions
  if (absLat > 20 && absLat < 60 && !isArid) {
    pool.push("in early morning mist, low visibility with soft diffused light");
  }

  // Dry/dusty — arid regions
  if (isArid) {
    pool.push("under a hazy dry sky with dusty desert surroundings");
    pool.push("with shimmering heat haze rising from the hot tarmac");
  }

  // High altitude — dramatic skies
  if (airport.altitude > 5000) {
    pool.push("with dramatic mountain scenery visible in the background, thin crisp air");
  }

  return pickFromSeed(pool, seed);
}

/**
 * Builds a complete scene descriptor (activity + time of day + weather)
 * deterministically from the aircraft instance ID and airport data.
 * Each aircraft always gets the same scene, but different aircraft get
 * different scenes.
 */
export function buildSceneDescriptor(aircraftId: string, hubIata: string): SceneDescriptor {
  const airport = getAirport(hubIata);

  // Hash distinct salted strings per dimension so each gets full 32-bit entropy
  const activitySeed = fnv1aHash(aircraftId + ":activity");
  const timeSeed = fnv1aHash(aircraftId + ":time");
  const weatherSeed = fnv1aHash(aircraftId + ":weather");

  return {
    activity: pickFromSeed(AIRCRAFT_ACTIVITIES, activitySeed),
    timeOfDay: pickFromSeed(TIMES_OF_DAY, timeSeed),
    weather: deriveWeather(airport, weatherSeed),
  };
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Builds a deterministic, detailed prompt for generating a photorealistic
 * aircraft livery image from game state data. Each aircraft instance gets
 * a unique scene (activity, time of day, weather) derived from its ID,
 * while the livery and model details come from the airline/model data.
 */
export function buildLiveryPrompt(
  airline: AirlineEntity,
  model: AircraftModel,
  hubIata: string,
  aircraftId: string,
): string {
  const hubName = getAirportName(hubIata);
  const typeDesc = describeAircraftType(model.type);
  const scene = buildSceneDescriptor(aircraftId, hubIata);

  const primaryHex = airline.livery?.primary ?? "#ffffff";
  const secondaryHex = airline.livery?.secondary ?? "#1f2937";
  const accentHex = airline.livery?.accent ?? "#6b7280";
  const primaryColor = hexToColorName(primaryHex);
  const secondaryColor = hexToColorName(secondaryHex);
  const accentColor = hexToColorName(accentHex);

  return [
    `Professional aviation photography of a ${model.manufacturer} ${model.name} commercial ${typeDesc} aircraft`,
    `in the livery of ${airline.name} airline (ICAO: ${airline.icaoCode}).`,
    `The aircraft is ${scene.activity} at ${hubName} airport.`,
    `${scene.timeOfDay}, ${scene.weather}.`,
    `The fuselage is painted ${primaryColor} with a ${secondaryColor} tail fin`,
    `and ${accentColor} accent striping along the plane.`,
    `The airline name "${airline.name}" is displayed prominently on the fuselage in large lettering.`,
    `${model.engineCount}-engine ${typeDesc} aircraft with realistic proportions.`,
    `photorealistic quality, cinematic aviation scene`,
  ].join(" ");
}

export function buildCatalogPrompt(model: AircraftModel): string {
  const typeDesc = describeAircraftType(model.type);
  const manufacturerLivery = describeManufacturerLivery(model.manufacturer);

  return [
    `Professional aviation photography of a ${model.manufacturer} ${model.name} commercial ${typeDesc} aircraft`,
    `in factory delivery configuration with manufacturer colors.`,
    `Brand new aircraft inside a modern aircraft delivery hangar,`,
    `product lit with dramatic studio lighting and soft reflections along the fuselage.`,
    `The aircraft wears ${model.manufacturer} factory presentation livery: ${manufacturerLivery}.`,
    `Pristine condition, no airline branding, fresh from the production line, offered for sale in a premium catalogue presentation.`,
    `${model.engineCount}-engine ${typeDesc} aircraft with realistic proportions and landing gear visible.`,
    `photorealistic quality, cinematic aviation scene`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Prompt hash (cache key)
// ---------------------------------------------------------------------------

/**
 * Computes a deterministic hash of the prompt inputs for cache invalidation.
 * Includes the aircraft instance ID and scene version so that each aircraft
 * gets a unique image and bumping SCENE_VERSION regenerates all images.
 */
export async function computePromptHash(
  airline: AirlineEntity,
  model: AircraftModel,
  hubIata: string,
  aircraftId: string,
): Promise<string> {
  const primaryHex = airline.livery?.primary ?? "#ffffff";
  const secondaryHex = airline.livery?.secondary ?? "#1f2937";
  const accentHex = airline.livery?.accent ?? "#6b7280";

  const inputs = [
    airline.name,
    airline.icaoCode,
    primaryHex,
    secondaryHex,
    accentHex,
    model.manufacturer,
    model.name,
    model.type,
    String(model.engineCount),
    hubIata,
    aircraftId,
    String(SCENE_VERSION),
  ].join("|");

  const encoder = new TextEncoder();
  const data = encoder.encode(inputs);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function computeCatalogPromptHash(model: AircraftModel): Promise<string> {
  const inputs = [
    model.id,
    model.manufacturer,
    model.name,
    model.type,
    String(model.engineCount),
    String(CATALOG_VERSION),
  ].join("|");

  const encoder = new TextEncoder();
  const data = encoder.encode(inputs);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export { isValidAircraftImagePrompt } from "./aircraftImagePromptValidation";

/**
 * Generates a livery image by calling the server-side proxy at /api/generate-livery.
 * The API key never touches the client bundle.
 * Returns the raw image data as a Blob.
 */
export async function generateLiveryImage(prompt: string): Promise<Blob> {
  if (apiSecretMissing) {
    throw new Error("Livery API unavailable (missing server secret)");
  }

  let lastError: string | null = null;
  let data: { imageBase64: string; mimeType: string } | null = null;

  for (const endpoint of LIVERY_PROXY_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ prompt, models: MODEL_CANDIDATES }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        const error = (body as { error?: string }).error ?? `Proxy error ${res.status}`;
        if (res.status === 404 || res.status === 405) {
          lastError = `${error} (${endpoint})`;
          continue;
        }
        if (res.status === 500 && error.includes("secret is not configured")) {
          apiSecretMissing = true;
        }
        throw new Error(error);
      }

      data = (await res.json()) as { imageBase64: string; mimeType: string };
      break;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Livery generation request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!data) {
    throw new Error(lastError ?? "Livery generation API unavailable");
  }

  const binaryStr = atob(data.imageBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new Blob([bytes], { type: data.mimeType ?? "image/png" });
}
