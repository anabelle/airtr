/**
 * Cloudflare Pages Function — server-side proxy for Gemini Imagen API.
 *
 * Keeps the API key off the client bundle. The secret `GOOGLE_API` is
 * configured in Cloudflare Pages environment variables.
 */

interface Env {
  GOOGLE_API: string;
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

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const apiKey = context.env.GOOGLE_API;
  if (!apiKey) {
    return Response.json({ error: "GOOGLE_API secret is not configured" }, { status: 500 });
  }

  let body: RequestBody;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.prompt || typeof body.prompt !== "string") {
    return Response.json({ error: "Missing prompt" }, { status: 400 });
  }

  const models = body.models?.length ? body.models : DEFAULT_MODELS;
  let lastError = "";

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      lastError = err instanceof Error ? err.message : "Unknown error";
    }
  }

  return Response.json({ error: lastError || "All models failed" }, { status: 502 });
};
