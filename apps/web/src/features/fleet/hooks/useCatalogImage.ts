import type { AircraftModel } from "@acars/core";
import {
  type CatalogImageRecord,
  loadCatalogImages,
  publishCatalogImage,
  uploadToBlossom,
} from "@acars/nostr";
import { useEffect, useRef, useState } from "react";
import {
  buildCatalogPrompt,
  computeCatalogPromptHash,
  generateLiveryImage,
  isLiveryApiUnavailable,
} from "../services/aircraftImageService";
import { getCachedImage, setCachedImage } from "../services/imageCache";
import { enqueueImageGeneration } from "../services/imageGenerationQueue";

const loadedCatalogImages = new Map<string, CatalogImageRecord>();
const inFlightCatalogGenerations = new Map<string, Promise<void>>();
let catalogImagesLoaded = false;
let catalogImagesPromise: Promise<Map<string, CatalogImageRecord>> | null = null;

async function ensureCatalogImagesLoaded() {
  if (catalogImagesLoaded) return loadedCatalogImages;
  if (!catalogImagesPromise) {
    catalogImagesPromise = loadCatalogImages()
      .then((records) => {
        loadedCatalogImages.clear();
        for (const [modelId, record] of records) {
          loadedCatalogImages.set(modelId, record);
        }
        catalogImagesLoaded = true;
        return loadedCatalogImages;
      })
      .catch((error) => {
        console.warn("[CatalogImage] Failed to load shared catalog images:", error);
        return loadedCatalogImages;
      })
      .finally(() => {
        catalogImagesPromise = null;
      });
  }

  return catalogImagesPromise ?? loadedCatalogImages;
}

export interface UseCatalogImageResult {
  imageUrl: string | null;
  isGenerating: boolean;
  error: string | null;
}

export function useCatalogImage(model: AircraftModel): UseCatalogImageResult {
  const [imageUrl, setImageUrl] = useState<string | null>(model.catalogImageUrl ?? null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const localObjectUrlRef = useRef<string | null>(null);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    const revokeLocalObjectUrl = () => {
      if (localObjectUrlRef.current) {
        URL.revokeObjectURL(localObjectUrlRef.current);
        localObjectUrlRef.current = null;
      }
    };

    return () => {
      isMountedRef.current = false;
      revokeLocalObjectUrl();
    };
  }, []);

  useEffect(() => {
    const revokeLocalObjectUrl = () => {
      if (localObjectUrlRef.current) {
        URL.revokeObjectURL(localObjectUrlRef.current);
        localObjectUrlRef.current = null;
      }
    };

    const promoteToRemoteUrl = (nextUrl: string) => {
      revokeLocalObjectUrl();
      if (isMountedRef.current) {
        setImageUrl(nextUrl);
      }
    };

    if (model.catalogImageUrl) {
      promoteToRemoteUrl(model.catalogImageUrl);
      return;
    }

    let cancelled = false;

    async function maybeResolveImage() {
      const promptHash = await computeCatalogPromptHash(model);
      if (cancelled) return;

      const sharedRecords = await ensureCatalogImagesLoaded();
      const sharedRecord = sharedRecords.get(model.id);
      if (cancelled) return;

      if (sharedRecord && sharedRecord.promptHash === promptHash) {
        promoteToRemoteUrl(sharedRecord.imageUrl);
        return;
      }

      const cacheKey = `catalog:${model.id}:${promptHash}`;
      const cached = await getCachedImage(cacheKey);
      if (cancelled) return;

      if (cached) {
        const objectUrl = URL.createObjectURL(cached);
        if (isMountedRef.current) {
          revokeLocalObjectUrl();
          localObjectUrlRef.current = objectUrl;
          setImageUrl(objectUrl);
        } else {
          URL.revokeObjectURL(objectUrl);
        }

        const existingUpload = inFlightCatalogGenerations.get(model.id);
        if (existingUpload) {
          await existingUpload;
          if (cancelled) return;
          const refreshedRecord = loadedCatalogImages.get(model.id);
          if (refreshedRecord?.promptHash === promptHash) {
            promoteToRemoteUrl(refreshedRecord.imageUrl);
          }
          return;
        }

        const uploadPromise = (async () => {
          try {
            const filename = `catalog-${model.id}.png`;
            const blossomUrl = await uploadToBlossom(cached, filename, "image/png");
            const record = {
              modelId: model.id,
              promptHash,
              imageUrl: blossomUrl,
              updatedAt: Date.now(),
            };
            await publishCatalogImage(record);
            loadedCatalogImages.set(model.id, record);
            if (!cancelled) {
              promoteToRemoteUrl(blossomUrl);
            }
          } catch (uploadError) {
            console.warn(
              `[CatalogImage] Failed to persist cached catalog image for ${model.id}:`,
              uploadError,
            );
          } finally {
            inFlightCatalogGenerations.delete(model.id);
          }
        })();

        inFlightCatalogGenerations.set(model.id, uploadPromise);
        await uploadPromise;
        return;
      }

      if (isLiveryApiUnavailable()) return;

      const existingGeneration = inFlightCatalogGenerations.get(model.id);
      if (existingGeneration) {
        setIsGenerating(true);
        await existingGeneration;
        if (cancelled) return;
        setIsGenerating(false);
        const refreshedRecord = loadedCatalogImages.get(model.id);
        if (refreshedRecord?.promptHash === promptHash) {
          promoteToRemoteUrl(refreshedRecord.imageUrl);
        }
        return;
      }

      setIsGenerating(true);
      setError(null);

      const generationPromise = new Promise<void>((resolve) => {
        enqueueImageGeneration(async () => {
          try {
            const prompt = buildCatalogPrompt(model);
            const imageBlob = await generateLiveryImage(prompt);
            await setCachedImage(cacheKey, imageBlob);

            const objectUrl = URL.createObjectURL(imageBlob);
            if (isMountedRef.current) {
              revokeLocalObjectUrl();
              localObjectUrlRef.current = objectUrl;
              setImageUrl(objectUrl);
            } else {
              URL.revokeObjectURL(objectUrl);
            }

            const filename = `catalog-${model.id}.png`;
            const blossomUrl = await uploadToBlossom(imageBlob, filename, "image/png");
            const record = {
              modelId: model.id,
              promptHash,
              imageUrl: blossomUrl,
              updatedAt: Date.now(),
            };
            await publishCatalogImage(record);
            loadedCatalogImages.set(model.id, record);
            if (!cancelled) {
              promoteToRemoteUrl(blossomUrl);
            }
          } catch (generationError) {
            const message =
              generationError instanceof Error
                ? generationError.message
                : "Catalog image generation failed";
            if (isMountedRef.current) {
              setError(message);
            }
            console.error(`[CatalogImage] Generation failed for ${model.id}:`, generationError);
          } finally {
            inFlightCatalogGenerations.delete(model.id);
            if (isMountedRef.current) {
              setIsGenerating(false);
            }
            resolve();
          }
        });
      });

      inFlightCatalogGenerations.set(model.id, generationPromise);
      await generationPromise;
    }

    void maybeResolveImage();

    return () => {
      cancelled = true;
    };
  }, [model]);

  return {
    imageUrl,
    isGenerating,
    error,
  };
}
