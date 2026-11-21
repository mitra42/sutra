// Pretend devices: a hub, laptops and PWAs in one process, each with its own in-memory database.
import { openNodeDb } from '../core/node-db.js';
import { Sutra } from '../core/index.js';

let tick = 0;
// Every call is one second later, so "later" in a test is unambiguous.
export function clock() {
  tick += 1;
  return new Date(Date.UTC(2026, 10, 15, 9, 0, tick));
}

export function device(name, options = {}) {
  return new Sutra(openNodeDb(), { device: name, now: clock, ...options });
}

// hub <- laptop (full copy) <- laptopPwa (partial);  hub <- phone (partial)
export function world() {
  return {
    hub: device('hub', { role: 'hub' }),
    laptop: device('laptop'),
    laptopPwa: device('laptop-pwa', { partial: true }),
    phone: device('phone', { partial: true }),
  };
}

// The copy above, with the reply to a push going missing when told to.
export function flaky(upstream) {
  const link = {
    loseNextReply: false,
    receive: async (changes) => {
      const acks = upstream.receive(changes);
      if (link.loseNextReply) {
        link.loseNextReply = false;
        throw new Error('reply lost');
      }
      return acks;
    },
    serve: async (request) => upstream.serve(request),
    fetch: async (rows) => upstream.fetch(rows),
  };
  return link;
}

export async function syncAll(w, rounds = 3) {
  for (let i = 0; i < rounds; i += 1) {
    await w.laptopPwa.sync(w.laptop);
    await w.laptop.sync(w.hub);
    await w.phone.sync(w.hub);
    await w.laptopPwa.sync(w.laptop);
  }
}

const TABLES = ['card', 'sublist', 'membership', 'conflict'];

export function dump(replica) {
  const out = {};
  TABLES.forEach((tbl) => {
    out[tbl] = replica.db.all(`SELECT * FROM ${tbl} ORDER BY id`).map((r) => ({ ...r }));
  });
  return out;
}

// The rows a partial copy holds, beside the same rows on the hub.
export function heldVersusHub(partial, hub) {
  const mine = {};
  const theirs = {};
  TABLES.forEach((tbl) => {
    const ids = partial.db.all('SELECT id FROM held WHERE tbl = ? ORDER BY id', [tbl]).map((h) => h.id);
    mine[tbl] = ids.map((id) => ({ ...partial.db.get(`SELECT * FROM ${tbl} WHERE id = ?`, [id]) }));
    theirs[tbl] = ids.map((id) => ({ ...hub.db.get(`SELECT * FROM ${tbl} WHERE id = ?`, [id]) }));
  });
  return { mine, theirs };
}

// A small repeatable random-number source, so a failing run can be run again exactly.
export function random(seed) {
  let s = seed;
  const next = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.chance = (p) => next() < p;
  return next;
}
