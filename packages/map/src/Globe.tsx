import maplibregl from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  AircraftInstance,
  Airport,
  HubTier,
  NightOverlayFeatureCollection,
  Route,
} from "@acars/core";
import { computeNightOverlay } from "@acars/core";
import { aircraftModels, HUB_CLASSIFICATIONS } from "@acars/data";
import { getBearing, getGreatCircleInterpolation, makeArcFeature } from "./geo.js";
import { FAMILY_ICONS } from "./icons.js";

const aircraftModelMap = new Map(aircraftModels.map((m) => [m.id, m]));

export interface GlobeProps {
  airports: Airport[];
  selectedAirport: Airport | null;
  onAirportSelect: (airport: Airport | null) => void;
  onAircraftSelect?: (aircraftId: string) => void;
  onMapClick?: () => void;
  groundPresence?: Record<string, { color: string; count: number; isPlayer?: boolean }[]>;
  fleet?: AircraftInstance[];
  globalFleet?: AircraftInstance[];
  globalRoutes?: Route[];
  playerLivery?: { primary: string; secondary: string } | null;
  competitorLiveries?: Map<string, { primary: string; secondary: string }>;
  playerHubs?: string[];
  competitorHubColors?: Map<string, string>;
  playerRouteDestinations?: Set<string>;
  tick?: number;
  tickProgress?: number;
  className?: string;
  style?: React.CSSProperties;
}

const NIGHT_OVERLAY_SOURCE = "night-overlay";
const NIGHT_CORE_LAYER = "night-core-layer";
const NIGHT_ASTRO_LAYER = "night-astro-layer";
const NIGHT_CIVIL_LAYER = "night-civil-layer";

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

// =============================================================================
// --- Viewport Culling Helpers ---
// =============================================================================

/**
 * Fast bounding-box test: does a great circle route between two points
 * potentially intersect the given viewport bounds?
 *
 * We expand the route's bounding box by a generous margin to account for
 * the curvature of great circles (which can bulge significantly away from
 * the straight-line bounding box, especially on long routes).
 */
function routeIntersectsViewport(
  originLng: number,
  originLat: number,
  destLng: number,
  destLat: number,
  bounds: maplibregl.LngLatBounds,
): boolean {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  // If the route crosses the antimeridian (longitude difference > 180°),
  // the simple AABB test produces an inverted bounding box that covers
  // everything *except* the actual route. These are rare long-haul routes;
  // always render them rather than attempting wrapped AABB math.
  const lngDiff = Math.abs(originLng - destLng);
  if (lngDiff > 180) return true;

  // Calculate route bounding box
  let minLng = Math.min(originLng, destLng);
  let maxLng = Math.max(originLng, destLng);
  let minLat = Math.min(originLat, destLat);
  let maxLat = Math.max(originLat, destLat);

  // Great circle curvature margin: longer routes bulge more.
  // Use a rough heuristic based on lat/lng span.
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  const margin = Math.max(latSpan, lngSpan) * 0.3 + 5; // min 5 degrees margin

  minLng -= margin;
  maxLng += margin;
  minLat -= margin;
  maxLat += margin;

  // AABB overlap test
  return !(maxLng < sw.lng || minLng > ne.lng || maxLat < sw.lat || minLat > ne.lat);
}

/**
 * Check if a single point is within viewport bounds (with margin).
 */
