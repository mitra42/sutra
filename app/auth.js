// Signing in to the hub (spec section 7). The laptop's own server has no login: it answers only
// pages on the laptop itself. The hub can be reached from elsewhere, so a browser must sign in,
// with a passkey or, as a fallback, a password. Other servers (the laptop's) use the hub key as before.
//
// What is kept, in auth.json in the hub's data folder (never synced, never in the database):
//   password   a scrypt hash of the password, set with "npm run set-password"
//   passkeys   the public half of each passkey made on the "Sign-in" page
//   sessions   a hash of each signed-in browser's cookie, with when it was last used
// Signing in sets a cookie that only the server can read or set (HttpOnly), sent only to this site
// (SameSite=Strict), which is what lets the iPhone keep it for more than 7 days.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
  generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const COOKIE = 'sutra_session';
const LIFE_DAYS = 400; // the longest a browser keeps a cookie
const DAY = 24 * 60 * 60 * 1000;

const hash = (token) => crypto.createHash('sha256').update(token).digest('base64url');

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  return { salt, hash: crypto.scryptSync(password, salt, 32).toString('base64url') };
}

function passwordMatches(password, stored) {
  if (!stored) return false;
  const tried = crypto.scryptSync(String(password), stored.salt, 32);
  const real = Buffer.from(stored.hash, 'base64url');
  return tried.length === real.length && crypto.timingSafeEqual(tried, real);
}

export function readAuth(dataDir) {
  try {
    return { password: null, passkeys: [], sessions: {}, ...JSON.parse(fs.readFileSync(path.join(dataDir, 'auth.json'), 'utf8')) };
  } catch {
    return { password: null, passkeys: [], sessions: {} };
  }
}

export function writeAuth(dataDir, auth) {
  const file = path.join(dataDir, 'auth.json');
  fs.writeFileSync(`${file}.new`, JSON.stringify(auth, null, 1), { mode: 0o600 });
  fs.renameSync(`${file}.new`, file);
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2));
}

// Where the browser thinks it is: what a passkey is tied to. Behind Apache on the VM this comes
// from the headers Apache adds (the server trusts them only from the VM itself).
function site(req) {
  const origin = `${req.protocol}://${req.get('host')}`;
  return { origin, rpID: req.hostname };
}

