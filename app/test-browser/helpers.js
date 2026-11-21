// Shared set-up for the browser tests: a fresh Sutra server with its own data, and a Chrome
// window on it. Uses the Chrome installed on this machine (playwright-core downloads no browser).
// To use another Chromium, set SUTRA_CHROME to its program file.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from '../server.js';

export async function start(options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-browser-'));
  // The server only answers pages addressed to its own port, so find a free one first.
  const port = await new Promise((resolve) => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); }); });
  const server = createServer({ port, dataDir, ...options });
  const listener = await new Promise((resolve) => { const l = server.app.listen(port, '127.0.0.1', () => resolve(l)); });
  // (localhost rather than 127.0.0.1: a passkey can't be tied to a bare address.)
  const url = `http://localhost:${port}/`;
  const browser = await chromium.launch(process.env.SUTRA_CHROME ? { executablePath: process.env.SUTRA_CHROME } : { channel: 'chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { window.open = (u) => { window.__opened = u; }; });
  return {
    sutra: server.sutra, page, errors, url, dataDir, context,
    // Opens a List on the left and a card on the right, and waits for them to draw.
    async show(list, card = list) {
      await page.goto(`${url}#/l/${encodeURIComponent(list)}/c/${encodeURIComponent(card)}`);
      await page.waitForSelector('sutra-list .row[data-id], sutra-list .quiet', { timeout: 10000 });
      await page.waitForTimeout(500);
    },
    // Waits until the server's copy agrees (the page saves to its own copy, then sends it on).
    async until(test, ms = 8000) {
      const end = Date.now() + ms;
      for (;;) {
        const value = test();
        if (value || Date.now() > end) return value;
        await new Promise((r) => setTimeout(r, 250));
      }
    },
    async stop() {
      await browser.close();
      listener.close();
      server.stopTimers();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// A drag made of the browser's own drag events (Playwright's mouse drags are unreliable with
// HTML drag and drop). `where` is 'top' or 'bottom' of the target.
export async function drag(page, from, to, where = 'top') {
  const source = await from.elementHandle();
  const target = await to.elementHandle();
  await page.evaluate(([s, t, w]) => {
    const data = new DataTransfer();
    const box = t.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: w === 'top' ? box.top + 2 : box.bottom - 2 };
    const fire = (el, type, extra = {}) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, ...extra }));
    fire(s, 'dragstart');
    fire(t, 'dragenter', at);
    fire(t, 'dragover', at);
    fire(t, 'drop', at);
    fire(s, 'dragend');
  }, [source, target, where]);
  await page.waitForTimeout(600);
}

// Titles of a List as the server has it, heading by heading.
export function layout(sutra, listId) {
  return sutra.list(listId, { showCompleted: true }).sublists.map((s) => `${s.heading || '-'}: ${s.cards.map((c) => c.title).join(',')}`);
}
