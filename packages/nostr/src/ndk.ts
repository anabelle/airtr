import NDK from '@nostr-dev-kit/ndk';

const defaultRelays = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://purplepag.es',
];

let globalNDK: NDK | null = null;

export function getNDK(): NDK {
    if (!globalNDK) {
        globalNDK = new NDK({
            explicitRelayUrls: defaultRelays,
            autoConnectUserRelays: true,
        });
    }
    return globalNDK;
}

export async function connectNDK(): Promise<void> {
    const ndk = getNDK();
    try {
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                resolve();
            }, 2500);

            ndk.connect(2500).then(() => {
                clearTimeout(timer);
                resolve();
            }).catch(e => {
                console.warn("NDK connection caught:", e);
                clearTimeout(timer);
                resolve();
            });
        });
    } catch (e) {
        console.warn("NDK connection warning (some relays may have failed):", e);
    }
}
