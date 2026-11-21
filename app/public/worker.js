// Runs in the background of each tab: this tab's connection to the browser's copy of the data,
// the shared core working on it, and syncing with the server the page came from.
import sqlite3InitModule from '/node_modules/@sqlite.org/sqlite-wasm/dist/index.mjs';
import { Sutra } from '/core/index.js';
import { openBrowserDb } from './browser-db.js';

// Actions that change data: each is recorded so it can be undone, and is followed by a sync.
const ACTIONS = ['createCard', 'edit', 'complete', 'uncomplete', 'addToList', 'move', 'removeFromList',
  'addSublist', 'renameSublist', 'removeSublist', 'moveSublist', 'tag', 'untag', 'relate', 'unrelate', 'trash', 'restore', 'settle'];
const READS = ['card', 'list', 'memberships', 'wouldOrphan', 'conflictsFor', 'pendingCount', 'headings', 'query'];
const RECENT = 150;

let sutra;
let method;
let online = false;
let syncTimer;
const channel = new BroadcastChannel('sutra');

async function post(path, body) {
  const response = await fetch(`/api/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sutra': '1' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Server said ${response.status}`);
  return response.json();
}

const server = {
  receive: (changes) => post('push', { changes }),
  serve: (request) => post('pull', request),
  fetch: (rows) => post('fetch', { rows }),
};

function announce() {
  channel.postMessage('changed');
  self.postMessage({ event: 'changed' });
}

// One tab syncs at a time; the others see the result through the shared database.
async function sync({ wait = false } = {}) {
  await navigator.locks.request('sutra-sync', wait ? {} : { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    try {
      await sutra.sync(server);
      online = true;
    } catch (err) {
      online = false;
    }
  });
  announce();
}

function syncSoon() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 600);
}

// The cards this copy has asked to keep: Home, the bar, and the most recently opened.
function remember(ids) {
  const recent = JSON.parse(sutra.meta('recent') || '[]').filter((id) => !ids.includes(id));
  recent.unshift(...ids);
  recent.splice(RECENT).forEach((id) => sutra.release(id));
  sutra.meta('recent', JSON.stringify(recent));
  ids.forEach((id) => sutra.hold(id));
}

const OPS = {
  async start() {
    const db = await openBrowserDb(sqlite3InitModule, 'sutra');
    method = db.method;
    const made = db.get("SELECT name FROM sqlite_master WHERE name = 'meta'");
    let device = made && db.get("SELECT value FROM meta WHERE key = 'device'");
    device = device ? device.value : `pwa-${crypto.randomUUID().slice(0, 8)}`;
    sutra = new Sutra(db, { device, partial: true });
    sutra.meta('device', device);
    sutra.headings = () => sutra.db.all("SELECT DISTINCT heading FROM sublist WHERE heading LIKE '#%' AND removed = 0 ORDER BY heading").map((r) => r.heading);
    ['home', 'quick'].forEach((id) => sutra.hold(id));
    sync({ wait: true });
    setInterval(sync, 30000);
    self.addEventListener('online', () => sync());
    return OPS.status();
  },
  // This copy's state, and its server's: whether that server has a hub, and what it holds for it.
  async status() {
    let server = null;
    let signedOut = false;
    try {
      const response = await fetch('/api/status', { headers: { 'X-Sutra': '1' }, signal: AbortSignal.timeout(2500) });
      if (response.ok) server = await response.json();
      signedOut = response.status === 401; // a hub that wants this browser to sign in again
    } catch (err) {
      server = null;
    }
    return { online, waiting: sutra.pendingCount(), method, device: sutra.device, server, signedOut };
  },
  // Opening cards this copy may not hold yet: ask to keep them, then fetch.
  async open({ ids }) {
    remember(ids.filter((id) => !['home', 'quick'].includes(id)));
    await sync({ wait: true });
  },
  // Over everything when the server can be reached; over what is held here when it cannot.
  async search({ text, limit = 100 }) {
    try {
      const found = await post('search', { text, limit });
      online = true;
      return found;
    } catch (err) {
      online = false;
      return sutra.search(text).slice(0, limit).map((id) => sutra.card(id)).filter(Boolean);
    }
  },
  revert({ undo }) {
    sutra.revert(undo);
    announce();
    syncSoon();
  },
  sync: () => sync({ wait: true }),
};

self.onmessage = async (event) => {
  const { id, op, args } = event.data;
  try {
    let reply;
    if (OPS[op]) {
      reply = { result: await OPS[op](args || {}) };
    } else if (op === 'batch') {
      // Several actions as one step, so that one undo puts them all back.
      args.forEach(([name]) => { if (!ACTIONS.includes(name)) throw new Error(`No such action: ${name}`); });
      reply = sutra.record(() => args.map(([name, ...rest]) => sutra[name](...rest)));
      announce();
      syncSoon();
    } else if (ACTIONS.includes(op)) {
      reply = sutra.record(() => sutra[op](...args));
      announce();
      syncSoon();
    } else if (READS.includes(op)) {
      reply = { result: sutra[op](...args) };
    } else {
      throw new Error(`No such operation: ${op}`);
    }
    self.postMessage({ id, ...reply });
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
