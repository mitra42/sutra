// Sets the hub's password, used to sign in where a passkey can't be (and to make the first passkey).
//   npm run set-password                 asks for the new password (twice); nothing is shown as you type
//   npm run set-password -- --sign-out-all   also signs out every browser
//   npm run set-password -- --data <folder>  a hub whose data is somewhere other than app/data-hub
// Only the hub has a login; the laptop's own server answers only pages on the laptop itself.
// Takes effect at once: the hub need not be restarted.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readAuth, writeAuth, hashPassword } from '../auth.js';

const args = process.argv.slice(2);
const at = args.indexOf('--data');
const dataDir = at >= 0 ? path.resolve(args[at + 1]) : process.env.SUTRA_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data-hub');

// Reads a line without showing it.
function ask(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const input = process.stdin;
    let text = '';
    if (!input.isTTY) { // piped in (as the tests do)
      input.once('data', (d) => resolve(String(d).split('\n')[0]));
      return;
    }
    input.setRawMode(true);
    input.resume();
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') {
          input.setRawMode(false); input.pause(); input.off('data', onData);
          process.stdout.write('\n');
          resolve(text);
          return;
        }
        if (ch === '\u0003') process.exit(1); // Ctrl-C
        if (ch === '\u007f') text = text.slice(0, -1); else text += ch;
      }
    };
    input.on('data', onData);
  });
}

if (!fs.existsSync(dataDir)) { console.error(`No hub data folder at ${dataDir} (use --data <folder>)`); process.exit(1); }
const first = await ask('New password for the hub: ');
if (first.length < 8) { console.error('Please use at least 8 characters.'); process.exit(1); }
if (process.stdin.isTTY) {
  const again = await ask('Same again: ');
  if (again !== first) { console.error('They differ; nothing changed.'); process.exit(1); }
}
const auth = readAuth(dataDir);
auth.password = hashPassword(first);
if (args.includes('--sign-out-all')) auth.sessions = {};
writeAuth(dataDir, auth);
console.log(`Password set for the hub in ${dataDir}.${args.includes('--sign-out-all') ? ' Every browser is signed out.' : ''}`);
process.exit(0);
