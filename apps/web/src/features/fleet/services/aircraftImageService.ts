import { GoogleGenAI } from "@google/genai";
import type { AircraftModel, AirlineEntity } from "@acars/core";
import { airports } from "@acars/data";

// Vite exposes env vars on import.meta.env at build time
// biome-ignore lint: Vite-specific global
const GEMINI_API_KEY = (import.meta as any).env.VITE_GEMINI_API_KEY as string;
const MODEL_CANDIDATES = [
  (import.meta as any).env.VITE_GEMINI_IMAGE_MODEL as string | undefined,
  "imagen-4.0-generate-001",
  "imagen-3.0-generate-002",
].filter((value): value is string => Boolean(value));

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

  const primaryColor = hexToColorName(airline.livery.primary);
  const secondaryColor = hexToColorName(airline.livery.secondary);
  const accentColor = hexToColorName(airline.livery.accent);

  return [
    `Professional aviation photography of a ${model.manufacturer} ${model.name} commercial ${typeDesc} aircraft`,
    `in the livery of ${airline.name} airline (ICAO: ${airline.icaoCode}).`,
    `The aircraft is parked at ${hubName} airport`,
    `The fuselage is painted ${primaryColor} with a ${secondaryColor} tail fin`,
    `and ${accentColor} accent striping along the windows.`,
    `The airline name "${airline.name}" is displayed prominently on the fuselage in large lettering.`,
    `${model.engineCount}-engine ${typeDesc} aircraft with realistic proportions.`,
    `subtle tarmac reflections, photorealistic quality,`,
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
  let lastError: unknown = null;

  for (const model of MODEL_CANDIDATES) {
    try {
      const response = await ai.models.generateImages({
        model,
        prompt,
        config: {
          numberOfImages: 1,
          aspectRatio: "16:9",
          outputMimeType: "image/png",
        },
      });

      console.log(
        `[Livery] SDK response: generatedImages=${response.generatedImages?.length ?? 0}`,
      );

      const genImage = response.generatedImages?.[0];
      const sdkImage = genImage?.image;

      // The SDK's tBytes is an identity transform — imageBytes is a base64 string
      let imageBytes: string | undefined;
      let mimeType: string | undefined;

      if (sdkImage?.imageBytes && typeof sdkImage.imageBytes === "string") {
        imageBytes = sdkImage.imageBytes;
        mimeType = sdkImage.mimeType;
      }

      // Fallback: inspect raw predictions if SDK transform didn't populate image
      if (!imageBytes) {
        const rawResponse = response as unknown as {
          predictions?: Array<{
            bytesBase64Encoded?: string;
            mimeType?: string;
            raiFilteredReason?: string;
          }>;
        };
        const rawPrediction = rawResponse.predictions?.[0];
        imageBytes = rawPrediction?.bytesBase64Encoded;
        mimeType = mimeType ?? rawPrediction?.mimeType;
        console.log(`[Livery] Fallback raw prediction: hasBytes=${!!imageBytes}, mime=${mimeType}`);
      }

      if (!imageBytes) {
        const raiReason = (genImage as { raiFilteredReason?: string } | undefined)
          ?.raiFilteredReason;
        throw new Error(
          raiReason
            ? `Model ${model} filtered the image (${raiReason})`
            : `Model ${model} returned no image bytes (generatedImages count: ${response.generatedImages?.length ?? 0})`,
        );
      }

      console.log(`[Livery] Decoding base64 (${imageBytes.length} chars)…`);

      const binaryStr = atob(imageBytes);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return new Blob([bytes], { type: mimeType ?? "image/png" });
    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message.toLowerCase() : "";
      const isModelNotFound = errorMessage.includes("not found") || errorMessage.includes("404");
      const isRateLimited =
        errorMessage.includes("429") ||
        errorMessage.includes("rate") ||
        errorMessage.includes("resource exhausted");

      if (isRateLimited) {
        console.warn(`[Livery] Rate limited on ${model}, waiting 30s before retry…`);
        await new Promise((r) => setTimeout(r, 30_000));
        // Retry same model once after waiting
        try {
          return await generateLiveryImage(prompt);
        } catch {
          throw error;
        }
      }

      if (!isModelNotFound) {
        throw error;
      }
    }
  }

  if (lastError instanceof Error) {
    throw new Error(
      `No supported image model available. Set VITE_GEMINI_IMAGE_MODEL to a valid model for your account. Last error: ${lastError.message}`,
    );
  }

  throw new Error("No supported image model available");
}
