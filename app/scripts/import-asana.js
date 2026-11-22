#!/usr/bin/env node
// Brings one Asana project into Sutra from Asana's JSON export (project menu, Export, JSON).
//   node scripts/import-asana.js <export.json> ["Project title"] [--into <card id or exact title>] [--yes]
// It works through the running local server, so the cards appear in the app and sync like any others.
// A task already in Sutra (from another project, or an earlier import) is never changed: Sutra wins.
// It is only added to this project's List. Running it again makes no copies.
//
// A task in Asana can be in several projects. The project being imported is the one that every task
// in the export belongs to, and each task's section is its section in that project.
// The project's card is found by the Asana project's id. If that card exists under a different title
// the import stops and says so, unless --yes is given: that is how the mix-ups of 16 and 17 Nov
// (one project's tasks merged into another's card) are prevented. --into names the card to import
// into instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The project the export is of: the one the most tasks belong to (in a real export, all of them).
export function exportedProject(tasks) {
  const counts = new Map();
  tasks.forEach((t) => {
    const seen = new Set();
    (t.memberships || []).forEach((m) => {
      if (!m.project || !m.project.gid || seen.has(m.project.gid)) return;
      seen.add(m.project.gid);
      const c = counts.get(m.project.gid) || { project: m.project, n: 0 };
      c.n += 1;
      counts.set(m.project.gid, c);
    });
  });
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return best ? best.project : null;
}

// `rerun` says how to run the import again with an option added, for the error messages: it differs
// between this script and import-asana-all.js. It is given 'yes', or ['into', title].
const plainRerun = (option) => (option === 'yes' ? 'run again with --yes' : `run again with --into "${option[1]}"`);

export async function importAsana(exported, title, call, { into, yes = false, rerun = plainRerun } = {}) {
  const tasks = Array.isArray(exported) ? exported : (exported.data || []);
  const act = (op, ...args) => call('act', { op, args, as: 'asana-import' });
  const read = (op, ...args) => call('read', { op, args });
  const counts = { cards: 0, added: 0, kept: 0, headings: 0 };

  const project = exportedProject(tasks) || {};
  const sectionOf = (t) => {
    const m = (t.memberships || []).find((x) => x.project && x.project.gid === project.gid);
    return m && m.section && m.section.name && !/^\(?(no section|untitled section)\)?$/i.test(m.section.name) ? m.section.name : null;
  };
  const wanted = title || project.name || 'Asana project';

  let projectId = `asana:project:${project.gid || encodeURIComponent(wanted.toLowerCase())}`;
  if (into) {
    const byId = await read('card', into);
    const titled = byId ? [] : await read('query', `title = '${into.replace(/'/g, "''")}' AND type <> 'dynamic'`);
    if (titled.length > 1) throw new Error(`There are ${titled.length} cards titled "${into}": rename one, or give the card's id instead`);
    const byTitle = titled[0];
    if (!byId && !byTitle) throw new Error(`No card "${into}" to import into`);
    projectId = byId ? into : byTitle;
  } else {
    const existing = await read('card', projectId);
    if (existing && !existing.trashed && existing.title !== wanted && !yes) {
      throw new Error(`The card for this Asana project ("${project.name}") already exists, titled "${existing.title}". `
        + `Importing would put this export's tasks into it. If that is right, ${rerun('yes')}; to import into a `
        + `different card, ${rerun(['into', '<its title>'])}.`);
    }
    // A card with this title made some other way (an earlier import that filed it under the wrong
    // project, say): importing would make a second one beside it.
    const namesake = (await read('query', `title = '${wanted.replace(/'/g, "''")}' AND type <> 'dynamic'`)).filter((id) => id !== projectId);
    if (!existing && namesake.length && !yes) {
      throw new Error(`There is already a card titled "${wanted}". To import into it, ${rerun(['into', wanted])}; `
        + `to make a separate new card anyway, ${rerun('yes')}.`);
    }
  }
  // Sutra wins: a task already in Sutra keeps everything about it (title, Note, dates, done, tags,
  // and where it sits in Lists it is already in). Importing only adds it to this project's List if it
  // is not there yet. A new task gets everything from Asana. Returns whether the card was new.
  async function card(id, fields, where) {
    const { title: name, note, due, completed } = fields;
    if (await read('card', id)) {
      const inIt = where && (await read('memberships', id)).lists.concat((await read('memberships', id)).tags).some((l) => l.id === where.list);
      if (where && !inIt) {
        counts.added += 1;
        await act('addToList', where.list, id, { sublist: where.sublist || null });
      } else {
        counts.kept += 1;
      }
      return false;
    }
    counts.cards += 1;
    await act('createCard', { id, type: 'task', title: name, note: note || '' }, where);
    if (due) await act('edit', id, { due });
    if (completed) await act('complete', id, completed.slice(0, 10));
    return true;
  }

  // The project's own card: made if new, otherwise left as it is (its title may have been changed in Sutra).
  const newProject = !(await read('card', projectId));
  if (newProject) {
    counts.cards += 1;
    await act('createCard', { id: projectId, type: 'task', title: wanted }, { list: 'home' });
  }
  const headings = new Map((await read('list', projectId)).sublists.filter((s) => s.heading !== null).map((s) => [s.heading, s.id]));

  async function task(t, where) {
    if (!t || !t.name) return;
    const id = `asana:${t.gid || encodeURIComponent(t.name)}`;
    const fresh = await card(id, { title: t.name, note: t.notes, due: t.due_on, completed: t.completed ? (t.completed_at || new Date().toISOString()) : null }, where);
    if (fresh) for (const tag of t.tags || []) if (tag && tag.name) await act('tag', id, tag.name);
    // Sub-tasks become the card's own List.
    for (const sub of t.subtasks || []) await task(sub, { list: id });
  }

  for (const t of tasks) {
    // In the export a sub-task can also appear in its own right, pointing at its parent.
    const parent = t.parent && t.parent.gid ? `asana:${t.parent.gid}` : null;
    if (parent) {
      await task(t, { list: parent });
    } else {
      const name = sectionOf(t);
      if (name && !headings.has(name)) {
        headings.set(name, await act('addSublist', projectId, name));
        counts.headings += 1;
      }
      await task(t, { list: projectId, sublist: name ? headings.get(name) : null });
    }
  }
  // A new project's headings in the order Asana has them (the order in which its tasks reach them).
  // An existing project's headings stay as they are in Sutra.
  if (newProject) {
    const order = [...new Set(tasks.filter((t) => !t.parent).map(sectionOf).filter(Boolean))];
    for (const name of order) await act('moveSublist', headings.get(name));
  }
  return { project: projectId, title: (await read('card', projectId)).title, ...counts };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/import-asana.js <export.json> ["Project title"]');
    process.exit(1);
  }
  const url = (process.env.SUTRA_URL || 'http://localhost:8470').replace(/\/$/, '');
  const call = async (kind, body) => {
    const response = await fetch(`${url}/api/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sutra': '1' }, body: JSON.stringify(body) });
    const answer = await response.json();
    if (!response.ok) throw new Error(answer.error || `Sutra said ${response.status}`);
    return answer.result;
  };
  const args = process.argv.slice(3);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const into = flag('--into');
  const yes = args.includes('--yes');
  const title = args.filter((a) => a !== '--yes')[0];
  try {
    const result = await importAsana(JSON.parse(fs.readFileSync(file, 'utf8')), title, call, { into, yes });
    console.log(`Imported into "${result.title}": ${result.cards} new cards, ${result.added} already in Sutra and now added to it, ${result.kept} already there and left as they are, ${result.headings} new headings.`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
