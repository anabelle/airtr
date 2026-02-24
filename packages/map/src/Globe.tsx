import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Airport, AircraftInstance } from '@airtr/core';

const AIRPLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;

export interface GlobeProps {
    airports: Airport[];
    selectedAirport: Airport | null;
    onAirportSelect: (airport: Airport | null) => void;
    fleetBaseCounts?: Record<string, number>;
    fleet?: AircraftInstance[];
    tick?: number;
    tickProgress?: number;
    className?: string;
    style?: React.CSSProperties;
}

// --- Navigation Helpers (Great Circle Math) ---
function getGreatCircleInterpolation(p1: [number, number], p2: [number, number], f: number): [number, number] {
    const lon1 = p1[0] * Math.PI / 180;
    const lat1 = p1[1] * Math.PI / 180;
    const lon2 = p2[0] * Math.PI / 180;
    const lat2 = p2[1] * Math.PI / 180;

    // Haversine distance in radians
    const d = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((lat1 - lat2) / 2), 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin((lon1 - lon2) / 2), 2)));

    if (d === 0) return p1;

    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2)));
    const lon = Math.atan2(y, x);

    return [lon * 180 / Math.PI, lat * 180 / Math.PI];
}

function getBearing(p1: [number, number], p2: [number, number]): number {
    const lon1 = p1[0] * Math.PI / 180;
    const lat1 = p1[1] * Math.PI / 180;
    const lon2 = p2[0] * Math.PI / 180;
    const lat2 = p2[1] * Math.PI / 180;

    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    const brng = Math.atan2(y, x);
    return (brng * 180 / Math.PI + 360) % 360;
}

