#!/usr/bin/env node
// Undoes a mix-up made by the Asana importer before 17 Nov: importing one project could put its
// tasks into the card of another, already imported, project, and rename that card.
//
//   node scripts/split-merged-import.js "<card title or id>" [--keep earlier|later] [--go]
//
// It works out from the hub's record of changes (app/data-hub) when the card was renamed by an
// import, and so which of its headings and cards belonged to the earlier project and which came
// with the later import. One of the two stays in this card (--keep, default "later"); the other is
// rebuilt in a new card beside it, with its old title, headings and order. Cards the earlier project
// shared with the later one stay in both. Cards added by hand go with the project the card was at
// the time. Nothing is deleted; anything moved out is only removed from this card's List.
//
// Without --go it only prints what it would do. The server must be running.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const app = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function plan(log, cardId) {
  const titles = log.all("SELECT seq, at, device, value FROM log WHERE tbl = 'card' AND row = ? AND field = 'title' ORDER BY seq", [cardId]);
  const renames = titles.filter((t, i) => i > 0 && t.device.startsWith('asana-import') && t.value !== titles[i - 1].value);
  if (!renames.length) throw new Error('This card was never renamed by an import, so there is nothing to split.');
  const cut = renames[renames.length - 1];
  const before = titles[titles.indexOf(cut) - 1].value;
  const T = cut.at;

  // The value a field had just before the import, and whether the import touched it.
  const valueBefore = (tbl, row, field) => {
    const r = log.get('SELECT value FROM log WHERE tbl = ? AND row = ? AND field = ? AND at < ? ORDER BY seq DESC LIMIT 1', [tbl, row, field, T]);
    return r ? r.value : null;
  };
  const touchedByImport = (tbl, row) => !!log.get("SELECT 1 AS x FROM log WHERE tbl = ? AND row = ? AND at >= ? AND device LIKE 'asana-import%'", [tbl, row, T]);

  const headings = log.all(`SELECT row, min(at) AS at FROM log WHERE tbl = 'sublist' AND field = 'list_id' AND value = ? GROUP BY row`, [cardId])
    .map((h) => ({ id: h.row, earlier: h.at < T, heading: valueBefore('sublist', h.row, 'heading') || log.get("SELECT value FROM log WHERE tbl = 'sublist' AND row = ? AND field = 'heading' ORDER BY seq DESC LIMIT 1", [h.row]).value, removedBefore: valueBefore('sublist', h.row, 'removed') === 1, position: valueBefore('sublist', h.row, 'position') || '' }));
  const byId = new Map(headings.map((h) => [h.id, h]));

  const members = log.all(`SELECT row, min(at) AS at FROM log WHERE tbl = 'membership' AND row LIKE ? GROUP BY row`, [`${cardId}|%`]).map((m) => {
    const card = m.row.slice(cardId.length + 1);
    const earlier = m.at < T;
    return {
      card,
      title: (log.get("SELECT value FROM log WHERE tbl = 'card' AND row = ? AND field = 'title' ORDER BY seq DESC LIMIT 1", [card]) || {}).value || card,
      earlier,
      shared: earlier && touchedByImport('membership', m.row),
      removedBefore: earlier && valueBefore('membership', m.row, 'removed') === 1,
      heading: earlier ? (byId.get(valueBefore('membership', m.row, 'sublist_id')) || {}).heading || null : null,
      position: earlier ? valueBefore('membership', m.row, 'position') || '' : '',
    };
  });
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const earlierHeadings = headings.filter((h) => h.earlier && !h.removedBefore).sort((a, b) => cmp(a.position, b.position));
  const rank = new Map(earlierHeadings.map((h, i) => [h.heading, i]));
  members.forEach((m) => {
    m.inEarlier = m.earlier && !m.removedBefore;
    m.inLater = !m.earlier || m.shared;
  });
  // As the earlier project showed them: unheaded first, then heading by heading, each in its order.
  const place = (m) => (m.heading === null ? -1 : (rank.has(m.heading) ? rank.get(m.heading) : 999));
  const earlierCards = members.filter((m) => m.inEarlier).sort((a, b) => cmp(place(a), place(b)) || cmp(a.position, b.position));
  return { cut: T, before, after: cut.value, earlierHeadings, earlierCards, members };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const go = args.includes('--go');
  const k = args.indexOf('--keep');
  const keep = k >= 0 ? args[k + 1] : 'later';
  const name = args.filter((a, i) => !a.startsWith('--') && (k < 0 || i !== k + 1))[0];
  if (!name || !['earlier', 'later'].includes(keep)) {
    console.error('Usage: node scripts/split-merged-import.js "<card title or id>" [--keep earlier|later] [--go]');
    process.exit(1);
  }
  const url = (process.env.SUTRA_URL || 'http://localhost:8470').replace(/\/$/, '');
  const call = async (kind, op, ...rest) => {
    const response = await fetch(`${url}/api/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sutra': '1' }, body: JSON.stringify({ op, args: rest, as: 'repair' }) });
    const answer = await response.json();
    if (!response.ok) throw new Error(answer.error || `Sutra said ${response.status}`);
    return answer.result;
  };
  try {
    const cardId = (await call('read', 'card', name)) ? name : (await call('read', 'query', `title = '${name.replace(/'/g, "''")}' AND type <> 'dynamic'`))[0];
    if (!cardId) throw new Error(`No card "${name}"`);
    const log = new DatabaseSync(path.join(process.env.SUTRA_HUB_DATA || path.join(app, 'data-hub'), 'sutra.db'), { readOnly: true });
    const log2 = { all: (sql, p = []) => log.prepare(sql).all(...p), get: (sql, p = []) => log.prepare(sql).get(...p) };
    const p = plan(log2, cardId);
    const list = await call('read', 'list', cardId, { showCompleted: true });

    // Cards for the new card, with their headings, in order; and which of them leave this card.
    let moving;
    let headingsForNew;
    if (keep === 'later') {
      moving = p.earlierCards.map((m) => ({ ...m, both: m.inLater }));
      headingsForNew = p.earlierHeadings.map((h) => h.heading);
    } else {
      const later = new Map(p.members.filter((m) => m.inLater).map((m) => [m.card, m]));
      moving = list.sublists.flatMap((s) => s.cards.filter((c) => later.has(c.id)).map((c) => ({ ...later.get(c.id), heading: s.heading, both: later.get(c.id).inEarlier })));
      headingsForNew = [...new Set(moving.map((m) => m.heading).filter(Boolean))];
    }
    const leaving = moving.filter((m) => !m.both);
    const newTitle = keep === 'later' ? p.before : p.after;
    const oldTitle = keep === 'later' ? p.after : p.before;

    console.log(`"${p.before}" became "${p.after}" on an import at ${p.cut}.`);
    console.log(`This card will be "${oldTitle}". A new card "${newTitle}" will get ${moving.length} cards; ${leaving.length} of them leave this card, the rest are in both.`);
    let current;
    moving.forEach((m) => {
      if (m.heading !== current) { current = m.heading; console.log(`  ${current || '(no heading)'}`); }
      console.log(`    ${m.title}${m.both ? '   [stays in both]' : ''}`);
    });
    const empty = headingsForNew.filter((h) => !moving.some((m) => m.heading === h));
    if (empty.length) console.log(`  Headings with nothing under them, also made: ${empty.join(', ')}`);
    if (!go) {
      console.log('\nNothing changed. Run again with --go to do it.');
      process.exit(0);
    }
    const made = await call('act', 'createCard', { type: 'task', title: newTitle }, { list: 'home', after: cardId });
    for (const listId of ['quick']) {
      const where = await call('read', 'memberships', cardId);
      if (where.lists.some((l) => l.id === listId)) await call('act', 'addToList', listId, made, { after: cardId });
    }
    const heads = new Map();
    for (const h of headingsForNew) if (!heads.has(h)) heads.set(h, await call('act', 'addSublist', made, h));
    for (const m of moving) await call('act', 'addToList', made, m.card, { sublist: m.heading ? heads.get(m.heading) : null });
    for (const m of leaving) await call('act', 'removeFromList', cardId, m.card);
    await call('act', 'edit', cardId, { title: oldTitle });
    // Headings left with nothing under them that came only with the other project.
    const after = await call('read', 'list', cardId, { showCompleted: true });
    const usedBefore = new Set(p.earlierHeadings.map((h) => h.id));
    for (const s of after.sublists) {
      if (s.id && !s.cards.length && (keep === 'later' ? usedBefore.has(s.id) : !usedBefore.has(s.id))) await call('act', 'removeSublist', s.id);
    }
    console.log(`Done. "${newTitle}" is on Home beside "${oldTitle}".`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
