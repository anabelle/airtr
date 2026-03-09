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
  const url = typeof payload.url === "string" ? payload.url : "/corporate#notifications";
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
  const relativeUrl =
    typeof event.notification.data?.url === "string"
      ? event.notification.data.url
      : "/corporate#notifications";
  const targetUrl = new URL(relativeUrl, self.location.origin).toString();

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client && client.url.startsWith(self.location.origin)) {
          return client.navigate(targetUrl).then(() => client.focus());
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
