import { describe, expect, it } from "vitest";
import { EARTH_MAP_PALETTE, EARTH_MAP_STYLE_URL } from "./Globe.js";

describe("earth map palette", () => {
  it("uses the lighter voyager basemap for improved daylight readability", () => {
    expect(EARTH_MAP_STYLE_URL).toBe(
      "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    );
  });

  it("keeps overlay colors in the new green-blue earth palette", () => {
    expect(EARTH_MAP_PALETTE.nightTint.maxAlpha).toBeLessThan(0.3);
    expect(EARTH_MAP_PALETTE.airports.playerHub).toBe("#4ade80");
    expect(EARTH_MAP_PALETTE.airports.routeDestination).toBe("#38bdf8");
    expect(EARTH_MAP_PALETTE.routes.active).toBe("#0ea5e9");
  });
});
