import NDK from '@nostr-dev-kit/ndk';

const DEFAULT_RELAYS = [
    'wss://relay.damus.io',
    'wss://relay.snort.social',
    'wss://relay.primal.net',
    'wss://nos.lol',
    'wss://purplepag.es',
    'wss://atlas.nostr.land',
    'wss://offchain.pub',
    'wss://relay.nostr.band', // Moved to end since it was failing in logs
];

let ndkInstance: NDK | null = null;
let connectionPromise: Promise<void> | null = null;

/**
 * Get (or create) the NDK singleton.
 */
export function getNDK(): NDK {
    if (!ndkInstance) {
        ndkInstance = new NDK({
            explicitRelayUrls: DEFAULT_RELAYS,
        });
    }
    return ndkInstance;
}

/**
 * Ensures we are connected to at least one relay.
 * Returns a promise that resolves once the connection process is initiated
 * and at least one relay has acknowledged.
 */
export async function ensureConnected(): Promise<void> {
    const ndk = getNDK();

    if (connectionPromise) return connectionPromise;

    connectionPromise = (async () => {
        console.log('[Nostr] Connecting to relays:', DEFAULT_RELAYS.length);
        // ndk.connect() attempts to connect to all explicit relays.
        // It returns a promise that resolves when the first relay connects.
        try {
            await ndk.connect(3000);
            console.log('[Nostr] Initial connection attempt complete.');
        } catch (e) {
            console.warn('[Nostr] Connection attempt timed out or failed, but NDK will keep trying in background.');
        }
    })();

    return connectionPromise;
}
