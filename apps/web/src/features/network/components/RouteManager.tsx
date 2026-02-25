import { useState } from 'react';
import { useAirlineStore, useEngineStore } from '@airtr/store';
import { fpFormat, fpToNumber, getSuggestedFares, calculateShares, haversineDistance, calculateDemand, getSeason, getProsperityIndex, fpScale, fp } from '@airtr/core';
import { airports as ALL_AIRPORTS } from '@airtr/data';
import { Globe, PlusCircle, CheckCircle2, AlertCircle, TrendingUp, MapPin, Search } from 'lucide-react';

export function RouteManager() {
    const {
        airline,
        pubkey,
        routes: activeRoutes,
        openRoute,
    updateRouteFares,
        globalRouteRegistry,
        competitors
    } = useAirlineStore();
    const { routes: prospectiveRoutes, homeAirport, tick } = useEngineStore();
    const [tab, setTab] = useState<'active' | 'opportunities'>('active');
    const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
    const [tempFares, setTempFares] = useState<{ e: string; b: string; f: string }>({ e: '', b: '', f: '' });
    const [searchQuery, setSearchQuery] = useState('');

    const searchResults = searchQuery.length >= 2
        ? ALL_AIRPORTS.filter(a =>
            a.iata !== homeAirport?.iata && (
                a.iata?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                a.icao?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                a.city?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                a.name?.toLowerCase().includes(searchQuery.toLowerCase())
            )
        ).slice(0, 5)
        : [];

    const calculateSearchProspect = (dest: any) => {
        if (!homeAirport) return null;
        const now = new Date();
        const prosperity = getProsperityIndex(tick);
        const season = getSeason(dest.latitude, now);
        const distance = haversineDistance(homeAirport.latitude, homeAirport.longitude, dest.latitude, dest.longitude);
        const demand = calculateDemand(homeAirport, dest, season, prosperity, 1.0);
        const avgFarePerKm = 0.12;
        const baseFare = Math.max(80, Math.round(distance * avgFarePerKm));
        const totalPax = demand.economy + demand.business + demand.first;
        const estimatedDailyRevenue = fpScale(fp(baseFare), totalPax / 7);
        return { origin: homeAirport, destination: dest, distance, demand, estimatedDailyRevenue, season };
    };

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

                <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm overflow-hidden relative">
                    <div className="flex justify-between items-start mb-2">
                        <p className="text-xs uppercase text-muted-foreground font-bold tracking-wider">Prosperity Index</p>
                        <TrendingUp className={`h-4 w-4 ${getProsperityIndex(tick) > 1 ? 'text-emerald-400' : 'text-rose-400'}`} />
                    </div>
                    <p className={`text-2xl font-bold ${getProsperityIndex(tick) > 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {(getProsperityIndex(tick) * 100).toFixed(1)}%
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                        {getProsperityIndex(tick) > 1 ? 'Market Boom - High Demand' : 'Market Recession - Low Demand'}
                    </p>
                    {/* Tiny sparkline-like background */}
                    <div className="absolute bottom-0 left-0 w-full h-1 bg-muted/20">
                        <div
                            className={`h-full opacity-50 ${getProsperityIndex(tick) > 1 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                            style={{ width: `${Math.min(100, (getProsperityIndex(tick) - 0.85) / 0.3 * 100)}%` }}
                        />
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <div className="mb-6 flex items-center gap-4 bg-muted/30 p-4 rounded-2xl border border-border/50">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search by IATA, ICAO, City, or Name..."
                            className="w-full bg-background border border-border/50 rounded-xl py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all font-bold"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="text-xs font-bold text-muted-foreground hover:text-foreground"
                        >
                            Clear
                        </button>
                    )}
                </div>

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
                                                        <div className="flex flex-col gap-2 mt-1">
                                                            <div className="flex gap-2">
                                                                <div className="flex flex-col">
                                                                    <input
                                                                        type="text"
                                                                        value={tempFares.e}
                                                                        onChange={(e) => setTempFares({ ...tempFares, e: e.target.value })}
                                                                        className="w-16 text-[10px] font-mono bg-black/40 border border-white/10 rounded px-1 py-0.5 focus:outline-none focus:border-primary/50"
                                                                        placeholder="E"
                                                                    />
                                                                    <span className="text-[8px] text-white/20 mt-0.5 font-mono">Sug: {fpToNumber(getSuggestedFares(route.distanceKm).economy)}</span>
                                                                </div>
                                                                <div className="flex flex-col">
                                                                    <input
                                                                        type="text"
                                                                        value={tempFares.b}
                                                                        onChange={(e) => setTempFares({ ...tempFares, b: e.target.value })}
                                                                        className="w-16 text-[10px] font-mono bg-black/40 border border-white/10 rounded px-1 py-0.5 focus:outline-none focus:border-blue-400/50 text-blue-400"
                                                                        placeholder="B"
                                                                    />
                                                                    <span className="text-[8px] text-blue-400/30 mt-0.5 font-mono">Sug: {fpToNumber(getSuggestedFares(route.distanceKm).business)}</span>
                                                                </div>
                                                                <div className="flex flex-col">
                                                                    <input
                                                                        type="text"
                                                                        value={tempFares.f}
                                                                        onChange={(e) => setTempFares({ ...tempFares, f: e.target.value })}
                                                                        className="w-16 text-[10px] font-mono bg-black/40 border border-white/10 rounded px-1 py-0.5 focus:outline-none focus:border-yellow-500/50 text-yellow-500"
                                                                        placeholder="F"
                                                                    />
                                                                    <span className="text-[8px] text-yellow-500/30 mt-0.5 font-mono">Sug: {fpToNumber(getSuggestedFares(route.distanceKm).first)}</span>
                                                                </div>

                                                                <button
                                                                    onClick={() => {
                                                                        const sug = getSuggestedFares(route.distanceKm);
                                                                        setTempFares({
                                                                            e: fpToNumber(sug.economy).toString(),
                                                                            b: fpToNumber(sug.business).toString(),
                                                                            f: fpToNumber(sug.first).toString(),
                                                                        });
                                                                    }}
                                                                    className="ml-2 px-2 py-0.5 rounded border border-white/5 bg-white/5 text-[8px] uppercase font-bold text-white/40 hover:bg-white/10 transition-colors"
                                                                >
                                                                    Fix to Suggested
                                                                </button>
                                                            </div>
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
                                                                const eVal = parseInt(tempFares.e.replace(/[^0-9]/g, ''), 10);
                                                                const bVal = parseInt(tempFares.b.replace(/[^0-9]/g, ''), 10);
                                                                const fVal = parseInt(tempFares.f.replace(/[^0-9]/g, ''), 10);

                                                                await updateRouteFares(route.id, {
                                                                    economy: isNaN(eVal) ? undefined : fp(eVal),
                                                                    business: isNaN(bVal) ? undefined : fp(bVal),
                                                                    first: isNaN(fVal) ? undefined : fp(fVal),
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
                                                                e: fpToNumber(route.fareEconomy).toString(),
                                                                b: fpToNumber(route.fareBusiness).toString(),
                                                                f: fpToNumber(route.fareFirst).toString(),
                                                            });
                                                        }}
                                                        className="px-4 py-2 bg-white/5 text-white/60 border border-white/5 rounded-xl text-sm font-bold hover:bg-white/10 transition-all"
                                                    >
                                                        Edit Fares
                                                    </button>
                                                )}

                                                <button
                                                    className="px-4 py-2 bg-accent/20 text-accent-foreground border border-accent/20 rounded-xl text-sm font-bold hover:bg-accent/30 transition-all font-mono"
                                                >
                                                    {assignedCount} Planes
                                                </button>
                                            </div>
                                        </div>

                                        {/* Supply/Demand Saturation Bar */}
                                        {market && (
                                            <div className="mt-4 bg-muted/20 rounded-xl p-3 border border-border/30">
                                                <div className="flex justify-between items-center mb-1.5">
                                                    <span className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                                                        <TrendingUp className="h-3 w-3" /> Supply / Demand Saturation
                                                    </span>
                                                    <span className="text-[10px] font-bold text-foreground">
                                                        {Math.round(((assignedCount * 1200) / (market.demand.economy + market.demand.business + market.demand.first)) * 100)}% Saturation
                                                    </span>
                                                </div>
                                                <div className="h-1.5 w-full bg-background rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full transition-all duration-500 ${((assignedCount * 1200) / (market.demand.economy + market.demand.business + market.demand.first)) > 0.9 ? 'bg-rose-500' : 'bg-primary'}`}
                                                        style={{ width: `${Math.min(100, ((assignedCount * 1200) / (market.demand.economy + market.demand.business + market.demand.first)) * 100)}%` }}
                                                    />
                                                </div>
                                                <div className="flex justify-between mt-1">
                                                    <p className="text-[9px] text-muted-foreground">
                                                        Weekly Demand: <span className="text-foreground font-mono">{(market.demand.economy + market.demand.business + market.demand.first).toLocaleString()}</span>
                                                    </p>
                                                    <p className={`text-[9px] font-bold uppercase ${((assignedCount * 1200) / (market.demand.economy + market.demand.business + market.demand.first)) > 1 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                                        {((assignedCount * 1200) / (market.demand.economy + market.demand.business + market.demand.first)) > 1 ? 'Over-Supplied' : 'Healthy Load Factor'}
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        {/* Market Analysis Tab */}
                                        <div className="mt-5 pt-5 border-t border-border/50">
                                            <div className="flex items-center justify-between mb-3">
                                                <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                                                    <Globe className="h-3 w-3" />
                                                    Market Health
                                                </h4>
                                                <div className="flex gap-2">
                                                    <div className="flex items-center gap-1">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                                                        <span className="text-[8px] text-muted-foreground font-bold uppercase">Econ</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                                        <span className="text-[8px] text-muted-foreground font-bold uppercase">Bus</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                                                        <span className="text-[8px] text-muted-foreground font-bold uppercase">First</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Demand class breakdown visualization */}
                                            {market && (
                                                <div className="flex h-1 w-full rounded-full bg-muted/30 overflow-hidden mb-3">
                                                    <div className="h-full bg-zinc-500" style={{ width: `${(market.demand.economy / (market.demand.economy + market.demand.business + market.demand.first)) * 100}%` }} />
                                                    <div className="h-full bg-blue-500" style={{ width: `${(market.demand.business / (market.demand.economy + market.demand.business + market.demand.first)) * 100}%` }} />
                                                    <div className="h-full bg-yellow-500" style={{ width: `${(market.demand.first / (market.demand.economy + market.demand.business + market.demand.first)) * 100}%` }} />
                                                </div>
                                            )}

                                            {(() => {
                                                const routeKey = `${route.originIata}-${route.destinationIata}`;
                                                const offers = globalRouteRegistry.get(routeKey) || [];

                                                if (offers.length === 0) {
                                                    return (
                                                        <div className="bg-emerald-500/5 rounded-xl p-3 border border-emerald-500/10">
                                                            <p className="text-[11px] text-emerald-400/80 font-medium flex items-center gap-2">
                                                                <CheckCircle2 className="h-3 w-3" />
                                                                Monopoly Market: No active competitors found on this route.
                                                            </p>
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div className="grid grid-cols-1 gap-2">
                                                        {offers.map((offer: any, idx: number) => {
                                                            const comp = competitors.get(offer.airlinePubkey);

                                                            // Calculate estimated share for this offer vs ours
                                                            const ourFrequency = route.assignedAircraftIds.length * 7;
                                                            const ourTravelTime = Math.round((route.distanceKm / 800) * 60); // simplified model speed

                                                            const ourOffer: any = {
                                                                airlinePubkey: pubkey || '',
                                                                fareEconomy: route.fareEconomy,
                                                                fareBusiness: route.fareBusiness,
                                                                fareFirst: route.fareFirst,
                                                                frequencyPerWeek: ourFrequency || 1, // at least 1 for display
                                                                travelTimeMinutes: ourTravelTime,
                                                                stops: 0,
                                                                serviceScore: 0.7,
                                                                brandScore: airline.brandScore || 0.5
                                                            };

                                                            const allOffers = [ourOffer, ...offers];
                                                            const shares = calculateShares(allOffers);
                                                            const compShare = (shares.economy.get(offer.airlinePubkey) || 0) * 100;

                                                            return (
                                                                <div key={idx} className="flex items-center justify-between bg-muted/30 rounded-xl px-4 py-2.5 border border-border/50">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                                                                            {comp?.icaoCode || '??'}
                                                                        </div>
                                                                        <div className="flex flex-col">
                                                                            <span className="text-xs font-bold text-foreground">{comp?.name || 'Unknown Airline'}</span>
                                                                            <span className="text-[9px] text-muted-foreground uppercase font-semibold">Freq: {offer.frequencyPerWeek}/wk</span>
                                                                        </div>
                                                                    </div>

                                                                    <div className="flex gap-4 items-center">
                                                                        <div className="flex gap-2">
                                                                            <span className="text-[10px] font-mono text-zinc-500">E: {fpFormat(offer.fareEconomy, 0)}</span>
                                                                            <span className="text-[10px] font-mono text-blue-400">B: {fpFormat(offer.fareBusiness, 0)}</span>
                                                                            <span className="text-[10px] font-mono text-yellow-500">F: {fpFormat(offer.fareFirst, 0)}</span>
                                                                        </div>
                                                                        <div className="h-8 w-px bg-border/50" />
                                                                        <div className="flex flex-col text-right">
                                                                            <span className="text-[9px] text-muted-foreground uppercase font-bold">Est. Share</span>
                                                                            <span className="text-xs font-bold text-accent">{compShare.toFixed(1)}%</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {(searchQuery.length >= 2 ? searchResults.map(calculateSearchProspect).filter(Boolean) : prospectiveRoutes).map((market: any) => {
                            const isAlreadyOpen = activeRoutes.some(r => r.destinationIata === market.destination.iata);
                            const totalDemand = market.demand.economy + market.demand.business + market.demand.first;

                            return (
                                <div key={market.destination.iata} className="group relative rounded-2xl bg-card border border-border overflow-hidden p-5 transition-all hover:border-primary/50">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-8">
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-2xl font-black text-foreground tracking-tighter">
                                                        {market.destination.iata}
                                                        {market.destination.icao && market.destination.icao !== market.destination.iata && (
                                                            <span className="ml-2 text-xs text-muted-foreground font-mono font-normal">[{market.destination.icao}]</span>
                                                        )}
                                                    </span>
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
                                        <div className="h-full bg-zinc-500" style={{ width: `${(market.demand.economy / (totalDemand || 1)) * 100}%` }} title="Economy" />
                                        <div className="h-full bg-blue-500" style={{ width: `${(market.demand.business / (totalDemand || 1)) * 100}%` }} title="Business" />
                                        <div className="h-full bg-yellow-500" style={{ width: `${(market.demand.first / (totalDemand || 1)) * 100}%` }} title="First" />
                                    </div>
                                </div>
                            );
                        })}
                        {searchQuery.length > 0 && searchQuery.length < 2 && (
                            <div className="p-8 text-center text-muted-foreground font-bold italic">
                                Type at least 2 characters to search...
                            </div>
                        )}
                        {searchQuery.length >= 2 && searchResults.length === 0 && (
                            <div className="p-8 text-center text-muted-foreground font-bold italic">
                                No airports found matching "{searchQuery}"
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
