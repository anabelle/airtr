import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ——— mocks ——— */

const mockNavigate = vi.fn();
const mockSetPermalinkAircraft = vi.fn();

vi.mock("@acars/store", () => ({
  useEngineStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      setPermalinkAircraft: mockSetPermalinkAircraft,
    };
    return selector ? selector(state) : state;
  },
}));

let mockIdParam = "abc-123";

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ id: mockIdParam }),
  useNavigate: () => mockNavigate,
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

import AircraftPermalinkPage from "./-aircraft.$id.lazy";

describe("Aircraft permalink route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIdParam = "abc-123";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("sets permalink aircraft on mount for valid id", () => {
    render(<AircraftPermalinkPage />);

    expect(mockSetPermalinkAircraft).toHaveBeenCalledWith("abc-123");
  });

  it("redirects to / when id is empty", () => {
    mockIdParam = "";
    render(<AircraftPermalinkPage />);

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
    expect(mockSetPermalinkAircraft).not.toHaveBeenCalled();
  });

  it("renders a drill-down frame", () => {
    render(<AircraftPermalinkPage />);

    expect(screen.getByText("Aircraft desk")).toBeInTheDocument();
    expect(screen.getByText("abc-123")).toBeInTheDocument();
  });

  it("clears permalink aircraft on unmount", () => {
    const { unmount } = render(<AircraftPermalinkPage />);
    mockSetPermalinkAircraft.mockClear();

    unmount();

    expect(mockSetPermalinkAircraft).toHaveBeenCalledWith(null);
  });
});
