import { useEffect } from 'react';
import { useEngineStore, useAirlineStore } from '@airtr/store';
import { airports as AIRPORTS, findPreferredHub } from '@airtr/data';
import type { Airport } from '@airtr/core';
import type { UserLocation } from '@airtr/store';

/** Fallback: estimate location from UTC offset */
function estimateLocationFromOffset(): UserLocation {
    const offsetMinutes = new Date().getTimezoneOffset();
    const longitude = -(offsetMinutes / 60) * 15;
    const latitude = 30; // rough global average
    return { latitude, longitude, source: 'timezone' };
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
    const identityStatus = useAirlineStore(s => s.identityStatus);
    const homeAirport = useEngineStore(s => s.homeAirport);
    const setHub = useEngineStore(s => s.setHub);
    const startEngine = useEngineStore(s => s.startEngine);

    useEffect(() => {
        initializeIdentity();
    }, [initializeIdentity]);

    // Once airline loads from Nostr, authoritatively set engine hub to hubs[0].
    // This takes priority over any geo-detection that may have run first.
    useEffect(() => {
        if (!airline || !airline.hubs[0]) return;
        const dbHub = AIRPORTS.find(a => a.iata === airline.hubs[0]);
        if (dbHub) {
            setHub(
                dbHub,
                { latitude: dbHub.latitude, longitude: dbHub.longitude, source: 'manual' },
                'nostr profile'
            );
        }
        startEngine();
    }, [airline, setHub, startEngine]);

    // Initialize hub from geolocation — only for new users (no airline loaded yet).
    // Wait until identity check has completed so we know if a Nostr profile exists.
    useEffect(() => {
        if (homeAirport) return; // Already initialized
        if (identityStatus !== 'ready') return; // Identity still loading — wait
        if (airline) return; // Returning user — Nostr sync effect handles hub

        const fallbackLocate = () => {
            // Guard: airline may have loaded while geo was pending
            if (useAirlineStore.getState().airline) return;

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
                const home = findPreferredHub(loc.latitude, loc.longitude);
                setHub(home, loc, 'UTC offset');
            }
            startEngine();
        };

        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    // Guard: airline may have loaded while geo was pending
                    if (useAirlineStore.getState().airline) return;

                    const loc: UserLocation = {
                        latitude: pos.coords.latitude,
                        longitude: pos.coords.longitude,
                        source: 'gps',
                    };
                    const home = findPreferredHub(loc.latitude, loc.longitude);
                    setHub(home, loc, 'GPS');
                    startEngine();
                },
                fallbackLocate,
                { timeout: 3000 },
            );
        } else {
            fallbackLocate();
        }
    }, [homeAirport, identityStatus, airline, setHub, startEngine]);

    return <>{children}</>;
}
