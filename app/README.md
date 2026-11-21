# Sutra: the app

Code for Sutra. What it should do is in `../spec.md`; how it is built, and in what order, is in `../plan.md`.

## Running it

```
cd app
npm install
npm start
```

Then open <http://localhost:8470/> in Chrome. The data is kept in `app/data/sutra.db`. To use another port or data folder, set `SUTRA_PORT` or `SUTRA_DATA`.

Needs Node 22.13 or later, for Node's built-in SQLite. On Node 22 it prints a one-line warning that SQLite is experimental; that is expected.

There is no build step: edit a file in `public/` or `core/` and reload the page. Changes to `server.js` need the server restarted.

## Starting at login

`zsh scripts/start-at-login.sh` sets the Mac to start both servers (the laptop's and the hub) when you log in, and to restart either if it stops. Stop any copies running in a terminal first. `... status` shows whether they are running; `... remove` undoes it. Their output goes to `data/server.log` and `data-hub/server.log`. After changing `server.js`, run the script again to restart them on the new version (or `launchctl kickstart -k gui/$(id -u)/biz.mitra.sutra.server`).

## The phone layout

Make the Chrome window narrower than about 700 pixels, or use Chrome's device toolbar. One card shows at a time: its details folded into a line (tap it, or the arrow, to open them), then its List. Tapping a row's `›` opens that card; `‹` goes back. Along the bottom: Home, Search, Bar (the quick-access bar slides in) and `+`. A line at the top appears only when offline or when changes are waiting. A real phone cannot reach it until the hub is on the VM.

## Export, backup, Asana import, AI

- **Markdown export:** `npm run export -- ~/some/folder` writes one Markdown file per card, linked to each other, into a folder that opens as an Obsidian vault. It only reads, and can be run while the server is running.
- **Backups:** the server writes a dated copy of its database once a day into `data/backups/` (the hub into `data-hub/backups/`) and keeps the last 21.
- **Asana import:** in Asana, open the project's menu, Export, JSON. Then `npm run import-asana -- ~/Downloads/thefile.json "Project title"` with the server running. Sections become headings and sub-tasks become the task's own List. Importing a newer export of the same project updates the same cards. **This has not been tried on a real export**: it is written from Asana's published description of a task. Try a small project first.
- **AI (MCP):** see `mcp/README.md`.

## Trying the hub on the laptop

The hub is meant for the VM. Until the VM is ready it can be run on the laptop as a second copy of the server, so that syncing through a hub, and conflicts, can be tried for real.

1. In one terminal: `npm run hub`. It listens on port 8471, keeps its data in `app/data-hub/`, and prints a key.
2. Tell the laptop's server about it: create `app/data/config.json` containing

   ```
   { "hubUrl": "http://localhost:8471", "hubKey": "the key the hub printed" }
   ```

3. Restart the laptop's server (`npm start`). The foot of the bar now shows a second line, such as "hub online · 0 waiting". Everything the laptop's server had been keeping is sent up.

To see a conflict you need a second laptop. A pretend one will do: `SUTRA_PORT=8472 SUTRA_DATA=data-two SUTRA_HUB=http://localhost:8471 SUTRA_HUB_KEY=<key> node server.js`, opened at <http://localhost:8472/>. Stop the hub, change the same card's title in both, start the hub again: within half a minute or so (reload to see it at once) the later change stands on both, Conflicts in the bar shows 1, and the card offers "Use this instead".

To go back to having no hub, delete `config.json` and restart. Nothing is lost either way.

The hub purges cards that have been in Trash for 7 days (`SUTRA_PURGE_DAYS` to change it).

## What is here so far

| Folder | What |
| ------ | ---- |
| `core/` | **Stage 1: the shared core.** The rules, written once, for use by the hub, each laptop's local server and the PWA. |
| `server.js` | **Stage 2: the laptop's local server.** Holds the full copy, serves the front end, and answers only its own front end. |
| `public/` | **Stage 2: the front end.** Web components on `html-element-extended`, with its own copy of the data in the browser. |
| `vendor/` | CodeMirror, combined once into a single file (see `tools/`). |
| `tools/` | How `vendor/codemirror.js` was made. Not needed to run or develop Sutra. |
| `scripts/` | Markdown export and Asana import. |
| `mcp/` | The small program that lets an AI tool use Sutra. |
| `test/` | Tests for the core and the server, including pretend devices that edit and sync in random orders. |
| `test-browser/` | Tests of the screen in Chrome (`npm run test:browser`). |
| `stage0/` | The throwaway hands-on tests. Not part of the app. |

## Using it (stage 2)

- **Three panes.** The quick-access bar; the working List; the selected card with its details, Note and own List.
- **Add items:** "+ Add item", type, Return. Return ends one item and starts the next. Esc stops. Pasting several lines into the box makes one item per line.
- **Select** a row by clicking in it or with the arrow keys; it shows on the right.
- **Open:** double-click a row, or click its `›`. In the right-hand card's List this slides everything left. `‹` or the browser's back button goes back.
- **Keys in a List:** Return (new item below); Cmd-Return (complete); Cmd-Up and Cmd-Down (move); Tab then Delete (delete); Tab then N (new heading); Tab then S (new sub-task); Tab then Q (new item in this List); Tab then D (due date); Tab then H (Home); Tab then / (search); Cmd-Z (undo, up to 20 steps, in this tab). On the Mac's Chrome, Ctrl works in place of Cmd as well.
- **Drag** a row by its grip (the dots at its left): onto another row to go ahead of it, onto a heading to go under it, anywhere else in a List (including an empty one) to go to its end, onto the bar to add it there, onto an entry in the bar to add it to that card's List. A blue line shows where it will land: over the top half of a row the card goes ahead of it, over the bottom half after it, which is how the end of a sub-list is reached. Dragged into a different List, a card is added there and stays where it was too. Headings drag by their own grip, or move with Cmd-Up and Cmd-Down while in the heading.
- **Several cards at once:** Cmd-click rows to choose them (Shift-click for a run). A strip appears above the List: Complete, Due, tag, move under a heading, remove from the List, Delete. Dragging one of the chosen rows takes them all. One Cmd-Z undoes the whole action. Esc lets go.
- **The card pane:** dates, repeat (daily, weekly, monthly, or "other…" for a number and a unit such as `3d`, `2w`, `6m`), the offline flag; "In" with `×` to remove and a box to add (suggestions appear as you type; click one, or Return for the first); tags; relationships (a heading such as `#blocked by / blocking`, then find the other card); the Note (Markdown, with Cmd-B, Cmd-I, Cmd-K); Delete.
- **Search:** the box in the bar. A word, a phrase or a regular expression, over titles and Notes. "Save as card" keeps the search on Home as a card that always shows what it finds.
- **The bar** is the List of a built-in card. "Edit bar" opens it like any List, to reorder it or give it headings.
- **Several tabs** share one copy of the data and stay in step.
- **With the server stopped** the page still opens and works on what the browser holds; the bar's foot shows "offline" and how many changes are waiting.

## Not there yet

- The hub on the VM, a login for it, and so a real phone. The hub itself can be tried on the laptop (above).
- Reordering the bar by dragging within it (use "Edit bar").
- Future features listed in the spec: Person and Company cards and their integrations, and the others in the spec's Future list.

## Running the tests

```
cd app
npm test
```

The core's own tests need nothing installed; the server's need `npm install` first.

The screen has its own tests, which open the Chrome installed on this Mac (in the background; nothing appears) against a throwaway server:

```
npm run test:browser
```

They need `npm install` once (it adds playwright-core, which drives Chrome but downloads no browser). To use a different Chromium, set `SUTRA_CHROME` to its program file. They take about a minute.

## The front end, file by file

| File | Holds |
| ---- | ----- |
| `public/worker.js` | Runs in the background of each tab: the browser's copy of the data, the shared core working on it, and syncing with the server. |
| `public/browser-db.js` | The thin layer between the core and SQLite in the browser; the twin of `core/node-db.js`. |
| `public/store.js` | The page's side of the worker: read, act, undo, and hear when data changes. |
| `public/ui.js` | What the components share: redrawing without losing what is being typed, addresses, the Tab shortcuts, the delete question. |
| `public/app.js`, `bar.js`, `list.js`, `card.js` | The components: the page, the quick-access bar, a List, a card. |
| `public/editor.js` | The Note editor (CodeMirror). |
| `public/live-markdown.js` | Shows a Note formatted, with the Markdown marks only on the line being edited; plain click follows links. |
| `public/sw.js` | Keeps a copy of the app's own files so it opens with the server stopped. |

## The core, file by file

| File | Holds |
| ---- | ----- |
| `core/schema.js` | The tables, the fields a change may set, the built-in cards, and the `cards` view that queries see. |
| `core/replica.js` | One copy of the data. Recording changes, and syncing them: the hub accepting and numbering changes and judging conflicts; a copy sending its changes up and fetching what is new; what a partial copy holds. |
| `core/sutra.js` | What actions mean, as changes: cards, Lists, sub-lists, completing and repeats, tags, relationships, deleting and restoring, settling conflicts; and reading a List or a card for display. |
| `core/query.js` | Saved queries and search: the helper words, `REGEXP`, read-only running. |
| `core/positions.js` | The sortable codes that give items their order. |
| `core/repeat.js` | Repeats: the codes (3d, mon+thu, m1, mlast…), the next date, and reading them from words. |
| `core/node-db.js` | The thin layer between the core and Node's SQLite. The PWA will have its own, for SQLite in the browser. |

## The tests

| File | Covers |
| ---- | ------ |
| `test/core.test.js` | One copy on its own: Lists and order, several memberships, completing and repeats, sorting, deleting and Orphans, tags, queries, relationships. |
| `test/sync.test.js` | Several copies: merging, conflicts and settling them, Notes, reordering, a lost reply, the laptop working with no connection, offline marking on the phone, Dynamic cards offline, purge. |
| `test/fuzz.test.js` | A hub, two laptops, a laptop PWA and a phone make random edits and sync in random orders, with replies going missing, and must end up identical. 60 runs each time. |
| `test/server.test.js` | The local server: refusing strangers, and a PWA syncing through it over http. |
| `test/helpers.js` | The pretend devices. |
| `test-browser/ui.test.js` | The screen, driven in Chrome: adding items, several cards dragged onto a heading, reordering the bar, adding chosen cards to another List, repeats typed in words, formatted Notes and links. Each test starts its own server with empty data. |
| `test-browser/helpers.js` | Starting a server and Chrome for a test, and a drag made of the browser's own drag events. |
