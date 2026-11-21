// Small things the components share.
import { EL, HTMLElementExtendedMinimum } from 'html-element-extended';
import { store } from './store.js';
import { repeatWords, parseRepeat } from '/core/repeat.js';

export { EL };

let redrawing = 0;

// While something is being dragged, nothing on the page is redrawn: replacing the element being
// dragged (or the one under the pointer) makes the browser abandon the drag. Redraws asked for
// meanwhile happen when the drag ends.
const held = new Set();
export const dragging = { active: false };
function releaseHeld() {
  dragging.active = false;
  const waiting = [...held];
  held.clear();
  waiting.forEach((element) => { if (element.isConnected) element.draw(); });
}
document.addEventListener('dragstart', () => { dragging.active = true; }, true);
document.addEventListener('dragend', () => setTimeout(releaseHeld, 0), true);
document.addEventListener('drop', () => setTimeout(releaseHeld, 0), true);

// EL attaches only a few kinds of event; this attaches any.
export function on(element, events) {
  Object.entries(events).forEach(([name, fn]) => element.addEventListener(name, fn));
  return element;
}

// A component that shows data from the store: it reloads when its attributes change and whenever
// the data changes, here or in another tab.
export class SutraElement extends HTMLElementExtendedMinimum {
  connectedCallback() {
    this.stopListening = store.onChange(() => this.load());
    this.load();
  }

  disconnectedCallback() {
    if (this.stopListening) this.stopListening();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    this.changeAttribute(name, newValue);
    if (this.isConnected) this.load();
  }

  // render() may return elements nested in lists of any depth, with gaps where something is absent.
  renderAndReplace() {
    this.replaceChildren(...[this.render()].flat(Infinity).filter(Boolean));
  }

  // Loads are asynchronous and can overlap; only the latest one draws.
  async load() {
    this.loading = (this.loading || 0) + 1;
    const mine = this.loading;
    const data = await this.fetchData();
    if (mine !== this.loading) return;
    this.data = data;
    this.draw();
  }

  // Redrawing replaces every element, so whatever was being typed, and where the cursor was, is
  // carried over to the new element with the same data-key.
  draw() {
    if (dragging.active) {
      held.add(this);
      return;
    }
    const active = document.activeElement;
    const typing = active && this.contains(active) && active.dataset && active.dataset.key ? active : null;
    const keep = typing && {
      key: typing.dataset.key, value: typing.value, dirty: typing.value !== typing.dataset.was, start: typing.selectionStart, end: typing.selectionEnd,
    };
    // Removing the field being typed in can look, to that field, like the user leaving it.
    this.drawing = true;
    redrawing += 1;
    try {
      this.renderAndReplace();
    } finally {
      this.drawing = false;
      redrawing -= 1;
    }
    const key = this.focusKey || (keep && keep.key);
    this.focusKey = null;
    const node = key && this.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!node) return;
    const same = keep && keep.key === key;
    if (same && keep.dirty) node.value = keep.value;
    node.focus({ preventScroll: true });
    // A heading just made carries a stand-in name: select it, so typing replaces it.
    if (!same && key.startsWith('h:')) node.select();
    if (same && keep.start !== null && keep.start !== undefined) {
      try { node.setSelectionRange(keep.start, keep.end); } catch (err) { /* not a text field */ }
    }
  }
}

