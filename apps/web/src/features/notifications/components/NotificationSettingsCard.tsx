import { Bell, BellOff, CheckCircle2, MoonStar, Send, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNotificationSettings } from "../context";
import { NOTIFICATION_CATEGORY_META } from "../domain";

function StatusPill({
  tone,
  label,
}: {
  tone: "neutral" | "success" | "warning" | "danger";
  label: string;
}) {
  const className =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : tone === "danger"
          ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
          : "border-border/60 bg-background/60 text-muted-foreground";

  return (
    <span
      className={`inline-flex min-h-8 items-center rounded-full border px-3 text-[11px] font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

export function NotificationSettingsCard() {
  const { t } = useTranslation(["common", "game"]);
  const {
    preferences,
    platformStatus,
    lastError,
    browserPermission,
    nativePermission,
    supportsBrowserPush,
    isNativeAndroid,
    softAskDismissed,
    setSoftAskDismissed,
    setPreferences,
    enableBrowserPush,
    enableNativePush,
    disablePush,
    sendTestNotification,
    registrationSecret,
  } = useNotificationSettings();

  const browserStatusLabel =
    browserPermission === "unsupported"
      ? t("notifications.statusUnsupported", { ns: "game" })
      : browserPermission === "granted"
        ? t("notifications.statusGranted", { ns: "game" })
        : browserPermission === "denied"
          ? t("notifications.statusDenied", { ns: "game" })
          : t("notifications.statusPrompt", { ns: "game" });

  const platformLabel = isNativeAndroid
    ? nativePermission === "granted"
      ? t("notifications.androidReady", { ns: "game" })
      : t("notifications.androidSetupRequired", { ns: "game" })
    : supportsBrowserPush
      ? browserStatusLabel
      : t("notifications.statusUnsupported", { ns: "game" });
  const canEnablePush = isNativeAndroid || supportsBrowserPush;
  const canSendTest = Boolean(registrationSecret);
  const enablePushUnavailableReason = isNativeAndroid
    ? ""
    : t("notifications.enableUnavailable", { ns: "game" });
  const sendTestUnavailableReason = t("notifications.sendTestUnavailable", { ns: "game" });
  const enableButtonTitle = canEnablePush ? undefined : enablePushUnavailableReason;
  const sendTestButtonTitle = canSendTest ? undefined : sendTestUnavailableReason;

  return (
    <section id="notifications" className="rounded-xl border border-border/50 bg-background/50 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" aria-hidden="true" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("notifications.title", { ns: "game" })}
            </p>
          </div>
          <h3 className="text-lg font-bold text-foreground">
            {t("notifications.heading", { ns: "game" })}
          </h3>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {t("notifications.description", { ns: "game" })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            tone={
              registrationSecret ? "success" : platformStatus === "error" ? "danger" : "neutral"
            }
            label={
              registrationSecret
                ? t("notifications.registered", { ns: "game" })
                : t("notifications.notRegistered", { ns: "game" })
            }
          />
          <StatusPill
            tone={
              platformStatus === "enabled"
                ? "success"
                : platformStatus === "error"
                  ? "danger"
                  : platformStatus === "disabled"
                    ? "warning"
                    : "neutral"
            }
            label={platformLabel}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr,0.85fr]">
        <div className="space-y-4">
          {!softAskDismissed && (
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <p className="text-sm font-semibold text-foreground">
                {t("notifications.softAskTitle", { ns: "game" })}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("notifications.softAskBody", { ns: "game" })}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={!canEnablePush}
                  aria-disabled={!canEnablePush}
                  title={enableButtonTitle}
                  onClick={() => {
                    if (!canEnablePush) return;
                    void (isNativeAndroid ? enableNativePush() : enableBrowserPush());
                  }}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Bell className="h-4 w-4" aria-hidden="true" />
                  {t("notifications.enablePush", { ns: "game" })}
                </button>
                <button
                  type="button"
                  onClick={() => setSoftAskDismissed(true)}
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-border/60 bg-background/60 px-4 py-2 text-sm font-medium text-muted-foreground transition hover:border-border hover:text-foreground"
                >
                  {t("notifications.maybeLater", { ns: "game" })}
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={!canEnablePush}
              aria-disabled={!canEnablePush}
              title={enableButtonTitle}
              onClick={() => {
                if (!canEnablePush) return;
                void (isNativeAndroid ? enableNativePush() : enableBrowserPush());
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
              {isNativeAndroid
                ? t("notifications.enableAndroid", { ns: "game" })
                : t("notifications.enableBrowser", { ns: "game" })}
            </button>
            <button
              type="button"
              onClick={() => void disablePush()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border/60 bg-background/60 px-4 py-2 text-sm font-medium text-muted-foreground transition hover:border-border hover:text-foreground"
            >
              <BellOff className="h-4 w-4" aria-hidden="true" />
              {t("notifications.disablePush", { ns: "game" })}
            </button>
            <button
              type="button"
              disabled={!canSendTest}
              aria-disabled={!canSendTest}
              title={sendTestButtonTitle}
              onClick={() => {
                if (!canSendTest) return;
                void sendTestNotification();
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {t("notifications.sendTest", { ns: "game" })}
            </button>
          </div>

          <div className="rounded-2xl border border-border/40 bg-background/40 p-4">
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t("notifications.masterToggle", { ns: "game" })}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("notifications.masterToggleDescription", { ns: "game" })}
                </p>
              </div>
              <input
                type="checkbox"
                checked={preferences.enabled}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    enabled: event.currentTarget.checked,
                  }))
                }
                className="mt-1 h-5 w-5 rounded border-border bg-background text-primary focus:ring-primary"
              />
            </label>
          </div>

          <div className="rounded-2xl border border-border/40 bg-background/40 p-4">
            <div className="flex items-center gap-2">
              <MoonStar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-semibold text-foreground">
                {t("notifications.quietHours", { ns: "game" })}
              </p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("notifications.quietHoursDescription", { ns: "game" })}
            </p>
            <label className="mt-3 flex cursor-pointer items-center justify-between gap-3">
              <span className="text-sm text-foreground">
                {t("notifications.quietHoursEnabled", { ns: "game" })}
              </span>
              <input
                type="checkbox"
                checked={preferences.quietHours.enabled}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    quietHours: {
                      ...current.quietHours,
                      enabled: event.currentTarget.checked,
                    },
                  }))
                }
                className="h-5 w-5 rounded border-border bg-background text-primary focus:ring-primary"
              />
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm text-muted-foreground">
                <span>{t("notifications.quietStart", { ns: "game" })}</span>
                <input
                  type="time"
                  value={preferences.quietHours.start}
                  onChange={(event) =>
                    setPreferences((current) => ({
                      ...current,
                      quietHours: {
                        ...current.quietHours,
                        start: event.currentTarget.value,
                      },
                    }))
                  }
                  className="min-h-11 w-full rounded-md border border-border bg-background/70 px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="space-y-1 text-sm text-muted-foreground">
                <span>{t("notifications.quietEnd", { ns: "game" })}</span>
                <input
                  type="time"
                  value={preferences.quietHours.end}
                  onChange={(event) =>
                    setPreferences((current) => ({
                      ...current,
                      quietHours: {
                        ...current.quietHours,
                        end: event.currentTarget.value,
                      },
                    }))
                  }
                  className="min-h-11 w-full rounded-md border border-border bg-background/70 px-3 py-2 text-sm text-foreground"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-background/40 p-4">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground">
              {t("notifications.categories", { ns: "game" })}
            </p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("notifications.categoriesDescription", { ns: "game" })}
          </p>

          <div className="mt-4 space-y-2">
            {NOTIFICATION_CATEGORY_META.map((item) => (
              <label
                key={item.category}
                className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-border/40 bg-background/30 px-3 py-3 transition hover:border-border"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.categories[item.category]}
                  onChange={(event) =>
                    setPreferences((current) => ({
                      ...current,
                      categories: {
                        ...current.categories,
                        [item.category]: event.currentTarget.checked,
                      },
                    }))
                  }
                  className="mt-1 h-5 w-5 rounded border-border bg-background text-primary focus:ring-primary"
                />
              </label>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-border/40 bg-background/30 p-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("notifications.timelineFallback", { ns: "game" })}
              </p>
            </div>
          </div>

          {lastError && (
            <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {lastError}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
