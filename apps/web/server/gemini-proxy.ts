/**
 * Vite dev-server plugin that mirrors the CF Pages Function behaviour.
 *
 * Reads `GEMINI_API_KEY` from the server-side environment (NOT prefixed
 * with VITE_, so it never leaks into the client bundle).
 */
import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

const DEFAULT_MODELS = ["imagen-4.0-generate-001", "imagen-3.0-generate-002"];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

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

          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: "GEMINI_API_KEY env var is not set" }));
            return;
          }

          let body: { prompt: string; models?: string[] };
          try {
            body = JSON.parse(await readBody(req));
          } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }

          if (!body.prompt) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Missing prompt" }));
            return;
          }

          const models = body.models?.length ? body.models : DEFAULT_MODELS;
          let lastError = "";

          for (const model of models) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;

            try {
              const apiRes = await fetch(url, {
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

              const data = await apiRes.json();
              const prediction = (data as any).predictions?.find(
                (p: any) =>
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
              lastError = err instanceof Error ? err.message : "Unknown error";
            }
          }

          res.writeHead(502);
          res.end(JSON.stringify({ error: lastError || "All models failed" }));
        },
      );
    },
  };
}
