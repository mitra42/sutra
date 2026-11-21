// The test that matters most: devices edit and sync in every order a random run can think of,
// with replies going missing, and must all end up the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { world, device, flaky, dump, heldVersusHub, random } from './helpers.js';

const HEADINGS = ['Now', 'Later', '#blocked by / blocking', '#related'];

function act(replica, rnd) {
  const live = replica.db.all("SELECT id, type FROM card WHERE purged = 0 AND trashed IS NULL AND id NOT IN ('tags', 'trash', 'orphans', 'conflicts')");
  const cards = live.filter((c) => !['home', 'quick'].includes(c.id) && !c.id.startsWith('tag:'));
  const lists = live.filter((c) => c.type !== 'dynamic');
  const one = () => rnd.pick(cards).id;
  const choice = rnd();
  if (!cards.length || choice < 0.2) {
    replica.createCard({ title: `card ${Math.floor(rnd() * 1000)}`, type: rnd.chance(0.8) ? 'task' : 'note' }, { list: rnd.pick(lists).id });
  } else if (choice < 0.35) {
    replica.edit(one(), { title: `title ${Math.floor(rnd() * 1000)}` });
  } else if (choice < 0.45) {
    replica.edit(one(), { note: `note ${Math.floor(rnd() * 1000)}` });
  } else if (choice < 0.52) {
    replica.edit(one(), { due: replica.today(Math.floor(rnd() * 10)), repeat: rnd.pick(['none', 'daily', 'weekly']) });
  } else if (choice < 0.58) {
    replica.complete(one());
  } else if (choice < 0.68) {
    const list = rnd.pick(lists).id;
    const member = one();
    if (list !== member) replica.addToList(list, member);
  } else if (choice < 0.74) {
    const m = replica.db.all('SELECT list_id, member_id FROM membership WHERE removed = 0');
    if (m.length) {
      const pick = rnd.pick(m);
      if (rnd.chance(0.5)) replica.removeFromList(pick.list_id, pick.member_id);
      else replica.move(pick.list_id, pick.member_id, { before: rnd.pick(m.filter((x) => x.list_id === pick.list_id)).member_id });
    }
  } else if (choice < 0.8) {
    const owner = one();
    const heading = rnd.pick(HEADINGS);
    const other = one();
    if (heading.startsWith('#')) {
      if (owner !== other) replica.relate(owner, other, heading);
    } else {
      const sublist = replica.addSublist(owner, heading);
      if (owner !== other) replica.addToList(owner, other, { sublist });
    }
  } else if (choice < 0.85) {
    replica.tag(one(), rnd.pick(['red', 'Green', 'blue']));
  } else if (choice < 0.9) {
    replica.edit(one(), { offline: rnd.chance(0.6) });
  } else if (choice < 0.95) {
    replica.trash(one(), { cascade: rnd.chance(0.5) });
  } else {
    const gone = replica.db.all('SELECT id FROM card WHERE trashed IS NOT NULL AND purged = 0');
    if (gone.length) replica.restore(rnd.pick(gone).id);
  }
}

export async function run(seed) {
  const rnd = random(seed);
  const w = world();
  w.laptop2 = device('laptop2');
  const links = {
    laptopPwa: flaky(w.laptop), laptop: flaky(w.hub), laptop2: flaky(w.hub), phone: flaky(w.hub),
  };
  const names = Object.keys(links);
  w.laptopPwa.hold('home');
  w.phone.hold('home');

  for (let step = 0; step < 160; step += 1) {
    const name = rnd.pick(names);
    if (rnd.chance(0.6)) {
      act(w[name], rnd);
    } else {
      links[name].loseNextReply = rnd.chance(0.15);
      const part = rnd();
      try {
        if (part < 0.6) await w[name].sync(links[name]);
        else if (part < 0.8) await w[name].push(links[name]);
        else await w[name].pull(links[name]);
      } catch (err) {
        assert.equal(err.message, 'reply lost');
      }
      links[name].loseNextReply = false;
    }
    if (rnd.chance(0.01)) w.hub.purge(-1);
  }

  for (let round = 0; round < 4; round += 1) {
    await w.laptopPwa.sync(w.laptop);
    for (const name of ['laptop', 'laptop2', 'phone']) await w[name].sync(w.hub);
    await w.laptopPwa.sync(w.laptop);
  }

  names.forEach((name) => assert.equal(w[name].pendingCount(), 0, `${name} has nothing waiting (seed ${seed})`));
  assert.deepEqual(dump(w.laptop), dump(w.hub), `laptop matches the hub (seed ${seed})`);
  assert.deepEqual(dump(w.laptop2), dump(w.hub), `second laptop matches the hub (seed ${seed})`);
  for (const name of ['phone', 'laptopPwa']) {
    const { mine, theirs } = heldVersusHub(w[name], w.hub);
    assert.deepEqual(mine, theirs, `${name} matches the hub for what it holds (seed ${seed})`);
    // Nothing is kept beyond what is in scope.
    for (const tbl of ['sublist', 'membership', 'conflict']) {
      const extra = w[name].db.get(`SELECT count(*) AS n FROM ${tbl} WHERE id NOT IN (SELECT id FROM held WHERE tbl = ?)`, [tbl]).n;
      assert.equal(extra, 0, `${name} holds no stray ${tbl} rows (seed ${seed})`);
    }
  }
  // Versions agree too, so the next edit anywhere starts from the same footing.
  const versions = (r) => r.db.all('SELECT tbl, row, field, seq FROM version ORDER BY tbl, row, field').map((v) => ({ ...v }));
  assert.deepEqual(versions(w.laptop), versions(w.hub), `versions match (seed ${seed})`);
  return w;
}

test('random edits and syncs on five devices always converge', async () => {
  for (let seed = 1; seed <= 60; seed += 1) await run(seed);
});
