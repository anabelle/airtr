import { createRootRoute, Outlet } from "@tanstack/react-router";
import React, { Suspense } from "react";
import { IdentityGate } from "@/features/identity/components/IdentityGate";
import { Ticker } from "@/features/network/components/Ticker";
import { WorldMap } from "@/features/network/components/WorldMap";
import { Sidebar } from "@/shared/components/layout/Sidebar";
import { Topbar } from "@/shared/components/layout/Topbar";
import { AppInitializer } from "../app/AppInitializer";

type RootSearch = {
  airportTab?: "info" | "flights";
  tab?: "active" | "opportunities";
};

const TanStackRouterDevtools =
  process.env.NODE_ENV === "production"
    ? () => null
    : React.lazy(() =>
        import("@tanstack/router-devtools").then((res) => ({
          default: res.TanStackRouterDevtools,
        })),
      );

export const Route = createRootRoute({
  validateSearch: (search: Record<string, unknown>): RootSearch => {
    return {
      airportTab:
        search.airportTab === "info" || search.airportTab === "flights"
          ? search.airportTab
          : undefined,
      tab: search.tab === "active" || search.tab === "opportunities" ? search.tab : undefined,
    };
  },
  component: () => (
    <AppInitializer>
      <div className="relative flex h-screen w-screen overflow-hidden bg-background text-foreground">
        {/* Layer 0: The WebGL Map (Always rendering in background) */}
        <WorldMap />

        {/* Layer 1: the Tycoon HUD Shell (Overlaying the Map) */}
        <div className="absolute inset-0 z-20 flex flex-col pointer-events-none">
          <IdentityGate>
            {/* Shell is only visible when Identity is fully established */}
            <div className="flex h-full w-full min-h-0 flex-col">
              <Topbar />

              <div className="flex flex-1 min-h-0 overflow-hidden relative pb-10">
                <Sidebar />

                <main className="relative flex-1 min-h-0 p-6 pointer-events-none flex">
                  <Outlet />
                </main>
              </div>
            </div>
          </IdentityGate>
        </div>

        {/* Layer 2: The Global Edge Ticker (Always rendering) */}
        <Ticker />

        <Suspense fallback={null}>
          <TanStackRouterDevtools position="bottom-right" />
        </Suspense>
      </div>
    </AppInitializer>
  ),
});
