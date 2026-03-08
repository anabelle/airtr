import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATALOG_REQUIRED_PHRASES,
  isValidAircraftImagePrompt,
  LIVERY_REQUIRED_PHRASES,
} from "./aircraftImagePromptValidation";

describe("aircraftImagePromptValidation", () => {
  it("accepts both livery and catalog prompt shapes", () => {
    const liveryPrompt = [
      "professional aviation photography of a",
      "commercial",
      "aircraft",
      "in the livery of",
      "airline",
      "photorealistic quality, cinematic aviation scene",
    ].join(" ");
    const catalogPrompt = [
      "professional aviation photography of a",
      "commercial",
      "aircraft",
      "factory delivery configuration with manufacturer colors",
      "delivery hangar",
      "photorealistic quality, cinematic aviation scene",
    ].join(" ");

    expect(isValidAircraftImagePrompt(liveryPrompt)).toBe(true);
    expect(isValidAircraftImagePrompt(catalogPrompt)).toBe(true);
  });

  it("stays in parity with the Cloudflare function validator phrase lists", () => {
    const functionSource = readFileSync(
      resolve(process.cwd(), "../..", "functions/api/generate-livery.ts"),
      "utf8",
    );

    const liveryMatch = functionSource.match(
      /const LIVERY_REQUIRED_PHRASES = \[(.*?)\] as const;/s,
    );
    const catalogMatch = functionSource.match(
      /const CATALOG_REQUIRED_PHRASES = \[(.*?)\] as const;/s,
    );

    const extractPhrases = (match: RegExpMatchArray | null) =>
      Array.from(match?.[1].matchAll(/"([^"]+)"/g) ?? [], (entry) => entry[1]);

    expect(extractPhrases(liveryMatch)).toEqual([...LIVERY_REQUIRED_PHRASES]);
    expect(extractPhrases(catalogMatch)).toEqual([...CATALOG_REQUIRED_PHRASES]);
  });
});
