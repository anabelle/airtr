import type { AircraftModel, AirlineEntity } from "@acars/core";
import { airports } from "@acars/data";

// Model candidates sent to the server proxy (tries in order)
const MODEL_CANDIDATES = ["imagen-4.0-generate-001", "imagen-3.0-generate-002"];
const GENERATE_TIMEOUT_MS = 20_000;
const LIVERY_PROXY_ENDPOINTS = ["/api/generate-livery"];

/** Circuit breaker: once the API reports a missing secret we stop retrying. */
let apiSecretMissing = false;
export function isLiveryApiUnavailable(): boolean {
  return apiSecretMissing;
}

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

/** Look up airport display name by IATA code. */
function getAirportName(iata: string): string {
  const airport = airports.find((a) => a.iata === iata);
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

/**
 * Builds a deterministic, detailed prompt for generating a photorealistic
 * aircraft livery image from game state data.
 */
export function buildLiveryPrompt(
  airline: AirlineEntity,
  model: AircraftModel,
  hubIata: string,
): string {
  const hubName = getAirportName(hubIata);
  const typeDesc = describeAircraftType(model.type);

  const primaryHex = airline.livery?.primary ?? "#ffffff";
  const secondaryHex = airline.livery?.secondary ?? "#1f2937";
  const accentHex = airline.livery?.accent ?? "#6b7280";
  const primaryColor = hexToColorName(primaryHex);
  const secondaryColor = hexToColorName(secondaryHex);
  const accentColor = hexToColorName(accentHex);

  return [
    `Professional aviation photography of a ${model.manufacturer} ${model.name} commercial ${typeDesc} aircraft`,
    `in the livery of ${airline.name} airline (ICAO: ${airline.icaoCode}).`,
    `The aircraft is parked at ${hubName} airport which is visible in the background`,
    `The fuselage is painted ${primaryColor} with a ${secondaryColor} tail fin`,
    `and ${accentColor} accent striping along the plane.`,
    `The airline name "${airline.name}" is displayed prominently on the fuselage in large lettering.`,
    `${model.engineCount}-engine ${typeDesc} aircraft with realistic proportions.`,
    `photorealistic quality`,
  ].join(" ");
}

/**
 * Computes a deterministic hash of the prompt inputs for cache invalidation.
 * If any of these inputs change, the image should be regenerated.
 */
export async function computePromptHash(
  airline: AirlineEntity,
  model: AircraftModel,
  hubIata: string,
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
  ].join("|");

  const encoder = new TextEncoder();
  const data = encoder.encode(inputs);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
