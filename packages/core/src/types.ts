// ============================================================
// --- Constants ---
export const GENESIS_TIME = 1740333600000;
export const TICK_DURATION = 3000; // ms
export const TICKS_PER_HOUR = 3600 / (TICK_DURATION / 1000); // 1200 ticks per hour
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR; // 28,800
export const TICKS_PER_MONTH = 30 * TICKS_PER_DAY; // 864,000 (1 billing month = 30 real days)
export const CHAPTER11_BALANCE_THRESHOLD_USD = -10_000_000;

// --- Fixed-Point Financial Type ---

/**
 * Fixed-point integer representation of money.
 * 4 decimal places: $1.00 = 10000.
 * See ADR-002 for rationale.
 */
export type FixedPoint = number & { readonly __brand: "FixedPoint" };

// --- Geography ---

export interface Airport {
  /** OpenFlights numeric ID */
  id: string;
  /** Airport name (English) */
  name: string;
  /** 3-letter IATA code (e.g. "JFK") */
  iata: string;
  /** 4-letter ICAO code (e.g. "KJFK") */
  icao: string;
  /** Decimal degrees latitude */
  latitude: number;
  /** Decimal degrees longitude */
  longitude: number;
  /** Feet above sea level */
  altitude: number;
  /** IANA timezone (e.g. "America/New_York") */
  timezone: string;
  /** ISO 3166-1 alpha-2 country code */
  country: string;
  /** City name */
  city: string;
  /** Metro area population (estimate) */
  population: number;
  /** Country GDP per capita (USD) */
  gdpPerCapita: number;
  /** Route classification tags */
  tags: AirportTag[];
}

export type AirportTag = "beach" | "ski" | "business" | "general";

// --- Hubs ---

export type HubTier = "regional" | "national" | "international" | "global";

export interface HubState {
  hubIata: string;
  spokeCount: number;
  weeklyFrequency: number;
  avgFrequency: number;
}

// --- Season ---

export type Season = "spring" | "summer" | "autumn" | "winter";

// --- Demand ---

export interface DemandResult {
  /** Origin IATA code */
  origin: string;
  /** Destination IATA code */
  destination: string;
  /** Weekly economy passenger demand */
  economy: number;
  /** Weekly business passenger demand */
  business: number;
  /** Weekly first class passenger demand */
  first: number;
}

export interface BidirectionalDemandResult {
  outbound: DemandResult;
  inbound: DemandResult;
}

export interface AircraftModel {
  id: string; // e.g., "b737-800"
  manufacturer: string; // e.g., "Boeing"
  name: string; // e.g., "737-800"
  type: "turboprop" | "regional" | "narrowbody" | "widebody";
  generation: "legacy" | "modern" | "nextgen";

  // Physical Dimensions
  wingspanM: number; // Wingspan in meters (real-world spec)
  engineCount: 2 | 4; // Number of engines

  // Specifications
  rangeKm: number;
  speedKmh: number;
  maxTakeoffWeight: number; // kg
  capacity: {
    economy: number;
    business: number;
    first: number;
    cargoKg: number;
  };

  // Operational Economics
  fuelBurnKgPerHour: number;
  fuelBurnKgPerKm: number;
  blockHoursPerDay: number;
  turnaroundTimeMinutes: number;

  // Cost Structure
  price: FixedPoint;
  monthlyLease: FixedPoint;
  casm: FixedPoint;
  maintCostPerHour: FixedPoint;
  crewRequired: {
    cockpit: number;
    cabin: number;
  };

  // Lifecycle & Progression
  economicLifeYears: number;
  residualValuePercent: number;
  unlockTier: number;
  familyId: string;
  deliveryTimeTicks: number;
}

export interface FlightState {
  originIata: string;
  destinationIata: string;
  departureTick: number;
  arrivalTick: number;
  direction: "outbound" | "inbound";
  purpose?: "route" | "ferry";
  distanceKm?: number;
  fareEconomy?: FixedPoint;
  fareBusiness?: FixedPoint;
  fareFirst?: FixedPoint;
  frequencyPerWeek?: number;
}

