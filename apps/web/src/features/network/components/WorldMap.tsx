import type { AircraftInstance, Airport, Route } from "@acars/core";
import { TICK_DURATION } from "@acars/core";
import { airports as AIRPORTS } from "@acars/data";
import { Globe as CoreGlobe, getGreatCircleInterpolation } from "@acars/map";
import { useAirlineStore, useEngineStore } from "@acars/store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AircraftInfoPanel } from "@/features/network/components/AircraftInfoPanel";
import { AirportInfoPanel } from "@/features/network/components/AirportInfoPanel";
import { buildGroundPresenceByAirport } from "@/features/network/utils/groundTraffic";

const airportByIata = new Map<string, Airport>(AIRPORTS.map((a) => [a.iata, a]));

/**
 * Compute the best airport (or virtual focus point) for centering the map
 * on a given aircraft. For grounded aircraft, returns the base airport.
 * For enroute aircraft, returns a virtual Airport at the interpolated position.
 */
function getAircraftFocusPoint(ac: AircraftInstance, tick: number, tickProgress: number): Airport | null {
  if (ac.status === "enroute" && ac.flight) {
    const origin = airportByIata.get(ac.flight.originIata);
    const dest = airportByIata.get(ac.flight.destinationIata);
    if (origin && dest) {
      const elapsed = (tick - ac.flight.departureTick + tickProgress) * TICK_DURATION;
      const duration = (ac.flight.arrivalTick - ac.flight.departureTick) * TICK_DURATION;
      const progress = duration > 0 ? Math.max(0, Math.min(1, elapsed / duration)) : 0;
      const [lng, lat] = getGreatCircleInterpolation(
        [origin.longitude, origin.latitude],
        [dest.longitude, dest.latitude],
        progress,
      );
      // Return virtual airport at interpolated position
      return { ...dest, latitude: lat, longitude: lng };
    }
    return dest ?? null;
  }
  return ac.baseAirportIata ? airportByIata.get(ac.baseAirportIata) ?? null : null;
}

