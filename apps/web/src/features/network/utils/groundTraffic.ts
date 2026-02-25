import type { AirlineEntity, AircraftInstance } from '@airtr/core';

export type GroundTrafficEntry = {
    key: string;
    name: string;
    livery?: AirlineEntity['livery'];
    count: number;
    aircraft: AircraftInstance[];
    isPlayer: boolean;
};

export const GROUNDED_STATUSES = new Set<AircraftInstance['status']>(['idle', 'turnaround', 'maintenance']);

export function isGrounded(aircraft: AircraftInstance): boolean {
    return GROUNDED_STATUSES.has(aircraft.status);
}

export function buildGroundTraffic(
    airportIata: string,
    fleet: AircraftInstance[],
    globalFleet: AircraftInstance[],
    airline: AirlineEntity | null,
    competitors: Map<string, AirlineEntity>
): { totalCount: number; entries: GroundTrafficEntry[] } {
    const entries = new Map<string, GroundTrafficEntry>();
    let totalCount = 0;

    const addEntry = (
        key: string,
        name: string,
        livery: AirlineEntity['livery'] | undefined,
        aircraft: AircraftInstance,
        isPlayer: boolean,
    ) => {
        const existing = entries.get(key);
        if (existing) {
            existing.count += 1;
            existing.aircraft.push(aircraft);
            return;
        }

        entries.set(key, {
            key,
            name,
            livery,
            count: 1,
            aircraft: [aircraft],
            isPlayer,
        });
    };

    for (const aircraft of fleet) {
        if (aircraft.baseAirportIata !== airportIata || !isGrounded(aircraft)) continue;
        totalCount += 1;
        addEntry(
            airline?.ceoPubkey ?? 'player',
            airline?.name ?? 'Your Airline',
            airline?.livery,
            aircraft,
            true,
        );
    }

    for (const aircraft of globalFleet) {
        if (aircraft.baseAirportIata !== airportIata || !isGrounded(aircraft)) continue;
        totalCount += 1;
        const competitor = competitors.get(aircraft.ownerPubkey);
        addEntry(
            aircraft.ownerPubkey,
            competitor?.name ?? 'Unknown Carrier',
            competitor?.livery,
            aircraft,
            false,
        );
    }

    const sorted = Array.from(entries.values()).sort((a, b) => {
        if (a.isPlayer !== b.isPlayer) return a.isPlayer ? -1 : 1;
        if (a.count !== b.count) return b.count - a.count;
        return a.name.localeCompare(b.name);
    });

    return { totalCount, entries: sorted };
}
