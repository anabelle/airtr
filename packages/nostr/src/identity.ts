import { NDKPrivateKeySigner, NDKNip07Signer } from '@nostr-dev-kit/ndk';
import { getNDK } from './ndk.js';

/**
 * Attempt to connect to the NIP-07 browser extension for signing.
 * Falls back to generating a new local key signer.
 */
export async function setupSigner(): Promise<boolean> {
    const ndk = getNDK();

    // Check if NIP-07 extension is available
    if (typeof window !== 'undefined' && (window as any).nostr) {
        try {
            const nip07Signer = new NDKNip07Signer();
            ndk.signer = nip07Signer;
            return true; // Extension used
        } catch (e) {
            console.warn("Failed connecting to NIP-07 extension. Falling back to generated keys.", e);
        }
    }

    // Generate or load local keys
    let tempSigner: NDKPrivateKeySigner;
    const storedKey = typeof window !== 'undefined' ? window.localStorage.getItem('airtr_dev_privkey') : null;

    if (storedKey) {
        tempSigner = new NDKPrivateKeySigner(storedKey);
    } else {
        tempSigner = NDKPrivateKeySigner.generate();
        if (typeof window !== 'undefined' && tempSigner.privateKey) {
            window.localStorage.setItem('airtr_dev_privkey', tempSigner.privateKey);
        }
    }

    ndk.signer = tempSigner;
    return false; // Local keys generated/loaded
}

/**
 * Returns the active user's pubkey, or undefined if no signer is set.
 */
export async function getUserPubkey(): Promise<string | undefined> {
    const ndk = getNDK();
    if (!ndk.signer) return undefined;
    const user = await ndk.signer.user();
    return user?.pubkey;
}
