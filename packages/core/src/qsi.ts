// ============================================================
// @airtr/core — Quality Service Index (QSI)
// ============================================================
// See docs/ECONOMIC_MODEL.md §2 for full specification.
// ============================================================

import type { FlightOffer, PassengerClass, DemandResult } from './types.js';
import { fpToNumber } from './fixed-point.js';

// --- Weights (from ECONOMIC_MODEL.md §2.3) ---

type FactorWeights = {
    price: number;
    frequency: number;
    time: number;
    stops: number;
    service: number;
    brand: number;
};

const WEIGHTS: Record<PassengerClass, FactorWeights> = {
    economy: { price: 0.40, frequency: 0.15, time: 0.15, stops: 0.10, service: 0.10, brand: 0.10 },
    business: { price: 0.15, frequency: 0.30, time: 0.20, stops: 0.15, service: 0.10, brand: 0.10 },
    first: { price: 0.05, frequency: 0.20, time: 0.15, stops: 0.20, service: 0.25, brand: 0.15 },
};

/**
 * Calculates the market share (0.0 to 1.0) for each offer
 * for each passenger class, based on the QSI model.
 * 
 * Note: QSI calculations use standard numbers, as IEEE-754 arithmetic
 * (+, -, *, /) is globally deterministic.
 */
export function calculateShares(offers: FlightOffer[]): Record<PassengerClass, Map<string, number>> {
    const result: Record<PassengerClass, Map<string, number>> = {
        economy: new Map(),
        business: new Map(),
        first: new Map(),
    };

    if (offers.length === 0) {
        return result;
    }

    if (offers.length === 1) {
        // Monopoly: 100% share to the single offer
        result.economy.set(offers[0].airlinePubkey, 1.0);
        result.business.set(offers[0].airlinePubkey, 1.0);
        result.first.set(offers[0].airlinePubkey, 1.0);
        return result;
    }

    // --- Collect Extents ---
    let minPriceEconomy = Infinity;
    let maxPriceEconomy = -Infinity;
    let minPriceBusiness = Infinity;
    let maxPriceBusiness = -Infinity;
    let minPriceFirst = Infinity;
    let maxPriceFirst = -Infinity;

    let minTime = Infinity;
    let maxTime = -Infinity;

    let totalFrequency = 0;

    for (const offer of offers) {
        const pe = fpToNumber(offer.fareEconomy);
        const pb = fpToNumber(offer.fareBusiness);
        const pf = fpToNumber(offer.fareFirst);

        if (pe < minPriceEconomy) minPriceEconomy = pe;
        if (pe > maxPriceEconomy) maxPriceEconomy = pe;

        if (pb < minPriceBusiness) minPriceBusiness = pb;
        if (pb > maxPriceBusiness) maxPriceBusiness = pb;

        if (pf < minPriceFirst) minPriceFirst = pf;
        if (pf > maxPriceFirst) maxPriceFirst = pf;

        if (offer.travelTimeMinutes < minTime) minTime = offer.travelTimeMinutes;
        if (offer.travelTimeMinutes > maxTime) maxTime = offer.travelTimeMinutes;

        totalFrequency += offer.frequencyPerWeek;
    }

    // Prevent division by zero if all values are the same
    if (totalFrequency === 0) totalFrequency = 1;

    // --- Calculate QSI Scores ---
    let totalQSIE = 0;
    let totalQSIB = 0;
    let totalQSIF = 0;

    const qsiScores = offers.map(offer => {
        const pe = fpToNumber(offer.fareEconomy);
        const pb = fpToNumber(offer.fareBusiness);
        const pf = fpToNumber(offer.fareFirst);

        const priceScoreE = 1.0 - (pe - minPriceEconomy) / (maxPriceEconomy - minPriceEconomy + 1);
        const priceScoreB = 1.0 - (pb - minPriceBusiness) / (maxPriceBusiness - minPriceBusiness + 1);
        const priceScoreF = 1.0 - (pf - minPriceFirst) / (maxPriceFirst - minPriceFirst + 1);

        const frequencyScore = offer.frequencyPerWeek / totalFrequency;
        const timeScore = 1.0 - (offer.travelTimeMinutes - minTime) / (maxTime - minTime + 1);

        const stopsScore = offer.stops === 0 ? 1.0 : (offer.stops === 1 ? 0.5 : 0.2);

        const serviceScore = offer.serviceScore;
        const brandScore = offer.brandScore;

        const calcClassQSI = (cls: PassengerClass, priceScore: number) => {
            const w = WEIGHTS[cls];
            return (
                w.price * priceScore +
                w.frequency * frequencyScore +
                w.time * timeScore +
                w.stops * stopsScore +
                w.service * serviceScore +
                w.brand * brandScore
            );
        };

        const qsiE = calcClassQSI('economy', priceScoreE);
        const qsiB = calcClassQSI('business', priceScoreB);
        const qsiF = calcClassQSI('first', priceScoreF);

        totalQSIE += qsiE;
        totalQSIB += qsiB;
        totalQSIF += qsiF;

        return {
            airlinePubkey: offer.airlinePubkey,
            qsiE,
            qsiB,
            qsiF
        };
    });

    // Prevent division by zero if all scores are 0
    if (totalQSIE === 0) totalQSIE = 1;
    if (totalQSIB === 0) totalQSIB = 1;
    if (totalQSIF === 0) totalQSIF = 1;

    // --- Calculate Market Shares ---
    for (const score of qsiScores) {
        result.economy.set(score.airlinePubkey, score.qsiE / totalQSIE);
        result.business.set(score.airlinePubkey, score.qsiB / totalQSIB);
        result.first.set(score.airlinePubkey, score.qsiF / totalQSIF);
    }

    return result;
}

