/* SkalaUp service worker — PWA installability + web push (R13). */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Minimal passthrough fetch handler — its presence satisfies installability
// without altering any request/response behaviour.
self.addEventListener("fetch", () => {});

// Web push: render the notification the server sent.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "SkalaUp", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "SkalaUp";
  const options = {
    body: data.body || "",
    icon: "/favicon.png",
    badge: "/favicon.png",
    tag: data.tag,
    data: { url: data.url || "/notifications" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an existing tab (navigating it) or open a new one on click.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          try { await client.navigate(url); } catch { /* cross-origin/navigation blocked */ }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    })(),
  );
});
