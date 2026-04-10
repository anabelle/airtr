import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { PanelLoadingState } from "@/shared/components/layout/PanelLoadingState";

export const Route = createFileRoute("/about")({
  component: lazyRouteComponent(() => import("./-about.lazy")),
  pendingComponent: PanelLoadingState,
});
