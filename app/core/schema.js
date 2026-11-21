// One layout, used unchanged on the hub, on each laptop's local server and in the PWA.

// The tables that sync, and the fields of each that a change may set. Anything not listed here is
// refused, which is also what keeps field names safe to place in SQL.
export const FIELDS = {
  card: ['type', 'title', 'note', 'created', 'modified', 'offline', 'completed', 'due', 'overdue',
    'repeat', 'query', 'sort', 'trashed', 'trash_group', 'purged'],
  sublist: ['list_id', 'heading', 'position', 'removed'],
  membership: ['sublist_id', 'position', 'removed'],
  conflict: ['card', 'tbl', 'row', 'field', 'other', 'kind', 'at', 'settled'],
};

// Fields where two devices changing the same thing is not worth bothering Mitra with: the later
// change simply stands. Positions and sub-lists are in the spec; the rest would otherwise raise a
// conflict every time two devices touched different fields of one card.
export const SILENT = {
  card: ['modified', 'trashed', 'trash_group', 'purged'],
  sublist: ['position', 'removed', 'list_id'],
  membership: ['sublist_id', 'position', 'removed'],
  conflict: FIELDS.conflict,
};

export const SYSTEM_CARDS = [
  { id: 'home', type: 'note', title: 'Home' },
  { id: 'quick', type: 'note', title: 'Quick access' },
  { id: 'tags', type: 'dynamic', title: 'Tags', query: "type = 'note' AND title REGEXP '^#'", sort: 'title' },
  { id: 'conflicts', type: 'dynamic', title: 'Conflicts', query: 'conflicted()', sort: 'modified' },
  { id: 'orphans', type: 'dynamic', title: 'Orphans', query: 'orphan()', sort: 'modified' },
  { id: 'trash', type: 'dynamic', title: 'Trash', query: 'trashed IS NOT NULL', sort: 'trashed' },
];
export const SYSTEM_IDS = SYSTEM_CARDS.map((c) => c.id);

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS card (
  id TEXT PRIMARY KEY, type TEXT, title TEXT DEFAULT '', note TEXT DEFAULT '',
  created TEXT, modified TEXT, offline INTEGER DEFAULT 0, completed TEXT, due TEXT, overdue TEXT,
  repeat TEXT DEFAULT 'none', query TEXT, sort TEXT, trashed TEXT, trash_group TEXT, purged INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS sublist (
  id TEXT PRIMARY KEY, list_id TEXT, heading TEXT DEFAULT '', position TEXT DEFAULT '', removed INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS sublist_list ON sublist (list_id);

-- id is "<list card>|<member card>", so two devices adding the same card to the same List while
-- offline make the same row, not two.
CREATE TABLE IF NOT EXISTS membership (
  id TEXT PRIMARY KEY, list_id TEXT, member_id TEXT, sublist_id TEXT, position TEXT DEFAULT '', removed INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS membership_list ON membership (list_id);
CREATE INDEX IF NOT EXISTS membership_member ON membership (member_id);

CREATE TABLE IF NOT EXISTS conflict (
  id TEXT PRIMARY KEY, card TEXT, tbl TEXT, row TEXT, field TEXT, other TEXT, kind TEXT, at TEXT, settled INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS conflict_card ON conflict (card);

-- seq: the hub's number for the last accepted change to this field (0 if never accepted).
-- rev: this copy's own counter at the moment it last wrote the field, which is what a copy
-- further down the chain uses to ask "what is new since I last asked".
CREATE TABLE IF NOT EXISTS version (
  tbl TEXT, row TEXT, field TEXT, seq INTEGER DEFAULT 0, rev INTEGER DEFAULT 0, PRIMARY KEY (tbl, row, field));
CREATE INDEX IF NOT EXISTS version_rev ON version (rev);

-- Changes made here, or passed up from a copy below, that the hub has not yet accepted.
CREATE TABLE IF NOT EXISTS pending (
  n INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, tbl TEXT, row TEXT, field TEXT, value,
  base INTEGER, device TEXT, at TEXT, sent INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS pending_field ON pending (tbl, row, field);

-- A value that arrived from above while our own change to the same field was in flight.
CREATE TABLE IF NOT EXISTS stash (
  tbl TEXT, row TEXT, field TEXT, value, seq INTEGER, rev INTEGER, PRIMARY KEY (tbl, row, field));

-- Changes already taken in from a copy below, so one sent twice is not applied twice.
CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, rev INTEGER);

-- The hub's record of every accepted change, in order. Empty everywhere else.
CREATE TABLE IF NOT EXISTS log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, tbl TEXT, row TEXT, field TEXT, value,
  base INTEGER, device TEXT, at TEXT);
CREATE INDEX IF NOT EXISTS log_field ON log (tbl, row, field, seq);

-- Partial copies only: which rows this copy holds, and which cards it has asked to keep.
CREATE TABLE IF NOT EXISTS held (tbl TEXT, id TEXT, PRIMARY KEY (tbl, id));
CREATE TABLE IF NOT EXISTS root (id TEXT PRIMARY KEY);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value);

-- What saved queries see. Queries never touch the tables, so the tables can change.
CREATE VIEW IF NOT EXISTS cards AS
  SELECT id, type, title, note, due, overdue, completed, (completed IS NOT NULL) AS done, repeat,
         created, modified, offline, trashed
  FROM card WHERE purged = 0;
`;
