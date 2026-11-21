#!/usr/bin/env node
// Copies the test pages and SQLite's files into ./site, a self-contained folder of plain files
// that can be uploaded to any https web server (for the iPhone tests). Not needed on the laptop.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(dir, 'site');
fs.rmSync(site, { recursive: true, force: true });
fs.cpSync(path.join(dir, 'public'), site, { recursive: true });
fs.mkdirSync(path.join(site, 'sqlite'));
for (const f of ['index.mjs', 'sqlite3.wasm', 'sqlite3-opfs-async-proxy.js']) {
  fs.copyFileSync(path.join(dir, 'node_modules/@sqlite.org/sqlite-wasm/dist', f), path.join(site, 'sqlite', f));
}
console.log('Wrote', site);
