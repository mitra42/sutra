// Shared by the test pages: facts about where the page is running, and the service worker.

export function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v);
  });
  children.flat().forEach((c) => e.append(c));
  return e;
}

export function yesNo(value) {
  return el('span', { class: value ? 'ok' : 'bad' }, value ? 'yes' : 'no');
}

export function installed() {
  // navigator.standalone is the iPhone's own flag; display-mode covers Chrome.
  return !!navigator.standalone || matchMedia('(display-mode: standalone)').matches;
}

export async function environmentRows() {
  const rows = [
    ['Opened as an installed app', yesNo(installed())],
    ['Online, according to the browser', yesNo(navigator.onLine)],
    ['Secure address (https or localhost)', yesNo(window.isSecureContext)],
    ['Isolation headers in effect (needed for the several-tabs method)', yesNo(window.crossOriginIsolated)],
  ];
  if (navigator.storage && navigator.storage.persisted) {
    rows.push(['Storage protected from eviction', yesNo(await navigator.storage.persisted())]);
  }
  if (navigator.storage && navigator.storage.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    rows.push(['Storage used / allowed', `${Math.round(usage / 1024)} KB / ${Math.round(quota / 1048576)} MB`]);
  }
  rows.push(['Service worker controlling this page', yesNo(!!(navigator.serviceWorker && navigator.serviceWorker.controller))]);
  rows.push(['Browser', navigator.userAgent]);
  return rows;
}

export function table(rows) {
  return el('table', {}, rows.map(([k, v]) => el('tr', {}, el('td', {}, k), el('td', {}, v))));
}

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
}

export function nav() {
  return el('nav', {},
    el('a', { href: './index.html' }, 'Start'),
    el('a', { href: './db.html' }, 'Database'),
    el('a', { href: './passkey.html' }, 'Passkey'));
}
