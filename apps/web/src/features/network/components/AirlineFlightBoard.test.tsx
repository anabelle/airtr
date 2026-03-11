import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AirlineFlightBoard } from "./AirlineFlightBoard";

const mockBuildAirlineFlightBoardRows = vi.fn();
const mockCountAirlineFlightBoardRows = vi.fn();
const mockUseActiveAirline = vi.fn();
const engineState = { tick: 123 };

vi.mock("@acars/store", () => ({
  useActiveAirline: () => mockUseActiveAirline(),
  useEngineStore: <T,>(selector: (state: typeof engineState) => T) => selector(engineState),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 36,
    getVirtualItems: () => [{ index: 0, size: 36, start: 0 }],
  }),
}));

vi.mock("@/features/network/utils/airlineFlightBoard", () => ({
  buildAirlineFlightBoardRows: (...args: unknown[]) => mockBuildAirlineFlightBoardRows(...args),
  countAirlineFlightBoardRows: (...args: unknown[]) => mockCountAirlineFlightBoardRows(...args),
}));

vi.mock("@/shared/lib/permalinkNavigation", () => ({
  navigateToAirport: vi.fn(),
  navigateToAircraft: vi.fn(),
}));

describe("AirlineFlightBoard", () => {
  const airline = { icaoCode: "TST" };
  const fleet = [{ id: "ac-1" }];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActiveAirline.mockReturnValue({
      airline,
      fleet,
      routes: [],
      timeline: [],
      isViewingOther: false,
      isGuest: false,
    });
    mockCountAirlineFlightBoardRows.mockReturnValue(1);
    mockBuildAirlineFlightBoardRows.mockReturnValue([
      {
        key: "ac-1",
        aircraftId: "ac-1",
        status: "En Route",
        statusTone: "sky",
        flightLabel: "TST123",
        airlineName: "Test Air",
        airlineColor: "#111111",
        otherIata: "MDE",
        originIata: "BOG",
        destinationIata: "MDE",
        aircraft: "ATR 72-600",
        timeLabel: "10:00 -5",
        timeSort: 100,
        loadFactor: 0.75,
      },
    ]);
  });

  it("builds only the visible slice and fixes the positioned row height", () => {
    render(<AirlineFlightBoard />);

    expect(mockCountAirlineFlightBoardRows).toHaveBeenCalledWith(fleet);
    expect(mockBuildAirlineFlightBoardRows).toHaveBeenCalledWith(fleet, airline, 123, {
      start: 0,
      end: 0,
    });

    const row = screen.getByText("TST123").closest("div");
    expect(row).not.toBeNull();
    expect(row).toHaveStyle({
      position: "absolute",
      height: "36px",
      minHeight: "36px",
      transform: "translateY(0px)",
    });
  });
});
