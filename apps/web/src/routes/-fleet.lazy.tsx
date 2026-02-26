import { PanelLayout } from '@/shared/components/layout/PanelLayout';
import { FleetManager } from '@/features/fleet/components/FleetManager';
import { useAirlineStore } from '@airtr/store';

export default function FleetDashboard() {
  const fleetSize = useAirlineStore(state => state.fleet.length);

  return (
    <PanelLayout>
      <div className="flex h-full w-full flex-col p-6 overflow-hidden">
        <div className="mb-6 flex items-center shrink-0 justify-between pr-10">
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
