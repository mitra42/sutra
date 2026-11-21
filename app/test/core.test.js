// One copy on its own: cards, Lists, dates, deleting, queries, relationships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { between, parseRepeat, repeatWords } from '../core/index.js';
import { device } from './helpers.js';

const titles = (cards) => cards.map((c) => c.title);

test('positions fall between their neighbours', () => {
  const first = between('', '');
  const second = between(first, '');
  const middle = between(first, second);
  const tighter = between(first, middle);
  const before = between('', first);
  assert.ok(before < first && first < tighter && tighter < middle && middle < second);
  let low = first;
  for (let i = 0; i < 200; i += 1) {
    const next = between(low, second);
    assert.ok(low < next && next < second, `${low} < ${next} < ${second}`);
    low = next;
  }
});

test('a List keeps its order, its headings, and unfiled items', () => {
  const s = device('solo');
  const project = s.createCard({ title: 'Project' }, { list: 'home' });
  const week = s.addSublist(project, 'This week');
  const later = s.addSublist(project, 'Later');
  const a = s.createCard({ title: 'a' }, { list: project, sublist: week });
  const c = s.createCard({ title: 'c' }, { list: project, sublist: week });
  s.createCard({ title: 'b' }, { list: project, sublist: week, after: a });
  s.createCard({ title: 'first' }, { list: project, sublist: week, before: a });
  s.createCard({ title: 'loose' }, { list: project });
  s.createCard({ title: 'z', type: 'note' }, { list: project, sublist: later });

  let list = s.list(project);
  assert.deepEqual(list.sublists.map((x) => x.heading), [null, 'This week', 'Later']);
  assert.deepEqual(titles(list.sublists[0].cards), ['loose']);
  assert.deepEqual(titles(list.sublists[1].cards), ['first', 'a', 'b', 'c']);

  // Headings can be reordered.
  s.moveSublist(later, { before: week });
  assert.deepEqual(s.list(project).sublists.map((x) => x.heading), [null, 'Later', 'This week']);
  s.moveSublist(later, { after: week });
  assert.deepEqual(s.list(project).sublists.map((x) => x.heading), [null, 'This week', 'Later']);
  s.moveSublist(week);
  s.moveSublist(week, { before: later });

  s.move(project, c, { sublist: later });
  s.removeSublist(week);
  list = s.list(project);
  assert.deepEqual(list.sublists.map((x) => x.heading), [null, 'Later']);
  assert.deepEqual(titles(list.sublists[0].cards), ['loose', 'first', 'a', 'b']);
  assert.deepEqual(titles(list.sublists[1].cards), ['z', 'c']);

  // On Home the unfiled items come last.
  s.addSublist('home', 'Pinned');
  assert.deepEqual(s.list('home').sublists.map((x) => x.heading), ['Pinned', null]);
});

test('a card can be in several Lists and shows them all', () => {
  const s = device('solo');
  const one = s.createCard({ title: 'One' }, { list: 'home' });
  const two = s.createCard({ title: 'Two' }, { list: 'home' });
  const task = s.createCard({ title: 'task' }, { list: one });
  s.addToList(two, task);
  s.addToList(task, one); // loops are allowed
  assert.deepEqual(titles(s.memberships(task).lists), ['One', 'Two']);
  s.removeFromList(one, task);
  assert.deepEqual(titles(s.memberships(task).lists), ['Two']);
  assert.deepEqual(titles(s.list(one).sublists[0].cards), []);
});

