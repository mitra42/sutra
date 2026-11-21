// Several copies syncing: the hub, a laptop, the laptop's PWA and a phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { device, world, flaky, syncAll, dump, heldVersusHub } from './helpers.js';

const titles = (cards) => cards.map((c) => c.title);

test('edits travel in both directions and different fields merge', async () => {
  const hub = device('hub', { role: 'hub' });
  const one = device('one');
  const two = device('two');
  const card = one.createCard({ title: 'Plan' }, { list: 'home' });
  await one.sync(hub);
  await two.sync(hub);
  assert.equal(two.card(card).title, 'Plan');

  one.edit(card, { due: '2026-12-01' });
  two.edit(card, { note: 'from two' });
  await one.sync(hub);
  await two.sync(hub);
  await one.sync(hub);
  for (const d of [hub, one, two]) {
    assert.equal(d.card(card).due, '2026-12-01');
    assert.equal(d.card(card).note, 'from two');
    assert.equal(d.list('conflicts').sublists[0].cards.length, 0);
  }
  assert.deepEqual(dump(one), dump(hub));
  assert.deepEqual(dump(two), dump(hub));
});

test('same field changed on two devices: the later one stands, the earlier waits in Conflicts', async () => {
  const hub = device('hub', { role: 'hub' });
  const one = device('one');
  const two = device('two');
  const card = one.createCard({ title: 'Original' }, { list: 'home' });
  await one.sync(hub);
  await two.sync(hub);

  one.edit(card, { title: 'From one' });
  two.edit(card, { title: 'From two' });
  await one.sync(hub); // reaches the hub first
  await two.sync(hub); // reaches it later, and stands
  await one.sync(hub);

  for (const d of [hub, one, two]) {
    assert.equal(d.card(card).title, 'From two');
    assert.deepEqual(titles(d.list('conflicts').sublists[0].cards), ['From two']);
    const [conflict] = d.conflictsFor(card);
    assert.equal(conflict.field, 'title');
    assert.equal(conflict.other, 'From one');
  }

  // "Use this instead", done on one device, settles it everywhere.
  one.settle(one.conflictsFor(card)[0].id, { useOther: true });
  await one.sync(hub);
  await two.sync(hub);
  for (const d of [hub, one, two]) {
    assert.equal(d.card(card).title, 'From one');
    assert.equal(d.conflictsFor(card).length, 0);
    assert.equal(d.list('conflicts').sublists[0].cards.length, 0);
  }
});

test('same Note changed on two devices: both texts are kept', async () => {
  const hub = device('hub', { role: 'hub' });
  const one = device('one');
  const two = device('two');
  const card = one.createCard({ title: 'Notes', note: 'start' });
  await one.sync(hub);
  await two.sync(hub);
  one.edit(card, { note: 'text from one' });
  two.edit(card, { note: 'text from two' });
  await one.sync(hub);
  await two.sync(hub);
  await one.sync(hub);
  for (const d of [hub, one, two]) {
    assert.match(d.card(card).note, /text from one[\s\S]*conflicting version[\s\S]*text from two/);
    assert.equal(d.conflictsFor(card)[0].kind, 'note');
  }
});

test('a device catching up on its own edits has not clashed with anyone', async () => {
  const hub = device('hub', { role: 'hub' });
  const one = device('one');
  const link = flaky(hub);
  const card = one.createCard({ title: 'v1' });
  await one.sync(link);
  one.edit(card, { title: 'v2' });
  await one.push(link);
  one.edit(card, { title: 'v3' }); // made before v2's acceptance has been pulled back
  one.edit(card, { title: 'v4' });
  await one.sync(link);
  assert.equal(hub.card(card).title, 'v4');
  assert.equal(hub.conflictsFor(card).length, 0);
  assert.equal(one.pendingCount(), 0);
});

