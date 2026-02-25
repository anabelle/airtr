import type { Airport } from '@airtr/core';
import { haversineDistance } from '@airtr/core';
import { airports as AIRPORTS } from './airports.js';

const TOP_CITY_COUNT = 5;

/**
 * Find the best hub near a location: largest cities in nearest country,
 * then pick the closest among those top cities.
 */
export function findPreferredHub(lat: number, lon: number, airports: Airport[] = AIRPORTS): Airport {
    let nearest = airports[0];
    let minDist = Infinity;
    for (const airport of airports) {
        const dist = haversineDistance(lat, lon, airport.latitude, airport.longitude);
        if (dist < minDist) {
            minDist = dist;
            nearest = airport;
        }
    }

    const country = nearest.country;
    const countryAirports = airports.filter(a => a.country === country);
    const populated = countryAirports.filter(a => (a.population || 0) > 0);

    if (populated.length > 0) {
        const topByPopulation = [...populated]
            .sort((a, b) => (b.population || 0) - (a.population || 0))
            .slice(0, TOP_CITY_COUNT);

        let best = topByPopulation[0];
        let bestDist = Infinity;
        for (const airport of topByPopulation) {
            const dist = haversineDistance(lat, lon, airport.latitude, airport.longitude);
            if (dist < bestDist) {
                bestDist = dist;
                best = airport;
            }
        }
        return best;
    }

    return nearest;
}
