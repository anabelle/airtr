import { Globe as CoreGlobe } from '@airtr/map';
import { useEngineStore, useAirlineStore } from '@airtr/store';
import { airports as AIRPORTS } from '@airtr/data';
import type { Airport } from '@airtr/core';
import { useMemo } from 'react';

export function WorldMap() {
    const homeAirport = useEngineStore(s => s.homeAirport);
    const tick = useEngineStore(s => s.tick);
    const tickProgress = useEngineStore(s => s.tickProgress);
    const setHub = useEngineStore(s => s.setHub);
    const { airline, updateHub, fleet } = useAirlineStore();

    const handleHubChange = (airport: Airport | null) => {
        if (!airport) return;
        setHub(
            airport,
            { latitude: airport.latitude, longitude: airport.longitude, source: 'manual' },
            'manual selection'
        );
        // If airline exists, persist hub change to Nostr
        if (airline) {
            updateHub(airport.iata);
        }
    };

    const fleetBaseCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        fleet.forEach((ac) => {
            if (ac.baseAirportIata) {
                counts[ac.baseAirportIata] = (counts[ac.baseAirportIata] || 0) + 1;
            }
        });
        return counts;
    }, [fleet]);

    if (!homeAirport) return null;

    return (
        <div className="absolute inset-0 w-full h-full z-0 overflow-hidden bg-black">
            <CoreGlobe
                airports={AIRPORTS}
                selectedAirport={homeAirport}
                onAirportSelect={handleHubChange}
                fleetBaseCounts={fleetBaseCounts}
                fleet={fleet}
                tick={tick}
                tickProgress={tickProgress}
            />
            {/* Map vignette overlay */}
            <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_150px_rgba(0,0,0,0.9)] z-10" />
        </div>
    );
}
