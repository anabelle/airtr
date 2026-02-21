import NDK from '@nostr-dev-kit/ndk';

const DEFAULT_RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://purplepag.es',
];

let ndkInstance: NDK | null = null;
let connected = false;

/**
 * Get (or create) the NDK singleton.
 * NDK internally handles relay reconnection, so we only create one instance.
 */
export function getNDK(): NDK {
    if (!ndkInstance) {
        ndkInstance = new NDK({
            explicitRelayUrls: DEFAULT_RELAYS,
        });
        connected = false;
    }
    return ndkInstance;
}

/**
 * Connect to relays. Safe to call multiple times — will only connect once.
 * This is fire-and-forget: NDK connects in the background and handles
 * reconnection internally. We don't await full connection.
 */
export function ensureConnected(): void {
    if (connected) return;
    const ndk = getNDK();
    // NDK.connect() returns void and manages its own reconnection.
    // We intentionally don't await — events will queue until a relay connects.
    ndk.connect();
    connected = true;
}
