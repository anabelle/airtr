import { useState } from 'react';
import { useAirlineStore, useEngineStore } from '@airtr/store';
import { fpFormat, fpToNumber, getSuggestedFares, calculateShares, haversineDistance, calculateDemand, getSeason, getProsperityIndex, fpScale, fp, type Airport, type Season, type FixedPoint, type FlightOffer } from '@airtr/core';
import { airports as ALL_AIRPORTS } from '@airtr/data';
import { Globe, PlusCircle, CheckCircle2, AlertCircle, TrendingUp, MapPin, Search } from 'lucide-react';
import { toast } from 'sonner';

export function RouteManager() {
    const {
        airline,
        pubkey,
        routes,
        openRoute,
        updateRouteFares,
        rebaseRoute,
        globalRouteRegistry,
        competitors
    } = useAirlineStore();
    const { routes: prospectiveRoutes, homeAirport, tick } = useEngineStore();
    const [tab, setTab] = useState<'active' | 'opportunities'>('active');
    const [fareEditor, setFareEditor] = useState<{
        routeId: string;
        originIata: string;
        destinationIata: string;
        distanceKm: number;
    } | null>(null);
    const [fareInputs, setFareInputs] = useState<{ e: string; b: string; f: string }>({ e: '', b: '', f: '' });
    const [fareError, setFareError] = useState<string | null>(null);
    const [isSavingFares, setIsSavingFares] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [rebaseTargets, setRebaseTargets] = useState<Record<string, string>>({});

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

    type ProspectMarket = {
        origin: Airport;
        destination: Airport;
        distance: number;
        demand: { economy: number; business: number; first: number };
        estimatedDailyRevenue: FixedPoint;
        season: Season;
    };

    const calculateSearchProspect = (dest: Airport): ProspectMarket | null => {
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

    const activeRoutes = routes.filter(route => route.status === 'active');
    const suspendedRoutes = routes.filter(route => route.status === 'suspended');

    const handleSaveFares = async () => {
        if (!fareEditor) return;
        const eVal = parseInt(fareInputs.e.replace(/[^0-9]/g, ''), 10);
        const bVal = parseInt(fareInputs.b.replace(/[^0-9]/g, ''), 10);
        const fVal = parseInt(fareInputs.f.replace(/[^0-9]/g, ''), 10);

        if ([eVal, bVal, fVal].every((val) => Number.isNaN(val))) {
            setFareError('Enter at least one fare value.');
            return;
        }

        setFareError(null);
        setIsSavingFares(true);
        try {
            await updateRouteFares(fareEditor.routeId, {
                economy: Number.isNaN(eVal) ? undefined : fp(eVal),
                business: Number.isNaN(bVal) ? undefined : fp(bVal),
                first: Number.isNaN(fVal) ? undefined : fp(fVal),
            });
            toast.success('Fares updated');
            setFareEditor(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            toast.error('Fare update failed', {
                description: message,
            });
        } finally {
            setIsSavingFares(false);
        }
    };

    const suggestedFares = fareEditor ? getSuggestedFares(fareEditor.distanceKm) : null;

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
                {suspendedRoutes.length > 0 && (
                    <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-200">Suspended Routes</p>
                                <p className="text-sm text-amber-100/80 mt-2">
                                    These routes lost their origin hub. Rebase them to an active hub to resume service.
                                </p>
                            </div>
                            <div className="rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-xs font-bold text-amber-200">
                                {suspendedRoutes.length} awaiting rebase
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-3">
                            {suspendedRoutes.map((route) => (
                                <div key={route.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-background/70 px-4 py-3">
                                    <div>
                                        <p className="text-sm font-bold text-foreground">
                                            {route.originIata} → {route.destinationIata}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground">
                                            Distance {route.distanceKm.toLocaleString()} km
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <select
                                            value={rebaseTargets[route.id] ?? airline.hubs[0] ?? ''}
                                            onChange={(e) => setRebaseTargets(prev => ({ ...prev, [route.id]: e.target.value }))}
                                            className="h-9 rounded-lg border border-border/60 bg-background px-3 text-xs font-bold text-foreground"
                                        >
                                            {airline.hubs.map((hub) => (
                                                <option key={hub} value={hub}>{hub}</option>
                                            ))}
                                        </select>
                                        <button
                                            onClick={async () => {
                                                const targetHub = rebaseTargets[route.id] ?? airline.hubs[0];
                                                if (!targetHub) return;
                                                try {
                                                    await rebaseRoute(route.id, targetHub);
                                                    toast.success('Route rebased');
                                                } catch (err) {
                                                    const message = err instanceof Error ? err.message : 'Route rebase failed';
                                                    toast.error('Route rebase failed', { description: message });
                                                }
                                            }}
                                            className="h-9 rounded-lg bg-amber-500 px-3 text-xs font-bold text-amber-950 hover:bg-amber-400 transition"
                                        >
                                            Rebase to Hub
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
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
                                                    <div className="flex gap-3 mt-1">
                                                        <span className="text-xs font-mono bg-zinc-500/10 px-2 py-0.5 rounded border border-zinc-500/20">E: {fpFormat(route.fareEconomy, 0)}</span>
                                                        <span className="text-xs font-mono bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 text-blue-400">B: {fpFormat(route.fareBusiness, 0)}</span>
                                                        <span className="text-xs font-mono bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20 text-yellow-500">F: {fpFormat(route.fareFirst, 0)}</span>
                                                    </div>
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

                                                <button
                                                    onClick={() => {
                                                        setFareEditor({
                                                            routeId: route.id,
                                                            originIata: route.originIata,
                                                            destinationIata: route.destinationIata,
                                                            distanceKm: route.distanceKm,
                                                        });
                                                        setFareInputs({
                                                            e: fpToNumber(route.fareEconomy).toString(),
                                                            b: fpToNumber(route.fareBusiness).toString(),
                                                            f: fpToNumber(route.fareFirst).toString(),
                                                        });
                                                        setFareError(null);
                                                    }}
                                                    className="px-4 py-2 bg-white/5 text-white/60 border border-white/5 rounded-xl text-sm font-bold hover:bg-white/10 transition-all"
                                                >
                                                    Edit Fares
                                                </button>

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
                                                        {offers.map((offer: FlightOffer, idx: number) => {
                                                            const comp = competitors.get(offer.airlinePubkey);

                                                            // Calculate estimated share for this offer vs ours
                                                            const ourFrequency = route.assignedAircraftIds.length * 7;
                                                            const ourTravelTime = Math.round((route.distanceKm / 800) * 60); // simplified model speed

                                                            const ourOffer: FlightOffer = {
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
                        {(searchQuery.length >= 2
                            ? searchResults.map(calculateSearchProspect).filter((market): market is ProspectMarket => Boolean(market))
                            : prospectiveRoutes
                        ).map((market: ProspectMarket) => {
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
                                                    } catch (error) {
                                                        const message = error instanceof Error ? error.message : 'Unknown error';
                                                        toast.error('Route open failed', {
                                                            description: message,
                                                        });
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
            {fareEditor && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                        onClick={() => !isSavingFares && setFareEditor(null)}
                    />
                    <div className="relative z-10 w-full max-w-xl rounded-2xl border border-border bg-background/95 shadow-[0_20px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
                        <div className="flex items-start justify-between border-b border-border/50 px-6 py-5">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Route Pricing</p>
                                <h3 className="text-lg font-bold text-foreground">
                                    {fareEditor.originIata} → {fareEditor.destinationIata}
                                </h3>
                                <p className="text-xs text-muted-foreground mt-1">Distance: {fareEditor.distanceKm.toLocaleString()} km</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => !isSavingFares && setFareEditor(null)}
                                className="rounded-full bg-background/60 p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                                aria-label="Close"
                            >
                                <span className="sr-only">Close</span>
                                X
                            </button>
                        </div>
                        <div className="px-6 py-5 space-y-4">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                <div className="rounded-xl border border-border/50 bg-background/60 p-4">
                                    <label className="text-[10px] uppercase text-muted-foreground font-semibold">Economy</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={fareInputs.e}
                                        onChange={(e) => setFareInputs({ ...fareInputs, e: e.target.value })}
                                        className="mt-2 h-10 w-full rounded-lg bg-background border border-border/50 px-3 text-sm font-medium outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                                    />
                                    {suggestedFares ? (
                                        <p className="mt-2 text-[10px] text-muted-foreground">
                                            Suggested: {fpToNumber(suggestedFares.economy)}
                                        </p>
                                    ) : null}
                                </div>
                                <div className="rounded-xl border border-border/50 bg-background/60 p-4">
                                    <label className="text-[10px] uppercase text-muted-foreground font-semibold">Business</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={fareInputs.b}
                                        onChange={(e) => setFareInputs({ ...fareInputs, b: e.target.value })}
                                        className="mt-2 h-10 w-full rounded-lg bg-background border border-border/50 px-3 text-sm font-medium outline-none focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/20 text-blue-400"
                                    />
                                    {suggestedFares ? (
                                        <p className="mt-2 text-[10px] text-blue-400/70">
                                            Suggested: {fpToNumber(suggestedFares.business)}
                                        </p>
                                    ) : null}
                                </div>
                                <div className="rounded-xl border border-border/50 bg-background/60 p-4">
                                    <label className="text-[10px] uppercase text-muted-foreground font-semibold">First</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={fareInputs.f}
                                        onChange={(e) => setFareInputs({ ...fareInputs, f: e.target.value })}
                                        className="mt-2 h-10 w-full rounded-lg bg-background border border-border/50 px-3 text-sm font-medium outline-none focus:border-yellow-500/60 focus:ring-2 focus:ring-yellow-500/20 text-yellow-500"
                                    />
                                    {suggestedFares ? (
                                        <p className="mt-2 text-[10px] text-yellow-500/70">
                                            Suggested: {fpToNumber(suggestedFares.first)}
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                            {fareError ? (
                                <p className="text-xs font-semibold text-red-400">{fareError}</p>
                            ) : null}
                            <button
                                type="button"
                                onClick={() => {
                                    if (!suggestedFares) return;
                                    setFareInputs({
                                        e: fpToNumber(suggestedFares.economy).toString(),
                                        b: fpToNumber(suggestedFares.business).toString(),
                                        f: fpToNumber(suggestedFares.first).toString(),
                                    });
                                }}
                                className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-background/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent"
                            >
                                Use suggested fares
                            </button>
                        </div>
                        <div className="flex items-center justify-end gap-3 border-t border-border/50 px-6 py-4">
                            <button
                                type="button"
                                onClick={() => setFareEditor(null)}
                                disabled={isSavingFares}
                                className="rounded-lg border border-border bg-background/70 px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveFares}
                                disabled={isSavingFares}
                                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
                            >
                                {isSavingFares ? 'Saving...' : 'Save fares'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
