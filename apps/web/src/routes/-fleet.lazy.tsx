import { useActiveAirline, useAirlineStore } from "@acars/store";
import { AlertTriangle, Plane } from "lucide-react";
import { FleetManager } from "@/features/fleet/components/FleetManager";
import { NostrAccessCard } from "@/shared/components/identity/NostrAccessCard";
import { PanelBody, PanelHeader, PanelLayout } from "@/shared/components/layout/PanelLayout";

export default function FleetDashboard() {
  const { airline, initializeIdentity, createNewIdentity, loginWithNsec, isLoading } =
    useAirlineStore();
  const { airline: activeAirline, fleet, isViewingOther } = useActiveAirline();
  const fleetSize = fleet.length;

  const isBankrupt =
    activeAirline?.status === "chapter11" || activeAirline?.status === "liquidated";

  if (!airline && !isViewingOther) {
    return (
      <PanelLayout>
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6 text-center">
          <NostrAccessCard
            icon={Plane}
            title="Fleet access locked"
            description="Connect a Nostr wallet first, then buy aircraft, manage leases, and keep your fleet flying."
            onConnect={initializeIdentity}
            onCreateFree={createNewIdentity}
            onLoginWithNsec={loginWithNsec}
            isLoading={isLoading}
          />
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
      <PanelBody className="pt-3 sm:pt-4">
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
        <FleetManager />
      </PanelBody>
    </PanelLayout>
  );
}
