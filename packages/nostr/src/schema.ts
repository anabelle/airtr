import { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import { getNDK, ensureConnected } from './ndk.js';
import { type AirlineEntity, type FixedPoint, fp, fpRaw, FP_ZERO } from '@airtr/core';

/**
 * A validated marketplace listing from Nostr.
 */
export interface MarketplaceListing {
    /** Nostr event ID */
    id: string;
    /** Original aircraft instance ID */
    instanceId: string;
    /** Seller's Nostr pubkey (from event signature, not content) */
    sellerPubkey: string;
    /** Event creation timestamp */
    createdAt: number;
    /** Aircraft model ID */
    modelId: string;
    /** Aircraft display name */
    name: string;
    /** Owner pubkey (from content) */
    ownerPubkey: string;
    /** Asking price (FixedPoint) */
    marketplacePrice: FixedPoint;
    /** When the listing was created */
    listedAt: number;
    /** Aircraft condition 0.0-1.0 */
    condition: number;
    /** Total flight hours */
    flightHoursTotal: number;
    /** Flight hours since last check */
    flightHoursSinceCheck: number;
    /** Tick when aircraft was originally manufactured */
    birthTick: number;
    /** Tick when current owner purchased */
    purchasedAtTick: number;
    /** Original purchase price (FixedPoint) */
    purchasePrice: FixedPoint;
    /** Base airport */
    baseAirportIata: string;
    /** Purchase type */
    purchaseType: 'buy' | 'lease';
    /** Interior configuration */
    configuration: {
        economy: number;
        business: number;
        first: number;
        cargoKg: number;
    };
}

export type AirlineConfig = Pick<AirlineEntity, 'name' | 'icaoCode' | 'callsign' | 'hubs' | 'livery' | 'lastTick'> & {
    corporateBalance?: import('@airtr/core').FixedPoint;
    fleet?: import('@airtr/core').AircraftInstance[];
    routes?: import('@airtr/core').Route[];
    timeline?: import('@airtr/core').TimelineEvent[];
};

const AIRLINE_KIND = 30078;
const WORLD_ID = 'dev-v1';
const AIRTR_SCHEMA_VERSION = 1;
const AIRLINE_D_TAG = `airtr:world:${WORLD_ID}:airline`;
const AIRLINE_PUBLISH_DEBOUNCE_MS = 300;

let airlinePublishTimer: ReturnType<typeof setTimeout> | null = null;
let airlinePublishPromise: Promise<NDKEvent> | null = null;
let airlinePublishResolve: ((event: NDKEvent) => void) | null = null;
let airlinePublishReject: ((error: unknown) => void) | null = null;
let latestAirlineSnapshot: AirlineConfig | null = null;
let publishChain = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function hasWorldTag(event: NDKEvent, worldId: string): boolean {
    return event.tags.some(tag => tag[0] === 'world' && tag[1] === worldId);
}

function parseAirlineContent(data: unknown): {
    name: string;
    icaoCode: string | null;
    callsign: string | null;
    hubs: string[];
    livery: AirlineEntity['livery'];
    corporateBalance: import('@airtr/core').FixedPoint | null;
    fleet: import('@airtr/core').AircraftInstance[];
    routes: import('@airtr/core').Route[];
    timeline: import('@airtr/core').TimelineEvent[];
    lastTick: number | null;
} | null {
    if (!isRecord(data)) return null;

    const name = typeof data.name === 'string' ? data.name : null;
    const icaoCode = typeof data.icaoCode === 'string'
        ? data.icaoCode
        : (typeof data.icao === 'string' ? data.icao : null);
    const callsign = typeof data.callsign === 'string' ? data.callsign : null;

    const hubs = Array.isArray(data.hubs)
        ? data.hubs.filter((hub): hub is string => typeof hub === 'string')
        : (typeof data.hubIata === 'string' ? [data.hubIata] : []);

    const liverySource = isRecord(data.livery) ? data.livery : null;
    const livery = {
        primary: typeof liverySource?.primary === 'string' ? liverySource.primary : '#1f2937',
        secondary: typeof liverySource?.secondary === 'string' ? liverySource.secondary : '#3b82f6',
        accent: typeof liverySource?.accent === 'string' ? liverySource.accent : '#f59e0b',
    };

    const corporateBalance = typeof data.corporateBalance === 'number' && Number.isFinite(data.corporateBalance)
        ? fpRaw(data.corporateBalance)
        : null;

    const lastTick = typeof data.lastTick === 'number' && Number.isFinite(data.lastTick)
        ? data.lastTick
        : null;

    if (!name) return null;

    return {
        name,
        icaoCode,
        callsign,
        hubs,
        livery,
        corporateBalance,
        fleet: Array.isArray(data.fleet) ? data.fleet : [],
        routes: Array.isArray(data.routes) ? data.routes : [],
        timeline: Array.isArray(data.timeline) ? data.timeline : [],
        lastTick,
    };
}

async function publishAirlineNow(airline: AirlineConfig): Promise<NDKEvent> {
    await ensureConnected();
    const ndk = getNDK();

    if (!ndk.signer) {
        throw new Error("No signer available. Call attachSigner() first.");
    }

    const event = new NDKEvent(ndk);
    event.kind = AIRLINE_KIND;
    event.tags = [['d', AIRLINE_D_TAG], ['world', WORLD_ID]];

    event.content = JSON.stringify({
        schemaVersion: AIRTR_SCHEMA_VERSION,
        name: airline.name,
        icaoCode: airline.icaoCode,
        callsign: airline.callsign,
        hubs: airline.hubs,
        livery: airline.livery,
        corporateBalance: airline.corporateBalance,
        fleet: airline.fleet,
        routes: airline.routes,
        timeline: airline.timeline,
        lastTick: airline.lastTick,
    });

    await event.publish();
    return event;
}

/**
 * Kind for used aircraft listings.
 */
export const MARKETPLACE_KIND = 30079;
export const MARKETPLACE_D_PREFIX = `airtr:world:${WORLD_ID}:marketplace:`;

/**
 * Publishes an airline creation or update event to Nostr.
 */
export async function publishAirline(airline: AirlineConfig): Promise<NDKEvent> {
    latestAirlineSnapshot = airline;

    if (airlinePublishPromise) return airlinePublishPromise;

    airlinePublishPromise = new Promise<NDKEvent>((resolve, reject) => {
        airlinePublishResolve = resolve;
        airlinePublishReject = reject;
    });

    if (!airlinePublishTimer) {
        airlinePublishTimer = setTimeout(() => {
            const snapshot = latestAirlineSnapshot;
            latestAirlineSnapshot = null;
            airlinePublishTimer = null;

            const resolve = airlinePublishResolve;
            const reject = airlinePublishReject;
            airlinePublishResolve = null;
            airlinePublishReject = null;
            airlinePublishPromise = null;

            if (!snapshot) {
                reject?.(new Error('No airline snapshot to publish.'));
                return;
            }

            publishChain = publishChain
                .then(async () => {
                    const event = await publishAirlineNow(snapshot);
                    resolve?.(event);
                })
                .catch(error => {
                    reject?.(error);
                });
        }, AIRLINE_PUBLISH_DEBOUNCE_MS);
    }

    return airlinePublishPromise;
}

/**
 * Tries to fetch an existing airline configuration for the given pubkey.
 */
export async function loadAirline(pubkey: string): Promise<{ airline: AirlineEntity, fleet: import('@airtr/core').AircraftInstance[], routes: import('@airtr/core').Route[] } | null> {
    await ensureConnected();
    const ndk = getNDK();

    const filter: NDKFilter = {
        authors: [pubkey],
        kinds: [AIRLINE_KIND],
        '#d': [AIRLINE_D_TAG],
        limit: 1,
    };

    let event: NDKEvent | null = null;
    try {
        event = await Promise.race([
            ndk.fetchEvent(filter),
            new Promise<null>(resolve => setTimeout(() => resolve(null), 4000)),
        ]);
    } catch {
        return null;
    }

    if (!event) return null;

    if (!hasWorldTag(event, WORLD_ID)) return null;

    try {
        // Basic check to ensure content looks like JSON before parsing
        if (!event.content.trim().startsWith('{')) {
            return null;
        }

        const parsed = parseAirlineContent(JSON.parse(event.content));
        if (!parsed) return null;

        // Map event payload to AirlineEntity
        const loaded: AirlineEntity = {
            id: event.id,
            foundedBy: event.author.pubkey,
            status: 'private',
            ceoPubkey: event.author.pubkey,
            sharesOutstanding: 10000000,
            shareholders: { [event.author.pubkey]: 10000000 },
            name: parsed.name,
            icaoCode: parsed.icaoCode || '',
            callsign: parsed.callsign || '',
            hubs: parsed.hubs,
            livery: parsed.livery,
            brandScore: 0.5,
            tier: 1,
            // Defaults for derived metrics
            corporateBalance: parsed.corporateBalance ?? fp(100000000),
            stockPrice: fp(10), // $10/share
            fleetIds: parsed.fleet.map((f: any) => f.id),
            routeIds: parsed.routes.map((r: any) => r.id),
            timeline: parsed.timeline,
            lastTick: parsed.lastTick ?? 0
        };
        return { airline: loaded, fleet: parsed.fleet, routes: parsed.routes };
    } catch (e) {
        console.error("Failed parsing airline Nostr event", e);
        return null;
    }
}

/**
 * Publishes an aircraft to the global used marketplace.
 */
export async function publishUsedAircraft(aircraft: import('@airtr/core').AircraftInstance, price: import('@airtr/core').FixedPoint): Promise<NDKEvent> {
    // Input validation — defense-in-depth against malformed or malicious calls
    if (!aircraft || typeof aircraft.id !== 'string' || !aircraft.id) {
        throw new Error('Invalid aircraft: missing id');
    }
    if (typeof aircraft.modelId !== 'string' || !aircraft.modelId) {
        throw new Error('Invalid aircraft: missing modelId');
    }
    if (typeof aircraft.ownerPubkey !== 'string' || !aircraft.ownerPubkey) {
        throw new Error('Invalid aircraft: missing ownerPubkey');
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
        throw new Error('Invalid listing price: must be a positive finite number');
    }

    await ensureConnected();
    const ndk = getNDK();

    if (!ndk.signer) throw new Error("No signer available. Please check your Nostr extension.");

    console.info('[Nostr] Publishing used aircraft listing:', aircraft.id, 'at price:', price);

    const event = new NDKEvent(ndk);
    event.kind = MARKETPLACE_KIND as any;
    event.tags = [
        ['d', `${MARKETPLACE_D_PREFIX}${aircraft.id}`],
        ['model', aircraft.modelId],
        ['owner', aircraft.ownerPubkey || 'unknown'],
        ['price', price.toString()],
        ['world', WORLD_ID],
    ];

    const payload = {
        ...aircraft,
        schemaVersion: AIRTR_SCHEMA_VERSION,
        marketplacePrice: price,
        listedAt: Date.now(),
    };

    event.content = JSON.stringify(payload);

    console.info('[Nostr] Broadcasting marketplace event to relays...');
    await event.publish();
    console.info('[Nostr] Broadcast complete for event:', event.id);
    return event;
}

/**
 * Validates and parses raw marketplace listing data from a Nostr event.
 * Returns null if the data fails validation.
 */
function parseMarketplaceListing(data: unknown, eventId: string, authorPubkey: string, createdAt: number): MarketplaceListing | null {
    if (!isRecord(data)) return null;

    // Required string fields
    const modelId = typeof data.modelId === 'string' ? data.modelId : null;
    const instanceId = typeof data.id === 'string' ? data.id : null;
    if (!modelId || !instanceId) return null;

    const name = typeof data.name === 'string' ? data.name : 'Unknown Aircraft';
    const ownerPubkey = typeof data.ownerPubkey === 'string' ? data.ownerPubkey : authorPubkey;
    const baseAirportIata = typeof data.baseAirportIata === 'string' ? data.baseAirportIata : 'XXX';

    // Price: must be a positive finite number (already in FixedPoint scale from publishUsedAircraft)
    const rawPrice = data.marketplacePrice;
    if (typeof rawPrice !== 'number' || !Number.isFinite(rawPrice) || rawPrice <= 0) return null;
    const marketplacePrice = fpRaw(rawPrice);

    // Numeric fields with safe defaults (use ?? to handle 0 correctly)
    const condition = typeof data.condition === 'number' && Number.isFinite(data.condition)
        ? Math.max(0, Math.min(1, data.condition))
        : 0.5;

    const flightHoursTotal = typeof data.flightHoursTotal === 'number' && Number.isFinite(data.flightHoursTotal)
        ? Math.max(0, data.flightHoursTotal)
        : 0;

    const flightHoursSinceCheck = typeof data.flightHoursSinceCheck === 'number' && Number.isFinite(data.flightHoursSinceCheck)
        ? Math.max(0, data.flightHoursSinceCheck)
        : 0;

    const birthTick = typeof data.birthTick === 'number' && Number.isFinite(data.birthTick) ? data.birthTick : 0;
    const purchasedAtTick = typeof data.purchasedAtTick === 'number' && Number.isFinite(data.purchasedAtTick) ? data.purchasedAtTick : 0;
    const listedAt = typeof data.listedAt === 'number' && Number.isFinite(data.listedAt) ? data.listedAt : Date.now();

    const purchasePrice = typeof data.purchasePrice === 'number' && Number.isFinite(data.purchasePrice)
        ? fpRaw(data.purchasePrice)
        : FP_ZERO;

    const purchaseType = data.purchaseType === 'lease' ? 'lease' as const : 'buy' as const;

    // Configuration: validate each field or use sane defaults
    const rawConfig = isRecord(data.configuration) ? data.configuration : null;
    const configuration = {
        economy: typeof rawConfig?.economy === 'number' ? Math.max(0, Math.round(rawConfig.economy)) : 150,
        business: typeof rawConfig?.business === 'number' ? Math.max(0, Math.round(rawConfig.business)) : 0,
        first: typeof rawConfig?.first === 'number' ? Math.max(0, Math.round(rawConfig.first)) : 0,
        cargoKg: typeof rawConfig?.cargoKg === 'number' ? Math.max(0, Math.round(rawConfig.cargoKg)) : 0,
    };

    // Verify seller matches content owner (reject impersonation)
    if (ownerPubkey !== authorPubkey) return null;

    return {
        id: eventId,
        instanceId,
        sellerPubkey: authorPubkey,
        createdAt,
        modelId,
        name,
        ownerPubkey,
        marketplacePrice,
        listedAt,
        condition,
        flightHoursTotal,
        flightHoursSinceCheck,
        birthTick,
        purchasedAtTick,
        purchasePrice,
        baseAirportIata,
        purchaseType,
        configuration,
    };
}

/**
 * A map of pubkey -> Set of aircraft instanceIds they currently own.
 * Used to filter stale marketplace listings via ownership cross-referencing.
 */
export type SellerFleetIndex = Map<string, Set<string>>;

/**
 * Loads all active used aircraft listings from the global marketplace.
 *
 * @param sellerFleets - Optional index of ALL known airline fleets (pubkey -> Set<instanceId>).
 *   Used for two-pass ownership verification:
 *   1. If the seller's fleet no longer contains the aircraft → stale (seller removed it).
 *   2. If ANY other airline's fleet contains the aircraft → stale (someone else bought it,
 *      but the seller's client hasn't settled yet — covers pre-existing listings).
 */
export async function loadMarketplace(sellerFleets?: SellerFleetIndex): Promise<MarketplaceListing[]> {
    await ensureConnected();
    const ndk = getNDK();

    console.info('[Nostr] Fetching marketplace listings (Kind 30079) from relays...');

    const filter: NDKFilter = {
        kinds: [MARKETPLACE_KIND as any],
        limit: 100,
    };

    const listingsMap = new Map<string, MarketplaceListing>();

    // We use a manual subscription to collect events as they stream in.
    // This is more resilient than fetchEvents which can be unpredictable with slow relays.
    await new Promise<void>((resolve) => {
        const sub = ndk.subscribe(filter, { closeOnEose: true });
        const timeout = setTimeout(() => {
            sub.stop();
            console.warn('[Nostr] Marketplace fetch reached 6s safety timeout.');
            resolve();
        }, 6000);

        sub.on('event', (event: NDKEvent) => {
            // Only attempt to parse if it's an AirTR marketplace entry
            const dTag = event.tags.find(t => t[0] === 'd')?.[1];
            if (!dTag?.startsWith(MARKETPLACE_D_PREFIX)) return;
            if (!hasWorldTag(event, WORLD_ID)) return;

            try {
                const data = JSON.parse(event.content);
                const listing = parseMarketplaceListing(data, event.id, event.author.pubkey, event.created_at ?? 0);
                if (!listing) return;

                // Dedup by instanceId:sellerPubkey, keeping latest
                const dedupKey = `${listing.instanceId}:${listing.sellerPubkey}`;
                const existing = listingsMap.get(dedupKey);
                if (!existing || listing.createdAt >= existing.createdAt) {
                    listingsMap.set(dedupKey, listing);
                }
            } catch (e) {
                // Silently skip truly malformed events that match our prefix
            }
        });

        sub.on('eose', () => {
            console.log('[Nostr] Marketplace fetch received EOSE');
            clearTimeout(timeout);
            resolve();
        });
    });

    let result = Array.from(listingsMap.values());

    // Ownership verification: filter out stale listings
    if (sellerFleets && sellerFleets.size > 0) {
        // Build reverse index: aircraftId -> ownerPubkey (for all known fleets)
        const aircraftOwner = new Map<string, string>();
        for (const [pubkey, aircraftIds] of sellerFleets) {
            for (const aircraftId of aircraftIds) {
                aircraftOwner.set(aircraftId, pubkey);
            }
        }

        const beforeCount = result.length;
        result = result.filter(listing => {
            const currentOwner = aircraftOwner.get(listing.instanceId);

            // Check 1: If another airline (not the seller) now owns this aircraft,
            // it was already purchased. The seller's state may not be updated yet
            // (pre-settlement), but the listing is definitely stale.
            if (currentOwner && currentOwner !== listing.sellerPubkey) {
                console.info(`[Nostr] Filtering stale listing: ${listing.instanceId} (now owned by ${currentOwner.slice(0, 8)}..., not seller ${listing.sellerPubkey.slice(0, 8)}...)`);
                return false;
            }

            // Check 2: If we have the seller's fleet data and it no longer contains
            // this aircraft, the seller already settled/scrapped it.
            const sellerAircraftIds = sellerFleets.get(listing.sellerPubkey);
            if (sellerAircraftIds && !sellerAircraftIds.has(listing.instanceId)) {
                console.info(`[Nostr] Filtering stale listing: ${listing.instanceId} (seller ${listing.sellerPubkey.slice(0, 8)}... no longer owns it)`);
                return false;
            }

            return true;
        });
        const filtered = beforeCount - result.length;
        if (filtered > 0) {
            console.info(`[Nostr] Filtered ${filtered} stale marketplace listing(s) via ownership verification.`);
        }
    }

    result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    console.info(`[Nostr] Returning ${result.length} unique marketplace listings.`);
    return result;
}
/**
 * Loads all active airlines from the global network.
 */
export async function loadGlobalAirlines(): Promise<{ airline: AirlineEntity, fleet: import('@airtr/core').AircraftInstance[], routes: import('@airtr/core').Route[] }[]> {
    await ensureConnected();
    const ndk = getNDK();

    const filter: NDKFilter = {
        kinds: [AIRLINE_KIND],
        '#d': [AIRLINE_D_TAG],
        limit: 500, // Reasonable cap for global discovery
    };

    const airlinesMap = new Map<string, any>();

    await new Promise<void>((resolve) => {
        const sub = ndk.subscribe(filter, { closeOnEose: true });
        const timeout = setTimeout(() => {
            sub.stop();
            resolve();
        }, 8000);

        sub.on('event', (event: NDKEvent) => {
            try {
                if (!hasWorldTag(event, WORLD_ID)) return;
                if (!event.content.trim().startsWith('{')) return;
                const parsed = parseAirlineContent(JSON.parse(event.content));
                if (!parsed) return;

                const airline: AirlineEntity = {
                    id: event.id,
                    foundedBy: event.author.pubkey,
                    status: 'private',
                    ceoPubkey: event.author.pubkey,
                    sharesOutstanding: 10000000,
                    shareholders: { [event.author.pubkey]: 10000000 },
                    name: parsed.name,
                    icaoCode: parsed.icaoCode || '',
                    callsign: parsed.callsign || '',
                    hubs: parsed.hubs,
                    livery: parsed.livery,
                    brandScore: 0.5,
                    tier: 1,
                    corporateBalance: parsed.corporateBalance ?? fp(100000000),
                    stockPrice: fp(10),
                    fleetIds: parsed.fleet.map((f: any) => f.id),
                    routeIds: parsed.routes.map((r: any) => r.id),
                    timeline: parsed.timeline,
                    lastTick: parsed.lastTick ?? 0
                };

                const entry = { airline, fleet: parsed.fleet, routes: parsed.routes };

                // Only keep latest event from each author
                const existing = airlinesMap.get(event.author.pubkey);
                if (!existing || event.created_at! > existing.created_at) {
                    airlinesMap.set(event.author.pubkey, { ...entry, created_at: event.created_at });
                }
            } catch (e) {
                // Ignore malformed
            }
        });

        sub.on('eose', () => {
            clearTimeout(timeout);
            resolve();
        });
    });

    return Array.from(airlinesMap.values()).map(({ airline, fleet, routes }) => ({ airline, fleet, routes }));
}
