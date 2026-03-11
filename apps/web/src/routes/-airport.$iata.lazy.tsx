import type { Airport } from "@acars/core";
import { airports as AIRPORTS } from "@acars/data";
import { useEngineStore } from "@acars/store";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { DetailWorkspaceFrame } from "@/features/network/components/DetailWorkspaceFrame";

const airportIndex = new Map<string, Airport>(AIRPORTS.map((a) => [a.iata, a]));

/**
 * Airport permalink page.
 * Visiting /airport/JFK will focus the map on JFK and open its info panel.
 * The actual rendering is handled by WorldMap (which reads permalinkAirportIata
 * from the engine store). This component just sets the store value and renders
 * nothing in the outlet — the user sees the map with the airport panel.
 */
export default function AirportPermalinkPage() {
  const { t } = useTranslation("common");
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
    return (
      <div className="pointer-events-none absolute inset-0 flex items-start px-3 pt-[8.75rem] sm:px-6 sm:pt-6">
        <div className="pointer-events-auto rounded-2xl border border-border/70 bg-background/84 px-4 py-2 text-sm text-muted-foreground shadow-[0_20px_60px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
          {t("topbar.loading")}
        </div>
      </div>
    );
  }

  if (!airport) {
    return null;
  }

  return (
    <DetailWorkspaceFrame
      eyebrow={t("workspace.airportTitle")}
      title={`${airport.iata} - ${airport.city}`}
      description={t("workspace.airportDescription")}
    />
  );
}