test('completing: ordinary tasks are completed and hidden, repeating tasks move on', () => {
  const s = device('solo');
  const once = s.createCard({ title: 'once' }, { list: 'home' });
  const weekly = s.createCard({ title: 'weekly' }, { list: 'home' });
  const daily = s.createCard({ title: 'daily' }, { list: 'home' });
  s.edit(weekly, { repeat: 'weekly', due: '2026-11-10', overdue: '2026-11-17' });
  s.edit(daily, { repeat: 'daily', overdue: '2026-11-12' });

  s.complete(once, '2026-11-15');
  s.complete(weekly, '2026-11-15');
  s.complete(daily, '2026-11-15');

  assert.equal(s.card(once).completed, '2026-11-15');
  // Counted from the day it was done, not from the old due date; the gap of 7 days is kept.
  assert.equal(s.card(weekly).completed, null);
  assert.equal(s.card(weekly).due, '2026-11-22');
  assert.equal(s.card(weekly).overdue, '2026-11-29');
  assert.equal(s.card(daily).due, null);
  assert.equal(s.card(daily).overdue, '2026-11-16');

  assert.deepEqual(titles(s.list('home').sublists.at(-1).cards), ['weekly', 'daily']);
  assert.deepEqual(titles(s.list('home', { showCompleted: true }).sublists.at(-1).cards), ['once', 'weekly', 'daily']);
  s.uncomplete(once);
  assert.equal(s.card(once).completed, null);

  // Custom repeats: a number and a unit.
  const custom = s.createCard({ title: 'every 3 days' });
  s.edit(custom, { repeat: '3d', due: '2026-11-01', overdue: '2026-11-03' });
  s.complete(custom, '2026-11-15');
  assert.deepEqual([s.card(custom).due, s.card(custom).overdue], ['2026-11-18', '2026-11-20']);
  s.edit(custom, { repeat: '2w' });
  s.complete(custom, '2026-11-15');
  assert.equal(s.card(custom).due, '2026-11-29');
  s.edit(custom, { repeat: '6m' });
  s.complete(custom, '2026-11-15');
  assert.equal(s.card(custom).due, '2027-05-15');
  // Calendar repeats: the first matching day after the day it was done (15 Nov 2026 is a Sunday).
  const cal = s.createCard({ title: 'calendar' });
  const after = (repeat, done, due = '2026-11-01', overdue = null) => {
    s.edit(cal, { repeat, due, overdue });
    s.complete(cal, done);
    return [s.card(cal).due, s.card(cal).overdue];
  };
  assert.deepEqual(after('mon', '2026-11-15'), ['2026-11-16', null]);
  assert.deepEqual(after('mon', '2026-11-16'), ['2026-11-23', null]);
  assert.deepEqual(after('mon+thu', '2026-11-16'), ['2026-11-19', null]);
  assert.deepEqual(after('weekdays', '2026-11-20'), ['2026-11-23', null]);
  assert.deepEqual(after('m1', '2026-11-15', '2026-11-01', '2026-11-04'), ['2026-12-01', '2026-12-04']);
  assert.deepEqual(after('m1', '2026-12-01'), ['2027-01-01', null]);
  assert.deepEqual(after('m31', '2027-01-31'), ['2027-02-28', null]);
  assert.deepEqual(after('mlast', '2026-11-15'), ['2026-11-30', null]);
  assert.deepEqual(after('mlast', '2026-11-30'), ['2026-12-31', null]);
  assert.throws(() => s.edit(cal, { repeat: 'm32' }));

  assert.throws(() => s.edit(custom, { repeat: 'sometimes' }));
  assert.throws(() => s.edit(custom, { repeat: '0d' }));

  const monthly = s.createCard({ title: 'monthly' });
  s.edit(monthly, { repeat: 'monthly', due: '2026-01-31' });
  s.complete(monthly, '2026-12-15');
  assert.equal(s.card(monthly).due, '2027-01-15');
});

test('repeats typed in words are read, and shown in words', () => {
  const cases = [['3 days', '3d'], ['2w', '2w'], ['every 6 months', '6m'], ['Monday', 'mon'], ['mon thu', 'mon+thu'], ['Thursday and Monday', 'mon+thu'],
    ['every weekday', 'weekdays'], ['1st', 'm1'], ['15', 'm15'], ['on the 15th of each month', 'm15'], ['last', 'mlast'], ['last day of the month', 'mlast'], ['daily', 'daily'], ['sometimes', null], ['32nd', null]];
  cases.forEach(([text, code]) => assert.equal(parseRepeat(text), code, text));
  assert.equal(repeatWords('mon+thu'), 'every Monday and Thursday');
  assert.equal(repeatWords('mon+wed+fri'), 'every Mon, Wed and Fri');
  assert.equal(repeatWords('m1'), '1st of the month');
  assert.equal(repeatWords('m22'), '22nd of the month');
  assert.equal(repeatWords('mlast'), 'last day of the month');
  assert.equal(repeatWords('3d'), 'every 3 days');
});

