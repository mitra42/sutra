// One copy of the data: the hub, a laptop's local server, or a PWA. This file holds the two things
// every copy does: record changes, and sync them. What an action on screen means (complete a task,
// delete a card) is in actions.js.
//
// The rules, in brief (plan.md sections 4 and 5):
//  - Every edit is a change: table, row, field, new value, and the version it was based on.
//  - The hub numbers each change it accepts. A field's version is the number of its last change.
//  - A copy shows its own waiting changes; the hub alone judges conflicts.
import { FIELDS, SILENT, SCHEMA, SYSTEM_CARDS } from './schema.js';
import { installQueryFunctions, runQuery } from './query.js';

const NOTE_SEPARATOR = '\n\n---- conflicting version ----\n\n';
const SYSTEM_CREATED = '2026-01-01T00:00:00.000Z';

function sameValue(a, b) {
  return (a === null || a === undefined) ? (b === null || b === undefined) : a === b;
}

export class Replica {
  // role: 'hub' numbers and judges changes; 'node' queues them for the copy above.
  // partial: holds only the offline set and what has been opened (the PWA).
  constructor(db, { device, role = 'node', partial = false, now = () => new Date() } = {}) {
    if (!device) throw new Error('A copy needs a device name');
    this.db = db;
    this.device = device;
    this.role = role;
    this.partial = partial;
    this.now = now;
    db.exec(SCHEMA);
    installQueryFunctions(db, (days) => this.today(days));
    db.transaction(() => {
      SYSTEM_CARDS.forEach((c) => {
        db.run(`INSERT OR IGNORE INTO card (id, type, title, query, sort, created, modified)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [c.id, c.type, c.title, c.query || null, c.sort || null, SYSTEM_CREATED, SYSTEM_CREATED]);
      });
    });
  }

  // ---- small helpers ----

  // This copy's own counter of writes. Read from the database every time, never remembered, because
  // in the browser several tabs share one database and each has its own copy of this object.
  get rev() {
    return this.meta('rev') || 0;
  }

  set rev(value) {
    this.meta('rev', value);
  }

  meta(key, value) {
    if (value === undefined) {
      const row = this.db.get('SELECT value FROM meta WHERE key = ?', [key]);
      return row ? row.value : null;
    }
    this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value]);
    return value;
  }

  newId() {
    return crypto.randomUUID();
  }

  stamp() {
    return this.now().toISOString();
  }

  // A plain date, by this device's own clock, `days` from today.
  today(days = 0) {
    const d = this.now();
    const local = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + days));
    return local.toISOString().slice(0, 10);
  }

  check(tbl, field) {
    if (!FIELDS[tbl] || !FIELDS[tbl].includes(field)) throw new Error(`Not a field that can be changed: ${tbl}.${field}`);
  }

  value(tbl, row, field) {
    this.check(tbl, field);
    const r = this.db.get(`SELECT ${field} AS v FROM ${tbl} WHERE id = ?`, [row]);
    return r ? r.v : null;
  }

  version(tbl, row, field) {
    const r = this.db.get('SELECT seq FROM version WHERE tbl = ? AND row = ? AND field = ?', [tbl, row, field]);
    return r ? r.seq : 0;
  }

  // The one place a field is written. A row comes into being the first time one of its fields is set.
  write(tbl, row, field, value, { seq, rev } = {}) {
    this.check(tbl, field);
    if (tbl === 'membership') {
      const bar = row.indexOf('|');
      this.db.run('INSERT OR IGNORE INTO membership (id, list_id, member_id) VALUES (?, ?, ?)', [row, row.slice(0, bar), row.slice(bar + 1)]);
    } else {
      this.db.run(`INSERT OR IGNORE INTO ${tbl} (id) VALUES (?)`, [row]);
    }
    this.db.run(`UPDATE ${tbl} SET ${field} = ? WHERE id = ?`, [value === undefined ? null : value, row]);
    const stamp = rev === undefined ? this.rev + 1 : rev;
    this.rev = Math.max(this.rev, stamp);
    this.db.run(`INSERT INTO version (tbl, row, field, seq, rev) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tbl, row, field) DO UPDATE SET seq = max(seq, excluded.seq), rev = excluded.rev`,
    [tbl, row, field, seq || 0, stamp]);
  }

  // ---- making a change here ----

  change(tbl, row, field, value) {
    this.check(tbl, field);
    const v = value === undefined ? null : value;
    const exists = this.db.get(`SELECT 1 AS x FROM ${tbl} WHERE id = ?`, [row]);
    if (exists && sameValue(this.value(tbl, row, field), v)) return;
    if (this.recording) this.recording.push({ tbl, row, field, existed: !!exists, before: exists ? this.value(tbl, row, field) : null });
    this.db.transaction(() => {
      const base = this.version(tbl, row, field);
      const c = { id: this.newId(), tbl, row, field, value: v, base, device: this.device, at: this.stamp() };
      if (this.role === 'hub') {
        this.accept(c);
      } else {
        this.write(tbl, row, field, v);
        this.queue(c);
      }
    });
  }

  // ---- undo ----
  // An action is run while noting what each field held before. Undoing it is making new changes
  // that put those values back, so an undo syncs and can conflict like any other edit.

  record(action) {
    this.recording = [];
    try {
      const result = this.db.transaction(action);
      return { result, undo: this.recording };
    } finally {
      this.recording = null;
    }
  }

  revert(undo) {
    const made = new Set(undo.filter((u) => !u.existed).map((u) => `${u.tbl} ${u.row}`));
    this.db.transaction(() => {
      [...undo].reverse().forEach((u) => {
        if (!made.has(`${u.tbl} ${u.row}`)) this.change(u.tbl, u.row, u.field, u.before);
      });
      // A row cannot be unmade, since other copies may already know of it. A card that the action
      // created goes to Trash; a membership or heading it created is marked removed.
      made.forEach((key) => {
        const [tbl, row] = [key.slice(0, key.indexOf(' ')), key.slice(key.indexOf(' ') + 1)];
        if (tbl === 'card') this.change('card', row, 'trashed', this.stamp());
        else if (tbl !== 'conflict') this.change(tbl, row, 'removed', 1);
      });
    });
  }

  // Several edits to one field, not yet sent, travel as one change carrying the first one's base.
  queue(c) {
    const waiting = this.db.get('SELECT n, base FROM pending WHERE tbl = ? AND row = ? AND field = ? AND device = ? AND sent = 0',
      [c.tbl, c.row, c.field, c.device]);
    let base = c.base;
    if (waiting) {
      base = waiting.base;
      this.db.run('DELETE FROM pending WHERE n = ?', [waiting.n]);
    }
    this.db.run('INSERT INTO pending (id, tbl, row, field, value, base, device, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [c.id, c.tbl, c.row, c.field, c.value, base, c.device, c.at]);
  }

  pendingCount() {
    return this.db.get('SELECT count(*) AS n FROM pending').n;
  }

  // ---- the hub: accepting a change ----

  accept(c) {
    this.check(c.tbl, c.field);
    const already = this.db.get('SELECT seq FROM log WHERE id = ?', [c.id]);
    if (already) return { id: c.id, seq: already.seq, rev: already.seq };

    const current = this.version(c.tbl, c.row, c.field);
    const standing = this.value(c.tbl, c.row, c.field);
    let value = c.value;
    let conflict = null;
    if (c.base !== current && !sameValue(standing, value)) {
      // A device that is merely behind on its own earlier edits has not clashed with anyone. Nor has
      // it clashed again with changes that its own last accepted edit already overrode: that clash
      // was recorded then. Only another device's change since both counts.
      const own = this.db.get('SELECT max(seq) AS seq FROM log WHERE tbl = ? AND row = ? AND field = ? AND device = ?',
        [c.tbl, c.row, c.field, c.device]).seq || 0;
      const others = this.db.get(`SELECT count(*) AS n FROM log
        WHERE tbl = ? AND row = ? AND field = ? AND seq > ? AND device <> ?`, [c.tbl, c.row, c.field, Math.max(c.base, own), c.device]).n;
      if (others > 0 && !SILENT[c.tbl].includes(c.field)) {
        if (c.tbl === 'card' && c.field === 'note') {
          // Both texts are kept in the Note; putting them back together is a job for a person.
          if (standing) value = `${standing}${NOTE_SEPARATOR}${value === null ? '' : value}`;
          conflict = { kind: 'note', other: null };
        } else {
          // The later change stands; the value it displaced waits in Conflicts.
          conflict = { kind: 'field', other: standing === null ? null : String(standing) };
        }
      }
    }

    const { lastInsertRowid } = this.db.run('INSERT INTO log (id, tbl, row, field, value, base, device, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [c.id, c.tbl, c.row, c.field, value, c.base, c.device, c.at]);
    const seq = Number(lastInsertRowid);
    this.write(c.tbl, c.row, c.field, value, { seq, rev: seq });

    if (conflict) {
      const id = this.newId();
      const entry = {
        card: this.cardOf(c.tbl, c.row), tbl: c.tbl, row: c.row, field: c.field, other: conflict.other, kind: conflict.kind, at: c.at, settled: 0,
      };
      Object.entries(entry).forEach(([field, v]) => {
        this.accept({ id: this.newId(), tbl: 'conflict', row: id, field, value: v, base: 0, device: 'hub', at: c.at });
      });
    }
    return { id: c.id, seq, rev: seq };
  }

  // Which card a row belongs to, for showing a conflict against it.
  cardOf(tbl, row) {
    if (tbl === 'card') return row;
    const r = this.db.get(`SELECT list_id FROM ${tbl} WHERE id = ?`, [row]);
    return r ? r.list_id : null;
  }

  // The hub's own housekeeping: cards trashed longer than `days` are emptied for good, leaving a
  // marker so every other copy empties them too.
  purge(days) {
    if (this.role !== 'hub') throw new Error('Only the hub purges');
    const cutoff = new Date(this.now().getTime() - days * 86400000).toISOString();
    const due = this.db.all('SELECT id FROM card WHERE trashed IS NOT NULL AND trashed < ? AND purged = 0', [cutoff]);
    this.db.transaction(() => {
      due.forEach(({ id }) => {
        this.change('card', id, 'title', '');
        this.change('card', id, 'note', '');
        this.change('card', id, 'purged', 1);
        this.db.all('SELECT id FROM membership WHERE (list_id = ? OR member_id = ?) AND removed = 0', [id, id])
          .forEach((m) => this.change('membership', m.id, 'removed', 1));
      });
    });
    return due.length;
  }

  // ---- taking in changes from a copy below ----

  receive(changes) {
    return this.db.transaction(() => changes.map((c) => {
      if (this.role === 'hub') return this.accept(c);
      // A laptop's local server standing between its PWA and the hub: apply, pass on, do not judge.
      const seen = this.db.get('SELECT rev FROM seen WHERE id = ?', [c.id]);
      if (seen) return { id: c.id, rev: seen.rev };
      this.write(c.tbl, c.row, c.field, c.value);
      this.queue(c);
      this.db.run('INSERT INTO seen (id, rev) VALUES (?, ?)', [c.id, this.rev]);
      return { id: c.id, rev: this.rev };
    }));
  }

  // ---- answering "what is new?" from a copy below ----

  items(versions) {
    const rows = new Map();
    return versions.map((v) => {
      const key = `${v.tbl} ${v.row}`;
      if (!rows.has(key)) rows.set(key, this.db.get(`SELECT * FROM ${v.tbl} WHERE id = ?`, [v.row]) || {});
      const value = rows.get(key)[v.field];
      return { tbl: v.tbl, row: v.row, field: v.field, value: value === undefined ? null : value, seq: v.seq, rev: v.rev };
    });
  }

  serve({ since = 0, partial = false, roots = [] } = {}) {
    const changed = this.db.all('SELECT tbl, row, field, seq, rev FROM version WHERE rev > ? ORDER BY rev', [since]);
    if (!partial) return { items: this.items(changed), upto: this.rev };
    const scope = this.scope(roots);
    const inScope = Object.fromEntries(Object.entries(scope.rows).map(([tbl, ids]) => [tbl, new Set(ids)]));
    return {
      items: this.items(changed.filter((v) => inScope[v.tbl].has(v.row))),
      upto: this.rev,
      rows: scope.rows,
      counts: scope.counts,
    };
  }

  // Every field of the rows asked for: how a partial copy picks up rows that have newly come into
  // its scope, however old they are.
  fetch(rows) {
    const versions = [];
    Object.entries(rows).forEach(([tbl, ids]) => {
      if (!FIELDS[tbl]) throw new Error(`No such table: ${tbl}`);
      ids.forEach((id) => versions.push(...this.db.all('SELECT tbl, row, field, seq, rev FROM version WHERE tbl = ? AND row = ?', [tbl, id])));
    });
    return { items: this.items(versions) };
  }

  // The ids a List shows: its members, or for a Dynamic card whatever its query finds.
  memberIds(cardId) {
    const card = this.db.get('SELECT type, query, sort FROM card WHERE id = ?', [cardId]);
    if (card && card.type === 'dynamic' && card.query) {
      try {
        return runQuery(this.db, card.query, { sort: card.sort });
      } catch (err) {
        return [];
      }
    }
    return this.db.all('SELECT member_id FROM membership WHERE list_id = ? AND removed = 0', [cardId]).map((m) => m.member_id);
  }

  // What a partial copy holds. A card marked offline brings its List and the Lists of the cards in
  // it (three levels of cards). A card the copy has merely opened brings its own List (two levels).
  // Every held card also brings the Lists it is in, so it can say where it belongs.
  scope(roots) {
    const depth = new Map();
    const visit = (id, d) => {
      if (depth.has(id) && depth.get(id) >= d) return;
      depth.set(id, d);
      if (d > 0) this.memberIds(id).forEach((m) => visit(m, d - 1));
    };
    this.db.all('SELECT id FROM card WHERE offline = 1 AND trashed IS NULL AND purged = 0').forEach(({ id }) => visit(id, 2));
    roots.forEach((id) => visit(id, 1));

    const cards = new Set(depth.keys());
    const memberships = new Set();
    const sublists = new Set();
    const counts = {};
    depth.forEach((d, id) => {
      if (d > 0) {
        this.db.all('SELECT id, sublist_id FROM membership WHERE list_id = ?', [id]).forEach((m) => memberships.add(m.id));
        this.db.all('SELECT id FROM sublist WHERE list_id = ?', [id]).forEach((s) => sublists.add(s.id));
      } else {
        counts[id] = this.memberIds(id).length;
      }
      this.db.all('SELECT id, list_id, sublist_id FROM membership WHERE member_id = ? AND removed = 0', [id]).forEach((m) => {
        memberships.add(m.id);
        cards.add(m.list_id);
        // The heading is needed to name a relationship from the member's end.
        if (m.sublist_id) sublists.add(m.sublist_id);
      });
    });
    const conflicts = [];
    cards.forEach((id) => this.db.all('SELECT id FROM conflict WHERE card = ?', [id]).forEach((c) => conflicts.push(c.id)));
    return {
      rows: { card: [...cards], sublist: [...sublists], membership: [...memberships], conflict: conflicts },
      counts,
    };
  }

  // ---- syncing with the copy above ----
  // `upstream` is anything offering receive, serve and fetch: another Replica in the tests, the
  // server reached over https in the app. Hence the awaits.

  async sync(upstream) {
    await this.push(upstream);
    await this.pull(upstream);
  }

  async push(upstream) {
    const waiting = this.db.all('SELECT id, tbl, row, field, value, base, device, at FROM pending ORDER BY n');
    if (!waiting.length) return;
    this.db.run('UPDATE pending SET sent = 1');
    const acks = await upstream.receive(waiting);
    this.db.transaction(() => acks.forEach((ack) => this.acknowledged(ack)));
  }

  acknowledged({ id, seq, rev }) {
    const p = this.db.get('SELECT tbl, row, field FROM pending WHERE id = ?', [id]);
    if (!p) return;
    const key = [p.tbl, p.row, p.field];
    this.db.run('DELETE FROM pending WHERE id = ?', [id]);
    if (seq) this.db.run('UPDATE version SET seq = max(seq, ?) WHERE tbl = ? AND row = ? AND field = ?', [seq, ...key]);
    const stashed = this.db.get('SELECT value, seq, rev FROM stash WHERE tbl = ? AND row = ? AND field = ?', key);
    if (!stashed) return;
    const stillWaiting = this.db.get('SELECT count(*) AS n FROM pending WHERE tbl = ? AND row = ? AND field = ?', key).n;
    // Something reached the copy above after our change did, and we set it aside at the time.
    if (!stillWaiting && stashed.rev >= rev) this.write(...key, stashed.value, { seq: stashed.seq });
    this.db.run('DELETE FROM stash WHERE tbl = ? AND row = ? AND field = ?', key);
  }

  async pull(upstream) {
    const request = { since: this.meta('cursor') || 0, partial: this.partial };
    if (this.partial) request.roots = this.db.all('SELECT id FROM root').map((r) => r.id);
    const answer = await upstream.serve(request);
    this.db.transaction(() => {
      answer.items.forEach((item) => this.applyFromAbove(item));
      this.meta('cursor', answer.upto);
    });
    if (!this.partial) return;

    const missing = {};
    Object.entries(answer.rows).forEach(([tbl, ids]) => {
      const have = new Set(this.db.all('SELECT id FROM held WHERE tbl = ?', [tbl]).map((h) => h.id));
      missing[tbl] = ids.filter((id) => !have.has(id));
    });
    const fetched = Object.values(missing).some((ids) => ids.length) ? await upstream.fetch(missing) : { items: [] };
    this.db.transaction(() => {
      fetched.items.forEach((item) => this.applyFromAbove(item));
      Object.entries(answer.rows).forEach(([tbl, ids]) => {
        // A partial copy holds exactly what is in scope, plus anything carrying an unsent change.
        const keep = new Set(ids);
        this.db.all(`SELECT id FROM ${tbl}`).forEach(({ id }) => {
          if (!keep.has(id)) this.letGo(tbl, id);
        });
        ids.forEach((id) => this.db.run('INSERT OR IGNORE INTO held (tbl, id) VALUES (?, ?)', [tbl, id]));
      });
      this.meta('counts', JSON.stringify(answer.counts));
    });
  }

  applyFromAbove(item) {
    const key = [item.tbl, item.row, item.field];
    const waiting = this.db.all('SELECT sent FROM pending WHERE tbl = ? AND row = ? AND field = ?', key);
    if (!waiting.length) {
      this.write(...key, item.value, { seq: item.seq });
      return;
    }
    // Our own waiting value stays on show. If our change is already on its way up, this value may
    // have reached the copy above after it, so it is set aside until we hear back. If our change has
    // not been sent, the copy above will write the field again when it arrives, and we will be told.
    this.db.run('UPDATE version SET seq = max(seq, ?) WHERE tbl = ? AND row = ? AND field = ?', [item.seq, ...key]);
    if (waiting.some((w) => w.sent)) {
      this.db.run(`INSERT INTO stash (tbl, row, field, value, seq, rev) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (tbl, row, field) DO UPDATE SET value = excluded.value, seq = excluded.seq, rev = excluded.rev`,
      [...key, item.value, item.seq, item.rev]);
    }
  }

  // A row that has left a partial copy's scope. It stays if it carries a change not yet sent.
  letGo(tbl, id) {
    // No longer counted as held either way: if it comes back into scope it must be fetched whole,
    // since changes made to it meanwhile will not have been sent here.
    this.db.run('DELETE FROM held WHERE tbl = ? AND id = ?', [tbl, id]);
    if (this.db.get('SELECT 1 AS x FROM pending WHERE tbl = ? AND row = ?', [tbl, id])) return;
    const isSystem = tbl === 'card' && SYSTEM_CARDS.some((c) => c.id === id);
    if (!isSystem) this.db.run(`DELETE FROM ${tbl} WHERE id = ?`, [id]);
    this.db.run('DELETE FROM version WHERE tbl = ? AND row = ?', [tbl, id]);
  }

  // A partial copy asking to keep a card it has opened, and to stop keeping it.
  hold(cardId) {
    this.db.run('INSERT OR IGNORE INTO root (id) VALUES (?)', [cardId]);
  }

  release(cardId) {
    this.db.run('DELETE FROM root WHERE id = ?', [cardId]);
  }

  // For a card at the edge of what is held: how many items its List has on the server.
  countNotHeld(cardId) {
    const counts = JSON.parse(this.meta('counts') || '{}');
    return counts[cardId] || 0;
  }
}
