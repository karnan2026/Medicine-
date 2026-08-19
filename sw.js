// Minimal service worker for installability + a basic offline shell.
// Forum content itself always comes from the network (Supabase) —
// this only caches the static files that make up the app's shell,
// so bump CACHE_NAME whenever any cached file changes, or returning
// visitors will keep seeing the old cached version.
const CACHE_NAME = "medicine-shell-v7";
const SHELL_FILES = [
  "style.css",
  "supabase-client.js?v=2",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle our own same-origin static files. Everything else —
  // Supabase API calls, the Supabase JS CDN script, Google fonts —
  // goes straight to the network untouched.
  if (url.origin !== self.location.origin) return;

  const isShellFile = SHELL_FILES.some((f) => url.pathname.endsWith(f.split("?")[0]));
  if (!isShellFile) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => cached);
      // Serve cache immediately if we have it, refresh in the background.
      return cached || networkFetch;
    })
  );
});
