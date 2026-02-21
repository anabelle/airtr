// ============================================================
// @airtr/core — Fixed-Point Arithmetic (ADR-002)
// ============================================================
// All financial values use 4 decimal places.
// $1.00 = 10_000.  $123.45 = 1_234_500.
// This ensures determinism across all platforms.
// ============================================================

import type { FixedPoint } from './types.js';

/** Decimal places of precision */
export const FP_SCALE = 10_000;

/** Create a FixedPoint from a regular number (e.g. dollars) */
export function fp(value: number): FixedPoint {
    return Math.round(value * FP_SCALE) as FixedPoint;
}

/** Convert FixedPoint back to a regular number for display */
export function fpToNumber(value: FixedPoint): number {
    return value / FP_SCALE;
}

/** Add two FixedPoint values */
export function fpAdd(a: FixedPoint, b: FixedPoint): FixedPoint {
    return (a + b) as FixedPoint;
}

/** Subtract: a - b */
export function fpSub(a: FixedPoint, b: FixedPoint): FixedPoint {
    return (a - b) as FixedPoint;
}

/** Multiply two FixedPoint values */
export function fpMul(a: FixedPoint, b: FixedPoint): FixedPoint {
    // a and b are both scaled by FP_SCALE, so product is scaled by FP_SCALE^2.
    // We divide by FP_SCALE once to get the result in FP_SCALE.
    return Math.round((a * b) / FP_SCALE) as FixedPoint;
}

/** Divide: a / b */
export function fpDiv(a: FixedPoint, b: FixedPoint): FixedPoint {
    if (b === 0) throw new Error('Division by zero');
    // Scale numerator up before dividing to maintain precision
    return Math.round((a * FP_SCALE) / b) as FixedPoint;
}

/** Multiply FixedPoint by a plain scalar (not FixedPoint) */
export function fpScale(a: FixedPoint, scalar: number): FixedPoint {
    return Math.round(a * scalar) as FixedPoint;
}

/** Negate a FixedPoint value */
export function fpNeg(a: FixedPoint): FixedPoint {
    return (-a) as FixedPoint;
}

/** FixedPoint zero */
export const FP_ZERO = 0 as FixedPoint;

/** Format FixedPoint as a dollar string for display */
export function fpFormat(value: FixedPoint, decimals = 2): string {
    const num = fpToNumber(value);
    return num.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

/** Sum an array of FixedPoint values */
export function fpSum(values: FixedPoint[]): FixedPoint {
    let total = 0;
    for (const v of values) {
        total += v;
    }
    return total as FixedPoint;
}
