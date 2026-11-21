// What the actions on screen mean, expressed as changes. Everything that alters data goes through
// change(), so an edit made here, on another device, or later by an AI, is handled identically.
import { Replica } from './replica.js';
import { isRepeat, nextDate } from './repeat.js';
import { between } from './positions.js';
import { HOME, ORDER, relationshipNames, runQuery, runSearch } from './query.js';
import { SYSTEM_IDS } from './schema.js';

const CARD_TYPES = ['task', 'note', 'person', 'company', 'dynamic'];
const EDITABLE = ['title', 'note', 'due', 'overdue', 'repeat', 'offline', 'query', 'sort', 'type'];
// A card can change between these types; a Dynamic card stays one.
const CHANGEABLE = ['task', 'note', 'person', 'company'];


function addToDate(date, months, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
}

// Ids built from text a person typed must never contain the "|" that separates a membership's halves.
function slug(text) {
  return encodeURIComponent(text.trim().toLowerCase().replace(/\s+/g, ' '));
}

export class Sutra extends Replica {
  // ---- cards ----

  createCard({ type = 'task', title = '', note = '', id } = {}, where) {
    if (!CARD_TYPES.includes(type)) throw new Error(`Not a card type: ${type}`);
    const cardId = id || this.newId();
    this.db.transaction(() => {
      const at = this.stamp();
      this.change('card', cardId, 'type', type);
      this.change('card', cardId, 'title', title);
      if (note) this.change('card', cardId, 'note', note);
      this.change('card', cardId, 'created', at);
      this.change('card', cardId, 'modified', at);
      if (where) this.addToList(where.list, cardId, where);
    });
    return cardId;
  }

  card(id) {
    return this.db.get('SELECT * FROM card WHERE id = ? AND purged = 0', [id]) || null;
  }

  touch(id) {
    this.change('card', id, 'modified', this.stamp());
  }

  edit(id, fields) {
    this.db.transaction(() => {
      Object.entries(fields).forEach(([field, value]) => {
        if (!EDITABLE.includes(field)) throw new Error(`Not an editable field: ${field}`);
        if (field === 'repeat' && value !== 'none' && !isRepeat(value)) throw new Error(`Not a repeat: ${value}`);
        if (field === 'type' && (!CHANGEABLE.includes(value) || !CHANGEABLE.includes(this.card(id).type))) throw new Error(`Cannot make this card a ${value}`);
        this.change('card', id, field, field === 'offline' ? (value ? 1 : 0) : value);
      });
      this.touch(id);
    });
  }

  // Ticking a task. A repeating task is never "completed": its dates move on instead, counted from
  // the day it was done, with the overdue date keeping its distance from the due date (spec 3.6).
  complete(id, date = this.today()) {
    const c = this.card(id);
    this.db.transaction(() => {
      if (isRepeat(c.repeat)) {
        const next = nextDate(c.repeat, date);
        if (c.due && c.overdue) this.change('card', id, 'overdue', addToDate(next, 0, daysBetween(c.due, c.overdue)));
        else if (c.overdue) this.change('card', id, 'overdue', next);
        if (c.due || !c.overdue) this.change('card', id, 'due', next);
      } else {
        this.change('card', id, 'completed', date);
      }
      this.touch(id);
    });
  }

  uncomplete(id) {
    this.db.transaction(() => {
      this.change('card', id, 'completed', null);
      this.touch(id);
    });
  }

  // ---- Lists ----

  membershipId(listId, memberId) {
    return `${listId}|${memberId}`;
  }

  // A position in one sub-list of a List: after the card `after`, ahead of the card `before`,
  // or at the end. The card being placed (`moving`) is left out of its neighbours: otherwise its
  // old position, from where it was before, could be taken for a neighbour's and put it in the
  // wrong place (bug of 21 Nov: a card dragged under a heading landing after the cards there).
  positionIn(listId, sublistId, { after, before, moving } = {}) {
    const rows = this.db.all(`SELECT member_id, position FROM membership
      WHERE list_id = ? AND sublist_id IS ? AND removed = 0 ORDER BY position, member_id`, [listId, sublistId || null])
      .filter((r) => r.member_id !== moving);
    const at = (id) => rows.findIndex((r) => r.member_id === id);
    if (before && at(before) >= 0) {
      const i = at(before);
      return between(i > 0 ? rows[i - 1].position : '', rows[i].position);
    }
    if (after && at(after) >= 0) {
      const i = at(after);
      return between(rows[i].position, i + 1 < rows.length ? rows[i + 1].position : '');
    }
    return between(rows.length ? rows[rows.length - 1].position : '', '');
  }