export interface AircraftInstance {
  id: string; // Unique universally
  ownerPubkey: string; // The airline's Nostr pubkey
  modelId: string; // Reference to AircraftModel.id
  name: string; // User-assigned name
  status: "idle" | "enroute" | "turnaround" | "maintenance" | "delivery";
  assignedRouteId: string | null;
  baseAirportIata: string; // Where the aircraft is physically parked (Last or current)
  purchasedAtTick: number; // When the CURRENT owner bought it
  purchasePrice: FixedPoint; // What the CURRENT owner paid (Cost Basis)
  birthTick: number; // When the aircraft was originally manufactured (for depreciation)
  deliveryAtTick?: number; // When it arrives at truth
  listingPrice?: FixedPoint | null; // If set, the aircraft is listed on the used marketplace
  routeAssignedAtTick?: number; // When this aircraft was assigned to its current route (cycle anchor)
  routeAssignedAtIata?: string; // Which airport the aircraft was at when assigned (for cycle direction)

  // Flight state
  flight: FlightState | null;
  lastTickProcessed?: number;
  turnaroundEndTick?: number;
  arrivalTickProcessed?: number;
  maintenanceStartTick?: number;

  // Acquisition
  purchaseType: "buy" | "lease";
  leaseStartedAtTick?: number;

  // Interior Layout
  configuration: {
    economy: number;
    business: number;
    first: number;
    cargoKg: number;
  };

  // Wear and Tear Mechanics
  flightHoursTotal: number;
  flightHoursSinceCheck: number;
  condition: number; // 0.0 to 1.0 (1.0 = brand new)

  // Derived metrics (latest flight outcomes)
  lastKnownLoadFactor?: number; // 0.0 - 1.0

  // AI-generated livery image (Nano Banana via Blossom)
  liveryImageUrl?: string; // Blossom content-addressable URL
  liveryPromptHash?: string; // Hash of prompt inputs for cache invalidation
}

export interface AirlineEntity {
  id: string; // Hash of corporate genesis event
  foundedBy: string; // Founder's pubkey
  status: "private" | "public" | "chapter11" | "liquidated";

  // Leadership & Ownership
  ceoPubkey: string; // Current operator
  sharesOutstanding: number;
  shareholders: Record<string, number>; // pubkey -> share count

  // Core Identity
  name: string;
  icaoCode: string;
  callsign: string;
  hubs: string[]; // Array of multiple IATA codes
  livery: {
    primary: string;
    secondary: string;
    accent: string;
  };
  brandScore: number;
  tier: number;
  cumulativeRevenue: FixedPoint;

  // Financials
  corporateBalance: FixedPoint;
  stockPrice: FixedPoint; // Derived purely from earnings & market cap

  // Assets & Obligations
  fleetIds: string[];
  routeIds: string[];

  // Engine State
  lastTick?: number;
  timeline?: TimelineEvent[];
}

// --- Route ---

export interface Route {
  id: string; // Unique route ID
  originIata: string; // Origin Hub
  destinationIata: string; // Target Airport
  airlinePubkey: string; // Owner
  distanceKm: number;

  // Schedule
  frequencyPerWeek?: number;

  // Operations
  assignedAircraftIds: string[]; // Which specific planes fly this?

  // Pricing
  fareEconomy: FixedPoint;
  fareBusiness: FixedPoint;
  fareFirst: FixedPoint;

  // Simulation
  status: "active" | "suspended";
  lastTickProcessed?: number;
}

// --- Flight Offer (for QSI calculation) ---

export interface FlightOffer {
  /** Airline pubkey */
  airlinePubkey: string;
  /** Economy fare (FixedPoint) */
  fareEconomy: FixedPoint;
  /** Business fare (FixedPoint) */
  fareBusiness: FixedPoint;
  /** First class fare (FixedPoint) */
  fareFirst: FixedPoint;
  /** Weekly frequency */
  frequencyPerWeek: number;
  /** Estimated travel time in minutes */
  travelTimeMinutes: number;
  /** Number of stops (0 = nonstop) */
  stops: number;
  /** Service quality 0.0–1.0 */
  serviceScore: number;
  /** Brand reputation 0.0–1.0 */
  brandScore: number;
}

