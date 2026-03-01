import type { AircraftInstance, AirlineEntity } from "@acars/core";

export type GroundTrafficEntry = {
  key: string;
  name: string;
  icaoCode?: string;
  livery?: AirlineEntity["livery"];
  count: number;
  aircraft: AircraftInstance[];
  isPlayer: boolean;
};

export type GroundPresenceSegment = {
  color: string;
  count: number;
  isPlayer?: boolean;
};

export const GROUNDED_STATUSES = new Set<AircraftInstance["status"]>([
  "idle",
  "turnaround",
  "maintenance",
]);

export function isGrounded(aircraft: AircraftInstance): boolean {
  return GROUNDED_STATUSES.has(aircraft.status);
}

export function buildGroundTraffic(
  airportIata: string,
  fleet: AircraftInstance[],
  competitorFleet: AircraftInstance[],
  airline: AirlineEntity | null,
  competitors: Map<string, AirlineEntity>,
): { totalCount: number; entries: GroundTrafficEntry[] } {
  const entries = new Map<string, GroundTrafficEntry>();
  let totalCount = 0;

  const addEntry = (
    key: string,
    name: string,
    icaoCode: string | undefined,
    livery: AirlineEntity["livery"] | undefined,
    aircraft: AircraftInstance,
    isPlayer: boolean,
  ) => {
    const existing = entries.get(key);
    if (existing) {
      existing.count += 1;
      existing.aircraft.push(aircraft);
      return;
    }

    entries.set(key, {
      key,
      name,
      icaoCode,
      livery,
      count: 1,
      aircraft: [aircraft],
      isPlayer,
    });
  };

  for (const aircraft of fleet) {
    if (aircraft.baseAirportIata !== airportIata || !isGrounded(aircraft)) continue;
    totalCount += 1;
    addEntry(
      airline?.ceoPubkey ?? "player",
      airline?.name ?? "Your Airline",
      airline?.icaoCode,
      airline?.livery,
      aircraft,
      true,
    );
  }

  for (const aircraft of competitorFleet) {
    if (aircraft.baseAirportIata !== airportIata || !isGrounded(aircraft)) continue;
    totalCount += 1;
    const competitor = competitors.get(aircraft.ownerPubkey);
    addEntry(
      aircraft.ownerPubkey,
      competitor?.name ?? "Unknown Carrier",
      competitor?.icaoCode,
      competitor?.livery,
      aircraft,
      false,
    );
  }

  const sorted = Array.from(entries.values()).sort((a, b) => {
    if (a.isPlayer !== b.isPlayer) return a.isPlayer ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });

  return { totalCount, entries: sorted };
}

export function buildGroundPresenceByAirport(
  fleet: AircraftInstance[],
  competitorFleet: AircraftInstance[],
  airline: AirlineEntity | null,
  competitors: Map<string, AirlineEntity>,
): {
  totals: Record<string, number>;
  presence: Record<string, GroundPresenceSegment[]>;
} {
  const totals: Record<string, number> = {};
  const presenceByAirport = new Map<string, Map<string, GroundPresenceSegment>>();

  const addPresence = (airportIata: string, key: string, color: string, isPlayer: boolean) => {
    const airportMap = presenceByAirport.get(airportIata) ?? new Map();
    const existing = airportMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      airportMap.set(key, { color, count: 1, isPlayer });
    }
    presenceByAirport.set(airportIata, airportMap);
    totals[airportIata] = (totals[airportIata] || 0) + 1;
  };

  for (const aircraft of fleet) {
    if (!aircraft.baseAirportIata || !isGrounded(aircraft)) continue;
    addPresence(
      aircraft.baseAirportIata,
      airline?.ceoPubkey ?? "player",
      airline?.livery?.primary ?? "#94a3b8",
      true,
    );
  }

  for (const aircraft of competitorFleet) {
    if (!aircraft.baseAirportIata || !isGrounded(aircraft)) continue;
    const competitor = competitors.get(aircraft.ownerPubkey);
    addPresence(
      aircraft.baseAirportIata,
      aircraft.ownerPubkey,
      competitor?.livery?.primary ?? "#94a3b8",
      false,
    );
  }

  const presence: Record<string, GroundPresenceSegment[]> = {};
  presenceByAirport.forEach((segments, airportIata) => {
    const sorted = Array.from(segments.values()).sort((a, b) => {
      if (a.isPlayer !== b.isPlayer) return a.isPlayer ? -1 : 1;
      if (a.count !== b.count) return b.count - a.count;
      return a.color.localeCompare(b.color);
    });
    presence[airportIata] = sorted;
  });

  return { totals, presence };
}
