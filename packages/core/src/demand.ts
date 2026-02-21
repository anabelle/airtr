// ============================================================
// @airtr/core — Gravity Demand Model
// ============================================================
// See docs/ECONOMIC_MODEL.md §1 for full specification.
// ============================================================

import type { Airport, DemandResult, Season } from './types.js';
import { haversineDistance } from './geo.js';
import { getSeasonalMultiplier } from './season.js';

// --- Model Parameters (from ECONOMIC_MODEL.md §1.2) ---

/** Calibration constant */
const K = 0.001;
/** Origin population exponent */
const ALPHA = 0.8;
/** Destination population exponent */
const BETA = 0.8;
/** Origin GDP exponent */
const GAMMA = 0.6;
/** Destination GDP exponent */
const DELTA = 0.3;
/** Distance decay exponent */
const THETA = 1.2;

/** Minimum distance to prevent division-by-near-zero (km) */
const MIN_DISTANCE_KM = 50;

// --- Demand Class Splits (from ECONOMIC_MODEL.md §1.4) ---

const ECONOMY_SHARE = 0.75;
const BUSINESS_SHARE = 0.20;
const FIRST_SHARE = 0.05;

/**
 * Calculate weekly passenger demand between two airports
 * using the gravity model formula.
 *
 * @param origin - Origin airport
 * @param destination - Destination airport
 * @param season - Current season at destination
 * @param prosperityIndex - Global economic multiplier (default 1.0)
 * @returns Demand split by passenger class
 */
export function calculateDemand(
    origin: Airport,
    destination: Airport,
    season: Season,
    prosperityIndex: number = 1.0,
): DemandResult {
    // Calculate great-circle distance
    const distance = Math.max(
        MIN_DISTANCE_KM,
        haversineDistance(
            origin.latitude,
            origin.longitude,
            destination.latitude,
            destination.longitude,
        ),
    );

    // Gravity model formula
    const numerator =
        Math.pow(origin.population, ALPHA) *
        Math.pow(destination.population, BETA) *
        Math.pow(origin.gdpPerCapita, GAMMA) *
        Math.pow(destination.gdpPerCapita, DELTA);

    const denominator = Math.pow(distance, THETA);

    const baseDemand = K * (numerator / denominator);

    // Apply seasonal modulation
    const destTag = destination.tags[0] ?? 'general';
    const seasonalMultiplier = getSeasonalMultiplier(destTag, season);

    // Apply prosperity index
    const totalDemand = Math.max(0, Math.round(baseDemand * seasonalMultiplier * prosperityIndex));

    // Split into classes
    return {
        origin: origin.iata,
        destination: destination.iata,
        economy: Math.round(totalDemand * ECONOMY_SHARE),
        business: Math.round(totalDemand * BUSINESS_SHARE),
        first: Math.round(totalDemand * FIRST_SHARE),
    };
}

/**
 * Calculate prosperity index for a given tick.
 * Oscillates between 0.85 (recession) and 1.15 (boom).
 */
export function getProsperityIndex(tick: number, ticksPerCycle: number = 365): number {
    return 1.0 + 0.15 * Math.sin((2 * Math.PI * tick) / ticksPerCycle);
}
