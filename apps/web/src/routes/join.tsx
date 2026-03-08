import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/join")({
  component: lazyRouteComponent(() => import("./-join.lazy")),
});