function pointInViewport(
  lng: number,
  lat: number,
  bounds: maplibregl.LngLatBounds,
  margin: number = 5,
): boolean {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return (
    lng >= sw.lng - margin &&
    lng <= ne.lng + margin &&
    lat >= sw.lat - margin &&
    lat <= ne.lat + margin
  );
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
  globalFleet = [],
  globalRoutes = [],
  playerLivery = null,
  competitorLiveries = new Map(),
  playerHubs = [],
  competitorHubColors = new Map(),
  playerRouteDestinations = new Set(),
  tick = 0,
  tickProgress = 0,
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
  const latestTick = useRef(tick);
  const latestTickProgress = useRef(tickProgress);
  const latestFleet = useRef(fleet);
  const latestGlobalFleet = useRef(globalFleet);
  const latestPlayerLivery = useRef(playerLivery);
  const latestCompetitorLiveries = useRef(competitorLiveries);
  const latestPlayerHubs = useRef(playerHubs);
  const latestCompetitorHubColors = useRef(competitorHubColors);
  const latestPlayerRouteDestinations = useRef(playerRouteDestinations);
  const latestGroundPresence = useRef(groundPresence);
  const latestOnAirportSelect = useRef(onAirportSelect);
  const latestOnAircraftSelect = useRef(onAircraftSelect);
  const latestOnMapClick = useRef(onMapClick);

  // Keep refs in sync with props (avoid stale closures in RAF loop)
  useEffect(() => {
    latestOnAirportSelect.current = onAirportSelect;
  }, [onAirportSelect]);
  useEffect(() => {
    latestOnAircraftSelect.current = onAircraftSelect;
  }, [onAircraftSelect]);
  useEffect(() => {
    latestOnMapClick.current = onMapClick;
  }, [onMapClick]);
  useEffect(() => {
    latestTick.current = tick;
  }, [tick]);
  useEffect(() => {
    latestTickProgress.current = tickProgress;
  }, [tickProgress]);
  useEffect(() => {
    latestFleet.current = fleet;
  }, [fleet]);
  useEffect(() => {
    latestGlobalFleet.current = globalFleet;
  }, [globalFleet]);
  useEffect(() => {
    latestPlayerLivery.current = playerLivery;
  }, [playerLivery]);
  useEffect(() => {
    latestCompetitorLiveries.current = competitorLiveries;
  }, [competitorLiveries]);
  useEffect(() => {
    latestPlayerHubs.current = playerHubs;
  }, [playerHubs]);
  useEffect(() => {
    latestCompetitorHubColors.current = competitorHubColors;
  }, [competitorHubColors]);
  useEffect(() => {
    latestPlayerRouteDestinations.current = playerRouteDestinations;
  }, [playerRouteDestinations]);
  useEffect(() => {
    latestGroundPresence.current = groundPresence;
  }, [groundPresence]);

  // =========================================================================
  // Map Initialization (runs once)
  //
  // React 18+ StrictMode double-mounts in dev: Mount -> Unmount -> Re-mount.
  // Calling map.remove() synchronously on unmount destroys the WebGL context
  // before the re-mount can rescue it. We defer cleanup via setTimeout so
  // StrictMode's immediate re-mount can cancel the pending removal.
  // =========================================================================
  const cleanupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
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

      // Sources
      map.addSource("airports", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource(NIGHT_OVERLAY_SOURCE, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        } as NightOverlayFeatureCollection,
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

      map.addLayer({
        id: NIGHT_CIVIL_LAYER,
        type: "fill",
        source: NIGHT_OVERLAY_SOURCE,
        filter: ["==", ["get", "band"], "civil"],
        paint: {
          "fill-color": "#0a0a2e",
          "fill-opacity": 0.12,
        },
      });
      map.addLayer({
        id: NIGHT_ASTRO_LAYER,
        type: "fill",
        source: NIGHT_OVERLAY_SOURCE,
        filter: ["==", ["get", "band"], "astro"],
        paint: {
          "fill-color": "#0a0a2e",
          "fill-opacity": 0.25,
        },
      });
      map.addLayer({
        id: NIGHT_CORE_LAYER,
        type: "fill",
        source: NIGHT_OVERLAY_SOURCE,
        filter: ["==", ["get", "band"], "core"],
        paint: {
          "fill-color": "#0a0a2e",
          "fill-opacity": 0.35,
        },
      });

      // Layer: Global Arcs
      map.addLayer({
        id: "global-arcs-layer",
        type: "line",
        source: "global-arcs",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#475569",
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
          "line-color": "#e94560",
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
          "circle-color": ["coalesce", ["get", "playerHubColor"], "#4ade80"],
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
            ["coalesce", ["get", "playerHubColor"], "#4ade80"],
            "player-hub",
            ["coalesce", ["get", "playerHubColor"], "#4ade80"],
            "route-dest",
            "#e2e8f0",
            "competitor-hub",
            ["coalesce", ["get", "competitorHubColor"], "#f97316"],
            "major",
            "#c6d6e8",
            "#8aa6c5",
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
            "#ffffff",
            "player-hub",
            "#e2e8f0",
            "route-dest",
            "#ffffff",
            "competitor-hub",
            "#ffe0bf",
            "major",
            "#dde7f3",
            "#6f88a8",
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
            "circle-color": ["coalesce", ["get", "secondaryColor"], "#94a3b8"],
            "circle-opacity": 0.25,
            "circle-blur": 1.5,
          },
        },
        "flights-layer",
      );

      // Airport click handler (uses ref to avoid stale closure)
      map.on("click", "airports-layer", (e) => {
        if (!e.features || e.features.length === 0) return;
        (e.originalEvent as MouseEvent & { _handled?: boolean })._handled = true;
        latestOnAirportSelect.current(e.features[0].properties as unknown as Airport);
      });

      // Aircraft click handlers (all 4 flight layers, uses ref to avoid stale closure)
      const flightLayers = [
        "flights-layer",
        "flights-accent-layer",
        "global-flights-layer",
        "global-flights-accent-layer",
      ];
      for (const layerId of flightLayers) {
        map.on("click", layerId, (e) => {
          if (!e.features || e.features.length === 0) return;
          (e.originalEvent as MouseEvent & { _handled?: boolean })._handled = true;
          const id = e.features[0].properties?.id;
          if (id && latestOnAircraftSelect.current) latestOnAircraftSelect.current(String(id));
        });
      }

      // Map click handler (dismiss panels on empty map clicks, uses ref to avoid stale closure)
      map.on("click", (e) => {
        if ((e.originalEvent as MouseEvent & { _handled?: boolean })._handled) return;
        if (latestOnMapClick.current) latestOnMapClick.current();
      });

      // Cursor: pointer on airports
      map.on("mouseenter", "airports-layer", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "airports-layer", () => {
        map.getCanvas().style.cursor = "";
      });

      // Cursor: pointer on flights
      for (const layerId of flightLayers) {
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }
    });

    mapRef.current = map;
    return () => {
      cleanupTimer.current = setTimeout(() => {
        mapRef.current?.remove();
        mapRef.current = null;
      }, 100);
    };
  }, []);

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
    for (const route of globalRoutes) {
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
    globalRoutes,
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
        for (const route of globalRoutes) {
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
  }, [mapLoaded, airportIndex, getOrComputeArc, globalRoutes]);

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
      const overlay = computeNightOverlay(new Date(), 1);
      (map.getSource(NIGHT_OVERLAY_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
        overlay,
      );
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

        const coords = getGreatCircleInterpolation(
          [origin.longitude, origin.latitude],
          [dest.longitude, dest.latitude],
          progress,
        );

        // Viewport culling for individual aircraft
        if (!pointInViewport(coords[0], coords[1], bounds)) continue;

        const nextProgress = Math.min(1, progress + 0.01);
        const nextCoords = getGreatCircleInterpolation(
          [origin.longitude, origin.latitude],
          [dest.longitude, dest.latitude],
          nextProgress,
        );

        const bearing = getBearing(coords, nextCoords);
        const model = aircraftModelMap.get(ac.modelId);
        const familyId = model?.familyId || "a320";
        const wingspanM = model?.wingspanM || 35.8;
        const colors = resolveColor(ac);

        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: coords },
          properties: {
            id: ac.id,
            bearing,
            familyId,
            sizeScale: (wingspanM / 35.8) * baseSize,
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
      );
      const globalFlightFeatures = processFleet(
        latestGlobalFleet.current,
        currentTick,
        currentProgress,
        bounds,
        (ac) => latestCompetitorLiveries.current.get(ac.ownerPubkey),
        0.8,
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
  }, [mapLoaded, airportIndex]);

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
