const DISMISSED_KEY_PREFIX = "acars:banner:dismissed:";
const SECURED_KEY_PREFIX = "acars:banner:secured:";
const SECURED_EVENT = "acars:ephemeral-key-secured";

export function getDismissedBannerKey(pubkey: string) {
  return `${DISMISSED_KEY_PREFIX}${pubkey}`;
}

export function getSecuredBannerKey(pubkey: string) {
  return `${SECURED_KEY_PREFIX}${pubkey}`;
}

export function isEphemeralBannerDismissed(pubkey: string): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(getDismissedBannerKey(pubkey)) === "1";
}

export function dismissEphemeralBanner(pubkey: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(getDismissedBannerKey(pubkey), "1");
}

export function isEphemeralKeySecured(pubkey: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(getSecuredBannerKey(pubkey)) === "1";
}

export function markEphemeralKeySecured(pubkey: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(getSecuredBannerKey(pubkey), "1");
  window.dispatchEvent(new CustomEvent(SECURED_EVENT, { detail: { pubkey } }));
}

export function subscribeEphemeralKeySecurityChanges(
  onSecure: (pubkey: string) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handleSecure = (event: Event) => {
    const detail = (event as CustomEvent<{ pubkey?: string }>).detail;
    if (detail?.pubkey) onSecure(detail.pubkey);
  };

  const handleStorage = (event: StorageEvent) => {
    if (!event.key?.startsWith(SECURED_KEY_PREFIX)) return;
    const pubkey = event.key.slice(SECURED_KEY_PREFIX.length);
    if (pubkey) onSecure(pubkey);
  };

  window.addEventListener(SECURED_EVENT, handleSecure);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(SECURED_EVENT, handleSecure);
    window.removeEventListener("storage", handleStorage);
  };
}
