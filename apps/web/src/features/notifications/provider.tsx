import { useAirlineStore } from "@acars/store";
import { Capacitor } from "@capacitor/core";
import {
  PushNotifications,
  type PushNotificationSchema,
  type Token,
} from "@capacitor/push-notifications";
import React from "react";
import { toast } from "sonner";
import { type NotificationPayload, NOTIFICATION_CATEGORY_META } from "./domain";
import { NotificationContext, type NotificationContextValue } from "./context";
import { openNotificationUrl } from "./deepLinks";
import {
  type AndroidNotificationRegistration,
  type BrowserNotificationRegistration,
  registerNotificationTarget,
  sendNotificationCandidate,
  unregisterNotificationTarget,
} from "./api";
import {
  loadNotificationPreferences,
  saveNotificationPreferences,
  shouldDeliverNotification,
  type NotificationPreferences,
} from "./preferences";

const DEVICE_ID_STORAGE_KEY = "acars:notifications:device-id";
const SOFT_ASK_KEY = "acars:notifications:soft-ask:dismissed";
const DEFAULT_TEST_NOTIFICATION_CATEGORY =
  NOTIFICATION_CATEGORY_META.find((item) => item.defaultEnabled)?.category ?? "delivery";
const ANDROID_CHANNELS = [
  {
    id: "acars-critical",
    name: "Critical finance",
    description: "Bankruptcy filings and severe financial warnings.",
    importance: 5,
  },
  {
    id: "acars-competition",
    name: "Competition",
    description: "Competitor hub moves and price wars.",
    importance: 4,
  },
  {
    id: "acars-progression",
    name: "Progression",
    description: "Tier upgrades and major purchases or sales.",
    importance: 4,
  },
  {
    id: "acars-operations",
    name: "Operations",
    description: "Deliveries, maintenance, ferry flights, takeoffs, and landings.",
    importance: 3,
  },
] as const;

type PlatformStatus = "unsupported" | "idle" | "registering" | "enabled" | "disabled" | "error";

function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
  return created;
}

function getSoftAskDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SOFT_ASK_KEY) === "1";
}

function setSoftAskDismissedStorage(value: boolean) {
  if (typeof window === "undefined") return;
  if (value) {
    localStorage.setItem(SOFT_ASK_KEY, "1");
  } else {
    localStorage.removeItem(SOFT_ASK_KEY);
  }
}

function getRegistrationSecretKey(
  pubkey: string,
  platform: "browser" | "android",
  deviceId: string,
): string {
  return `acars:notifications:secret:${pubkey}:${platform}:${deviceId}`;
}

function loadRegistrationSecret(
  pubkey: string | null,
  platform: "browser" | "android",
  deviceId: string,
) {
  if (!pubkey || typeof window === "undefined") return null;
  return localStorage.getItem(getRegistrationSecretKey(pubkey, platform, deviceId));
}

function persistRegistrationSecret(
  pubkey: string,
  platform: "browser" | "android",
  deviceId: string,
  secret: string | null,
) {
  if (typeof window === "undefined") return;
  const key = getRegistrationSecretKey(pubkey, platform, deviceId);
  if (secret) {
    localStorage.setItem(key, secret);
  } else {
    localStorage.removeItem(key);
  }
}

function decodeVapidKey(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  return result.buffer;
}

function getBrowserPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

function notificationTitleFromPush(push: PushNotificationSchema): string {
  return push.title ?? "ACARS notification";
}

function notificationBodyFromPush(push: PushNotificationSchema): string {
  return (
    push.body ?? (typeof push.data?.body === "string" ? push.data.body : "Open ACARS for details.")
  );
}

