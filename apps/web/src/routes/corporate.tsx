import { createFileRoute } from "@tanstack/react-router";
import { type CorporateSection, CorporateWorkspace } from "./-corporate.lazy";

type CorporateSearch = {
  section: CorporateSection;
};

function CorporateRouteComponent() {
  const search = Route.useSearch();
  return <CorporateWorkspace section={search.section} />;
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
});
