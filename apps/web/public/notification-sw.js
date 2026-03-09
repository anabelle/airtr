self.SAFE_NOTIFICATION_PATH_PREFIXES = [
  "/corporate",
  "/network",
  "/fleet",
  "/airport/",
  "/aircraft/",
];

function getSafeNotificationUrl(input) {
  const fallback = new URL("/corporate#notifications", self.location.origin);
  if (typeof input !== "string" || input.trim() === "") {
    return fallback.toString();
  }

  try {
    const parsed = new URL(input, self.location.origin);
    if (parsed.origin !== self.location.origin) {
      return fallback.toString();
    }
    if (
      !self.SAFE_NOTIFICATION_PATH_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))
    ) {
      return fallback.toString();
    }
    return parsed.toString();
  } catch {
    return fallback.toString();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "ACARS notification", body: event.data.text() };
  }

  const title = typeof payload.title === "string" ? payload.title : "ACARS notification";
  const body = typeof payload.body === "string" ? payload.body : "Open ACARS for details.";
  const tag = typeof payload.tag === "string" ? payload.tag : "acars-notification";
  const url = getSafeNotificationUrl(payload.url);
  const data = {
    url,
    notificationId: typeof payload.id === "string" ? payload.id : undefined,
    category: typeof payload.category === "string" ? payload.category : undefined,
  };

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: false,
      badge: "/icons/icon-192.png",
      icon: "/icons/icon-192.png",
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = getSafeNotificationUrl(event.notification.data?.url);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      let bestClient = null;
      for (const client of clients) {
        if (!client.url.startsWith(self.location.origin)) continue;
        if (client.url === targetUrl || client.url.includes("/corporate")) {
          bestClient = client;
          break;
        }
        if (!bestClient || client.visibilityState === "visible") {
          bestClient = client;
        }
      }

      if (bestClient && "navigate" in bestClient && "focus" in bestClient) {
        try {
          await bestClient.navigate(targetUrl);
          return await bestClient.focus();
        } catch {
          return self.clients.openWindow?.(targetUrl);
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
