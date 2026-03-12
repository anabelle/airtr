import { useEngineStore } from "@acars/store";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";

export default function AircraftPermalinkPage() {
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

  return null;
}
