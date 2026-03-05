import { createLogger } from "@acars/core";
import { getNDK } from "./ndk.js";

const logger = createLogger("Blossom");

const DEFAULT_BLOSSOM_SERVER = "https://blossom.primal.net";

let ndkBlossomCtor: typeof import("@nostr-dev-kit/ndk-blossom")["default"] | null = null;

async function getNDKBlossom() {
  if (!ndkBlossomCtor) {
    const mod = await import("@nostr-dev-kit/ndk-blossom");
    ndkBlossomCtor = mod.default;
  }
  return ndkBlossomCtor;
}

/**
 * Uploads a Blob to a Blossom server and returns the content-addressable URL.
 *
 * NDKBlossom is imported lazily to avoid module resolution issues in test environments.
 *
 * @param imageBlob - The image blob to upload
 * @param filename - A descriptive filename (e.g. "aircraft-abc123.png")
 * @param mimeType - MIME type (e.g. "image/png")
 * @returns The Blossom URL where the image is hosted
 */
export async function uploadToBlossom(
  imageBlob: Blob,
  filename: string,
  mimeType = "image/png",
): Promise<string> {
  const ndk = getNDK();
  if (!ndk.signer) {
    throw new Error("NDK has no signer — cannot authenticate Blossom upload");
  }

  const NDKBlossom = await getNDKBlossom();
  const blossom = new NDKBlossom(ndk);
  const file = new File([imageBlob], filename, { type: mimeType });

  logger.info(`Uploading ${filename} (${(imageBlob.size / 1024).toFixed(1)}KB) to Blossom...`);

  const imeta = await blossom.upload(file, {
    server: DEFAULT_BLOSSOM_SERVER,
    maxRetries: 3,
    retryDelay: 1000,
  });

  const url = imeta.url;
  if (!url) {
    throw new Error("Blossom upload succeeded but returned no URL");
  }

  logger.info(`Upload complete: ${url}`);
  return url;
}
