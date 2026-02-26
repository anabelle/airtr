import type { AirlineEntity } from '@airtr/core';

export type CompetitorHubEntry = {
    name: string;
    icaoCode?: string;
    ceoPubkey: string;
};

export function buildCompetitorHubEntries(
    competitors: Map<string, AirlineEntity>,
    airportIata: string,
): CompetitorHubEntry[] {
    const entries: CompetitorHubEntry[] = [];

    competitors.forEach((value) => {
        if (value.hubs?.includes(airportIata)) {
            entries.push({
                name: value.name,
                icaoCode: value.icaoCode,
                ceoPubkey: value.ceoPubkey,
            });
        }
    });

    return entries;
}
