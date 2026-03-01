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
    Link: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

describe("Sidebar", () => {
  it("renders navigation items", () => {
    render(<Sidebar />);
    expect(screen.getByText("Map")).toBeInTheDocument();
    expect(screen.getByText("Fleet")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByText("Leaderboard")).toBeInTheDocument();
    expect(screen.getByText("Corporate")).toBeInTheDocument();
  });

  it("renders no badges when no airline is loaded", () => {
    render(<Sidebar />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("MobileNav", () => {
  it("renders navigation items", () => {
    render(<MobileNav />);
    expect(screen.getByText("Map")).toBeInTheDocument();
    expect(screen.getByText("Fleet")).toBeInTheDocument();
  });
});