test('sorting is a view and never changes the stored order', () => {
  const s = device('solo');
  const p = s.createCard({ title: 'P' });
  const b = s.createCard({ title: 'b' }, { list: p });
  const a = s.createCard({ title: 'A' }, { list: p });
  s.createCard({ title: 'c' }, { list: p });
  s.edit(a, { due: '2026-12-01' });
  s.edit(b, { due: '2026-11-20' });
  assert.deepEqual(titles(s.list(p, { sort: 'title' }).sublists[0].cards), ['A', 'b', 'c']);
  assert.deepEqual(titles(s.list(p, { sort: 'due' }).sublists[0].cards), ['b', 'A', 'c']);
  // Within one due day, the one that becomes overdue sooner comes first; overdue-only dates count.
  const [x, y, z] = ['x', 'y', 'z'].map((t) => s.createCard({ title: t }, { list: p }));
  s.edit(x, { due: '2026-11-20', overdue: '2026-11-25' });
  s.edit(y, { due: '2026-11-20', overdue: '2026-11-22' });
  s.edit(z, { overdue: '2026-11-19' });
  assert.deepEqual(titles(s.list(p, { sort: 'due' }).sublists[0].cards), ['z', 'y', 'x', 'b', 'A', 'c']);
  [x, y, z].forEach((id) => s.removeFromList(p, id));
  assert.deepEqual(titles(s.list(p).sublists[0].cards), ['b', 'A', 'c']);
});

test('deleting: Trash, "delete cards not in any other list?", Orphans, restore', () => {
  const s = device('solo');
  const keep = s.createCard({ title: 'Keep' }, { list: 'home' });
  const workshop = s.createCard({ title: 'While at Workshop' }, { list: 'home' });
  const shared = s.createCard({ title: 'shared' }, { list: keep });
  s.addToList(workshop, shared);
  const only = s.createCard({ title: 'only here' }, { list: workshop });
  const deeper = s.createCard({ title: 'deeper' }, { list: only });
  s.tag(only, 'urgent'); // a tag is not a home

  assert.deepEqual(new Set(s.wouldOrphan(workshop)), new Set([only, deeper]));

  // "No": the cards are left and become orphans.
  s.trash(workshop);
  assert.deepEqual(titles(s.list('home').sublists.at(-1).cards), ['Keep']);
  assert.deepEqual(titles(s.list('orphans').sublists[0].cards), ['only here']);
  assert.deepEqual(titles(s.list('trash').sublists[0].cards), ['While at Workshop']);
  assert.deepEqual(titles(s.memberships(shared).lists), ['Keep']);

  // Restoring is trivial: the card is still in its Lists.
  s.restore(workshop);
  assert.deepEqual(titles(s.list('home').sublists.at(-1).cards), ['Keep', 'While at Workshop']);
  assert.deepEqual(titles(s.list('orphans').sublists[0].cards), []);

  // "Yes": they go too, and come back together.
  assert.deepEqual(new Set(s.trash(workshop, { cascade: true })), new Set([workshop, only, deeper]));
  assert.equal(s.card(shared).trashed, null);
  assert.equal(s.list('trash').sublists[0].cards.length, 3);
  assert.deepEqual(titles(s.list('orphans').sublists[0].cards), []);
  s.restore(only);
  assert.equal(s.list('trash').sublists[0].cards.length, 0);
  assert.deepEqual(titles(s.list(workshop).sublists[0].cards), ['shared', 'only here']);

  assert.throws(() => s.trash('home'));
});

test('a card can become a Person or a Company, but not a query', () => {
  const s = device('solo');
  const c = s.createCard({ title: 'Jane' }, { list: 'home' });
  s.edit(c, { type: 'person' });
  assert.equal(s.card(c).type, 'person');
  assert.deepEqual(s.query("type = 'person'"), [c]);
  assert.throws(() => s.edit(c, { type: 'dynamic' }));
  assert.throws(() => s.edit('tags', { type: 'task' }));
});

test('tags are cards, and tagging is adding to a List', () => {
  const s = device('solo');
  const task = s.createCard({ title: 'task' }, { list: 'home' });
  s.tag(task, '#UseAI');
  s.tag(task, 'urgent');
  assert.deepEqual(titles(s.memberships(task).tags), ['#urgent', '#UseAI']);
  assert.deepEqual(titles(s.list('tags').sublists[0].cards), ['#urgent', '#UseAI']);
  assert.deepEqual(titles(s.list(s.tagCard('useai')).sublists[0].cards), ['task']);
  s.untag(task, 'urgent');
  assert.deepEqual(titles(s.memberships(task).tags), ['#UseAI']);
  // A card made by hand and titled like a tag is that tag: tagging finds it, and makes no second one.
  const hut = s.createCard({ type: 'note', title: '#🛖' });
  s.tag(task, '🛖');
  assert.equal(s.tagCard('#🛖'), hut);
  assert.deepEqual(titles(s.list(hut).sublists[0].cards), ['task']);
  assert.equal(s.query("title = '#🛖'").length, 1);
  s.untag(task, '🛖');
  assert.deepEqual(titles(s.list(hut).sublists[0].cards), []);
  s.trash(hut);

  // Tag cards are in no List but are not orphans.
  assert.deepEqual(titles(s.list('orphans').sublists[0].cards), []);
});

