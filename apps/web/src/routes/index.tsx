import { createFileRoute } from '@tanstack/react-router';
import { useEngineStore } from '@airtr/store';
import { fpFormat, fpAdd, FP_ZERO } from '@airtr/core';
import { PanelLayout } from '@/shared/components/layout/PanelLayout';

export const Route = createFileRoute('/')({
    component: OverviewDashboard,
});

function OverviewDashboard() {
    const routes = useEngineStore((s) => s.routes);
    const homeAirport = useEngineStore((s) => s.homeAirport);

    if (!homeAirport) return null;

    return (
        <PanelLayout>
            <div className="flex h-full w-full flex-col p-6">
                <div className="mb-6 flex items-center justify-between pr-10">
                    <h2 className="text-2xl font-bold tracking-tight text-foreground">Overview</h2>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase text-primary">
                        {routes.length} Active Routes
                    </span>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="rounded-xl border border-border/50 bg-background/50 p-4">
                        <p className="text-xs uppercase text-muted-foreground font-semibold">Total Weekly Pax</p>
                        <p className="mt-2 text-2xl font-mono text-foreground">
                            {routes.reduce((acc, r) => acc + r.demand.economy + r.demand.business + r.demand.first, 0).toLocaleString()}
                        </p>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-background/50 p-4">
                        <p className="text-xs uppercase text-muted-foreground font-semibold">Projected Daily Rev</p>
                        <p className="mt-2 text-2xl font-mono text-green-400">
                            {fpFormat(routes.reduce((acc, r) => fpAdd(acc, r.estimatedDailyRevenue), FP_ZERO), 0)}
                        </p>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                    <div className="space-y-2">
                        {routes.slice(0, 50).map((r) => {
                            const totalDemand = r.demand.economy + r.demand.business + r.demand.first;
                            return (
                                <div key={r.destination.iata} className="flex items-center justify-between rounded-md border border-border/50 bg-background/40 px-4 py-3 hover:bg-accent/50 transition-colors">
                                    <div className="flex w-1/3 flex-col">
                                        <span className="font-mono text-lg font-bold text-accent">{r.destination.iata}</span>
                                        <span className="truncate text-xs text-muted-foreground">{r.destination.city}</span>
                                    </div>
                                    <div className="flex w-1/3 flex-col text-right">
                                        <span className="text-[10px] uppercase text-muted-foreground">Weekly Demand</span>
                                        <span className="font-mono text-sm">{totalDemand.toLocaleString()}</span>
                                    </div>
                                    <div className="flex w-1/3 flex-col text-right">
                                        <span className="text-[10px] uppercase text-muted-foreground">Est. Value</span>
                                        <span className="font-mono text-sm text-green-400">{fpFormat(r.estimatedDailyRevenue, 0)}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </PanelLayout>
    );
}
