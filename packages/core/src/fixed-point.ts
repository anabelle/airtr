// ============================================================
// @acars/core — Fixed-Point Arithmetic (ADR-002)
// ============================================================
// All financial values use 4 decimal places.
// $1.00 = 10_000.  $123.45 = 1_234_500.
// This ensures determinism across all platforms.
// ============================================================

import type { FixedPoint } from "./types.js";

/** Decimal places of precision */
export const FP_SCALE = 10_000;
const FP_SCALE_BIGINT = BigInt(FP_SCALE);

function assertSafeInteger(value: number, operation: string): FixedPoint {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${operation} produced an unsafe fixed-point value`);
  }
  return value as FixedPoint;
}

function assertFiniteInput(value: number, operation: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${operation} requires a finite number`);
  }
}

function toSafeBigInt(value: FixedPoint, operation: string): bigint {
  assertSafeInteger(value, operation);
  return BigInt(value);
}

function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator < 0n) {
    return roundDiv(-numerator, -denominator);
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  const doubleRemainder = absRemainder * 2n;

  if (numerator >= 0n) {
    return doubleRemainder >= denominator ? quotient + 1n : quotient;
  }

  return doubleRemainder > denominator ? quotient - 1n : quotient;
}

function bigintToSafeFixedPoint(value: bigint, operation: string): FixedPoint {
  const result = Number(value);
  return assertSafeInteger(result, operation);
}

/** Create a FixedPoint from a regular number (e.g. dollars) */
export function fp(value: number): FixedPoint {
  assertFiniteInput(value, "fp");
  return assertSafeInteger(Math.round(value * FP_SCALE), "fp");
}

/**
 * Cast an already-scaled integer back to FixedPoint.
 * Use this when deserializing from JSON where the value was stored
 * as the raw FP integer (e.g., 1000000 for $100.00).
 * Returns FP_ZERO if the value is not a finite number.
 */
export function fpRaw(value: unknown): FixedPoint {
  if (typeof value === "number" && Number.isFinite(value)) {
    return assertSafeInteger(Math.round(value), "fpRaw");
  }
  return 0 as FixedPoint;
}

/** Convert FixedPoint back to a regular number for display */
export function fpToNumber(value: FixedPoint): number {
  return value / FP_SCALE;
}

/** Add two FixedPoint values */
export function fpAdd(a: FixedPoint, b: FixedPoint): FixedPoint {
  return assertSafeInteger(a + b, "fpAdd");
}

/** Subtract: a - b */
export function fpSub(a: FixedPoint, b: FixedPoint): FixedPoint {
  return assertSafeInteger(a - b, "fpSub");
}

/** Multiply two FixedPoint values */
export function fpMul(a: FixedPoint, b: FixedPoint): FixedPoint {
  // a and b are both scaled by FP_SCALE, so product is scaled by FP_SCALE^2.
  // Use BigInt for the intermediate product to avoid IEEE-754 precision loss.
  return bigintToSafeFixedPoint(
    roundDiv(toSafeBigInt(a, "fpMul") * toSafeBigInt(b, "fpMul"), FP_SCALE_BIGINT),
    "fpMul",
  );
}

/** Divide: a / b */
export function fpDiv(a: FixedPoint, b: FixedPoint): FixedPoint {
  if (b === 0) throw new Error("Division by zero");
  // Scale numerator up before dividing to maintain precision.
  // Use BigInt for the intermediate product to avoid IEEE-754 precision loss.
  const denominator = toSafeBigInt(b, "fpDiv");
  return bigintToSafeFixedPoint(
    roundDiv(toSafeBigInt(a, "fpDiv") * FP_SCALE_BIGINT, denominator),
    "fpDiv",
  );
}

/** Multiply FixedPoint by a plain scalar (not FixedPoint) */
export function fpScale(a: FixedPoint, scalar: number): FixedPoint {
  assertFiniteInput(scalar, "fpScale");
  return assertSafeInteger(Math.round(a * scalar), "fpScale");
}

/** Negate a FixedPoint value */
export function fpNeg(a: FixedPoint): FixedPoint {
  return -a as FixedPoint;
}

/** FixedPoint zero */
export const FP_ZERO = 0 as FixedPoint;

/** Format FixedPoint as a dollar string for display */
export function fpFormat(value: FixedPoint, decimals = 2): string {
  const num = fpToNumber(value);
  return num.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Sum an array of FixedPoint values */
export function fpSum(values: FixedPoint[]): FixedPoint {
  let total = 0;
  for (const v of values) {
    total += v;
    assertSafeInteger(total, "fpSum");
  }
  return total as FixedPoint;
}