// A text field whose value is remembered as drawn, so a redraw can tell whether it has been typed in.
// Its "change" is ignored while a redraw is replacing it: the half-typed text is carried over to the
// new field, and must not be saved as if the user had finished.
export function field(attributes, { change, ...events } = {}) {
  const input = on(EL('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'data-was': attributes.value || '', ...attributes }), events);
  if (change) {
    // Saved when the user leaves the field with different text in it. "blur" as well as "change",
    // because text carried over by a redraw was not typed into this element, so the browser does
    // not count it as a change.
    const save = (e) => {
      if (redrawing || input.value === input.dataset.was) return;
      input.dataset.was = input.value;
      change(e);
    };
    on(input, { change: save, blur: save });
  }
  return input;
}

// Moving around. Every view has its own address, so back, forward and bookmarks work, and
// different tabs can show different Lists.
export const nav = {
  parse() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    const view = { list: 'home', search: null, card: null };
    for (let i = 0; i + 1 < parts.length; i += 2) {
      if (parts[i] === 'l') view.list = parts[i + 1];
      if (parts[i] === 's') view.search = parts[i + 1];
      if (parts[i] === 'c') view.card = parts[i + 1];
    }
    return view;
  },
  address({ list, search, card }) {
    const head = search ? `s/${encodeURIComponent(search)}` : `l/${encodeURIComponent(list)}`;
    return `#/${head}${card ? `/c/${encodeURIComponent(card)}` : ''}`;
  },
  // Opening: a new step in the browser's history.
  open(list, card) {
    location.hash = nav.address({ list, card });
  },
  search(text) {
    location.hash = nav.address({ search: text });
  },
  // Selecting: the same step, with a different card on the right.
  select(card) {
    const view = nav.parse();
    if (view.card === card) return;
    history.replaceState(null, '', nav.address({ ...view, card }));
    window.dispatchEvent(new Event('hashchange'));
  },
  back() {
    history.back();
  },
};

// A narrow screen (the phone) shows one card at a time (spec 5.2).
export const narrow = matchMedia('(max-width: 700px)');

// Asana's Tab-then-a-key shortcuts: the app takes the Tab key while a List has focus.
let tabArmed = 0;
export const tabKey = {
  arm() { tabArmed = Date.now(); },
  // Pressing Shift or Cmd on the way to the second key is not itself the second key.
  isModifier: (e) => ['Shift', 'Meta', 'Control', 'Alt', 'CapsLock'].includes(e.key),
  take() {
    const armed = Date.now() - tabArmed < 1500;
    tabArmed = 0;
    return armed;
  },
};

// Copies the address of a card (shown as its own List, with itself on the right), and says so
// briefly on the button that was pressed.
// With Option (Alt) held, the link is a web+sutra: one, which macOS should hand to the installed app.
// Which kind is asked each time: a web link (for Chrome, or to send to someone), or a web+sutra:
// link, which the Mac hands straight to the installed Sutra app. Option-click skips the question.
export async function copyLink(cardId, button, appLink) {
  if (appLink === undefined && button) {
    appLink = await choose('Copy a link to this card', [
      { label: 'Web link (opens in Chrome)', value: false },
      { label: 'App link (opens in the Sutra app)', value: true },
      { label: 'Cancel', value: null },
    ]);
    if (appLink === null) return null;
  }
  const url = appLink ? `web+sutra:${cardId}` : `${location.origin}${location.pathname}${nav.address({ list: cardId, card: cardId })}`;
  let ok = true;
  try { await navigator.clipboard.writeText(url); } catch (err) { ok = false; }
  if (!button) return url;
  const was = button.textContent;
  button.textContent = ok ? 'Copied' : 'Could not copy';
  if (!ok) prompt('Copy this link', url); // eslint-disable-line no-alert
  setTimeout(() => { button.textContent = was; }, 1200);
  return url;
}

// A question with buttons, without the browser's own alert boxes.
export function choose(question, options) {
  return new Promise((resolve) => {
    const dialog = EL('dialog', { class: 'choose' }, [
      EL('p', { textContent: question }),
      EL('div', {}, options.map((o) => EL('button', { textContent: o.label, onclick: () => { dialog.close(); dialog.remove(); resolve(o.value); } }))),
    ]);
    on(dialog, { cancel: () => { dialog.remove(); resolve(null); } });
    document.body.append(dialog);
    dialog.showModal();
  });
}

// Deleting a card, asking first when cards in its List would be left with no home (spec 5.4).
export async function deleteCard(id) {
  const orphans = await store.get('wouldOrphan', id);
  let cascade = false;
  if (orphans.length) {
    const answer = await choose(`Delete cards not in any other list? (${orphans.length})`, [
      { label: 'Yes, delete them too', value: 'yes' }, { label: 'No, leave them', value: 'no' }, { label: 'Cancel', value: null },
    ]);
    if (!answer) return false;
    cascade = answer === 'yes';
  }
  await store.act('trash', id, { cascade });
  return true;
}

export { repeatWords, parseRepeat };

// In place of the tick box for a repeating task: a circular arrow. Pressing it does the task for
// now, so its dates move on; it turns once to show that.
export function repeatButton(card) {
  return EL('button', {
    class: 'repeat-done',
    textContent: '↻',
    title: `Repeats ${repeatWords(card.repeat)}. Done for now: the dates move on.`,
    onclick: async (e) => {
      e.target.classList.add('spin');
      await store.act('complete', card.id);
    },
  });
}

export function shortDate(date) {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// How a card's dates should look (as Asana does): green when due today or tomorrow, red when past
// due, and a "!" when past its overdue date, or past due with no overdue date set.
export function dateState(card) {
  const date = card.due || card.overdue;
  if (!date || card.completed) return { date, late: false, soon: false, alarm: false };
  const now = today();
  const d = new Date();
  const tomorrow = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + 1)).toISOString().slice(0, 10);
  const late = date < now;
  return {
    date,
    late,
    soon: !late && date <= tomorrow,
    alarm: card.overdue ? card.overdue < now : late,
  };
}

export function today() {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}
