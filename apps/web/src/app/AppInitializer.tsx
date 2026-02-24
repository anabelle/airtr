import { useEffect } from 'react';
import { useEngineStore, useAirlineStore } from '@airtr/store';
import { airports as AIRPORTS } from '@airtr/data';
import type { Airport } from '@airtr/core';
import type { UserLocation } from '@airtr/store';
import { haversineDistance } from '@airtr/core';

/** Fallback: estimate location from UTC offset */
function estimateLocationFromOffset(): UserLocation {
    const offsetMinutes = new Date().getTimezoneOffset();
    const longitude = -(offsetMinutes / 60) * 15;
    const latitude = 30; // rough global average
    return { latitude, longitude, source: 'timezone' };
}

/** Find the best hub near a location (prioritizing population) */
function findNearestAirport(lat: number, lon: number): Airport {
    const RADIUS_KM = 150;
    const candidates = AIRPORTS.filter(airport => {
        const dist = haversineDistance(lat, lon, airport.latitude, airport.longitude);
        return dist <= RADIUS_KM;
    });

    if (candidates.length > 0) {
        // Sort by population descending
        return candidates.sort((a, b) => (b.population || 0) - (a.population || 0))[0];
    }

    // Fallback if no airports within radius: absolute nearest
    let nearest = AIRPORTS[0];
    let minDist = Infinity;
    for (const airport of AIRPORTS) {
        const dist = haversineDistance(lat, lon, airport.latitude, airport.longitude);
        if (dist < minDist) {
            minDist = dist;
            nearest = airport;
        }
    }
    return nearest;
}

/** IANA timezone detection */
function findAirportByTimezone(): Airport | null {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const exact = AIRPORTS.find(a => a.timezone === tz);
        if (exact) return exact;

        const tzCity = tz.split('/').pop()?.replace(/_/g, ' ').toLowerCase();
        if (tzCity) {
            const cityMatch = AIRPORTS.find(a => a.city.toLowerCase() === tzCity);
            if (cityMatch) return cityMatch;
        }
        return null;
    } catch {
        return null;
    }
}

export function AppInitializer({ children }: { children: React.ReactNode }) {
    const { airline, initializeIdentity } = useAirlineStore();
    const homeAirport = useEngineStore(s => s.homeAirport);
    const setHub = useEngineStore(s => s.setHub);
    const startEngine = useEngineStore(s => s.startEngine);

    useEffect(() => {
        initializeIdentity();
    }, [initializeIdentity]);

    // Sync Nostr profile's hub with Engine state if they diverge
    useEffect(() => {
        if (airline && homeAirport && airline.hubs[0] !== homeAirport.iata) {
            const dbHub = AIRPORTS.find(a => a.iata === airline.hubs[0]);
            if (dbHub) {
                setHub(
                    dbHub,
                    { latitude: dbHub.latitude, longitude: dbHub.longitude, source: 'manual' },
                    'nostr profile'
                );
            }
        }
    }, [airline, homeAirport, setHub]);

    // Initialize hub from location
    useEffect(() => {
        if (homeAirport) return; // Already initialized

        const fallbackLocate = () => {
            const tzAirport = findAirportByTimezone();
            if (tzAirport) {
                const loc: UserLocation = {
                    latitude: tzAirport.latitude,
                    longitude: tzAirport.longitude,
                    source: 'timezone',
                };
                setHub(tzAirport, loc, `timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
            } else {
                const loc = estimateLocationFromOffset();
                const home = findNearestAirport(loc.latitude, loc.longitude);
                setHub(home, loc, 'UTC offset');
            }
            startEngine();
        };

        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const loc: UserLocation = {
                        latitude: pos.coords.latitude,
                        longitude: pos.coords.longitude,
                        source: 'gps',
                    };
                    const home = findNearestAirport(loc.latitude, loc.longitude);
                    setHub(home, loc, 'GPS');
                    startEngine();
                },
                fallbackLocate,
                { timeout: 3000 },
            );
        } else {
            fallbackLocate();
        }
    }, [homeAirport, setHub, startEngine]);

    return <>{children}</>;
}
