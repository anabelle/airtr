import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IdentityGate } from "./IdentityGate";

const mockUseAirlineStore = vi.fn();

vi.mock("@airtr/store", () => {
  return {
    useAirlineStore: () => mockUseAirlineStore(),
  };
});

vi.mock("./AirlineCreator", () => {
  return {
    AirlineCreator: () => <div>Airline Creator</div>,
  };
});

describe("IdentityGate", () => {
  it("renders loading state while checking identity", () => {
    mockUseAirlineStore.mockReturnValue({
      identityStatus: "checking",
      airline: null,
      initializeIdentity: vi.fn(),
      isLoading: false,
      error: null,
    });

    render(
      <IdentityGate>
        <div>App</div>
      </IdentityGate>,
    );

    expect(screen.getByText(/Establishing secure connection/i)).toBeInTheDocument();
  });

  it("renders children when no extension is available", () => {
    mockUseAirlineStore.mockReturnValue({
      identityStatus: "no-extension",
      airline: null,
    });

    render(
      <IdentityGate>
        <div>App</div>
      </IdentityGate>,
    );

    expect(screen.getByText("App")).toBeInTheDocument();
  });

  it("renders airline creator when identity is ready without airline", () => {
    mockUseAirlineStore.mockReturnValue({
      identityStatus: "ready",
      airline: null,
      initializeIdentity: vi.fn(),
      isLoading: false,
      error: null,
    });

    render(
      <IdentityGate>
        <div>App</div>
      </IdentityGate>,
    );

    expect(screen.getByText("Airline Creator")).toBeInTheDocument();
  });

  it("renders children when airline is available", () => {
    mockUseAirlineStore.mockReturnValue({
      identityStatus: "ready",
      airline: { id: "airline" },
      initializeIdentity: vi.fn(),
      isLoading: false,
      error: null,
    });

    render(
      <IdentityGate>
        <div>App</div>
      </IdentityGate>,
    );

    expect(screen.getAllByText("App").length).toBeGreaterThan(0);
  });
});