export function Globe({ airports, selectedAirport, onAirportSelect, fleetBaseCounts, fleet = [], tick = 0, tickProgress = 0, className = '', style }: GlobeProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const [mapLoaded, setMapLoaded] = useState(false);
    const hasInitialFlied = useRef(false);

    useEffect(() => {
        if (!mapContainer.current || mapRef.current) return;

        // Load saved view state
        const savedView = localStorage.getItem('airtr_map_view');
        let initialCenter: [number, number] = [0, 20];
        let initialZoom = 1.5;

        if (savedView) {
            try {
                const { center, zoom } = JSON.parse(savedView);
                initialCenter = center;
                initialZoom = zoom;
                hasInitialFlied.current = true; // Don't override user's saved view with auto-fly
            } catch (e) {
                console.warn("Failed to parse saved map view", e);
            }
        }

        const map = new maplibregl.Map({
            container: mapContainer.current,
            style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
            center: initialCenter,
            zoom: initialZoom,
            pitch: 0
        });

        map.doubleClickZoom.disable();

        // Persist view changes
        const saveView = () => {
            const center = map.getCenter();
            const zoom = map.getZoom();
            localStorage.setItem('airtr_map_view', JSON.stringify({
                center: [center.lng, center.lat],
                zoom
            }));
        };

        map.on('moveend', saveView);
        map.on('zoomend', saveView);

        map.on('load', () => {
            setMapLoaded(true);

            // Add airplane icon as SDF for dynamic coloring
            const img = new Image();
            img.onload = () => {
                if (!map.hasImage('airplane-icon')) {
                    map.addImage('airplane-icon', img, { sdf: true });
                }
            };
            img.src = 'data:image/svg+xml;base64,' + btoa(AIRPLANE_SVG);

            // Sources
            map.addSource('airports', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addSource('flights', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addSource('arcs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

            // Layers: Arcs (Flight Paths)
            map.addLayer({
                id: 'arcs-layer',
                type: 'line',
                source: 'arcs',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': '#e94560',
                    'line-width': 1,
                    'line-opacity': 0.3,
                    'line-dasharray': [2, 2]
                }
            });

            // Layers: Airports
            map.addLayer({
                id: 'airports-layer',
                type: 'circle',
                source: 'airports',
                paint: {
                    'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1, 6, 2, 10, 4],
                    'circle-color': '#e94560',
                    'circle-opacity': 0.6,
                    'circle-stroke-width': 0.5,
                    'circle-stroke-color': '#fff'
                },
            });

            // Layers: Fleet Parked
            map.addLayer({
                id: 'fleet-layer',
                type: 'symbol',
                source: 'airports',
                filter: ['>', ['get', 'fleetCount'], 0],
                layout: {
                    'icon-image': 'airplane-icon',
                    'icon-size': 0.7,
                    'icon-allow-overlap': true,
                    'text-field': '{fleetCount}',
                    'text-size': 11,
                    'text-anchor': 'top',
                    'text-offset': [0, 0.4],
                    'text-allow-overlap': true
                },
                paint: {
                    'icon-color': '#4ade80',
                    'text-halo-color': '#000000',
                    'text-halo-width': 2,
                    'text-color': '#4ade80'
                }
            });

            // Layers: Active Flights (Moving)
            map.addLayer({
                id: 'flights-layer',
                type: 'symbol',
                source: 'flights',
                layout: {
                    'icon-image': 'airplane-icon',
                    'icon-size': 1.1,
                    'icon-rotate': ['get', 'bearing'],
                    'icon-rotation-alignment': 'map',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                    'icon-anchor': 'center'
                },
                paint: {
                    'icon-color': '#ffffff',
                }
            });

            // Add a glow/dot under the plane for better visibility
            map.addLayer({
                id: 'flight-glow',
                type: 'circle',
                source: 'flights',
                paint: {
                    'circle-radius': 14,
                    'circle-color': '#4ade80',
                    'circle-opacity': 0.6,
                    'circle-blur': 1.5
                }
            }, 'flights-layer'); // Place below the emoji

            map.on('click', 'airports-layer', (e) => {
                if (!e.features || e.features.length === 0) return;
                onAirportSelect(e.features[0].properties as unknown as Airport);
            });

            map.on('mouseenter', 'airports-layer', () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', 'airports-layer', () => { map.getCanvas().style.cursor = ''; });
        });

        mapRef.current = map;
        return () => { map.remove(); mapRef.current = null; };
    }, []);

    // Sync airports & Arcs (Now reactive to full fleet state)
    useEffect(() => {
        if (!mapLoaded || !mapRef.current) return;
        const map = mapRef.current;

        const airportGeojson: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: airports.map((a) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [a.longitude, a.latitude] },
                properties: { ...a, fleetCount: fleetBaseCounts?.[a.iata] || 0 },
            })),
        };

        const arcFeatures: GeoJSON.Feature[] = [];
        fleet.forEach(ac => {
            if (ac.status === 'enroute' && ac.flight) {
                const origin = airports.find(a => a.iata === ac.flight?.originIata);
                const dest = airports.find(a => a.iata === ac.flight?.destinationIata);
                if (origin && dest) {
                    // Generate Great Circle Arc points
                    const points: [number, number][] = [];
                    const SEGMENTS = 50;
                    for (let i = 0; i <= SEGMENTS; i++) {
                        points.push(getGreatCircleInterpolation(
                            [origin.longitude, origin.latitude],
                            [dest.longitude, dest.latitude],
                            i / SEGMENTS
                        ));
                    }

                    arcFeatures.push({
                        type: 'Feature',
                        geometry: { type: 'LineString', coordinates: points },
                        properties: {}
                    });
                }
            }
        });

        (map.getSource('airports') as maplibregl.GeoJSONSource)?.setData(airportGeojson);
        (map.getSource('arcs') as maplibregl.GeoJSONSource)?.setData({ type: 'FeatureCollection', features: arcFeatures });
    }, [airports, mapLoaded, fleetBaseCounts, fleet]); // FULL fleet dependency

    // REAL-TIME MOVEMENT (Smooth interpolation)
    useEffect(() => {
        if (!mapLoaded || !mapRef.current || !fleet.length) return;
        const map = mapRef.current;

        const flightFeatures = fleet
            .filter(ac => ac.status === 'enroute' && ac.flight)
            .map(ac => {
                const f = ac.flight!;
                const origin = airports.find(a => a.iata === f.originIata);
                const dest = airports.find(a => a.iata === f.destinationIata);
                if (!origin || !dest) return null;

                const duration = Math.max(1, f.arrivalTick - f.departureTick);
                const elapsed = (tick - f.departureTick) + tickProgress;
                const progress = Math.max(0, Math.min(1, elapsed / duration));

                // Great Circle Interpolation
                const coords = getGreatCircleInterpolation(
                    [origin.longitude, origin.latitude],
                    [dest.longitude, dest.latitude],
                    progress
                );

                // Dynamic Bearing (look slightly ahead for realism)
                const nextProgress = Math.min(1, progress + 0.01);
                const nextCoords = getGreatCircleInterpolation(
                    [origin.longitude, origin.latitude],
                    [dest.longitude, dest.latitude],
                    nextProgress
                );

                const bearing = getBearing(coords, nextCoords);

                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: coords },
                    properties: { id: ac.id, bearing: bearing }
                };
            })
            .filter(Boolean) as GeoJSON.Feature[];

        (map.getSource('flights') as maplibregl.GeoJSONSource)?.setData({ type: 'FeatureCollection', features: flightFeatures });
    }, [mapLoaded, fleet, tick, tickProgress, airports]);

    useEffect(() => {
        if (!mapLoaded || !mapRef.current || !selectedAirport) return;

        if (!hasInitialFlied.current) {
            hasInitialFlied.current = true;
            mapRef.current.flyTo({
                center: [selectedAirport.longitude, selectedAirport.latitude],
                zoom: 4.5,
                essential: true,
                duration: 2000
            });
        }
    }, [selectedAirport, mapLoaded]);

    return (
        <div
            ref={mapContainer}
            className={`globe-container ${className}`}
            style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, ...style }}
        />
    );
}
