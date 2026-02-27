// ============================================================
// @acars/core — Solar Geometry (Day/Night Terminator)
// ============================================================

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const UNIX_EPOCH_JULIAN = 2440587.5;
const J2000 = 2451545.0;

type NightBand = "civil" | "astro" | "core";

export type NightOverlayFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { band: NightBand };
    geometry: { type: "Polygon"; coordinates: number[][][] };
  }>;
};

function normalizeDegrees360(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function normalizeLongitude(deg: number): number {
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

function julianDay(date: Date): number {
  return date.getTime() / 86400000 + UNIX_EPOCH_JULIAN;
}

function gmstHours(julian: number): number {
  const d = julian - J2000;
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  return gmst < 0 ? gmst + 24 : gmst;
}

function sunEclipticLongitude(julian: number): number {
  const n = julian - J2000;
  const L = normalizeDegrees360(280.46 + 0.9856474 * n);
  const g = normalizeDegrees360(357.528 + 0.9856003 * n);
  const lambda = L + 1.915 * Math.sin(g * DEG_TO_RAD) + 0.02 * Math.sin(2 * g * DEG_TO_RAD);
  return normalizeDegrees360(lambda);
}

function eclipticObliquity(julian: number): number {
  const n = julian - J2000;
  const T = n / 36525;
  return (
    23.43929111 -
    T * (46.836769 / 3600 - T * (0.0001831 / 3600 + T * (0.0020034 / 3600 - T * (0.576e-6 / 3600))))
  );
}

function sunEquatorialPosition(julian: number): {
  alpha: number;
  delta: number;
} {
  const lambda = sunEclipticLongitude(julian) * DEG_TO_RAD;
  const epsilon = eclipticObliquity(julian) * DEG_TO_RAD;
  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);
  const alpha = Math.atan2(Math.cos(epsilon) * sinLambda, cosLambda) * RAD_TO_DEG;
  const delta = Math.asin(Math.sin(epsilon) * sinLambda) * RAD_TO_DEG;
  return { alpha: normalizeDegrees360(alpha), delta };
}

export function getSolarDeclination(date: Date): number {
  const jd = julianDay(date);
  return sunEquatorialPosition(jd).delta;
}

export function getSubsolarPoint(date: Date): { lat: number; lng: number } {
  const jd = julianDay(date);
  const { alpha, delta } = sunEquatorialPosition(jd);
  const gst = gmstHours(jd);
  const lng = normalizeLongitude(alpha - gst * 15);
  return { lat: delta, lng };
}

function destinationPoint(
  lat: number,
  lng: number,
  bearingDeg: number,
  angularDistanceDeg: number,
): [number, number] {
  const lat1 = lat * DEG_TO_RAD;
  const lon1 = lng * DEG_TO_RAD;
  const bearing = bearingDeg * DEG_TO_RAD;
  const distance = angularDistanceDeg * DEG_TO_RAD;

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinDistance = Math.sin(distance);
  const cosDistance = Math.cos(distance);

  const sinLat2 = sinLat1 * cosDistance + cosLat1 * sinDistance * Math.cos(bearing);
  const lat2 = Math.asin(sinLat2);

  const y = Math.sin(bearing) * sinDistance * cosLat1;
  const x = cosDistance - sinLat1 * sinLat2;
  const lon2 = lon1 + Math.atan2(y, x);

  return [normalizeLongitude(lon2 * RAD_TO_DEG), lat2 * RAD_TO_DEG];
}

function ringArea(coords: number[][]): number {
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    sum += (x2 - x1) * (y2 + y1);
  }
  return sum;
}

function closeRing(coords: number[][]): number[][] {
  if (coords.length === 0) return coords;
  const [firstLng, firstLat] = coords[0];
  const [lastLng, lastLat] = coords[coords.length - 1];
  if (firstLng !== lastLng || firstLat !== lastLat) {
    coords.push([firstLng, firstLat]);
  }
  return coords;
}

