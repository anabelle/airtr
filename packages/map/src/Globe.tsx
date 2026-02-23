import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Airport, AircraftInstance } from '@airtr/core';

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
            // ... (Sources and Layers remain same)

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
                    'text-field': '✈️ {fleetCount}',
                    'text-size': 14,
                    'text-anchor': 'bottom',
                    'text-offset': [0, -0.5],
                    'text-allow-overlap': true
                },
                paint: {
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
                    'text-field': '✈️',
                    'text-size': 26,
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                    'text-rotate': ['get', 'bearing'],
                    'text-anchor': 'center'
                },
                paint: {
                    'text-color': '#fff',
                    'text-halo-color': '#4ade80',
                    'text-halo-width': 3
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
                    arcFeatures.push({
                        type: 'Feature',
                        geometry: { type: 'LineString', coordinates: [[origin.longitude, origin.latitude], [dest.longitude, dest.latitude]] },
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

                // Great Circle is complex, keeping linear but ensuring anti-meridian safety
                let dLng = dest.longitude - origin.longitude;
                if (dLng > 180) dLng -= 360;
                if (dLng < -180) dLng += 360;

                const lng = origin.longitude + dLng * progress;
                const lat = origin.latitude + (dest.latitude - origin.latitude) * progress;

                // Simple bearing
                const bearing = Math.atan2(dest.latitude - origin.latitude, dLng) * (180 / Math.PI);

                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [lng, lat] },
                    properties: { id: ac.id, bearing: bearing + 90 }
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