/**
 * Allocates integer passengers to each offer based on QSI market shares.
 * Uses the Largest Remainder Method (Hare-Niemeyer) to ensure exact totals
 * without losing or fabricating passengers.
 */
export function allocatePassengers(
    offers: FlightOffer[],
    demand: DemandResult
): Map<string, { economy: number; business: number; first: number }> {
    const allocations = new Map<string, { economy: number; business: number; first: number }>();
    for (const offer of offers) {
        allocations.set(offer.airlinePubkey, { economy: 0, business: 0, first: 0 });
    }

    if (offers.length === 0) {
        return allocations;
    }

    const shares = calculateShares(offers);

    // Helper for allocating a specific class
    const allocateClass = (
        cls: PassengerClass,
        totalPassengers: number,
        classShares: Map<string, number>
    ) => {
        if (totalPassengers === 0) return;

        let unallocated = totalPassengers;
        const remainders: Array<{ pubkey: string; remainder: number }> = [];

        // Distribute guaranteed seats based on Math.floor
        for (const [pubkey, share] of classShares.entries()) {
            const exact = totalPassengers * share;
            const guaranteed = Math.floor(exact);
            const r = exact - guaranteed;

            const current = allocations.get(pubkey)!;
            current[cls] = guaranteed;
            unallocated -= guaranteed;

            remainders.push({ pubkey, remainder: r });
        }

        // Sort by remainder descending, but fall back to pubkey string comparison for determinism!
        remainders.sort((a, b) => {
            if (b.remainder !== a.remainder) {
                return b.remainder - a.remainder;
            }
            return a.pubkey.localeCompare(b.pubkey);
        });

        // Distribute remaining single seats to those with highest remainders
        for (let i = 0; i < unallocated; i++) {
            const id = remainders[i].pubkey;
            allocations.get(id)![cls]++;
        }
    };

    allocateClass('economy', demand.economy, shares.economy);
    allocateClass('business', demand.business, shares.business);
    allocateClass('first', demand.first, shares.first);

    return allocations;
}
