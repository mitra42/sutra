// Keeps a copy of the app's own files so it opens with the server stopped or no connection.
// The rules come from the stage 0 tests (plan section 12): store each file separately, name every
// file, use the copy without touching the network when offline, and keep a note of what was stored.
const CACHE = 'sutra-shell-v4';
const REPORT = './sw-report.json';
const SHELL = [
  './index.html', './sutra.css', './app.js', './ui.js', './store.js', './worker.js', './browser-db.js',
  './bar.js', './list.js', './card.js', './editor.js', './live-markdown.js', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  '/core/index.js', '/core/sutra.js', '/core/replica.js', '/core/schema.js', '/core/query.js', '/core/positions.js', '/core/repeat.js',
  '/vendor/codemirror.js', '/node_modules/html-element-extended/htmlelementextended.js',
  '/node_modules/@sqlite.org/sqlite-wasm/dist/index.mjs', '/node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm',
  '/node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3-opfs-async-proxy.js',
];

function clean(response) {
  return new Response(response.body, { status: response.status, headers: response.headers });
}

async function storeShell() {
  const cache = await caches.open(CACHE);
  const files = [];
  for (const url of SHELL) {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok || response.redirected) throw new Error(response.redirected ? 'sent to the sign-in page' : `status ${response.status}`);
      await cache.put(url, response);
      files.push({ url, ok: true });
    } catch (err) {
      files.push({ url, ok: false, error: err.message || String(err) });
    }
  }
  await cache.put(REPORT, new Response(JSON.stringify({ at: new Date().toISOString(), files }), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('install', (event) => event.waitUntil(storeShell().then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // The data API is never answered from a copy: the worker handles being offline itself.
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const wanted = url.pathname === '/' ? new Request('./index.html') : event.request;
    const stored = () => cache.match(wanted, { ignoreSearch: true });
    if (!self.navigator.onLine) {
      const cached = await stored();
      if (cached) return clean(cached);
    }
    // Network first, so an edited file shows on reload; the copy is for when the server is not there.
    try {
      const response = await fetch(event.request);
      // (Not a sign-in page given in place of the file asked for.)
      if (response.ok && !response.redirected) cache.put(wanted, response.clone());
      return response;
    } catch (err) {
      const cached = await stored();
      if (!cached) throw err;
      return clean(cached);
    }
  })());
});
