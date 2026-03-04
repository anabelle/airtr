import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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
}));

import AircraftPermalinkPage from "./-aircraft.$id.lazy";

describe("Aircraft permalink route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIdParam = "abc-123";
    });

    afterEach(() => {
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

    it("renders null (no visible output)", () => {
        const { container } = render(<AircraftPermalinkPage />);

        expect(container.innerHTML).toBe("");
    });

    it("clears permalink aircraft on unmount", () => {
        const { unmount } = render(<AircraftPermalinkPage />);
        mockSetPermalinkAircraft.mockClear();

        unmount();

        expect(mockSetPermalinkAircraft).toHaveBeenCalledWith(null);
    });
});
