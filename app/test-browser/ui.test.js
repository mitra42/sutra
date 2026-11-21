// Browser tests: the screen, driven in Chrome. Run with "npm run test:browser".
// Each test starts its own server with empty data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, drag, layout } from './helpers.js';

const make = (sutra, title, list, sublist = null) => sutra.createCard({ title }, { list, sublist });

test('a new item typed in a List is saved', async () => {
  const t = await start();
  try {
    const list = make(t.sutra, 'Groceries', 'home');
    await t.show(list);
    await t.page.locator('sutra-list button', { hasText: '+ Add item' }).first().click();
    const box = t.page.locator('sutra-list input.add').first();
    await box.fill('Milk');
    await box.press('Enter');
    await t.page.keyboard.type('Bread');
    await t.page.keyboard.press('Enter');
    assert.ok(await t.until(() => layout(t.sutra, list)[0] === '-: Milk,Bread'), layout(t.sutra, list).join(' | '));
    assert.deepEqual(t.errors, []);
  } finally { await t.stop(); }
});

test('several chosen cards dragged onto a heading all land under it, in order (bug 21 Nov)', async () => {
  const t = await start();
  try {
    const list = make(t.sutra, 'Project', 'home');
    const h2 = t.sutra.addSublist(list, 'Later');
    const ids = {};
    for (const title of ['a', 'b', 'c', 'd']) ids[title] = make(t.sutra, title, list);
    make(t.sutra, 'e', list, h2);
    await t.show(list);
    const row = (title) => t.page.locator(`sutra-list .row[data-id="${ids[title]}"]`).first();
    await t.page.keyboard.down('Meta');
    await row('b').click({ position: { x: 3, y: 3 } });
    await row('d').click({ position: { x: 3, y: 3 } });
    await t.page.keyboard.up('Meta');
    await drag(t.page, row('b').locator('.grip'), t.page.locator(`sutra-list .heading[data-sublist="${h2}"]`).first());
    assert.ok(await t.until(() => layout(t.sutra, list).join(' | ') === '-: a,c | Later: b,d,e'), layout(t.sutra, list).join(' | '));
  } finally { await t.stop(); }
});

test('a plain click on one row then Cmd-click on another chooses both, as in Finder (bug 21 Nov, second report)', async () => {
  const t = await start();
  try {
    const list = make(t.sutra, 'Project', 'home');
    const h2 = t.sutra.addSublist(list, 'Later');
    const ids = {};
    for (const title of ['a', 'b', 'c']) ids[title] = make(t.sutra, title, list);
    make(t.sutra, 'e', list, h2);
    await t.show(list);
    const row = (title) => t.page.locator(`sutra-list .row[data-id="${ids[title]}"]`).first();
    await row('a').click({ position: { x: 3, y: 3 } });
    await t.page.waitForTimeout(400);
    await t.page.keyboard.down('Meta');
    await row('b').click({ position: { x: 3, y: 3 } });
    await t.page.keyboard.up('Meta');
    assert.match(await t.page.locator('sutra-list .chosen b').first().innerText(), /2 chosen/);
    await drag(t.page, row('b').locator('.grip'), t.page.locator(`sutra-list .heading[data-sublist="${h2}"]`).first());
    assert.ok(await t.until(() => layout(t.sutra, list).join(' | ') === '-: c | Later: a,b,e'), layout(t.sutra, list).join(' | '));
  } finally { await t.stop(); }
});

test('entries on the quick-access bar can be reordered by dragging', async () => {
  const t = await start();
  try {
    const one = make(t.sutra, 'One', 'quick');
    make(t.sutra, 'Two', 'quick');
    await t.show('home');
    const before = layout(t.sutra, 'quick').join(' | ');
    const entry = (id) => t.page.locator(`sutra-bar .entry[data-id="${id}"]`);
    const last = t.page.locator('sutra-bar .entry[data-sublist]').last();
    await drag(t.page, entry(one), last, 'bottom');
    const after = await t.until(() => { const now = layout(t.sutra, 'quick').join(' | '); return now !== before && now; });
    assert.ok(after && /Two.*One/.test(after), `${before} → ${after}`);
  } finally { await t.stop(); }
});

