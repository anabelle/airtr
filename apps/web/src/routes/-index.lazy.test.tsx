import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import MapView from "./-index.lazy";

const mockUseSearch = vi.fn();
const mockNavigate = vi.fn();
const mockUseActiveAirline = vi.fn();

vi.mock("@acars/store", () => ({
  useActiveAirline: () => mockUseActiveAirline(),
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => mockUseSearch(),
  useNavigate: () => mockNavigate,
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
  it("renders the map-first home card by default", () => {
    mockUseActiveAirline.mockReturnValue({ airline: null });
    mockUseSearch.mockReturnValue({ panel: undefined });
    render(<MapView />);
    expect(screen.getByText("Start from the map")).toBeInTheDocument();
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
});
