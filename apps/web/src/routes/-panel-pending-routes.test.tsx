import { describe, expect, it } from "vitest";
import { PanelLoadingState } from "@/shared/components/layout/PanelLoadingState";
import { Route as AboutRoute } from "./about";
import { Route as AircraftRoute } from "./aircraft.$id";
import { Route as AirportRoute } from "./airport.$iata";
import { Route as CorporateRoute } from "./corporate";
import { Route as FleetRoute } from "./fleet";
import { Route as LeaderboardRoute } from "./leaderboard";
import { Route as NetworkRoute } from "./network";

const panelRoutes = [
  AboutRoute,
  AircraftRoute,
  AirportRoute,
  CorporateRoute,
  FleetRoute,
  LeaderboardRoute,
  NetworkRoute,
] as const;

describe("panel routes", () => {
  it("use the shared pending workspace state while code-split panels load", () => {
    for (const route of panelRoutes) {
      expect(
        (route as unknown as { options: { pendingComponent?: unknown } }).options.pendingComponent,
      ).toBe(PanelLoadingState);
    }
  });
});