test('reordering on two devices: both apply, with no conflict raised', async () => {
  const hub = device('hub', { role: 'hub' });
  const one = device('one');
  const two = device('two');
  const p = one.createCard({ title: 'P' });
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((t) => one.createCard({ title: t }, { list: p }));
  await one.sync(hub);
  await two.sync(hub);
  one.move(p, d, { before: a });
  two.move(p, a, { after: c });
  two.createCard({ title: 'e' }, { list: p });
  await one.sync(hub);
  await two.sync(hub);
  await one.sync(hub);
  for (const dev of [hub, one, two]) {
    assert.deepEqual(titles(dev.list(p).sublists[0].cards), ['d', 'b', 'c', 'a', 'e']);
    assert.equal(dev.list('conflicts').sublists[0].cards.length, 0);
  }
  void b;
});

test('two devices adding the same card to the same List make one entry', async () => {
  const hub = device('hub', { role: 'hub' });
  const one = device('one');
  const two = device('two');
  const p = one.createCard({ title: 'P' });
  const x = one.createCard({ title: 'x' });
  await one.sync(hub);
  await two.sync(hub);
  one.addToList(p, x);
  two.addToList(p, x);
  one.tag(x, 'Idea');
  two.tag(x, 'idea');
  await one.sync(hub);
  await two.sync(hub);
  await one.sync(hub);
  for (const dev of [hub, one, two]) {
    assert.deepEqual(titles(dev.list(p).sublists[0].cards), ['x']);
    assert.equal(dev.list('tags').sublists[0].cards.length, 1);
    assert.equal(dev.memberships(x).tags.length, 1);
  }
});

test('a lost reply: the change is sent again and applied once', async () => {
  const hub = device('hub', { role: 'hub' });
  const one = device('one');
  const two = device('two');
  const link = flaky(hub);
  const card = one.createCard({ title: 'Original' });
  await one.sync(link);
  await two.sync(hub);

  one.edit(card, { title: 'From one' });
  link.loseNextReply = true;
  await assert.rejects(one.push(link));
  assert.equal(one.pendingCount() > 0, true);
  assert.equal(hub.card(card).title, 'From one');

  // Meanwhile another device changes the same field, later, and so stands.
  await two.sync(hub);
  two.edit(card, { title: 'From two' });
  await two.sync(hub);

  // One hears about it while still unsure of its own change, then gets through.
  await one.pull(link);
  assert.equal(one.card(card).title, 'From one');
  await one.sync(link);
  assert.equal(one.pendingCount(), 0);
  assert.equal(one.card(card).title, 'From two');
  assert.equal(hub.db.get('SELECT count(*) AS n FROM log WHERE row = ? AND field = ?', [card, 'title']).n, 3);
  assert.equal(hub.conflictsFor(card).length, 0);
  assert.deepEqual(dump(one), dump(hub));
});

test('the laptop works with no connection, then catches up through the hub', async () => {
  const w = world();
  const project = w.laptopPwa.createCard({ title: 'Plane work' }, { list: 'home' });
  w.laptopPwa.edit(project, { offline: true });
  const t1 = w.laptopPwa.createCard({ title: 'first' }, { list: project });

  // On the plane: the PWA and the laptop's local server carry on together.
  await w.laptopPwa.sync(w.laptop);
  w.laptopPwa.edit(t1, { title: 'first, edited' });
  w.laptopPwa.complete(w.laptopPwa.createCard({ title: 'done on the plane' }, { list: project }));
  await w.laptopPwa.sync(w.laptop);
  assert.equal(w.laptop.card(t1).title, 'first, edited');
  assert.equal(w.laptopPwa.pendingCount(), 0);
  assert.ok(w.laptop.pendingCount() > 0);
  assert.equal(w.hub.card(t1), null);

  // Meanwhile, on the ground, the phone has been used.
  const fromPhone = w.phone.createCard({ title: 'from the phone' }, { list: 'home' });
  await w.phone.sync(w.hub);

  // Landing.
  await syncAll(w);
  assert.equal(w.hub.card(t1).title, 'first, edited');
  assert.deepEqual(dump(w.laptop), dump(w.hub));
  assert.equal(w.laptop.pendingCount() + w.laptopPwa.pendingCount() + w.phone.pendingCount(), 0);
  // The phone holds the offline-marked project and what is in it.
  assert.deepEqual(titles(w.phone.list(project).sublists[0].cards), ['first, edited']);
  assert.deepEqual(titles(w.phone.list(project, { showCompleted: true }).sublists[0].cards), ['first, edited', 'done on the plane']);
  assert.equal(w.laptop.card(fromPhone).title, 'from the phone');
  // Changes made through the laptop's server are judged by the hub as the PWA's own.
  assert.equal(w.hub.db.get("SELECT count(*) AS n FROM log WHERE device = 'laptop-pwa'").n > 0, true);
});

