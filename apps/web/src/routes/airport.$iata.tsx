import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { PanelLoadingState } from "@/shared/components/layout/PanelLoadingState";

export const Route = createFileRoute("/airport/$iata")({
  component: lazyRouteComponent(() => import("./-airport.$iata.lazy")),
  pendingComponent: PanelLoadingState,
});
