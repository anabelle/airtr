import { ensureConnected, getNDK } from "@airtr/nostr";
import type { NDKUserProfile } from "@nostr-dev-kit/ndk";
import { nip19 } from "nostr-tools";
import { useEffect, useState } from "react";

export interface NostrProfileState {
  name: string | null;
  displayName: string | null;
  image: string | null;
  nip05: string | null;
  lud16: string | null;
  npub: string | null;
  isLoading: boolean;
}

const profileCache = new Map<string, NDKUserProfile | null>();
const pendingFetches = new Map<string, Promise<NDKUserProfile | null>>();

const getProfileImage = (profile: NDKUserProfile | null | undefined) => {
  if (!profile) return null;
  const rawProfile = profile as NDKUserProfile & { picture?: string };
  return profile.image ?? rawProfile.picture ?? null;
};

const fetchProfile = async (pubkey: string): Promise<NDKUserProfile | null> => {
  try {
    await ensureConnected();
    const ndk = getNDK();
    const user = ndk.getUser({ pubkey });
    const profile = await user.fetchProfile();
    profileCache.set(pubkey, profile);
    return profile;
  } catch {
    profileCache.set(pubkey, null);
    return null;
  } finally {
    pendingFetches.delete(pubkey);
  }
};

export function useNostrProfile(pubkey: string | null): NostrProfileState {
  const [profile, setProfile] = useState<NDKUserProfile | null>(() => {
    if (!pubkey) return null;
    return profileCache.get(pubkey) ?? null;
  });
  const [isLoading, setIsLoading] = useState(() => {
    if (!pubkey) return false;
    return !profileCache.has(pubkey);
  });

  useEffect(() => {
    if (!pubkey) {
      setProfile(null);
      setIsLoading(false);
      return;
    }

    const cached = profileCache.get(pubkey);
    if (cached !== undefined) {
      setProfile(cached);
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);

    let pending = pendingFetches.get(pubkey);
    if (!pending) {
      pending = fetchProfile(pubkey);
      pendingFetches.set(pubkey, pending);
    }

    pending.then((fetched) => {
      if (!active) return;
      setProfile(fetched);
      setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [pubkey]);

  return {
    name: profile?.name ?? null,
    displayName: profile?.displayName ?? null,
    image: getProfileImage(profile),
    nip05: profile?.nip05 ?? null,
    lud16: profile?.lud16 ?? null,
    npub: pubkey ? getNpub(pubkey) : null,
    isLoading,
  };
}

function getNpub(pubkey: string): string | null {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return null;
  }
}
