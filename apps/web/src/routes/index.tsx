import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

type HomeSearch = {
  panel?: "map" | "cockpit";
};

export const Route = createFileRoute("/")({
  component: lazyRouteComponent(() => import("./-index.lazy")),
  validateSearch: (search: Record<string, unknown>): HomeSearch => {
    if (search.panel === "cockpit") return { panel: "cockpit" };
    if (search.panel === "map") return { panel: "map" };
    return {};
  },
});
