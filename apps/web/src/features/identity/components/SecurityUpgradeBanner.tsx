import { useAirlineStore } from "@acars/store";
import { ShieldAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { EphemeralKeyBackupActions } from "./EphemeralKeyBackupActions";
import {
  dismissEphemeralBanner,
  isEphemeralBannerDismissed,
  isEphemeralKeySecured,
  subscribeEphemeralKeySecurityChanges,
} from "../lib/ephemeralBackup";

/**
 * Non-blocking banner shown when the user is playing with an
 * in-browser generated key that hasn't been backed up yet.
 *
 * Displayed when identityStatus === "ready" && isEphemeral === true.
 * Dismissed per-session for the current account via sessionStorage, and
 * permanently hidden for that account once the user copies or downloads
 * their secret key.
 */
export function SecurityUpgradeBanner() {
  const pubkey = useAirlineStore((state) => state.pubkey);
  const [dismissedAccounts, setDismissedAccounts] = useState<Record<string, true>>({});
  const [securityRefreshToken, setSecurityRefreshToken] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const dismissed = pubkey
    ? dismissedAccounts[pubkey] || isEphemeralBannerDismissed(pubkey)
    : false;
  const secured = pubkey ? isEphemeralKeySecured(pubkey) : false;

  useEffect(() => {
    return subscribeEphemeralKeySecurityChanges((updatedPubkey) => {
      if (updatedPubkey === pubkey) {
        setSecurityRefreshToken((current) => current + 1);
      }
    });
  }, [pubkey]);

  if (dismissed || secured) return null;

  function dismiss() {
    if (!pubkey) return;
    dismissEphemeralBanner(pubkey);
    setDismissedAccounts((current) => ({ ...current, [pubkey]: true }));
  }

  return (
    <div
      key={securityRefreshToken}
      className="pointer-events-auto w-full border-b border-amber-500/30 bg-amber-950/70 backdrop-blur-xl"
    >
      <div className="flex items-center gap-3 px-4 py-2">
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
        <p className="flex-1 text-xs font-medium text-amber-200">
          Your account isn&apos;t backed up yet — if you lose this browser/tab, your airline is
          gone.
        </p>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300 transition hover:bg-amber-500/20"
        >
          {expanded ? "Hide" : "Secure it"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss security warning"
          className="shrink-0 rounded p-1 text-amber-400/60 transition hover:text-amber-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-amber-500/20 px-4 py-3">
          <p className="mb-3 text-xs leading-relaxed text-amber-200/80">
            Your account key is saved only in this browser. Back it up so you can play from
            anywhere:
          </p>
          <EphemeralKeyBackupActions />
        </div>
      )}
    </div>
  );
}
