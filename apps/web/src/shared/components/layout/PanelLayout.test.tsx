import { fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { describe, expect, it, vi } from "vitest";
import { PanelHeader, PanelLayout } from "./PanelLayout";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => {
  return {
    useNavigate: () => mockNavigate,
  };
});

describe("PanelLayout", () => {
  it("renders children and calls navigate on close", () => {
    render(
      <PanelLayout>
        <PanelHeader title="Panel title" />
        <div>Panel content</div>
      </PanelLayout>,
    );

    expect(screen.getByText("Panel content")).toBeInTheDocument();

    const button = screen.getByRole("button", {
      name: /close panel and view map/i,
    });
    fireEvent.click(button);
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("localizes the close button label", async () => {
    await i18n.changeLanguage("es");
    render(
      <PanelLayout>
        <PanelHeader title="Panel title" />
      </PanelLayout>,
    );

    expect(screen.getAllByRole("button", { name: /cerrar panel y ver mapa/i }).length).toBe(2);
    await i18n.changeLanguage("en");
  });
});
