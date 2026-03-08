import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HubPicker } from "./HubPicker";

vi.mock("@tanstack/react-virtual", () => {
  return {
    useVirtualizer: () => ({
      getTotalSize: () => 64,
      getVirtualItems: () => [{ index: 0, size: 64, start: 0 }],
    }),
  };
});

vi.mock("@acars/data", () => {
  return {
    airports: [
      {
        iata: "JFK",
        city: "New York",
        name: "John F Kennedy",
        country: "US",
        timezone: "UTC",
        population: 1000,
      },
    ],
    getHubPricingForIata: () => ({ openFee: 1000, monthlyOpex: 100, tier: "regional" }),
    HUB_CLASSIFICATIONS: { JFK: { slotControlled: false, baseCapacityPerHour: 100 } },
  };
});

describe("HubPicker", () => {
  it("opens modal and selects airport", () => {
    const onSelect = vi.fn();
    render(<HubPicker currentHub={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Choose Your Hub Manually"));
    fireEvent.click(screen.getByText("JFK"));
    fireEvent.click(screen.getByText("Confirm Hub"));
    expect(onSelect).toHaveBeenCalled();
  });
});
