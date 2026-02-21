// ============================================================
// @airtr/core — Public API
// ============================================================

// Types
export type {
    FixedPoint,
    Airport,
    AirportTag,
    Season,
    DemandResult,
    AircraftType,
    Airline,
    Route,
    FlightOffer,
    PassengerClass,
    TickResult,
    AirlineTickResult,
    RouteTickResult,
} from './types.js';

// Fixed-point arithmetic
export {
    fp,
    fpToNumber,
    fpAdd,
    fpSub,
    fpMul,
    fpDiv,
    fpScale,
    fpNeg,
    fpFormat,
    fpSum,
    FP_ZERO,
    FP_SCALE,
} from './fixed-point.js';

// PRNG
export { createPRNG, createTickPRNG } from './prng.js';

// Geography
export { haversineDistance } from './geo.js';

// Season
export { getSeason, getSeasonalMultiplier } from './season.js';

// Demand
export { calculateDemand, getProsperityIndex } from './demand.js';

// QSI
export { calculateShares, allocatePassengers } from './qsi.js';

// Finance
export { calculateFlightRevenue, calculateFlightCost } from './finance.js';
