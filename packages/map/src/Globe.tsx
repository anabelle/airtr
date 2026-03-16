import maplibregl from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { AircraftInstance, Airport, HubTier, Route } from "@acars/core";
import { getSubsolarPoint } from "@acars/core";
import { aircraftModels, HUB_CLASSIFICATIONS } from "@acars/data";
import {
  getBearing,
  getGreatCircleInterpolation,
  makeArcFeature,
  pointInViewport,
  routeIntersectsViewport,
} from "./geo.js";
import { FAMILY_ICONS, LIGHT_DOT_SVG, WING_TIP_OFFSETS } from "./icons.js";
import { resolveMapSelection } from "./interactions.js";

const NIGHT_CANVAS_W = 1024;
const NIGHT_CANVAS_H = 512;

/** Web Mercator max latitude (degrees) — matches canvas source coordinates */
const MERCATOR_MAX_LAT = 85.051129;
const DEG2RAD = Math.PI / 180;

export type MapTheme = "dark" | "light";
export const DEFAULT_MAP_THEME: MapTheme = "dark";
export const DARK_MAP_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
export const EARTH_MAP_STYLE_URL = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

type NightTint = {
  r: number;
  g: number;
  b: number;
  maxAlpha: number;
};

type MapPalette = {
  nightTint: NightTint;
  routes: {
    global: string;
    active: string;
  };
  airports: {
    playerHub: string;
    routeDestination: string;
    competitorHub: string;
    major: string;
    default: string;
    activeStroke: string;
    playerStroke: string;
    routeStroke: string;
    competitorStroke: string;
    majorStroke: string;
    defaultStroke: string;
  };
  flights: {
    fallbackAccent: string;
  };
};

/**
 * Centralized overlay palette for the lighter "earth" basemap treatment.
 *
 * Keep all shared route, airport, flight, and night-overlay colors here so
 * the map continues to read as a single coherent theme when the basemap or
 * overlay treatments are adjusted in the future.
 */
export const DARK_MAP_PALETTE: MapPalette = {
  nightTint: {
    r: 8,
    g: 10,
    b: 28,
    maxAlpha: 0.38,
  },
  routes: {
    global: "#475569",
    active: "#e94560",
  },
  airports: {
    playerHub: "#4ade80",
    routeDestination: "#e2e8f0",
    competitorHub: "#f97316",
    major: "#c6d6e8",
    default: "#8aa6c5",
    activeStroke: "#ffffff",
    playerStroke: "#e2e8f0",
    routeStroke: "#ffffff",
    competitorStroke: "#ffe0bf",
    majorStroke: "#dde7f3",
    defaultStroke: "#6f88a8",
  },
  flights: {
    fallbackAccent: "#94a3b8",
  },
};

export const EARTH_MAP_PALETTE: MapPalette = {
  nightTint: {
    r: 10,
    g: 28,
    b: 43,
    maxAlpha: 0.24,
  },
  routes: {
    global: "#4f7894",
    active: "#0ea5e9",
  },
  airports: {
    playerHub: "#4ade80",
    routeDestination: "#38bdf8",
    competitorHub: "#f97316",
    major: "#7dd3fc",
    default: "#5d88a1",
    activeStroke: "#f8fafc",
    playerStroke: "#e0f2fe",
    routeStroke: "#f8fafc",
    competitorStroke: "#ffedd5",
    majorStroke: "#e0f2fe",
    defaultStroke: "#dbeafe",
  },
  flights: {
    fallbackAccent: "#7dd3fc",
  },
};

export function getMapStyleUrl(theme: MapTheme): string {
  return theme === "light" ? EARTH_MAP_STYLE_URL : DARK_MAP_STYLE_URL;
}

export function getMapPalette(theme: MapTheme): MapPalette {
  return theme === "light" ? EARTH_MAP_PALETTE : DARK_MAP_PALETTE;
}

/**
 * Pre-computed latitude (radians) for each canvas row — computed once at
 * module load so paintNightCanvas doesn't redo the inverse Mercator every call.
 */
const _yTop =
  (1 - Math.log(Math.tan(Math.PI / 4 + (MERCATOR_MAX_LAT * DEG2RAD) / 2)) / Math.PI) / 2;
const _yBot =
  (1 - Math.log(Math.tan(Math.PI / 4 - (MERCATOR_MAX_LAT * DEG2RAD) / 2)) / Math.PI) / 2;
const ROW_LAT_RAD = new Float32Array(NIGHT_CANVAS_H);
for (let _y = 0; _y < NIGHT_CANVAS_H; _y++) {
  const _y01 = _yTop + (_y / NIGHT_CANVAS_H) * (_yBot - _yTop);
  ROW_LAT_RAD[_y] = 2 * Math.atan(Math.exp((1 - 2 * _y01) * Math.PI)) - Math.PI / 2;
}

/** Pre-computed sin/cos for each canvas column longitude — also static. */
const COL_LNG_RAD = new Float32Array(NIGHT_CANVAS_W);
for (let _x = 0; _x < NIGHT_CANVAS_W; _x++) {
  COL_LNG_RAD[_x] = ((_x / NIGHT_CANVAS_W) * 360 - 180) * DEG2RAD;
}

/**
 * Paints a smooth night-side tint onto the canvas.
 *
 * For each pixel, computes the angular distance from the subsolar point
 * and maps it to an alpha value with a smooth transition through civil
 * twilight (sun altitude 0° to −6°, angular distance 90°–96°).
 *
 * The result is a dark blue-black wash that smoothly darkens the night
 * side without pixelation at any zoom level (it's a continuous gradient).
 */
/**
 * Paints a smooth night-side tint onto the canvas.
 *
 * Uses pre-computed per-row latitude and per-column longitude tables
 * (ROW_LAT_RAD / COL_LNG_RAD) so the expensive inverse-Mercator and
 * degree→radian conversions are done only once at module load, not every
 * 60-second repaint.
 */
