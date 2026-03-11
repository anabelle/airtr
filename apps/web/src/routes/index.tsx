import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

type HomeSearch = {
  panel?: "map" | "cockpit";
};

export const Route = createFileRoute("/")({
  component: lazyRouteComponent(() => import("./-index.lazy")),
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    panel: search.panel === "cockpit" ? "cockpit" : undefined,
  }),
});
