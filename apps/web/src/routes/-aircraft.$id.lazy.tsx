import { useEngineStore } from "@acars/store";
import { useParams, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * Aircraft permalink page.
 * Visiting /aircraft/{id} will focus the map on that aircraft and open its info panel.
 * The actual rendering is handled by WorldMap (which reads permalinkAircraftId
 * from the engine store). This component just sets the store value and renders
 * nothing in the outlet — the user sees the map with the aircraft panel.
 */
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

    return null;
}
