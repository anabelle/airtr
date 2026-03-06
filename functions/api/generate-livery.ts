/**
 * Root-level Cloudflare Pages Function — Gemini Imagen API proxy.
 *
 * Security layers:
 *   1. Origin validation — only requests from acars.pub / localhost are accepted.
 *   2. Per-IP rate limiting — max N requests per sliding window, in-memory.
 *   3. Prompt format validation — rejects prompts that don't match the
 *      expected livery prompt structure (prevents arbitrary image generation).
 *
 * This file is intentionally a full inline copy (not a re-export)
 * because CF Pages only injects env bindings for handlers defined
 * directly inside `/functions`.  Cross-directory re-exports lose
 * `context.env` at runtime.
 */

interface Env {
  GOOGLE_API?: string;
  GEMINI_API_KEY?: string;
  VITE_GEMINI_API_KEY?: string;
  CF_PAGES_BRANCH?: string;
}

interface RequestBody {
  prompt: string;
  models?: string[];
}

interface PredictionResponse {
  predictions?: Array<{
    bytesBase64Encoded?: string;
    mimeType?: string;
    safetyAttributes?: { contentType?: string };
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODELS = ["imagen-4.0-generate-001", "imagen-3.0-generate-002"];
const ALLOWED_MODELS = new Set(DEFAULT_MODELS);
const MAX_MODELS = 3;
const GEMINI_TIMEOUT_MS = 15_000;

/** Maximum prompt length (chars). Longest realistic livery prompt is ~700 chars. */
const MAX_PROMPT_LENGTH = 1200;

// ---------------------------------------------------------------------------
// Origin validation
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = new Set([
  "https://acars.pub",
  "https://www.acars.pub",
  "http://localhost:5173",
  "http://localhost:4173",
]);

/** Returns true if the origin is an allowed production, preview, or dev origin. */
function isAllowedOrigin(origin: string | null): boolean {
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
// Rate limiting (in-memory, per-isolate)
// ---------------------------------------------------------------------------

/**
 * Simple sliding-window rate limiter. CF Pages Functions run in isolates
 * that may be recycled, so this is best-effort per-instance. For stronger
 * guarantees use Cloudflare KV or D1 — but this catches the vast majority
 * of abuse at zero cost.
 */
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX_REQUESTS = 5; // max 5 requests per IP per minute

interface RateBucket {
  timestamps: number[];
}

const rateLimitMap = new Map<string, RateBucket>();

/** Prune stale entries periodically to prevent unbounded memory growth. */
let lastPrune = Date.now();
const PRUNE_INTERVAL_MS = 300_000; // 5 minutes

function pruneRateLimitMap(now: number): void {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  const cutoff = now - RATE_WINDOW_MS;
  for (const [ip, bucket] of rateLimitMap) {
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
    if (bucket.timestamps.length === 0) {
      rateLimitMap.delete(ip);
    }
  }
}

/**
 * Returns true if the IP has exceeded the rate limit.
 * As a side-effect, records the current timestamp if not limited.
 */
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  pruneRateLimitMap(now);

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
// Prompt validation
// ---------------------------------------------------------------------------

/**
 * Validates that the prompt matches the expected livery prompt structure
 * produced by `buildLiveryPrompt()` in aircraftImageService.ts.
 *
 * Expected structure (all required phrases must be present):
 *   - "Professional aviation photography of a"
 *   - "commercial" + "aircraft"
 *   - "in the livery of" + "airline"
 *   - "photorealistic quality, cinematic aviation scene"
 *
 * This prevents abuse where someone uses the endpoint to generate
 * arbitrary images unrelated to the game.
 */
const PROMPT_REQUIRED_PHRASES = [
  "professional aviation photography of a",
  "commercial",
  "aircraft",
  "in the livery of",
  "airline",
  "photorealistic quality, cinematic aviation scene",
] as const;

function isValidLiveryPrompt(prompt: string): boolean {
  if (prompt.length > MAX_PROMPT_LENGTH) return false;
  const lower = prompt.toLowerCase();
  return PROMPT_REQUIRED_PHRASES.every((phrase) => lower.includes(phrase));
}

// ---------------------------------------------------------------------------
// API key resolution
// ---------------------------------------------------------------------------

function resolveApiKey(env: Env): string | undefined {
  // 1. Explicit CF Pages bindings
  const fromBindings = env.GOOGLE_API ?? env.GEMINI_API_KEY ?? env.VITE_GEMINI_API_KEY;
  if (fromBindings) return fromBindings;

  // 2. Fallback: process.env (available with nodejs_compat)
  try {
    const p = (globalThis as Record<string, unknown>).process as
      | { env?: Record<string, string> }
      | undefined;
    if (p?.env) {
      return p.env.GOOGLE_API ?? p.env.GEMINI_API_KEY ?? p.env.VITE_GEMINI_API_KEY;
    }
  } catch {
    /* not available */
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

export const onRequest: PagesFunction<Env> = async (context) => {
  // --- Method check ---
  if (context.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // --- Origin validation ---
  const origin = context.request.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // --- Rate limiting ---
  const clientIp =
    context.request.headers.get("cf-connecting-ip") ??
    context.request.headers.get("x-real-ip") ??
    "unknown";
  if (isRateLimited(clientIp)) {
    return Response.json({ error: "Rate limit exceeded. Try again in a minute." }, { status: 429 });
  }

  // --- API key ---
  const env = context.env ?? ({} as Env);
  const apiKey = resolveApiKey(env);
  if (!apiKey) {
    const branch = env.CF_PAGES_BRANCH ?? "unknown";
    return Response.json(
      {
        error: "Gemini API secret is not configured",
        hint: "Ensure secrets are set for BOTH Production and Preview environments in the CF Pages dashboard",
        branch,
      },
      { status: 500 },
    );
  }

  // --- Parse body ---
  let body: RequestBody;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    return Response.json({ error: "Missing prompt" }, { status: 400 });
  }

  // --- Prompt validation ---
  if (!isValidLiveryPrompt(body.prompt)) {
    return Response.json({ error: "Invalid prompt format" }, { status: 400 });
  }

  // --- Model selection ---
  const models =
    Array.isArray(body.models) && body.models.length > 0
      ? body.models
          .filter(
            (model): model is string => typeof model === "string" && ALLOWED_MODELS.has(model),
          )
          .slice(0, MAX_MODELS)
      : DEFAULT_MODELS;

  const modelsToTry = models.length > 0 ? models : DEFAULT_MODELS;
  let lastError = "";

  // --- Call Gemini Imagen API (try models in order) ---
  for (const model of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
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

      if (res.status === 429) {
        lastError = "Rate limited";
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        if (text.includes("not found") || res.status === 404) {
          lastError = `Model ${model} not found`;
          continue;
        }
        lastError = text;
        continue;
      }

      const data = (await res.json()) as PredictionResponse;
      const prediction = data.predictions?.find(
        (p) => p.bytesBase64Encoded && p.safetyAttributes?.contentType !== "Positive Prompt",
      );

      if (!prediction?.bytesBase64Encoded) {
        lastError = `Model ${model} returned no image`;
        continue;
      }

      return Response.json({
        imageBase64: prediction.bytesBase64Encoded,
        mimeType: prediction.mimeType ?? "image/png",
      });
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

  return Response.json({ error: lastError || "All models failed" }, { status: 502 });
};
