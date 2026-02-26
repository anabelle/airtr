import { useEngineStore, useAirlineStore } from '@airtr/store';
import { fpFormat } from '@airtr/core';
import { PanelLayout } from '@/shared/components/layout/PanelLayout';
import { CheckCircle2 } from 'lucide-react';

export default function OverviewDashboard() {
    const opportunities = useEngineStore((s) => s.routes);
    const activeRoutes = useAirlineStore((s) => s.routes);
    const homeAirport = useEngineStore((s) => s.homeAirport);

    if (!homeAirport) return null;

    return (
        <PanelLayout>
            <div className="flex h-full w-full flex-col p-6">
                <div className="mb-6 flex items-center justify-between pr-10">
                    <h2 className="text-2xl font-bold tracking-tight text-foreground">Overview</h2>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase text-primary">
                        {activeRoutes.length} Active Routes
                    </span>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="rounded-xl border border-border/50 bg-background/50 p-4">
                        <p className="text-xs uppercase text-muted-foreground font-semibold">Operational Network</p>
                        <p className="mt-2 text-2xl font-mono text-foreground">
                            {activeRoutes.length} Destinations
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1 uppercase font-bold tracking-tighter">Connected to {homeAirport.iata}</p>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-background/50 p-4">
                        <p className="text-xs uppercase text-muted-foreground font-semibold">Active Fleet</p>
                        <p className="mt-2 text-2xl font-mono text-accent">
                            {activeRoutes.reduce((acc, r) => acc + (r.assignedAircraftIds?.length || 0), 0)} Aircraft
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1 uppercase font-bold tracking-tighter">Flying missions</p>
                    </div>
                </div>

                <h3 className="text-sm font-bold uppercase text-muted-foreground mb-4 tracking-widest">Local Market Opportunities</h3>
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                    <div className="space-y-2">
                        {opportunities.slice(0, 50).map((r) => {
                            const totalDemand = r.demand.economy + r.demand.business + r.demand.first;
                            const isOpen = activeRoutes.some(ar => ar.destinationIata === r.destination.iata);

                            return (
                                <div key={r.destination.iata} className={`flex items-center justify-between rounded-xl border border-border/50 bg-background/40 px-4 py-3 hover:bg-accent/10 transition-colors ${isOpen ? 'opacity-50 grayscale' : ''}`}>
                                    <div className="flex w-1/3 flex-col">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-lg font-bold text-accent">{r.destination.iata}</span>
                                            {isOpen && <CheckCircle2 className="h-3 w-3 text-primary" />}
                                        </div>
                                        <span className="truncate text-xs text-muted-foreground">{r.destination.city}</span>
                                    </div>
                                    <div className="flex w-1/3 flex-col text-right">
                                        <span className="text-[10px] uppercase text-muted-foreground">Weekly Demand</span>
                                        <span className="font-mono text-sm">{totalDemand.toLocaleString()}</span>
                                    </div>
                                    <div className="flex w-1/3 flex-col text-right">
                                        <span className="text-[10px] uppercase text-muted-foreground">Daily Potential</span>
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
