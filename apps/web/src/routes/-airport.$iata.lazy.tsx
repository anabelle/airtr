import type { Airport } from "@acars/core";
import { airports as AIRPORTS } from "@acars/data";
import { useEngineStore } from "@acars/store";
import { useParams, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

const airportIndex = new Map<string, Airport>(AIRPORTS.map((a) => [a.iata, a]));

/**
 * Airport permalink page.
 * Visiting /airport/JFK will focus the map on JFK and open its info panel.
 * The actual rendering is handled by WorldMap (which reads permalinkAirportIata
 * from the engine store). This component just sets the store value and renders
 * nothing in the outlet — the user sees the map with the airport panel.
 */
export default function AirportPermalinkPage() {
  const { iata } = useParams({ strict: false }) as { iata: string };
  const navigate = useNavigate();
  const setPermalinkAirport = useEngineStore((s) => s.setPermalinkAirport);
  const homeAirport = useEngineStore((s) => s.homeAirport);

  const normalizedIata = iata?.toUpperCase() ?? "";
  const airport = airportIndex.get(normalizedIata) ?? null;

  useEffect(() => {
    if (!airport) {
      // Invalid IATA — redirect home
      navigate({ to: "/" });
      return;
    }

    setPermalinkAirport(normalizedIata);

    return () => {
      // Clear permalink state when navigating away
      setPermalinkAirport(null);
    };
  }, [airport, normalizedIata, setPermalinkAirport, navigate]);

  // If we don't have a home airport yet (identity gate still loading),
  // show a minimal loading state. Once the identity gate resolves,
  // WorldMap will pick up the permalink IATA and fly to it.
  if (!homeAirport && airport) {
    return null; // WorldMap will handle display once ready
  }

  // This route renders nothing in the outlet — WorldMap handles the visual
  return null;
}
