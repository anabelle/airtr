import { fp, fpToNumber, fpMul, fpSub } from './fixed-point.js';
import type { AircraftModel, FixedPoint } from './types.js';
import { TICKS_PER_HOUR } from './types.js';

/**
 * Calculates the current book value of an aircraft based on straight-line depreciation,
 * condition penalties, and utilization penalties.
 */
export function calculateBookValue(
    model: AircraftModel,
    flightHoursTotal: number,
    condition: number, // 0.0 to 1.0
    birthTick: number,
    currentTick: number
): FixedPoint {
    // Correctly determine age using the 1:1 real-time tick scale
    // 1 tick = 3 seconds; 1200 ticks = 1 hour.
    const ticksPerDay = TICKS_PER_HOUR * 24;
    const ticksPerYear = ticksPerDay * 365.25;

    const ageTicks = Math.max(0, currentTick - birthTick);
    const ageYears = ageTicks / ticksPerYear;

    // Base residual value
    const residualPercent = model.residualValuePercent / 100;
    const residualValue = fpMul(model.price, fp(residualPercent));

    // Straight-line depreciation base
    const depreciableBase = fpSub(model.price, residualValue);

    // Annual depreciation
    const annualDepreciation = fpToNumber(depreciableBase) / model.economicLifeYears;

    // Depreciation based on age
    const totalDepreciation = fp(annualDepreciation * ageYears);
    let bookValue = fpSub(model.price, totalDepreciation);

    // Cap bookValue at residual
    if (fpToNumber(bookValue) < fpToNumber(residualValue)) {
        bookValue = residualValue;
    }

    let bookValueNum = fpToNumber(bookValue);

    // Condition adjustment: poor condition reduces value further (up to 30% penalty)
    const conditionPenalty = (1 - condition) * 0.3;
    bookValueNum = bookValueNum * (1 - conditionPenalty);

    // High utilization penalty: if actual hours are far above average
    const averageAnnualHours = model.blockHoursPerDay * 365;
    const actualAnnualHours = ageYears > 0.1 ? flightHoursTotal / ageYears : flightHoursTotal;

    if (actualAnnualHours > averageAnnualHours * 1.2) {
        // 10% penalty for overutilization
        bookValueNum = bookValueNum * 0.9;
    }

    const calculatedFinal = Math.max(bookValueNum, fpToNumber(residualValue));
    return fp(calculatedFinal);
}