function paintNightCanvas(
  canvas: HTMLCanvasElement,
  subsolarLat: number,
  subsolarLng: number,
  nightTint: NightTint,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

  const sunLatRad = subsolarLat * DEG2RAD;
  const sunLngRad = subsolarLng * DEG2RAD;

  // Angular distance thresholds (radians)
  const TERMINATOR = Math.PI / 2; // 90°
  const TWILIGHT_END = (96 * Math.PI) / 180; // 96°
  const TWILIGHT_RANGE = TWILIGHT_END - TERMINATOR;

  const maxAlpha255 = Math.round(nightTint.maxAlpha * 255);

  // Sun trig — constant for all pixels
  const sinSunLat = Math.sin(sunLatRad);
  const cosSunLat = Math.cos(sunLatRad);

  for (let y = 0; y < H; y++) {
    const latRad = ROW_LAT_RAD[y];
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const latTerm = sinLat * sinSunLat;
    const latCosTerm = cosLat * cosSunLat;
    const rowBase = y * W * 4;

    for (let x = 0; x < W; x++) {
      const dLng = COL_LNG_RAD[x] - sunLngRad;
      const cosD = latTerm + latCosTerm * Math.cos(dLng);
      const dist = Math.acos(cosD < -1 ? -1 : cosD > 1 ? 1 : cosD);

      let alpha: number;
      if (dist <= TERMINATOR) {
        alpha = 0;
      } else if (dist >= TWILIGHT_END) {
        alpha = maxAlpha255;
      } else {
        const t = (dist - TERMINATOR) / TWILIGHT_RANGE;
        const s = t * t * (3 - 2 * t);
        alpha = (s * maxAlpha255 + 0.5) | 0;
      }

      const idx = rowBase + x * 4;
      data[idx] = nightTint.r;
      data[idx + 1] = nightTint.g;
      data[idx + 2] = nightTint.b;
      data[idx + 3] = alpha;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

const aircraftModelMap = new Map(aircraftModels.map((m) => [m.id, m]));

export interface GlobeProps {
  airports: Airport[];
  selectedAirport: Airport | null;
  onAirportSelect: (airport: Airport | null) => void;
  onAircraftSelect?: (aircraftId: string) => void;
  onMapClick?: () => void;
  groundPresence?: Record<string, { color: string; count: number; isPlayer?: boolean }[]>;
  fleet?: AircraftInstance[];
  /** Competitor fleet — aircraft NOT owned by the current player */
  competitorFleet?: AircraftInstance[];
  /** Competitor routes — routes NOT owned by the current player */
  competitorRoutes?: Route[];
  playerLivery?: { primary: string; secondary: string } | null;
  competitorLiveries?: Map<string, { primary: string; secondary: string }>;
  playerHubs?: string[];
  competitorHubColors?: Map<string, string>;
  playerRouteDestinations?: Set<string>;
  tick?: number;
  tickProgress?: number;
  /** Map palette mode. Use "dark" for the original night-focused treatment or "light" for the earth-toned style. */
  theme?: MapTheme;
  className?: string;
  style?: React.CSSProperties;
}

const NIGHT_CANVAS_SOURCE = "night-canvas";
const NIGHT_CANVAS_LAYER = "night-canvas-layer";

// =============================================================================
// --- LOD: Adaptive segment count based on zoom level ---
// =============================================================================

/**
 * Returns the number of arc segments to use based on the current map zoom.
 * At low zooms, arcs are small on screen and need fewer segments.
 * At high zooms, arcs are large and need more segments for smooth curves.
 */
function getSegmentCount(zoom: number): number {
  if (zoom < 2) return 8;
  if (zoom < 4) return 16;
  if (zoom < 6) return 24;
  if (zoom < 8) return 36;
  return 50;
}

type AirportClass =
  | "active-hub"
  | "player-hub"
  | "route-dest"
  | "competitor-hub"
  | "major"
  | "default";

const MAJOR_HUB_TIERS = new Set<HubTier>(["global", "international"]);

function isMajorAirport(airport: Airport): boolean {
  const tier = HUB_CLASSIFICATIONS[airport.iata]?.tier;
  if (tier && MAJOR_HUB_TIERS.has(tier)) return true;
  return airport.population >= 5_000_000;
}

// =============================================================================
// --- Arc Geometry Cache ---
// =============================================================================

/**
 * Cache key for a route arc. We use origin+dest IATA since the geometry
 * is purely a function of the two endpoints and the segment count.
 */
function arcCacheKey(originIata: string, destIata: string, segments: number): string {
  return `${originIata}-${destIata}-${segments}`;
}

function buildPresenceBadge(segments: { color: string; count: number }[], size: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new ImageData(size, size);

  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  if (total <= 0) return new ImageData(size, size);

  const center = size / 2;
  const radius = size / 2 - 2;
  let startAngle = -Math.PI / 2;

  ctx.lineWidth = Math.max(2, size * 0.18);

  for (const segment of segments) {
    if (segment.count <= 0) continue;
    const slice = (segment.count / total) * Math.PI * 2;
    ctx.strokeStyle = segment.color;
    ctx.beginPath();
    ctx.arc(center, center, radius, startAngle, startAngle + slice, false);
    ctx.stroke();
    startAngle += slice;
  }

  return ctx.getImageData(0, 0, size, size);
}

// =============================================================================
// --- Globe Component ---
// =============================================================================

export function Globe({
  airports,
  selectedAirport,
  onAirportSelect,
  onAircraftSelect,
  groundPresence,
  fleet = [],
  competitorFleet = [],
  competitorRoutes = [],
  playerLivery = null,
  competitorLiveries = new Map(),
  playerHubs = [],
  competitorHubColors = new Map(),
  playerRouteDestinations = new Set(),
  tick = 0,
  tickProgress = 0,
  theme = DEFAULT_MAP_THEME,
  className = "",
  style,
  onMapClick,
}: GlobeProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const hasInitialFlied = useRef(false);

  // -------------------------------------------------------------------------
  // Optimization 1: O(1) airport lookup via Map<iata, Airport>
  // Eliminates ~240M string comparisons at 10K scale.
  // -------------------------------------------------------------------------
  const airportIndex = useMemo(() => {
    const idx = new Map<string, Airport>();
    for (const a of airports) {
      idx.set(a.iata, a);
    }
    return idx;
  }, [airports]);

  // -------------------------------------------------------------------------
  // Optimization 2: Memoized arc geometry cache for static routes.
  // Global routes rarely change, so we cache their computed LineString
  // coordinates keyed by origin-dest-segments.
  // -------------------------------------------------------------------------
  const arcCache = useRef(new Map<string, [number, number][]>());

  /**
   * Get or compute arc geometry. Returns cached result if available.
   */
  const getOrComputeArc = useCallback(
    (origin: Airport, dest: Airport, segments: number): [number, number][] => {
      const key = arcCacheKey(origin.iata, dest.iata, segments);
      const cached = arcCache.current.get(key);
      if (cached) return cached;

      const points: [number, number][] = [];
      const p1: [number, number] = [origin.longitude, origin.latitude];
      const p2: [number, number] = [dest.longitude, dest.latitude];
      for (let i = 0; i <= segments; i++) {
        points.push(getGreatCircleInterpolation(p1, p2, i / segments));
      }
      arcCache.current.set(key, points);
      return points;
    },
    [],
  );

  // Invalidate arc cache when zoom changes LOD tier (segment count changes).
  const lastSegmentCount = useRef<number>(0);

  // -------------------------------------------------------------------------
  // Refs for requestAnimationFrame-based flight animation
  // -------------------------------------------------------------------------
  const rafId = useRef<number>(0);
  const nightOverlayTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const nightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestTick = useRef(tick);
  const latestTickProgress = useRef(tickProgress);
  const latestFleet = useRef(fleet);
  const latestGlobalFleet = useRef(competitorFleet);
  const latestPlayerLivery = useRef(playerLivery);
  const latestCompetitorLiveries = useRef(competitorLiveries);
  const latestPlayerHubs = useRef(playerHubs);
  const latestCompetitorHubColors = useRef(competitorHubColors);
  const latestPlayerRouteDestinations = useRef(playerRouteDestinations);
  const latestGroundPresence = useRef(groundPresence);
  const latestOnAirportSelect = useRef(onAirportSelect);
  const latestOnAircraftSelect = useRef(onAircraftSelect);
  const latestOnMapClick = useRef(onMapClick);

  // Keep refs in sync with props (avoid stale closures in RAF loop).
  // Consolidated into one effect to avoid 11 separate scheduler entries.
  useEffect(() => {
    latestOnAirportSelect.current = onAirportSelect;
    latestOnAircraftSelect.current = onAircraftSelect;
    latestOnMapClick.current = onMapClick;
    latestTick.current = tick;
    latestTickProgress.current = tickProgress;
    latestFleet.current = fleet;
    latestGlobalFleet.current = competitorFleet;
    latestPlayerLivery.current = playerLivery;
    latestCompetitorLiveries.current = competitorLiveries;
    latestPlayerHubs.current = playerHubs;
    latestCompetitorHubColors.current = competitorHubColors;
    latestPlayerRouteDestinations.current = playerRouteDestinations;
    latestGroundPresence.current = groundPresence;
  }, [
    onAirportSelect,
    onAircraftSelect,
    onMapClick,
    tick,
    tickProgress,
    fleet,
    competitorFleet,
    playerLivery,
    competitorLiveries,
    playerHubs,
    competitorHubColors,
    playerRouteDestinations,
    groundPresence,
  ]);

  // =========================================================================
  // Map Initialization (runs once)
  //
  // React 18+ StrictMode double-mounts in dev: Mount -> Unmount -> Re-mount.
  // Calling map.remove() synchronously on unmount destroys the WebGL context
  // before the re-mount can rescue it. We defer cleanup via setTimeout so
  // StrictMode's immediate re-mount can cancel the pending removal.
  // =========================================================================
  const cleanupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapThemePalette = useMemo(() => getMapPalette(theme), [theme]);

  useEffect(() => {
    // If a deferred cleanup is pending from a previous unmount, cancel it —
    // StrictMode is re-mounting us and the map is still alive.
    if (cleanupTimer.current) {
      clearTimeout(cleanupTimer.current);
      cleanupTimer.current = null;
    }

    // If the map already exists (StrictMode re-mount), just re-sync state.
    if (mapRef.current) {
      // The map is still attached to our container div (React reuses the
      // same DOM node for the re-mount), so we just need to ensure our
      // React state reflects that the map is ready.
      if (mapRef.current.loaded()) {
        setMapLoaded(true);
      } else {
        mapRef.current.once("load", () => setMapLoaded(true));
      }
      return () => {
        cleanupTimer.current = setTimeout(() => {
          mapRef.current?.remove();
          mapRef.current = null;
        }, 100);
      };
    }

    if (!mapContainer.current) return;

    // Load saved view state
    const savedView = localStorage.getItem("acars_map_view");
    let initialCenter: [number, number] = [0, 20];
    let initialZoom = 1.5;

    if (savedView) {
      try {
        const { center, zoom } = JSON.parse(savedView);
        initialCenter = center;
        initialZoom = zoom;
        hasInitialFlied.current = true;
      } catch (e) {
        console.warn("Failed to parse saved map view", e);
      }
    }

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: getMapStyleUrl(theme),
      center: initialCenter,
      zoom: initialZoom,
      pitch: 0,
      clickTolerance: 10,
    });

    map.doubleClickZoom.disable();

    // Persist view changes
    const saveView = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      localStorage.setItem(
        "acars_map_view",
        JSON.stringify({
          center: [center.lng, center.lat],
          zoom,
        }),
      );
    };

    map.on("moveend", saveView);
    map.on("zoomend", saveView);
    let cursorFrame: number | null = null;
    let pendingCursorPoint: { x: number; y: number } | null = null;

    map.on("load", () => {
      setMapLoaded(true);

      // Helper to add SVG to map as SDF
      const addIcon = (id: string, svg: string) => {
        const img = new Image();
        img.onload = () => {
          if (!map.hasImage(id)) {
            map.addImage(id, img, { sdf: true });
          }
        };
        img.src = "data:image/svg+xml;base64," + btoa(svg);
      };

      // Register per-family icons (12 families × 2 layers = 24 icons)
      for (const [familyId, svgs] of Object.entries(FAMILY_ICONS)) {
        addIcon(`airplane-${familyId}`, svgs.body);
        addIcon(`airplane-${familyId}-accent`, svgs.accent);
      }
      // Backward-compatible fallback alias
      addIcon("airplane-icon", FAMILY_ICONS["a320"].body);
      addIcon("airplane-icon-accent", FAMILY_ICONS["a320"].accent);

      // Register navigation light icon (single SDF circle, positioned via icon-offset)
      addIcon("light-dot", LIGHT_DOT_SVG);

      // --- Night canvas source (smooth solar gradient) ---
      const nightCanvas = document.createElement("canvas");
      nightCanvas.width = NIGHT_CANVAS_W;
      nightCanvas.height = NIGHT_CANVAS_H;
      nightCanvasRef.current = nightCanvas;

      // Paint immediately
      const sun = getSubsolarPoint(new Date());
      paintNightCanvas(nightCanvas, sun.lat, sun.lng, mapThemePalette.nightTint);

      map.addSource(NIGHT_CANVAS_SOURCE, {
        type: "canvas",
        canvas: nightCanvas,
        coordinates: [
          [-180, 85.051129],
          [180, 85.051129],
          [180, -85.051129],
          [-180, -85.051129],
        ],
        animate: true,
      });
      map.addLayer({
        id: NIGHT_CANVAS_LAYER,
        type: "raster",
        source: NIGHT_CANVAS_SOURCE,
        paint: {
          "raster-opacity": 1.0,
          "raster-resampling": "linear",
          "raster-fade-duration": 0,
        },
      });

      map.addSource("flights", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("arcs", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("global-flights", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("global-arcs", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("airports", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Layer: Global Arcs
      map.addLayer({
        id: "global-arcs-layer",
        type: "line",
        source: "global-arcs",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": mapThemePalette.routes.global,
          "line-width": 0.5,
          "line-opacity": 0.2,
        },
      });

      // Layer: Active Flight Arcs (dashed)
      map.addLayer({
        id: "arcs-layer",
        type: "line",
        source: "arcs",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": mapThemePalette.routes.active,
          "line-width": 1,
          "line-opacity": 0.3,
          "line-dasharray": [2, 2],
        },
      });

      // Layer: Active Hub Glow
      map.addLayer({
        id: "active-hub-glow",
        type: "circle",
        source: "airports",
        filter: ["==", ["get", "airportClass"], "active-hub"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 6, 6, 14, 10, 22],
          "circle-color": [
            "coalesce",
            ["get", "playerHubColor"],
            mapThemePalette.airports.playerHub,
          ],
          "circle-opacity": 0.4,
          "circle-blur": 0.8,
        },
      });

      // Layer: Airports
      map.addLayer({
        id: "airports-layer",
        type: "circle",
        source: "airports",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            [
              "match",
              ["get", "airportClass"],
              "active-hub",
              3.5,
              "player-hub",
              3,
              "route-dest",
              2.1,
              "competitor-hub",
              2.9,
              "major",
              2,
              1.6,
            ],
            6,
            [
              "match",
              ["get", "airportClass"],
              "active-hub",
              7,
              "player-hub",
              6,
              "route-dest",
              3.5,
              "competitor-hub",
              5.8,
              "major",
              3.5,
              2.3,
            ],
            10,
            [
              "match",
              ["get", "airportClass"],
              "active-hub",
              12,
              "player-hub",
              9,
              "route-dest",
              4.6,
              "competitor-hub",
              8.6,
              "major",
              4,
              2.8,
            ],
          ],
          "circle-color": [
            "match",
            ["get", "airportClass"],
            "active-hub",
            ["coalesce", ["get", "playerHubColor"], mapThemePalette.airports.playerHub],
            "player-hub",
            ["coalesce", ["get", "playerHubColor"], mapThemePalette.airports.playerHub],
            "route-dest",
            mapThemePalette.airports.routeDestination,
            "competitor-hub",
            ["coalesce", ["get", "competitorHubColor"], mapThemePalette.airports.competitorHub],
            "major",
            mapThemePalette.airports.major,
            mapThemePalette.airports.default,
          ],
          "circle-opacity": [
            "match",
            ["get", "airportClass"],
            "active-hub",
            1,
            "player-hub",
            0.85,
            "route-dest",
            0.65,
            "competitor-hub",
            0.6,
            "major",
            0.55,
            0.35,
          ],
          "circle-stroke-width": [
            "match",
            ["get", "airportClass"],
            "active-hub",
            2,
            "player-hub",
            1.5,
            "route-dest",
            0.8,
            "competitor-hub",
            1,
            "major",
            0.8,
            0.4,
          ],
          "circle-stroke-color": [
            "match",
            ["get", "airportClass"],
            "active-hub",
            mapThemePalette.airports.activeStroke,
            "player-hub",
            mapThemePalette.airports.playerStroke,
            "route-dest",
            mapThemePalette.airports.routeStroke,
            "competitor-hub",
            mapThemePalette.airports.competitorStroke,
            "major",
            mapThemePalette.airports.majorStroke,
            mapThemePalette.airports.defaultStroke,
          ],
        },
      });

      // Layer: Ground Presence (multi-airline ring)
      map.addLayer({
        id: "ground-presence-layer",
        type: "symbol",
        source: "airports",
        filter: [">", ["get", "groundPresenceCount"], 0],
        minzoom: 3,
        layout: {
          "icon-image": ["get", "groundPresenceIcon"],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.45, 8, 0.8, 12, 1.15],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.35, 6, 0.7, 10, 0.95],
        },
      });

      // Layer: Global Flights (body — primary color)
      map.addLayer({
        id: "global-flights-layer",
        type: "symbol",
        source: "global-flights",
        layout: {
          "icon-image": [
            "match",
            ["get", "familyId"],
            "atr",
            "airplane-atr",
            "dash8",
            "airplane-dash8",
            "a220",
            "airplane-a220",
            "ejet",
            "airplane-ejet",
            "a320",
            "airplane-a320",
            "b737",
            "airplane-b737",
            "a330",
            "airplane-a330",
            "b787",
            "airplane-b787",
            "b777",
            "airplane-b777",
            "a350",
            "airplane-a350",
            "a380",
            "airplane-a380",
            "b747",
            "airplane-b747",
            "airplane-a320",
          ],
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            2,
            ["*", ["get", "sizeScale"], 0.15],
            5,
            ["*", ["get", "sizeScale"], 0.4],
            8,
            ["*", ["get", "sizeScale"], 0.7],
            12,
            ["*", ["get", "sizeScale"], 1.0],
          ],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-anchor": "center",
        },
        paint: {
          "icon-color": ["coalesce", ["get", "primaryColor"], "#64748b"],
          "icon-opacity": 0.8,
        },
      });

      // Layer: Global Flights (accent — secondary color)
      map.addLayer({
        id: "global-flights-accent-layer",
        type: "symbol",
        source: "global-flights",
        layout: {
          "icon-image": [
            "match",
            ["get", "familyId"],
            "atr",
            "airplane-atr-accent",
            "dash8",
            "airplane-dash8-accent",
            "a220",
            "airplane-a220-accent",
            "ejet",
            "airplane-ejet-accent",
            "a320",
            "airplane-a320-accent",
            "b737",
            "airplane-b737-accent",
            "a330",
            "airplane-a330-accent",
            "b787",
            "airplane-b787-accent",
            "b777",
            "airplane-b777-accent",
            "a350",
            "airplane-a350-accent",
            "a380",
            "airplane-a380-accent",
            "b747",
            "airplane-b747-accent",
            "airplane-a320-accent",
          ],
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            2,
            ["*", ["get", "sizeScale"], 0.15],
            5,
            ["*", ["get", "sizeScale"], 0.4],
            8,
            ["*", ["get", "sizeScale"], 0.7],
            12,
            ["*", ["get", "sizeScale"], 1.0],
          ],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-anchor": "center",
        },
        paint: {
          "icon-color": ["coalesce", ["get", "secondaryColor"], "#94a3b8"],
          "icon-opacity": 0.8,
        },
      });

      // Layer: Active Flights — body (primary color)
      map.addLayer({
        id: "flights-layer",
        type: "symbol",
        source: "flights",
        layout: {
          "icon-image": [
            "match",
            ["get", "familyId"],
            "atr",
            "airplane-atr",
            "dash8",
            "airplane-dash8",
            "a220",
            "airplane-a220",
            "ejet",
            "airplane-ejet",
            "a320",
            "airplane-a320",
            "b737",
            "airplane-b737",
            "a330",
            "airplane-a330",
            "b787",
            "airplane-b787",
            "b777",
            "airplane-b777",
            "a350",
            "airplane-a350",
            "a380",
            "airplane-a380",
            "b747",
            "airplane-b747",
            "airplane-a320",
          ],
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            2,
            ["*", ["get", "sizeScale"], 0.15],
            5,
            ["*", ["get", "sizeScale"], 0.4],
            8,
            ["*", ["get", "sizeScale"], 0.7],
            12,
            ["*", ["get", "sizeScale"], 1.0],
          ],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-anchor": "center",
        },
        paint: {
          "icon-color": ["coalesce", ["get", "primaryColor"], "#ffffff"],
        },
      });

      // Layer: Active Flights — accent (secondary color)
      map.addLayer({
        id: "flights-accent-layer",
        type: "symbol",
        source: "flights",
        layout: {
          "icon-image": [
            "match",
            ["get", "familyId"],
            "atr",
            "airplane-atr-accent",
            "dash8",
            "airplane-dash8-accent",
            "a220",
            "airplane-a220-accent",
            "ejet",
            "airplane-ejet-accent",
            "a320",
            "airplane-a320-accent",
            "b737",
            "airplane-b737-accent",
            "a330",
            "airplane-a330-accent",
            "b787",
            "airplane-b787-accent",
            "b777",
            "airplane-b777-accent",
            "a350",
            "airplane-a350-accent",
            "a380",
            "airplane-a380-accent",
            "b747",
            "airplane-b747-accent",
            "airplane-a320-accent",
          ],
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            2,
            ["*", ["get", "sizeScale"], 0.15],
            5,
            ["*", ["get", "sizeScale"], 0.4],
            8,
            ["*", ["get", "sizeScale"], 0.7],
            12,
            ["*", ["get", "sizeScale"], 1.0],
          ],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-anchor": "center",
        },
        paint: {
          "icon-color": ["coalesce", ["get", "secondaryColor"], "#cbd5e1"],
        },
      });

      // Layer: Flight glow
      map.addLayer(
        {
          id: "flight-glow",
          type: "circle",
          source: "flights",
          paint: {
            "circle-radius": 14,
            "circle-color": [
              "coalesce",
              ["get", "secondaryColor"],
              mapThemePalette.flights.fallbackAccent,
            ],
            "circle-opacity": 0.25,
            "circle-blur": 1.5,
          },
        },
        "flights-layer",
      );

      // Navigation light layers (port/starboard/strobe for each flight source)
      // Build per-family icon-offset match expressions from WING_TIP_OFFSETS
      const portOffsetExpr = [
        "match",
        ["get", "familyId"],
        ...Object.entries(WING_TIP_OFFSETS).flatMap(([fam, [px, py]]) => [
          fam,
          ["literal", [px, py]],
        ]),
        ["literal", [-20, 3]],
      ] as unknown as maplibregl.ExpressionSpecification;
      const stbdOffsetExpr = [
        "match",
        ["get", "familyId"],
        ...Object.entries(WING_TIP_OFFSETS).flatMap(([fam, [px, py]]) => [
          fam,
          ["literal", [-px, py]],
        ]),
        ["literal", [20, 3]],
      ] as unknown as maplibregl.ExpressionSpecification;
      // Keep icon-size scaling identical to aircraft icons so wing-tip offsets
      // remain aligned per family and wingspan across zoom levels.
      const lightIconSizeExpr: maplibregl.ExpressionSpecification = [
        "interpolate",
        ["linear"],
        ["zoom"],
        2,
        ["*", ["get", "sizeScale"], 0.15],
        5,
        ["*", ["get", "sizeScale"], 0.4],
        8,
        ["*", ["get", "sizeScale"], 0.7],
        12,
        ["*", ["get", "sizeScale"], 1.0],
      ];
      const addLightLayers = (sourceId: string, prefix: string, baseOpacity: number) => {
        const sharedLayout: maplibregl.SymbolLayerSpecification["layout"] = {
          "icon-image": "light-dot",
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-anchor": "center",
          "icon-size": lightIconSizeExpr,
        };
        // Port light (red, steady)
        map.addLayer({
          id: `${prefix}-light-port`,
          type: "symbol",
          source: sourceId,
          minzoom: 4,
          layout: {
            ...sharedLayout,
            "icon-offset": portOffsetExpr,
          },
          paint: {
            "icon-color": "#ff0000",
            "icon-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 5, baseOpacity],
            "icon-halo-color": "#ff0000",
            "icon-halo-width": 0.4,
            "icon-halo-blur": 0.2,
          },
        });
        // Starboard light (green, steady)
        map.addLayer({
          id: `${prefix}-light-stbd`,
          type: "symbol",
          source: sourceId,
          minzoom: 4,
          layout: {
            ...sharedLayout,
            "icon-offset": stbdOffsetExpr,
          },
          paint: {
            "icon-color": "#00ff00",
            "icon-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 5, baseOpacity],
            "icon-halo-color": "#00ff00",
            "icon-halo-width": 0.4,
            "icon-halo-blur": 0.2,
          },
        });
        // Strobe light — offset symbol pulse so white flash is not hidden by fuselage.
        const strobeIconSizeExpr: maplibregl.ExpressionSpecification = [
          "interpolate",
          ["linear"],
          ["zoom"],
          2,
          ["*", ["get", "sizeScale"], 0.22],
          5,
          ["*", ["get", "sizeScale"], 0.55],
          8,
          ["*", ["get", "sizeScale"], 0.9],
          12,
          ["*", ["get", "sizeScale"], 1.25],
        ];
        map.addLayer({
          id: `${prefix}-light-strobe`,
          type: "symbol",
          source: sourceId,
          minzoom: 4,
          layout: {
            ...sharedLayout,
            "icon-size": strobeIconSizeExpr,
            "icon-offset": [0, 8],
          },
          paint: {
            "icon-color": "#ffffff",
            // zoom must be the top-level expression input — cannot be nested
            // inside arithmetic. Use step+case: fade in at zoom 5, then
            // gate the opacity on the per-feature strobeOn flag.
            "icon-opacity": [
              "step",
              ["zoom"],
              0, // below minzoom 4 → always 0
              4,
              ["case", ["==", ["get", "strobeOn"], 1], 0, 0],
              5,
              ["case", ["==", ["get", "strobeOn"], 1], baseOpacity, 0],
            ],
            "icon-halo-color": "#ffffff",
            "icon-halo-width": [
              "step",
              ["zoom"],
              0,
              4,
              ["case", ["==", ["get", "strobeOn"], 1], 0.8, 0],
              5,
              ["case", ["==", ["get", "strobeOn"], 1], 1.8, 0],
            ],
            "icon-halo-blur": ["case", ["==", ["get", "strobeOn"], 1], 0.8, 0],
          },
        });
      };
      addLightLayers("global-flights", "global-flight", 0.6);
      addLightLayers("flights", "flight", 0.9);
      const queryRenderedFeatures = map.queryRenderedFeatures.bind(map);
      const setCursor = (cursor: string) => {
        map.getCanvas().style.cursor = cursor;
      };
      const updateCursor = () => {
        cursorFrame = null;

        if (!pendingCursorPoint) return;

        const selection = resolveMapSelection(pendingCursorPoint, queryRenderedFeatures);
        setCursor(selection ? "pointer" : "");
      };

      map.on("click", (e) => {
        const selection = resolveMapSelection(e.point, queryRenderedFeatures);

        if (selection?.type === "airport") {
          latestOnAirportSelect.current?.(selection.airport);
          return;
        }

        if (selection?.type === "aircraft") {
          latestOnAircraftSelect.current?.(selection.aircraftId);
          return;
        }

        latestOnMapClick.current?.();
      });

      map.on("mousemove", (e) => {
        pendingCursorPoint = e.point;
        if (cursorFrame !== null) return;
        cursorFrame = requestAnimationFrame(updateCursor);
      });

      map.on("mouseleave", () => {
        pendingCursorPoint = null;
        if (cursorFrame !== null) {
          cancelAnimationFrame(cursorFrame);
          cursorFrame = null;
        }
        setCursor("");
      });
    });

    mapRef.current = map;
    return () => {
      if (cursorFrame !== null) {
        cancelAnimationFrame(cursorFrame);
      }
      cleanupTimer.current = setTimeout(() => {
        mapRef.current?.remove();
        mapRef.current = null;
      }, 100);
    };
  }, [theme, mapThemePalette]);

  // =========================================================================
  // Sync airports & arcs (reactive to fleet/routes state changes)
  //
  // Optimizations applied:
  //  - O(1) airport lookups via airportIndex
  //  - Viewport culling: skip arcs outside current view
  //  - LOD: adaptive segment count based on zoom level
  //  - Arc memoization: cache computed arc geometry
  // =========================================================================
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const zoom = map.getZoom();
    const segments = getSegmentCount(zoom);
    const bounds = map.getBounds();

    // Invalidate arc cache if LOD tier changed
    if (segments !== lastSegmentCount.current) {
      arcCache.current.clear();
      lastSegmentCount.current = segments;
    }

    const classifyAirport = (
      airport: Airport,
    ): {
      airportClass: AirportClass;
      competitorHubColor?: string;
      playerHubColor?: string | null;
    } => {
      const hubs = playerHubs;
      const routeDestinations = playerRouteDestinations;
      const competitorColors = competitorHubColors;
      const playerColor = latestPlayerLivery.current?.primary ?? null;

      if (hubs[0] === airport.iata) {
        return { airportClass: "active-hub", playerHubColor: playerColor };
      }
      if (hubs.includes(airport.iata)) {
        return { airportClass: "player-hub", playerHubColor: playerColor };
      }
      const competitorHubColor = competitorColors.get(airport.iata);
      if (competitorHubColor) return { airportClass: "competitor-hub", competitorHubColor };
      if (routeDestinations.has(airport.iata)) return { airportClass: "route-dest" };
      if (isMajorAirport(airport)) return { airportClass: "major" };
      return { airportClass: "default" };
    };

    // --- Airport GeoJSON (classified) ---
    const presence = latestGroundPresence.current;
    const existingPresenceImages = new Set(
      map.listImages().filter((name) => name.startsWith("presence-")),
    );
    const activePresenceImages = new Set<string>();

    const airportGeojson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: airports.map((a) => {
        const classification = classifyAirport(a);
        const presenceSegments = presence?.[a.iata] ?? [];
        const presenceKey = presenceSegments.length
          ? `presence-${a.iata}-${presenceSegments.map((segment) => `${segment.color}-${segment.count}`).join("-")}`
          : null;

        if (presenceKey && !map.hasImage(presenceKey)) {
          const canvas = buildPresenceBadge(presenceSegments, 64);
          map.addImage(presenceKey, canvas, { pixelRatio: 2 });
        }
        if (presenceKey) activePresenceImages.add(presenceKey);

        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [a.longitude, a.latitude] },
          properties: {
            ...a,
            groundPresenceCount: presenceSegments.reduce((sum, segment) => sum + segment.count, 0),
            groundPresenceIcon: presenceKey,
            ...classification,
          },
        };
      }),
    };

    for (const imageId of existingPresenceImages) {
      if (!activePresenceImages.has(imageId)) {
        map.removeImage(imageId);
      }
    }

    // --- Player flight arcs (with culling + LOD + caching) ---
    const arcFeatures: GeoJSON.Feature[] = [];
    for (const ac of fleet) {
      if (ac.status !== "enroute" || !ac.flight) continue;
      const origin = airportIndex.get(ac.flight.originIata);
      const dest = airportIndex.get(ac.flight.destinationIata);
      if (!origin || !dest) continue;

      // Viewport culling
      if (
        !routeIntersectsViewport(
          origin.longitude,
          origin.latitude,
          dest.longitude,
          dest.latitude,
          bounds,
        )
      )
        continue;

      const points = getOrComputeArc(origin, dest, segments);
      arcFeatures.push(makeArcFeature(points));
    }

    // --- Global route arcs (with culling + LOD + caching) ---
    const globalArcFeatures: GeoJSON.Feature[] = [];
    for (const route of competitorRoutes) {
      const origin = airportIndex.get(route.originIata);
      const dest = airportIndex.get(route.destinationIata);
      if (!origin || !dest) continue;

      // Viewport culling
      if (
        !routeIntersectsViewport(
          origin.longitude,
          origin.latitude,
          dest.longitude,
          dest.latitude,
          bounds,
        )
      )
        continue;

      const points = getOrComputeArc(origin, dest, segments);
      globalArcFeatures.push(makeArcFeature(points));
    }

    (map.getSource("airports") as maplibregl.GeoJSONSource)?.setData(airportGeojson);
    (map.getSource("arcs") as maplibregl.GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: arcFeatures,
    });
    (map.getSource("global-arcs") as maplibregl.GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: globalArcFeatures,
    });
  }, [
    airports,
    mapLoaded,
    fleet,
    competitorRoutes,
    airportIndex,
    getOrComputeArc,
    playerHubs,
    competitorHubColors,
    playerRouteDestinations,
  ]);

  // =========================================================================
  // Re-render arcs on viewport change (zoom/pan) for culling + LOD
  //
  // We debounce this to avoid recomputing on every pixel of a pan gesture.
  // =========================================================================
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const onViewChange = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Re-trigger arc computation by touching fleet/routes deps
        // We do this by dispatching the same update logic inline.
        const zoom = map.getZoom();
        const segments = getSegmentCount(zoom);
        const bounds = map.getBounds();

        if (segments !== lastSegmentCount.current) {
          arcCache.current.clear();
          lastSegmentCount.current = segments;
        }

        const arcFeatures: GeoJSON.Feature[] = [];
        for (const ac of latestFleet.current) {
          if (ac.status !== "enroute" || !ac.flight) continue;
          const origin = airportIndex.get(ac.flight.originIata);
          const dest = airportIndex.get(ac.flight.destinationIata);
          if (!origin || !dest) continue;
          if (
            !routeIntersectsViewport(
              origin.longitude,
              origin.latitude,
              dest.longitude,
              dest.latitude,
              bounds,
            )
          )
            continue;
          const points = getOrComputeArc(origin, dest, segments);
          arcFeatures.push(makeArcFeature(points));
        }

        const globalArcFeatures: GeoJSON.Feature[] = [];
        for (const route of competitorRoutes) {
          const origin = airportIndex.get(route.originIata);
          const dest = airportIndex.get(route.destinationIata);
          if (!origin || !dest) continue;
          if (
            !routeIntersectsViewport(
              origin.longitude,
              origin.latitude,
              dest.longitude,
              dest.latitude,
              bounds,
            )
          )
            continue;
          const points = getOrComputeArc(origin, dest, segments);
          globalArcFeatures.push(makeArcFeature(points));
        }

        (map.getSource("arcs") as maplibregl.GeoJSONSource)?.setData({
          type: "FeatureCollection",
          features: arcFeatures,
        });
        (map.getSource("global-arcs") as maplibregl.GeoJSONSource)?.setData({
          type: "FeatureCollection",
          features: globalArcFeatures,
        });
      }, 150); // 150ms debounce
    };

    map.on("moveend", onViewChange);
    map.on("zoomend", onViewChange);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      map.off("moveend", onViewChange);
      map.off("zoomend", onViewChange);
    };
  }, [mapLoaded, airportIndex, getOrComputeArc, competitorRoutes]);

  // =========================================================================
  // REAL-TIME MOVEMENT: requestAnimationFrame-based 60fps interpolation
  //
  // Instead of computing positions every 1s via setInterval, we run a
  // smooth RAF loop that interpolates aircraft positions at display refresh
  // rate. This uses sub-tick progress from the engine store combined with
  // frame-level interpolation for buttery smooth movement.
  //
  // Optimizations applied:
  //  - O(1) airport lookups
  //  - Viewport culling: skip off-screen aircraft
  //  - RAF loop with map idle detection (pauses when map is hidden)
  // =========================================================================
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    const updateNightOverlay = () => {
      if (!nightCanvasRef.current) return;
      const canvas = nightCanvasRef.current;
      const sun = getSubsolarPoint(new Date());
      // Use requestIdleCallback when available so the ~2ms pixel-fill doesn't
      // land on a busy animation frame.  Falls back to a simple timeout.
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(
          () => paintNightCanvas(canvas, sun.lat, sun.lng, mapThemePalette.nightTint),
          {
            timeout: 2000,
          },
        );
      } else {
        setTimeout(() => paintNightCanvas(canvas, sun.lat, sun.lng, mapThemePalette.nightTint), 0);
      }
    };

    updateNightOverlay();
    nightOverlayTimer.current = setInterval(updateNightOverlay, 60000);

    const processFleet = (
      targetFleet: AircraftInstance[],
      currentTick: number,
      currentProgress: number,
      bounds: maplibregl.LngLatBounds,
      resolveColor: (ac: AircraftInstance) => { primary?: string; secondary?: string } | undefined,
      baseSize: number,
      now: number,
    ): GeoJSON.Feature[] => {
      const features: GeoJSON.Feature[] = [];
      for (const ac of targetFleet) {
        if (ac.status !== "enroute" || !ac.flight) continue;
        const f = ac.flight;
        const origin = airportIndex.get(f.originIata);
        const dest = airportIndex.get(f.destinationIata);
        if (!origin || !dest) continue;

        const duration = Math.max(1, f.arrivalTick - f.departureTick);
        const elapsed = currentTick - f.departureTick + currentProgress;
        const progress = Math.max(0, Math.min(1, elapsed / duration));

        const p1: [number, number] = [origin.longitude, origin.latitude];
        const p2: [number, number] = [dest.longitude, dest.latitude];
        const coords = getGreatCircleInterpolation(p1, p2, progress);

        // Viewport culling for individual aircraft
        if (!pointInViewport(coords[0], coords[1], bounds)) continue;

        // Compute bearing analytically at current progress without a second
        // SLERP call — sample a tiny step forward (0.5% of route) instead.
        // This halves getGreatCircleInterpolation calls per frame.
        const nextCoords = getGreatCircleInterpolation(p1, p2, Math.min(1, progress + 0.005));
        const bearing = getBearing(coords, nextCoords);

        const model = aircraftModelMap.get(ac.modelId);
        const familyId = model?.familyId || "a320";
        const wingspanM = model?.wingspanM || 35.8;
        const colors = resolveColor(ac);

        // Per-aircraft strobe phase uses ID + departure tick to avoid synchronization.
        // 1.8s cycle with 500ms pulse keeps the flash clearly visible.
        const idPhase =
          ((ac.id.charCodeAt(0) || 0) * 31 +
            (ac.id.charCodeAt(ac.id.length - 1) || 0) * 17 +
            f.departureTick) %
          1800;
        const strobeOn = (now + idPhase) % 1800 < 500 ? 1 : 0;

        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: coords },
          properties: {
            id: ac.id,
            bearing,
            familyId,
            sizeScale: (wingspanM / 35.8) * baseSize,
            strobeOn,
            ...(colors?.primary ? { primaryColor: colors.primary } : {}),
            ...(colors?.secondary ? { secondaryColor: colors.secondary } : {}),
          },
        });
      }
      return features;
    };

    let isAnimating = true;

    let lastFrame = 0;
    const animate = (now: number) => {
      if (!isAnimating || !mapRef.current) return;
      if (document.hidden) {
        rafId.current = requestAnimationFrame(animate);
        return;
      }
      if (now - lastFrame < 66) {
        rafId.current = requestAnimationFrame(animate);
        return;
      }
      lastFrame = now;

      const bounds = map.getBounds();
      const currentTick = latestTick.current;
      const currentProgress = latestTickProgress.current;

      const flightFeatures = processFleet(
        latestFleet.current,
        currentTick,
        currentProgress,
        bounds,
        () => latestPlayerLivery.current || undefined,
        1.1,
        now,
      );
      const globalFlightFeatures = processFleet(
        latestGlobalFleet.current,
        currentTick,
        currentProgress,
        bounds,
        (ac) => latestCompetitorLiveries.current.get(ac.ownerPubkey),
        0.8,
        now,
      );

      (map.getSource("flights") as maplibregl.GeoJSONSource)?.setData({
        type: "FeatureCollection",
        features: flightFeatures,
      });
      (map.getSource("global-flights") as maplibregl.GeoJSONSource)?.setData({
        type: "FeatureCollection",
        features: globalFlightFeatures,
      });

      rafId.current = requestAnimationFrame(animate);
    };

    rafId.current = requestAnimationFrame(animate);

    return () => {
      isAnimating = false;
      if (nightOverlayTimer.current) {
        clearInterval(nightOverlayTimer.current);
        nightOverlayTimer.current = null;
      }
      cancelAnimationFrame(rafId.current);
    };
  }, [mapLoaded, airportIndex, mapThemePalette]);

  // =========================================================================
  // Initial fly-to on first airport selection or focus change
  // =========================================================================
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !selectedAirport) return;

    if (!hasInitialFlied.current) {
      hasInitialFlied.current = true;
      mapRef.current.flyTo({
        center: [selectedAirport.longitude, selectedAirport.latitude],
        zoom: 4.5,
        essential: true,
        duration: 2000,
      });
      return;
    }

    mapRef.current.flyTo({
      center: [selectedAirport.longitude, selectedAirport.latitude],
      zoom: Math.max(3.2, mapRef.current.getZoom()),
      essential: true,
      duration: 1200,
    });
  }, [selectedAirport, mapLoaded]);

  return (
    <div
      ref={mapContainer}
      className={`globe-container ${className}`}
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        inset: 0,
        ...style,
      }}
    />
  );
}