test('chosen cards can be added to another List from the strip', async () => {
  const t = await start();
  try {
    const list = make(t.sutra, 'Inbox', 'home');
    const other = make(t.sutra, 'Someday', 'home');
    const ids = {};
    for (const title of ['x', 'y']) ids[title] = make(t.sutra, title, list);
    await t.show(list);
    const row = (title) => t.page.locator(`sutra-list .row[data-id="${ids[title]}"]`).first();
    await t.page.keyboard.down('Meta');
    await row('x').click({ position: { x: 3, y: 3 } });
    await row('y').click({ position: { x: 3, y: 3 } });
    await t.page.keyboard.up('Meta');
    const box = t.page.locator('sutra-list input[data-key="chosen-list"]').first();
    await box.fill('Some');
    await t.page.waitForTimeout(800);
    await box.press('Enter');
    assert.ok(await t.until(() => layout(t.sutra, other)[0] === '-: x,y'), layout(t.sutra, other).join(' | '));
    assert.equal(layout(t.sutra, list)[0], '-: x,y', 'they stay where they were too');
  } finally { await t.stop(); }
});

test('calendar repeats typed in words are understood, and nonsense is refused', async () => {
  const t = await start();
  try {
    const id = make(t.sutra, 'Bins', 'home');
    t.sutra.edit(id, { due: '2026-11-23' });
    await t.show('home', id);
    for (const [words, code] of [['nonsense', null], ['mon thu', 'mon+thu'], ['1st', 'm1'], ['every weekday', 'weekdays'], ['last day of the month', 'mlast']]) {
      const menu = t.page.locator('sutra-card select').filter({ has: t.page.locator('option[value=custom]') });
      if (await menu.count()) await menu.selectOption('custom');
      const input = t.page.locator('sutra-card input[data-key=repeat]');
      await input.fill(words);
      await input.press('Enter');
      if (code) assert.ok(await t.until(() => t.sutra.card(id).repeat === code), `${words} → ${t.sutra.card(id).repeat}`);
      else {
        assert.ok(await input.evaluate((e) => e.classList.contains('bad')), `${words} should be marked`);
        await input.press('Escape');
      }
    }
  } finally { await t.stop(); }
});

test('Notes show formatted, with the Markdown back on the line being edited; a plain click follows a link', async () => {
  const t = await start();
  try {
    const id = make(t.sutra, 'Notes', 'home');
    t.sutra.edit(id, { note: '# Heading\n\nSome **bold** text.\n\nSee [google](https://google.com) here.' });
    await t.show('home', id);
    const lines = () => t.page.locator('.note .cm-line').allInnerTexts();
    assert.deepEqual((await lines()).filter((l) => l.trim()), ['Heading', 'Some bold text.', 'See google here.']);
    await t.page.locator('.note .cm-md-link', { hasText: 'google' }).first().click();
    assert.equal(await t.page.evaluate(() => window.__opened), 'https://google.com/');
    await t.page.locator('.note .cm-line', { hasText: 'Some' }).click({ position: { x: 3, y: 3 } });
    await t.page.waitForTimeout(200);
    assert.ok((await lines()).includes('Some **bold** text.'));
    assert.ok((await lines()).includes('Heading'), 'other lines stay formatted');
    assert.equal(await t.page.locator('.note .cm-md-link', { hasText: 'google' }).first().getAttribute('title'), 'https://google.com');
  } finally { await t.stop(); }
});

test('the link button asks which kind of link, and copies it', async () => {
  const t = await start();
  try {
    await t.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const id = make(t.sutra, 'Linked', 'home');
    await t.show('home', id);
    const copied = () => t.page.evaluate(() => navigator.clipboard.readText());
    await t.page.locator('sutra-card button.link').first().click();
    await t.page.locator('dialog.choose button', { hasText: 'App link' }).click();
    await t.page.waitForTimeout(200);
    assert.equal(await copied(), `web+sutra:${id}`);
    await t.page.locator('sutra-card button.link').first().click();
    await t.page.locator('dialog.choose button', { hasText: 'Web link' }).click();
    await t.page.waitForTimeout(200);
    assert.match(await copied(), new RegExp(`^http://localhost:\\d+/.*#/l/${id}/c/${id}$`));
  } finally { await t.stop(); }
});