test('marking offline brings three levels to the phone, and a count at the edge', async () => {
  const w = world();
  const a = w.laptop.createCard({ title: 'A' }, { list: 'home' });
  const b = w.laptop.createCard({ title: 'B' }, { list: a });
  const c = w.laptop.createCard({ title: 'C' }, { list: b });
  w.laptop.createCard({ title: 'D1' }, { list: c });
  w.laptop.createCard({ title: 'D2' }, { list: c });
  const elsewhere = w.laptop.createCard({ title: 'Elsewhere' }, { list: 'home' });
  await syncAll(w);

  // Nothing is offline unless flagged.
  assert.equal(w.phone.card(a), null);

  // The flag is a property of the card, the same on every device.
  w.laptop.edit(a, { offline: true });
  await syncAll(w);
  assert.equal(w.phone.card(a).offline, 1);
  assert.deepEqual(titles(w.phone.list(a).sublists[0].cards), ['B']);
  assert.deepEqual(titles(w.phone.list(b).sublists[0].cards), ['C']);
  assert.deepEqual(titles(w.phone.list(c).sublists[0].cards), []);
  assert.equal(w.phone.countNotHeld(c), 2);
  assert.equal(w.phone.card(elsewhere), null);
  // A held card can say where it belongs.
  assert.deepEqual(titles(w.phone.memberships(a).lists), ['Home']);

  // C can be marked offline from the phone, to be filled in at the next sync.
  w.phone.edit(c, { offline: true });
  await syncAll(w);
  assert.deepEqual(titles(w.phone.list(c).sublists[0].cards), ['D1', 'D2']);

  // New cards can be made on the phone while offline, and edits flow back.
  const made = w.phone.createCard({ title: 'made on the phone' }, { list: b });
  w.phone.edit(b, { title: 'B, renamed on the phone' });
  await syncAll(w);
  assert.equal(w.laptop.card(b).title, 'B, renamed on the phone');
  assert.deepEqual(titles(w.laptop.list(b).sublists[0].cards), ['C', 'made on the phone']);
  assert.equal(w.laptop.card(made).type, 'task');

  // Unmarking lets the cards go from the phone.
  w.laptop.edit(a, { offline: false });
  w.laptop.edit(c, { offline: false });
  await syncAll(w);
  assert.equal(w.phone.card(b), null);
  const { mine, theirs } = heldVersusHub(w.phone, w.hub);
  assert.deepEqual(mine, theirs);
});

