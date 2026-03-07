import { useActiveAirline, useAirlineStore } from "@acars/store";
import { AlertTriangle } from "lucide-react";
import { FleetManager } from "@/features/fleet/components/FleetManager";
import { PanelBody, PanelHeader, PanelLayout } from "@/shared/components/layout/PanelLayout";

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
              {isLoading ? "Connecting…" : "Connect Wallet"}
            </button>
          </div>
        </div>
      </PanelLayout>
    );
  }

  return (
    <PanelLayout>
      <PanelHeader
        title="Fleet Manager"
        badge={
          <span className="rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-accent sm:px-3 sm:text-xs">
            {fleetSize} Aircraft
          </span>
        }
      />
      <PanelBody className="overflow-hidden pt-3 sm:pt-4">
        {isBankrupt && !isViewingOther && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-950/30 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span className="text-xs text-rose-300">
              {activeAirline?.status === "chapter11"
                ? "Operations suspended — All aircraft grounded under Chapter 11"
                : "Airline liquidated — Fleet operations permanently ceased"}
            </span>
          </div>
        )}
        <div className="min-h-0 h-full">
          <FleetManager />
        </div>
      </PanelBody>
    </PanelLayout>
  );
}
