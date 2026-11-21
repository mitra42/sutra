import { table, environmentRows, registerServiceWorker, nav } from './common.js';

const log = document.getElementById('log');

function say(text) {
  log.textContent += `${new Date().toLocaleTimeString()}  ${text}\n`;
}

function random(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// In the real app the server supplies the challenge and checks the answer. Here the page does both
// halves itself, which is enough to show whether the device will go through with it.
document.getElementById('create').onclick = async () => {
  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: random(32),
        rp: { name: 'Sutra tests', id: location.hostname },
        user: { id: random(16), name: 'sutra-test', displayName: 'Sutra test' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      },
    });
    localStorage.setItem('sutra-stage0-passkey', hex(credential.rawId));
    say(`CREATED a passkey. Id ends …${hex(credential.rawId).slice(-8)}`);
  } catch (err) {
    say(`FAILED to create: ${err.name}: ${err.message}`);
  }
};

document.getElementById('signin').onclick = async () => {
  try {
    const assertion = await navigator.credentials.get({
      publicKey: { challenge: random(32), rpId: location.hostname, userVerification: 'preferred' },
    });
    const same = hex(assertion.rawId) === localStorage.getItem('sutra-stage0-passkey');
    say(`SIGNED IN with a passkey. Id ends …${hex(assertion.rawId).slice(-8)}${same ? ' (the one created here)' : ''}`);
  } catch (err) {
    say(`FAILED to sign in: ${err.name}: ${err.message}`);
  }
};

document.getElementById('nav').append(nav());
registerServiceWorker();
say(window.PublicKeyCredential ? 'This browser offers passkeys.' : 'This browser does NOT offer passkeys.');
environmentRows().then((rows) => document.getElementById('env').replaceChildren(table(rows)));
