// The page's side of the worker: ask it to do things, hear when the data has changed, undo.
const worker = new Worker('./worker.js', { type: 'module' });
const waiting = new Map();
const listeners = new Set();
const undoStack = [];
const UNDO_STEPS = 20;
let nextId = 1;
let notifyTimer;

function ask(op, args) {
  return new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, op, args });
  });
}

// Several changes close together redraw the screen once.
function notify() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => listeners.forEach((fn) => fn()), 30);
}

worker.onmessage = (event) => {
  const { id, event: name, error } = event.data;
  if (name === 'changed') {
    notify();
    return;
  }
  const { resolve, reject } = waiting.get(id);
  waiting.delete(id);
  if (error) reject(new Error(error)); else resolve(event.data);
};

// Another tab changed the shared database.
new BroadcastChannel('sutra').onmessage = notify;

export const store = {
  ready: ask('start'),
  // Reading: store.get('list', id, options)
  async get(op, ...args) {
    await store.ready;
    return (await ask(op, args)).result;
  },
  // An action. What it changed is kept so that it can be undone.
  async act(op, ...args) {
    await store.ready;
    const { result, undo } = await ask(op, args);
    if (undo && undo.length) {
      undoStack.push(undo);
      if (undoStack.length > UNDO_STEPS) undoStack.shift();
    }
    return result;
  },
  // Several actions, undone together: store.batch([['complete', id1], ['complete', id2]])
  async batch(actions) {
    if (!actions.length) return [];
    await store.ready;
    const { result, undo } = await ask('batch', actions);
    if (undo && undo.length) {
      undoStack.push(undo);
      if (undoStack.length > UNDO_STEPS) undoStack.shift();
    }
    return result;
  },
  async undo() {
    const undo = undoStack.pop();
    if (undo) await ask('revert', { undo });
    return !!undo;
  },
  async open(...ids) {
    await store.ready;
    await ask('open', { ids });
  },
  async search(text, limit) {
    await store.ready;
    return (await ask('search', { text, limit })).result;
  },
  async status() {
    await store.ready;
    return (await ask('status')).result;
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
