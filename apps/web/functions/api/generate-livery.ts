/**
 * Cloudflare Pages Function — server-side proxy for Gemini Imagen API.
 *
 * Keeps the API key off the client bundle. The secret `GOOGLE_API` is
 * configured in Cloudflare Pages environment variables.
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

const DEFAULT_MODELS = ["imagen-4.0-generate-001", "imagen-3.0-generate-002"];
const ALLOWED_MODELS = new Set(DEFAULT_MODELS);
const MAX_MODELS = 3;
const GEMINI_TIMEOUT_MS = 15_000;

function resolveApiKey(env: Env): string | undefined {
  const fromBindings = env.GOOGLE_API ?? env.GEMINI_API_KEY ?? env.VITE_GEMINI_API_KEY;
  if (fromBindings) return fromBindings;
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

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const env = context.env ?? ({} as Env);
  const apiKey = resolveApiKey(env);
  if (!apiKey) {
    const branch = env.CF_PAGES_BRANCH ?? "unknown";
    const envKeys = Object.keys(env);
    return Response.json(
      {
        error: "Gemini API secret is not configured",
        hint: "Ensure secrets are set for BOTH Production and Preview environments in the CF Pages dashboard",
        source: "apps-web",
        branch,
        envKeyCount: envKeys.length,
        envKeys: envKeys.filter((k) => !k.startsWith("__")),
        keyPresence: {
          GOOGLE_API: Boolean(env.GOOGLE_API),
          GEMINI_API_KEY: Boolean(env.GEMINI_API_KEY),
          VITE_GEMINI_API_KEY: Boolean(env.VITE_GEMINI_API_KEY),
        },
      },
      { status: 500 },
    );
  }

  let body: RequestBody;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    return Response.json({ error: "Missing prompt" }, { status: 400 });
  }

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
