import type { Airport } from "@acars/core";
import { airports as AIRPORTS, findPreferredHub } from "@acars/data";
import type { UserLocation } from "@acars/store";
import { useAirlineStore, useEngineStore } from "@acars/store";
import { useEffect, useRef } from "react";

/** Fallback: estimate location from UTC offset */
function estimateLocationFromOffset(): UserLocation {
  const offsetMinutes = new Date().getTimezoneOffset();
  const longitude = -(offsetMinutes / 60) * 15;
  const latitude = 30; // rough global average
  return { latitude, longitude, source: "timezone" };
}

/** IANA timezone detection */
function findAirportByTimezone(occupiedIatas?: ReadonlySet<string>): Airport | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const matches = AIRPORTS.filter((a) => a.timezone === tz);
    if (matches.length > 0) {
      const sorted = [...matches].sort((a, b) => (b.population || 0) - (a.population || 0));
      const available = occupiedIatas ? sorted.find((a) => !occupiedIatas.has(a.iata)) : sorted[0];
      if (available) return available;
      // All timezone matches occupied — fall through to city match
    }

    const tzCity = tz.split("/").pop()?.replace(/_/g, " ").toLowerCase();
    if (tzCity) {
      const cityMatches = AIRPORTS.filter((a) => a.city.toLowerCase() === tzCity);
      if (cityMatches.length > 0) {
        const sorted = [...cityMatches].sort((a, b) => (b.population || 0) - (a.population || 0));
        const available = occupiedIatas
          ? sorted.find((a) => !occupiedIatas.has(a.iata))
          : sorted[0];
        if (available) return available;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Collect all IATA codes used as hubs by competitor airlines. */
function collectOccupiedHubs(
  competitors: ReadonlyMap<string, { hubs: readonly string[] }>,
): Set<string> {
  const occupied = new Set<string>();
  competitors.forEach((airline) => {
    for (const hub of airline.hubs) {
      occupied.add(hub);
    }
  });
  return occupied;
}

export function AppInitializer({ children }: { children: React.ReactNode }) {
  const { airline, initializeIdentity } = useAirlineStore();
  const identityStatus = useAirlineStore((s) => s.identityStatus);
  const competitors = useAirlineStore((s) => s.competitors);
  const homeAirport = useEngineStore((s) => s.homeAirport);
  const userLocation = useEngineStore((s) => s.userLocation);
  const setHub = useEngineStore((s) => s.setHub);
  const startEngine = useEngineStore((s) => s.startEngine);

  // Track whether the user has manually picked a hub via HubPicker.
  // When they do, we must not override their choice.
  const userManuallyPickedHub = useRef(false);

  const isHubSelectionLocked = () =>
    userManuallyPickedHub.current || useEngineStore.getState().userLocation?.source === "manual";

  useEffect(() => {
    initializeIdentity();
  }, [initializeIdentity]);

  useEffect(() => {
    if (userLocation?.source === "manual") {
      userManuallyPickedHub.current = true;
    }
  }, [userLocation]);

  // Once airline loads from Nostr, authoritatively set engine hub to hubs[0].
  // This takes priority over any geo-detection that may have run first.
  useEffect(() => {
    if (!airline || !airline.hubs[0]) return;
    const dbHub = AIRPORTS.find((a) => a.iata === airline.hubs[0]);
    if (dbHub) {
      setHub(
        dbHub,
        { latitude: dbHub.latitude, longitude: dbHub.longitude, source: "manual" },
        "nostr profile",
      );
    }
    startEngine();
  }, [airline, setHub, startEngine]);

  // Initialize hub from geolocation — only for new users (no airline loaded yet).
  // Wait until identity check has completed so we know if a Nostr profile exists.
  useEffect(() => {
    if (homeAirport) return; // Already initialized
    if (identityStatus === "checking") return; // Identity still loading — wait
    if (airline) return; // Returning user — Nostr sync effect handles hub

    const fallbackLocate = () => {
      // Guard: airline may have loaded while geo was pending
      if (useAirlineStore.getState().airline) return;
      if (isHubSelectionLocked()) {
        startEngine();
        return;
      }

      const tzAirport = findAirportByTimezone(
        competitors.size > 0 ? collectOccupiedHubs(competitors) : undefined,
      );
      if (tzAirport) {
        const loc: UserLocation = {
          latitude: tzAirport.latitude,
          longitude: tzAirport.longitude,
          source: "timezone",
        };
        setHub(tzAirport, loc, `timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
      } else {
        const loc = estimateLocationFromOffset();
        const home = findPreferredHub(loc.latitude, loc.longitude);
        setHub(home, loc, "UTC offset");
      }
      startEngine();
    };

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          // Guard: airline may have loaded while geo was pending
          if (useAirlineStore.getState().airline) return;
          if (isHubSelectionLocked()) {
            startEngine();
            return;
          }

          const loc: UserLocation = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            source: "gps",
          };
          const home = findPreferredHub(loc.latitude, loc.longitude);
          setHub(home, loc, "GPS");
          startEngine();
        },
        fallbackLocate,
        { timeout: 3000 },
      );
    } else {
      fallbackLocate();
    }
  }, [homeAirport, identityStatus, airline, competitors, setHub, startEngine]);

  // Re-evaluate the suggested hub once competitor data loads from Nostr.
  // This only fires for new users who haven't created an airline yet and
  // haven't manually selected a hub via the HubPicker.
  useEffect(() => {
    if (airline) return; // Returning user — don't touch their hub
    if (competitors.size === 0) return; // No competitor data yet
    if (!userLocation || !homeAirport) return;

    // Check if the user manually picked a hub (source === "manual")
    if (userLocation.source === "manual") {
      userManuallyPickedHub.current = true;
      return;
    }
    if (userManuallyPickedHub.current) return;

    const occupied = collectOccupiedHubs(competitors);
    if (occupied.size === 0) return;
    if (!occupied.has(homeAirport.iata)) return; // Current suggestion is fine

    // Re-run hub suggestion with competitor awareness
    const { latitude, longitude } = userLocation;
    const better = findPreferredHub(latitude, longitude, undefined, occupied);
    if (better.iata !== homeAirport.iata) {
      setHub(better, { latitude, longitude, source: userLocation.source }, "auto-distributed");
    }
  }, [airline, competitors, homeAirport, userLocation, setHub]);

  return <>{children}</>;
}
