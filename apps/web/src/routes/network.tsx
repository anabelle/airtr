import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { PanelLoadingState } from "@/shared/components/layout/PanelLoadingState";

type NetworkSearch = {
  tab: "active" | "opportunities";
};

export const Route = createFileRoute("/network")({
  component: lazyRouteComponent(() => import("./-network.lazy")),
  pendingComponent: PanelLoadingState,
  validateSearch: (search: Record<string, unknown>): NetworkSearch => {
    return {
      tab: search.tab === "opportunities" ? "opportunities" : "active",
    };
  },
});
