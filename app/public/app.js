// The page: three panes, kept in step with the address.
import { HTMLElementExtendedMinimum } from 'html-element-extended';
import { store } from './store.js';
import { EL, nav, tabKey, narrow } from './ui.js';
import './bar.js';
import './list.js';
import './card.js';

class SutraApp extends HTMLElementExtendedMinimum {
  connectedCallback() {
    this.bar = EL('sutra-bar', {});
    this.list = EL('sutra-list', { class: 'pane' });
    this.card = EL('sutra-card', { class: 'pane' });
    // Phone only: a line that appears when there is something to say, and the bar along the bottom.
    this.notice = EL('div', { class: 'notice' });
    this.foot = EL('nav', { class: 'foot' }, [
      EL('button', { textContent: 'Home', onclick: () => { this.classList.remove('drawer'); nav.open('home'); } }),
      EL('button', { textContent: 'Search', onclick: () => { this.classList.add('drawer'); this.bar.querySelector('.search').focus(); } }),
      EL('button', { textContent: 'Bar', onclick: () => this.classList.toggle('drawer') }),
      EL('button', { textContent: '+', title: 'Add an item', onclick: () => { this.classList.remove('drawer'); (this.list.hidden ? this.card.ownList : this.list).startAdding(); } }),
    ]);
    this.append(this.notice, this.bar, this.list, this.card, this.foot);
    window.addEventListener('hashchange', () => { this.classList.remove('drawer'); this.route(); });
    narrow.addEventListener('change', () => this.route());
    const tell = async () => {
      const status = await store.status();
      const waiting = status.waiting + (status.server && status.server.hub ? status.server.waiting : 0);
      this.notice.textContent = status.online && !waiting ? '' : `${status.online ? 'online' : 'offline'} · ${waiting} waiting`;
    };
    store.onChange(tell);
    tell();
    window.addEventListener('keydown', (e) => {
      // Undo is general and lasting, within this tab's session (spec 5.3). Inside a text field the
      // browser's own undo of typing is left alone.
      const inEditor = e.target.closest && e.target.closest('.cm-editor');
      const typing = inEditor || (e.target.dataset && e.target.dataset.was !== undefined && e.target.value !== e.target.dataset.was);
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && !typing) {
        e.preventDefault();
        store.undo();
      }
    });
    // Tab then H (Home) and Tab then / (Search) also work when no row has the focus.
    window.addEventListener('keydown', (e) => {
      if (e.target !== document.body || tabKey.isModifier(e)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        tabKey.arm();
      } else if ((key === 'h' || key === '/' || key === 'q') && tabKey.take()) {
        e.preventDefault();
        if (key === 'h') nav.open('home');
        else if (key === 'q') this.list.startAdding();
        else this.bar.querySelector('.search').focus();
      }
    });
    this.route();
  }

  route() {
    const view = nav.parse();
    const set = (element, name, value) => (value ? element.setAttribute(name, value) : element.removeAttribute(name));
    set(this.list, 'search', view.search);
    set(this.list, 'list', view.search ? null : view.list);
    set(this.list, 'selected', view.card);
    // On the phone the card pane is the whole view: the card, with its details folded and its List
    // below. The working List is shown only for search results.
    const one = narrow.matches;
    this.list.hidden = one && !(view.search && !view.card);
    this.card.hidden = one && this.list.hidden === false;
    set(this.card, 'card', one ? (view.card || (view.search ? null : view.list)) : view.card);
    set(this.bar, 'current', view.search ? null : view.list);
    document.title = 'Sutra';
    // This copy may not hold these cards yet: ask for them. The panes redraw when they arrive.
    store.open(...[view.search ? null : view.list, view.card].filter(Boolean)).catch(() => {});
  }
}
customElements.define('sutra-app', SutraApp);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

// Opened by a web+sutra: link (the manifest's protocol handler): go to the card it names.
{
  const opened = new URLSearchParams(location.search).get('open');
  if (opened) {
    const id = decodeURIComponent(opened).replace(/^web\+sutra:\/*/, '');
    history.replaceState(null, '', `${location.pathname}#/l/${encodeURIComponent(id)}/c/${encodeURIComponent(id)}`);
    window.dispatchEvent(new Event('hashchange'));
  }
}

// A Sutra link opened while the installed app is running goes to the app's window (Chrome 139 and
// later, by the manifest's launch_handler); this shows the card it points to.
if ('launchQueue' in window) {
  window.launchQueue.setConsumer((params) => {
    if (!params.targetURL) return;
    const target = new URL(params.targetURL);
    const opened = target.searchParams.get('open');
    if (opened) {
      const id = decodeURIComponent(opened).replace(/^web\+sutra:\/*/, '');
      location.hash = `#/l/${encodeURIComponent(id)}/c/${encodeURIComponent(id)}`;
    } else if (target.hash && target.hash !== location.hash) location.hash = target.hash;
  });
}
