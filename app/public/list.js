// A List: unfiled items, then each heading with its cards. Used for the working List in the middle,
// for a card's own List on the right, and for search results.
import { store } from './store.js';
import { EL, on, field, nav, tabKey, deleteCard, choose, shortDate, dateState, repeatButton, copyLink, SutraElement } from './ui.js';
import { looksLikeQuery } from '/core/query.js';

// What is being dragged, in this page: { id, list } for a card, { heading, list } for a heading.
// The browser does not let a page read the dragged data until it is dropped.
let dragged = null;
let marked = null;

// Shows where the dragged thing would land: a line above a row or heading, or along the foot of a
// List when it would go to the end.
function mark(element, name) {
  if (marked && (marked.element !== element || marked.name !== name)) marked.element.classList.remove(marked.name);
  marked = element ? { element, name } : null;
  if (element) element.classList.add(name);
}

// Pasted lines as separate titles, without the bullets, numbers or tick boxes lists often carry.
function pastedLines(text) {
  return text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)?(?:\[[ xX]?\]\s+)?/, '').trim()).filter(Boolean);
}

const SORTS = [['', 'My order'], ['modified', 'Recently changed'], ['created', 'Recently made'], ['title', 'A to Z'], ['due', 'Due date']];

class SutraList extends SutraElement {
  static get observedAttributes() { return ['list', 'search', 'selected', 'embedded']; }

