import { render, screen } from "@testing-library/react";
import { Suspense, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

const useSearchMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    ({
      component,
      validateSearch,
    }: {
      component: () => ReactElement;
      validateSearch: (search: Record<string, unknown>) => unknown;
    }) => ({
      options: { component, validateSearch },
      useSearch: () => useSearchMock(),
    }),
}));

vi.mock("./-corporate.lazy", () => ({
  CorporateWorkspace: ({ section }: { section: string }) => <div>{`corporate:${section}`}</div>,
}));

vi.mock("@/shared/components/layout/PanelLoadingState", () => ({
  PanelLoadingState: () => <div>loading workspace</div>,
}));

import { Route } from "./corporate";

describe("corporate route", () => {
  it("defaults unknown search sections to overview", () => {
    const validateSearch = (
      Route as unknown as {
        options: {
          validateSearch: (search: Record<string, unknown>) => {
            section: string;
          };
        };
      }
    ).options.validateSearch;

    expect(validateSearch({})).toEqual({ section: "overview" });
    expect(validateSearch({ section: "bogus" })).toEqual({
      section: "overview",
    });
    expect(validateSearch({ section: "activity" })).toEqual({
      section: "activity",
    });
  });

  it("renders the selected workspace section", async () => {
    useSearchMock.mockReturnValue({ section: "network" });
    const Component = (Route as unknown as { options: { component: () => ReactElement } }).options
      .component;
    render(
      <Suspense fallback={<div>loading workspace</div>}>
        <Component />
      </Suspense>,
    );
    expect(await screen.findByText("corporate:network")).toBeInTheDocument();
  });
});
