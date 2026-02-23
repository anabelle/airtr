import { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import { getNDK, ensureConnected } from './ndk.js';
import { type AirlineEntity, fp } from '@airtr/core';

export type AirlineConfig = Pick<AirlineEntity, 'name' | 'icaoCode' | 'callsign' | 'hubs' | 'livery' | 'lastTick'> & {
    corporateBalance?: import('@airtr/core').FixedPoint;
    fleet?: import('@airtr/core').AircraftInstance[];
};

const AIRLINE_KIND = 30078;
const AIRLINE_D_TAG = 'airtr:airline';

/**
 * Kind for used aircraft listings.
 */
export const MARKETPLACE_KIND = 30079;
export const MARKETPLACE_D_PREFIX = 'airtr:marketplace:';

/**
 * Publishes an airline creation or update event to Nostr.
 */
export async function publishAirline(airline: AirlineConfig): Promise<NDKEvent> {
    await ensureConnected();
    const ndk = getNDK();

    if (!ndk.signer) {
        throw new Error("No signer available. Call attachSigner() first.");
    }

    const event = new NDKEvent(ndk);
    event.kind = AIRLINE_KIND;
    event.tags = [['d', AIRLINE_D_TAG]];

    event.content = JSON.stringify({
        name: airline.name,
        icaoCode: airline.icaoCode,
        callsign: airline.callsign,
        hubs: airline.hubs,
        livery: airline.livery,
        corporateBalance: airline.corporateBalance,
        fleet: airline.fleet,
        lastTick: airline.lastTick,
    });

    await event.publish();
    return event;
}

/**
 * Tries to fetch an existing airline configuration for the given pubkey.
 */
export async function loadAirline(pubkey: string): Promise<{ airline: AirlineEntity, fleet: import('@airtr/core').AircraftInstance[] } | null> {
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

    try {
        // Basic check to ensure content looks like JSON before parsing
        if (!event.content.trim().startsWith('{')) {
            return null;
        }

        const data = JSON.parse(event.content);

        // Map event payload to AirlineEntity
        const loaded: AirlineEntity = {
            id: event.id,
            foundedBy: event.author.pubkey,
            status: 'private',
            ceoPubkey: event.author.pubkey,
            sharesOutstanding: 10000000,
            shareholders: { [event.author.pubkey]: 10000000 },
            name: data.name,
            icaoCode: data.icaoCode || data.icao,
            callsign: data.callsign,
            hubs: data.hubs || (data.hubIata ? [data.hubIata] : []), // Migration fallback
            livery: data.livery,
            brandScore: 0.5,
            tier: 1,
            // Defaults for derived metrics
            corporateBalance: data.corporateBalance || fp(100000000),
            stockPrice: fp(10), // $10/share
            fleetIds: data.fleet ? data.fleet.map((f: any) => f.id) : [],
            routeIds: [],
            lastTick: data.lastTick || 0
        };
        return { airline: loaded, fleet: data.fleet || [] };
    } catch (e) {
        console.error("Failed parsing airline Nostr event", e);
        return null;
    }
}

/**
 * Publishes an aircraft to the global used marketplace.
 */
export async function publishUsedAircraft(aircraft: import('@airtr/core').AircraftInstance, price: import('@airtr/core').FixedPoint): Promise<NDKEvent> {
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
    ];

    const payload = {
        ...aircraft,
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
 * Loads all active used aircraft listings from the global marketplace.
 */
export async function loadMarketplace(): Promise<any[]> {
    await ensureConnected();
    const ndk = getNDK();

    console.group('[Nostr] loadMarketplace');
    console.info('[Nostr] Fetching marketplace listings (Kind 30079) from relays...');

    const filter: NDKFilter = {
        kinds: [MARKETPLACE_KIND as any],
        limit: 100,
    };

    const listingsMap = new Map<string, any>();

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

            try {
                const data = JSON.parse(event.content);
                if (!data.modelId || !data.id) return;

                const listing = {
                    ...data,
                    id: event.id,
                    instanceId: data.id,
                    sellerPubkey: event.author.pubkey,
                    createdAt: event.created_at,
                };

                const existing = listingsMap.get(listing.instanceId);
                if (!existing || listing.createdAt >= (existing.createdAt || 0)) {
                    listingsMap.set(listing.instanceId, listing);
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

    const result = Array.from(listingsMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    console.info(`[Nostr] Returning ${result.length} unique marketplace listings.`);
    console.groupEnd();
    return result;
}
