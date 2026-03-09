import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createRootRoute: (options: Record<string, unknown>) => options,
  Outlet: () => <div data-testid="outlet" />,
}));

vi.mock("@/app/AppInitializer", () => ({
  AppInitializer: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/features/identity/components/IdentityGate", () => ({
  IdentityGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/features/network/components/Ticker", () => ({
  Ticker: () => <div data-testid="ticker" />,
}));

vi.mock("@/features/network/components/WorldMap", () => ({
  WorldMap: () => <div data-testid="world-map" />,
}));

vi.mock("@/shared/components/layout/Sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar" />,
  MobileNav: () => <div data-testid="mobile-nav" />,
}));

vi.mock("@/shared/components/layout/Topbar", () => ({
  Topbar: () => <div data-testid="topbar" />,
}));

import { Route } from "./__root";

afterEach(cleanup);

describe("root route layout", () => {
  it("reserves mobile clearance for the floating topbar above outlet panels", () => {
    const Component = (Route as unknown as { component: () => ReactNode }).component;
    const { container } = render(<Component />);

    const main = container.querySelector("main");
    expect(main).toHaveClass("pt-[4.75rem]");
    expect(main).toHaveClass("px-3", "pb-3");
  });
});
