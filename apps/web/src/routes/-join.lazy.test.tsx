import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import JoinPage from "./-join.lazy";

type Selector<T> = (state: T) => unknown;
type AirlineStoreState = {
  airline: { id: string } | null;
  identityStatus: string;
};

const mockUseAirlineStore = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@acars/store", () => ({
  useAirlineStore: (selector: Selector<AirlineStoreState>) =>
    selector(mockUseAirlineStore() as AirlineStoreState),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/features/identity/components/GuestKeyOnboarding", () => ({
  GuestKeyOnboarding: () => <div>Guest Onboarding</div>,
}));

describe("JoinPage", () => {
  it("redirects ready identities away from the join page even before airline creation", async () => {
    mockUseAirlineStore.mockReturnValue({
      airline: null,
      identityStatus: "ready",
    });

    render(<JoinPage />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
    });
  });

  it("renders onboarding for guest users", () => {
    mockUseAirlineStore.mockReturnValue({
      airline: null,
      identityStatus: "guest",
    });

    render(<JoinPage />);

    expect(screen.getAllByText("Guest Onboarding").length).toBeGreaterThan(0);
  });
});
