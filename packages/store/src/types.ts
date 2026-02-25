import type { AirlineEntity, AircraftInstance, AircraftModel, Route, TimelineEvent, FixedPoint, FlightOffer } from '@airtr/core';
import type { AirlineConfig, MarketplaceListing } from '@airtr/nostr';
import type { HubAction } from './slices/networkSlice';
export type { HubAction } from './slices/networkSlice';

export type IdentityStatus = 'checking' | 'no-extension' | 'ready';

export interface AirlineState {
    airline: AirlineEntity | null;
    fleet: AircraftInstance[];
    routes: Route[];
    timeline: TimelineEvent[];
    pubkey: string | null;
    identityStatus: IdentityStatus;
    isLoading: boolean;
    error: string | null;

    // Actions
    initializeIdentity: () => Promise<void>;
    createAirline: (params: AirlineConfig) => Promise<void>;
    modifyHubs: (action: HubAction) => Promise<void>;
    purchaseAircraft: (model: AircraftModel, deliveryHubIata?: string, configuration?: { economy: number; business: number; first: number; cargoKg: number; }, customName?: string, purchaseType?: 'buy' | 'lease') => Promise<void>;
    sellAircraft: (aircraftId: string) => Promise<void>;
    buyoutAircraft: (aircraftId: string) => Promise<void>;
    purchaseUsedAircraft: (listing: MarketplaceListing) => Promise<void>;
    listAircraft: (aircraftId: string, price: FixedPoint) => Promise<void>;
    cancelListing: (aircraftId: string) => Promise<void>;
    performMaintenance: (aircraftId: string) => Promise<void>;
    openRoute: (originIata: string, destinationIata: string, distanceKm: number) => Promise<void>;
    rebaseRoute: (routeId: string, newOriginIata: string) => Promise<void>;
    assignAircraftToRoute: (aircraftId: string, routeId: string | null) => Promise<void>;
    updateRouteFares: (routeId: string, fares: { economy?: FixedPoint; business?: FixedPoint; first?: FixedPoint }) => Promise<void>;
    updateHub: (newHubIata: string) => Promise<void>;
    processTick: (tick: number) => Promise<void>;
    // World / Multi-player
    competitors: Map<string, AirlineEntity>;
    globalRouteRegistry: Map<string, FlightOffer[]>;
    globalFleet: AircraftInstance[];
    globalRoutes: Route[];
    syncWorld: () => Promise<void>;
    processGlobalTick: (tick: number) => void;
}
