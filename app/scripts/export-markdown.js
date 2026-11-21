#!/usr/bin/env node
// Writes every card as a Markdown file, one per card, into a folder that opens as an Obsidian vault
// (spec section 7). Read-only: it can be run while the server is running.
//   node scripts/export-markdown.js <folder> [data folder]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openNodeDb } from '../core/node-db.js';
import { Sutra } from '../core/index.js';

const app = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// One file per card, named by its title. Two cards with the same title are told apart by a few
// characters of their id. Characters that file systems or Obsidian links dislike are replaced.
export function fileNames(cards) {
  const names = new Map();
  const taken = new Set();
  cards.forEach((c) => {
    const base = (c.title || 'Untitled').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
    let name = base;
    if (taken.has(name.toLowerCase())) name = `${base} (${c.id.replace(/[^a-z0-9]/gi, '').slice(0, 6)})`;
    taken.add(name.toLowerCase());
    names.set(c.id, name);
  });
  return names;
}

export function exportMarkdown(sutra, folder) {
  fs.mkdirSync(folder, { recursive: true });
  const cards = sutra.db.all('SELECT * FROM card WHERE purged = 0 AND trashed IS NULL ORDER BY created, id');
  const names = fileNames(cards);
  const link = (id) => `[[${names.get(id)}]]`;
  cards.forEach((card) => {
    const list = sutra.list(card.id, { showCompleted: true });
    const where = sutra.memberships(card.id);
    const front = [
      ['id', card.id], ['type', card.type], ['due', card.due], ['overdue', card.overdue], ['completed', card.completed],
      ['repeat', card.repeat !== 'none' ? card.repeat : null], ['created', card.created], ['modified', card.modified],
      ['query', card.query],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    // Tags as Obsidian tags, without the #, which YAML would read as a comment.
    if (where.tags.length) front.push(`tags: [${where.tags.map((t) => JSON.stringify(t.title.slice(1))).join(', ')}]`);
    const lines = ['---', ...front, '---', ''];
    if (where.lists.length) lines.push(`In: ${where.lists.map((l) => link(l.id)).join(', ')}`, '');
    list.relationships.filter((r) => r.cards.length).forEach((r) => lines.push(`${r.label}: ${r.cards.map((c) => link(c.id)).join(', ')}`, ''));
    where.relationships.forEach((r) => lines.push(`${r.label}: ${link(r.card.id)}`, ''));
    if (card.note) lines.push(card.note, '');
    if (!list.dynamic && list.sublists.some((s) => s.cards.length)) {
      lines.push('## List', '');
      list.sublists.forEach((s) => {
        if (!s.cards.length) return;
        if (s.heading !== null) lines.push(`### ${s.heading}`, '');
        s.cards.forEach((c) => lines.push(`- ${c.type === 'task' ? (c.completed ? '[x] ' : '[ ] ') : ''}${link(c.id)}`));
        lines.push('');
      });
    }
    fs.writeFileSync(path.join(folder, `${names.get(card.id)}.md`), lines.join('\n'));
  });
  return cards.length;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2];
  if (!folder) {
    console.error('Usage: node scripts/export-markdown.js <folder to write into> [data folder]');
    process.exit(1);
  }
  const dataDir = process.argv[3] || process.env.SUTRA_DATA || path.join(app, 'data');
  const sutra = new Sutra(openNodeDb(path.join(dataDir, 'sutra.db')), { device: 'export' });
  console.log(`Wrote ${exportMarkdown(sutra, folder)} cards to ${folder}`);
}