function ensureOrientation(coords: number[][], clockwise: boolean): number[][] {
  if (coords.length < 4) return coords;
  const area = ringArea(coords);
  const isClockwise = area > 0;
  if (isClockwise !== clockwise) {
    return [...coords].reverse();
  }
  return coords;
}

function splitDateline(ring: number[][]): number[][][] {
  if (ring.length === 0) return [];
  const rings: number[][][] = [];
  let current: number[][] = [];
  const first = ring[0];
  current.push(first);

  for (let i = 1; i < ring.length; i += 1) {
    const [prevLng, prevLat] = ring[i - 1];
    const [nextLng, nextLat] = ring[i];
    const delta = nextLng - prevLng;

    if (Math.abs(delta) > 180) {
      const crossLng = prevLng > 0 ? 180 : -180;
      const t = (crossLng - prevLng) / delta;
      const crossLat = prevLat + t * (nextLat - prevLat);
      current.push([crossLng, crossLat]);
      closeRing(current);
      rings.push(current);

      const oppositeLng = crossLng === 180 ? -180 : 180;
      current = [
        [oppositeLng, crossLat],
        [nextLng, nextLat],
      ];
    } else {
      current.push([nextLng, nextLat]);
    }
  }

  closeRing(current);
  rings.push(current);
  return rings;
}

function buildDayCircle(
  subsolarLat: number,
  subsolarLng: number,
  altitudeDeg: number,
  stepDeg: number,
): number[][] {
  const radiusDeg = 90 - altitudeDeg;
  const coords: number[][] = [];
  for (let bearing = 0; bearing <= 360; bearing += stepDeg) {
    coords.push(destinationPoint(subsolarLat, subsolarLng, bearing, radiusDeg));
  }
  return closeRing(coords);
}

function buildNightPolygon(
  date: Date,
  altitudeDeg: number,
  stepDeg: number,
): { type: "Polygon"; coordinates: number[][][] } {
  const { lat, lng } = getSubsolarPoint(date);
  const dayCircle = buildDayCircle(lat, lng, altitudeDeg, stepDeg);

  const worldRing = ensureOrientation(
    closeRing([
      [-180, -90],
      [180, -90],
      [180, 90],
      [-180, 90],
      [-180, -90],
    ]),
    false,
  );

  const holes = splitDateline(dayCircle).map((ring) => ensureOrientation(ring, true));
  return {
    type: "Polygon",
    coordinates: [worldRing, ...holes],
  };
}

export type TerminatorLineCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, never>;
    geometry: { type: "LineString"; coordinates: number[][] };
  }>;
};

/**
 * Returns the solar terminator (sun altitude = 0°) as a FeatureCollection of
 * LineStrings, split at the antimeridian for correct rendering in MapLibre.
 */
export function computeTerminatorLine(date: Date, stepDeg = 1): TerminatorLineCollection {
  const { lat, lng } = getSubsolarPoint(date);
  const ring = buildDayCircle(lat, lng, 0, stepDeg);
  const segments = splitDateline(ring);
  return {
    type: "FeatureCollection",
    features: segments.map((seg) => {
      // splitDateline closes each segment for polygon use (GeoJSON rings).
      // For LineStrings, strip the closing coordinate to avoid a visual
      // loop artifact where the line snaps back to the segment's start.
      const coords =
        seg.length > 1 &&
        seg[0][0] === seg[seg.length - 1][0] &&
        seg[0][1] === seg[seg.length - 1][1]
          ? seg.slice(0, -1)
          : seg;
      return {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords },
      };
    }),
  };
}

export function computeNightOverlay(date: Date, stepDeg = 1): NightOverlayFeatureCollection {
  const bands: Array<{ band: NightBand; altitudeDeg: number }> = [
    { band: "civil", altitudeDeg: -6 },
    { band: "astro", altitudeDeg: -12 },
    { band: "core", altitudeDeg: -18 },
  ];

  return {
    type: "FeatureCollection",
    features: bands.map((band) => ({
      type: "Feature",
      properties: { band: band.band },
      geometry: buildNightPolygon(date, band.altitudeDeg, stepDeg),
    })),
  };
}
