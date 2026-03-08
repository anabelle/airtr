import { NDKNip07Signer, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { getNDK } from "./ndk.js";

const LEGACY_EPHEMERAL_KEY_STORAGE = "acars:ephemeral:nsec";
const SECURE_EPHEMERAL_KEY_STORAGE = "acars:ephemeral:nsec:secure";
const SECURE_STORAGE_DB = "acars-secure-storage";
const SECURE_STORAGE_STORE = "keys";
const SECURE_STORAGE_KEY = "ephemeral-nsec";

interface EncryptedEphemeralKeyPayload {
  version: 1;
  iv: string;
  ciphertext: string;
}

let encryptionKeyPromise: Promise<CryptoKey | null> | null = null;

function canUseSecureEphemeralStorage(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof indexedDB !== "undefined" &&
    typeof globalThis.crypto?.subtle !== "undefined"
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

function openSecureStorageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SECURE_STORAGE_DB, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SECURE_STORAGE_STORE)) {
        db.createObjectStore(SECURE_STORAGE_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to open secure key storage."));
  });
}

async function readStoredEncryptionKey(): Promise<CryptoKey | null> {
  const db = await openSecureStorageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SECURE_STORAGE_STORE, "readonly");
    const request = tx.objectStore(SECURE_STORAGE_STORE).get(SECURE_STORAGE_KEY);

    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error ?? new Error("Unable to read secure key storage."));
    request.onsuccess = () => resolve((request.result as CryptoKey | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Unable to read secure key."));
  });
}

async function writeStoredEncryptionKey(key: CryptoKey): Promise<void> {
  const db = await openSecureStorageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SECURE_STORAGE_STORE, "readwrite");
    tx.objectStore(SECURE_STORAGE_STORE).put(key, SECURE_STORAGE_KEY);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error("Unable to persist secure key."));
  });
}

async function getOrCreateEncryptionKey(): Promise<CryptoKey | null> {
  if (!canUseSecureEphemeralStorage()) return null;

  if (!encryptionKeyPromise) {
    encryptionKeyPromise = (async () => {
      const existingKey = await readStoredEncryptionKey();
      if (existingKey) return existingKey;

      const createdKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);

      await writeStoredEncryptionKey(createdKey as CryptoKey);
      return createdKey as CryptoKey;
    })().catch((error) => {
      encryptionKeyPromise = null;
      throw error;
    });
  }

  return encryptionKeyPromise;
}

function warnSecureStorageFallback(error: unknown) {
  console.warn(
    "[Nostr] Secure ephemeral key storage unavailable, falling back to plain localStorage.",
    error,
  );
}

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
 * Persist an ephemeral nsec locally so it survives page reload.
 * We prefer AES-GCM ciphertext in localStorage with a non-extractable
 * origin-bound CryptoKey stored in IndexedDB. If that stack is unavailable,
 * we fall back to plain localStorage so recovery still works.
 */
export async function saveEphemeralKey(nsec: string): Promise<void> {
  if (typeof window === "undefined") return;

  if (!canUseSecureEphemeralStorage()) {
    localStorage.setItem(LEGACY_EPHEMERAL_KEY_STORAGE, nsec);
    localStorage.removeItem(SECURE_EPHEMERAL_KEY_STORAGE);
    return;
  }

  try {
    const encryptionKey = await getOrCreateEncryptionKey();
    if (!encryptionKey) {
      localStorage.setItem(LEGACY_EPHEMERAL_KEY_STORAGE, nsec);
      return;
    }

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      encryptionKey,
      new TextEncoder().encode(nsec),
    );

    const payload: EncryptedEphemeralKeyPayload = {
      version: 1,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    };

    localStorage.setItem(SECURE_EPHEMERAL_KEY_STORAGE, JSON.stringify(payload));
    localStorage.removeItem(LEGACY_EPHEMERAL_KEY_STORAGE);
  } catch (error) {
    warnSecureStorageFallback(error);
    localStorage.setItem(LEGACY_EPHEMERAL_KEY_STORAGE, nsec);
    localStorage.removeItem(SECURE_EPHEMERAL_KEY_STORAGE);
  }
}

export function hasStoredEphemeralKey(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    localStorage.getItem(SECURE_EPHEMERAL_KEY_STORAGE) ??
      localStorage.getItem(LEGACY_EPHEMERAL_KEY_STORAGE),
  );
}

/**
 * Load a previously saved ephemeral nsec from browser storage.
 * Legacy plain-text values are transparently migrated when possible.
 */
export async function loadEphemeralKey(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const encryptedPayload = localStorage.getItem(SECURE_EPHEMERAL_KEY_STORAGE);
  if (encryptedPayload) {
    if (!canUseSecureEphemeralStorage()) {
      throw new Error("This browser cannot unlock the locally stored account key.");
    }

    const encryptionKey = await getOrCreateEncryptionKey();
    if (!encryptionKey) {
      throw new Error("This browser cannot unlock the locally stored account key.");
    }

    let parsedPayload: EncryptedEphemeralKeyPayload;
    try {
      parsedPayload = JSON.parse(encryptedPayload) as EncryptedEphemeralKeyPayload;
    } catch {
      throw new Error("Stored account key data is unreadable.");
    }

    if (
      parsedPayload.version !== 1 ||
      typeof parsedPayload.iv !== "string" ||
      typeof parsedPayload.ciphertext !== "string"
    ) {
      throw new Error("Stored account key data is invalid.");
    }

    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToArrayBuffer(parsedPayload.iv) },
        encryptionKey,
        base64ToArrayBuffer(parsedPayload.ciphertext),
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      throw new Error("Stored account key data could not be decrypted.");
    }
  }

  const legacyKey = localStorage.getItem(LEGACY_EPHEMERAL_KEY_STORAGE);
  if (!legacyKey) return null;

  await saveEphemeralKey(legacyKey);
  return legacyKey;
}

/**
 * Remove the stored ephemeral key (e.g., after user exports it or upgrades to a proper signer).
 */
export async function clearEphemeralKey(): Promise<void> {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SECURE_EPHEMERAL_KEY_STORAGE);
  localStorage.removeItem(LEGACY_EPHEMERAL_KEY_STORAGE);
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

export function resetSigner(): void {
  const ndk = getNDK();
  ndk.signer = undefined;
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
