import { useState } from 'react';
import { useAirlineStore, useEngineStore } from '@airtr/store';
import { getAircraftById } from '@airtr/data';
import { calculateBookValue, fpFormat, fpScale, fp, fpToNumber } from '@airtr/core';
import { AircraftDealer } from './AircraftDealer';
import { Plane, Settings, Search, PlusCircle, Trash2, Timer, Tag, XCircle } from 'lucide-react';

export function FleetManager() {
    const { fleet, routes, sellAircraft, buyoutAircraft, assignAircraftToRoute, listAircraft, cancelListing } = useAirlineStore(state => state);
    const tick = useEngineStore(state => state.tick);
    const [view, setView] = useState<'owned' | 'dealer'>('owned');
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
                ) : (
                    <div className="grid grid-cols-2 gap-6">
                        {filteredFleet.map((ac) => {
                            const model = getAircraftById(ac.modelId);
                            if (!model) return null;

                            const marketVal = calculateBookValue(model, ac.flightHoursTotal, ac.condition, ac.birthTick || ac.purchasedAtTick, tick);
                            const scrapVal = fpScale(marketVal, 0.7);

                            return (
                                <div key={ac.id} className="group relative flex flex-col rounded-3xl border border-border/50 bg-card overflow-hidden shadow-sm hover:shadow-xl hover:border-primary/30 transition-all duration-300">
                                    <div className="relative h-40 bg-zinc-900/40 p-6 perspective-1000 overflow-hidden">
                                        <div className="absolute top-4 right-4 z-10 flex gap-2">
                                            {ac.listingPrice && (
                                                <span className="inline-flex items-center rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-3 py-1 text-[10px] font-black uppercase tracking-widest">
                                                    For Sale: {fpFormat(ac.listingPrice, 0)}
                                                </span>
                                            )}
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
                                            {ac.purchasePrice && (
                                                <div>
                                                    <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">Purchased For</p>
                                                    <p className="font-mono text-xs">{fpFormat(ac.purchasePrice, 0)}</p>
                                                </div>
                                            )}
                                            <div>
                                                <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">{ac.purchaseType === 'lease' ? 'Buyout Price' : 'Appraisal'}</p>
                                                <p className="font-mono text-xs">{fpFormat(marketVal, 0)}</p>
                                            </div>
                                        </div>

                                        <div className="h-px w-full bg-border/50 mb-2" />

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
                                                                        {r.originIata} &rarr; {r.destinationIata} ({r.distanceKm}km) {isOutOfRange ? ' — [OUT OF RANGE]' : ''}
                                                                    </option>
                                                                );
                                                            })}
                                                        </select>
                                                        {ac.assignedRouteId && (
                                                            <button
                                                                onClick={() => assignAircraftToRoute(ac.id, null)}
                                                                className="px-3 py-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 transition-all"
                                                                title="Unassign Route"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="flex gap-2 mt-1 w-full">
                                                {ac.status === 'delivery' && (
                                                    <div className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-yellow-500/10 px-3 py-2 text-xs font-semibold text-yellow-500 border border-yellow-500/20">
                                                        <Timer className="h-4 w-4 animate-spin-slow" />
                                                        Arriving soon...
                                                    </div>
                                                )}

                                                <button
                                                    onClick={() => {
                                                        const isLease = ac.purchaseType === 'lease';
                                                        const msg = isLease
                                                            ? `Return leased aircraft ${ac.name}?`
                                                            : `Instant Scrap ${ac.name} for ${fpFormat(scrapVal)}?\n\n30% liquidity penalty applies.`;
                                                        if (confirm(msg)) sellAircraft(ac.id);
                                                    }}
                                                    className="flex items-center justify-center p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-all"
                                                    title="Instant Scrap"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>

                                                {(!ac.purchaseType || ac.purchaseType === 'buy') ? (
                                                    ac.listingPrice ? (
                                                        <button
                                                            onClick={() => cancelListing(ac.id)}
                                                            className="flex-1 flex items-center justify-center gap-2 p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all overflow-hidden"
                                                        >
                                                            <XCircle className="h-4 w-4 shrink-0" />
                                                            <span className="text-[10px] font-bold uppercase truncate">Cancel Listing</span>
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => {
                                                                const marketVal = calculateBookValue(model, ac.flightHoursTotal, ac.condition, ac.birthTick || ac.purchasedAtTick, tick);
                                                                const msrp = calculateBookValue(model, 0, 1, tick, tick); // Get MSRP (0 hours, 100% condition, 0 age)
                                                                const maxPrice = fpToNumber(msrp) * 1.2;

                                                                const priceStr = prompt(
                                                                    `List ${ac.name} on the Global Marketplace.\n\n` +
                                                                    `• Appraisal: ${fpFormat(marketVal)}\n` +
                                                                    `• Max Allowed (120% MSRP): ${fpFormat(fp(maxPrice))}\n\n` +
                                                                    `NOTE: A 0.5% non-refundable Listing Fee will be deducted from your account.`,
                                                                    fpToNumber(marketVal).toString()
                                                                );

                                                                if (priceStr) {
                                                                    const price = parseFloat(priceStr);
                                                                    if (isNaN(price) || price <= 0) {
                                                                        alert("Please enter a valid positive price.");
                                                                        return;
                                                                    }
                                                                    if (price > maxPrice) {
                                                                        alert(`Price exceeds the ceiling of ${fpFormat(fp(maxPrice))}`);
                                                                        return;
                                                                    }

                                                                    const fee = price * 0.005;
                                                                    if (confirm(`Listing this aircraft for ${fpFormat(fp(price))} will cost ${fpFormat(fp(fee))} in non-refundable listing fees. Continue?`)) {
                                                                        listAircraft(ac.id, fp(price));
                                                                    }
                                                                }
                                                            }}
                                                            className="flex-1 flex items-center justify-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all shadow-sm"
                                                        >
                                                            <Tag className="h-4 w-4 shrink-0" />
                                                            <span className="text-[10px] font-bold uppercase">List for Sale</span>
                                                        </button>
                                                    )
                                                ) : ac.purchaseType === 'lease' && (
                                                    <button
                                                        onClick={() => {
                                                            if (confirm(`Buyout this lease for ${fpFormat(marketVal)}?`)) {
                                                                buyoutAircraft(ac.id);
                                                            }
                                                        }}
                                                        className="flex-1 flex items-center justify-center gap-2 p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 hover:bg-orange-500 hover:text-white transition-all"
                                                    >
                                                        <PlusCircle className="h-4 w-4" />
                                                        <span className="text-[10px] font-bold uppercase">Buyout Lease</span>
                                                    </button>
                                                )}

                                                <button className="p-2 rounded-lg bg-background border border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-all">
                                                    <Settings className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
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
