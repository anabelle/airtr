import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { PanelLoadingState } from "@/shared/components/layout/PanelLoadingState";

export const Route = createFileRoute("/leaderboard")({
  component: lazyRouteComponent(() => import("./-leaderboard.lazy")),
  pendingComponent: PanelLoadingState,
});