test('a Dynamic card marked offline brings what it finds, and runs on the phone', async () => {
  const w = world();
  const p = w.laptop.createCard({ title: 'P' }, { list: 'home' });
  const t1 = w.laptop.createCard({ title: 'on the plane 1' }, { list: p });
  const t2 = w.laptop.createCard({ title: 'on the plane 2' }, { list: p });
  w.laptop.createCard({ title: 'not tagged' }, { list: p });
  w.laptop.tag(t1, 'WorkOnPlane');
  w.laptop.tag(t2, 'WorkOnPlane');
  const saved = w.laptop.createCard({ type: 'dynamic', title: 'Plane, not done' });
  w.laptop.edit(saved, { query: "tagged('WorkOnPlane') AND done = 0", offline: true });
  await syncAll(w);

  assert.deepEqual(titles(w.phone.list(saved).sublists[0].cards), ['on the plane 1', 'on the plane 2']);
  // A change made on the phone shows in the results at once, with no connection.
  w.phone.complete(t1);
  assert.deepEqual(titles(w.phone.list(saved).sublists[0].cards), ['on the plane 2']);
  await syncAll(w);
  assert.deepEqual(titles(w.laptop.list(saved).sublists[0].cards), ['on the plane 2']);
});

test('opening a card on a partial copy fetches it and its List', async () => {
  const w = world();
  const p = w.laptop.createCard({ title: 'P' }, { list: 'home' });
  const x = w.laptop.createCard({ title: 'x' }, { list: p });
  w.laptop.createCard({ title: 'inside x' }, { list: x });
  await syncAll(w);
  assert.equal(w.laptopPwa.card(p), null);

  w.laptopPwa.hold('home');
  w.laptopPwa.hold(p);
  await w.laptopPwa.sync(w.laptop);
  assert.deepEqual(titles(w.laptopPwa.list('home').sublists.at(-1).cards), ['P']);
  assert.deepEqual(titles(w.laptopPwa.list(p).sublists[0].cards), ['x']);
  assert.equal(w.laptopPwa.countNotHeld(x), 1);

  w.laptopPwa.release(p);
  await w.laptopPwa.sync(w.laptop);
  assert.equal(w.laptopPwa.card(x), null);
  assert.equal(w.laptopPwa.card(p).title, 'P'); // still held, as an item of Home
});

test('purge: trashed cards are emptied for good, everywhere', async () => {
  const w = world();
  const p = w.laptop.createCard({ title: 'P' }, { list: 'home' });
  const t = w.laptop.createCard({ title: 'secret', note: 'gone' }, { list: p });
  await syncAll(w);
  w.laptop.trash(t);
  await syncAll(w);
  assert.equal(w.hub.purge(7), 0); // not old enough
  assert.equal(w.hub.purge(-1), 1);
  await syncAll(w);
  for (const d of [w.hub, w.laptop]) {
    assert.equal(d.card(t), null);
    assert.equal(d.db.get('SELECT title, note FROM card WHERE id = ?', [t]).note, '');
    assert.equal(d.list('trash').sublists[0].cards.length, 0);
    assert.equal(d.search('secret').length, 0);
  }
  assert.deepEqual(dump(w.laptop), dump(w.hub));
});

test('a device overriding another twice in a row raises one conflict, not two', async () => {
  const w = world();
  const card = w.laptopPwa.createCard({ title: 'Original' }, { list: 'home' });
  w.laptopPwa.hold('home');
  w.phone.hold('home');
  await syncAll(w);
  const dead = { receive: async () => { throw new Error('no hub'); }, serve: async () => { throw new Error('no hub'); } };

  // The hub is away. The laptop's PWA saves a half-typed title, then the finished one, and the
  // laptop's server tries the hub in between, so the two cannot be merged into one change.
  w.laptopPwa.edit(card, { title: 'Name from lap' });
  await w.laptopPwa.sync(w.laptop);
  await assert.rejects(w.laptop.push(dead));
  w.laptopPwa.edit(card, { title: 'Name from laptop' });
  await w.laptopPwa.sync(w.laptop);
  // Meanwhile the phone renames it, and reaches the hub first.
  w.phone.edit(card, { title: 'Name from phone' });
  await w.phone.sync(w.hub);

  await syncAll(w);
  for (const d of [w.hub, w.laptop, w.laptopPwa, w.phone]) {
    assert.equal(d.card(card).title, 'Name from laptop');
    const conflicts = d.conflictsFor(card);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].other, 'Name from phone');
  }
});
