import { el, environmentRows, table, registerServiceWorker, nav, yesNo } from './common.js';

// What the service worker managed to store, so a failure to open offline can be explained.
async function offlineRows() {
  if (!('serviceWorker' in navigator)) return [['Service worker', 'not offered by this browser']];
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return [['Service worker registered', yesNo(false)]];
  const state = ['installing', 'waiting', 'active'].filter((k) => registration[k]).join(', ');
  const rows = [
    ['Service worker registered', yesNo(true)],
    ['Its state', state || 'none'],
    ['Controlling this page', yesNo(!!navigator.serviceWorker.controller)],
  ];
  const names = (await caches.keys()).filter((n) => n.startsWith('sutra-stage0-'));
  rows.push(['Stores found', names.join(', ') || 'none']);
  for (const name of names) {
    const cache = await caches.open(name);
    const reportResponse = await cache.match('./sw-report.json');
    if (!reportResponse) {
      rows.push([name, 'no report (an older version of these pages)']);
    } else {
      const report = await reportResponse.json();
      const failed = report.files.filter((f) => !f.ok);
      rows.push([`${name}: files stored`, el('span', { class: failed.length ? 'bad' : 'ok' },
        `${report.files.length - failed.length} of ${report.files.length}`)]);
      rows.push([`${name}: stored at`, report.at]);
      failed.forEach((f) => rows.push([`FAILED ${f.url}`, f.error]));
    }
  }
  return rows;
}

async function show() {
  document.getElementById('env').replaceChildren(table(await environmentRows()));
  try {
    document.getElementById('offline').replaceChildren(table(await offlineRows()));
  } catch (err) {
    document.getElementById('offline').replaceChildren(el('span', { class: 'bad' }, err.message));
  }
}

document.getElementById('nav').append(nav());
document.getElementById('again').onclick = show;
registerServiceWorker();
show();
// The first visit installs the service worker after the page has drawn; show the result once it settles.
if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(() => setTimeout(show, 1500));
