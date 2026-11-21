#!/usr/bin/env node
// Hands-on test (like stage 0): can Sutra read the Mac's Contacts through macOS's own scripting,
// with nothing to install, and is it quick enough? Read-only: it changes nothing in Contacts.
//   node scripts/test-contacts.js ["part of a name"]
// The first time, macOS asks whether Terminal (or whatever runs this) may use Contacts: allow it.
// It prints counts and timings, and the name, emails and phone numbers of up to five people whose
// name contains the text given (default: the first five). Nothing is sent anywhere.
import { execFile } from 'node:child_process';

const SCRIPT = `
function run(argv) {
  const want = (argv[0] || '').toLowerCase();
  const Contacts = Application('Contacts');
  const t0 = Date.now();
  const people = Contacts.people;
  const names = people.name();
  const t1 = Date.now();
  const ids = people.id();
  const orgs = people.organization();
  const emails = people.emails.value();
  const phones = people.phones.value();
  const t2 = Date.now();
  const picked = [];
  for (let i = 0; i < names.length && picked.length < 5; i += 1) {
    if (!want || String(names[i] || '').toLowerCase().includes(want)) {
      picked.push({ id: ids[i], name: names[i], organization: orgs[i], emails: emails[i], phones: phones[i] });
    }
  }
  const t3 = Date.now();
  // The other way to look someone up: asking Contacts to search, as the server might per keystroke.
  const found = want ? Contacts.people.whose({ name: { _contains: want } }).name().length : null;
  const t4 = Date.now();
  return JSON.stringify({ count: names.length, msNames: t1 - t0, msAllDetails: t2 - t1, msPick: t3 - t2, whoseCount: found, msWhose: want ? t4 - t3 : null, picked });
}`;

const want = process.argv[2] || '';
const started = Date.now();
execFile('osascript', ['-l', 'JavaScript', '-e', SCRIPT, want], { maxBuffer: 64 * 1024 * 1024, timeout: 180000 }, (err, stdout, stderr) => {
  const total = Date.now() - started;
  if (err) {
    console.log('FAILED after', total, 'ms');
    console.log(String(stderr || err.message).trim());
    console.log('\nIf it mentions "not allowed" or error -1743: System Settings, Privacy & Security, Contacts (or Automation), allow Terminal; then run again.');
    process.exit(1);
  }
  const r = JSON.parse(stdout);
  console.log(`Contacts read: ${r.count} people.`);
  console.log(`Time: names ${r.msNames} ms; ids, organisations, emails and phones for everyone ${r.msAllDetails} ms; whole run ${total} ms.`);
  if (r.whoseCount !== null) console.log(`Asking Contacts to search for "${want}": ${r.whoseCount} found in ${r.msWhose} ms.`);
  console.log(`\nUp to five ${want ? `whose name contains "${want}"` : 'people'}:`);
  r.picked.forEach((p) => console.log(`- ${p.name}${p.organization ? ` (${p.organization})` : ''} | emails: ${(p.emails || []).join(', ') || '-'} | phones: ${(p.phones || []).join(', ') || '-'} | id: ${p.id}`));
  console.log('\nPlease tell Claude: the counts and times above, and whether the details look right. No need to send the names.');
});
