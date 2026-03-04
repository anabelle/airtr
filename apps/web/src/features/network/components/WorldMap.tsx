import type { AircraftInstance, Airport, Route } from "@acars/core";
import { airports as AIRPORTS } from "@acars/data";
import { Globe as CoreGlobe } from "@acars/map";
import { useAirlineStore, useEngineStore } from "@acars/store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AircraftInfoPanel } from "@/features/network/components/AircraftInfoPanel";
import { AirportInfoPanel } from "@/features/network/components/AirportInfoPanel";
import { buildGroundPresenceByAirport } from "@/features/network/utils/groundTraffic";

const airportByIata = new Map<string, Airport>(AIRPORTS.map((a) => [a.iata, a]));

export function WorldMap() {
  const homeAirport = useEngineStore((s) => s.homeAirport);
  const tick = useEngineStore((s) => s.tick);
  const tickProgress = useEngineStore((s) => s.tickProgress);
  const permalinkAirportIata = useEngineStore((s) => s.permalinkAirportIata);
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
      setFocusedAirport(airport);
      setInspectedAirport(airport);
      setInspectedAircraft(null);
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
      setFocusedAirport(null);
      window.history.replaceState(null, "", "/");
    },
    [fleet, competitorFleet],
  );

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
        <AircraftInfoPanel
          aircraft={inspectedAircraft}
          onClose={() => {
            setInspectedAircraft(null);
          }}
        />
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
