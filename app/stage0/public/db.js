import { el, table, installed, registerServiceWorker, nav, environmentRows } from './common.js';

const worker = new Worker('./db-worker.js', { type: 'module' });
const waiting = new Map();
let nextId = 1;

function ask(op, args) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, op, args });
  });
}

worker.onmessage = (event) => {
  const { id, result, error } = event.data;
  const { resolve, reject } = waiting.get(id);
  waiting.delete(id);
  if (error) reject(new Error(error)); else resolve(result);
};

// How one tab tells the others that the database changed.
const channel = new BroadcastChannel('sutra-stage0');
channel.onmessage = () => show();

const out = document.getElementById('out');
const tabName = `tab ${Math.random().toString(36).slice(2, 6)}`;

async function show() {
  const s = await ask('state');
  out.replaceChildren(
    table([
      ['Storage method in use', el('span', { class: 'ok' }, s.method)],
      ['SQLite version', s.sqliteVersion],
      ['Database first created (UTC)', s.created],
      ['Times this page has been opened', String(s.visitCount)],
      ['Rows in the notes table', String(s.noteCount)],
    ]),
    el('h2', {}, 'Recent visits (UTC)'),
    table(s.visits.map((v) => [v.at, v.installed ? 'installed app' : 'browser'])),
    el('h2', {}, 'Latest rows'),
    s.notes.length ? table(s.notes.map((n) => [String(n.id), n.text, n.at])) : el('p', { class: 'note' }, 'None yet.'),
  );
  document.getElementById('env').replaceChildren(table(await environmentRows()));
}

async function start() {
  const wanted = localStorage.getItem('sutra-stage0-method') || 'auto';
  document.getElementById('method').value = wanted;
  try {
    const opened = await ask('open', { wanted });
    if (opened.failures.length) {
      document.getElementById('tried').textContent = `Tried first and failed: ${opened.failures.join('; ')}`;
    }
    await ask('visit', { installed: installed() });
    channel.postMessage('changed');
    await show();
  } catch (err) {
    out.replaceChildren(el('p', { class: 'bad' }, err.message));
  }
}

document.getElementById('nav').append(nav());
document.getElementById('tab').textContent = tabName;

document.getElementById('method').onchange = (event) => {
  localStorage.setItem('sutra-stage0-method', event.target.value);
  location.reload();
};

document.getElementById('add').onclick = async () => {
  await ask('add', { text: `Row added from ${tabName}` });
  channel.postMessage('changed');
  show();
};

document.getElementById('persist').onclick = async () => {
  const granted = await navigator.storage.persist();
  document.getElementById('persisted').textContent = granted ? 'Granted.' : 'Not granted.';
  show();
};

document.getElementById('search').onclick = async () => {
  const found = document.getElementById('found');
  try {
    const hits = await ask('search', { pattern: document.getElementById('pattern').value });
    found.replaceChildren(hits.length ? table(hits.map((n) => [String(n.id), n.text])) : 'Nothing matched.');
  } catch (err) {
    found.replaceChildren(el('span', { class: 'bad' }, err.message));
  }
};

registerServiceWorker();
start();
