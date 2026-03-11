import { useAirlineStore } from "@acars/store";
import { ShieldAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  dismissEphemeralBanner,
  isEphemeralBannerDismissed,
  isEphemeralKeySecured,
  subscribeEphemeralKeySecurityChanges,
} from "../lib/ephemeralBackup";
import { EphemeralKeyBackupActions } from "./EphemeralKeyBackupActions";

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
  const { t } = useTranslation("identity");
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
      className="pointer-events-auto relative z-10 mt-[4.75rem] w-full border-b border-amber-500/30 bg-amber-950/70 backdrop-blur-xl sm:mt-0"
    >
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-xs font-medium text-amber-200">{t("security.notBackedUp")}</p>
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300 transition hover:bg-amber-500/20"
          >
            {expanded ? t("security.hide") : t("security.secureIt")}
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("security.dismissWarning")}
            className="shrink-0 rounded p-1 text-amber-400/60 transition hover:text-amber-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-amber-500/20 px-4 py-3">
          <p className="mb-3 text-xs leading-relaxed text-amber-200/80">
            {t("security.keyBrowserOnly")}
          </p>
          <EphemeralKeyBackupActions />
        </div>
      )}
    </div>
  );
}
