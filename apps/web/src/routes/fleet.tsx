import { createFileRoute } from '@tanstack/react-router';
import { PanelLayout } from '@/shared/components/layout/PanelLayout';

export const Route = createFileRoute('/fleet')({
  component: FleetDashboard,
});

function FleetDashboard() {
  return (
    <PanelLayout>
      <div className="flex h-full w-full flex-col p-6">
        <div className="mb-6 flex items-center justify-between pr-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Fleet Manager</h2>
          <span className="rounded-full bg-accent/20 px-3 py-1 text-xs font-semibold uppercase text-accent">
            0 Aircraft
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center border-2 border-dashed border-border/50 rounded-xl">
          <div className="text-center space-y-2 text-muted-foreground">
            <p className="font-mono text-sm uppercase">Global Marketplace</p>
            <p className="text-xs">Awaiting data sync...</p>
          </div>
        </div>
      </div>
    </PanelLayout>
  );
}
