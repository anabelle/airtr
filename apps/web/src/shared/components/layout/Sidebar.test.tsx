import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileNav, Sidebar } from "./Sidebar";

afterEach(cleanup);

const defaultState = {
  airline: null,
  viewedPubkey: null,
  fleet: [],
  routes: [],
  competitors: new Map(),
};

vi.mock("@acars/store", () => {
  return {
    useAirlineStore: (selector?: (state: Record<string, unknown>) => unknown) => {
      return selector ? selector(defaultState) : defaultState;
    },
  };
});

vi.mock("@tanstack/react-router", () => {
  return {
    Link: ({
      children,
      className,
      to,
    }: {
      children: ReactNode;
      className?: string;
      to?: string;
    }) => (
      <a className={className} href={to}>
        {children}
      </a>
    ),
  };
});

describe("Sidebar", () => {
  it("renders navigation items", () => {
    render(<Sidebar />);
    expect(screen.getAllByText("Cockpit").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fleet").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Planning").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Competition").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Finance").length).toBeGreaterThan(0);
  });

  it("renders no badges when no airline is loaded", () => {
    render(<Sidebar />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("MobileNav", () => {
  it("renders navigation items", () => {
    render(<MobileNav />);
    expect(screen.getByText("Ops")).toBeInTheDocument();
    expect(screen.getByText("Fleet")).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Rivals")).toBeInTheDocument();
    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(screen.getByText("Info")).toBeInTheDocument();
    expect(screen.queryByText("Competition")).not.toBeInTheDocument();
    expect(screen.queryByText("Finance")).not.toBeInTheDocument();
  });

  it("uses evenly sized slots for mobile navigation items", () => {
    const { container } = render(<MobileNav />);

    const nav = container.querySelector("nav");
    expect(nav).toHaveClass("grid", "grid-cols-6");

    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(6);

    for (const link of links) {
      expect(link).toHaveClass("min-w-0", "justify-center");
      expect(link).not.toHaveClass("min-w-[3.75rem]");
    }
  });
});
