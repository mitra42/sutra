# Sutra stage 0: hands-on tests

Throwaway pages, **not the app**. They exist to find out whether four assumptions in `plan.md` hold on your own Mac and iPhone before anything is built on them. Delete the folder when done.

## What is being tested

| # | Question | Where |
| - | -------- | ----- |
| 1 | Does SQLite run inside an installed iPhone web app, and does its data survive? | iPhone |
| 2 | Does a passkey work inside an installed iPhone web app? | iPhone |
| 3 | Does the laptop's local address work in Chrome as an installable app that opens with no server? | Mac |
| 4 | Can several Chrome tabs share one browser database? | Mac |

Also checked along the way: SQLite loads with no build step, and the app can supply its own `REGEXP`.

## On the Mac

```
cd app/stage0
npm install
npm start
```

Then open <http://localhost:8480/> in Chrome.

1. **Several tabs (test 4).** Open *Database*. It should say the storage method is `opfs`. Open the same page in two more tabs. Press *Add a row* in each. Every tab should show all the rows, without reloading.
   Confirmed
2. **Search.** On the same page press *Search*. The rows should be listed. This is SQLite calling a regular expression supplied by the page.
   Confirmed
3. **Install (test 3).** In Chrome's address bar use the install button (or the three-dot menu, *Cast, save and share*, *Install page as app*). The app opens in its own window, and *Start* should say "Opened as an installed app: yes".
   Confirmed - opens as app with window
4. **No server (test 3).** Stop the server with Ctrl-C. Reload the pages, in the tabs and in the installed window. They should still open, and *Database* should still show and add rows. Start the server again afterwards.
   Confirm 
5. **Passkey.** Open *Passkey*, press 1 then 2. Not essential on the Mac; it is a quick check before trying the phone.

## On the iPhone

The phone needs the pages on an **https** address; it cannot use the laptop's local one.

```
npm run site
```

This writes a folder `site/` of plain files. Upload it to any https location you control, for example `https://sutra.mitra.biz/test/` or a folder on an existing site. Nothing in it needs Node on the server.

The folder includes a `.htaccess` that asks Apache to send two headers. If your Apache ignores `.htaccess` files the pages still work, but will use the one-tab storage method; the *Database* page says which method is in use.

1. Open the address in Safari, then Share, *Add to Home Screen*. Open it from the home screen. *Start* should say "Opened as an installed app: yes".
   Confirmed
2. **Database (test 1).** Open *Database*. Note the storage method. Add a few rows. Press *Ask for protected storage* and note the answer. Close the app completely and open it again: the rows and the "first created" time should be unchanged.
   sahpool; rows add correctly; protected granted; rows remain after restart; all confirmed
3. **Aeroplane mode.** Turn it on and open the app. The pages should open and the database should still work.
   Failed - said needed to connect to internet 
   Note - I turned off Aeroplane mode to continue with tests
4. **Passkey (test 2).** Open *Passkey*, press 1 then 2, in the installed app.
   Confirmed 
5. **Survival (test 1, slow).** Leave the app unopened for a week or two, then open *Database*. If "first created" is still the original date and the rows are there, the data survived. If the date is new, the phone threw it away.

## Retest: aeroplane mode on the iPhone (added 15 Nov)

The first run failed at step 3 above. `public/sw.js` and the Start page have been changed: when the phone says it is offline the pages now use their stored copy without trying the network, and the Start page has a new "Offline copy" section showing what was stored.

1. On the Mac: `npm run site`, and upload the `site/` folder again, over the old one.
2. On the iPhone, online: open the app from the home screen. Close it completely and open it once more, so the new version takes over.
3. On *Start*, look at **Offline copy**. It should say the store is `sutra-stage0-v2`, "Controlling this page: yes", and "files stored: 16 of 16". Note anything else, especially any FAILED lines. Also note the line "Isolation headers in effect" further up.
   It says "files stored: 15 of 16"
   FAILED "./"   that will be a function of the site, which doesnt allow bare directory reads (./index.html works) 
   Note in section above "where this page is running" it says "no" to isolation headers
4. Open *Database* once, still online.
5. Close the app. Turn on aeroplane mode (and make sure Wi-Fi is off). Open the app.
6. If anything other than the pages appears, note its exact words and whether it is a small alert with buttons or a whole page. If it is an alert, press OK and see whether the pages are there behind it.
   Small alert "Turn off Airplane Mode or Use Wi-Fi to Access Data" (note last time, there was no page under it, this time there is a page)
7. Open *Database* and add a row.
   Add a row worked 

## What to tell Claude

For each numbered step: worked, or what happened instead. In particular:

- the storage method shown on the Mac and on the iPhone;
- whether three tabs stayed in step;
- whether the pages opened with the server stopped, and in aeroplane mode;
- the answer to *Ask for protected storage* on the iPhone;
- the lines in the *Passkey* log on the iPhone;
- later, whether the data survived the gap.

## What Claude already checked

On 15 Nov 2026, in an automated Chrome on Linux (not your Mac, and not an iPhone): several tabs sharing the database with both `opfs` and `opfs-wl`; `sahpool` refusing a second tab, as expected; pages and database working offline; the `REGEXP` function, including falling back to plain text for an invalid expression; and the passkey page against a simulated authenticator.

## Files

| File | Purpose |
| ---- | ------- |
| `server.js` | Serves the pages on this machine only, with the two headers. |
| `make-site.js` | Makes the `site/` folder for upload. |
| `public/db.html`, `db.js`, `db-worker.js` | The database test. SQLite runs in a background worker. |
| `public/passkey.html`, `passkey.js` | The passkey test. Nothing is sent to a server. |
| `public/sw.js` | Keeps a copy of the pages so they open offline. |
| `public/index.html`, `index.js`, `common.js` | Start page and shared code. |
