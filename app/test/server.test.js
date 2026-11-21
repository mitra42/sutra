// The laptop's local server: it answers only its own front end, and a PWA can sync through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';
import { device } from './helpers.js';

let nextPort = 18470 + Math.floor(Math.random() * 500);

async function start(options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-test-'));
  // The port is not known until listening, so the server is made for a fixed one that the test owns.
  nextPort += 1;
  const port = nextPort;
  const made = createServer({ port, dataDir, ...options });
  const listener = await new Promise((resolve) => { const l = made.app.listen(port, '127.0.0.1', () => resolve(l)); });
  const call = async (name, body, headers = { 'X-Sutra': '1' }) => {
    const response = await fetch(`http://localhost:${port}/api/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const link = {
    receive: async (changes) => (await call('push', { changes })).body,
    serve: async (request) => (await call('pull', request)).body,
    fetch: async (rows) => (await call('fetch', { rows })).body,
  };
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    made.stopTimers();
    listener.close();
    listener.closeAllConnections();
    made.sutra.db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { ...made, call, link, stop, dataDir };
}

test('the local server refuses anything that is not its own front end', async () => {
  const s = await start();
  try {
    assert.equal((await s.call('pull', {}, {})).status, 403);
    assert.equal((await s.call('pull', {}, { 'X-Sutra': '1', Origin: 'https://example.com' })).status, 403);
    assert.equal((await s.call('pull', {})).status, 200);
  } finally {
    s.stop();
  }
});

test('a PWA syncs through the local server, and search covers everything', async () => {
  const s = await start();
  try {
    const pwa = device('pwa', { partial: true });
    pwa.hold('home');
    await pwa.sync(s.link);
    // The built-in cards start in the quick-access bar.
    pwa.hold('quick');
    await pwa.sync(s.link);
    assert.deepEqual(pwa.list('quick').sublists[0].cards.map((c) => c.id), ['tags', 'conflicts', 'orphans', 'trash']);

    const project = pwa.createCard({ title: 'Project' }, { list: 'home' });
    pwa.createCard({ title: 'Call Fred' }, { list: project });
    await pwa.sync(s.link);
    assert.equal(pwa.pendingCount(), 0);
    assert.equal(s.sutra.card(project).title, 'Project');
    assert.deepEqual(s.sutra.list(project).sublists[0].cards.map((c) => c.title), ['Call Fred']);
    // With no hub yet, the laptop keeps these to pass on later.
    assert.ok(s.sutra.pendingCount() > 0);

    const found = (await s.call('search', { text: 'fred' })).body;
    assert.deepEqual(found.map((c) => c.title), ['Call Fred']);

    // A second PWA, as another tab's worth of browser would be, sees the same.
    const other = device('other', { partial: true });
    other.hold('home');
    other.hold(project);
    await other.sync(s.link);
    assert.deepEqual(other.list(project).sublists[0].cards.map((c) => c.title), ['Call Fred']);
  } finally {
    s.stop();
  }
});

test('two laptops sync through a hub, and a clash shows as a conflict on both', async () => {
  const hub = await start({ role: 'hub' });
  const one = await start({ hubUrl: `http://localhost:${hub.port}`, hubKey: hub.key });
  const two = await start({ hubUrl: `http://localhost:${hub.port}`, hubKey: hub.key });
  try {
    // The hub answers a server that presents its key, and nobody else.
    const direct = (headers) => fetch(`http://localhost:${hub.port}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
    assert.equal((await direct({ Authorization: 'Bearer wrong' })).status, 403);
    assert.equal((await direct({ Authorization: `Bearer ${hub.key}` })).status, 200);
    assert.notEqual(one.sutra.device, two.sutra.device);

    const card = one.sutra.createCard({ title: 'Original' }, { list: 'home' });
    await one.syncUp();
    await two.syncUp();
    assert.equal(two.sutra.card(card).title, 'Original');
    assert.equal(one.sutra.pendingCount(), 0);

    one.sutra.edit(card, { title: 'From one' });
    two.sutra.edit(card, { title: 'From two' });
    await one.syncUp();
    await two.syncUp();
    await one.syncUp();
    for (const s of [hub, one, two]) {
      assert.equal(s.sutra.card(card).title, 'From two');
      assert.equal(s.sutra.conflictsFor(card)[0].other, 'From one');
    }
    const status = await (await fetch(`http://localhost:${one.port}/api/status`, { headers: { 'X-Sutra': '1' } })).json();
    assert.equal(status.hub.online, true);
    assert.equal(status.waiting, 0);

    // With the hub gone, a laptop carries on and says so.
    hub.stop();
    one.sutra.edit(card, { note: 'made while the hub was away' });
    await one.syncUp();
    const after = await (await fetch(`http://localhost:${one.port}/api/status`, { headers: { 'X-Sutra': '1' } })).json();
    assert.equal(after.hub.online, false);
    assert.ok(after.waiting > 0);
  } finally {
    hub.stop();
    one.stop();
    two.stop();
  }
});

test('reading and acting through the server, as the MCP server does; backup; Markdown export', async () => {
  const s = await start();
  try {
    const act = async (op, ...args) => (await s.call('act', { op, args, as: 'ai' })).body.result;
    const read = async (op, ...args) => (await s.call('read', { op, args })).body.result;
    const project = await act('createCard', { title: 'Spec for XYZ', type: 'note', note: 'See [the site](https://example.org).' }, { list: 'home' });
    const heading = await act('addSublist', project, 'Open');
    const task = await act('createCard', { title: 'Write tests' }, { list: project, sublist: heading });
    const other = await act('createCard', { title: 'Write tests' }, { list: project });
    await act('tag', task, 'Urgent');
    await act('complete', other);
    await act('relate', task, other, '#Blocking / Blocked');
    assert.deepEqual((await read('query', "tagged('Urgent') AND done = 0")), [task]);
    assert.equal((await read('list', project)).sublists[1].cards[0].title, 'Write tests');
    // The AI's changes are labelled as such.
    assert.ok(s.sutra.db.get("SELECT count(*) AS n FROM pending WHERE device LIKE 'ai@%'").n > 0);
    // Only the listed operations are offered.
    assert.equal((await s.call('act', { op: 'purge', args: [0] })).status, 500);
    assert.equal((await s.call('read', { op: 'receive', args: [[]] })).status, 500);

    const file = s.backup();
    assert.ok(fs.statSync(file).size > 0);

    const { exportMarkdown } = await import('../scripts/export-markdown.js');
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-export-'));
    exportMarkdown(s.sutra, folder);
    const files = fs.readdirSync(folder).sort();
    assert.ok(files.includes('Spec for XYZ.md') && files.includes('Write tests.md') && files.includes('Home.md') && files.includes('-Urgent.md'));
    assert.equal(files.filter((f) => f.startsWith('Write tests')).length, 2);
    const text = fs.readFileSync(path.join(folder, 'Spec for XYZ.md'), 'utf8');
    assert.match(text, /type: "note"/);
    assert.match(text, /In: \[\[Home\]\]/);
    assert.match(text, /### Open\n\n- \[ \] \[\[Write tests\]\]/);
    assert.match(fs.readFileSync(path.join(folder, 'Write tests.md'), 'utf8'), /tags: \["Urgent"\]\n[\s\S]*Blocking: \[\[Write tests \(/);
    fs.rmSync(folder, { recursive: true, force: true });
  } finally {
    s.stop();
  }
});

test('Asana import: sections become headings, sub-tasks a List; importing again makes no copies', async () => {
  const s = await start();
  try {
    const { importAsana } = await import('../scripts/import-asana.js');
    const call = async (kind, body) => (await s.call(kind, body)).body.result;
    const project = { gid: '100', name: 'Launch' };
    const exported = { data: [
      { gid: '1', name: 'Plan', notes: 'the plan', completed: false, due_on: '2026-12-01', tags: [{ name: 'Urgent' }],
        // Also in another project, listed first: the import must still use this project and its section.
        memberships: [{ project: { gid: '999', name: 'Other' }, section: { gid: '90', name: 'Elsewhere' } }, { project, section: { gid: '10', name: 'To do' } }], subtasks: [{ gid: '3', name: 'Sub step', completed: true, completed_at: '2026-11-10T10:00:00.000Z' }] },
      { gid: '2', name: 'Ship', completed: true, completed_at: '2026-11-12T09:00:00.000Z', memberships: [{ project, section: { gid: '11', name: 'Done' } }] },
      { gid: '4', name: 'Loose', completed: false, memberships: [{ project, section: { gid: '12', name: '(no section)' } }] },
      { gid: '5', name: 'Child listed on its own', completed: false, parent: { gid: '1', name: 'Plan' } },
    ] };
    const first = await importAsana(exported, 'Launch', call);
    assert.deepEqual([first.cards, first.added, first.headings], [6, 0, 2]);
    assert.equal(s.sutra.card(first.project).title, 'Launch');
    const list = s.sutra.list(first.project, { showCompleted: true });
    assert.deepEqual(list.sublists.map((x) => [x.heading, x.cards.map((c) => c.title)]), [[null, ['Loose']], ['To do', ['Plan']], ['Done', ['Ship']]]);
    const plan = s.sutra.card('asana:1');
    assert.deepEqual([plan.note, plan.due, plan.completed], ['the plan', '2026-12-01', null]);
    assert.deepEqual(s.sutra.memberships('asana:1').tags.map((t) => t.title), ['#Urgent']);
    assert.deepEqual(s.sutra.list('asana:1', { showCompleted: true }).sublists[0].cards.map((c) => [c.title, c.completed]), [['Sub step', '2026-11-10'], ['Child listed on its own', null]]);
    assert.equal(s.sutra.card('asana:2').completed, '2026-11-12');

    // The project's card is found by the Asana project, and a card under another title stops it.
    assert.equal(first.project, 'asana:project:100');
    await assert.rejects(importAsana(exported, 'Something else', call), /already exists, titled "Launch"/);
    // A same-titled card under another id is not quietly duplicated.
    const other = { data: [{ gid: '7', name: 'Lone', completed: false, memberships: [{ project: { gid: '200', name: 'Launch' }, section: { name: 'X' } }] }] };
    await assert.rejects(importAsana(other, 'Launch', call), /already a card titled "Launch"/);
    // Sutra wins: importing again, or another project holding the same tasks, changes nothing about
    // a card already in Sutra; it only adds the card to the new project's List.
    s.sutra.edit('asana:1', { title: 'Plan, renamed in Sutra', due: '2027-01-01' });
    s.sutra.untag('asana:1', 'Urgent');
    s.sutra.moveSublist(list.sublists[2].id, { before: list.sublists[1].id });
    exported.data[0].name = 'Plan, renamed in Asana';
    const again = await importAsana(exported, 'Launch', call);
    assert.deepEqual([again.cards, again.added, again.headings], [0, 0, 0]);
    assert.equal(s.sutra.card('asana:1').title, 'Plan, renamed in Sutra');
    assert.equal(s.sutra.card('asana:1').due, '2027-01-01');
    assert.deepEqual(s.sutra.memberships('asana:1').tags, []);
    assert.deepEqual(s.sutra.list(first.project).sublists.map((x) => x.heading), [null, 'Done', 'To do']);
    assert.equal(s.sutra.db.get("SELECT count(*) AS n FROM card WHERE id LIKE 'asana:%' AND id NOT LIKE 'asana:project:%'").n, 5);
    const later = { data: [{ gid: '2', name: 'Ship (Asana)', completed: false, memberships: [{ project: { gid: '300', name: 'Later' }, section: { name: 'Q1' } }] }] };
    const third = await importAsana(later, 'Later', call);
    assert.deepEqual([third.cards, third.added], [1, 1]);
    assert.equal(s.sutra.card('asana:2').title, 'Ship');
    assert.deepEqual(s.sutra.list(third.project, { showCompleted: true }).sublists.find((x) => x.heading === 'Q1').cards.map((c) => c.title), ['Ship']);
  } finally {
    s.stop();
  }
});

test('the hub wants browsers to sign in; the password signs in, sets a lasting cookie, and signing out ends it', async () => {
  const hub = await start({ role: 'hub' });
  try {
    const base = `http://localhost:${hub.port}`;
    // Not signed in: the page sends you to sign in, the API says so, the sign-in page itself loads.
    const page = await fetch(`${base}/`, { headers: { Accept: 'text/html' }, redirect: 'manual' });
    assert.equal(page.status, 302);
    assert.match(page.headers.get('location'), /^\/login\.html\?then=/);
    assert.equal((await fetch(`${base}/api/status`, { headers: { 'X-Sutra': '1' } })).status, 401);
    assert.equal((await fetch(`${base}/login.html`)).status, 200);
    assert.equal((await fetch(`${base}/core/sutra.js`)).status, 401);
    // No password yet, then a password set as the script does.
    const signIn = (password, headers = {}) => fetch(`${base}/auth/password`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ password }) });
    assert.equal((await signIn('anything')).status, 400);
    const { readAuth, writeAuth, hashPassword } = await import('../auth.js');
    writeAuth(hub.dataDir, { ...readAuth(hub.dataDir), password: hashPassword('correct horse') });
    assert.equal((await signIn('wrong')).status, 401);
    assert.equal((await signIn('correct horse', { Origin: 'http://evil.example' })).status, 403);
    const ok = await signIn('correct horse');
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Max-Age=34560000/);
    const session = cookie.split(';')[0];
    // Signed in: the API and the pages answer; but not to another site's page, even with the cookie.
    assert.equal((await fetch(`${base}/api/status`, { headers: { 'X-Sutra': '1', Cookie: session } })).status, 200);
    assert.equal((await fetch(`${base}/core/sutra.js`, { headers: { Cookie: session } })).status, 200);
    assert.equal((await fetch(`${base}/api/status`, { headers: { 'X-Sutra': '1', Cookie: session, Origin: 'http://evil.example' } })).status, 403);
    // The laptop's key still works without signing in.
    assert.equal((await hub.call('pull', {}, { Authorization: `Bearer ${hub.key}` })).status, 200);
    // Signing out ends it.
    await fetch(`${base}/auth/signout`, { method: 'POST', headers: { Cookie: session } });
    assert.equal((await fetch(`${base}/api/status`, { headers: { 'X-Sutra': '1', Cookie: session } })).status, 401);
  } finally { hub.stop(); }
});

test('the laptop server has no login: its own front end works as before', async () => {
  const laptop = await start();
  try {
    assert.equal((await fetch(`http://localhost:${laptop.port}/api/status`, { headers: { 'X-Sutra': '1' } })).status, 200);
    assert.equal((await fetch(`http://localhost:${laptop.port}/auth/status`)).status, 404);
  } finally { laptop.stop(); }
});
