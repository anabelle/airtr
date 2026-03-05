import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Content Security Policy", () => {
  it("allows Primal image hosts used by Blossom redirects", () => {
    const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

    expect(indexHtml).toContain("img-src");
    expect(indexHtml).toContain("https://r2a.primal.net");
    expect(indexHtml).toContain("https://media.primal.net");
  });
});
