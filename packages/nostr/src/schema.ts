import { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import { getNDK } from './ndk.js';
import { type Airline, fp } from '@airtr/core';

const AIRLINE_KIND = 30078;
const AIRLINE_D_TAG = 'airtr:airline';

/**
 * Publishes an airline creation or update event to Nostr.
 */
export async function publishAirline(airline: Omit<Airline, 'pubkey' | 'brandScore' | 'balance' | 'tier'>): Promise<NDKEvent> {
    const ndk = getNDK();

    if (!ndk.signer) {
        throw new Error("No signer available. Call setupSigner() first.");
    }

    const event = new NDKEvent(ndk);
    event.kind = AIRLINE_KIND;
    event.tags = [['d', AIRLINE_D_TAG]];

    // We don't save computed state (balance, score), just identity setup details.
    event.content = JSON.stringify({
        name: airline.name,
        icaoCode: airline.icaoCode,
        callsign: airline.callsign,
        hubIata: airline.hubIata,
        livery: airline.livery,
    });

    await event.publish();
    return event;
}

/**
 * Tries to fetch an existing airline configuration for the given pubkey.
 */
export async function loadAirline(pubkey: string): Promise<Airline | null> {
    const ndk = getNDK();

    const filter: NDKFilter = {
        authors: [pubkey],
        kinds: [AIRLINE_KIND],
        '#d': [AIRLINE_D_TAG],
        limit: 1,
    };

    let event: NDKEvent | null = null;
    try {
        event = await new Promise<NDKEvent | null>((resolve) => {
            const timer = setTimeout(() => resolve(null), 3000);

            ndk.fetchEvent(filter).then(e => {
                clearTimeout(timer);
                resolve(e);
            }).catch(() => {
                clearTimeout(timer);
                resolve(null);
            });
        });
    } catch {
        return null;
    }

    if (!event) return null;

    try {
        const data = JSON.parse(event.content);

        // Convert the Nostr event payload back into full Airline state domain model.
        // Balance and Tier should ideally be sourced from the core engine state, 
        // but for now, they are zeroed/defaulted.
        const loaded: Airline = {
            pubkey: event.author.pubkey,
            name: data.name,
            icaoCode: data.icaoCode || data.icao,
            callsign: data.callsign,
            hubIata: data.hubIata || data.hub,
            livery: data.livery,
            brandScore: 0.5,
            balance: fp(100000000), // starting balance (as fixedpoint integer conceptually)
            tier: 1,
        };
        return loaded;
    } catch (e) {
        console.error("Failed parsing airline Nostr event", e);
        return null;
    }
}
