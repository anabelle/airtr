import { useEngineStore } from "@acars/store";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { DetailWorkspaceFrame } from "@/features/network/components/DetailWorkspaceFrame";

/**
 * Aircraft permalink page.
 * Visiting /aircraft/{id} will focus the map on that aircraft and open its info panel.
 * The actual rendering is handled by WorldMap (which reads permalinkAircraftId
 * from the engine store). This component just sets the store value and renders
 * nothing in the outlet — the user sees the map with the aircraft panel.
 */
export default function AircraftPermalinkPage() {
  const { t } = useTranslation("common");
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const setPermalinkAircraft = useEngineStore((s) => s.setPermalinkAircraft);

  useEffect(() => {
    if (!id) {
      navigate({ to: "/" });
      return;
    }

    setPermalinkAircraft(id);

    return () => {
      setPermalinkAircraft(null);
    };
  }, [id, navigate, setPermalinkAircraft]);

  if (!id) {
    return null;
  }

  return (
    <DetailWorkspaceFrame
      eyebrow={t("workspace.aircraftTitle")}
      title={id}
      description={t("workspace.aircraftDescription")}
    />
  );
}
