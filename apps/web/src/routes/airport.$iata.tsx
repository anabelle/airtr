import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/airport/$iata")({
  component: lazyRouteComponent(() => import("./-airport.$iata.lazy")),
});