function buildTestNotification(category = DEFAULT_TEST_NOTIFICATION_CATEGORY): NotificationPayload {
  return {
    id: crypto.randomUUID(),
    category,
    title: "Push notifications ready",
    body: "ACARS can now deliver high-signal alerts to this device.",
    urgency: "normal",
    ttlPolicy: "medium",
    collapseKey: `test:${category}`,
    groupKey: "category:test",
    deepLink: { kind: "corporate", section: "notifications" },
    url: "/corporate#notifications",
    createdAt: Date.now(),
  };
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const pubkey = useAirlineStore((state) => state.pubkey);
  const deviceId = React.useMemo(() => getDeviceId(), []);
  const isNativeAndroid = Capacitor.getPlatform() === "android";
  const supportsBrowserPush =
    typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

  const [preferences, setPreferences] = React.useState<NotificationPreferences>(() =>
    loadNotificationPreferences(pubkey ?? null),
  );
  const [registrationSecret, setRegistrationSecret] = React.useState<string | null>(() =>
    loadRegistrationSecret(pubkey ?? null, isNativeAndroid ? "android" : "browser", deviceId),
  );
  const [platformStatus, setPlatformStatus] = React.useState<PlatformStatus>("idle");
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [browserPermission, setBrowserPermission] = React.useState<
    NotificationPermission | "unsupported"
  >(getBrowserPermission());
  const [nativePermission, setNativePermission] = React.useState("unknown");
  const [softAskDismissed, setSoftAskDismissedState] = React.useState(getSoftAskDismissed);
  const [browserRegistration, setBrowserRegistration] =
    React.useState<ServiceWorkerRegistration | null>(null);
  const [browserSubscription, setBrowserSubscription] = React.useState<PushSubscriptionJSON | null>(
    null,
  );
  const [androidToken, setAndroidToken] = React.useState<string | null>(null);

  const setSoftAskDismissed = React.useCallback((dismissed: boolean) => {
    setSoftAskDismissedStorage(dismissed);
    setSoftAskDismissedState(dismissed);
  }, []);

  React.useEffect(() => {
    setPreferences(loadNotificationPreferences(pubkey ?? null));
    setRegistrationSecret(
      loadRegistrationSecret(pubkey ?? null, isNativeAndroid ? "android" : "browser", deviceId),
    );
  }, [deviceId, isNativeAndroid, pubkey]);

  React.useEffect(() => {
    if (!pubkey) return;
    saveNotificationPreferences(pubkey, preferences);
  }, [preferences, pubkey]);

  const persistSecret = React.useCallback(
    (secret: string | null) => {
      setRegistrationSecret(secret);
      if (!pubkey) return;
      persistRegistrationSecret(pubkey, isNativeAndroid ? "android" : "browser", deviceId, secret);
    },
    [deviceId, isNativeAndroid, pubkey],
  );

  React.useEffect(() => {
    if (!supportsBrowserPush) {
      setPlatformStatus((current) => (current === "idle" ? "unsupported" : current));
      return;
    }

    let cancelled = false;
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/notification-sw.js", {
          scope: "/",
        });
        if (cancelled) return;
        setBrowserRegistration(registration);
        const existingSubscription = await registration.pushManager.getSubscription();
        if (existingSubscription) {
          setBrowserSubscription(existingSubscription.toJSON());
          setPlatformStatus("enabled");
        } else if (Notification.permission === "denied") {
          setPlatformStatus("disabled");
        }
      } catch (error) {
        if (cancelled) return;
        setLastError(
          error instanceof Error
            ? error.message
            : "Unable to register the notification service worker.",
        );
        setPlatformStatus("error");
      }
    };

    void register();
    return () => {
      cancelled = true;
    };
  }, [supportsBrowserPush]);

  React.useEffect(() => {
    setBrowserPermission(getBrowserPermission());
  }, []);

  React.useEffect(() => {
    if (!isNativeAndroid) return;

    let active = true;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    const init = async () => {
      const permissionStatus = await PushNotifications.checkPermissions();
      if (active) {
        setNativePermission(permissionStatus.receive);
      }

      handles.push(
        await PushNotifications.addListener("registration", async (token: Token) => {
          setAndroidToken(token.value);
          if (!pubkey) return;
          try {
            const response = await registerNotificationTarget({
              platform: "android",
              pubkey,
              deviceId,
              token: token.value,
              preferences,
              permissionState: "granted",
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
              registrationSecret,
            } satisfies AndroidNotificationRegistration);
            persistSecret(response.registrationSecret);
            setPlatformStatus("enabled");
            setLastError(null);
          } catch (error) {
            setLastError(
              error instanceof Error ? error.message : "Unable to register Android push token.",
            );
            setPlatformStatus("error");
          }
        }),
      );

      handles.push(
        await PushNotifications.addListener("registrationError", (error) => {
          setLastError(error.error ?? "Android push registration failed.");
          setPlatformStatus("error");
        }),
      );

      handles.push(
        await PushNotifications.addListener("pushNotificationReceived", (notification) => {
          toast.info(notificationTitleFromPush(notification), {
            description: notificationBodyFromPush(notification),
          });
        }),
      );

      handles.push(
        await PushNotifications.addListener("pushNotificationActionPerformed", (notification) => {
          const url =
            typeof notification.notification.data?.url === "string"
              ? notification.notification.data.url
              : null;
          if (url) {
            openNotificationUrl(url);
          }
        }),
      );
    };

    void init();
    return () => {
      active = false;
      handles.forEach((handle) => {
        void handle.remove();
      });
    };
  }, [deviceId, isNativeAndroid, persistSecret, preferences, pubkey, registrationSecret]);

  const syncBrowserRegistration = React.useCallback(
    async (subscriptionJson: PushSubscriptionJSON, permissionState: NotificationPermission) => {
      if (!pubkey) return;
      const response = await registerNotificationTarget({
        platform: "browser",
        pubkey,
        deviceId,
        subscription: subscriptionJson,
        preferences,
        permissionState,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        registrationSecret,
      } satisfies BrowserNotificationRegistration);
      persistSecret(response.registrationSecret);
      setPlatformStatus("enabled");
      setLastError(null);
    },
    [deviceId, persistSecret, preferences, pubkey, registrationSecret],
  );

  React.useEffect(() => {
    if (!pubkey) return;
    if (browserSubscription && browserPermission === "granted") {
      void syncBrowserRegistration(browserSubscription, browserPermission);
    }
  }, [browserPermission, browserSubscription, preferences, pubkey, syncBrowserRegistration]);

  React.useEffect(() => {
    if (!pubkey || !isNativeAndroid || !androidToken || nativePermission !== "granted") return;
    void registerNotificationTarget({
      platform: "android",
      pubkey,
      deviceId,
      token: androidToken,
      preferences,
      permissionState: nativePermission,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      registrationSecret,
    } satisfies AndroidNotificationRegistration)
      .then((response) => {
        persistSecret(response.registrationSecret);
        setPlatformStatus("enabled");
        setLastError(null);
      })
      .catch((error) => {
        setLastError(
          error instanceof Error ? error.message : "Unable to sync Android push settings.",
        );
        setPlatformStatus("error");
      });
  }, [
    androidToken,
    deviceId,
    isNativeAndroid,
    nativePermission,
    persistSecret,
    preferences,
    pubkey,
    registrationSecret,
  ]);

  const enableBrowserPush = React.useCallback(async () => {
    if (!supportsBrowserPush || !browserRegistration) {
      setPlatformStatus("unsupported");
      setLastError("This browser does not support standards-based push notifications.");
      return;
    }
    if (!pubkey) {
      setLastError("Create or connect an airline identity before enabling notifications.");
      return;
    }

    const env = import.meta as ImportMeta & { env?: Record<string, string | undefined> };
    const vapidKey = env.env?.VITE_WEB_PUSH_PUBLIC_KEY;
    if (!vapidKey) {
      setPlatformStatus("error");
      setLastError(
        "Missing VITE_WEB_PUSH_PUBLIC_KEY. Add your public VAPID key to enable browser push.",
      );
      return;
    }

    setPlatformStatus("registering");
    setLastError(null);
    setSoftAskDismissed(true);

    const permission = await Notification.requestPermission();
    setBrowserPermission(permission);
    if (permission !== "granted") {
      setPlatformStatus(permission === "denied" ? "disabled" : "idle");
      return;
    }

    const subscription = await browserRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(vapidKey),
    });
    const subscriptionJson = subscription.toJSON();
    setBrowserSubscription(subscriptionJson);
    await syncBrowserRegistration(subscriptionJson, permission);
  }, [
    browserRegistration,
    pubkey,
    setSoftAskDismissed,
    supportsBrowserPush,
    syncBrowserRegistration,
  ]);

  const enableNativePush = React.useCallback(async () => {
    if (!isNativeAndroid) return;
    if (!pubkey) {
      setLastError("Create or connect an airline identity before enabling notifications.");
      return;
    }

    setPlatformStatus("registering");
    setLastError(null);
    const permission = await PushNotifications.requestPermissions();
    setNativePermission(permission.receive);
    if (permission.receive !== "granted") {
      setPlatformStatus("disabled");
      return;
    }

    for (const channel of ANDROID_CHANNELS) {
      await PushNotifications.createChannel({
        id: channel.id,
        name: channel.name,
        description: channel.description,
        importance: channel.importance,
        visibility: 1,
      });
    }

    await PushNotifications.register();
  }, [isNativeAndroid, pubkey]);

  const disablePush = React.useCallback(async () => {
    if (!pubkey) return;

    try {
      if (supportsBrowserPush && browserRegistration) {
        const existingSubscription = await browserRegistration.pushManager.getSubscription();
        if (existingSubscription) {
          await existingSubscription.unsubscribe();
          setBrowserSubscription(null);
        }
      }
      if (isNativeAndroid) {
        await PushNotifications.unregister();
        setAndroidToken(null);
      }
      await unregisterNotificationTarget({
        deviceId,
        platform: isNativeAndroid ? "android" : "browser",
        pubkey,
        registrationSecret,
      });
    } catch (error) {
      setLastError(
        error instanceof Error ? error.message : "Unable to disable push notifications.",
      );
      setPlatformStatus("error");
      return;
    }

    persistSecret(null);
    setPlatformStatus("disabled");
  }, [
    browserRegistration,
    deviceId,
    isNativeAndroid,
    persistSecret,
    pubkey,
    registrationSecret,
    supportsBrowserPush,
  ]);

  const dispatchNotificationCandidate = React.useCallback(
    async (payload: NotificationPayload) => {
      if (!registrationSecret) return;
      if (!shouldDeliverNotification(preferences, payload)) return;
      try {
        await sendNotificationCandidate({
          registrationSecret,
          includeSource: document.visibilityState !== "visible",
          notification: payload,
        });
      } catch (error) {
        console.warn("[notifications] Failed to forward notification candidate", error);
      }
    },
    [preferences, registrationSecret],
  );

  const sendTestNotification = React.useCallback(async () => {
    if (!registrationSecret) {
      setLastError("Enable push notifications on this device before sending a test notification.");
      return;
    }
    await sendNotificationCandidate({
      registrationSecret,
      includeSource: true,
      notification: buildTestNotification(),
    });
    toast.success("Test notification queued", {
      description: "If delivery is configured, this device should receive a push shortly.",
    });
  }, [registrationSecret]);

  const value = React.useMemo<NotificationContextValue>(
    () => ({
      pubkey,
      deviceId,
      preferences,
      registrationSecret,
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
      dispatchNotificationCandidate,
    }),
    [
      browserPermission,
      deviceId,
      disablePush,
      dispatchNotificationCandidate,
      enableBrowserPush,
      enableNativePush,
      isNativeAndroid,
      lastError,
      nativePermission,
      platformStatus,
      preferences,
      pubkey,
      registrationSecret,
      sendTestNotification,
      setSoftAskDismissed,
      softAskDismissed,
      supportsBrowserPush,
    ],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