export type PassengerClass = "economy" | "business" | "first";

// --- Simulation Tick ---

export interface TickResult {
  /** Tick number */
  tick: number;
  /** Results per airline */
  airlines: Map<string, AirlineTickResult>;
  /** State hash for determinism verification */
  stateHash: string;
}

export interface AirlineTickResult {
  /** Airline pubkey */
  pubkey: string;
  /** Revenue this tick (FixedPoint) */
  revenue: FixedPoint;
  /** Costs this tick (FixedPoint) */
  costs: FixedPoint;
  /** Profit this tick (FixedPoint) */
  profit: FixedPoint;
  /** Per-route results */
  routes: RouteTickResult[];
}

export interface RouteTickResult {
  originIata: string;
  destinationIata: string;
  /** Passengers carried this tick */
  passengers: { economy: number; business: number; first: number };
  /** Load factor 0.0–1.0 */
  loadFactor: number;
  /** Revenue (FixedPoint) */
  revenue: FixedPoint;
  /** Costs (FixedPoint) */
  costs: FixedPoint;
}

// --- Timeline & Auditing ---

export type TimelineEventType =
  | "takeoff"
  | "landing"
  | "purchase"
  | "sale"
  | "lease_payment"
  | "maintenance"
  | "delivery"
  | "hub_change"
  | "route_change"
  | "ferry"
  | "competitor_hub"
  | "price_war"
  | "tier_upgrade"
  | "bankruptcy"
  | "financial_warning";

export interface TimelineEvent {
  id: string;
  tick: number;
  timestamp: number;
  type: TimelineEventType;
  description: string;
  aircraftId?: string;
  aircraftName?: string;
  routeId?: string;
  originIata?: string;
  destinationIata?: string;
  revenue?: FixedPoint;
  cost?: FixedPoint;
  profit?: FixedPoint;
  details?: {
    passengers?: {
      economy: number;
      business: number;
      first: number;
      total: number;
    };
    seatsOffered?: number;
    loadFactor?: number;
    spilledPassengers?: number;
    routeId?: string;
    flightDurationTicks?: number;
    revenue?: {
      tickets: FixedPoint;
      economy: FixedPoint;
      business: FixedPoint;
      first: FixedPoint;
      ancillary: FixedPoint;
    };
    costs?: {
      fuel: FixedPoint;
      crew: FixedPoint;
      maintenance: FixedPoint;
      airport: FixedPoint;
      navigation: FixedPoint;
      leasing: FixedPoint;
      overhead: FixedPoint;
    };
  };
}

// --- Checkpoints ---

export interface Checkpoint {
  schemaVersion: number;
  tick: number;
  createdAt: number;
  actionChainHash: string;
  stateHash: string;
  airline: AirlineEntity;
  fleet: AircraftInstance[];
  routes: Route[];
  timeline: TimelineEvent[];
}

// --- Game Actions ---

export type GameActionType =
  | "AIRLINE_CREATE"
  | "AIRLINE_DISSOLVE"
  | "TICK_UPDATE"
  | "HUB_ADD"
  | "HUB_REMOVE"
  | "HUB_SWITCH"
  | "ROUTE_OPEN"
  | "ROUTE_CLOSE"
  | "ROUTE_REBASE"
  | "ROUTE_ASSIGN_AIRCRAFT"
  | "ROUTE_UNASSIGN_AIRCRAFT"
  | "ROUTE_UPDATE_FARES"
  | "AIRCRAFT_PURCHASE"
  | "AIRCRAFT_SELL"
  | "AIRCRAFT_BUYOUT"
  | "AIRCRAFT_LIST"
  | "AIRCRAFT_CANCEL_LIST"
  | "AIRCRAFT_BUY_USED"
  | "AIRCRAFT_MAINTENANCE"
  | "AIRCRAFT_FERRY"
  | "AIRCRAFT_UPDATE_LIVERY";

export type GameActionPayload = Record<string, unknown>;

export interface GameActionEnvelope {
  schemaVersion: number;
  action: GameActionType;
  payload: GameActionPayload;
}
