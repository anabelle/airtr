export const LIVERY_REQUIRED_PHRASES = [
  "professional aviation photography of a",
  "commercial",
  "aircraft",
  "in the livery of",
  "airline",
  "photorealistic quality, cinematic aviation scene",
] as const;

export const CATALOG_REQUIRED_PHRASES = [
  "professional aviation photography of a",
  "commercial",
  "aircraft",
  "factory delivery configuration with manufacturer colors",
  "delivery hangar",
  "photorealistic quality, cinematic aviation scene",
] as const;

export function isValidAircraftImagePrompt(prompt: string, maxPromptLength = 1200): boolean {
  if (prompt.length > maxPromptLength) return false;
  const lower = prompt.toLowerCase();
  const matchesLivery = LIVERY_REQUIRED_PHRASES.every((phrase) => lower.includes(phrase));
  const matchesCatalog = CATALOG_REQUIRED_PHRASES.every((phrase) => lower.includes(phrase));
  return matchesLivery || matchesCatalog;
}
