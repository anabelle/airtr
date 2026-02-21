// ============================================================
// @airtr/core — Type Definitions
// ============================================================
// These types are the PUBLIC CONTRACT of this package.
// See CONTRACT.md before modifying any export.
// ============================================================

// --- Fixed-Point Financial Type ---

/**
 * Fixed-point integer representation of money.
 * 4 decimal places: $1.00 = 10000.
 * See ADR-002 for rationale.
 */
export type FixedPoint = number & { readonly __brand: 'FixedPoint' };

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

export type AirportTag = 'beach' | 'ski' | 'business' | 'general';

// --- Season ---

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

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

// --- Aircraft ---

export interface AircraftType {
    /** Aircraft type designator (e.g. "A320neo") */
    designator: string;
    /** Full name (e.g. "Airbus A320neo") */
    name: string;
    /** Manufacturer */
    manufacturer: string;
    /** Total seats (typical config) */
    seats: number;
    /** Maximum range in km */
    rangeKm: number;
    /** Cruise speed in km/h */
    cruiseSpeedKmh: number;
    /** Fuel burn in kg per km */
    fuelPerKm: number;
    /** Crew required (cockpit + cabin) */
    crewCount: number;
    /** Monthly lease cost (USD, as FixedPoint) */
    monthlyLease: FixedPoint;
    /** Maintenance cost per block hour (USD, as FixedPoint) */
    maintPerHour: FixedPoint;
}

// --- Airline ---

export interface Airline {
    /** Nostr pubkey (hex) */
    pubkey: string;
    /** Airline name */
    name: string;
    /** 3-letter ICAO-style code */
    icaoCode: string;
    /** Radio callsign */
    callsign: string;
    /** Hub airport IATA code */
    hubIata: string;
    /** Livery colors */
    livery: {
        primary: string;
        secondary: string;
        accent: string;
    };
    /** Brand score 0.0–1.0 */
    brandScore: number;
    /** Current balance (FixedPoint) */
    balance: FixedPoint;
    /** Current tier (1–4) */
    tier: number;
}

// --- Route ---

export interface Route {
    /** Origin IATA code */
    originIata: string;
    /** Destination IATA code */
    destinationIata: string;
    /** Airline pubkey */
    airlinePubkey: string;
    /** Flights per week */
    frequencyPerWeek: number;
    /** Aircraft type designator assigned */
    aircraftType: string;
    /** Economy fare (FixedPoint) */
    fareEconomy: FixedPoint;
    /** Business fare (FixedPoint) */
    fareBusiness: FixedPoint;
    /** First class fare (FixedPoint) */
    fareFirst: FixedPoint;
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

export type PassengerClass = 'economy' | 'business' | 'first';

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
