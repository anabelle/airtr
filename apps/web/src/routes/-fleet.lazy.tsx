import { useActiveAirline, useAirlineStore } from "@acars/store";
import { AlertTriangle } from "lucide-react";
import { FleetManager } from "@/features/fleet/components/FleetManager";
import { PanelLayout } from "@/shared/components/layout/PanelLayout";

export default function FleetDashboard() {
  const { airline, initializeIdentity, isLoading } = useAirlineStore();
  const { airline: activeAirline, fleet, isViewingOther } = useActiveAirline();
  const fleetSize = fleet.length;

  const isBankrupt =
    activeAirline?.status === "chapter11" || activeAirline?.status === "liquidated";

  if (!airline && !isViewingOther) {
    return (
      <PanelLayout>
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="max-w-md space-y-4 rounded-2xl border border-border/60 bg-background/70 p-6 shadow-2xl backdrop-blur-xl">
            <h2 className="text-lg font-semibold">Fleet access locked</h2>
            <p className="text-sm text-muted-foreground">
              Connect a Nostr wallet to create an airline and manage aircraft, leases, and
              maintenance.
            </p>
            <button
              type="button"
              onClick={initializeIdentity}
              disabled={isLoading}
              className="w-full rounded-md border border-border bg-background/70 px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-60"
            >
              {isLoading ? "Connecting..." : "Connect Wallet"}
            </button>
          </div>
        </div>
      </PanelLayout>
    );
  }

  return (
    <PanelLayout>
      <div className="flex h-full w-full flex-col p-4 sm:p-6 overflow-hidden">
        {isBankrupt && !isViewingOther && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-950/30 px-4 py-3 shrink-0">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span className="text-xs text-rose-300">
              {activeAirline?.status === "chapter11"
                ? "Operations suspended — All aircraft grounded under Chapter 11"
                : "Airline liquidated — Fleet operations permanently ceased"}
            </span>
          </div>
        )}
        <div className="mb-4 sm:mb-6 flex items-center shrink-0 justify-between pr-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Fleet Manager</h2>
          <span className="rounded-full bg-accent/20 px-3 py-1 text-xs font-semibold uppercase text-accent">
            {fleetSize} Aircraft
          </span>
        </div>
        <div className="flex-1 overflow-hidden min-h-0">
          <FleetManager />
        </div>
      </div>
    </PanelLayout>
  );
}