  // Adding a card to a List, or moving it within one: a card is in one sub-list of each List.
  addToList(listId, memberId, { sublist = null, after, before } = {}) {
    const id = this.membershipId(listId, memberId);
    this.db.transaction(() => {
      const position = this.positionIn(listId, sublist, { after, before, moving: memberId });
      this.change('membership', id, 'removed', 0);
      this.change('membership', id, 'sublist_id', sublist);
      this.change('membership', id, 'position', position);
    });
  }

  move(listId, memberId, where) {
    this.addToList(listId, memberId, where);
  }

  removeFromList(listId, memberId) {
    this.change('membership', this.membershipId(listId, memberId), 'removed', 1);
  }

  addSublist(listId, heading, { after, id } = {}) {
    const sublistId = id || this.newId();
    const rows = this.db.all('SELECT id, position FROM sublist WHERE list_id = ? AND removed = 0 ORDER BY position, id', [listId]);
    const i = after ? rows.findIndex((r) => r.id === after) : rows.length - 1;
    const position = between(i >= 0 ? rows[i].position : '', i + 1 < rows.length ? rows[i + 1].position : '');
    this.db.transaction(() => {
      this.change('sublist', sublistId, 'list_id', listId);
      this.change('sublist', sublistId, 'heading', heading);
      this.change('sublist', sublistId, 'position', position);
      this.change('sublist', sublistId, 'removed', 0);
    });
    return sublistId;
  }

  renameSublist(sublistId, heading) {
    this.change('sublist', sublistId, 'heading', heading);
  }

  // Reordering headings: ahead of the heading `before`, after the heading `after`, or to the end.
  moveSublist(sublistId, { before, after } = {}) {
    const s = this.db.get('SELECT list_id FROM sublist WHERE id = ?', [sublistId]);
    const rows = this.db.all('SELECT id, position FROM sublist WHERE list_id = ? AND removed = 0 AND id <> ? ORDER BY position, id', [s.list_id, sublistId]);
    const at = (id) => rows.findIndex((r) => r.id === id);
    let position;
    if (before && at(before) >= 0) {
      const i = at(before);
      position = between(i > 0 ? rows[i - 1].position : '', rows[i].position);
    } else if (after && at(after) >= 0) {
      const i = at(after);
      position = between(rows[i].position, i + 1 < rows.length ? rows[i + 1].position : '');
    } else {
      position = between(rows.length ? rows[rows.length - 1].position : '', '');
    }
    this.change('sublist', sublistId, 'position', position);
  }

  // Removing a heading leaves its cards in the List, unfiled.
  removeSublist(sublistId) {
    const s = this.db.get('SELECT list_id FROM sublist WHERE id = ?', [sublistId]);
    this.db.transaction(() => {
      this.db.all('SELECT member_id FROM membership WHERE sublist_id = ? AND removed = 0 ORDER BY position', [sublistId])
        .forEach((m) => this.addToList(s.list_id, m.member_id, { sublist: null }));
      this.change('sublist', sublistId, 'removed', 1);
    });
  }

  // ---- tags and relationships ----

