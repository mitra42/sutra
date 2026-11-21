// The selected card: its details, where it belongs, its Note, and its own List.
import { store } from './store.js';
import { EL, on, field, nav, deleteCard, narrow, repeatWords, parseRepeat, repeatButton, copyLink, SutraElement } from './ui.js';
import { relationshipNames } from '/core/query.js';
import { makeEditor } from './editor.js';
import './list.js';

const REPEATS = ['none', 'daily', 'weekly', 'monthly'];
// The relationship offered when adding one: the last one used in this browser.
const LAST_RELATION = 'sutra-last-relation';
const FIRST_RELATION = '#Blocking / Blocked';

class SutraCard extends SutraElement {
  static get observedAttributes() { return ['card']; }

  constructor() {
    super();
    this.picker = null; // what a search-to-pick box is for, and what it found
    this.unfolded = false; // on the phone the details start folded away
    this.relationHeading = localStorage.getItem(LAST_RELATION) || FIRST_RELATION;
    // The Note being edited belongs to noteCard, which is not always the card on show: a save can
    // come a moment after another card has been selected, and must still go to the right card.
    this.noteCard = null;
    this.editor = makeEditor((text) => this.noteCard && store.act('edit', this.noteCard, { note: text }));
    this.ownList = EL('sutra-list', { embedded: '1' });
  }

  get cardId() { return this.state.card; }

