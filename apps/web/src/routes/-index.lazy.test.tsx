import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import MapView from "./-index.lazy";

const mockUseSearch = vi.fn();

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
  it("renders the map-first home card by default", () => {
    mockUseSearch.mockReturnValue({ panel: undefined });
    render(<MapView />);
    expect(screen.getByText("Start from the map")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open operator cockpit/i })).toHaveAttribute(
      "href",
      "/?panel=cockpit",
    );
  });

  it("renders the operations cockpit when requested", () => {
    mockUseSearch.mockReturnValue({ panel: "cockpit" });
    render(<MapView />);
    expect(screen.getByText("Operations Cockpit")).toBeInTheDocument();
  });
});
