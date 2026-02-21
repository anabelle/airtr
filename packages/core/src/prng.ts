// ============================================================
// @airtr/core — Seeded PRNG (Deterministic Random)
// ============================================================
// Uses mulberry32 — a fast, simple, deterministic 32-bit PRNG.
// Seeded by tick number to ensure identical sequences across clients.
// ============================================================

/**
 * Create a seeded pseudo-random number generator.
 * Returns a function that produces deterministic floats in [0, 1).
 */
export function createPRNG(seed: number): () => number {
    let state = seed | 0;
    return function mulberry32(): number {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Create a PRNG seeded from a tick number.
 * All clients using the same tick get the same sequence.
 */
export function createTickPRNG(tick: number): () => number {
    return createPRNG(tick * 2654435761); // Knuth multiplicative hash
}
