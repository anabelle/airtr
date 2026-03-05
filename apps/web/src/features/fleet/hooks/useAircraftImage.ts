import { useState, useEffect, useRef } from "react";
import type { AircraftInstance, AircraftModel, AirlineEntity } from "@acars/core";
import { useAirlineStore } from "@acars/store";
import {
  buildLiveryPrompt,
  computePromptHash,
  generateLiveryImage,
} from "../services/aircraftImageService";
import { uploadToBlossom } from "@acars/nostr";

/** Concurrency gate — only one generation at a time globally. */
let generationInProgress = false;
const pendingQueue: Array<() => void> = [];

function enqueue(fn: () => void) {
  if (!generationInProgress) {
    generationInProgress = true;
    fn();
  } else {
    pendingQueue.push(fn);
  }
}

function dequeue() {
  generationInProgress = false;
  const next = pendingQueue.shift();
  if (next) {
    generationInProgress = true;
    next();
  }
}

export interface UseAircraftImageResult {
  imageUrl: string | null;
  isGenerating: boolean;
  error: string | null;
}

/**
 * React hook that manages the lifecycle of an aircraft's AI-generated livery image.
 *
 * - If the aircraft already has a valid liveryImageUrl with matching promptHash → returns it.
 * - If missing or stale → triggers generation, Blossom upload, and persists the URL.
 * - Only the aircraft owner triggers generation.
 * - Rate-limited to 1 concurrent generation globally.
 */
export function useAircraftImage(
  aircraft: AircraftInstance,
  airline: AirlineEntity | null,
  model: AircraftModel | null,
  isOwner: boolean,
): UseAircraftImageResult {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationAttempted = useRef(false);
  const updateAircraftLivery = useAirlineStore((s) => s.updateAircraftLivery);

  useEffect(() => {
    if (!airline || !model || !isOwner) return;
    if (generationAttempted.current) return;

    let cancelled = false;

    async function maybeGenerate() {
      if (!airline || !model) return;

      const hubIata = airline.hubs[0] ?? aircraft.baseAirportIata;
      const currentHash = await computePromptHash(airline, model, hubIata);

      // Already have a valid image with matching prompt hash
      if (aircraft.liveryImageUrl && aircraft.liveryPromptHash === currentHash) {
        return;
      }

      generationAttempted.current = true;

      enqueue(async () => {
        if (cancelled) {
          dequeue();
          return;
        }

        setIsGenerating(true);
        setError(null);

        try {
          const prompt = buildLiveryPrompt(airline!, model!, hubIata);
          const imageBlob = await generateLiveryImage(prompt);
          if (cancelled) return;

          const filename = `aircraft-${aircraft.id}.png`;
          const imageUrl = await uploadToBlossom(imageBlob, filename, "image/png");
          if (cancelled) return;

          updateAircraftLivery(aircraft.id, imageUrl, currentHash);
        } catch (err) {
          if (!cancelled) {
            const message = err instanceof Error ? err.message : "Image generation failed";
            setError(message);
            console.error(`Livery generation failed for ${aircraft.id}:`, err);
          }
        } finally {
          if (!cancelled) {
            setIsGenerating(false);
          }
          dequeue();
        }
      });
    }

    maybeGenerate();

    return () => {
      cancelled = true;
    };
  }, [
    aircraft.id,
    aircraft.liveryImageUrl,
    aircraft.liveryPromptHash,
    airline,
    model,
    isOwner,
    updateAircraftLivery,
  ]);

  return {
    imageUrl: aircraft.liveryImageUrl ?? null,
    isGenerating,
    error,
  };
}
