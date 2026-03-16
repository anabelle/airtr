import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapView from "./-index.lazy";

const LIVE_WORLD_DISMISSED_UNTIL_KEY = "acars:home:live-world:dismissed-until";
const mockUseSearch = vi.fn();
const mockUseActiveAirline = vi.fn();
const localStorageState = new Map<string, string>();

function createMockStorage(state: Map<string, string>) {
  return {
    getItem: vi.fn((key: string) => state.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      state.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      state.delete(key);
    }),
    clear: vi.fn(() => {
      state.clear();
    }),
  };
}

vi.mock("@acars/store", () => ({
  useActiveAirline: () => mockUseActiveAirline(),
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => mockUseSearch(),
  Link: ({
    children,
    to,
    search,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    to: string;
    search?: Record<string, string>;
  }) => {
    const href = search ? `${to}?${new URLSearchParams(search).toString()}` : to;
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

vi.mock("@/features/cockpit/components/OperationsCockpit", () => ({
  OperationsCockpit: () => <div>Operations Cockpit</div>,
}));

describe("MapView", () => {
  beforeEach(() => {
    localStorageState.clear();
    Object.defineProperty(globalThis, "localStorage", {
      value: createMockStorage(localStorageState),
      configurable: true,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T15:10:38.598Z"));
  });

  afterEach(() => {
    cleanup();
    mockUseActiveAirline.mockReset();
    mockUseSearch.mockReset();
    localStorageState.clear();
    vi.useRealTimers();
  });

  it("renders the map-first home card by default", () => {
    mockUseActiveAirline.mockReturnValue({ airline: null });
    mockUseSearch.mockReturnValue({ panel: undefined });
    render(<MapView />);
    expect(screen.getByText("Start from the map")).toBeInTheDocument();
    expect(screen.queryByText("Click aircraft")).not.toBeInTheDocument();
    expect(screen.queryByText("Inspect airports")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open operator cockpit/i })).toHaveAttribute(
      "href",
      "/?panel=cockpit",
    );
  });

  it("renders the operations cockpit when requested", () => {
    mockUseActiveAirline.mockReturnValue({ airline: null });
    mockUseSearch.mockReturnValue({ panel: "cockpit" });
    render(<MapView />);
    expect(screen.getByText("Operations Cockpit")).toBeInTheDocument();
  });

  it("renders nothing when map panel is requested", () => {
    mockUseActiveAirline.mockReturnValue({ airline: null });
    mockUseSearch.mockReturnValue({ panel: "map" });
    const { container } = render(<MapView />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the airline map card when an airline is active", () => {
    mockUseActiveAirline.mockReturnValue({
      airline: {
        name: "Avianca",
        icaoCode: "AVA",
        callsign: "AVIANCA",
      },
    });
    mockUseSearch.mockReturnValue({ panel: undefined });
    render(<MapView />);
    expect(screen.getByText("Avianca")).toBeInTheDocument();
    expect(screen.getByText("AVA / AVIANCA")).toBeInTheDocument();
  });

  it("persists dismissal for 15 days and hides the intro after closing it", () => {
    mockUseActiveAirline.mockReturnValue({ airline: null });
    mockUseSearch.mockReturnValue({ panel: undefined });

    render(<MapView />);

    fireEvent.click(screen.getByRole("button", { name: /close panel and return to cockpit/i }));

    expect(screen.queryByText("Start from the map")).not.toBeInTheDocument();
    expect(localStorage.getItem(LIVE_WORLD_DISMISSED_UNTIL_KEY)).toBe(
      String(Date.now() + 1000 * 60 * 60 * 24 * 15),
    );
  });

  it("stays hidden while the dismissal window is still active", () => {
    mockUseActiveAirline.mockReturnValue({ airline: null });
    mockUseSearch.mockReturnValue({ panel: undefined });
    localStorage.setItem(LIVE_WORLD_DISMISSED_UNTIL_KEY, String(Date.now() + 1000 * 60 * 60 * 24));

    const { container } = render(<MapView />);

    expect(container.firstChild).toBeNull();
  });
});
