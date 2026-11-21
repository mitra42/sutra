// The quick-access bar. It is the List of the built-in card "quick", so it is filled, ordered and
// given headings like any other List; "Edit bar" opens that card.
import { store } from './store.js';
import { EL, on, nav, SutraElement } from './ui.js';

let barDrag = null;

class SutraBar extends SutraElement {
  static get observedAttributes() { return ['current']; }

  constructor() {
    super();
    on(this, {
      // The bar's own entries drag to reorder it; cards dragged in from a List are added.
      dragstart: (e) => {
        const entry = e.target.closest && e.target.closest('.entry[data-sublist]');
        if (!entry) return;
        e.dataTransfer.setData('application/x-sutra-bar', entry.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
        barDrag = entry.dataset.id;
      },
      dragend: () => { barDrag = null; this.mark(null); },
      dragover: (e) => {
        e.preventDefault();
        if (barDrag) this.mark(this.spot(e));
      },
      dragleave: (e) => { if (!this.contains(e.relatedTarget)) this.mark(null); },
      drop: async (e) => {
        this.mark(null);
        const moving = e.dataTransfer.getData('application/x-sutra-bar');
        if (moving) {
          e.preventDefault();
          const spot = this.spot(e);
          if (!spot || spot.element.dataset.id === moving) return;
          const where = { sublist: spot.element.dataset.sublist || null };
          if (spot.element.classList.contains('entry')) where[spot.name === 'dropline' ? 'before' : 'after'] = spot.element.dataset.id;
          await store.act('move', 'quick', moving, where);
          return;
        }
        const raw = e.dataTransfer.getData('application/x-sutra');
        if (!raw) return;
        e.preventDefault();
        const payload = JSON.parse(raw);
        const onto = e.target.closest('[data-id]');
        // Dropped on an entry: the cards are added to that card's List. Dropped elsewhere: to the bar.
        const into = onto ? onto.dataset.id : 'quick';
        await store.batch((payload.ids || [payload.id]).filter((id) => id !== into).map((id) => ['addToList', into, id]));
        document.dispatchEvent(new Event('sutra-dropped'));
      },
    });
  }

  // Where an entry being moved would land: above or below an entry, or first under a heading.
  spot(e) {
    const over = e.target.closest && e.target.closest('.entry[data-sublist], .barhead');
    if (!over) return null;
    if (over.classList.contains('barhead')) return { element: over, name: 'droplineafter' };
    const box = over.getBoundingClientRect();
    return { element: over, name: e.clientY > box.top + box.height / 2 ? 'droplineafter' : 'dropline' };
  }

  mark(spot) {
    this.querySelectorAll('.dropline, .droplineafter').forEach((n) => n.classList.remove('dropline', 'droplineafter'));
    if (spot) spot.element.classList.add(spot.name);
  }

  async fetchData() {
    // The status is asked for separately and drawn when it arrives: it involves the server, and the
    // bar's entries must never wait on that.
    store.status().then((status) => { this.status = status; if (this.data) this.draw(); }).catch(() => {});
    const [list, conflicts] = await Promise.all([store.get('list', 'quick'), store.get('list', 'conflicts')]);
    return { list, conflicts: conflicts ? conflicts.sublists[0].cards.length : 0 };
  }

  entry(card, sublistId) {
    const count = card.id === 'conflicts' && this.data.conflicts ? ` ${this.data.conflicts}` : '';
    return EL('div', { class: card.id === this.state.current ? 'entry current' : 'entry', 'data-id': card.id, 'data-sublist': sublistId || '', draggable: 'true' }, [
      EL('a', { textContent: `${card.title || '(untitled)'}${count}`, onclick: () => nav.open(card.id) }),
      EL('button', { textContent: '×', title: 'Remove from the bar', onclick: () => store.act('removeFromList', 'quick', card.id) }),
    ]);
  }

  render() {
    if (!this.data || !this.data.list) return EL('div', { class: 'brand', textContent: 'Sutra' });
    const { list } = this.data;
    const status = this.status || { online: false, waiting: 0, method: '', device: '', server: null };
    return [
      EL('div', { class: 'brand', textContent: 'Sutra' }),
      EL('div', { class: this.state.current === 'home' ? 'entry current' : 'entry', 'data-id': 'home' }, [EL('a', { textContent: 'Home', onclick: () => nav.open('home') })]),
      on(EL('input', { type: 'search', class: 'search', placeholder: 'Search', 'data-key': 'search', autocomplete: 'off' }), {
        keydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) nav.search(e.target.value.trim()); },
      }),
      list.sublists.map((s) => [
        s.heading !== null && EL('div', { class: 'barhead', textContent: s.heading, 'data-sublist': s.id }),
        s.cards.map((c) => this.entry(c, s.id)),
      ]),
      EL('a', { class: 'quiet', textContent: 'Edit bar', onclick: () => nav.open('quick') }),
      this.status && this.status.server && this.status.server.role === 'hub' && EL('a', { class: 'quiet', href: '/login.html', textContent: 'Sign-in and passkeys' }),
      EL('div', { class: status.online ? 'status' : 'status off', title: `Storage: ${status.method}. This copy: ${status.device}` },
        [`${status.online ? 'online' : 'offline'} · ${status.waiting} waiting`]),
      status.signedOut && EL('a', { class: 'status off', href: '/login.html', textContent: 'signed out: sign in', title: 'The hub needs this browser to sign in before it can sync' }),
      // The laptop's server and its hub: one step further up the chain.
      status.server && status.server.role === 'node' && EL('div', {
        class: status.server.hub && !status.server.hub.online ? 'status more off' : 'status more',
        title: status.server.hub ? `Hub: ${status.server.hub.url}${status.server.hub.error ? `. ${status.server.hub.error}` : ''}` : 'This server has no hub yet; it keeps every change to pass on later.',
      }, [status.server.hub
        ? `hub ${status.server.hub.online ? 'online' : (status.server.hub.error || '').includes('refused') ? 'refused the key' : 'offline'} · ${status.server.waiting} waiting`
        : `no hub · ${status.server.waiting} kept`]),
    ];
  }
}
customElements.define('sutra-bar', SutraBar);
