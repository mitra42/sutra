// The hub's sign-in page (auth.js on the server). Signing in sets a cookie the server reads;
// nothing about the login is kept in the page.
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '/node_modules/@simplewebauthn/browser/esm/index.js';

const $ = (id) => document.getElementById(id);
const say = (text) => { $('message').textContent = text; };
// Only a page on this site may be gone on to after signing in.
const then = (() => { const t = new URLSearchParams(location.search).get('then') || '/'; return t.startsWith('/') && !t.startsWith('//') ? t : '/'; })();

async function post(path, body = {}) {
  const response = await fetch(`/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(answer.error || `The hub said ${response.status}`);
  return answer;
}

async function show() {
  const status = await (await fetch('/auth/status')).json();
  $('out').hidden = status.signedIn;
  $('in').hidden = !status.signedIn;
  $('pw').hidden = !status.hasPassword;
  $('passkey').hidden = !browserSupportsWebAuthn();
  $('go').href = then;
  $('keys').replaceChildren(...(status.passkeys.length ? status.passkeys.map((k) => {
    const li = document.createElement('li');
    const forget = document.createElement('button');
    forget.textContent = 'Forget';
    forget.onclick = async () => { await post('passkey/forget', { name: k.name }); say(`Forgot "${k.name}". (Remove it from the device's passwords too.)`); show(); };
    li.append(`${k.name} (made ${k.created}) `, forget);
    return li;
  }) : [Object.assign(document.createElement('li'), { textContent: 'None yet.' })]));
  if (!status.signedIn && !status.hasPassword && !status.passkeys.length) say("No password is set yet. On the hub's machine, in the app folder, run: npm run set-password");
}

const signedIn = () => { location.href = then; };

$('passkey').onclick = async () => {
  try {
    say('');
    const options = await post('passkey/options');
    const response = await startAuthentication({ optionsJSON: options });
    await post('passkey/verify', response);
    signedIn();
  } catch (err) { say(err.name === 'NotAllowedError' ? 'Cancelled.' : err.message); }
};

$('pw').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await post('password', { password: $('password').value });
    signedIn();
  } catch (err) { say(err.message); $('password').select(); }
};

$('newkey').onclick = async () => {
  try {
    const name = $('keyname').value.trim() || (/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'this computer');
    const options = await post('passkey/new-options');
    const response = await startRegistration({ optionsJSON: options });
    await post('passkey/new', { name, response });
    say(`Passkey "${name}" made. Next time, "Sign in with a passkey".`);
    $('keyname').value = '';
    show();
  } catch (err) { say(err.name === 'NotAllowedError' ? 'Cancelled.' : err.message); }
};

$('signout').onclick = async () => { await post('signout'); say('Signed out.'); show(); };

show();
