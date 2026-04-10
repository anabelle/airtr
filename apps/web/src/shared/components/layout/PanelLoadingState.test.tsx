import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { PanelLoadingState } from "./PanelLoadingState";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

describe("PanelLoadingState", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an accessible loading status", () => {
    render(<PanelLoadingState />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading your live panel");
    expect(screen.getByText("Opening workspace…")).toBeInTheDocument();
  });

  it("localizes the loading copy", async () => {
    await i18n.changeLanguage("es");
    render(<PanelLoadingState />);

    expect(screen.getAllByText("Abriendo espacio de trabajo…").length).toBeGreaterThan(0);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tu panel en vivo");

    await i18n.changeLanguage("en");
  });
});
