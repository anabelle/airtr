import { clearEphemeralKey, hasNip07, loadEphemeralKey } from "@acars/nostr";
import { useAirlineStore } from "@acars/store";
import { Check, Copy, Download, Shield, ShieldAlert, X } from "lucide-react";
import { useState } from "react";

/**
 * Non-blocking banner shown when the user is playing with an
 * in-browser generated key that hasn't been backed up yet.
 *
 * Displayed when identityStatus === "ready" && isEphemeral === true.
 * Dismissed per-session via sessionStorage but reappears on next visit
 * until the user properly secures their account.
 */
export function SecurityUpgradeBanner() {
  const initializeIdentity = useAirlineStore((state) => state.initializeIdentity);
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem("acars:banner:dismissed") === "1",
  );
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (dismissed) return null;

  const nsec = loadEphemeralKey();

  function dismiss() {
    sessionStorage.setItem("acars:banner:dismissed", "1");
    setDismissed(true);
  }

  async function copyNsec() {
    if (!nsec) return;
    await navigator.clipboard.writeText(nsec);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function downloadNsec() {
    if (!nsec) return;
    const blob = new Blob(
      [
        `ACARS Secret Key — keep this safe!\n\nDo NOT share this with anyone.\n\n${nsec}\n\nTo restore your account, paste this key in the ACARS login screen.`,
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "acars-secret-key.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function upgradeToExtension() {
    clearEphemeralKey();
    await initializeIdentity();
  }

  return (
    <div className="pointer-events-auto w-full border-b border-amber-500/30 bg-amber-950/70 backdrop-blur-xl">
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyNsec}
              disabled={!nsec}
              className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-40"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied!" : "Copy my secret key"}
            </button>
            <button
              type="button"
              onClick={downloadNsec}
              disabled={!nsec}
              className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Download key file
            </button>
            {hasNip07() && (
              <button
                type="button"
                onClick={upgradeToExtension}
                className="flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
              >
                <Shield className="h-3.5 w-3.5" />
                Switch to wallet extension
              </button>
            )}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-amber-400/60">
            Your secret key starts with <code className="font-mono">nsec1…</code> — treat it like a
            password. Anyone who has it controls your airline.
          </p>
        </div>
      )}
    </div>
  );
}
