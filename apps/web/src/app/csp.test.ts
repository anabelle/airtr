import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Content Security Policy", () => {
  it("allows Primal image hosts used by Blossom redirects", () => {
    const candidatePaths = [
      resolve(process.cwd(), "index.html"),
      resolve(process.cwd(), "apps/web/index.html"),
    ];
    const indexHtmlPath = candidatePaths.find((path) => existsSync(path));

    expect(indexHtmlPath).toBeDefined();

    const indexHtml = readFileSync(indexHtmlPath as string, "utf8");
    const cspTagMatch = indexHtml.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i);
    expect(cspTagMatch).toBeTruthy();

    const contentMatch = cspTagMatch?.[0].match(/content="([^"]*)"/);
    expect(contentMatch).toBeTruthy();

    const imgSrcDirective = contentMatch?.[1]
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("img-src "));

    expect(imgSrcDirective).toContain("https://r2a.primal.net");
    expect(imgSrcDirective).toContain("https://media.primal.net");
  });
});
