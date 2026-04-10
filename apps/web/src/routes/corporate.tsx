import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import { type CorporateSection } from "./-corporate.lazy";
import { PanelLoadingState } from "@/shared/components/layout/PanelLoadingState";

const LazyCorporateWorkspace = lazy(async () => {
  const module = await import("./-corporate.lazy");
  return { default: module.CorporateWorkspace };
});

type CorporateSearch = {
  section: CorporateSection;
};

function CorporateRouteComponent() {
  const search = Route.useSearch();
  return <LazyCorporateWorkspace section={search.section} />;
}

export const Route = createFileRoute("/corporate")({
  validateSearch: (search: Record<string, unknown>): CorporateSearch => ({
    section:
      search.section === "company" ||
      search.section === "network" ||
      search.section === "hubs" ||
      search.section === "activity"
        ? search.section
        : "overview",
  }),
  component: CorporateRouteComponent,
  pendingComponent: PanelLoadingState,
});
