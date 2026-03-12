import type { Airport } from "@acars/core";
import { airports as AIRPORTS } from "@acars/data";
import { useEngineStore } from "@acars/store";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";

const airportIndex = new Map<string, Airport>(AIRPORTS.map((a) => [a.iata, a]));

export default function AirportPermalinkPage() {
  const { iata } = useParams({ strict: false }) as { iata: string };
  const navigate = useNavigate();
  const setPermalinkAirport = useEngineStore((s) => s.setPermalinkAirport);

  const normalizedIata = iata?.toUpperCase() ?? "";
  const airport = airportIndex.get(normalizedIata) ?? null;

  useEffect(() => {
    if (!airport) {
      navigate({ to: "/" });
      return;
    }

    setPermalinkAirport(normalizedIata);

    return () => {
      setPermalinkAirport(null);
    };
  }, [airport, normalizedIata, setPermalinkAirport, navigate]);

  if (!airport) {
    return null;
  }

  return null;
}
