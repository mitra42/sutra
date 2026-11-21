// Saved queries and search. A query is the WHERE part of an SQL statement, run against the view
// `cards`. Helper words such as tagged('UseAI') are rewritten here into plain SQL.
import { SYSTEM_IDS } from './schema.js';

const LIVE = (alias) => `${alias}.trashed IS NULL AND ${alias}.purged = 0`;
const quoted = SYSTEM_IDS.map((id) => `'${id}'`).join(', ');

// A membership that counts as a home: in a live, ordinary List. Tags, the quick-access bar and
// relationships do not count (spec 5.4 and 3.9).
export const HOME = `m_.removed = 0 AND ${LIVE('l_')} AND l_.id <> 'quick' AND l_.title NOT LIKE '#%'
  AND (s_.id IS NULL OR s_.heading NOT LIKE '#%')`;

const HELPERS = {
  tagged: (a) => `EXISTS (SELECT 1 FROM membership m_ JOIN card l_ ON l_.id = m_.list_id
    WHERE m_.member_id = cards.id AND m_.removed = 0 AND ${LIVE('l_')}
      AND lower(l_.title) = lower('#' || ltrim(${a}, '#')))`,
  in_list: (a) => `EXISTS (SELECT 1 FROM membership m_ JOIN card l_ ON l_.id = m_.list_id
    WHERE m_.member_id = cards.id AND m_.removed = 0 AND ${LIVE('l_')}
      AND (l_.title = (${a}) OR l_.id = (${a})))`,
  today: (a) => `today_(${a.trim() || '0'})`,
  orphan: () => `(cards.id NOT IN (${quoted}) AND cards.title NOT LIKE '#%' AND NOT EXISTS (
    SELECT 1 FROM membership m_ JOIN card l_ ON l_.id = m_.list_id
      LEFT JOIN sublist s_ ON s_.id = m_.sublist_id
    WHERE m_.member_id = cards.id AND ${HOME}))`,
  conflicted: () => 'EXISTS (SELECT 1 FROM conflict c_ WHERE c_.card = cards.id AND c_.settled = 0)',
  // True from either end of the relationship: for the card that owns the sub-list under its first
  // name, for a card in the sub-list under its second.
  rel: (a) => `(EXISTS (SELECT 1 FROM membership m_ JOIN sublist s_ ON s_.id = m_.sublist_id
      JOIN card l_ ON l_.id = m_.member_id
    WHERE m_.list_id = cards.id AND m_.removed = 0 AND s_.removed = 0 AND ${LIVE('l_')}
      AND rel_name_(s_.heading, 1) = lower(${a}))
    OR EXISTS (SELECT 1 FROM membership m_ JOIN sublist s_ ON s_.id = m_.sublist_id
      JOIN card l_ ON l_.id = m_.list_id
    WHERE m_.member_id = cards.id AND m_.removed = 0 AND s_.removed = 0 AND ${LIVE('l_')}
      AND rel_name_(s_.heading, 2) = lower(${a})))`,
};

// "#blocked by / blocking" -> ['blocked by', 'blocking']. One name serves for both ends.
export function relationshipNames(heading) {
  if (!heading || !heading.startsWith('#')) return null;
  const parts = heading.slice(1).split('/').map((p) => p.trim());
  return [parts[0], parts[1] || parts[0]];
}

function endOfString(text, start) {
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === "'") {
      if (text[i + 1] === "'") i += 1; else return i;
    }
  }
  throw new Error('Query has an unfinished quoted text');
}

// Rewrites the helper words and notes whether the query asks about trashed cards itself.
// Text in "double quotes" is taken as text, as most people expect, not as SQL's quoted name.
function endOfDouble(text, start) {
  const end = text.indexOf('"', start + 1);
  if (end < 0) throw new Error('Query has an unfinished quoted text');
  return end;
}

// The helpers that take a name: tagged(Urgent) means tagged('Urgent').
const NAMED = ['tagged', 'in_list', 'rel'];

