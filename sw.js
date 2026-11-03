// Procedure Scribe service worker. Caches only the app's own code (page, vendor libraries, fonts)
// so the app opens and transcribes offline. It never sees or stores user media or text: files are
// read locally by the page, and model weights are cached separately by Transformers.js.
const CACHE = 'procedure-scribe-v1.0.0';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'index.html'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('procedure-scribe-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  const rel = url.pathname.slice(scope.pathname.length);
  if (rel.startsWith('models/') || rel.startsWith('spikes/') || rel.startsWith('tests/')) return;
  if (rel.startsWith('vendor/') && !rel.endsWith('.json')) {
    // Pinned, hashed files: cache first.
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // Page and small JSON: network first (revalidated, so a new release shows up at once), cache as fallback.
  e.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req)));
});
