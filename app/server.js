#!/usr/bin/env node
// Sutra's server, in one of two roles.
//  - "node" (the default): the laptop's local server. It listens only to the laptop itself, holds a
//    full copy of the data, serves the front end, and passes changes up to the hub when it has one.
//  - "hub": the copy everything syncs with. It numbers changes and judges conflicts. It is meant for
//    the VM; until then it can be run on the laptop as a second copy of this program, for testing.
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openNodeDb } from './core/node-db.js';
import { Sutra } from './core/index.js';
import { makeAuth } from './auth.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

// How a node reaches its hub: the same three calls a PWA makes of its server, with the hub's key.
function linkTo(url, key) {
  const post = async (name, body) => {
    const response = await fetch(`${url.replace(/\/$/, '')}/api/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body),
    });
    if (response.status === 403) throw new Error('The hub refused the key: check hubKey against the key the hub printed');
    if (!response.ok) throw new Error(`The hub said ${response.status}`);
    return response.json();
  };
  return {
    receive: (changes) => post('push', { changes }),
    serve: (request) => post('pull', request),
    fetch: (rows) => post('fetch', { rows }),
  };
}

export function createServer({
  port = 8470, dataDir = path.join(dir, 'data'), role = 'node', hubUrl, hubKey, syncSeconds = 30, purgeDays = 7, keepBackups = 21,
} = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openNodeDb(path.join(dataDir, 'sutra.db'));
  db.exec('PRAGMA journal_mode = WAL');

  // Every copy needs a name of its own: the hub tells devices apart by it when judging conflicts.
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value)');
  let device = db.get("SELECT value FROM meta WHERE key = 'device'");
  device = device ? device.value : `${role === 'hub' ? 'hub' : os.hostname()}-${crypto.randomBytes(3).toString('hex')}`;
  const sutra = new Sutra(db, { device, role });
  sutra.meta('device', device);

  // The hub's key: what a laptop's server must present. Made once and kept beside the database.
  let key = null;
  if (role === 'hub') {
    const keyFile = path.join(dataDir, 'hub-key.txt');
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, `${crypto.randomBytes(24).toString('hex')}\n`, { mode: 0o600 });
    key = fs.readFileSync(keyFile, 'utf8').trim();
  }

  // A node with a hub: send up what is waiting, fetch what is new. Never two at once.
  const hub = role === 'node' && hubUrl ? { link: linkTo(hubUrl, hubKey), url: hubUrl, online: false, last: null, error: null } : null;
  let syncing = false;
  let soon = null;
  async function syncUp() {
    if (!hub || syncing) return;
    syncing = true;
    try {
      await sutra.sync(hub.link);
      hub.online = true;
      hub.last = new Date().toISOString();
      hub.error = null;
    } catch (err) {
      hub.online = false;
      hub.error = err.message;
    } finally {
      syncing = false;
    }
  }
  const syncSoon = () => {
    clearTimeout(soon);
    soon = setTimeout(syncUp, 400);
  };
  // A dated copy of the database, once a day, keeping the last `keepBackups`. VACUUM INTO writes a
  // complete, consistent copy while the server carries on.
  function backup() {
    const folder = path.join(dataDir, 'backups');
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `sutra-${new Date().toISOString().slice(0, 10)}.db`);
    if (!fs.existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const old = fs.readdirSync(folder).filter((f) => /^sutra-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -keepBackups);
    old.forEach((f) => fs.rmSync(path.join(folder, f)));
    return file;
  }

  const timers = [];
  // Started by whoever runs the server, so that tests can sync by hand instead.
  function startTimers() {
    if (hub) {
      syncUp();
      timers.push(setInterval(syncUp, syncSeconds * 1000));
    }
    if (role === 'hub') {
      const purge = () => sutra.purge(purgeDays);
      purge();
      timers.push(setInterval(purge, 6 * 3600 * 1000));
    }
    const daily = () => { try { backup(); } catch (err) { console.error('Backup failed:', err.message); } };
    daily();
    timers.push(setInterval(daily, 6 * 3600 * 1000));
  }
  function stopTimers() {
    timers.forEach(clearInterval);
    clearTimeout(soon);
  }

  // The built-in cards start at the bottom of the quick-access bar, once. After that they are
  // ordinary entries there and can be moved or removed.
  if (!sutra.meta('seeded')) {
    ['tags', 'conflicts', 'orphans', 'trash'].forEach((id) => sutra.addToList('quick', id));
    sutra.meta('seeded', 1);
  }

  const app = express();
  app.use((req, res, next) => {
    // These two let several tabs share one database in the browser (plan section 8).
    res.set('Cross-Origin-Opener-Policy', 'same-origin');
    res.set('Cross-Origin-Embedder-Policy', 'require-corp');
    // Always revalidate, so editing a file and reloading shows the change.
    res.set('Cache-Control', 'no-cache');
    next();
  });

  // The laptop's server has no login, so its API answers only its own front end. Without this, any
  // web page open in the browser could talk to it. The hub can be reached from elsewhere, so there a
  // browser must have signed in (auth.js). Either also answers a server that presents the hub key.
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
  const login = role === 'hub' ? makeAuth(dataDir) : null;
  // On the VM the hub sits behind Apache, which says whether the browser used https.
  app.set('trust proxy', 'loopback');
  const api = express.Router();
  api.use((req, res, next) => {
    const origin = req.headers.origin;
    const fromNode = key && req.headers.authorization === `Bearer ${key}`;
    let fromFrontEnd;
    if (login) {
      fromFrontEnd = req.headers['x-sutra'] === '1' && (!origin || origin === login.site(req).origin) && !!login.session(req);
    } else {
      const ours = hosts.includes(req.headers.host) && (!origin || hosts.some((h) => origin === `http://${h}`));
      fromFrontEnd = ours && req.headers['x-sutra'] === '1';
    }
    if (!fromFrontEnd && !fromNode) {
      const signedOut = login && req.headers['x-sutra'] === '1' && !login.session(req);
      res.status(signedOut ? 401 : 403).json({ error: signedOut ? 'Sign in first' : 'Not from the Sutra front end' });
      return;
    }
    next();
  });
  api.use(express.json({ limit: '20mb' }));

  api.post('/push', (req, res) => {
    res.json(sutra.receive(req.body.changes || []));
    syncSoon();
  });
  api.post('/pull', (req, res) => res.json(sutra.serve(req.body)));
  api.post('/fetch', (req, res) => res.json(sutra.fetch(req.body.rows || {})));
  // Search over everything, for a PWA that holds only part.
  api.post('/search', (req, res) => {
    const ids = sutra.search(String(req.body.text || '')).slice(0, Number(req.body.limit) || 100);
    res.json(ids.map((id) => {
      const c = sutra.db.get("SELECT id, type, title, completed, trashed, due, overdue, repeat, note <> '' AS hasNote FROM card WHERE id = ?", [id]);
      return { ...c };
    }));
  });
  // Reading and acting on the full copy directly, for the MCP server (and so for an AI tool).
  // Every action goes through the shared core exactly as a tap on the screen does, so it syncs,
  // can conflict, and can be undone by hand like anyone's. Its changes carry the name given in "as".
  const READS = ['card', 'list', 'memberships', 'search', 'query', 'conflictsFor', 'wouldOrphan'];
  const ACTS = ['createCard', 'edit', 'complete', 'uncomplete', 'addToList', 'removeFromList', 'addSublist', 'moveSublist', 'renameSublist', 'removeSublist',
    'tag', 'untag', 'relate', 'unrelate', 'trash', 'restore'];
  api.post('/read', (req, res) => {
    const { op, args = [] } = req.body;
    if (!READS.includes(op)) throw new Error(`Not something that can be read: ${op}`);
    const result = sutra[op](...args);
    res.json({ result: result === undefined ? null : result });
  });
  api.post('/act', (req, res) => {
    const { op, args = [], as } = req.body;
    if (!ACTS.includes(op)) throw new Error(`Not an action: ${op}`);
    const own = sutra.device;
    if (as) sutra.device = `${String(as).replace(/[^a-z0-9-]/gi, '')}@${own}`;
    let result;
    try {
      result = sutra[op](...args);
    } finally {
      sutra.device = own;
    }
    syncSoon();
    res.json({ result: result === undefined ? null : result });
  });

  api.get('/status', (req, res) => res.json({
    device: sutra.device,
    role,
    waiting: sutra.pendingCount(),
    hub: hub ? { url: hub.url, online: hub.online, last: hub.last, error: hub.error } : null,
  }));
  api.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err);
    res.status(500).json({ error: err.message });
  });
  app.use('/api', api);

  // On the hub, everything but the sign-in page and what it needs is for signed-in browsers only.
  if (login) {
    app.use('/auth', login.router);
    const open = ['/login.html', '/login.js', '/sutra.css', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest', '/favicon.ico'];
    app.use((req, res, next) => {
      if (open.includes(req.path) || req.path.startsWith('/node_modules/@simplewebauthn/browser/') || login.session(req)) { next(); return; }
      if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
        res.redirect(`/login.html?then=${encodeURIComponent(req.originalUrl)}`);
        return;
      }
      res.status(401).send('Sign in first');
    });
  }

  // No build step: the browser loads the shared core, the libraries and the front end as they are.
  app.use('/core', express.static(path.join(dir, 'core')));
  app.use('/vendor', express.static(path.join(dir, 'vendor')));
  app.use('/node_modules', express.static(path.join(dir, 'node_modules')));
  app.use(express.static(path.join(dir, 'public')));

  return { app, sutra, port, role, key, syncUp, startTimers, stopTimers, backup };
}