test('queries: fields, helper words, regular expressions', () => {
  const s = device('solo');
  const work = s.createCard({ title: 'Work Priorities' }, { list: 'home' });
  const a = s.createCard({ title: 'Call Fred' }, { list: work });
  const b = s.createCard({ title: 'Draft budget', note: 'ask fred about C++ costs' }, { list: work });
  const c = s.createCard({ title: 'Elsewhere' }, { list: 'home' });
  const n = s.createCard({ title: 'A note', type: 'note' }, { list: work });
  s.tag(a, 'UseAI');
  s.tag(c, 'UseAI');
  s.edit(a, { due: s.today() });
  s.edit(b, { due: s.today(3) });
  s.complete(c);
  const found = (where) => s.query(where).map((id) => s.card(id).title);

  assert.deepEqual(found("type = 'task' AND tagged('UseAI') AND in_list('Work Priorities')"), ['Call Fred']);
  assert.deepEqual(found("tagged('#useai')"), ['Call Fred', 'Elsewhere']);
  assert.deepEqual(found(`in_list('${work}')`), ['A note', 'Call Fred', 'Draft budget']);
  assert.deepEqual(found("type = 'task' AND due <= today() AND done = 0"), ['Call Fred']);
  assert.deepEqual(found('due > today() AND due <= today(7)'), ['Draft budget']);
  assert.deepEqual(found("title REGEXP 'fred' OR note REGEXP 'fred'"), ['Call Fred', 'Draft budget']);
  assert.deepEqual(found("title REGEXP '^(call|draft)'"), ['Call Fred', 'Draft budget']);
  assert.deepEqual(found('done = 1'), ['Elsewhere']);
  // A helper word inside quoted text is just text.
  assert.deepEqual(found("title = 'tagged(''x'')'"), []);

  // The Search box runs a query when it looks like one, and searches for the words otherwise.
  assert.deepEqual(s.search("tagged('UseAI') AND done = 0").map((id) => s.card(id).title), ['Call Fred']);
  assert.deepEqual(s.search('Note is about costs').length, 0);
  assert.deepEqual(s.search('due <= today()').map((id) => s.card(id).title), ['Call Fred']);
  assert.deepEqual(s.search('tagged(').length, 0);
  // Double quotes, a leading #, or no quotes at all: all mean the tag.
  for (const q of ['tagged("UseAI")', 'tagged("#UseAI")', 'tagged(UseAI)', 'tagged(#UseAI) AND done = 0']) {
    assert.ok(s.search(q).includes(a), q);
  }

  // The Search box: a word or phrase in title or Note; not a valid expression means plain text.
  assert.deepEqual(new Set(s.search('fred').map((id) => s.card(id).title)), new Set(['Call Fred', 'Draft budget']));
  assert.deepEqual(s.search('C++').map((id) => s.card(id).title), ['Draft budget']);
  // Search covers Trash; queries do not unless they say so.
  s.trash(a);
  assert.ok(s.search('call fred').includes(a));
  assert.deepEqual(found("title REGEXP 'fred'"), []);
  assert.deepEqual(found("title REGEXP 'fred' AND trashed IS NOT NULL"), ['Call Fred']);

  // A query can only ask.
  assert.throws(() => s.query("1 = 1; DELETE FROM card"));
  assert.throws(() => s.query('1 = 1 -- x'));
  assert.throws(() => s.query("id IN (SELECT id FROM card) OR title = (DELETE FROM card)"));
  assert.equal(s.card(n).title, 'A note');
});

