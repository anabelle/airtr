import { NDKNip07Signer } from '@nostr-dev-kit/ndk';
import { getNDK } from './ndk.js';

/**
 * Check if a NIP-07 extension (nos2x, Alby, etc.) is available.
 */
export function hasNip07(): boolean {
    return typeof window !== 'undefined' && typeof (window as any).nostr?.getPublicKey === 'function';
}

/**
 * Get the current user's pubkey from the NIP-07 extension.
 * 
 * This calls window.nostr.getPublicKey() directly with a timeout
 * to avoid the NDKNip07Signer caching issue where .user() caches
 * _userPromise and never re-checks after identity switches.
 * 
 * Returns the hex pubkey, or null if unavailable/timeout.
 */
export async function getPubkey(): Promise<string | null> {
    if (!hasNip07()) return null;

    try {
        const pubkey = await Promise.race([
            (window as any).nostr.getPublicKey() as Promise<string>,
            new Promise<null>((_, reject) =>
                setTimeout(() => reject(new Error('NIP-07 timeout')), 4000)
            ),
        ]);
        return pubkey ?? null;
    } catch (e) {
        console.warn('NIP-07 getPublicKey failed:', e);
        return null;
    }
}

/**
 * Attach the NIP-07 signer to NDK for event signing.
 * Must be called after confirming NIP-07 is available.
 * 
 * We create a NEW signer each time to avoid the cached _userPromise
 * issue when users switch identities in their extension.
 */
export function attachSigner(): void {
    if (!hasNip07()) return;
    const ndk = getNDK();
    // Always create a fresh signer to avoid cached identity
    ndk.signer = new NDKNip07Signer(4000);
}
