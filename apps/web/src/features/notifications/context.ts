import React from "react";
import type { NotificationPayload } from "./domain";
import type { NotificationPreferences } from "./preferences";

type PlatformStatus = "unsupported" | "idle" | "registering" | "enabled" | "disabled" | "error";

export interface NotificationContextValue {
  pubkey: string | null;
  deviceId: string;
  preferences: NotificationPreferences;
  registrationSecret: string | null;
  platformStatus: PlatformStatus;
  lastError: string | null;
  browserPermission: NotificationPermission | "unsupported";
  nativePermission: string;
  supportsBrowserPush: boolean;
  supportsNativePush: boolean;
  isNativeAndroid: boolean;
  softAskDismissed: boolean;
  setSoftAskDismissed: (dismissed: boolean) => void;
  setPreferences: React.Dispatch<React.SetStateAction<NotificationPreferences>>;
  enableBrowserPush: () => Promise<void>;
  enableNativePush: () => Promise<void>;
  disablePush: () => Promise<void>;
  sendTestNotification: () => Promise<void>;
  dispatchNotificationCandidate: (payload: NotificationPayload) => Promise<void>;
}

export const NotificationContext = React.createContext<NotificationContextValue | null>(null);

export function useNotificationSettings(): NotificationContextValue {
  const context = React.useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotificationSettings must be used within NotificationProvider");
  }
  return context;
}