export function makeAuth(dataDir) {
  let auth = readAuth(dataDir);
  const save = () => writeAuth(dataDir, auth);
  const challenges = new Map(); // challenge → when it was made; good for 5 minutes
  const fresh = (challenge) => {
    const made = challenges.get(challenge);
    challenges.delete(challenge);
    return made && Date.now() - made < 5 * 60 * 1000;
  };
  let failures = 0;
  let waitUntil = 0;

  function session(req) {
    const token = cookies(req)[COOKIE];
    if (!token) return null;
    const s = auth.sessions[hash(token)];
    if (!s || Date.now() - s.lastUsed > LIFE_DAYS * DAY) return null;
    // Note the use at most once a day, so that the file is not rewritten on every request.
    if (Date.now() - s.lastUsed > DAY) { s.lastUsed = Date.now(); save(); }
    return s;
  }

  function signIn(req, res, how) {
    const token = crypto.randomBytes(32).toString('base64url');
    auth.sessions[hash(token)] = { created: Date.now(), lastUsed: Date.now(), how, agent: String(req.get('user-agent') || '').slice(0, 120) };
    // Forget sessions not used for longer than a cookie lasts.
    for (const [k, s] of Object.entries(auth.sessions)) if (Date.now() - s.lastUsed > LIFE_DAYS * DAY) delete auth.sessions[k];
    save();
    res.set('Set-Cookie', `${COOKIE}=${token}; Path=/; Max-Age=${LIFE_DAYS * 24 * 3600}; HttpOnly; SameSite=Strict${req.secure ? '; Secure' : ''}`);
  }

  const router = express.Router();
  router.use(express.json());
  // Only this site's own pages may sign in or out: the cookie's SameSite does the same for the rest.
  router.use((req, res, next) => {
    const origin = req.headers.origin;
    if (req.method === 'POST' && origin && origin !== site(req).origin) { res.status(403).json({ error: 'Not from this site' }); return; }
    next();
  });

  router.get('/status', (req, res) => {
    auth = readAuth(dataDir); // set-password may have changed it
    res.json({ signedIn: !!session(req), hasPassword: !!auth.password, passkeys: auth.passkeys.map((p) => ({ name: p.name, created: p.created })) });
  });

  router.post('/password', (req, res) => {
    auth = readAuth(dataDir);
    if (Date.now() < waitUntil) { res.status(429).json({ error: 'Too many wrong tries: wait a few seconds' }); return; }
    if (!auth.password) { res.status(400).json({ error: 'No password is set. On the hub\'s machine, run: npm run set-password' }); return; }
    if (!passwordMatches(req.body.password, auth.password)) {
      failures += 1;
      if (failures >= 5) waitUntil = Date.now() + 10 * 1000;
      res.status(401).json({ error: 'Wrong password' });
      return;
    }
    failures = 0;
    signIn(req, res, 'password');
    res.json({ ok: true });
  });

  router.post('/passkey/options', async (req, res) => {
    const options = await generateAuthenticationOptions({ rpID: site(req).rpID, userVerification: 'preferred' });
    challenges.set(options.challenge, Date.now());
    res.json(options);
  });

  router.post('/passkey/verify', async (req, res) => {
    auth = readAuth(dataDir);
    const key = auth.passkeys.find((p) => p.id === req.body.id);
    if (!key) { res.status(401).json({ error: 'This passkey is not one this hub knows' }); return; }
    try {
      const { verified, authenticationInfo } = await verifyAuthenticationResponse({
        response: req.body, expectedChallenge: fresh, expectedOrigin: site(req).origin, expectedRPID: site(req).rpID,
        credential: { id: key.id, publicKey: Buffer.from(key.publicKey, 'base64url'), counter: key.counter, transports: key.transports },
      });
      if (!verified) throw new Error('not verified');
      key.counter = authenticationInfo.newCounter;
      key.lastUsed = Date.now();
      signIn(req, res, `passkey ${key.name}`);
      res.json({ ok: true });
    } catch (err) {
      res.status(401).json({ error: `The passkey was not accepted (${err.message})` });
    }
  });

  // Making a passkey needs a browser that is already signed in (with the password, the first time).
  const signedIn = (req, res, next) => (session(req) ? next() : res.status(401).json({ error: 'Sign in first' }));

  router.post('/passkey/new-options', signedIn, async (req, res) => {
    const options = await generateRegistrationOptions({
      rpName: 'Sutra', rpID: site(req).rpID, userName: 'sutra', userDisplayName: 'Sutra',
      userID: new TextEncoder().encode('sutra-owner'),
      attestationType: 'none',
      excludeCredentials: auth.passkeys.map((p) => ({ id: p.id, transports: p.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    challenges.set(options.challenge, Date.now());
    res.json(options);
  });

  router.post('/passkey/new', signedIn, async (req, res) => {
    try {
      const { verified, registrationInfo } = await verifyRegistrationResponse({
        response: req.body.response, expectedChallenge: fresh, expectedOrigin: site(req).origin, expectedRPID: site(req).rpID,
      });
      if (!verified) throw new Error('not verified');
      const { credential } = registrationInfo;
      auth = readAuth(dataDir);
      auth.passkeys.push({
        id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter,
        transports: credential.transports || [], name: String(req.body.name || 'passkey').slice(0, 60), created: new Date().toISOString().slice(0, 10), site: site(req).rpID,
      });
      save();
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: `The passkey could not be saved (${err.message})` });
    }
  });

  router.post('/passkey/forget', signedIn, (req, res) => {
    auth = readAuth(dataDir);
    auth.passkeys = auth.passkeys.filter((p) => p.name !== req.body.name);
    save();
    res.json({ ok: true });
  });

  router.post('/signout', (req, res) => {
    const token = cookies(req)[COOKIE];
    if (token) { auth = readAuth(dataDir); delete auth.sessions[hash(token)]; save(); }
    res.set('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
    res.json({ ok: true });
  });

  return { router, session, site };
}
