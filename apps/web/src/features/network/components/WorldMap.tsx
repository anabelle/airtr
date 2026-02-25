import { Globe as CoreGlobe } from '@airtr/map';
import { useEngineStore, useAirlineStore } from '@airtr/store';
import { airports as AIRPORTS } from '@airtr/data';
import { useMemo, useState } from 'react';
import type { Airport } from '@airtr/core';
import { AirportInfoPanel } from '@/features/network/components/AirportInfoPanel';
import { isGrounded } from '@/features/network/utils/groundTraffic';

export function WorldMap() {
    const homeAirport = useEngineStore(s => s.homeAirport);
    const tick = useEngineStore(s => s.tick);
    const tickProgress = useEngineStore(s => s.tickProgress);
    const { airline, fleet, globalFleet, globalRoutes, competitors, routes } = useAirlineStore();
    const [inspectedAirport, setInspectedAirport] = useState<Airport | null>(null);
    const [focusedAirport, setFocusedAirport] = useState<Airport | null>(null);

    const competitorLiveries = useMemo(() => {
        const map = new Map<string, { primary: string; secondary: string }>();
        competitors.forEach((value, key) => {
            if (value.livery?.primary && value.livery?.secondary) {
                map.set(key, {
                    primary: value.livery.primary,
                    secondary: value.livery.secondary,
                });
            }
        });
        return map;
    }, [competitors]);

    const playerHubs = useMemo(() => airline?.hubs ?? [], [airline?.hubs]);

    const competitorHubColors = useMemo(() => {
        const map = new Map<string, string>();
        competitors.forEach((value) => {
            if (!value.livery?.primary || !value.hubs?.length) return;
            for (const hubIata of value.hubs) {
                if (!map.has(hubIata)) {
                    map.set(hubIata, value.livery.primary);
                }
            }
        });
        return map;
    }, [competitors]);

    const playerRouteDestinations = useMemo(() => {
        const destinations = new Set<string>();
        if (!playerHubs.length) return destinations;
        for (const route of routes) {
            if (route.status !== 'active') continue;
            const originIsHub = playerHubs.includes(route.originIata);
            const destIsHub = playerHubs.includes(route.destinationIata);
            if (originIsHub && !destIsHub) destinations.add(route.destinationIata);
            if (destIsHub && !originIsHub) destinations.add(route.originIata);
        }
        return destinations;
    }, [playerHubs, routes]);

    const handleAirportSelect = (airport: Airport | null) => {
        if (!airport) return;
        setInspectedAirport(airport);
        setFocusedAirport(airport);
    };

    const fleetBaseCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        fleet.forEach((ac) => {
            if (ac.baseAirportIata && isGrounded(ac)) {
                counts[ac.baseAirportIata] = (counts[ac.baseAirportIata] || 0) + 1;
            }
        });
        return counts;
    }, [fleet]);

    if (!homeAirport) return null;

    const selectedAirport = focusedAirport ?? homeAirport;

    return (
        <div className="absolute inset-0 w-full h-full z-0 overflow-hidden bg-black">
            <CoreGlobe
                airports={AIRPORTS}
                selectedAirport={selectedAirport}
                onAirportSelect={handleAirportSelect}
                onMapClick={() => {
                    setInspectedAirport(null);
                    setFocusedAirport(null);
                }}
                fleetBaseCounts={fleetBaseCounts}
                fleet={fleet}
                globalFleet={globalFleet}
                globalRoutes={globalRoutes}
                playerLivery={airline?.livery || null}
                competitorLiveries={competitorLiveries}
                playerHubs={playerHubs}
                competitorHubColors={competitorHubColors}
                playerRouteDestinations={playerRouteDestinations}
                tick={tick}
                tickProgress={tickProgress}
            />
            {inspectedAirport ? (
                <AirportInfoPanel
                    airport={inspectedAirport}
                    onClose={() => {
                        setInspectedAirport(null);
                    }}
                />
            ) : null}
            {focusedAirport ? (
                <div className="pointer-events-none absolute left-4 top-4 z-20 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">
                    Focus: {focusedAirport.iata}
                </div>
            ) : null}
            {/* Map vignette overlay */}
            <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_150px_rgba(0,0,0,0.9)] z-10" />
        </div>
    );
}
