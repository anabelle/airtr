import { describe, expect, it } from "vitest";
import {
  DARK_MAP_PALETTE,
  DARK_MAP_STYLE_URL,
  DEFAULT_MAP_THEME,
  EARTH_MAP_PALETTE,
  EARTH_MAP_STYLE_URL,
  getMapPalette,
  getMapStyleUrl,
} from "./Globe.js";

describe("earth map palette", () => {
  it("keeps dark mode as the default theme", () => {
    expect(DEFAULT_MAP_THEME).toBe("dark");
    expect(getMapStyleUrl("dark")).toBe(DARK_MAP_STYLE_URL);
    expect(getMapPalette("dark")).toBe(DARK_MAP_PALETTE);
  });

  it("uses the lighter voyager basemap for improved daylight readability", () => {
    expect(EARTH_MAP_STYLE_URL).toBe(
      "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    );
    expect(getMapStyleUrl("light")).toBe(EARTH_MAP_STYLE_URL);
  });

  it("keeps overlay colors in the new green-blue earth palette", () => {
    expect(EARTH_MAP_PALETTE.nightTint.maxAlpha).toBeLessThan(0.3);
    expect(EARTH_MAP_PALETTE.airports.playerHub).toBe("#4ade80");
    expect(EARTH_MAP_PALETTE.airports.routeDestination).toBe("#38bdf8");
    expect(EARTH_MAP_PALETTE.routes.active).toBe("#0ea5e9");
  });

  it("retains the original dark overlay accents for night mode", () => {
    expect(DARK_MAP_PALETTE.nightTint.maxAlpha).toBeGreaterThan(0.3);
    expect(DARK_MAP_PALETTE.routes.active).toBe("#e94560");
    expect(DARK_MAP_PALETTE.airports.routeDestination).toBe("#e2e8f0");
  });
});
