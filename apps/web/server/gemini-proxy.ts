/**
 * Vite dev-server plugin that mirrors the CF Pages Function behaviour.
 *
 * Security layers (matching production):
 *   1. Origin validation — only localhost dev origins accepted.
 *   2. Per-IP rate limiting — max N requests per sliding window.
 *   3. Prompt format validation — rejects non-livery prompts.
 *
 * Reads `GEMINI_API_KEY` from the server-side environment (NOT prefixed
 * with VITE_, so it never leaks into the client bundle).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import { isValidAircraftImagePrompt } from "../src/features/fleet/services/aircraftImagePromptValidation";

const DEFAULT_MODELS = ["imagen-4.0-generate-001", "imagen-3.0-generate-002"];
const ALLOWED_MODELS = new Set(DEFAULT_MODELS);
const MAX_MODELS = 3;
const GEMINI_TIMEOUT_MS = 15_000;

/** Maximum prompt length (chars). Longest realistic livery prompt is ~700 chars. */
const MAX_PROMPT_LENGTH = 1200;

interface Prediction {
  bytesBase64Encoded?: string;
  mimeType?: string;
  safetyAttributes?: { contentType?: string };
}

interface PredictResponse {
  predictions?: Prediction[];
}

// ---------------------------------------------------------------------------
// Origin validation
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = new Set(["http://localhost:5173", "http://localhost:4173"]);

/** Returns true if the origin is an allowed dev or preview origin. */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // CF Pages preview deployments: <hash>.acars.pages.dev
  try {
    const url = new URL(origin);
    return url.hostname.endsWith(".acars.pages.dev");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rate limiting (in-memory)
// ---------------------------------------------------------------------------

/**
 * Simple sliding-window rate limiter. More generous in dev (10 req/min)
 * to avoid blocking rapid iteration.
 */
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX_REQUESTS = 10; // more generous in dev

interface RateBucket {
  timestamps: number[];
}

const rateLimitMap = new Map<string, RateBucket>();

/**
 * Returns true if the IP has exceeded the rate limit.
 * As a side-effect, records the current timestamp if not limited.
 */
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  let bucket = rateLimitMap.get(ip);
  if (!bucket) {
    bucket = { timestamps: [] };
    rateLimitMap.set(ip, bucket);
  }

  // Drop timestamps outside the window
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

  if (bucket.timestamps.length >= RATE_MAX_REQUESTS) {
    return true;
  }

  bucket.timestamps.push(now);
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default function geminiProxy(): Plugin {
  return {
    name: "gemini-proxy",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        "/api/generate-livery",
        async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== "POST") {
            res.writeHead(405);
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }

          // --- Origin validation ---
          const origin = req.headers.origin;
          if (!isAllowedOrigin(origin)) {
            res.writeHead(403);
            res.end(JSON.stringify({ error: "Forbidden" }));
            return;
          }

          // --- Rate limiting ---
          const clientIp = req.socket.remoteAddress ?? "unknown";
          if (isRateLimited(clientIp)) {
            res.writeHead(429);
            res.end(
              JSON.stringify({
                error: "Rate limit exceeded. Try again in a minute.",
              }),
            );
            return;
          }

          // --- API key ---
          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: "GEMINI_API_KEY env var is not set" }));
            return;
          }

          // --- Parse body ---
          let body: { prompt: string; models?: string[] };
          try {
            body = JSON.parse(await readBody(req));
          } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }

          if (typeof body.prompt !== "string" || !body.prompt.trim()) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Missing prompt" }));
            return;
          }

          // --- Prompt validation ---
          if (!isValidAircraftImagePrompt(body.prompt, MAX_PROMPT_LENGTH)) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Invalid prompt format" }));
            return;
          }

          // --- Model selection ---
          const models =
            Array.isArray(body.models) && body.models.every((m) => typeof m === "string")
              ? body.models.filter((m) => ALLOWED_MODELS.has(m)).slice(0, MAX_MODELS)
              : DEFAULT_MODELS;

          const modelsToTry = models.length > 0 ? models : DEFAULT_MODELS;
          let lastError = "";

          for (const model of modelsToTry) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
            try {
              const apiRes = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify({
                  instances: [{ prompt: body.prompt }],
                  parameters: {
                    sampleCount: 1,
                    aspectRatio: "16:9",
                    outputOptions: { mimeType: "image/png" },
                  },
                }),
              });

              if (apiRes.status === 429) {
                lastError = "Rate limited";
                continue;
              }

              if (!apiRes.ok) {
                const text = await apiRes.text();
                if (text.includes("not found") || apiRes.status === 404) {
                  lastError = `Model ${model} not found`;
                  continue;
                }
                lastError = text;
                continue;
              }

              const data = (await apiRes.json()) as PredictResponse;
              const prediction = data.predictions?.find(
                (p) =>
                  p.bytesBase64Encoded && p.safetyAttributes?.contentType !== "Positive Prompt",
              );

              if (!prediction?.bytesBase64Encoded) {
                lastError = `Model ${model} returned no image`;
                continue;
              }

              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  imageBase64: prediction.bytesBase64Encoded,
                  mimeType: prediction.mimeType ?? "image/png",
                }),
              );
              return;
            } catch (err) {
              if (err instanceof Error && err.name === "AbortError") {
                lastError = "Upstream image request timed out";
                continue;
              }
              lastError = err instanceof Error ? err.message : "Unknown error";
            } finally {
              clearTimeout(timeout);
            }
          }

          res.writeHead(502);
          res.end(JSON.stringify({ error: lastError || "All models failed" }));
        },
      );
    },
  };
}
