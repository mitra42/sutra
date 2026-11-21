// Signing in to the hub in a browser: the password, then a passkey made and used.
// Chrome's pretend passkey device stands in for Touch ID or the iPhone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { readAuth, writeAuth, hashPassword } from '../auth.js';

test('the hub: sign in with the password, make a passkey, sign out, sign in with the passkey', async () => {
  const t = await start({ role: 'hub' });
  try {
    const { page } = t;
    const cdp = await t.context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

    await page.goto(t.url);
    assert.match(page.url(), /login\.html/);
    assert.match(await page.locator('#message').innerText(), /npm run set-password/);

    writeAuth(t.dataDir, { ...readAuth(t.dataDir), password: hashPassword('correct horse') });
    await page.reload();
    await page.fill('#password', 'wrong one');
    await page.press('#password', 'Enter');
    await page.waitForTimeout(300);
    assert.match(await page.locator('#message').innerText(), /Wrong password/);
    await page.fill('#password', 'correct horse');
    await page.press('#password', 'Enter');
    await page.waitForSelector('sutra-bar .status', { timeout: 10000 });
    await page.waitForTimeout(1500);
    assert.doesNotMatch(await page.locator('sutra-bar').innerText(), /signed out/);

    await page.goto(`${t.url}login.html`);
    await page.fill('#keyname', 'Test Chrome');
    await page.click('#newkey');
    await page.waitForFunction(() => /made/.test(document.getElementById('message').textContent), null, { timeout: 5000 });
    assert.equal(readAuth(t.dataDir).passkeys[0].name, 'Test Chrome');

    await page.click('#signout');
    await page.waitForTimeout(300);
    await page.goto(t.url);
    assert.match(page.url(), /login\.html/);
    await page.click('#passkey');
    await page.waitForSelector('sutra-bar .status', { timeout: 10000 });
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(Object.values(readAuth(t.dataDir).sessions).filter((s) => s.how.startsWith('passkey')).length, 1);
    assert.deepEqual(t.errors, []);
  } finally { await t.stop(); }
});
