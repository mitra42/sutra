#!/usr/bin/env node
// Brings many Asana projects into Sutra at once, straight from Asana (no exporting by hand).
// It reads each project through Asana's API, in the same shape as Asana's JSON export, and hands it
// to the ordinary importer (import-asana.js), so everything that importer promises holds here too:
// a task already in Sutra is never changed (Sutra wins), and running it twice makes no copies.
//
//   npm run import-asana-all                      list what would be imported, change nothing
//   npm run import-asana-all --go                 import them
//   npm run import-asana-all "Sys" "Garden" --go  just these projects (exact names), e.g. to try one first
// Options:
//   --skip=<letters>   leave out projects whose names start with any of these letters, either case
//                      (default "x": the projects already imported)
//   --archived         include archived projects (left out by default)
//   --yes, --into="<card title>"   for one project the import stopped on: go ahead anyway, or import
//                      into that card (as for import-asana.js; the message says which)
//
// ASANA_TOKEN is a personal access token: in Asana, profile photo → Settings → Apps → View developer
// console → Create new token. It is only used for this run and is not saved anywhere. Without it set,
// the script asks for it. Sutra's server must be running.
// Asana allows a free account 150 requests a minute; this script stays under that, so a big project
// with many sub-tasks takes a minute or two.
import { importAsana } from './import-asana.js';

const API = process.env.ASANA_API || 'https://app.asana.com/api/1.0';
const SUTRA = (process.env.SUTRA_URL || 'http://localhost:8470').replace(/\/$/, '');
const TASK_FIELDS = 'name,notes,completed,completed_at,due_on,parent.gid,tags.name,memberships.project.name,memberships.section.name,num_subtasks';

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const input = process.stdin;
    let text = '';
    if (!input.isTTY) { input.once('data', (d) => resolve(String(d).trim())); return; }
    input.setRawMode(true);
    input.resume();
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') {
          input.setRawMode(false); input.pause(); input.off('data', onData);
          process.stdout.write('\n');
          resolve(text.trim());
          return;
        }
        if (ch === '\u0003') process.exit(1);
        if (ch === '\u007f') text = text.slice(0, -1); else text += ch;
      }
    };
    input.on('data', onData);
  });
}