  constructor() {
    super();
    this.sort = '';
    this.showDone = false;
    this.adding = null; // where a new item is being typed: { sublist, after }
    this.picked = new Set(); // several cards chosen together, to act on at once
    this.lastPicked = null;
    on(this, {
      keydown: (e) => this.onKey(e),
      mousedown: (e) => this.onPick(e),
      // A click anywhere in a row of the working List shows that card on the right.
      click: (e) => {
        const row = this.rowOf(e.target);
        if (!row || this.state.embedded || e.metaKey || e.ctrlKey || e.shiftKey || row.classList.contains('adding')) return;
        nav.select(row.dataset.id);
      },
      focusin: (e) => this.onFocus(e),
      dblclick: (e) => { const row = this.rowOf(e.target); if (row && !e.target.closest('button')) this.openRow(row.dataset.id); },
      dragstart: (e) => this.onDragStart(e),
      dragover: (e) => this.onDragOver(e),
      dragleave: (e) => { if (!this.contains(e.relatedTarget)) mark(null); },
      dragend: () => { mark(null); dragged = null; this.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging')); },
      drop: (e) => this.onDrop(e),
      paste: (e) => this.onPaste(e),
    });
  }

  get listId() { return this.state.list; }

  // The sort chosen for each List is remembered on this device only (in this browser), not synced:
  // the laptop and the phone may want the same List in different orders. "My order" is the default.
  static sortFor(listId) {
    try { return localStorage.getItem(`sutra-sort:${listId}`) || ''; } catch (err) { return ''; }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if ((name === 'list' || name === 'search') && oldValue !== newValue) {
      this.sort = name === 'list' && newValue ? SutraList.sortFor(newValue) : '';
      this.adding = null;
      this.picked.clear();
    }
    super.attributeChangedCallback(name, oldValue, newValue);
  }

  setSort(value) {
    this.sort = value;
    if (this.listId && !this.state.search) {
      try {
        if (value) localStorage.setItem(`sutra-sort:${this.listId}`, value); else localStorage.removeItem(`sutra-sort:${this.listId}`);
      } catch (err) { /* not kept; still applies until the List changes */ }
    }
    this.load();
  }

  get canReorder() { return this.data && !this.data.dynamic && !this.state.search; }

  async fetchData() {
    if (this.state.search) {
      const text = this.state.search;
      // Run as a query only if it is one that works; say so when it looked like one but was not.
      let label = 'Search';
      if (looksLikeQuery(text)) {
        try { await store.get('query', text); label = 'Query'; } catch (err) { label = 'Search (not a valid query)'; }
      }
      const cards = await store.search(text);
      return { card: { id: null, title: `${label}: ${text}` }, dynamic: true, sublists: [{ id: null, heading: null, cards }], relationships: [] };
    }
    if (!this.listId) return null;
    return store.get('list', this.listId, { showCompleted: this.showDone, sort: this.sort || undefined });
  }

  // The sort shown in the menu: what was chosen here, or for a Dynamic card its own default.
  get sortShown() {
    if (this.sort || this.state.search) return this.sort;
    return this.data && this.data.dynamic ? (this.data.card.sort || 'title') : '';
  }

  rowOf(target) { return target.closest && target.closest('.row'); }

  connectedCallback() {
    super.connectedCallback();
    // Esc lets go of the chosen cards wherever the focus is, and so does dropping them anywhere.
    this.unchoose = (e) => {
      if ((e.type === 'keydown' && e.key !== 'Escape') || !this.picked.size) return;
      this.picked.clear();
      this.draw();
    };
    document.addEventListener('keydown', this.unchoose);
    document.addEventListener('sutra-dropped', this.unchoose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.unchoose);
    document.removeEventListener('sutra-dropped', this.unchoose);
  }

  // Cmd-click adds a row to the chosen set or takes it out; Shift-click chooses everything from the
  // last chosen row to this one. A plain click is left alone: it selects the row as usual.
  // As in Finder and Asana, the row already selected counts as the first chosen: click one row,
  // then Cmd-click (or Shift-click) another, and both are chosen.
  onPick(e) {
    const row = this.rowOf(e.target);
    if (!row || !(e.metaKey || e.ctrlKey || e.shiftKey) || e.target.closest('button, .grip') || this.state.search) return;
    e.preventDefault();
    const id = row.dataset.id;
    const ids = [...this.querySelectorAll('.row[data-id]')].map((r) => r.dataset.id);
    const current = this.state.selected;
    if (!this.picked.size && current && current !== id && ids.includes(current)) {
      this.picked.add(current);
      this.lastPicked = current;
    }
    if (e.shiftKey && this.lastPicked && ids.includes(this.lastPicked)) {
      const [from, to] = [ids.indexOf(this.lastPicked), ids.indexOf(id)].sort((a, b) => a - b);
      ids.slice(from, to + 1).forEach((x) => this.picked.add(x));
    } else if (this.picked.has(id)) {
      this.picked.delete(id);
    } else {
      this.picked.add(id);
    }
    this.lastPicked = id;
    this.draw();
  }

  // The chosen cards that are still in this List, in the order shown.
  get chosen() {
    return this.data ? this.data.sublists.flatMap((s) => s.cards).filter((c) => this.picked.has(c.id)) : [];
  }

  async actOnChosen(actions) {
    await store.batch(actions);
    this.picked.clear();
  }

  // The chosen cards are added to that card's List (and stay where they are as well).
  async addChosenTo(listId) {
    this.stripFound = null;
    await this.actOnChosen(this.chosen.filter((c) => c.id !== listId).map((c) => ['addToList', listId, c.id]));
  }

  async deleteChosen() {
    const cards = this.chosen;
    const orphans = (await Promise.all(cards.map((c) => store.get('wouldOrphan', c.id)))).flat();
    let cascade = false;
    if (orphans.length) {
      const answer = await choose(`Delete cards not in any other list? (${new Set(orphans).size})`, [
        { label: 'Yes, delete them too', value: 'yes' }, { label: 'No, leave them', value: 'no' }, { label: 'Cancel', value: null },
      ]);
      if (!answer) return;
      cascade = answer === 'yes';
    }
    await this.actOnChosen(cards.map((c) => ['trash', c.id, { cascade }]));
  }

  // The strip that appears above the List while several cards are chosen.
  chosenBar() {
    const cards = this.chosen;
    if (!cards.length) return null;
    const ids = cards.map((c) => c.id);
    const headings = this.data.sublists.filter((s) => s.heading !== null);
    return EL('div', { class: 'chosen' }, [
      EL('b', { textContent: `${cards.length} chosen` }),
      EL('button', { textContent: 'Complete', onclick: () => this.actOnChosen(cards.filter((c) => c.type === 'task' && !c.completed).map((c) => ['complete', c.id])) }),
      EL('label', {}, ['Due ', on(EL('input', { type: 'date' }), { change: (e) => this.actOnChosen(ids.map((id) => ['edit', id, { due: e.target.value || null }])) })]),
      on(EL('input', { type: 'text', class: 'tiny', placeholder: '+ tag', 'data-key': 'chosen-tag', autocomplete: 'off' }), {
        keydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) this.actOnChosen(ids.map((id) => ['tag', id, e.target.value.trim()])); },
      }),
      this.canReorder && headings.length && EL('select', { onchange: (e) => this.actOnChosen(ids.map((id) => ['addToList', this.listId, id, { sublist: e.target.value || null }])) }, [
        EL('option', { value: 'x', textContent: 'Move under…', selected: true, disabled: true }),
        EL('option', { value: '', textContent: 'No heading' }),
        ...headings.map((h) => EL('option', { value: h.id, textContent: h.heading })),
      ]),
      // Add them all to another card's List: type, then pick from the suggestions (Return takes the first).
      EL('span', { class: 'pick' }, [
        on(EL('input', { type: 'text', class: 'small', placeholder: '+ add to a list', 'data-key': 'chosen-list', autocomplete: 'off' }), {
          input: (e) => {
            clearTimeout(this.stripTimer);
            const text = e.target.value.trim();
            this.stripTimer = setTimeout(async () => {
              if (!text) { this.stripFound = null; this.draw(); return; }
              const found = (await store.search(text, 40)).filter((c) => !c.trashed && c.type !== 'dynamic' && !ids.includes(c.id));
              const inTitle = (c) => c.title.toLowerCase().includes(text.toLowerCase());
              this.stripFound = [...found.filter(inTitle), ...found.filter((c) => !inTitle(c))].slice(0, 8);
              this.draw();
            }, 200);
          },
          keydown: (e) => {
            if (e.key === 'Enter' && this.stripFound && this.stripFound.length) this.addChosenTo(this.stripFound[0].id);
          },
          blur: () => { if (!this.drawing && this.stripFound) { this.stripFound = null; setTimeout(() => this.draw(), 0); } },
        }),
        this.stripFound && EL('span', { class: 'results' }, this.stripFound.length
          ? this.stripFound.map((c) => on(EL('a', { textContent: c.title || '(untitled)' }), { mousedown: (e) => { e.preventDefault(); this.addChosenTo(c.id); } }))
          : [EL('span', { class: 'quiet', textContent: 'Nothing found' })]),
      ]),
      this.canReorder && EL('button', { textContent: 'Remove from list', title: 'Takes them out of this List; the cards are not deleted', onclick: () => this.actOnChosen(ids.map((id) => ['removeFromList', this.listId, id])) }),
      EL('button', { textContent: 'Delete', onclick: () => this.deleteChosen() }),
      EL('button', { textContent: 'Clear', title: 'Esc', onclick: () => { this.picked.clear(); this.draw(); } }),
    ]);
  }

  cardIn(id) {
    return this.data.sublists.flatMap((s) => s.cards).find((c) => c.id === id);
  }

  // In the middle List, opening a row shows it on the right, as selecting does. In the List of the
  // card on the right, opening slides everything left: that card becomes the working List.
  openRow(id) {
    if (this.state.embedded) nav.open(this.listId, id); else nav.select(id);
  }

  onFocus(e) {
    const row = this.rowOf(e.target);
    if (row && !this.state.embedded && e.target.classList.contains('title')) nav.select(row.dataset.id);
  }

  async onKey(e) {
    const input = e.target;

    if (input.classList.contains('add')) {
      if (e.key === 'Enter') { e.preventDefault(); this.finishAdding(input, !e.shiftKey, e.shiftKey); }
      if (e.key === 'Escape') { this.adding = null; this.draw(); }
      return;
    }
    const head = input.closest('.heading');
    if (head && !head.classList.contains('unfiled') && e.key === 'Enter' && !e.metaKey && !e.ctrlKey && this.canReorder) {
      // Return in a heading: keep the name, and start the first item under it.
      e.preventDefault();
      if (input.value !== input.dataset.was) {
        input.dataset.was = input.value;
        await store.act('renameSublist', head.dataset.sublist, input.value);
      }
      this.adding = { sublist: head.dataset.sublist, after: null };
      this.focusKey = 'add';
      this.draw();
      return;
    }
    if (head && (e.metaKey || e.ctrlKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // Cmd-Up and Cmd-Down on a heading move the heading, with everything under it.
      e.preventDefault();
      const heads = [...this.querySelectorAll('.heading:not(.unfiled)')];
      const other = heads[heads.indexOf(head) + (e.key === 'ArrowUp' ? -1 : 1)];
      if (other) await store.act('moveSublist', head.dataset.sublist, e.key === 'ArrowUp' ? { before: other.dataset.sublist } : { after: other.dataset.sublist });
      return;
    }
    const row = this.rowOf(input);
    if (!row || !input.classList.contains('title')) return;
    const id = row.dataset.id;
    const sublist = row.dataset.sublist || null;
    const mod = e.metaKey || e.ctrlKey;
    const rows = [...this.querySelectorAll('.row .title')];
    const at = rows.indexOf(input);

    if (tabKey.isModifier(e)) return;
    if (tabKey.take()) {
      e.preventDefault();
      // Asana writes these as Tab+H and so on; accept the letter with or without Shift.
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === 'Backspace' || key === 'Delete') {
        if (await deleteCard(id) && rows[at + 1]) this.focusKey = rows[at + 1].dataset.key;
      } else if (key === 'Enter') this.openRow(id);
      else if (key === 'n' && this.canReorder) {
        const made = await store.act('addSublist', this.listId, 'New section', sublist ? { after: sublist } : {});
        this.focusKey = `h:${made}`;
      } else if (key === 'd') {
        nav.select(id);
        setTimeout(() => { const due = document.querySelector('sutra-card [data-key="due"]'); if (due) due.focus(); }, 150);
      } else if (key === 's') {
        // A sub-task: a new item in this card's own List, which is on the right once it is selected.
        nav.select(id);
        setTimeout(() => document.querySelector('sutra-card').ownList.startAdding(), 300);
      } else if (key === 'q') this.startAdding();
      else if (key === 'h') nav.open('home');
      else if (key === '/') document.querySelector('sutra-bar .search').focus();
      return;
    }
    if (e.key === 'Tab' && !mod && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      tabKey.arm();
    } else if (e.key === 'Enter' && mod) {
      e.preventDefault();
      const card = this.cardIn(id);
      if (card.type === 'task') await store.act(card.completed ? 'uncomplete' : 'complete', id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (input.value !== input.dataset.was) await this.rename(input, id);
      if (this.canReorder) { this.adding = { sublist, after: id }; this.focusKey = 'add'; this.draw(); }
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && mod && this.canReorder && !this.sort) {
      e.preventDefault();
      const other = rows[at + (e.key === 'ArrowUp' ? -1 : 1)];
      const otherRow = other && this.rowOf(other);
      if (otherRow) {
        const where = e.key === 'ArrowUp' ? { before: otherRow.dataset.id } : { after: otherRow.dataset.id };
        await store.act('move', this.listId, id, { sublist: otherRow.dataset.sublist || null, ...where });
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const other = rows[at + (e.key === 'ArrowUp' ? -1 : 1)];
      if (other) { e.preventDefault(); other.focus(); }
    }
  }

  async rename(input, id) {
    input.dataset.was = input.value;
    await store.act('edit', id, { title: input.value });
  }

  // Return ends one new item and starts the next, for quick brainstorming of lists.
  async finishAdding(input, carryOn, details) {
    const title = input.value.trim();
    if (!title) {
      this.adding = null;
      // Not at once: this can be the blur half of a click on a row, and redrawing now would remove
      // the row before the click reaches it.
      setTimeout(() => this.draw(), 0);
      return;
    }
    const where = this.adding;
    input.value = '';
    const made = await store.act('createCard', { type: 'task', title }, { list: this.listId, sublist: where.sublist, after: where.after });
    // Esc may have been pressed while the card was being made: then adding has stopped.
    if (this.adding !== where) return;
    this.adding = carryOn ? { sublist: where.sublist, after: made } : null;
    if (carryOn) this.focusKey = 'add';
    // The card just made is the one on show, so that its details are not mistaken for another's.
    if (!this.state.embedded && !details) nav.select(made);
    if (details) {
      // Show the new card on the right (in the right-hand List: slide to it) and start in its Note.
      if (this.state.embedded) nav.open(this.listId, made); else nav.select(made);
      setTimeout(() => { const note = document.querySelector('sutra-card .cm-content'); if (note) note.focus(); }, 400);
    }
  }

  onDragStart(e) {
    const row = this.rowOf(e.target);
    const head = e.target.closest('.heading');
    if (!row && !head) return;
    dragged = row ? { id: row.dataset.id, list: this.listId } : { heading: head.dataset.sublist, list: this.listId };
    // Dragging one of several chosen cards takes them all, in the order shown.
    if (row && this.picked.has(row.dataset.id) && this.picked.size > 1) dragged.ids = this.chosen.map((c) => c.id);
    // A card's data is also put where the bar, or another tab's worth of page, can read it.
    if (row) e.dataTransfer.setData('application/x-sutra', JSON.stringify(dragged));
    else e.dataTransfer.setData('application/x-sutra-heading', dragged.heading);
    e.dataTransfer.effectAllowed = 'copyMove';
    (row || head).classList.add('dragging');
  }

  // Where a drop at this point would go: onto a row, onto a heading, or to the end of the List.
  dropTarget(e) {
    const target = e.target.closest('[data-drop]');
    if (dragged && dragged.heading) {
      if (dragged.list !== this.listId) return null;
      const head = target && (target.classList.contains('heading') ? target : this.querySelector(`.heading[data-sublist="${target.dataset.sublist}"]`));
      return head && !head.classList.contains('unfiled') ? { element: head, name: 'dropline' } : { element: this, name: 'dropend' };
    }
    // Over empty space (below the last row of a sub-list, say): whatever row or heading is nearest
    // above the pointer, so the card lands after it and not somewhere else in the List.
    if (!target) {
      const above = [...this.querySelectorAll('[data-drop]')].filter((n) => n.getBoundingClientRect().top <= e.clientY).pop();
      return above ? { element: above, name: 'droplineafter' } : { element: this, name: 'dropend' };
    }
    // A heading: the card goes first under it, shown by a line beneath the heading.
    if (!target.classList.contains('row')) return { element: target, name: 'droplineafter' };
    // Over the lower half of a row: it goes after that row, which is how the end of a sub-list is reached.
    const box = target.getBoundingClientRect();
    return { element: target, name: e.clientY > box.top + box.height / 2 ? 'droplineafter' : 'dropline' };
  }

  onDragOver(e) {
    if (!this.canReorder) return;
    const where = this.dropTarget(e);
    if (!where) return;
    e.preventDefault();
    e.stopPropagation();
    mark(where.element, where.name);
  }

  // Several lines pasted into the box for a new item become several items.
  async onPaste(e) {
    if (!e.target.classList.contains('add') || !this.adding) return;
    const lines = pastedLines(e.clipboardData.getData('text/plain'));
    if (lines.length < 2) return;
    e.preventDefault();
    const where = this.adding;
    let after = where.after;
    for (const title of lines) {
      after = await store.act('createCard', { type: 'task', title }, { list: this.listId, sublist: where.sublist, after });
    }
    if (this.adding === where) {
      this.adding = { sublist: where.sublist, after };
      this.focusKey = 'add';
      this.draw();
    }
  }

  // Dropped on a row: goes ahead of it. Dropped on a heading: goes to the end of that sub-list.
  // From another List the card is added here and stays where it was as well.
  // Dropped anywhere else in the List: goes to the end of the unfiled part.
  async onDrop(e) {
    mark(null);
    if (!this.canReorder) return;
    const headingId = e.dataTransfer.getData('application/x-sutra-heading');
    const raw = e.dataTransfer.getData('application/x-sutra');
    if (!headingId && !raw) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target.closest('[data-drop]');
    if (headingId) {
      const where = this.dropTarget(e);
      if (!where) return;
      const before = where.name === 'dropline' ? where.element.dataset.sublist : null;
      if (before !== headingId) await store.act('moveSublist', headingId, before ? { before } : {});
      return;
    }
    const payload = JSON.parse(raw);
    const ids = (payload.ids || [payload.id]).filter((id) => id !== this.listId && !(target && target.classList.contains('row') && id === target.dataset.id && !payload.ids));
    if (!ids.length) return;
    const spot = this.dropTarget(e);
    const onto = spot.element === this ? null : spot.element;
    const where = { sublist: (onto && onto.dataset.sublist) || null };
    if (onto && onto.classList.contains('row')) {
      where[spot.name === 'droplineafter' ? 'after' : 'before'] = onto.dataset.id;
    } else if (onto) {
      // Onto a heading: ahead of the first card under it, if there is one.
      const first = this.data.sublists.find((s) => (s.id || '') === (onto.dataset.sublist || ''));
      const lead = first && first.cards.find((c) => !(payload.ids || [payload.id]).includes(c.id));
      if (lead) where.before = lead.id;
    }
    // The first goes where it was dropped, and each of the rest after the one before it.
    await store.batch(ids.map((id, i) => ['addToList', this.listId, id, i === 0 ? where : { sublist: where.sublist, after: ids[i - 1] }]));
    document.dispatchEvent(new Event('sutra-dropped'));
  }

  // "Save this search as a card": a Dynamic card on Home. A query is kept as it was typed; words
  // become a query over titles and Notes.
  async saveSearch() {
    const text = this.state.search;
    let query = null;
    if (looksLikeQuery(text)) {
      try {
        await store.get('query', text);
        query = text;
      } catch (err) {
        query = null;
      }
    }
    const quoted = `'${text.replace(/'/g, "''")}'`;
    const made = await store.act('createCard', { type: 'dynamic', title: `${query ? 'Query' : 'Search'}: ${text}` }, { list: 'home' });
    await store.act('edit', made, { query: query || `(title REGEXP ${quoted} OR note REGEXP ${quoted}) AND type <> 'dynamic'`, sort: 'modified' });
    nav.open(made, made);
  }

  // Open the box for a new item at the end of the unfiled part.
  startAdding() {
    if (!this.canReorder) return;
    const unfiled = this.data.sublists.find((s) => s.heading === null);
    this.adding = { sublist: null, after: unfiled && unfiled.cards.length ? unfiled.cards[unfiled.cards.length - 1].id : null };
    this.focusKey = 'add';
    this.draw();
  }

  addBox() {
    const input = on(EL('input', { class: 'add', type: 'text', 'data-key': 'add', placeholder: 'New item (Return for the next, Shift-Return to add details)', autocomplete: 'off' }), {
      blur: (e) => { if (this.adding && !this.drawing && e.target.isConnected) this.finishAdding(e.target, false); },
    });
    return EL('div', { class: 'row adding' }, [
      input,
      // Make the card and go to its details, for when the next thing wanted is a Note or a date.
      on(EL('button', { class: 'open', textContent: '›', title: 'Add this and open its details (Shift-Return)' }), {
        mousedown: (e) => { e.preventDefault(); this.finishAdding(input, false, true); },
      }),
    ]);
  }

  row(card, sublistId) {
    const key = `${this.listId || 'search'}:${card.id}`;
    const dates = dateState(card);
    const classes = ['row', card.completed && 'done', card.trashed && 'trashed', card.id === this.state.selected && 'selected', this.picked.has(card.id) && 'picked'].filter(Boolean).join(' ');
    // A chosen row can be dragged by any part of it, not only its grip.
    return EL('div', { class: classes, 'data-id': card.id, 'data-sublist': sublistId || '', 'data-drop': '1', draggable: this.picked.has(card.id) && this.canReorder ? 'true' : null }, [
      this.canReorder && EL('span', { class: 'grip', draggable: 'true', textContent: '⋮⋮', title: 'Drag to move' }),
      card.type === 'task' && card.repeat && card.repeat !== 'none' && !card.completed
        ? repeatButton(card)
        : card.type === 'task'
        ? EL('input', { type: 'checkbox', checked: !!card.completed, title: 'Complete', onchange: () => store.act(card.completed ? 'uncomplete' : 'complete', card.id) })
        : EL('span', { class: 'kind', textContent: card.type === 'dynamic' ? '?' : (card.type || 'note')[0].toUpperCase(), title: card.type }),
      this.state.search || card.trashed
        ? Object.assign(EL('input', { class: 'title', type: 'text', value: card.title, 'data-key': key, 'data-was': card.title }), { readOnly: true })
        : field({ class: 'title', value: card.title, 'data-key': key }, { change: (e) => this.rename(e.target, card.id) }),
      (card.tags || []).map((t) => EL('span', { class: 'tag', textContent: t })),
      (card.note || card.hasNote) ? EL('span', { class: 'mark noted', textContent: '🗒︎', title: 'Has a Note' }) : null,
      card.trashed && EL('span', { class: 'mark', textContent: 'in Trash' }),
      dates.date && EL('span', { class: `due${dates.late ? ' late' : ''}${dates.soon ? ' soon' : ''}`, textContent: `${shortDate(dates.date)}${dates.alarm ? ' !' : ''}` }),
      EL('button', { class: 'open', textContent: card.count ? `› ${card.count}` : '›', title: 'Open', onclick: () => this.openRow(card.id) }),
    ]);
  }

  sublist(s) {
    const addingHere = this.adding && (this.adding.sublist || null) === (s.id || null);
    const rows = [];
    if (addingHere && !this.adding.after) rows.push(this.addBox());
    s.cards.forEach((card) => {
      rows.push(this.row(card, s.id));
      if (addingHere && this.adding.after === card.id) rows.push(this.addBox());
    });
    if (addingHere && this.adding.after && !s.cards.some((c) => c.id === this.adding.after)) rows.push(this.addBox());
    // With headings in use, the unfiled items need somewhere to be dropped back onto.
    const hasHeadings = this.data.sublists.some((x) => x.heading !== null);
    return [
      s.heading === null && hasHeadings && this.canReorder && EL('div', { class: 'heading unfiled', 'data-drop': '1', 'data-sublist': '' },
        [EL('span', { textContent: 'Unsorted' })]),
      s.heading !== null && EL('div', { class: 'heading', 'data-drop': '1', 'data-sublist': s.id }, [
        this.canReorder && EL('span', { class: 'grip', draggable: 'true', textContent: '⋮⋮', title: 'Drag to move this heading' }),
        field({ value: s.heading, 'data-key': `h:${s.id}` }, { change: (e) => store.act('renameSublist', s.id, e.target.value) }),
        EL('button', { textContent: '+', title: 'Add an item here', onclick: () => { this.adding = { sublist: s.id, after: s.cards.length ? s.cards[s.cards.length - 1].id : null }; this.focusKey = 'add'; this.draw(); } }),
        EL('button', { textContent: '×', title: 'Remove this heading (its items stay)', onclick: () => store.act('removeSublist', s.id) }),
      ]),
      rows,
    ];
  }

  render() {
    if (!this.data) return EL('p', { class: 'quiet', textContent: this.listId || this.state.search ? 'Fetching…' : '' });
    const { card } = this.data;
    const startAdding = () => this.startAdding();
    const empty = !this.data.sublists.some((s) => s.cards.length) && !this.adding;
    return [
      EL('div', { class: 'listhead' }, [
        !this.state.embedded && EL('button', { textContent: '‹', title: 'Back', onclick: () => nav.back() }),
        this.state.embedded
          ? EL('span', { class: 'name', textContent: 'List' })
          : EL('a', { class: 'name', textContent: card.title || '(untitled)', title: 'Show this card', onclick: () => card.id && nav.select(card.id) }),
        !this.state.embedded && card.id && EL('button', { class: 'link', textContent: '🔗', title: 'Copy a link to this List (as a web link or an app link; Option-click: the app link at once)', onclick: (e) => copyLink(card.id, e.target, e.altKey || undefined) }),
        this.data.dynamic && !this.state.search && EL('span', { class: 'mark', textContent: 'query' }),
        this.state.search && EL('button', { textContent: 'Save as card', title: 'Keep this search as a card that always shows what it finds', onclick: () => this.saveSearch() }),
        EL('select', { title: 'Sort (a view only; the stored order is unchanged)', onchange: (e) => this.setSort(e.target.value) },
          [...SORTS, ['trashed', 'Recently deleted']].filter(([value]) => (value || !this.data.dynamic || this.state.search) && (value !== 'trashed' || this.listId === 'trash'))
            .map(([value, label]) => EL('option', { value, textContent: label, selected: value === this.sortShown }))),
        EL('label', { class: 'toggle' }, [EL('input', { type: 'checkbox', checked: this.showDone, onchange: (e) => { this.showDone = e.target.checked; this.load(); } }), 'Show completed']),
      ]),
      this.chosenBar(),
      this.canReorder && EL('div', { class: 'tools' }, [
        EL('button', { textContent: '+ Add item', onclick: startAdding }),
        EL('button', { textContent: '+ Add heading', onclick: async () => { this.focusKey = `h:${await store.act('addSublist', this.listId, 'New section')}`; } }),
      ]),
      this.data.sublists.map((s) => this.sublist(s)),
      empty && EL('p', { class: 'quiet', textContent: this.state.search ? 'Nothing found.' : 'Nothing here.' }),
    ];
  }
}
customElements.define('sutra-list', SutraList);