// Run directly (not imported by a test): read the settings, start listening on this machine only.
// Settings come from the environment, or from config.json in the data folder:
//   { "hubUrl": "http://localhost:8471", "hubKey": "..." }
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const role = env.SUTRA_ROLE === 'hub' ? 'hub' : 'node';
  const dataDir = env.SUTRA_DATA || path.join(dir, role === 'hub' ? 'data-hub' : 'data');
  const configFile = path.join(dataDir, 'config.json');
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
  const port = Number(env.SUTRA_PORT) || config.port || (role === 'hub' ? 8471 : 8470);
  const server = createServer({
    port,
    dataDir,
    role,
    hubUrl: env.SUTRA_HUB || config.hubUrl,
    hubKey: env.SUTRA_HUB_KEY || config.hubKey,
    syncSeconds: Number(env.SUTRA_SYNC_SECONDS) || config.syncSeconds || 30,
    purgeDays: Number(env.SUTRA_PURGE_DAYS) || config.purgeDays || 7,
  });
  server.app.listen(port, '127.0.0.1', () => {
    console.log(`Sutra ${role}: http://localhost:${port}/   data: ${dataDir}`);
    if (role === 'hub') console.log(`Key for a laptop's server to use: ${server.key}`);
    server.startTimers();
  });
}
