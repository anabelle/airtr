// ============================================================
// @acars/core — Public API
// ============================================================

// Checkpoints
export {
  canonicalize,
  computeActionChainHash,
  computeCheckpointStateHash,
  verifyCheckpoint,
} from "./checkpoint.js";
export type { CyclePhase } from "./cycle.js";
// Cycle
export { countLandingsBetween, getCyclePhase } from "./cycle.js";
// Demand
export {
  calculateBidirectionalDemand,
  calculateDemand,
  calculatePriceElasticity,
  calculateSupplyPressure,
  getHubCongestionModifier,
  getHubDemandModifier,
  getProsperityIndex,
  MAX_PRICE_ELASTICITY_MULTIPLIER,
  MIN_ADDRESSABLE_WEEKLY,
  MIN_PRICE_ELASTICITY_MULTIPLIER,
  NATURAL_LF_CEILING,
  PLAYER_MARKET_CEILING,
  PRICE_ELASTICITY_BUSINESS,
  PRICE_ELASTICITY_ECONOMY,
  PRICE_ELASTICITY_FIRST,
  scaleToAddressableMarket,
} from "./demand.js";
// Finance
export {
  calculateFlightCost,
  calculateFlightRevenue,
  calculateHubLandingFee,
  detectPriceWar,
  getSuggestedFares,
  ROUTE_SLOT_FEE,
} from "./finance.js";
// Fixed-point arithmetic
export {
  FP_SCALE,
  FP_ZERO,
  fp,
  fpAdd,
  fpDiv,
  fpFormat,
  fpMul,
  fpNeg,
  fpRaw,
  fpScale,
  fpSub,
  fpSum,
  fpToNumber,
} from "./fixed-point.js";
// Fleet
export { calculateBookValue } from "./fleet.js";
// Geography
export { haversineDistance } from "./geo.js";
// Hubs
export { buildHubState, getAirportTraffic } from "./hub.js";
// Logging
export { createLogger } from "./logger.js";
// PRNG
export { createPRNG, createTickPRNG } from "./prng.js";
// QSI
export { allocatePassengers, calculateShares } from "./qsi.js";
// Season
export { getSeason, getSeasonalMultiplier } from "./season.js";
export type { NightOverlayFeatureCollection, TerminatorLineCollection } from "./solar.js";
// Solar
export {
  computeNightOverlay,
  computeTerminatorLine,
  getSolarDeclination,
  getSubsolarPoint,
} from "./solar.js";
export type {
  AircraftInstance,
  AircraftModel,
  AirlineEntity,
  AirlineTickResult,
  Airport,
  AirportTag,
  BidirectionalDemandResult,
  Checkpoint,
  DemandResult,
  FixedPoint,
  FlightOffer,
  FlightState,
  GameActionEnvelope,
  GameActionPayload,
  GameActionType,
  HubState,
  HubTier,
  PassengerClass,
  Route,
  RouteTickResult,
  Season,
  TickResult,
  TimelineEvent,
  TimelineEventType,
} from "./types.js";
// Types
export { GENESIS_TIME, TICK_DURATION, TICKS_PER_HOUR } from "./types.js";
