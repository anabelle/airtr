// ============================================================
// @airtr/core — Fixed-Point Arithmetic Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    fp, fpToNumber, fpAdd, fpSub, fpMul, fpDiv,
    fpScale, fpNeg, fpFormat, fpSum, FP_ZERO,
} from './fixed-point.js';

describe('fixed-point arithmetic', () => {
    describe('fp() creation', () => {
        it('converts $1.00 to 10000', () => {
            expect(fp(1)).toBe(10_000);
        });

        it('converts $123.45 to 1234500', () => {
            expect(fp(123.45)).toBe(1_234_500);
        });

        it('converts $0.0001 to 1', () => {
            expect(fp(0.0001)).toBe(1);
        });

        it('converts $0 to 0', () => {
            expect(fp(0)).toBe(0);
        });

        it('handles negative values', () => {
            expect(fp(-50.25)).toBe(-502_500);
        });
    });

    describe('fpToNumber() conversion', () => {
        it('converts 10000 back to 1.0', () => {
            expect(fpToNumber(fp(1))).toBe(1);
        });

        it('converts 1234500 back to 123.45', () => {
            expect(fpToNumber(fp(123.45))).toBe(123.45);
        });
    });

    describe('fpAdd()', () => {
        it('adds $100 + $50.25 = $150.25', () => {
            expect(fpToNumber(fpAdd(fp(100), fp(50.25)))).toBe(150.25);
        });

        it('handles negative addition', () => {
            expect(fpToNumber(fpAdd(fp(100), fp(-30)))).toBe(70);
        });
    });

    describe('fpSub()', () => {
        it('subtracts $100 - $30.50 = $69.50', () => {
            expect(fpToNumber(fpSub(fp(100), fp(30.50)))).toBe(69.50);
        });

        it('can produce negative results', () => {
            expect(fpToNumber(fpSub(fp(10), fp(25)))).toBe(-15);
        });
    });

    describe('fpMul()', () => {
        it('multiplies $100 × $1.15 = $115', () => {
            expect(fpToNumber(fpMul(fp(100), fp(1.15)))).toBe(115);
        });

        it('multiplies $50 × $0.5 = $25', () => {
            expect(fpToNumber(fpMul(fp(50), fp(0.5)))).toBe(25);
        });

        it('multiplies $123.45 × $2 = $246.90', () => {
            expect(fpToNumber(fpMul(fp(123.45), fp(2)))).toBe(246.9);
        });
    });

    describe('fpDiv()', () => {
        it('divides $100 / $2 = $50', () => {
            expect(fpToNumber(fpDiv(fp(100), fp(2)))).toBe(50);
        });

        it('divides $100 / $3 ≈ $33.3333', () => {
            expect(fpToNumber(fpDiv(fp(100), fp(3)))).toBeCloseTo(33.3333, 3);
        });

        it('throws on division by zero', () => {
            expect(() => fpDiv(fp(100), FP_ZERO)).toThrow('Division by zero');
        });
    });

    describe('fpScale()', () => {
        it('scales $100 by 1.5 = $150', () => {
            expect(fpToNumber(fpScale(fp(100), 1.5))).toBe(150);
        });

        it('scales $200 by 0.75 = $150', () => {
            expect(fpToNumber(fpScale(fp(200), 0.75))).toBe(150);
        });
    });

    describe('fpNeg()', () => {
        it('negates $100 to -$100', () => {
            expect(fpToNumber(fpNeg(fp(100)))).toBe(-100);
        });
    });

    describe('fpSum()', () => {
        it('sums an array of values', () => {
            const values = [fp(10), fp(20), fp(30.5)];
            expect(fpToNumber(fpSum(values))).toBe(60.5);
        });

        it('returns 0 for empty array', () => {
            expect(fpSum([])).toBe(0);
        });
    });

    describe('fpFormat()', () => {
        it('formats as USD currency string', () => {
            expect(fpFormat(fp(1234.56))).toBe('$1,234.56');
        });

        it('formats negative values', () => {
            expect(fpFormat(fp(-50))).toBe('-$50.00');
        });
    });

    describe('determinism', () => {
        it('produces identical results across multiple runs', () => {
            // This test verifies the core determinism guarantee
            const a = fp(123.4567);
            const b = fp(89.1011);
            const result = fpMul(fpAdd(a, b), fpDiv(fp(100), fp(3)));
            // Store the expected result — if this ever changes, determinism is broken
            expect(result).toBe(70_852_529);
        });
    });
});
