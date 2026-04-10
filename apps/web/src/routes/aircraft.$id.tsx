import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { PanelLoadingState } from "@/shared/components/layout/PanelLoadingState";

export const Route = createFileRoute("/aircraft/$id")({
  component: lazyRouteComponent(() => import("./-aircraft.$id.lazy")),
  pendingComponent: PanelLoadingState,
});
