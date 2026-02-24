import { useState } from 'react';
import { useAirlineStore, useEngineStore } from '@airtr/store';
import { getAircraftById } from '@airtr/data';
import { calculateBookValue, fpFormat } from '@airtr/core';
import { AircraftDealer } from './AircraftDealer';
import { Plane, Wrench, Settings, Search, PlusCircle, LayoutGrid, List, Trash2, Timer } from 'lucide-react';

export function FleetManager() {
    const { fleet, routes, sellAircraft, buyoutAircraft, assignAircraftToRoute } = useAirlineStore(state => state);
    const tick = useEngineStore(state => state.tick);
    const [view, setView] = useState<'owned' | 'dealer'>('owned');
    const [layout, setLayout] = useState<'grid' | 'list'>('grid');
    const [search, setSearch] = useState('');

    if (view === 'dealer') {
        return (
            <div className="flex flex-col h-full w-full">
                <div className="mb-4">
                    <button
                        onClick={() => setView('owned')}
                        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors"
                    >
                        &larr; Back to My Fleet
                    </button>
                </div>
                <div className="flex-1 overflow-hidden min-h-0">
                    <AircraftDealer onPurchaseSuccess={() => setView('owned')} />
                </div>
            </div>
        );
    }

    const filteredFleet = fleet.filter(f =>
        f.name.toLowerCase().includes(search.toLowerCase()) ||
        f.modelId.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="flex flex-col h-full space-y-6">
            {/* Toolbar */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between rounded-2xl bg-card border border-border/40 p-4 shadow-sm backdrop-blur-xl shrink-0">
                <div className="flex items-center gap-4 w-full sm:w-auto">
                    <div className="relative flex items-center flex-1 sm:w-[300px]">
                        <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
                        <input
                            className="h-10 w-full rounded-xl bg-background border border-border/50 pl-10 pr-4 text-sm transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground outline-none"
                            placeholder="Search active fleet..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <div className="flex bg-muted/30 rounded-xl p-1 border border-border/30">
                        <button
                            onClick={() => setLayout('grid')}
                            className={`p-1.5 rounded-lg transition-all ${layout === 'grid' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            <LayoutGrid className="h-4 w-4" />
                        </button>
                        <button
                            onClick={() => setLayout('list')}
                            className={`p-1.5 rounded-lg transition-all ${layout === 'list' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            <List className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                <button
                    onClick={() => setView('dealer')}
                    className="flex items-center justify-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold shadow-lg shadow-primary/25 hover:scale-[1.02] transition-all active:scale-95"
                >
                    <PlusCircle className="h-4 w-4" />
                    Purchase Aircraft
                </button>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-10">
                {fleet.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-border/50 rounded-2xl bg-card/10">
                        <Plane className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
                        <p className="text-xl font-semibold text-foreground mb-2">Your hangar is empty</p>
                        <p className="text-sm text-muted-foreground mb-6 max-w-sm text-center">
                            You haven't purchased any aircraft yet. Hit the global marketplace to acquire your first plane and start flying routes.
                        </p>
                        <button
                            onClick={() => setView('dealer')}
                            className="rounded-xl bg-primary text-primary-foreground px-6 py-2.5 text-sm font-bold shadow-lg shadow-primary/20 hover:scale-105 transition-transform"
                        >
                            Open Global Marketplace
                        </button>
                    </div>
                ) : filteredFleet.length === 0 ? (
                    <div className="py-20 text-center flex flex-col items-center">
                        <p className="text-muted-foreground">No aircraft found matching "{search}".</p>
                    </div>
                ) : layout === 'grid' ? (
                    <div className="grid grid-cols-2 gap-6">
                        {filteredFleet.map((ac) => {
                            const model = getAircraftById(ac.modelId);
                            if (!model) return null;

                            return (
                                <div key={ac.id} className="group relative flex flex-col rounded-3xl border border-border/50 bg-card overflow-hidden shadow-sm hover:shadow-xl hover:border-primary/30 transition-all duration-300">
                                    <div className="relative h-40 bg-zinc-900/40 p-6 perspective-1000 overflow-hidden">
                                        <div className="absolute top-4 right-4 z-10">
                                            <span className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${ac.status === 'idle' ? (ac.assignedRouteId ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-primary/20 text-primary border border-primary/30') :
                                                'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                                                }`}>
                                                {ac.status === 'idle' && ac.assignedRouteId ? 'assigned' : ac.status}
                                            </span>
                                        </div>

                                        <div className="absolute -bottom-6 -right-6 text-zinc-800/20 select-none">
                                            <Plane className="h-48 w-48 rotate-12" />
                                        </div>

                                        <div className="relative z-10 flex flex-col h-full justify-end">
                                            <h3 className="text-xl font-black tracking-tighter text-foreground group-hover:text-primary transition-colors">
                                                {ac.name}
                                            </h3>
                                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                                {model.manufacturer} <span className="text-accent">{model.name}</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div className="p-6 pt-4 flex flex-col space-y-4">
                                        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                                            <div>
                                                <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">Registry ID</p>
                                                <p className="font-mono text-xs text-foreground font-bold">{ac.id.toUpperCase()}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">Base Hub</p>
                                                <p className="font-mono text-xs text-accent font-bold">{ac.baseAirportIata}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">Condition</p>
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 h-1.5 rounded-full bg-accent/20 overflow-hidden">
                                                        <div
                                                            className={`h-full transition-all duration-500 ${ac.condition > 0.8 ? 'bg-primary' : ac.condition > 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                                            style={{ width: `${Math.round(ac.condition * 100)}%` }}
                                                        />
                                                    </div>
                                                    <span className="font-mono text-[10px] font-bold">{(ac.condition * 100).toFixed(0)}%</span>
                                                </div>
                                            </div>
                                            <div>
                                                <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">Flight Hours</p>
                                                <p className="font-mono text-xs">{ac.flightHoursTotal.toLocaleString()}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">Type</p>
                                                <p className="font-mono text-xs capitalize">{ac.purchaseType || 'buy'}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">{ac.purchaseType === 'lease' ? 'Buyout Price' : 'Market Value'}</p>
                                                <p className="font-mono text-xs">
                                                    {fpFormat(calculateBookValue(model, ac.flightHoursTotal, ac.condition, ac.purchasedAtTick, tick), 0)}
                                                </p>
                                            </div>
                                            {ac.purchaseType === 'lease' && (
                                                <div className="col-span-2 mt-2 pt-2 border-t border-border/20">
                                                    <div className="flex justify-between items-center bg-orange-500/5 p-2 rounded-lg border border-orange-500/10">
                                                        <div className="flex flex-col">
                                                            <span className="text-[9px] uppercase font-bold text-orange-400">Monthly Cycle</span>
                                                            <span className="text-xs font-mono font-bold text-orange-200">Next payment in {30 - (tick % 30)} Ticks</span>
                                                        </div>
                                                        <button
                                                            onClick={() => {
                                                                const cost = calculateBookValue(model, ac.flightHoursTotal, ac.condition, ac.purchasedAtTick, tick);
                                                                if (confirm(`Convert ${ac.name} to full ownership for ${fpFormat(cost)}?`)) {
                                                                    buyoutAircraft(ac.id);
                                                                }
                                                            }}
                                                            className="px-3 py-1.5 bg-orange-500 text-white text-[10px] font-bold rounded-md hover:bg-orange-600 transition-colors shadow-lg shadow-orange-500/20"
                                                        >
                                                            Buyout Now
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="h-px w-full bg-border/50 mb-4" />

                                        <div className="flex flex-col gap-3">
                                            {ac.status !== 'delivery' && (
                                                <div className="flex flex-col gap-1.5">
                                                    <p className="text-[10px] uppercase text-muted-foreground font-bold tracking-widest pl-1">Route Assignment</p>
                                                    <div className="flex gap-2">
                                                        <select
                                                            className="flex-1 bg-background border border-border/50 rounded-xl px-3 py-2 text-xs font-bold outline-none ring-primary/20 focus:ring-2 focus:border-primary/50 transition-all appearance-none cursor-pointer"
                                                            value={ac.assignedRouteId || ''}
                                                            onChange={async (e) => {
                                                                try {
                                                                    await assignAircraftToRoute(ac.id, e.target.value || null);
                                                                } catch (err: any) {
                                                                    alert(err.message);
                                                                }
                                                            }}
                                                        >
                                                            <option value="">Unassigned (Idle)</option>
                                                            {routes.map(r => {
                                                                const isOutOfRange = r.distanceKm > model.rangeKm;
                                                                return (
                                                                    <option
                                                                        key={r.id}
                                                                        value={r.id}
                                                                        className={isOutOfRange ? 'text-muted-foreground' : ''}
                                                                    >
                                                                        {r.originIata} &rarr; {r.destinationIata} ({r.distanceKm}km)
                                                                        {isOutOfRange ? ' — [OUT OF RANGE]' : ''}
                                                                    </option>
                                                                );
                                                            })}
                                                        </select>
                                                        {ac.assignedRouteId && (
                                                            <button
                                                                onClick={() => assignAircraftToRoute(ac.id, null)}
                                                                className="px-3 py-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all"
                                                                title="Unassign Route"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                    {routes.length === 0 && (
                                                        <p className="text-[10px] text-orange-400 font-bold italic px-1">
                                                            No active routes available. Open one in Route Manager.
                                                        </p>
                                                    )}
                                                </div>
                                            )}

                                            <div className="flex gap-2 mt-1 w-full">
                                                {ac.status === 'delivery' && (
                                                    <div className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-yellow-500/10 px-3 py-2 text-xs font-semibold text-yellow-500 border border-yellow-500/20">
                                                        <Timer className="h-4 w-4 animate-spin-slow" />
                                                        Arriving in {Math.max(0, (ac.deliveryAtTick || 0) - tick)} ticks
                                                    </div>
                                                )}
                                                {ac.status === 'enroute' && ac.flight && (
                                                    <div className="flex-1 flex flex-col gap-1 rounded-lg bg-primary/10 px-3 py-2 border border-primary/20">
                                                        <div className="flex justify-between items-center text-[10px] font-black uppercase text-primary">
                                                            <span>Enroute &rarr; {ac.flight.destinationIata}</span>
                                                            <span>{Math.round(((tick - ac.flight.departureTick) / (ac.flight.arrivalTick - ac.flight.departureTick)) * 100)}%</span>
                                                        </div>
                                                        <div className="w-full h-1 bg-primary/20 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-primary"
                                                                style={{ width: `${Math.max(0, Math.min(100, ((tick - ac.flight.departureTick) / (ac.flight.arrivalTick - ac.flight.departureTick)) * 100))}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                                {ac.status === 'turnaround' && (
                                                    <div className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-yellow-500/10 px-3 py-2 text-xs font-semibold text-yellow-500 border border-yellow-500/20">
                                                        <Timer className="h-4 w-4" />
                                                        Turnaround: {Math.max(0, (ac.turnaroundEndTick || 0) - tick)} ticks left
                                                    </div>
                                                )}
                                                <button className="flex items-center justify-center p-2 rounded-lg bg-background border border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors tooltip-trigger" title="Settings" disabled={ac.status === 'delivery'}>
                                                    <Settings className="h-4 w-4" />
                                                </button>
                                                <button className="flex items-center justify-center p-2 rounded-lg bg-background border border-border/50 text-muted-foreground hover:text-orange-400 hover:bg-orange-400/10 transition-colors tooltip-trigger" title="Maintenance" disabled={ac.status === 'delivery'}>
                                                    <Wrench className="h-4 w-4" />
                                                </button>
                                                <button onClick={() => {
                                                    const isLease = ac.purchaseType === 'lease';
                                                    const val = isLease ? 0 : calculateBookValue(model, ac.flightHoursTotal, ac.condition, ac.purchasedAtTick, tick);
                                                    const msg = isLease
                                                        ? `Return leased aircraft ${ac.name}? You will lose your security deposit but stop future lease payments.`
                                                        : `Sell ${ac.name} for ${fpFormat(val as any)}?\n\nCurrent book value includes depreciation and usage penalties.`;

                                                    if (confirm(msg)) {
                                                        sellAircraft(ac.id);
                                                    }
                                                }} className="flex-1 flex items-center justify-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-all group/sell block shrink-0" title={ac.purchaseType === 'lease' ? "Return Lease" : "Sell Aircraft"}>
                                                    <Trash2 className="h-4 w-4" />
                                                    <span className="text-[10px] font-bold uppercase">{ac.purchaseType === 'lease' ? 'Return Lease' : `Sell for ${fpFormat(calculateBookValue(model, ac.flightHoursTotal, ac.condition, ac.purchasedAtTick, tick))}`}</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex flex-col border border-border/50 rounded-2xl overflow-hidden bg-card">
                        <div className="grid grid-cols-12 gap-4 border-b border-border/50 bg-background/50 p-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            <div className="col-span-2">Aircraft</div>
                            <div className="col-span-1">Registry</div>
                            <div className="col-span-1">Base</div>
                            <div className="col-span-3">Assigned Route</div>
                            <div className="col-span-1">Status</div>
                            <div className="col-span-2">Condition</div>
                            <div className="col-span-1 text-center">Type</div>
                            <div className="col-span-1 text-right">Actions</div>
                        </div>
                        <div className="divide-y divide-border/20">
                            {filteredFleet.map((ac) => {
                                const model = getAircraftById(ac.modelId);
                                if (!model) return null;

                                return (
                                    <div key={ac.id} className="grid grid-cols-12 gap-4 p-4 items-center text-sm hover:bg-accent/10 transition-colors">
                                        <div className="col-span-2 flex flex-col">
                                            <span className="font-bold truncate">{ac.name}</span>
                                            <span className="text-[10px] text-muted-foreground uppercase font-bold truncate">{model.name}</span>
                                        </div>
                                        <div className="col-span-1 font-mono text-[10px] text-muted-foreground truncate uppercase">
                                            {ac.id}
                                        </div>
                                        <div className="col-span-1 font-mono text-xs font-bold text-accent">
                                            {ac.baseAirportIata}
                                        </div>
                                        <div className="col-span-3 pr-4">
                                            {ac.status !== 'delivery' ? (
                                                <select
                                                    className="w-full bg-background border border-border/50 rounded-lg px-2 py-1 text-[11px] font-bold outline-none focus:border-primary/50 transition-all appearance-none cursor-pointer"
                                                    value={ac.assignedRouteId || ''}
                                                    onChange={async (e) => {
                                                        try {
                                                            await assignAircraftToRoute(ac.id, e.target.value || null);
                                                        } catch (err: any) {
                                                            alert(err.message);
                                                        }
                                                    }}
                                                >
                                                    <option value="">(Idle)</option>
                                                    {routes.map(r => {
                                                        const isOutOfRange = r.distanceKm > model.rangeKm;
                                                        return (
                                                            <option
                                                                key={r.id}
                                                                value={r.id}
                                                                className={isOutOfRange ? 'text-muted-foreground' : ''}
                                                            >
                                                                {r.originIata} &rarr; {r.destinationIata} ({r.distanceKm}km)
                                                                {isOutOfRange ? ' [RANGE!]' : ''}
                                                            </option>
                                                        );
                                                    })}
                                                </select>
                                            ) : (
                                                <span className="text-[10px] text-muted-foreground italic">In Delivery...</span>
                                            )}
                                        </div>
                                        <div className="col-span-1">
                                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-tighter ${ac.status === 'idle' ? (ac.assignedRouteId ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-500/10 text-zinc-400') :
                                                'bg-orange-500/20 text-orange-400'
                                                }`}>
                                                {ac.status === 'idle' && ac.assignedRouteId ? 'assigned' : ac.status}
                                            </span>
                                        </div>
                                        <div className="col-span-2 flex items-center gap-2">
                                            <div className="w-12 h-1 rounded-full bg-accent/30 overflow-hidden">
                                                <div
                                                    className={`h-full ${ac.condition > 0.8 ? 'bg-primary' : ac.condition > 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                                    style={{ width: `${Math.round(ac.condition * 100)}%` }}
                                                />
                                            </div>
                                            <span className="text-[10px] font-mono">{(ac.condition * 100).toFixed(0)}%</span>
                                        </div>
                                        <div className="col-span-1 flex flex-col items-center justify-center">
                                            <span className={`text-[10px] font-bold uppercase ${ac.purchaseType === 'lease' ? 'text-orange-400' : 'text-zinc-500'}`}>
                                                {ac.purchaseType === 'lease' ? 'Lease' : 'Owned'}
                                            </span>
                                            {ac.purchaseType === 'lease' && (
                                                <span className="text-[9px] text-muted-foreground font-mono">
                                                    {fpFormat(model.monthlyLease, 0)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="col-span-1 flex justify-end gap-1">
                                            <button onClick={() => {
                                                const isLease = ac.purchaseType === 'lease';
                                                const msg = isLease ? "Return Lease?" : "Sell Aircraft?";
                                                if (confirm(msg)) sellAircraft(ac.id);
                                            }} className="p-1.5 rounded-md text-red-400 hover:bg-red-500 hover:text-white transition-all">
                                                <Trash2 className="h-3 w-3" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