test('relationships: one entry, seen from both ends, and not a home', () => {
  const s = device('solo');
  const a = s.createCard({ title: 'A' }, { list: 'home' });
  const b = s.createCard({ title: 'B' }, { list: 'home' });
  const c = s.createCard({ title: 'C' });
  s.relate(a, b, '#blocked by / blocking');
  s.relate(a, c, '#blocked by / blocking');
  s.relate(b, c, '#related');

  const listA = s.list(a);
  // Not among the List's ordinary items.
  assert.deepEqual(titles(listA.sublists[0].cards), []);
  assert.deepEqual(listA.relationships.map((r) => [r.label, titles(r.cards)]), [['blocked by', ['B', 'C']]]);
  // On B it reads the other way, and B needed no entry of its own.
  assert.deepEqual(s.memberships(b).relationships.map((r) => [r.label, r.card.title]), [['blocking', 'A']]);
  assert.deepEqual(s.memberships(b).lists.map((l) => l.title), ['Home']);
  assert.deepEqual(s.memberships(c).relationships.map((r) => [r.label, r.card.title]).sort(), [['blocking', 'A'], ['related', 'B']]);

  const found = (where) => s.query(where).map((id) => s.card(id).title);
  assert.deepEqual(found("rel('blocked by')"), ['A']);
  assert.deepEqual(found("rel('blocking')"), ['B', 'C']);
  assert.deepEqual(found("rel('related')"), ['B', 'C']);
  assert.deepEqual(found("type = 'task' AND done = 0 AND NOT rel('blocked by')"), ['B', 'C']);

  // C is only in relationships, so it is an orphan, and deleting A never takes it along.
  assert.deepEqual(titles(s.list('orphans').sublists[0].cards), ['C']);
  assert.deepEqual(s.wouldOrphan(a), []);

  s.unrelate(a, b);
  assert.deepEqual(found("rel('blocking')"), ['C']);
});

test('undo puts back what an action changed, and unmakes what it made', () => {
  const s = device('solo');
  const p = s.createCard({ title: 'P' }, { list: 'home' });
  const a = s.createCard({ title: 'a' }, { list: p });
  s.edit(a, { due: '2026-12-01' });

  const edit = s.record(() => s.edit(a, { title: 'changed', due: null }));
  assert.equal(s.card(a).title, 'changed');
  s.revert(edit.undo);
  assert.equal(s.card(a).title, 'a');
  assert.equal(s.card(a).due, '2026-12-01');

  // A card that the action created goes to Trash; the List no longer shows it.
  const made = s.record(() => s.createCard({ title: 'b' }, { list: p }));
  assert.deepEqual(titles(s.list(p).sublists[0].cards), ['a', 'b']);
  s.revert(made.undo);
  assert.deepEqual(titles(s.list(p).sublists[0].cards), ['a']);
  assert.ok(s.card(made.result).trashed);

  // Deleting with "Yes", undone in one step.
  const gone = s.record(() => s.trash(p, { cascade: true }));
  assert.equal(s.list('trash').sublists[0].cards.length, 3);
  s.revert(gone.undo);
  assert.deepEqual(titles(s.list('home').sublists.at(-1).cards), ['P']);
  assert.deepEqual(titles(s.list(p).sublists[0].cards), ['a']);

  // A move, undone.
  const c = s.createCard({ title: 'c' }, { list: p });
  const moved = s.record(() => s.move(p, c, { before: a }));
  assert.deepEqual(titles(s.list(p).sublists[0].cards), ['c', 'a']);
  s.revert(moved.undo);
  assert.deepEqual(titles(s.list(p).sublists[0].cards), ['a', 'c']);
});

test('a card moved ahead of the first card under a heading lands ahead of it, whatever the ids (bug 21 Nov)', () => {
  // The card's old position, from the unfiled part, equals the first heading card's position.
  // Before the fix it was counted among its own new neighbours and could land after that card.
  for (const [mover, other] of [['0-mover', 'z-other'], ['z-mover', '0-other']]) {
    const sutra = device('laptop');
    const list = sutra.createCard({ title: 'Project' }, { list: 'home' });
    const later = sutra.addSublist(list, 'Later');
    sutra.createCard({ id: mover, title: 'mover' }, { list });
    sutra.createCard({ id: other, title: 'other' }, { list, sublist: later });
    sutra.addToList(list, mover, { sublist: later, before: other });
    const heading = sutra.list(list).sublists.find((s) => s.id === later);
    assert.deepEqual(heading.cards.map((c) => c.title), ['mover', 'other'], `ids ${mover}, ${other}`);
  }
});
