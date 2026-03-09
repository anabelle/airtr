import { hasNip07, hasStoredEphemeralKey, loadEphemeralKey } from "@acars/nostr";
import { useAirlineStore } from "@acars/store";
import { Check, Copy, Download, Loader2, Shield } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { markEphemeralKeySecured } from "../lib/ephemeralBackup";

export function EphemeralKeyBackupActions({
  showUpgradeButton = true,
}: {
  showUpgradeButton?: boolean;
}) {
  const { t } = useTranslation("identity");
  const initializeIdentity = useAirlineStore((state) => state.initializeIdentity);
  const isLoading = useAirlineStore((state) => state.isLoading);
  const pubkey = useAirlineStore((state) => state.pubkey);
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState<"copy" | "download" | null>(null);
  const hasKey = hasStoredEphemeralKey();

  async function withKeyExport(action: "copy" | "download", run: (nsec: string) => Promise<void>) {
    setBusyAction(action);
    try {
      const nsec = await loadEphemeralKey();
      if (!nsec) {
        toast.error(t("backup.unavailable"), {
          description: t("backup.noKeyFound"),
        });
        return;
      }

      await run(nsec);
      if (pubkey) {
        markEphemeralKeySecured(pubkey);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t("backup.localKeyAccessFailed");
      toast.error(action === "copy" ? t("backup.copyFailed") : t("backup.downloadFailed"), {
        description: message,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function copyNsec() {
    if (!navigator.clipboard?.writeText) {
      toast.error(t("backup.copyFailed"), {
        description: t("backup.clipboardUnavailable"),
      });
      return;
    }

    await withKeyExport("copy", async (nsec) => {
      await navigator.clipboard.writeText(nsec);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
      toast.success(t("backup.keyCopied"), {
        description: t("backup.keyCopiedDesc"),
      });
    });
  }

  async function downloadNsec() {
    await withKeyExport("download", async (nsec) => {
      const blob = new Blob(
        [
          `${t("backup.fileTitle")}\n\n${t("backup.fileWarning")}\n\n${nsec}\n\n${t("backup.fileRestoreInstructions")}`,
        ],
        { type: "text/plain" },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "acars-secret-key.txt";
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(t("backup.keyDownloaded"), {
        description: t("backup.keyDownloadedDesc"),
      });
    });
  }

  async function upgradeToExtension() {
    await initializeIdentity();
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copyNsec}
          disabled={!hasKey || busyAction === "download"}
          className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-40"
        >
          {busyAction === "copy" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {busyAction === "copy"
            ? t("backup.copying")
            : copied
              ? t("backup.copied")
              : t("backup.copyKey")}
        </button>
        <button
          type="button"
          onClick={downloadNsec}
          disabled={!hasKey || busyAction === "copy"}
          className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-40"
        >
          {busyAction === "download" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {busyAction === "download" ? t("backup.preparing") : t("backup.downloadKey")}
        </button>
        {showUpgradeButton && hasNip07() && (
          <button
            type="button"
            onClick={upgradeToExtension}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-40"
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Shield className="h-3.5 w-3.5" />
            )}
            {isLoading ? t("backup.switching") : t("backup.switchToWallet")}
          </button>
        )}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-amber-400/60">
        {t("backup.keyExplainer")}
      </p>
    </>
  );
}
