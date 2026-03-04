import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/aircraft/$id")({
  component: lazyRouteComponent(() => import("./-aircraft.$id.lazy")),
});
