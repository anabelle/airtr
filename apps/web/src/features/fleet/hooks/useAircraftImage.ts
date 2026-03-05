import { useState, useEffect, useRef } from "react";
import type { AircraftInstance, AircraftModel, AirlineEntity } from "@acars/core";
import { useAirlineStore } from "@acars/store";
import {
  buildLiveryPrompt,
  computePromptHash,
  generateLiveryImage,
  isLiveryApiUnavailable,
} from "../services/aircraftImageService";
import { uploadToBlossom } from "@acars/nostr";

// ---------------------------------------------------------------------------
// IndexedDB cache for generated livery images (survives page reloads)
// ---------------------------------------------------------------------------
const DB_NAME = "acars-livery-cache";
const DB_VERSION = 1;
const STORE_NAME = "images";

function openLiveryDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCachedImage(key: string): Promise<Blob | null> {
  try {
    const db = await openLiveryDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setCachedImage(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openLiveryDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(blob, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn("[Livery] IndexedDB cache write failed:", e);
  }
}

// ---------------------------------------------------------------------------
// Concurrency gate — only one generation at a time globally
// ---------------------------------------------------------------------------
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

/** Module-level set of aircraft IDs with generation in-flight or queued. */
const activeGenerations = new Set<string>();
const cachePersistenceAttempted = new Set<string>();

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
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);
  const localObjectUrlRef = useRef<string | null>(null);
  const isMountedRef = useRef(false);
  const updateAircraftLivery = useAirlineStore((s) => s.updateAircraftLivery);

  useEffect(() => {
    if (aircraft.liveryImageUrl && localObjectUrlRef.current) {
      URL.revokeObjectURL(localObjectUrlRef.current);
      localObjectUrlRef.current = null;
      setLocalImageUrl(null);
    }
  }, [aircraft.liveryImageUrl]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (localObjectUrlRef.current) {
        URL.revokeObjectURL(localObjectUrlRef.current);
        localObjectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!airline || !model || !isOwner) return;
    // If this aircraft already has generation in-flight/queued, skip
    if (activeGenerations.has(aircraft.id)) return;

    let cancelled = false;

    async function maybeGenerate() {
      if (!airline || !model) return;

      const hubIata = airline.hubs[0] ?? aircraft.baseAirportIata;
      const currentHash = await computePromptHash(airline, model, hubIata);

      // Bailed by StrictMode cleanup while computing hash
      if (cancelled) return;

      // Already have a valid image with matching prompt hash
      if (aircraft.liveryImageUrl && aircraft.liveryPromptHash === currentHash) {
        return;
      }

      // Check IndexedDB cache before burning an API call
      const cacheKey = `${aircraft.id}:${currentHash}`;
      const cached = await getCachedImage(cacheKey);
      if (cached) {
        console.log(`[Livery] Cache hit for ${aircraft.id}`);
        const objectUrl = URL.createObjectURL(cached);
        if (isMountedRef.current) {
          if (localObjectUrlRef.current) {
            URL.revokeObjectURL(localObjectUrlRef.current);
          }
          localObjectUrlRef.current = objectUrl;
          setLocalImageUrl(localObjectUrlRef.current);
        } else {
          URL.revokeObjectURL(objectUrl);
        }

        // Still try to persist to Blossom/Nostr if not already persisted.
        // Gate this per cache key to avoid upload retry loops on rerender.
        if (!cachePersistenceAttempted.has(cacheKey)) {
          cachePersistenceAttempted.add(cacheKey);
          activeGenerations.add(aircraft.id);
          try {
            const filename = `aircraft-${aircraft.id}.png`;
            const imageUrl = await uploadToBlossom(cached, filename, "image/png");
            await updateAircraftLivery(aircraft.id, imageUrl, currentHash);
          } catch (uploadErr) {
            console.warn(`[Livery] Cache upload failed for ${aircraft.id}:`, uploadErr);
          } finally {
            activeGenerations.delete(aircraft.id);
          }
        }
        return;
      }

      // Circuit breaker: stop trying once the API reports missing secret
      if (isLiveryApiUnavailable()) return;

      // Mark as active BEFORE enqueueing so re-renders skip this aircraft
      activeGenerations.add(aircraft.id);
      setIsGenerating(true);
      setError(null);

      // Once enqueued, the callback runs independently of React lifecycle.
      // Do NOT check `cancelled` inside — parent re-renders must not abort queued work.
      enqueue(async () => {
        try {
          const prompt = buildLiveryPrompt(airline!, model!, hubIata);
          console.log(`[Livery] Generating for ${aircraft.id}…`);
          const imageBlob = await generateLiveryImage(prompt);
          console.log(`[Livery] Got blob: ${imageBlob.size} bytes, ${imageBlob.type}`);

          // Persist to IndexedDB immediately
          await setCachedImage(cacheKey, imageBlob);
          console.log(`[Livery] Cached ${aircraft.id} in IndexedDB`);

          const objectUrl = URL.createObjectURL(imageBlob);
          if (isMountedRef.current) {
            if (localObjectUrlRef.current) {
              URL.revokeObjectURL(localObjectUrlRef.current);
            }
            localObjectUrlRef.current = objectUrl;
            setLocalImageUrl(localObjectUrlRef.current);
          } else {
            URL.revokeObjectURL(objectUrl);
          }

          // Best-effort Blossom upload + Nostr persistence
          try {
            const filename = `aircraft-${aircraft.id}.png`;
            const imageUrl = await uploadToBlossom(imageBlob, filename, "image/png");
            console.log(`[Livery] Blossom upload OK: ${imageUrl}`);
            await updateAircraftLivery(aircraft.id, imageUrl, currentHash);
          } catch (uploadErr) {
            console.warn(`[Livery] Blossom upload failed for ${aircraft.id}:`, uploadErr);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Image generation failed";
          if (isMountedRef.current) {
            setError(message);
          }
          console.error(`[Livery] Generation failed for ${aircraft.id}:`, err);
        } finally {
          activeGenerations.delete(aircraft.id);
          if (isMountedRef.current) {
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
    aircraft.baseAirportIata,
    aircraft.liveryImageUrl,
    aircraft.liveryPromptHash,
    airline,
    model,
    isOwner,
    updateAircraftLivery,
  ]);

  return {
    imageUrl: aircraft.liveryImageUrl ?? localImageUrl ?? null,
    isGenerating,
    error,
  };
}
