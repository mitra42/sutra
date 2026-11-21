// Runs SQLite off the main thread. One of these per tab.
import sqlite3InitModule from './sqlite/index.mjs';

let sqlite3;
let db;
let method;

// Each storage method keeps its own file, so trying one never disturbs another's data.
const METHODS = {
  // Several tabs can share it. Needs the two isolation headers.
  opfs: async () => {
    if (!sqlite3.oo1.OpfsDb) throw new Error('not offered by this browser, or the isolation headers are missing');
    return new sqlite3.oo1.OpfsDb('/sutra-test-opfs.db');
  },
  // A newer variant of the same, co-ordinating tabs with Web Locks.
  'opfs-wl': async () => {
    if (!sqlite3.oo1.OpfsWlDb) throw new Error('not offered by this browser, or the isolation headers are missing');
    return new sqlite3.oo1.OpfsWlDb('/sutra-test-opfs-wl.db');
  },
  // One tab at a time. Needs no headers.
  sahpool: async () => {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'sutra-test-sahpool' });
    return new pool.OpfsSAHPoolDb('/sutra-test-sahpool.db');
  },
};

async function open(wanted) {
  if (!sqlite3) sqlite3 = await sqlite3InitModule();
  const order = wanted === 'auto' ? ['opfs', 'opfs-wl', 'sahpool'] : [wanted];
  const failures = [];
  for (const name of order) {
    try {
      db = await METHODS[name]();
      method = name;
      break;
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
    }
  }
  if (!db) throw new Error(`No storage method worked. ${failures.join('; ')}`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS visits (at TEXT, installed INTEGER);
    CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT, at TEXT);
    INSERT OR IGNORE INTO meta VALUES ('created', datetime('now'));
  `);
  // The app's queries rely on supplying REGEXP ourselves; this proves the browser build allows it.
  db.createFunction({
    name: 'regexp',
    arity: 2,
    deterministic: true,
    xFunc: (ctx, pattern, text) => {
      const subject = text === null ? '' : String(text);
      try {
        return new RegExp(pattern, 'i').test(subject) ? 1 : 0;
      } catch (err) {
        // Not a valid regular expression (such as "C++"): look for it as plain text instead.
        return subject.toLowerCase().includes(String(pattern).toLowerCase()) ? 1 : 0;
      }
    },
  });
  return { method, failures };
}

function rows(sql, bind) {
  return db.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' });
}

const OPS = {
  open: ({ wanted }) => open(wanted),
  visit: ({ installed }) => {
    db.exec({ sql: "INSERT INTO visits VALUES (datetime('now'), ?)", bind: [installed ? 1 : 0] });
  },
  add: ({ text }) => {
    db.exec({ sql: "INSERT INTO notes (text, at) VALUES (?, datetime('now'))", bind: [text] });
  },
  state: () => ({
    method,
    sqliteVersion: sqlite3.version.libVersion,
    created: rows("SELECT value FROM meta WHERE key = 'created'")[0].value,
    visitCount: rows('SELECT count(*) AS n FROM visits')[0].n,
    visits: rows('SELECT at, installed FROM visits ORDER BY at DESC LIMIT 8'),
    noteCount: rows('SELECT count(*) AS n FROM notes')[0].n,
    notes: rows('SELECT id, text, at FROM notes ORDER BY id DESC LIMIT 10'),
  }),
  search: ({ pattern }) => rows('SELECT id, text, at FROM notes WHERE text REGEXP ? ORDER BY id DESC LIMIT 20', [pattern]),
};

self.onmessage = async (event) => {
  const { id, op, args } = event.data;
  try {
    self.postMessage({ id, result: await OPS[op](args || {}) });
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
