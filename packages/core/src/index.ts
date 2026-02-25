// ============================================================
// @airtr/core — Public API
// ============================================================

// Types
export {
    GENESIS_TIME,
    TICK_DURATION,
    TICKS_PER_HOUR,
} from './types.js';

export type {
    FixedPoint,
    Airport,
    AirportTag,
    Season,
    HubTier,
    HubState,
    DemandResult,
    AircraftModel,
    AircraftInstance,
    AirlineEntity,
    Route,
    FlightOffer,
    PassengerClass,
    TickResult,
    AirlineTickResult,
    RouteTickResult,
    TimelineEvent,
    TimelineEventType
} from './types.js';

// Fixed-point arithmetic
export {
    fp,
    fpRaw,
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
export { calculateDemand, getProsperityIndex, getHubDemandModifier } from './demand.js';

// QSI
export { calculateShares, allocatePassengers } from './qsi.js';

// Finance
export { calculateFlightRevenue, calculateFlightCost, calculateHubLandingFee, getSuggestedFares, detectPriceWar } from './finance.js';

// Fleet
export { calculateBookValue } from './fleet.js';

// Hubs
export { buildHubState } from './hub.js';
