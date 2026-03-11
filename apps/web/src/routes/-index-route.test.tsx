import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  lazyRouteComponent: vi.fn(),
}));

import { Route } from "./index";

describe("home route search validation", () => {
  it("keeps map as the default panel", () => {
    const validateSearch = (
      Route as unknown as {
        options: {
          validateSearch: (search: Record<string, unknown>) => unknown;
        };
      }
    ).options.validateSearch;

    expect(validateSearch({})).toEqual({ panel: undefined });
    expect(validateSearch({ panel: "bogus" })).toEqual({ panel: undefined });
    expect(validateSearch({ panel: "cockpit" })).toEqual({ panel: "cockpit" });
  });
});
