// Rently service worker: exists only to satisfy browser "installable app"
// criteria (Chrome/Edge require a registered service worker with a fetch
// handler before showing the install prompt). It deliberately does no
// caching: this app's data comes live from Supabase, and caching the HTML
// shell risks showing a stale build after a deploy. Every request just
// passes straight through to the network.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