export function expand(where) {
  let out = '';
  let mentionsTrashed = false;
  let i = 0;
  while (i < where.length) {
    const ch = where[i];
    if (ch === "'") {
      const end = endOfString(where, i);
      out += where.slice(i, end + 1);
      i = end + 1;
    } else if (ch === '"') {
      const end = endOfDouble(where, i);
      out += `'${where.slice(i + 1, end).replace(/'/g, "''")}'`;
      i = end + 1;
    } else if (ch === ';' || where.startsWith('--', i) || where.startsWith('/*', i)) {
      throw new Error('A query is a single condition: no ";" and no comments');
    } else if (/[A-Za-z_]/.test(ch)) {
      let end = i;
      while (end < where.length && /[A-Za-z0-9_]/.test(where[end])) end += 1;
      const word = where.slice(i, end);
      const helper = HELPERS[word.toLowerCase()];
      let open = end;
      while (where[open] === ' ') open += 1;
      if (helper && where[open] === '(') {
        let depth = 0;
        let close = open;
        for (; close < where.length; close += 1) {
          if (where[close] === "'") close = endOfString(where, close);
          else if (where[close] === '"') close = endOfDouble(where, close);
          else if (where[close] === '(') depth += 1;
          else if (where[close] === ')') { depth -= 1; if (depth === 0) break; }
        }
        if (depth !== 0) throw new Error(`Query has an unfinished "${word}("`);
        let inner = where.slice(open + 1, close).trim();
        if (NAMED.includes(word.toLowerCase()) && inner && !/^['"]/.test(inner)) inner = `'${inner.replace(/'/g, "''")}'`;
        out += helper(expand(inner).sql);
        i = close + 1;
      } else {
        if (word.toLowerCase() === 'trashed') mentionsTrashed = true;
        out += word;
        i = end;
      }
    } else {
      out += ch;
      i += 1;
    }
  }
  return { sql: out, mentionsTrashed };
}

// Each takes the prefix to put before a column name ('' in a query, 'c.' in a join).
const ORDER = {
  title: (p) => `${p}title COLLATE NOCASE`,
  modified: (p) => `${p}modified DESC`,
  created: (p) => `${p}created DESC`,
  // By due date (or the overdue date where there is no due date); within one day, the card that
  // becomes overdue sooner comes first; cards with no date last.
  due: (p) => `coalesce(${p}due, ${p}overdue) IS NULL, coalesce(${p}due, ${p}overdue), ${p}overdue IS NULL, ${p}overdue`,
  trashed: (p) => `${p}trashed DESC`,
};

export function installQueryFunctions(db, today) {
  db.function('regexp', (pattern, text) => {
    const subject = text === null ? '' : String(text);
    try {
      return new RegExp(pattern, 'i').test(subject) ? 1 : 0;
    } catch (err) {
      // Not a valid regular expression (such as "C++"): look for it as plain text instead.
      return subject.toLowerCase().includes(String(pattern).toLowerCase()) ? 1 : 0;
    }
  }, { deterministic: true });
  db.function('today_', (days) => today(Number(days) || 0));
  db.function('rel_name_', (heading, which) => {
    const names = relationshipNames(heading);
    return names ? names[which - 1].toLowerCase() : null;
  }, { deterministic: true });
}

// Ids of the cards a query finds. Live cards only, unless the query itself mentions `trashed`.
export function runQuery(db, where, { sort, params = [] } = {}) {
  const { sql, mentionsTrashed } = expand(where);
  const live = mentionsTrashed ? '' : ' AND trashed IS NULL';
  const order = (ORDER[sort] || ORDER.title)('');
  // Whoever wrote the query, it cannot change anything.
  db.exec('PRAGMA query_only = ON');
  try {
    return db.allOnce(`SELECT id FROM cards WHERE (${sql})${live} ORDER BY ${order}, id`, params).map((r) => r.id);
  } finally {
    db.exec('PRAGMA query_only = OFF');
  }
}

// Whether text typed into the Search box is meant as a query: it uses a helper word, or compares
// one of the fields of the cards view.
const FIELD_NAMES = 'type|title|note|due|overdue|completed|done|repeat|created|modified|offline|trashed';
export function looksLikeQuery(text) {
  return new RegExp(`\\b(${Object.keys(HELPERS).join('|')})\\s*\\(`, 'i').test(text)
    || new RegExp(`\\b(${FIELD_NAMES})\\s*(=|!=|<>|<=|>=|<|>|\\bregexp\\b|\\bis\\b|\\blike\\b|\\bin\\b)`, 'i').test(text);
}

// The Search box: a query if it looks like one and runs; otherwise a word or phrase, looked for in
// title and Note, trashed cards included.
export function runSearch(db, text) {
  if (looksLikeQuery(text)) {
    try {
      return runQuery(db, text, { sort: 'modified' });
    } catch (err) {
      // Not a valid query after all: search for the text instead.
    }
  }
  return runQuery(db, '(title REGEXP ? OR note REGEXP ?) AND (trashed IS NULL OR trashed IS NOT NULL)',
    { sort: 'modified', params: [text, text] });
}

export { ORDER };
