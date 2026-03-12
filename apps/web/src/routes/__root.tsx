import { createRootRoute, Outlet } from "@tanstack/react-router";
import { IdentityGate } from "@/features/identity/components/IdentityGate";
import { Ticker } from "@/features/network/components/Ticker";
import { WorldMap } from "@/features/network/components/WorldMap";
import { MOBILE_TOPBAR_PANEL_PADDING_CLASS } from "@/shared/components/layout/mobileLayout";
import { MobileNav, Sidebar } from "@/shared/components/layout/Sidebar";
import { Topbar } from "@/shared/components/layout/Topbar";
import { WorkspaceContextBar } from "@/shared/components/layout/WorkspaceContextBar";
import { AppInitializer } from "../app/AppInitializer";

type RootSearch = {
  airportTab?: "info" | "flights";
  aircraftTab?: "info" | "route";
  tab?: "active" | "opportunities";
  returnTo?: string;
};

export const Route = createRootRoute({
  validateSearch: (search: Record<string, unknown>): RootSearch => {
    return {
      airportTab:
        search.airportTab === "info" || search.airportTab === "flights"
          ? search.airportTab
          : undefined,
      aircraftTab:
        search.aircraftTab === "info" || search.aircraftTab === "route"
          ? search.aircraftTab
          : undefined,
      tab: search.tab === "active" || search.tab === "opportunities" ? search.tab : undefined,
      returnTo:
        typeof search.returnTo === "string" && search.returnTo.startsWith("/")
          ? search.returnTo
          : undefined,
    };
  },
  component: () => (
    <AppInitializer>
      <div className="relative flex h-[100dvh] w-screen overflow-hidden bg-background text-foreground">
        {/* Layer 0: The WebGL Map (Always rendering in background) */}
        <WorldMap />

        {/* Layer 1: the Tycoon HUD Shell (Overlaying the Map) */}
        <div className="absolute inset-0 z-20 flex flex-col pointer-events-none">
          <IdentityGate>
            {/* Shell is only visible when Identity is fully established */}
            <div className="flex h-full w-full min-h-0 flex-col">
              <Topbar />
              <WorkspaceContextBar />

              <div className="flex flex-1 min-h-0 overflow-hidden relative pb-0 sm:pb-10">
                <Sidebar />

                <main
                  className={`relative flex min-h-0 min-w-0 flex-1 overflow-hidden px-3 pb-3 ${MOBILE_TOPBAR_PANEL_PADDING_CLASS} pointer-events-none sm:p-6`}
                >
                  <Outlet />
                </main>
              </div>

              <MobileNav />
            </div>
          </IdentityGate>
        </div>

        {/* Layer 2: The Global Edge Ticker (Always rendering) */}
        <Ticker />
      </div>
    </AppInitializer>
  ),
});