  // A tag is a Note card titled "#name". Its id comes from the name, so two devices that both
  // invent the same tag while offline have made the same card.
  // A card already titled "#name", however it came to exist (made by hand, say), is that tag.
  tagCard(name) {
    const clean = name.replace(/^#/, '').trim();
    const existing = this.db.get(`SELECT id FROM card WHERE lower(title) = lower(?) AND trashed IS NULL AND purged = 0
      ORDER BY created, id LIMIT 1`, [`#${clean}`]);
    if (existing) return existing.id;
    const id = `tag:${slug(clean)}`;
    if (!this.card(id)) this.createCard({ id, type: 'note', title: `#${clean}` });
    else this.restore(id);
    return id;
  }

  tag(cardId, name) {
    this.addToList(this.tagCard(name), cardId);
  }

  untag(cardId, name) {
    this.removeFromList(this.tagCard(name), cardId);
  }

  // "A is blocked by B": B goes into A's List under the heading "#blocked by / blocking".
  // One entry, shown from both ends (spec 3.9).
  relate(ownerId, otherId, heading) {
    if (!relationshipNames(heading)) throw new Error('A relationship heading starts with #');
    const sublistId = `${ownerId}:rel:${slug(heading)}`;
    this.db.transaction(() => {
      const existing = this.db.get('SELECT removed FROM sublist WHERE id = ?', [sublistId]);
      if (!existing) this.addSublist(ownerId, heading, { id: sublistId });
      else if (existing.removed) this.change('sublist', sublistId, 'removed', 0);
      this.addToList(ownerId, otherId, { sublist: sublistId });
    });
  }

  unrelate(ownerId, otherId) {
    this.removeFromList(ownerId, otherId);
  }

  // ---- deleting ----

  // Cards in this card's List that have no other home, and so on down: what "Delete cards not in
  // any other list?" is asking about.
  wouldOrphan(id) {
    const doomed = new Set([id]);
    const walk = (listId) => {
      this.db.all(`SELECT m.member_id FROM membership m JOIN card c ON c.id = m.member_id
          LEFT JOIN sublist s ON s.id = m.sublist_id
        WHERE m.list_id = ? AND m.removed = 0 AND c.trashed IS NULL AND c.purged = 0
          AND (s.id IS NULL OR s.heading NOT LIKE '#%')`, [listId]).forEach(({ member_id: member }) => {
        if (doomed.has(member) || SYSTEM_IDS.includes(member)) return;
        const homes = this.db.all(`SELECT m_.list_id FROM membership m_ JOIN card l_ ON l_.id = m_.list_id
            LEFT JOIN sublist s_ ON s_.id = m_.sublist_id WHERE m_.member_id = ? AND ${HOME}`, [member]);
        if (homes.every((h) => doomed.has(h.list_id))) {
          doomed.add(member);
          walk(member);
        }
      });
    };
    walk(id);
    doomed.delete(id);
    return [...doomed];
  }

  // Deleting puts a card in Trash and leaves its memberships alone. With `cascade`, the cards that
  // would be orphaned go with it, as one group that a restore brings back together.
  trash(id, { cascade = false } = {}) {
    if (SYSTEM_IDS.includes(id)) throw new Error('The built-in cards cannot be deleted');
    const ids = cascade ? [id, ...this.wouldOrphan(id)] : [id];
    const at = this.stamp();
    const group = this.newId();
    this.db.transaction(() => {
      ids.forEach((cardId) => {
        this.change('card', cardId, 'trashed', at);
        this.change('card', cardId, 'trash_group', group);
      });
    });
    return ids;
  }

  restore(id) {
    const c = this.db.get('SELECT trash_group FROM card WHERE id = ?', [id]);
    const ids = c && c.trash_group
      ? this.db.all('SELECT id FROM card WHERE trash_group = ?', [c.trash_group]).map((r) => r.id)
      : [id];
    this.db.transaction(() => {
      ids.forEach((cardId) => {
        this.change('card', cardId, 'trashed', null);
        this.change('card', cardId, 'trash_group', null);
      });
    });
    return ids;
  }

  // ---- conflicts ----

  conflictsFor(cardId) {
    return this.db.all('SELECT * FROM conflict WHERE card = ? AND settled = 0 ORDER BY at', [cardId]);
  }

  // Settling a conflict: keep what stands, or put back the value that was displaced.
  settle(conflictId, { useOther = false } = {}) {
    const c = this.db.get('SELECT * FROM conflict WHERE id = ?', [conflictId]);
    this.db.transaction(() => {
      if (useOther && c.kind === 'field') {
        const numeric = typeof this.value(c.tbl, c.row, c.field) === 'number';
        this.change(c.tbl, c.row, c.field, numeric && c.other !== null ? Number(c.other) : c.other);
      }
      this.change('conflict', conflictId, 'settled', 1);
    });
  }

  // ---- reading ----

  query(where, options) {
    return runQuery(this.db, where, options);
  }

  search(text) {
    return runSearch(this.db, text);
  }

  // A List as the screen shows it: unfiled items, then each heading with its cards. Relationship
  // sub-lists are returned apart, since they are shown with the card's details and not as items.
  list(listId, { showCompleted = false, sort } = {}) {
    const owner = this.card(listId);
    if (!owner) return null;
    const visible = (c) => showCompleted || !c.completed;
    const shown = (c) => this.decorate(c);
    if (owner.type === 'dynamic') {
      const ids = owner.query ? runQuery(this.db, owner.query, { sort: sort || owner.sort }) : [];
      return { card: owner, dynamic: true, sublists: [{ id: null, heading: null, cards: ids.map((id) => this.card(id)).filter((c) => c && visible(c)).map(shown) }], relationships: [] };
    }
    const order = sort && ORDER[sort] ? ORDER[sort]('c.') : 'm.position';
    const members = this.db.all(`SELECT c.*, m.sublist_id FROM membership m JOIN card c ON c.id = m.member_id
      WHERE m.list_id = ? AND m.removed = 0 AND c.trashed IS NULL AND c.purged = 0 ORDER BY ${order}, m.member_id`, [listId]);
    const headings = this.db.all('SELECT id, heading FROM sublist WHERE list_id = ? AND removed = 0 ORDER BY position, id', [listId]);
    const known = new Set(headings.map((h) => h.id));
    const cardsIn = (sublistId) => members
      .filter((c) => (sublistId === null ? !known.has(c.sublist_id) : c.sublist_id === sublistId))
      .map(({ sublist_id: unused, ...c }) => shown(c));
    const unfiled = { id: null, heading: null, cards: cardsIn(null).filter(visible) };
    const ordinary = headings.filter((h) => !h.heading.startsWith('#')).map((h) => ({ ...h, cards: cardsIn(h.id).filter(visible) }));
    return {
      card: owner,
      dynamic: false,
      // The unheaded sub-list comes first, except on Home where it is last (spec 3.2).
      sublists: listId === 'home' ? [...ordinary, unfiled] : [unfiled, ...ordinary],
      relationships: headings.filter((h) => h.heading.startsWith('#'))
        .map((h) => ({ id: h.id, heading: h.heading, label: relationshipNames(h.heading)[0], cards: cardsIn(h.id) })),
    };
  }

  // What a row on screen shows beyond the card's own fields: its tags, and how many items are in
  // its List (on a partial copy at the edge of what is held, the number the server reported).
  decorate(card) {
    const tags = this.db.all(`SELECT l.title FROM membership m JOIN card l ON l.id = m.list_id
      WHERE m.member_id = ? AND m.removed = 0 AND l.title LIKE '#%' AND l.trashed IS NULL AND l.purged = 0
      ORDER BY l.title COLLATE NOCASE`, [card.id]).map((t) => t.title);
    const held = card.type === 'dynamic' ? 0 : this.db.get(`SELECT count(*) AS n FROM membership m
        JOIN card c ON c.id = m.member_id LEFT JOIN sublist s ON s.id = m.sublist_id
      WHERE m.list_id = ? AND m.removed = 0 AND c.trashed IS NULL AND c.purged = 0
        AND (s.id IS NULL OR s.heading NOT LIKE '#%')`, [card.id]).n;
    return { ...card, tags, count: held || this.countNotHeld(card.id) };
  }

  // Where a card belongs, seen from the card itself: the Lists it is in, its tags, and the
  // relationships in which it is the other end.
  memberships(cardId) {
    const rows = this.db.all(`SELECT l.id, l.title, s.heading FROM membership m JOIN card l ON l.id = m.list_id
        LEFT JOIN sublist s ON s.id = m.sublist_id AND s.removed = 0
      WHERE m.member_id = ? AND m.removed = 0 AND l.trashed IS NULL AND l.purged = 0 ORDER BY l.title COLLATE NOCASE`, [cardId]);
    const result = { lists: [], tags: [], relationships: [] };
    rows.forEach((r) => {
      const names = relationshipNames(r.heading);
      if (names) result.relationships.push({ label: names[1], card: { id: r.id, title: r.title } });
      else if (r.title.startsWith('#')) result.tags.push({ id: r.id, title: r.title });
      else result.lists.push({ id: r.id, title: r.title });
    });
    return result;
  }
}
