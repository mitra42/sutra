// Keeps a copy of the test pages so they open with no connection.
const CACHE = 'sutra-stage0-v2';
const REPORT = './sw-report.json';
const SHELL = [
  './', './index.html', './db.html', './passkey.html', './style.css', './common.js', './index.js',
  './db.js', './db-worker.js', './passkey.js', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './sqlite/index.mjs', './sqlite/sqlite3.wasm', './sqlite/sqlite3-opfs-async-proxy.js',
];

// A copy handed back with the address that was asked for and no trace of any redirect. Safari refuses
// a redirected copy for a page, and SQLite's helper worker reads a setting from its own address.
function clean(response) {
  return new Response(response.body, { status: response.status, headers: response.headers });
}

// Each file is fetched on its own, so one failure cannot stop the rest being stored, and the outcome
// is written down where the Start page can show it.
async function storeShell() {
  const cache = await caches.open(CACHE);
  const files = [];
  for (const url of SHELL) {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error(`status ${response.status}`);
      await cache.put(url, response);
      files.push({ url, ok: true });
    } catch (err) {
      files.push({ url, ok: false, error: err.message || String(err) });
    }
  }
  const report = { at: new Date().toISOString(), cache: CACHE, files };
  await cache.put(REPORT, new Response(JSON.stringify(report), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(storeShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('sutra-stage0-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const stored = () => cache.match(event.request, { ignoreSearch: true });
    // Known to be offline: answer from the copy without touching the network. On an iPhone in
    // aeroplane mode, trying the network first is what brings up the system's "turn off aeroplane
    // mode" alert.
    if (!self.navigator.onLine) {
      const cached = await stored();
      if (cached) return clean(cached);
    }
    // Otherwise network first, so an edited file shows up on reload.
    try {
      const response = await fetch(event.request);
      if (response.ok && !event.request.url.endsWith('sw-report.json')) cache.put(event.request, response.clone());
      return response;
    } catch (err) {
      const cached = await stored();
      if (!cached) throw err;
      return clean(cached);
    }
  })());
});
