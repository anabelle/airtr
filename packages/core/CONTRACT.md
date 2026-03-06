# @acars/core — Public API Contract

## Version: 1.0.0

## Status: STABLE

### Exported Types

```typescript
// Fixed-Point Financial Type (ADR-002)
type FixedPoint = number & { readonly __brand: "FixedPoint" };

// Geography
interface Airport {
  id: string;
  name: string;
  iata: string;
  icao: string;
  latitude: number;
  longitude: number;
  altitude: number;
  timezone: string;
  country: string;
  city: string;
  population: number;
  gdpPerCapita: number;
  tags: AirportTag[];
}
type AirportTag = "beach" | "ski" | "business" | "general";

// Hubs
type HubTier = "regional" | "national" | "international" | "global";
interface HubState {
  hubIata: string;
  spokeCount: number;
  weeklyFrequency: number;
  avgFrequency: number;
}

// Season
type Season = "spring" | "summer" | "autumn" | "winter";

// Demand
interface DemandResult {
  origin: string;
  destination: string;
  economy: number;
  business: number;
  first: number;
}
interface BidirectionalDemandResult {
  outbound: DemandResult;
  inbound: DemandResult;
}

// Aircraft
interface AircraftModel { /* see types.ts */ }
interface AircraftInstance { /* see types.ts */ }
interface FlightState { /* see types.ts */ }

// Airline
interface AirlineEntity {
  id: string;
  foundedBy: string;
  status: "private" | "public" | "chapter11" | "liquidated";
  ceoPubkey: string;
  sharesOutstanding: number;
  shareholders: Record<string, number>;
  name: string;
  icaoCode: string;
  callsign: string;
  hubs: string[];
  livery: { primary: string; secondary: string; accent: string };
  brandScore: number;
  tier: number;
  cumulativeRevenue: FixedPoint;
  corporateBalance: FixedPoint;
  stockPrice: FixedPoint;
  fleetIds: string[];
  routeIds: string[];
  lastTick?: number;
  timeline?: TimelineEvent[];
}

// Route
interface Route { /* see types.ts */ }

// QSI
interface FlightOffer { /* see types.ts */ }
type PassengerClass = "economy" | "business" | "first";

// Tick Results
interface TickResult { /* see types.ts */ }
interface AirlineTickResult { /* see types.ts */ }
interface RouteTickResult { /* see types.ts */ }

// Timeline
type TimelineEventType = "takeoff" | "landing" | "purchase" | "tier_upgrade" | /* ... */;
interface TimelineEvent { /* see types.ts */ }

// Checkpoints
interface Checkpoint { /* see types.ts */ }

// Game Actions
type GameActionType = "AIRLINE_CREATE" | "TICK_UPDATE" | /* ... */;
type GameActionPayload = Record<string, unknown>;
interface GameActionEnvelope {
  schemaVersion: number;
  action: GameActionType;
  payload: GameActionPayload;
}

// Solar
interface NightOverlayFeatureCollection { /* see types.ts */ }
interface TerminatorLineCollection { /* see types.ts */ }

// Cycle
interface CyclePhase {
  status: "enroute" | "turnaround";
  direction: "outbound" | "inbound";
  positionInCycle: number;
  departureTick: number;
  arrivalTick: number;
  turnaroundEndTick: number | null;
  baseAirportIata: string;
  originIata: string;
  destinationIata: string;
}
```

### Exported Constants

```typescript
// Time constants
const GENESIS_TIME = 1740333600000;
const TICK_DURATION = 3000;
const TICKS_PER_HOUR = 1200;
const TICKS_PER_DAY = 28800;
const TICKS_PER_MONTH = 864000;
const CHAPTER11_BALANCE_THRESHOLD_USD = -10000000;

// Fixed-point
const FP_SCALE = 10000;
const FP_ZERO = 0 as FixedPoint;

// Demand
const PLAYER_MARKET_CEILING = 0.14;
const MIN_ADDRESSABLE_WEEKLY = 360;
const NATURAL_LF_CEILING = 0.88;
const PRICE_ELASTICITY_ECONOMY = -1.5;
const PRICE_ELASTICITY_BUSINESS = -0.5;
const PRICE_ELASTICITY_FIRST = -0.2;
const MAX_PRICE_ELASTICITY_MULTIPLIER = 1.5;
const MIN_PRICE_ELASTICITY_MULTIPLIER = 0.01;

// Finance
const ROUTE_SLOT_FEE: FixedPoint; // fp(100000)
```

### Exported Functions