export function makeAsana(token, { perMinute = 140, fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = 0;
  const gap = 60000 / perMinute;
  let calls = 0;
  async function get(path, params = {}) {
    const url = new URL(`${API}${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    for (;;) {
      const wait = last + gap - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      calls += 1;
      const response = await fetchFn(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (response.status === 429) { // too fast after all: wait as long as Asana says
        await sleep((Number(response.headers.get('retry-after')) || 30) * 1000);
        continue;
      }
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error('Asana refused the token: check ASANA_TOKEN');
      if (!response.ok) throw new Error(`Asana said ${response.status} for ${path}: ${(body.errors || []).map((e) => e.message).join('; ')}`);
      return body;
    }
  }
  // Every page of a list.
  async function all(path, params = {}) {
    const items = [];
    let offset;
    do {
      const page = await get(path, { ...params, limit: 100, ...(offset ? { offset } : {}) });
      items.push(...(page.data || []));
      offset = page.next_page && page.next_page.offset;
    } while (offset);
    return items;
  }
  // A task's sub-tasks, and theirs, nested as in Asana's export.
  async function withSubtasks(task) {
    if (task.num_subtasks > 0) {
      task.subtasks = await all(`/tasks/${task.gid}/subtasks`, { opt_fields: TASK_FIELDS });
      for (const sub of task.subtasks) await withSubtasks(sub);
    }
    return task;
  }
  return {
    get calls() { return calls; },
    workspaces: () => all('/workspaces'),
    projects: (workspace, archived) => all('/projects', { workspace, archived: archived ? 'true' : 'false', opt_fields: 'name,archived' }),
    // A project's tasks in Asana's own order, as its JSON export has them.
    async tasks(project) {
      const tasks = await all('/tasks', { project, opt_fields: TASK_FIELDS });
      for (const t of tasks) await withSubtasks(t);
      return tasks;
    },
  };
}

// How to run this script again for one project, with --yes or --into added (for the importer's messages).
export const rerunFor = (name) => (option) => `run: npm run import-asana-all "${name}" --go ${option === 'yes' ? '--yes' : `--into="${option[1]}"`}`;

// Which projects to bring in: not starting with a skipped letter, or just the one asked for.
export function choose(projects, { skip = 'x', only } = {}) {
  if (only) return projects.filter((p) => p.name === only);
  const letters = [...skip.toLowerCase()];
  return projects.filter((p) => !letters.includes((p.name || '').trim().charAt(0).toLowerCase()));
}

if (process.argv[1] && process.argv[1].endsWith('import-asana-all.js')) {
  const args = process.argv.slice(2);
  // "npm run" takes options given without a "--" before them for itself, and passes them on only as
  // npm_config_<name> settings: those are read too, so both ways of typing them work.
  const npm = (name) => process.env[`npm_config_${name}`];
  const value = (name) => { const i = args.indexOf(name); const eq = args.find((a) => a.startsWith(`${name}=`)); const v = eq ? eq.slice(name.length + 1) : i >= 0 ? args[i + 1] : npm(name.slice(2)); return v === 'true' ? undefined : v; };
  const flag = (name) => args.includes(name) || ['true', ''].includes(npm(name.slice(2)));
  const go = flag('--go');
  // Project names given plainly (npm passes those through as they are) mean "just these".
  const named = args.filter((a, i) => !a.startsWith('--') && !['--skip', '--only', '--into'].includes(args[i - 1]));
  // For a project whose card is in question (see the messages it gives): --yes to go ahead anyway,
  // --into="<card title>" to import into a card of another name. --into only with one project named.
  const yes = flag('--yes');
  const into = value('--into');
  if (into && named.length !== 1) { console.error('--into needs exactly one project named, e.g. npm run import-asana-all "Anon" --go --into="Anon (Asana)"'); process.exit(1); }
  if (value('--only') && value('--only') !== 'true') named.push(value('--only'));
  const token = process.env.ASANA_TOKEN || await askHidden('Asana personal access token: ');
  if (!token) { console.error('No token given.'); process.exit(1); }
  const call = async (kind, body) => {
    const response = await fetch(`${SUTRA}/api/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sutra': '1' }, body: JSON.stringify(body) });
    const answer = await response.json();
    if (!response.ok) throw new Error(answer.error || `Sutra said ${response.status}`);
    return answer.result;
  };
  try {
    await call('read', { op: 'card', args: ['home'] });
  } catch (err) {
    console.error(`Sutra's server isn't answering at ${SUTRA}: start it first (${err.message})`);
    process.exit(1);
  }
  const asana = makeAsana(token);
  try {
    const found = [];
    for (const w of await asana.workspaces()) {
      for (const p of await asana.projects(w.gid, flag('--archived'))) found.push({ ...p, workspace: w.name });
    }
    const chosen = named.length ? found.filter((p) => named.includes(p.name)) : choose(found, { skip: value('--skip') || 'x' });
    named.filter((n) => !found.some((p) => p.name === n)).forEach((n) => console.log(`No project in Asana is called "${n}" (names must match exactly).`));
    console.log(`${found.length} projects in Asana; ${chosen.length} to import${go ? '' : ' (nothing is changed without --go)'}:`);
    chosen.forEach((p) => console.log(`  ${p.name}${p.archived ? ' (archived)' : ''}${found.some((q) => q.workspace !== p.workspace) ? `  [${p.workspace}]` : ''}`));
    if (!go) process.exit(0);
    const problems = [];
    for (const p of chosen) {
      process.stdout.write(`${p.name}: reading… `);
      try {
        const tasks = await asana.tasks(p.gid);
        // The importer finds the project from the tasks' memberships; an empty project still gets its card.
        const exported = tasks.length ? tasks : [{ memberships: [{ project: { gid: p.gid, name: p.name } }] }];
        const r = await importAsana(exported, p.name, call, { yes, into, rerun: rerunFor(p.name) });
        console.log(`${r.cards} new cards, ${r.added} added from elsewhere in Sutra, ${r.kept} left as they were, ${r.headings} new headings.`);
      } catch (err) {
        console.log(`not imported: ${err.message}`);
        problems.push(p.name);
      }
    }
    console.log(problems.length ? `\nDone, except ${problems.length}: ${problems.join(', ')}. Each can be run on its own: npm run import-asana-all "<name>" --go` : '\nDone.');
    console.log(`(${asana.calls} requests to Asana.)`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
