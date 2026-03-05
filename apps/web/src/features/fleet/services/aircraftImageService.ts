import { GoogleGenAI, Modality } from "@google/genai";
import type { AircraftModel, AirlineEntity } from "@acars/core";
import { airports } from "@acars/data";

// Vite exposes env vars on import.meta.env at build time
// biome-ignore lint: Vite-specific global
const GEMINI_API_KEY = (import.meta as any).env.VITE_GEMINI_API_KEY as string;
const MODEL_ID = "gemini-2.0-flash-exp";

let genAI: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI {
  if (!genAI) {
    if (!GEMINI_API_KEY) {
      throw new Error("VITE_GEMINI_API_KEY is not set");
    }
    genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return genAI;
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

  return [
    `Professional aviation photography of a ${model.manufacturer} ${model.name} commercial ${typeDesc} aircraft`,
    `in the livery of ${airline.name} airline (ICAO: ${airline.icaoCode}).`,
    `The aircraft is parked at a gate at ${hubName} airport, viewed from a 3/4 front angle.`,
    `The fuselage is painted ${airline.livery.primary} with a ${airline.livery.secondary} tail fin`,
    `and ${airline.livery.accent} accent striping along the windows.`,
    `The airline name "${airline.name}" is displayed prominently on the fuselage in large lettering.`,
    `${model.engineCount}-engine ${typeDesc} aircraft with realistic proportions.`,
    `Golden hour lighting, subtle tarmac reflections, photorealistic quality,`,
    `sharp focus, airport terminal and jet bridges visible in the background.`,
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
  const inputs = [
    airline.name,
    airline.icaoCode,
    airline.livery.primary,
    airline.livery.secondary,
    airline.livery.accent,
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
 * Generates a livery image using Google's Gemini (Nano Banana) image generation.
 * Returns the raw image data as a Blob.
 */
export async function generateLiveryImage(prompt: string): Promise<Blob> {
  const ai = getGenAI();

  const response = await ai.models.generateContent({
    model: MODEL_ID,
    contents: prompt,
    config: {
      responseModalities: [Modality.IMAGE],
    },
  });

  const candidates = response.candidates;
  if (!candidates?.length) {
    throw new Error("Gemini returned no candidates");
  }

  const parts = candidates[0].content?.parts;
  if (!parts?.length) {
    throw new Error("Gemini returned no content parts");
  }

  const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith("image/"));
  if (!imagePart?.inlineData?.data) {
    throw new Error("Gemini returned no image data");
  }

  const { data, mimeType } = imagePart.inlineData;
  const binaryStr = atob(data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType ?? "image/png" });
}