```typescript
// Fixed-Point Arithmetic
function fp(value: number): FixedPoint;
function fpRaw(value: unknown): FixedPoint;
function fpToNumber(value: FixedPoint): number;
function fpAdd(a: FixedPoint, b: FixedPoint): FixedPoint;
function fpSub(a: FixedPoint, b: FixedPoint): FixedPoint;
function fpMul(a: FixedPoint, b: FixedPoint): FixedPoint;
function fpDiv(a: FixedPoint, b: FixedPoint): FixedPoint;
function fpScale(a: FixedPoint, scalar: number): FixedPoint;
function fpNeg(a: FixedPoint): FixedPoint;
function fpSum(values: FixedPoint[]): FixedPoint;
function fpFormat(value: FixedPoint, decimals?: number): string;

// Demand (Gravity Model)
function calculateDemand(
  origin: Airport,
  destination: Airport,
  season: Season,
  prosperityIndex?: number,
  hubModifier?: number,
): DemandResult;
function calculateBidirectionalDemand(
  origin: Airport,
  destination: Airport,
  season: Season,
  prosperityIndex?: number,
  outboundHubModifier?: number,
  inboundHubModifier?: number,
): BidirectionalDemandResult;
function getHubDemandModifier(
  originTier: HubTier | null,
  destTier: HubTier | null,
  originState: HubState | null,
  destState: HubState | null,
): number;
function getHubCongestionModifier(
  baseCapacityPerHour: number,
  hourlyFlights: number,
): number;
function getProsperityIndex(tick: number, ticksPerCycle?: number): number;
function scaleToAddressableMarket(demand: DemandResult): DemandResult;
function calculateSupplyPressure(
  totalWeeklySeats: number,
  weeklyDemand: number,
): number;
function calculatePriceElasticity(
  actualFare: FixedPoint,
  referenceFare: FixedPoint,
  elasticity: number,
): number;

// QSI (Quality Service Index)
function calculateShares(
  offers: FlightOffer[],
): Record<PassengerClass, Map<string, number>>;
function allocatePassengers(
  offers: FlightOffer[],
  demand: DemandResult,
): Map<string, { economy: number; business: number; first: number }>;

// Geography
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number;

// Season
function getSeason(latitude: number, date: Date): Season;
function getSeasonalMultiplier(tag: AirportTag, season: Season): number;

// Solar
function getSolarDeclination(dayOfYear: number): number;
function getSubsolarPoint(date: Date): { lat: number; lng: number };
function computeTerminatorLine(date: Date): TerminatorLineCollection;
function computeNightOverlay(date: Date): NightOverlayFeatureCollection;

// Fleet
function calculateBookValue(
  model: AircraftModel,
  flightHoursTotal: number,
  condition: number,
  manufactureTick: number,
  currentTick: number,
): FixedPoint;

// Hubs
function buildHubState(hubIata: string, routes: Route[]): HubState;
function getAirportTraffic(iata: string, routes: Route[]): number;

// Finance
interface FlightRevenueParams {
  passengersEconomy: number;
  passengersBusiness: number;
  passengersFirst: number;
  fareEconomy: FixedPoint;
  fareBusiness: FixedPoint;
  fareFirst: FixedPoint;
  seatsOffered: number;
}
interface FlightRevenueResult {
  revenueTicket: FixedPoint;
  revenueEconomy: FixedPoint;
  revenueBusiness: FixedPoint;
  revenueFirst: FixedPoint;
  revenueAncillary: FixedPoint;
  revenueTotal: FixedPoint;
  actualPassengers: number;
  actualEconomy: number;
  actualBusiness: number;
  actualFirst: number;
  seatsOffered: number;
  loadFactor: number;
  spilledPassengers: number;
}
function calculateFlightRevenue(
  params: FlightRevenueParams,
): FlightRevenueResult;

interface FlightCostParams {
  distanceKm: number;
  aircraft: AircraftModel;
  actualPassengers: number;
  blockHours: number;
  airportFeesMultiplier?: number;
}
interface FlightCostResult {
  costFuel: FixedPoint;
  costCrew: FixedPoint;
  costMaintenance: FixedPoint;
  costAirport: FixedPoint;
  costNavigation: FixedPoint;
  costLeasing: FixedPoint;
  costOverhead: FixedPoint;
  costTotal: FixedPoint;
}
function calculateFlightCost(params: FlightCostParams): FlightCostResult;

function calculateHubLandingFee(
  baseLandingFee: FixedPoint,
  baseCapacityPerHour: number,
  hourlyFlights: number,
): FixedPoint;
function detectPriceWar(offers: FlightOffer[]): {
  isPriceWar: boolean;
  lowPricedAirlines: string[];
};
function getSuggestedFares(distanceKm: number): {
  economy: FixedPoint;
  business: FixedPoint;
  first: FixedPoint;
};

// Cycle
function getCyclePhase(
  cycleStartTick: number,
  targetTick: number,
  durationTicks: number,
  turnaroundTicks: number,
  route: Route,
): CyclePhase;
function countLandingsBetween(
  cycleStartTick: number,
  fromTick: number,
  toTick: number,
  durationTicks: number,
  turnaroundTicks: number,
): number;

// PRNG (Deterministic Random)
function createPRNG(seed: number): () => number;
function createTickPRNG(tick: number): () => number;

// Checkpoints
function canonicalize(obj: unknown): string;
function computeActionChainHash(actions: GameActionEnvelope[]): string;
function computeCheckpointStateHash(checkpoint: Checkpoint): string;
function verifyCheckpoint(checkpoint: Checkpoint): boolean;

// Logging
function createLogger(namespace: string): {
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
};
```

### Contract Rules

1. All exports listed above are FROZEN until a major version bump.
2. New exports may be ADDED without a version bump.
3. Existing exports may NOT be modified or removed without:
   a. A deprecation notice in this file
   b. A migration guide
   c. A major version bump (1.x → 2.0)
   d. Human operator approval

### Dependencies

- **None** — @acars/core has zero external runtime dependencies.
- All financial math uses fixed-point arithmetic (ADR-002).
- All randomness uses seeded PRNG for determinism.