export function WorldMap() {
  const homeAirport = useEngineStore((s) => s.homeAirport);
  const tick = useEngineStore((s) => s.tick);
  const tickProgress = useEngineStore((s) => s.tickProgress);
  const permalinkAirportIata = useEngineStore((s) => s.permalinkAirportIata);
  const permalinkAircraftId = useEngineStore((s) => s.permalinkAircraftId);
  const { airline, fleet, fleetByOwner, routesByOwner, competitors, routes, pubkey } =
    useAirlineStore();
  const [inspectedAirport, setInspectedAirport] = useState<Airport | null>(null);
  const [inspectedAircraft, setInspectedAircraft] = useState<AircraftInstance | null>(null);
  const [focusedAirport, setFocusedAirport] = useState<Airport | null>(null);

  // Permalink deep-link: when permalinkAirportIata is set (e.g. /airport/JFK),
  // automatically focus and inspect that airport on the map.
  useEffect(() => {
    if (!permalinkAirportIata) return;
    const airport = airportByIata.get(permalinkAirportIata);
    if (airport) {
      // Deferred to satisfy react-hooks/set-state-in-effect — this effect
      // synchronises external Zustand store state with local component state.
      queueMicrotask(() => {
        setFocusedAirport(airport);
        setInspectedAirport(airport);
        setInspectedAircraft(null);
      });
    }
  }, [permalinkAirportIata]);

  const competitorLiveries = useMemo(() => {
    const map = new Map<string, { primary: string; secondary: string }>();
    competitors.forEach((value, key) => {
      if (value.livery?.primary && value.livery?.secondary) {
        map.set(key, {
          primary: value.livery.primary,
          secondary: value.livery.secondary,
        });
      }
    });
    return map;
  }, [competitors]);

  const playerHubs = useMemo(() => airline?.hubs ?? [], [airline?.hubs]);

  const competitorHubColors = useMemo(() => {
    const map = new Map<string, string>();
    competitors.forEach((value) => {
      if (!value.livery?.primary || !value.hubs?.length) return;
      for (const hubIata of value.hubs) {
        if (!map.has(hubIata)) {
          map.set(hubIata, value.livery.primary);
        }
      }
    });
    return map;
  }, [competitors]);

  const playerRouteDestinations = useMemo(() => {
    const destinations = new Set<string>();
    if (!playerHubs.length) return destinations;
    for (const route of routes) {
      if (route.status !== "active") continue;
      const originIsHub = playerHubs.includes(route.originIata);
      const destIsHub = playerHubs.includes(route.destinationIata);
      if (originIsHub && !destIsHub) destinations.add(route.destinationIata);
      if (destIsHub && !originIsHub) destinations.add(route.originIata);
    }
    return destinations;
  }, [playerHubs, routes]);

  const handleAirportSelect = (airport: Airport | null) => {
    if (!airport) return;
    setInspectedAirport(airport);
    setFocusedAirport(airport);
    setInspectedAircraft(null);
    // Sync URL to permalink — replaceState so we don't pollute history
    window.history.replaceState(null, "", `/airport/${airport.iata}`);
  };

  const clearAirportFocus = () => {
    setInspectedAirport(null);
    setFocusedAirport(null);
    // Restore URL to root when clearing airport focus
    window.history.replaceState(null, "", "/");
  };

  const competitorFleet = useMemo(() => {
    const playerPubkey = pubkey ?? null;
    const result: AircraftInstance[] = [];
    fleetByOwner.forEach((ownerFleet, key) => {
      if (key !== playerPubkey) result.push(...ownerFleet);
    });
    return result;
  }, [pubkey, fleetByOwner]);

  // Permalink deep-link: when permalinkAircraftId is set (e.g. /aircraft/abc123),
  // automatically inspect that aircraft on the map and center on its position.
  useEffect(() => {
    if (!permalinkAircraftId) return;
    const ac =
      fleet.find((a) => a.id === permalinkAircraftId) ??
      competitorFleet.find((a) => a.id === permalinkAircraftId) ??
      null;
    if (ac) {
      // Read tick imperatively to avoid re-running this effect every frame
      const { tick: t, tickProgress: tp } = useEngineStore.getState();
      // Deferred to satisfy react-hooks/set-state-in-effect
      queueMicrotask(() => {
        setInspectedAircraft(ac);
        setInspectedAirport(null);
        setFocusedAirport(getAircraftFocusPoint(ac, t, tp));
      });
    } else if (fleet.length > 0 || competitorFleet.length > 0) {
      // Fleet data loaded but aircraft not found — invalid ID, redirect home
      window.history.replaceState(null, "", "/");
    }
    // Re-run whenever fleet data updates (aircraft load asynchronously from Nostr)
  }, [permalinkAircraftId, fleet, competitorFleet]);

  const competitorRoutes = useMemo(() => {
    const playerPubkey = pubkey ?? null;
    const result: Route[] = [];
    routesByOwner.forEach((ownerRoutes, key) => {
      if (key !== playerPubkey) result.push(...ownerRoutes);
    });
    return result;
  }, [pubkey, routesByOwner]);

  const handleAircraftSelect = useCallback(
    (aircraftId: string) => {
      const ac =
        fleet.find((a) => a.id === aircraftId) ??
        competitorFleet.find((a) => a.id === aircraftId) ??
        null;
      if (!ac) return;
      setInspectedAircraft(ac);
      setInspectedAirport(null);
      setFocusedAirport(getAircraftFocusPoint(ac, tick, tickProgress));
      window.history.replaceState(null, "", `/aircraft/${aircraftId}`);
    },
    [fleet, competitorFleet, tick, tickProgress],
  );

  const clearAircraftFocus = () => {
    setInspectedAircraft(null);
    window.history.replaceState(null, "", "/");
  };

  const { presence: groundPresence } = useMemo(
    () => buildGroundPresenceByAirport(fleet, competitorFleet, airline ?? null, competitors),
    [fleet, competitorFleet, airline, competitors],
  );

  if (!homeAirport) return null;

  const selectedAirport = focusedAirport ?? homeAirport;

  return (
    <div className="absolute inset-0 w-full h-full z-0 overflow-hidden bg-black">
      <CoreGlobe
        airports={AIRPORTS}
        selectedAirport={selectedAirport}
        onAirportSelect={handleAirportSelect}
        onAircraftSelect={handleAircraftSelect}
        onMapClick={() => {
          setInspectedAirport(null);
          setInspectedAircraft(null);
          setFocusedAirport(null);
          window.history.replaceState(null, "", "/");
        }}
        groundPresence={groundPresence}
        fleet={fleet}
        competitorFleet={competitorFleet}
        competitorRoutes={competitorRoutes}
        playerLivery={airline?.livery || null}
        competitorLiveries={competitorLiveries}
        playerHubs={playerHubs}
        competitorHubColors={competitorHubColors}
        playerRouteDestinations={playerRouteDestinations}
        tick={tick}
        tickProgress={tickProgress}
      />
      {inspectedAirport ? (
        <AirportInfoPanel airport={inspectedAirport} onClose={clearAirportFocus} />
      ) : null}
      {inspectedAircraft ? (
        <AircraftInfoPanel aircraft={inspectedAircraft} onClose={clearAircraftFocus} />
      ) : null}
      {focusedAirport ? (
        <div className="pointer-events-none absolute left-4 top-4 z-20 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">
          Focus: {focusedAirport.iata}
        </div>
      ) : null}
      {/* Map vignette overlay */}
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_150px_rgba(0,0,0,0.9)] z-10" />
    </div>
  );
}