  // A different card starts folded again.
  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      this.unfolded = false;
      this.customRepeat = false;
      this.picker = null;
      this.relationReversed = false;
    }
    super.attributeChangedCallback(name, oldValue, newValue);
  }

  async fetchData() {
    const id = this.cardId;
    if (!id) return null;
    const card = await store.get('card', id);
    if (!card) return { missing: true };
    const [memberships, list, conflicts, headings] = await Promise.all([
      store.get('memberships', id), store.get('list', id), store.get('conflictsFor', id), store.get('headings'),
    ]);
    return { card, memberships, relationships: list ? list.relationships : [], conflicts, headings };
  }

  set(fields) { return store.act('edit', this.cardId, fields); }

  // A box to find a card by typing: suggestions as you type, a click on one picks it, Return takes
  // the first. `options.find` replaces the usual search; `options.enter` handles Return itself;
  // `options.tidy` adjusts what is typed as it is typed.
  pick(kind, placeholder, onPick, options = {}) {
    const open = this.picker && this.picker.kind === kind;
    return EL('span', { class: 'pick' }, [
      on(EL('input', { type: 'text', class: 'small', placeholder, 'data-key': `pick:${kind}`, autocomplete: 'off' }), {
        // Suggestions appear as you type; titles that match come ahead of matches in a Note.
        input: (e) => {
          if (options.tidy) {
            const tidied = options.tidy(e.target.value);
            if (tidied !== e.target.value) e.target.value = tidied;
          }
          clearTimeout(this.pickTimer);
          const text = e.target.value.trim();
          this.pickTimer = setTimeout(async () => {
            if (!text || (options.tidy && text === options.tidy(''))) { this.picker = null; this.draw(); return; }
            if (options.find) { this.picker = { kind, found: await options.find(text) }; this.draw(); return; }
            const all = (await store.search(text, 40)).filter((c) => !c.trashed && c.id !== this.cardId);
            const inTitle = (c) => { try { return new RegExp(text, 'i').test(c.title); } catch (err) { return c.title.toLowerCase().includes(text.toLowerCase()); } };
            this.picker = { kind, found: [...all.filter(inTitle), ...all.filter((c) => !inTitle(c))].slice(0, 8) };
            this.draw();
          }, 200);
        },
        keydown: (e) => {
          if (e.key === 'Escape') { this.picker = null; e.target.value = ''; this.draw(); }
          if (e.key === 'Enter' && options.enter) {
            const text = e.target.value.trim();
            this.picker = null;
            e.target.value = '';
            options.enter(text);
            return;
          }
          // Return takes the first suggestion.
          if (e.key === 'Enter' && this.picker && this.picker.kind === kind && this.picker.found.length) {
            const first = this.picker.found[0];
            this.picker = null;
            e.target.value = '';
            onPick(first);
          }
        },
        // Clicking anywhere else puts the suggestions away.
        blur: (e) => {
          if (this.drawing) return;
          clearTimeout(this.pickTimer);
          e.target.value = '';
          if (this.picker) { this.picker = null; setTimeout(() => this.draw(), 0); }
        },
      }),
      open && EL('span', { class: 'results' }, this.picker.found.length
        // On mousedown, and without taking the focus, so that the box's blur does not come first.
        ? this.picker.found.map((c) => on(EL('a', { textContent: c.title || '(untitled)' }), { mousedown: (e) => { e.preventDefault(); this.picker = null; onPick(c); this.draw(); } }))
        : [EL('span', { class: 'quiet', textContent: 'Nothing found' })]),
    ]);
  }

  chip(text, onOpen, onRemove) {
    return EL('span', { class: 'chip' }, [
      EL('a', { textContent: text, onclick: onOpen }),
      onRemove && EL('button', { textContent: '×', title: 'Remove', onclick: onRemove }),
    ]);
  }

  render() {
    if (!this.data) return EL('p', { class: 'quiet', textContent: 'Select a card to see it here.' });
    if (this.data.missing) return EL('p', { class: 'quiet', textContent: 'Fetching…' });
    const { card, memberships, relationships, conflicts, headings } = this.data;
    const id = card.id;
    const folded = narrow.matches && !this.unfolded;
    this.folded = folded;
    if (this.noteCard !== id) {
      this.editor.flush();
      this.noteCard = id;
      this.editor.load(card.note);
    } else {
      this.editor.show(card.note);
    }
    this.ownList.setAttribute('list', id);
    const row = (label, ...content) => EL('div', { class: 'line' }, [EL('span', { class: 'label', textContent: label }), ...content]);
    const date = (name) => on(EL('input', { type: 'date', value: card[name] || '', 'data-key': name }), { change: (e) => this.set({ [name]: e.target.value || null }) });
    // Kept on the component, since finding the other card redraws this one.
    const relationHeading = on(EL('input', { type: 'text', class: 'small', placeholder: '#blocked by / blocking', list: 'headings', 'data-key': 'relhead', value: this.relationHeading }),
      { input: (e) => { this.relationHeading = e.target.value; }, change: () => this.draw() });

    return [
      card.trashed && EL('div', { class: 'banner' }, ['This card is in Trash. ', EL('button', { textContent: 'Restore', onclick: () => store.act('restore', id) })]),
      conflicts.map((c) => EL('div', { class: 'banner' }, [
        c.kind === 'note' ? 'The Note was changed on two devices. Both texts are in it, to be put back together by hand. '
          : `"${c.field}" was changed on two devices. The later change stands. The other value was: "${c.other === null ? '' : c.other}". `,
        c.kind === 'field' && EL('button', { textContent: 'Use this instead', onclick: () => store.act('settle', c.id, { useOther: true }) }),
        EL('button', { textContent: c.kind === 'note' ? 'Done' : 'Keep as it is', onclick: () => store.act('settle', c.id) }),
      ])),
      EL('div', { class: 'cardhead' }, [
        narrow.matches && id !== 'home' && EL('button', { textContent: '‹', title: 'Back', onclick: () => nav.back() }),
        card.type === 'task' && card.repeat && card.repeat !== 'none' && !card.completed && repeatButton(card),
        card.type === 'task' && !(card.repeat && card.repeat !== 'none' && !card.completed) && EL('input', { type: 'checkbox', checked: !!card.completed, title: 'Complete', onchange: () => store.act(card.completed ? 'uncomplete' : 'complete', id) }),
        field({ class: 'title big', value: card.title, 'data-key': 'title', placeholder: 'Title' }, { change: (e) => this.set({ title: e.target.value }) }),
        EL('button', { class: 'link', textContent: '🔗', title: 'Copy a link to this card (as a web link or an app link; Option-click: the app link at once)', onclick: (e) => copyLink(id, e.target, e.altKey || undefined) }),
        !card.trashed && !folded && EL('button', { textContent: 'Delete', onclick: () => deleteCard(id) }),
        narrow.matches && EL('button', { textContent: folded ? '▾' : '▴', title: 'Details', onclick: () => { this.unfolded = folded; this.draw(); } }),
      ]),
      // Folded: one line of what matters, in place of the details.
      folded && EL('div', { class: 'summary quiet', onclick: () => { this.unfolded = true; this.draw(); } }, [[
        card.due && `Due ${card.due}`, card.overdue && `Overdue ${card.overdue}`, card.repeat !== 'none' && repeatWords(card.repeat),
        ...memberships.tags.map((t) => t.title), memberships.lists.length && `in ${memberships.lists.map((l) => l.title).join(', ')}`,
        card.note && `Note: ${card.note.split('\n')[0].slice(0, 60)}`,
      ].filter(Boolean).join(' · ')]),
      !folded && [
      row('', [
        card.type === 'dynamic' ? EL('span', { class: 'quiet', textContent: 'Query card' })
          : EL('select', { title: 'What kind of card this is', onchange: (e) => this.set({ type: e.target.value }) },
            ['task', 'note', 'person', 'company'].map((t) => EL('option', { value: t, textContent: t[0].toUpperCase() + t.slice(1), selected: t === card.type }))),
        EL('label', {}, ['Due ', date('due')]), EL('label', {}, ['Overdue ', date('overdue')]),
        EL('label', {}, ['Repeat ', this.customRepeat
          // A number and a unit: 3d, 2w, 6m.
          ? on(EL('input', { type: 'text', class: 'small', placeholder: '3d, mon thu, 1st, last…', 'data-key': 'repeat', title: 'Every so often: 3d, 2w, 6m (from the day done). Or on days: mon, mon thu, weekdays, 1st, 15th, last (day of the month). Return to set, Esc to cancel.' }), {
            blur: () => { if (!this.drawing) { this.customRepeat = false; setTimeout(() => this.draw(), 0); } },
            keydown: (e) => {
              const value = e.target.value.trim().toLowerCase();
              if (e.key === 'Escape') { this.customRepeat = false; this.draw(); }
              if (e.key === 'Enter') {
                const code = parseRepeat(value);
                if (code) { this.customRepeat = false; this.set({ repeat: code }); } else e.target.classList.add('bad');
              }
            },
          })
          : EL('select', { onchange: (e) => { if (e.target.value === 'custom') { this.customRepeat = true; this.focusKey = 'repeat'; this.draw(); } else this.set({ repeat: e.target.value }); } }, [
            ...[...REPEATS, ...(REPEATS.includes(card.repeat) ? [] : [card.repeat])].map((r) => EL('option', { value: r, textContent: repeatWords(r), selected: r === card.repeat })),
            EL('option', { value: 'custom', textContent: 'other…' }),
          ])]),
        EL('label', { class: 'toggle', title: 'Keep this card and its List on the phone' }, [EL('input', { type: 'checkbox', checked: !!card.offline, onchange: (e) => this.set({ offline: e.target.checked }) }), 'Offline']),
      ]),
      card.type === 'dynamic' && row('Query', field({ class: 'wide', value: card.query || '', 'data-key': 'query' }, { change: (e) => this.set({ query: e.target.value }) })),
      row('In', memberships.lists.map((l) => this.chip(l.title || '(untitled)', () => nav.open(l.id, id), () => store.act('removeFromList', l.id, id))),
        this.pick('in', '+ add to a list', (c) => store.act('addToList', c.id, id))),
      row('Tags', memberships.tags.map((t) => this.chip(t.title, () => nav.open(t.id, id), () => store.act('removeFromList', t.id, id))),
        // Suggests existing tags as you type; Return uses exactly what was typed (a new tag if need
        // be), a click uses the suggestion. A # is put in front if it was not typed.
        this.pick('tag', '+ tag', (t) => store.act('tag', id, t.title), {
          tidy: (text) => (text && !text.startsWith('#') ? `#${text}` : text),
          find: async (text) => {
            const typed = text.replace(/^#/, '').trim().toLowerCase();
            const have = new Set(memberships.tags.map((t) => t.title.toLowerCase()));
            const found = (await store.search(`^#`, 400)).filter((c) => c.title.startsWith('#') && !c.trashed && !have.has(c.title.toLowerCase()));
            const starts = found.filter((c) => c.title.slice(1).toLowerCase().startsWith(typed));
            const contains = found.filter((c) => !starts.includes(c) && c.title.toLowerCase().includes(typed));
            return [...starts, ...contains].slice(0, 8);
          },
          enter: (text) => { if (text.replace(/^#/, '').trim()) store.act('tag', id, text); },
        })),
      // Relationships read one way on the card that owns the entry and the other way on the other card.
      relationships.filter((r) => r.cards.length).map((r) => row(r.label, r.cards.map((c) => this.chip(c.title || '(untitled)', () => nav.select(c.id), () => store.act('unrelate', id, c.id))))),
      memberships.relationships.map((r) => row(r.label, this.chip(r.card.title || '(untitled)', () => nav.select(r.card.id), () => store.act('unrelate', r.card.id, id)))),
      // The relationship is recorded on whichever card owns it; "as" says which name this card will
      // show, and ⇄ turns it round, so "this card is Blocked by …" can be set from this card.
      row('Relate', relationHeading, EL('datalist', { id: 'headings' }, headings.map((h) => EL('option', { value: h }))),
        (() => {
          const names = relationshipNames(this.relationHeading.trim()) || ['', ''];
          const label = this.relationReversed ? names[1] : names[0];
          return EL('button', {
            class: 'direction',
            textContent: `this card: ${label || '…'} ⇄`,
            title: 'Which name this card will show. Click to turn the relationship round.',
            onclick: () => { this.relationReversed = !this.relationReversed; this.draw(); },
          });
        })(),
        this.pick('rel', 'which card?', (c) => {
          const heading = this.relationHeading.trim();
          if (!heading.startsWith('#')) return;
          localStorage.setItem(LAST_RELATION, heading);
          if (this.relationReversed) store.act('relate', c.id, id, heading);
          else store.act('relate', id, c.id, heading);
        })),
      ],
    ];
  }

  // The details are redrawn; the Note editor and the card's own List stay in place, so that typing
  // in either is not disturbed when the details change.
  renderAndReplace() {
    if (!this.details) {
      this.details = EL('div', {});
      this.noteBox = EL('div', { class: 'note' }, [this.editor.element]);
      this.append(this.details, this.noteBox, this.ownList);
    }
    this.details.replaceChildren(...[this.render()].flat(Infinity).filter(Boolean));
    const showing = !!(this.data && !this.data.missing);
    this.noteBox.hidden = !showing || this.folded;
    this.ownList.hidden = !showing;
  }
}
customElements.define('sutra-card', SutraCard);
