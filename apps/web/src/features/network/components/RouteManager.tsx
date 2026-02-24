import { useState } from 'react';
import { useAirlineStore, useEngineStore } from '@airtr/store';
import { fpFormat, fpAdd, FP_ZERO } from '@airtr/core';
import { Globe, PlusCircle, CheckCircle2, AlertCircle, TrendingUp, DollarSign, MapPin } from 'lucide-react';

export function RouteManager() {
    const { airline, routes: activeRoutes, openRoute, updateRouteFares } = useAirlineStore();
    const { routes: prospectiveRoutes, homeAirport } = useEngineStore();
    const [tab, setTab] = useState<'active' | 'opportunities'>('active');
    const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
    const [tempFares, setTempFares] = useState<{ e: string; b: string; f: string }>({ e: '', b: '', f: '' });

    if (!airline || !homeAirport) return null;

    return (
        <div className="flex h-full w-full flex-col p-6 overflow-hidden">
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                        < Globe className="h-8 w-8 text-primary" />
                        Network Manager
                    </h2>
                    <p className="text-muted-foreground mt-1">Manage your routes and flight frequencies from {homeAirport.name}.</p>
                </div>

                <div className="flex bg-muted/50 p-1 rounded-xl border border-border/50">
                    <button
                        onClick={() => setTab('active')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${tab === 'active' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        Active Network ({activeRoutes.length})
                    </button>
                    <button
                        onClick={() => setTab('opportunities')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${tab === 'opportunities' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        Market Opportunities
                    </button>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                        <p className="text-xs uppercase text-muted-foreground font-bold tracking-wider">Active Hub</p>
                        <MapPin className="h-4 w-4 text-primary" />
                    </div>
                    <p className="text-2xl font-bold text-foreground">{homeAirport.iata}</p>
                    <p className="text-xs text-muted-foreground truncate">{homeAirport.city}, {homeAirport.country}</p>
                </div>

                <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                        <p className="text-xs uppercase text-muted-foreground font-bold tracking-wider">Total Daily Demand</p>
                        <TrendingUp className="h-4 w-4 text-accent" />
                    </div>
                    <p className="text-2xl font-bold text-foreground">
                        {activeRoutes.reduce((acc, r) => acc + (prospectiveRoutes.find(p => p.destination.iata === r.destinationIata)?.demand.economy || 0), 0).toLocaleString()} pax
                    </p>
                    <p className="text-xs text-muted-foreground">across {activeRoutes.length} active routes</p>
                </div>

                <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                        <p className="text-xs uppercase text-muted-foreground font-bold tracking-wider">Projected Revenue</p>
                        <DollarSign className="h-4 w-4 text-green-400" />
                    </div>
                    <p className="text-2xl font-bold text-green-400 font-mono">
                        {fpFormat(activeRoutes.reduce((acc, r) => {
                            const p = prospectiveRoutes.find(pr => pr.destination.iata === r.destinationIata);
                            return p ? fpAdd(acc, p.estimatedDailyRevenue) : acc;
                        }, FP_ZERO), 0)}
                    </p>
                    <p className="text-xs text-muted-foreground">Est. daily gross profit</p>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {tab === 'active' ? (
                    activeRoutes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-border/50 rounded-3xl bg-muted/20">
                            < Globe className="h-12 w-12 text-muted-foreground/30 mb-4" />
                            <p className="text-muted-foreground font-medium">Your network is empty.</p>
                            <button
                                onClick={() => setTab('opportunities')}
                                className="mt-4 px-6 py-2 bg-primary text-primary-foreground rounded-full text-sm font-bold shadow-lg shadow-primary/20 hover:scale-105 transition-transform"
                            >
                                Browse Market Opportunities
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4">
                            {activeRoutes.map((route) => {
                                const market = prospectiveRoutes.find(p => p.destination.iata === route.destinationIata);
                                const assignedCount = route.assignedAircraftIds.length;

                                return (
                                    <div key={route.id} className="group relative rounded-2xl bg-card border border-border overflow-hidden p-5 transition-all hover:border-primary/50 hover:shadow-md">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-6">
                                                <div className="flex flex-col">
                                                    <span className="text-2xl font-black text-primary leading-none tracking-tighter">{route.originIata} → {route.destinationIata}</span>
                                                    <span className="text-xs text-muted-foreground font-semibold mt-1">
                                                        {market?.destination.city}, {market?.destination.country} • {route.distanceKm.toLocaleString()}km
                                                    </span>
                                                </div>

                                                <div className="h-10 w-px bg-border/50" />

                                                <div className="flex flex-col">
                                                    <span className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Pricing</span>
                                                    {editingRouteId === route.id ? (
                                                        <div className="flex gap-2 mt-1">
                                                            <input
                                                                type="text"
                                                                value={tempFares.e}
                                                                onChange={(e) => setTempFares({ ...tempFares, e: e.target.value })}
                                                                className="w-16 text-[10px] font-mono bg-black/40 border border-white/10 rounded px-1 py-0.5 focus:outline-none focus:border-primary/50"
                                                                placeholder="E"
                                                            />
                                                            <input
                                                                type="text"
                                                                value={tempFares.b}
                                                                onChange={(e) => setTempFares({ ...tempFares, b: e.target.value })}
                                                                className="w-16 text-[10px] font-mono bg-black/40 border border-white/10 rounded px-1 py-0.5 focus:outline-none focus:border-blue-400/50 text-blue-400"
                                                                placeholder="B"
                                                            />
                                                            <input
                                                                type="text"
                                                                value={tempFares.f}
                                                                onChange={(e) => setTempFares({ ...tempFares, f: e.target.value })}
                                                                className="w-16 text-[10px] font-mono bg-black/40 border border-white/10 rounded px-1 py-0.5 focus:outline-none focus:border-yellow-500/50 text-yellow-500"
                                                                placeholder="F"
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="flex gap-3 mt-1">
                                                            <span className="text-xs font-mono bg-zinc-500/10 px-2 py-0.5 rounded border border-zinc-500/20">E: {fpFormat(route.fareEconomy, 0)}</span>
                                                            <span className="text-xs font-mono bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 text-blue-400">B: {fpFormat(route.fareBusiness, 0)}</span>
                                                            <span className="text-xs font-mono bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20 text-yellow-500">F: {fpFormat(route.fareFirst, 0)}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-4">
                                                <div className="flex flex-col text-right">
                                                    <span className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Fleet</span>
                                                    <span className={`text-sm font-bold mt-1 ${assignedCount > 0 ? 'text-foreground' : 'text-red-400 flex items-center gap-1 justify-end'}`}>
                                                        {assignedCount === 0 && <AlertCircle className="h-3 w-3" />}
                                                        {assignedCount} Aircraft Assigned
                                                    </span>
                                                </div>

                                                {editingRouteId === route.id ? (
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={async () => {
                                                                const eVal = parseInt(tempFares.e.replace(/[^0-9]/g, ''));
                                                                const bVal = parseInt(tempFares.b.replace(/[^0-9]/g, ''));
                                                                const fVal = parseInt(tempFares.f.replace(/[^0-9]/g, ''));

                                                                await updateRouteFares(route.id, {
                                                                    economy: isNaN(eVal) ? undefined : eVal * 10000,
                                                                    business: isNaN(bVal) ? undefined : bVal * 10000,
                                                                    first: isNaN(fVal) ? undefined : fVal * 10000,
                                                                });
                                                                setEditingRouteId(null);
                                                            }}
                                                            className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-xs font-bold hover:bg-emerald-500/30 transition-all"
                                                        >
                                                            Save
                                                        </button>
                                                        <button
                                                            onClick={() => setEditingRouteId(null)}
                                                            className="px-3 py-1.5 bg-white/5 text-white/40 border border-white/5 rounded-lg text-xs font-bold hover:bg-white/10 transition-all"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => {
                                                            setEditingRouteId(route.id);
                                                            setTempFares({
                                                                e: (Number(route.fareEconomy) / 10000).toString(),
                                                                b: (Number(route.fareBusiness) / 10000).toString(),
                                                                f: (Number(route.fareFirst) / 10000).toString(),
                                                            });
                                                        }}
                                                        className="px-4 py-2 bg-white/5 text-white/60 border border-white/5 rounded-xl text-sm font-bold hover:bg-white/10 transition-all"
                                                    >
                                                        Edit Fares
                                                    </button>
                                                )}

                                                <button
                                                    className="px-4 py-2 bg-accent/20 text-accent-foreground border border-accent/20 rounded-xl text-sm font-bold hover:bg-accent/30 transition-all"
                                                >
                                                    Manage Assignments
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {prospectiveRoutes.map((market) => {
                            const isAlreadyOpen = activeRoutes.some(r => r.destinationIata === market.destination.iata);
                            const totalDemand = market.demand.economy + market.demand.business + market.demand.first;

                            return (
                                <div key={market.destination.iata} className="group relative rounded-2xl bg-card border border-border overflow-hidden p-5 transition-all hover:border-primary/50">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-8">
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-2xl font-black text-foreground tracking-tighter">{market.destination.iata}</span>
                                                    <TrendingUp className="h-4 w-4 text-accent" />
                                                </div>
                                                <span className="text-sm font-bold text-muted-foreground">{market.destination.city}, {market.destination.country}</span>
                                            </div>

                                            <div className="flex flex-col">
                                                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Weekly Demand</span>
                                                <span className="text-lg font-mono font-bold">{totalDemand.toLocaleString()}</span>
                                            </div>

                                            <div className="flex flex-col">
                                                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Distance</span>
                                                <span className="text-lg font-mono font-bold text-accent">{Math.round(market.distance).toLocaleString()} km</span>
                                            </div>

                                            <div className="flex flex-col">
                                                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Est. Daily Rev</span>
                                                <span className="text-lg font-mono font-bold text-green-400">{fpFormat(market.estimatedDailyRevenue, 0)}</span>
                                            </div>
                                        </div>

                                        {isAlreadyOpen ? (
                                            <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary border border-primary/20 rounded-xl text-sm font-bold">
                                                <CheckCircle2 className="h-4 w-4" />
                                                Route Open
                                            </div>
                                        ) : (
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        await openRoute(market.origin.iata, market.destination.iata, market.distance);
                                                    } catch (e: any) {
                                                        alert(e.message);
                                                    }
                                                }}
                                                className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:scale-105 transition-all shadow-lg shadow-primary/25 active:scale-95"
                                            >
                                                <PlusCircle className="h-4 w-4" />
                                                Open Route ($100,000)
                                            </button>
                                        )}
                                    </div>

                                    {/* Small Demand Breakdown bar */}
                                    <div className="mt-4 flex h-1 w-full rounded-full bg-muted overflow-hidden">
                                        <div className="h-full bg-zinc-500" style={{ width: `${(market.demand.economy / totalDemand) * 100}%` }} title="Economy" />
                                        <div className="h-full bg-blue-500" style={{ width: `${(market.demand.business / totalDemand) * 100}%` }} title="Business" />
                                        <div className="h-full bg-yellow-500" style={{ width: `${(market.demand.first / totalDemand) * 100}%` }} title="First" />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
