import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MapView from "./-index.lazy";

vi.mock("@/features/cockpit/components/OperationsCockpit", () => ({
  OperationsCockpit: () => <div>Operations Cockpit</div>,
}));

describe("MapView", () => {
  it("renders the operations cockpit", () => {
    render(<MapView />);
    expect(screen.getByText("Operations Cockpit")).toBeInTheDocument();
  });
});
