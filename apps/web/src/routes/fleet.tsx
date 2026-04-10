import { createFileRoute } from "@tanstack/react-router";
import { lazyRouteComponent } from "@tanstack/react-router";
import { PanelLoadingState } from "@/shared/components/layout/PanelLoadingState";

export const Route = createFileRoute("/fleet")({
  component: lazyRouteComponent(() => import("./-fleet.lazy")),
  pendingComponent: PanelLoadingState,
});
