import { useEffect, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Building2, MapPin, PlaneTakeoff, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { airports as AIRPORTS, getHubPricingForIata, HUB_CLASSIFICATIONS } from '@airtr/data';
import { fp, fpFormat, haversineDistance, type Airport, type Route } from '@airtr/core';
import { useAirlineStore, useEngineStore } from '@airtr/store';
import { useConfirm } from '@/shared/lib/useConfirm';

type AirportInfoPanelProps = {
    airport: Airport;
    onClose: () => void;
};

const airportIndex = new Map(AIRPORTS.map((airport) => [airport.iata, airport]));

const numberFormat = new Intl.NumberFormat('en-US');
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const currencyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const routeSlotFee = fp(100000);
const routeSlotFeeLabel = fpFormat(routeSlotFee, 0);

function formatPopulation(value: number) {
    return value >= 1_000_000 ? `${compactFormat.format(value)}` : numberFormat.format(value);
}

function routeLabel(route: Route) {
    return `${route.originIata} → ${route.destinationIata}`;
}

export function AirportInfoPanel({ airport, onClose }: AirportInfoPanelProps) {
    const confirm = useConfirm();
    const navigate = useNavigate();
    const { airline, routes, fleet, competitors, modifyHubs, openRoute } = useAirlineStore();
    const setHub = useEngineStore(s => s.setHub);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const hubInfo = HUB_CLASSIFICATIONS[airport.iata];
    const hubPricing = getHubPricingForIata(airport.iata);

    const playerHubs = airline?.hubs ?? [];
    const isPlayerHub = playerHubs.includes(airport.iata);
    const isActiveHub = playerHubs[0] === airport.iata;
    const lastHub = playerHubs.length <= 1;

    const activeHubAirport = playerHubs[0] ? airportIndex.get(playerHubs[0]) : null;
    const distanceKm = activeHubAirport
        ? Math.round(haversineDistance(
            activeHubAirport.latitude,
            activeHubAirport.longitude,
            airport.latitude,
            airport.longitude,
        ))
        : null;

    const routesTouching = useMemo(() => routes.filter(route =>
        route.originIata === airport.iata || route.destinationIata === airport.iata
    ), [routes, airport.iata]);

    const activeHubRoute = useMemo(() => {
        if (!playerHubs[0]) return null;
        return routes.find(route =>
            route.originIata === playerHubs[0] && route.destinationIata === airport.iata
        ) ?? null;
    }, [routes, airport.iata, playerHubs]);

    const stationedFleet = useMemo(() => fleet.filter(ac => ac.baseAirportIata === airport.iata), [fleet, airport.iata]);

    const competitorHubNames = useMemo(() => {
        const names: string[] = [];
        competitors.forEach((value) => {
            if (value.hubs?.includes(airport.iata)) names.push(value.name);
        });
        return names;
    }, [competitors, airport.iata]);

    const canOpenHub = airline && !isPlayerHub;
    const canSwitchHub = airline && isPlayerHub && !isActiveHub;
    const canRemoveHub = airline && isPlayerHub && !lastHub;
    const canOpenRoute = airline && playerHubs[0] && !isActiveHub && !activeHubRoute;

    const handleOpenHub = async () => {
        if (!airline) return;
        const approved = await confirm({
            title: `Open hub at ${airport.iata}?`,
            description: `This will cost ${currencyFormat.format(hubPricing.openFee)} to open and ${currencyFormat.format(hubPricing.monthlyOpex)} per month in operating expenses.`,
            confirmLabel: 'Open Hub',
        });
        if (!approved) return;
        try {
            await modifyHubs({ type: 'add', iata: airport.iata });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            toast.error('Hub creation failed', { description: message });
        }
    };

    const handleSwitchHub = async () => {
        if (!airline) return;
        await modifyHubs({ type: 'switch', iata: airport.iata });
    };

    const handleRemoveHub = async () => {
        if (!airline) return;
        const approved = await confirm({
            title: `Remove hub at ${airport.iata}?`,
            description: 'Routes touching this hub will be suspended and aircraft will be unassigned.',
            confirmLabel: 'Remove Hub',
            tone: 'destructive',
        });
        if (!approved) return;
        try {
            await modifyHubs({ type: 'remove', iata: airport.iata });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            toast.error('Hub removal failed', { description: message });
        }
    };

    const handleOpenRoute = async () => {
        if (!airline || !playerHubs[0] || !distanceKm) return;
        const approved = await confirm({
            title: `Open route from ${playerHubs[0]} to ${airport.iata}?`,
            description: `Slot fee ${routeSlotFeeLabel}. Distance ${distanceKm.toLocaleString()} km. This route will be added with default pricing and no assigned aircraft.`,
            confirmLabel: 'Open Route',
        });
        if (!approved) return;
        try {
            await openRoute(playerHubs[0], airport.iata, distanceKm);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            toast.error('Route open failed', { description: message });
        }
    };

    const handleSetHome = () => {
        setHub(
            airport,
            { latitude: airport.latitude, longitude: airport.longitude, source: 'manual' },
            'manual selection',
        );
        onClose();
    };

    return (
        <aside
            className="pointer-events-auto fixed z-30 w-[min(360px,calc(100vw-2rem))] max-h-[80vh] rounded-2xl border border-border bg-background/90 shadow-[0_30px_90px_rgba(0,0,0,0.65)] backdrop-blur-2xl overflow-hidden left-4 right-4 bottom-4 sm:left-auto sm:right-4 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2"
            aria-live="polite"
        >
            <div className="flex items-start justify-between border-b border-border/60 px-5 py-4">
                <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Airport</p>
                    <h3 className="text-lg font-bold text-foreground">
                        {airport.name}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono font-semibold text-foreground">{airport.iata}</span>
                        {airport.icao && airport.icao !== airport.iata ? (
                            <span className="font-mono">{airport.icao}</span>
                        ) : null}
                        <span>{airport.city}, {airport.country}</span>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="h-9 w-9 rounded-full bg-background/60 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors touch-manipulation"
                    aria-label="Close airport panel"
                >
                    <X className="mx-auto h-4 w-4" />
                </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto overscroll-contain px-5 py-4 space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
                        {hubInfo?.tier ?? 'regional'} hub
                    </span>
                    {isActiveHub ? (
                        <span className="rounded-full bg-emerald-500/20 text-emerald-200 px-2.5 py-1 text-[11px] uppercase tracking-widest font-semibold">Active Hub</span>
                    ) : null}
                    {!isActiveHub && isPlayerHub ? (
                        <span className="rounded-full bg-emerald-500/10 text-emerald-200 px-2.5 py-1 text-[11px] uppercase tracking-widest font-semibold">Your Hub</span>
                    ) : null}
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Population</p>
                        <p className="mt-1 text-sm font-mono font-semibold">{formatPopulation(airport.population)}</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">GDP/Capita</p>
                        <p className="mt-1 text-sm font-mono font-semibold">{currencyFormat.format(airport.gdpPerCapita)}</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Altitude</p>
                        <p className="mt-1 text-sm font-mono font-semibold">{numberFormat.format(airport.altitude)} ft</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Timezone</p>
                        <p className="mt-1 text-sm font-mono font-semibold">{airport.timezone}</p>
                    </div>
                    {hubInfo ? (
                        <>
                            <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Capacity/hr</p>
                                <p className="mt-1 text-sm font-mono font-semibold">{hubInfo.baseCapacityPerHour}</p>
                            </div>
                            <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Slot Control</p>
                                <p className="mt-1 text-sm font-mono font-semibold">{hubInfo.slotControlled ? 'Yes' : 'No'}</p>
                            </div>
                        </>
                    ) : null}
                </div>

                {airline ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                            <MapPin className="h-4 w-4" />
                            Your Operations
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Fleet Here</p>
                                <p className="mt-1 text-sm font-mono font-semibold">{stationedFleet.length}</p>
                            </div>
                            <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Routes Touching</p>
                                <p className="mt-1 text-sm font-mono font-semibold">{routesTouching.length}</p>
                            </div>
                        </div>
                        {routesTouching.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {routesTouching.slice(0, 5).map(route => (
                                    <span key={route.id} className="rounded-full border border-border/50 bg-background/60 px-2 py-1 text-[11px] font-mono text-muted-foreground">
                                        {routeLabel(route)}
                                    </span>
                                ))}
                                {routesTouching.length > 5 ? (
                                    <span className="rounded-full border border-border/50 bg-background/60 px-2 py-1 text-[11px] font-mono text-muted-foreground">
                                        +{routesTouching.length - 5} more
                                    </span>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {competitorHubNames.length > 0 ? (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                            <Users className="h-4 w-4" />
                            Competitor Hubs
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {competitorHubNames.slice(0, 4).map((name) => (
                                <span key={name} className="rounded-full border border-border/50 bg-background/60 px-2.5 py-1 text-[11px] text-muted-foreground">
                                    {name}
                                </span>
                            ))}
                            {competitorHubNames.length > 4 ? (
                                <span className="rounded-full border border-border/50 bg-background/60 px-2.5 py-1 text-[11px] text-muted-foreground">
                                    +{competitorHubNames.length - 4} more
                                </span>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                        <Building2 className="h-4 w-4" />
                        Actions
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        {canOpenHub ? (
                            <button
                                type="button"
                                onClick={handleOpenHub}
                                className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:scale-[1.02] active:scale-[0.98] touch-manipulation"
                            >
                                Open Hub ({currencyFormat.format(hubPricing.openFee)})
                            </button>
                        ) : null}
                        {canSwitchHub ? (
                            <button
                                type="button"
                                onClick={handleSwitchHub}
                                className="flex-1 rounded-xl border border-border/60 bg-background/70 px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent touch-manipulation"
                            >
                                Switch Active Hub
                            </button>
                        ) : null}
                        {canRemoveHub ? (
                            <button
                                type="button"
                                onClick={handleRemoveHub}
                                className="flex-1 rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20 touch-manipulation"
                            >
                                Remove Hub
                            </button>
                        ) : null}
                        {airline && isPlayerHub && lastHub ? (
                            <button
                                type="button"
                                disabled
                                className="flex-1 rounded-xl border border-border/40 bg-background/40 px-4 py-2.5 text-sm font-semibold text-muted-foreground opacity-60"
                            >
                                Last Hub (Locked)
                            </button>
                        ) : null}
                        {canOpenRoute ? (
                            <button
                                type="button"
                                onClick={handleOpenRoute}
                                className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent/80 touch-manipulation"
                            >
                                Open Route {distanceKm ? `(${distanceKm.toLocaleString()} km)` : ''} • {routeSlotFeeLabel}
                            </button>
                        ) : null}
                        {activeHubRoute ? (
                            <button
                                type="button"
                                onClick={() => navigate({ to: '/network' })}
                                className="flex-1 rounded-xl border border-border/60 bg-background/70 px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent touch-manipulation"
                            >
                                View Route
                            </button>
                        ) : null}
                        {!airline ? (
                            <button
                                type="button"
                                onClick={handleSetHome}
                                className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:scale-[1.02] active:scale-[0.98] touch-manipulation"
                            >
                                Set as Home
                            </button>
                        ) : null}
                    </div>
                    {distanceKm && activeHubAirport ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <PlaneTakeoff className="h-4 w-4" />
                            Distance from {activeHubAirport.iata}: {distanceKm.toLocaleString()} km
                        </div>
                    ) : null}
                </div>
            </div>
        </aside>
    );
}
