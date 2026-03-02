// =============================================================================
// --- Navigation Helpers (Great Circle Math) ---
// =============================================================================

/**
 * Spherical linear interpolation (SLERP) along the great circle between
 * two [lng, lat] points. Returns the point at fraction `f` (0 = p1, 1 = p2).
 */
export function getGreatCircleInterpolation(
  p1: [number, number],
  p2: [number, number],
  f: number,
): [number, number] {
  const lon1 = (p1[0] * Math.PI) / 180;
  const lat1 = (p1[1] * Math.PI) / 180;
  const lon2 = (p2[0] * Math.PI) / 180;
  const lat2 = (p2[1] * Math.PI) / 180;

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat1 - lat2) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon1 - lon2) / 2) ** 2,
      ),
    );

  if (d === 0) return p1;

  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  const lat = Math.atan2(z, Math.sqrt(x ** 2 + y ** 2));
  const lon = Math.atan2(y, x);

  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

/**
 * Computes the forward azimuth (bearing) from p1 to p2 in degrees [0, 360).
 */
export function getBearing(p1: [number, number], p2: [number, number]): number {
  const lon1 = (p1[0] * Math.PI) / 180;
  const lat1 = (p1[1] * Math.PI) / 180;
  const lon2 = (p2[0] * Math.PI) / 180;
  const lat2 = (p2[1] * Math.PI) / 180;

  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  const brng = Math.atan2(y, x);
  return ((brng * 180) / Math.PI + 360) % 360;
}

// =============================================================================
// --- Antimeridian (Dateline) Splitting ---
// =============================================================================

/**
 * Splits a polyline at the antimeridian (±180° longitude) so MapLibre
 * doesn't draw a line the wrong way around the world.
 *
 * When consecutive points jump more than 180° in longitude, we know the
 * great-circle path crossed the dateline. We end the current segment at
 * the ±180 boundary and start a new one on the opposite side.
 *
 * Returns an array of coordinate arrays. If no crossing occurs, the
 * result is `[points]` (single segment, zero overhead).
 */
export function splitAntimeridian(points: [number, number][]): [number, number][][] {
  if (points.length < 2) return [points];

  const segments: [number, number][][] = [];
  let current: [number, number][] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const [prevLng, prevLat] = points[i - 1];
    const [nextLng, nextLat] = points[i];
    const delta = nextLng - prevLng;

    if (Math.abs(delta) > 180) {
      // Crossed the antimeridian — binary-search for the exact great-circle
      // latitude at the ±180° boundary. Linear interpolation in lng/lat
      // space is inaccurate because the great circle curves; using SLERP
      // via getGreatCircleInterpolation gives sub-pixel precision.
      const crossLng = prevLng > 0 ? 180 : -180;
      const p1: [number, number] = [prevLng, prevLat];
      const p2: [number, number] = [nextLng, nextLat];
      let lo = 0;
      let hi = 1;
      let crossLat = prevLat;
      for (let j = 0; j < 20; j++) {
        const mid = (lo + hi) / 2;
        const [lng, lat] = getGreatCircleInterpolation(p1, p2, mid);
        if (prevLng > 0 === lng > 0) {
          // Same side as prev — haven't crossed yet
          lo = mid;
        } else {
          hi = mid;
          crossLat = lat;
        }
      }

      current.push([crossLng, crossLat]);
      segments.push(current);

      const oppositeLng = crossLng === 180 ? -180 : 180;
      current = [[oppositeLng, crossLat] as [number, number], points[i]];
    } else {
      current.push(points[i]);
    }
  }

  segments.push(current);
  return segments;
}

// =============================================================================
// --- Viewport Culling Helpers ---
// =============================================================================

/** Minimal bounds interface satisfied by maplibregl.LngLatBounds. */
export interface ViewportBounds {
  getSouthWest(): { lng: number; lat: number };
  getNorthEast(): { lng: number; lat: number };
}

/**
 * Shift `lng` into the same winding as the viewport centre so that the
 * simple min/max range check works even when MapLibre's `getBounds()`
 * returns unwrapped longitudes past ±180° (antimeridian crossing).
 */
function normalizeLngToViewport(lng: number, swLng: number, neLng: number): number {
  const center = (swLng + neLng) / 2;
  const wraps = Math.round((lng - center) / 360);
  return lng - wraps * 360;
}

/**
 * Fast bounding-box test: does a great circle route between two points
 * potentially intersect the given viewport bounds?
 *
 * We expand the route's bounding box by a generous margin to account for
 * the curvature of great circles (which can bulge significantly away from
 * the straight-line bounding box, especially on long routes).
 */
export function routeIntersectsViewport(
  originLng: number,
  originLat: number,
  destLng: number,
  destLat: number,
  bounds: ViewportBounds,
): boolean {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  // If the route crosses the antimeridian (longitude difference > 180°),
  // the simple AABB test produces an inverted bounding box that covers
  // everything *except* the actual route. These are rare long-haul routes;
  // always render them rather than attempting wrapped AABB math.
  const lngDiff = Math.abs(originLng - destLng);
  if (lngDiff > 180) return true;

  // Normalize route endpoints to the viewport's coordinate space
  originLng = normalizeLngToViewport(originLng, sw.lng, ne.lng);
  destLng = normalizeLngToViewport(destLng, sw.lng, ne.lng);

  // Calculate route bounding box
  let minLng = Math.min(originLng, destLng);
  let maxLng = Math.max(originLng, destLng);
  const minLat = Math.min(originLat, destLat);
  const maxLat = Math.max(originLat, destLat);

  // Great circle curvature margin: longer routes bulge more.
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  const margin = Math.max(latSpan, lngSpan) * 0.3 + 5;

  minLng -= margin;
  maxLng += margin;
  const adjMinLat = minLat - margin;
  const adjMaxLat = maxLat + margin;

  // AABB overlap test
  return !(maxLng < sw.lng || minLng > ne.lng || adjMaxLat < sw.lat || adjMinLat > ne.lat);
}

/**
 * Check if a single point is within viewport bounds (with margin).
 *
 * Handles the antimeridian by normalising `lng` to the viewport's
 * (possibly unwrapped) coordinate space before the range check.
 */
export function pointInViewport(
  lng: number,
  lat: number,
  bounds: ViewportBounds,
  margin: number = 5,
): boolean {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  lng = normalizeLngToViewport(lng, sw.lng, ne.lng);

  return (
    lng >= sw.lng - margin &&
    lng <= ne.lng + margin &&
    lat >= sw.lat - margin &&
    lat <= ne.lat + margin
  );
}

/**
 * Converts arc points into a GeoJSON Feature, automatically splitting at
 * the antimeridian if the route crosses it.
 */
export function makeArcFeature(points: [number, number][]): GeoJSON.Feature {
  const lines = splitAntimeridian(points);
  if (lines.length === 1) {
    return {
      type: "Feature",
      geometry: { type: "LineString", coordinates: lines[0] },
      properties: {},
    };
  }
  return {
    type: "Feature",
    geometry: { type: "MultiLineString", coordinates: lines },
    properties: {},
  };
}
