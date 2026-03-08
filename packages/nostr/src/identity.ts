import { NDKNip07Signer, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { getNDK } from "./ndk.js";

const EPHEMERAL_KEY_STORAGE = "acars:ephemeral:nsec";

/**
 * Generate a brand-new Nostr keypair entirely in the browser.
 * Returns the nsec1-encoded secret key and the hex pubkey.
 */
export function generateNewKeypair(): { nsec: string; pubkey: string } {
  const sk = generateSecretKey();
  const nsec = nip19.nsecEncode(sk);
  const pubkey = getPublicKey(sk);
  return { nsec, pubkey };
}

/**
 * Persist an ephemeral nsec to localStorage so it survives page reload.
 * This is intentionally "just localStorage" — the SecurityUpgradeBanner
 * will prompt the user to export/protect it properly.
 */
export function saveEphemeralKey(nsec: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(EPHEMERAL_KEY_STORAGE, nsec);
}

/**
 * Load a previously saved ephemeral nsec from localStorage.
 * Returns null if nothing is stored.
 */
export function loadEphemeralKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(EPHEMERAL_KEY_STORAGE);
}

/**
 * Remove the stored ephemeral key (e.g., after user exports it or upgrades to a proper signer).
 */
export function clearEphemeralKey(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(EPHEMERAL_KEY_STORAGE);
}

/**
 * Check if a NIP-07 extension (nos2x, Alby, etc.) is available RIGHT NOW.
 */
export function hasNip07(): boolean {
  if (typeof window === "undefined") return false;
  const nostrProvider = (window as unknown as { nostr?: { getPublicKey?: () => Promise<string> } })
    .nostr;
  return typeof nostrProvider?.getPublicKey === "function";
}

/**
 * Wait for a NIP-07 extension to inject window.nostr.
 * Extensions inject their content scripts AFTER page JS starts,
 * so we poll briefly before giving up.
 */
export function waitForNip07(timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    if (hasNip07()) {
      resolve(true);
      return;
    }

    const interval = setInterval(() => {
      if (hasNip07()) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve(true);
      }
    }, 100);

    const timer = setTimeout(() => {
      clearInterval(interval);
      resolve(false);
    }, timeoutMs);
  });
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
export async function getPubkey(timeoutMs = 15000): Promise<string | null> {
  if (!hasNip07()) return null;

  try {
    const pubkey = await Promise.race([
      (
        window as unknown as { nostr: { getPublicKey: () => Promise<string> } }
      ).nostr.getPublicKey(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("NIP-07 timeout")), timeoutMs),
      ),
    ]);
    return pubkey ?? null;
  } catch (error) {
    console.warn("NIP-07 getPublicKey failed:", error);
    return null;
  }
}

/**
 * Attach the NIP-07 signer to NDK for event signing.
 * Must be called after confirming NIP-07 is available.
 *
 * By default, we do not override an existing private-key signer because
 * nsec/ephemeral sessions must keep signing with their current identity
 * even when a browser extension is present. Pass forceRefresh=true when
 * intentionally switching back to the browser extension.
 */
export function attachSigner(forceRefresh = false): void {
  if (!hasNip07()) return;
  const ndk = getNDK();
  if (!forceRefresh && ndk.signer instanceof NDKPrivateKeySigner) return;
  // Always create a fresh NIP-07 signer to avoid cached identity.
  ndk.signer = new NDKNip07Signer(15000);
}

/**
 * Login with an nsec private key directly (bypass NIP-07 extension).
 * This is a fallback for when extensions like nos2x are broken.
 *
 * Returns the hex pubkey, or throws on invalid key.
 */
export async function loginWithNsec(nsec: string): Promise<string> {
  const ndk = getNDK();
  const signer = new NDKPrivateKeySigner(nsec.trim());
  const user = await signer.user();
  ndk.signer = signer;
  return user.pubkey;
}
