# Sutra — Architecture and Implementation Plan (draft 17)

**Status:** Everything that can be built without the VM is now built, in a first version: the laptop app, the hub (run on the laptop), the phone layout, MCP for AI tools, Markdown export, backups, and an Asana importer. Mitra has used the laptop app and connected the hub; **the rest, built on 15 Nov while he was away, he has not yet tried.** What needs the VM is listed at the end of section 12.
**Based on:** `spec.md` draft 26. The spec says *what* the tool does; this document says *how* it would be built and in what order. If something here turns out to change what the tool does, the spec is changed first.
**Reading guide:** sections 1 and 2 give the shape. Sections 3 to 9 are the design. Sections 10 to 13 are the plan. All decisions so far are answered and folded in (listed in section 14). The screen sketches at the end of section 8 are agreed in structure. **Section 14 has no open questions.** Everything else is my proposal and can be challenged. Anything not checked against a current source is marked *(unverified)*.

---

## 1. The approach in brief

1. **One database layout, three places.** The VM, the laptop's local server and the PWA in the browser all hold the same SQLite tables. The VM and laptop hold everything; the PWA holds part.
2. **One shared core.** A single JavaScript library holds all the rules: how a card is changed, what deleting does, how a repeat moves a date, how a query runs. The servers and the PWA all use that same library, so a rule is written once.
3. **One way to write.** Every edit, from any source (the screen, sync, later an AI), is a small record called a *change*: "this field of this row is now this value". Nothing alters the data any other way.
4. **One sync method.** Devices send their changes to the server above them and fetch what is new. The VM is the hub and settles the order.
5. **One front end.** The same PWA everywhere. It always works from its own in-browser copy and syncs with whichever server it was loaded from.
6. **Simple first.** Where there is a plain way and a clever way, the plan takes the plain way and notes the clever one for later.

## 2. The parts

```
 Phone PWA ───────────────┐
 (partial copy)           │ sync over https
                          ▼
 Laptop PWA ──► Laptop local server ──► VM server (hub)
 (partial     sync    (full copy)   sync   (full copy, source of truth)
  copy)    on the laptop          over https
```

| Part | What it is | Holds |
| ---- | ---------- | ----- |
| **VM server** | A Node program on the VM, behind https. The hub. | Everything, plus the record of all changes. |
| **Laptop local server** | The same Node program in "node" mode, listening only on the laptop itself. Also where laptop-only integrations will run later. | Everything. |
| **PWA** | The front end, in a browser or installed to the home screen. | Cards marked offline, plus whatever has been opened recently. |
| **Shared core** | The library of rules, used inside all three. | Nothing itself. |
| **MCP server** (after first version) | A small program that lets an AI tool use the server's API. | Nothing itself. |

The laptop's local server plays two roles: towards the VM it is a node, and towards the PWA on the laptop it stands in for the server. On a plane the laptop PWA and local server carry on together, and the local server passes everything to the VM when it next can.

The same server program runs in both places, in one of two modes. That keeps one code base for both.

## 3. Data layout

Three main tables hold everything that syncs.

**Cards** — one row per card.

| Field | Notes |
| ----- | ----- |
| id | A random identifier made on the device that creates the card, so cards can be created offline. |
| type | task, note, person, company, dynamic. |
| title, note | Note is Markdown text. |
| created, modified | Set by the device making the change. |
| offline | The offline flag (spec section 4). |
| completed | Date completed, or empty. |
| due, overdue | Plain dates, either or both may be empty. |
| repeat | none, daily, weekly, monthly. |
| query, sort | Dynamic cards only: the query, and the last sort order chosen. |
| trashed, trash group | When it was deleted, and which deletion it was part of, so that a restore can bring back everything deleted together. |

Fields for Person and Company (the Contact link) are added when integrations are built. Adding fields later is easy; that is the kind of layout change the design allows for.

**Sub-lists** — one row per heading: its id, the card whose List it belongs to, the heading text, and its position. The unheaded sub-list needs no row; a card with no sub-list is in it.

**Memberships** — one row for each "card X is in the List of card Y": the List's card, the member card, which sub-list, its position, and a "removed" mark. The pair (List, member) identifies the row. So if two devices both add the same card to the same List while offline, they have made the same row and nothing is duplicated.

**Positions** are not 1, 2, 3. Each is a short sortable code chosen to fall between its neighbours, so inserting or moving one item changes only that item. Two devices reordering the same List therefore rarely collide (spec: "apply both where possible").

**System cards** (Home, quick-access bar, Tags, Trash, Orphans, Conflicts) have fixed, well-known ids and are created identically on every device, so they never need to be reconciled.

**How the spec's features map onto this**

| Feature | How |
| ------- | --- |
| Project, Home, quick-access bar, a tag | Ordinary cards with memberships. |
| Tagging | Adding a membership in the tag card's List. |
| The Tags card (list of all tags) | Dynamic: notes whose title starts with `#`. Nothing to maintain. |
| Trash | Dynamic: cards with a trashed date, newest first. Lists simply skip trashed cards. |
| Orphans | Dynamic: live cards with no membership in a live, ordinary List. |
| Conflicts | Dynamic: cards with an unsettled entry in the conflicts table (section 5). |
| Purge | The hub removes cards trashed longer than the set time, leaving a small marker so other devices remove them too. |

**Relationships between cards** (spec 3.9) need no new table. A relationship is a sub-list whose heading starts with `#` and carries both names, as in `#blocked by / blocking`. The one membership row is shown from both ends: under the first name on the card that owns the sub-list, under the second name on the card that is in it. Relationship memberships are skipped when working out orphans and when a delete asks about cards in no other List.

Two more tables exist on every device but are bookkeeping: **pending changes** (made here, not yet accepted above) and **conflicts**. The hub also keeps the **change record**: every accepted change, numbered in order.

## 4. Changes

- A change says: which table, which row, which field, the new value, and **which version of that field it was based on**. It also carries its own id, the device it came from, and the time.
- An action on screen becomes one or more changes. Ticking a repeating task is two: new due date, new overdue date. Deleting a project with "Yes" is one trashed-date change per card, all with the same trash group.
- The shared core turns actions into changes and applies changes to the tables. This is the only code that writes.
- **Undo** falls out of this: the front end remembers the reverse of each of its last 20 or so actions, and undoing issues those reversed changes as new changes. It is per device and forgotten on restart, as the spec says. (The spec's research note 10.10 suggested the change record could supply undo; keeping it in memory is simpler.)

## 5. Sync

**The rule of versions.** The hub numbers every change it accepts: 1, 2, 3 and so on. The number of the last accepted change to a field is that field's *version*. Versions are part of the data and travel to every device.

**Sending (push).** A device sends its pending changes. For each, the hub compares the version the change was based on with the field's current version:

- **Same:** nobody else has touched it. Accept, number it.
- **Different, in a Note:** keep both texts in the Note with a separator, and add a Conflicts entry so it gets noticed.
- **Different, in a position or sub-list:** last to arrive wins, silently (spec section 4).
- **Different, any other field:** a real conflict. The later change, the one arriving now, stands. The value it displaced is kept in a Conflicts entry with a one-click "use this instead". The reasoning: whoever made the later change knew what they wanted the value to be, even if they did not know what it was before.
- **Different, but both set the same value:** nothing to do.

A change that is sent twice (because a reply was lost) is recognised by its id and ignored the second time.

**Fetching (pull).**

- *Full copies* (the laptop's local server) ask: "everything changed since number N". They receive the changed rows.
- *Partial copies* (the PWA) ask the same, limited to what they hold. Because the offline flag is a property of the card and the same everywhere, the server can work out the offline set itself: each flagged card, the cards in its List, and the cards in theirs. For a Dynamic card, "the cards in its List" means "the cards its query finds". The server also sends the full list of ids in the offline set, so the PWA can spot what has newly joined (fetch it) and what has left (let it go).
- For cards at the edge of the set, the server sends a count, giving the "12 items not available offline" line.

**While a change is waiting.** The device shows its own pending value. An incoming value for that same field does not overwrite it; the clash is judged when the pending change reaches the hub. Several pending edits to one field are merged into one before sending.

**Passing along.** The laptop's local server does not judge conflicts. It applies its PWA's changes to its own copy, and forwards them to the hub with their original details. Only the hub decides. That keeps a single set of version numbers.

**When sync runs.** On opening; when the connection or window comes back; shortly after any local change; and every 30 seconds or so while open. The PWA shows "offline" and the count of pending changes at all times (spec section 4). Instant push from server to device can be added later if the delay is ever felt.

**The PWA and cards it does not hold.** When online, opening any card fetches it and its List into the browser's copy, and it is then treated like any held card: edits go through the same pending-changes path. Such cards are a cache and can be dropped; offline-marked cards are kept and refreshed. Search, when online, is asked of the server; when offline, of the local copy.

**As built in stage 1.** Writing and testing the core settled these details, all within the rules above:

- **A device never conflicts with itself.** If a device's change is based on an old version only because it has not yet heard back about its own earlier edits, the hub accepts it quietly. A conflict needs a change from a *different* device in between. And once a device's change has overridden another's, with the conflict recorded, its next change to the same field does not raise the same conflict again.
- **Fields that never raise a conflict.** Besides positions and sub-lists, the hub lets the later change stand silently for a card's modified time, its trashed state, and a membership's "removed" mark. Otherwise every pair of devices touching different fields of one card would raise a conflict over the modified time.
- **A lost reply.** If a device sends a change and the reply goes missing, it sends it again; the hub recognises it and applies it once. If something newer reached the hub meanwhile, the device sets that aside until it hears back, then shows whichever is truly the later.
- **Each copy keeps its own counter** of what it has written, beside the hub's version numbers. That is what lets the laptop's local server answer "what is new?" for its PWA while it is itself cut off from the hub.
- **A partial copy holds exactly its scope**: the offline set, what it has opened, and anything carrying a change not yet sent. Each held card also brings the Lists it is in, so it can say where it belongs. A card made on the phone in no List is passed up and then let go from the phone; it shows in Orphans.
- **Tags get their id from their name**, and a relationship sub-list from its card and heading, so two devices inventing the same one while offline have made the same thing.
- **Purge** empties a card's title and Note and marks it purged, and removes its memberships. The emptied marker row stays, so that every other copy learns of it.

**Testing.** Because all of this lives in the shared core, a test can run a pretend hub, laptop and phone in one program, make them edit and sync in every order, and check they always end up the same. This is where most of the testing effort should go.

## 6. Search and queries

**The Search box**

- Typing a word or phrase finds every card whose **title or Note** contains it. Capitals are ignored. More fields can be added to what it searches as the need arises.
- What is typed is treated as a **regular expression**, so `plan.*2027` or `^Call ` work. If what is typed is not a valid regular expression (for example `C++`), it is searched for as plain text.
- The app turns the search into a query of the kind below. "Save this search as a card" stores that query in a Dynamic card.

**Queries**

- A query is the `WHERE` part of an SQL statement (spec 3.8). It runs against **one stable, documented view called `cards`**, not against the tables directly, so the tables can change later without breaking saved queries.
- SQLite spells the regular-expression test `REGEXP` (MySQL's `RLIKE` is the same thing). SQLite leaves it to the application to supply the matching, so the app supplies JavaScript's own regular expressions. That makes matching behave identically on the VM, the laptop and the phone.
- Queries run **read-only**. A query cannot change data, whoever wrote it.
- Queries see live cards only. Trashed cards appear only in Trash and, marked as such, in Search (spec 5.4).
- A plain scan is fast enough for a few thousand cards. An index for text search can be added if it ever becomes slow.

**Fields of the `cards` view** (first draft, for you to check; question Q3)

| Field | Holds |
| ----- | ----- |
| `type` | `'task'`, `'note'`, `'dynamic'` (later `'person'`, `'company'`) |
| `title`, `note` | Text |
| `due`, `overdue` | Date as `'2026-11-15'`, or empty |
| `completed` | Date completed, or empty |
| `done` | 1 if completed, otherwise 0 |
| `repeat` | `'none'`, `'daily'`, `'weekly'`, `'monthly'` |
| `created`, `modified` | Date and time |
| `offline` | 1 if marked offline |

**Helper words**

| Helper | Meaning |
| ------ | ------- |
| `tagged('UseAI')` | The card is in the List of the tag `#UseAI`. |
| `in_list('Work Priorities')` | The card is in the List of a card with that title. |
| `today()` | Today's date, by the device's own clock. |
| `today(7)` | The date 7 days from today; `today(-1)` is yesterday. |
| `orphan()` | The card is in no live, ordinary List. Used by Orphans. |
| `conflicted()` | The card has an unsettled conflict. Used by Conflicts. |
| `rel('blocked by')` | *(proposal)* The card has at least one live card in its relationship of that name, from either end. So `type = 'task' AND done = 0 AND NOT rel('blocked by')` finds tasks free to start. Whether "blocked" should ignore blockers that are already done is to be settled when this is built. |

**Examples**

| In words | Query |
| -------- | ----- |
| All tasks due today or earlier, not done | `type = 'task' AND due <= today() AND done = 0` |
| Tasks tagged #UseAI in Work Priorities | `type = 'task' AND tagged('UseAI') AND in_list('Work Priorities')` |
| Anything mentioning Fred in title or Note | `title REGEXP 'fred' OR note REGEXP 'fred'` |
| Changed in the last week | `modified >= today(-7)` |
| All tags | `type = 'note' AND title REGEXP '^#'` |

One weakness to know about: `in_list('Work Priorities')` goes by title, so renaming that card would quietly empty the query. When the app builds a query for you it can refer to the List by its permanent id instead; hand-written ones can use either.

## 7. The API

Both servers offer the same small API. It is designed so that the later MCP server is a thin wrapper.

| Group | Calls |
| ----- | ----- |
| **Sync** | push changes; pull since N |
| **Read** | get a card with its List; search or run a query |
| **Act** | create card; edit card; complete; add to, move within, or remove from a List; delete; restore. On the server these are two general calls, one to read and one to act, each limited to a fixed list of operations; the MCP server uses them. |
| **Login** (VM only) | passkey sign-in, password fallback |

Every "act" call is turned into changes by the shared core, exactly as a tap on the screen is. So an AI working through MCP can do what the app can do, no more, and its edits sync and can conflict like anyone's. Its changes are labelled as coming from the AI.

**MCP on the laptop needs no https.** An AI tool such as Claude Code starts a local MCP server as an ordinary program and talks to it directly, with no web address involved. That program then calls the local server on the laptop itself. Https and a login are only needed for the later VM connector (spec 10.11).

## 8. Front end

- **Built the Frugal IoT way.** Web components on your `html-element-extended` module, plain JavaScript modules loaded directly by the browser, an import map for libraries, and **no build step**. I read `frugal-iot-client` to see how it is done there. Since you own the module, it can be extended where this app needs something it lacks.
- **Logic stays out of the views**, as in Frugal IoT ("a view must not walk the tree"). Components show what the shared core hands them; the rules live in the core, where they can be tested without a browser.
- The PWA keeps its SQLite copy in the browser's private file store, run in a background worker so the screen never waits on it. This applies on the laptop too (decision D1, agreed): one way of working everywhere, and the sync code is exercised all day on the machine where problems are easiest to see.
- **Laptop:** three panes (spec 5.2). **Phone:** the same code, showing one pane at a time with a back button.
- **Keys:** Asana's shortcuts (spec 10.9). The Tab-based ones (Tab-Del, Tab-D) mean the app takes over the Tab key while a List has focus.
- **Offline shell:** a small hand-written service worker keeps the app's own files so it opens with no connection.

**Several tabs at once (laptop)**

- Asana offers a website and also apps for macOS and iOS that work offline; Mitra uses the macOS app all the time, and relies on having several tabs or windows open. (Corrected: draft 2 wrongly described Asana as only an ordinary website.) This app keeps its data in the browser, so tabs have to share it.
- SQLite's browser build has two ways of storing data. The one I named in draft 1 allows a single tab. The other allows several tabs to share one database, at the price of two extra settings on the server, which are easy to supply.
- **Proposal:** use the several-tabs method. Each tab has its own connection to the shared database; when one tab changes something it tells the others so they redraw; only one tab at a time runs sync. If the iPhone test in stage 0 shows the same method works there, it is used everywhere; if not, the phone uses the single-tab method, which is all it needs.
- *(Unverified hands-on: SQLite's documentation reports this working with 8 to 10 connections at once in its own tests. It goes into stage 0.)*

**The Note editor**

- **CodeMirror 6 from the start** (decided), so the rendering editor can be added later without changing editors (spec 10.8).
- CodeMirror is published as many small pieces meant to be combined by a build tool. *(General knowledge, not re-checked.)* It is therefore combined **once** into a single ready-made file kept in the repository, and redone only when CodeMirror itself is updated. A build step for a dependency is acceptable; what matters is that the app's own files can be edited and the page reloaded, with nothing in between.

### Screen sketches

These show what goes where, not how it looks. The structure is agreed for laptop and phone; details will change as the UI is used.

**Laptop: three panes**

```
+--------------+------------------------------------+------------------------------------+
| Sutra        | < Work Priorities     Sort v  Done | [ ] Write sync tests           ... |
|              |------------------------------------|------------------------------------|
| Home         | + Add item                         | Task     Due 18 Nov  Overdue 25 Nov|
| Search       |                                    | Repeat: weekly       Offline: no   |
|              | [ ] Reply to Jane        14 Nov !  | In:   Work Priorities x  Home x  + |
| TODAY        | [ ] Book flights                   | Tags: #UseAI x                   + |
|  Daily       |                                    |------------------------------------|
|  Sutra       | THIS WEEK                          | Note                               |
| PROJECTS     | [ ] Write sync tests     18 Nov    | Cover the case where the phone     |
|  Frugal IoT  | [ ] Call Fred        @    > 3      | and laptop both move the same      |
|  Workshop    | [ ] Draft budget  #UseAI           | card.                              |
|              |                                    |------------------------------------|
|              | LATER                              | List                       Sort v  |
| Tags         | [ ] Asana import                   | + Add item                         |
| Conflicts 2  | [N] Ideas for sync       > 12      | [ ] Pretend hub                    |
| Orphans      |                                    | [ ] Pretend phone                  |
| Trash        |                                    | [x] Pretend laptop                 |
|--------------|                                    |                                    |
| online  0    |                                    |                                    |
+--------------+------------------------------------+------------------------------------+
   quick-access            the working List                    the selected card
```

- **Left, the quick-access bar.** Home and Search at the top; then whatever has been dragged in, under your own headings; then the built-in cards. At the foot, the connection state and the number of changes waiting to be sent.
- **Middle, the working List.** Its card's title is at the top; clicking that title shows the card itself on the right. Items with no heading come first (on Home, last). A row shows: tick box (tasks only; `[N]` here marks a Note), title, tags, due date (`!` when overdue), a repeat mark (`@` here), and `> 3` when the card has three items in its own List.
- **Right, the selected card.** Title and tick box; dates, repeat and the offline flag; the Lists it is in, each removable, with `+` to add another; its relationships beside them, in the same style ("Blocked by: ...", "Blocking: ..."); its tags the same way; its Note; then its own List, which works exactly like the middle one.
- **Selecting.** A click, or the arrow keys, selects a row in the middle List and shows that card on the right.
- **Opening** is by double click or by clicking the row's `>` mark. There is no key for it: Return stays "end this item and start the next" (spec 5.3).
  - Open a row in the **middle** List: the card opens on the right.
  - Open a row in the **right-hand** card's own List: everything moves one step left. The card that was on the right becomes the working List in the middle, and the newly opened card appears on the right.
  - `<`, or the browser's back button, moves one step back the other way.
- **Every view has its own web address.** So the browser's back and forward buttons work, a view can be bookmarked, and different tabs can show different Lists.

**Phone: one card at a time**

```
+--------------------------------+
| < Home       Work Priorities ..|
| offline - 3 waiting            |
|--------------------------------|
| Due 18 Nov - #UseAI - in Home  |
| Note: first two lines...     v |
|--------------------------------|
| + Add item          Sort  Done |
| [ ] Reply to Jane     14 Nov ! |
| THIS WEEK                      |
| [ ] Write sync tests   18 Nov  |
| [ ] Call Fred  @          > 3  |
| LATER                          |
| [ ] Asana import               |
| [N] Ideas for sync       > 12  |
|   12 items not available       |
|--------------------------------|
|  Home    Search    Bar     +   |
+--------------------------------+
```

- The card's own details sit folded at the top; tapping them opens them out for editing. Below is its List.
- Tapping a row opens that card in the same layout; `<` goes back.
- The second line appears only when there is something to say: offline, or changes waiting.
- The bottom bar: Home, Search, the quick-access bar (which slides in), and `+` to add a card to whatever is on screen.

## 9. Servers and operations

**Laptop local server**

- Starts at login, listens only on the laptop itself, needs no login (spec section 7).
- Since there is no login, it must refuse requests that do not come from its own front end. Otherwise any web page open in the browser could try to talk to it. It checks where each request comes from.
- Signs in to the VM with a long random key, issued once and kept in a file on the laptop.

**VM server**

- Address: `sutra.mitra.biz`. Apache handles https and passes requests through to the Express server, as it does for your other services. 
- It needs a version of Node recent enough to have the built-in SQLite module with custom functions: 22.13 at the least, and preferably the current long-term release. The VM's Ubuntu and Node upgrade is a separate task of yours, and **stage 3 depends on it**. Stages 0 to 2 run only on the laptop and do not.
- Passkey login with SimpleWebAuthn; password as fallback; the session is a cookie set by the server (spec 10.3). Built 21 Nov in `app/auth.js`, and switched on whenever the server runs as the hub, so it can be tried on the laptop now:
  - `data-hub/auth.json` holds the password's scrypt hash, each passkey's public key and counter, and a SHA-256 hash of each session's cookie (so a copy of the file can't be used to sign in). Written to a new file and renamed, readable by its owner only.
  - Routes under `/auth/`: status, password, passkey options and verify, making a passkey (signed in only), forgetting one, signing out. Each passkey challenge is kept in memory for five minutes and used once.
  - Every other page on the hub needs a session: a page asked for by a browser is redirected to `login.html?then=…`; anything else gets 401. The sign-in page and what it loads are open.
  - The API takes either the hub key (another server) or a session together with the front end's own header and, if the browser names an origin, this site's own. A front-end request without a session gets 401, which the bar shows as "signed out".
  - Five wrong passwords in a row make the next attempt wait ten seconds.
  - The passkey's site is the name the browser used (`localhost` now, `sutra.mitra.biz` later). Behind Apache the server trusts Apache's forwarded headers from the VM itself only, so it knows the browser used https and marks the cookie Secure.
  - The service worker never stores the sign-in page in place of a file it asked for.
  - `npm run set-password` sets the password from the command line.

**Backup and export**

- The VM writes a dated copy of its database each night and keeps a few weeks' worth.
- The laptop's full copy is in effect a second, live backup.
- Markdown export (spec section 7) is a command run on the laptop, writing one file per card.

**Toolchain**

- Modelled on `frugal-iot-server`: Express, plain JavaScript modules, no build step, no significant toolchain to install. The point of no build step is the quick loop: edit a file, reload, see the change.
- Developed in VS Code, with a launch file so the server runs under the debugger from there, as Frugal IoT's does.
- The browser's libraries are served straight from `node_modules`, as Frugal IoT does.
- Tests run with Node's own test runner (`node --test`), as in `frugal-iot-client`. The screen has its own tests in `app/test-browser` (`npm run test:browser`), driving the installed Chrome with playwright-core, a development-only package that downloads no browser. Each starts a server with empty data. Drags are sent as the browser's own drag events, since a real mouse drag is unreliable when automated. Chrome's pretend passkey device stands in for Touch ID.
- Code style as in Frugal IoT (2-space indents, comments that say why and not what), with one difference: new code uses promises with `async` and `await`, which you find increasingly readable, in place of callbacks. Most of the shared core needs neither, because SQLite is called directly and answers at once.

**Where the code lives** *(assumption)*: in this same folder and git repository, under `app/`, so the spec, the plan and the code travel together. Obsidian can be told to ignore that sub-folder.

## 10. Technology choices

| Need | Choice | Why, and what is unverified |
| ---- | ------ | --------------------------- |
| Language | Plain JavaScript modules, no build step | Your preference, as in Frugal IoT. |
| Server | Node with Express | Your preference; what you already run. |
| Database on servers | Node's built-in SQLite module (`node:sqlite`) | Nothing extra to install or compile. It is marked "release candidate", not yet "stable", in Node 26. Starts on the laptop; the VM follows its upgrade. Fallback if ever needed: `better-sqlite3`. |
| Database in browser | The official SQLite build for browsers | Confirmed in stage 0: it loads with no build step, on the Mac and the iPhone. Storage method `opfs` on the laptop (several tabs), `sahpool` on the iPhone (one tab). |
| Front end | Web components on `html-element-extended` | Yours, light, no build step, already used with Claude in Frugal IoT. |
| Note editor | CodeMirror 6, combined once into a single file | Section 8. |
| Login | SimpleWebAuthn | Spec 10.3. *(Whether its browser part loads with no build step is unverified.)* |
| Tests | `node --test`, with jsdom for components | As in `frugal-iot-client`. |
| MCP (later) | Official MCP SDK for JavaScript | Spec 10.11. |

## 11. First version: what is in and out

**In**

- Task, Note and Dynamic cards; Lists, sub-lists, multiple membership.
- Home, quick-access bar, tags, Trash (with restore and purge), Orphans, Conflicts.
- Due and overdue dates; daily, weekly, monthly repeats.
- Sorting, hiding completed, undo, search.
- Laptop three-pane layout and phone layout; Asana-style keys.
- Relationships between cards (spec 3.9).
- Offline marking, sync between phone, laptop and VM, pending-changes indicator.
- Passkey login on the VM; nightly backup; Markdown export.
- Built-in Dynamic cards only (Trash, Orphans, Conflicts, Tags).

**Out, for later** (roughly in this order)

1. MCP server on the laptop.
2. Asana import.
3. Dynamic cards written by the user, and "save this search as a card".
4. MCP connector on the VM.
5. Person and Company cards and the integrations (spec section 6).
6. Rendering Markdown editor; calendar-rule repeats; custom workflows; any AI features inside the app.

Person and Company are left out of the first version because, without the integrations, they are Notes with dates. Say if you would rather have them from the start; it is a small addition.

## 12. Stages

Each stage ends with something that can be tried. No stage starts without your go-ahead.

| Stage | What is built | Ends when |
| ----- | ------------- | --------- |
| **0. Hands-on tests** | Tiny throwaway pages, not the app, all with no build step: SQLite in an installed iPhone web app and whether its data survives; passkey login in an installed iPhone web app; the laptop's local address working in Chrome as an installable, offline-capable app; several Chrome tabs sharing one browser database. | We know the four riskiest assumptions hold, or have changed the design. |
| **1. Core** | The data layout, changes, and sync rules as a library, with the pretend-devices tests. No screen. | The tests pass for every ordering of edits we can think of. |
| **2. Laptop app** | Local server and front end on the laptop: Lists, cards, keys, dates, repeats, trash, orphans, search, sorting, undo. | You can use it for real tasks on the laptop alone. |
| **3. Hub** | VM server, login, laptop-to-VM sync, the Conflicts list, backup. Needs the VM's Node upgrade first. | The laptop works offline and catches up; the app opens from the VM address. |
| **4. Phone** | Phone layout, install to home screen, offline marking, pending indicator. | A list marked offline can be edited on a plane and syncs on landing. |
| **5. Finish** | Purge, Markdown export, rough edges found in use. | First version done; parallel running with Asana begins. |

**Stage 0 results (15 Nov 2026).** Run by Mitra; the full table is in spec 10.12.

- **Passed:** SQLite in the browser with no build step, on both devices; three Chrome tabs sharing one database; the page's own `REGEXP`; installing as an app on both; the laptop app opening with its server stopped; rows surviving a restart; protected storage granted on the iPhone; passkey create and sign-in inside the installed iPhone app.
- **Failed at first, then fixed:** opening the installed iPhone app in aeroplane mode. The cause was in the test pages: one of the files they tried to keep was the bare folder address, which Mitra's server refuses, and that one failure cancelled the whole stored copy. With each file stored separately the app opens and works in aeroplane mode.
- **Minor, open:** the iPhone still shows its own "Turn off Airplane Mode" alert first, with the working page behind it. Probably the routine check for a newer version of the app; the real app will skip that check when offline, and stage 4 will see whether the alert goes.
- **Still running:** whether the iPhone keeps the data over a week or two unopened.

Rules the real app's offline shell takes from this:

- Store each file separately, so one failure cannot spoil the rest.
- Never rely on a bare folder address; always name the file.
- When the device says it is offline, use the stored copy and do not touch the network.
- Show somewhere what has been stored and when, so a problem can be seen and not guessed at.

Stage 0 is done.

**Stage 1 results (15 Nov 2026).** The shared core is written: about 1,000 lines in `app/core`, with no dependencies beyond Node itself. It covers the data layout, changes, the hub's judging of conflicts, sync for full and partial copies, passing changes through the laptop's local server, cards, Lists, sub-lists, dates and repeats, tags, relationships, deleting and restoring, purge, queries and search.

- **22 tests pass** (`npm test` in `app/`), on Node 22 in Claude's workspace and in the Linux workspace on Mitra's laptop. Not yet run by Mitra on the Mac itself.
- **The random test**: a hub, two laptops, a laptop PWA and a phone make random edits and sync in random orders with replies going missing, and must end identical. 60 runs are part of the test suite; a further 340 were run once. Across those 340: about 110,000 changes, 1,100 field conflicts, 300 Note merges and 500 purges, all converging.
- **It found one real fault**, since fixed: a row that left a partial copy's scope while carrying an unsent change, and later came back, could miss changes made in between.
- **Not covered:** the core has only been run on Node's SQLite. Running the same code on SQLite in the browser is stage 2's first job. Nothing here has a screen.

**Stage 2 results (15 Nov 2026): a first working version.** To run it: in `app/`, `npm install`, `npm start`, then open `http://localhost:8470/` in Chrome. What to try is listed in `app/README.md`.

- **Built:** the local server; the same core running on SQLite in the browser; the three panes; adding with Return; select and open, with the slide to the left; every view with its own address; dates, repeats and completing; headings; tags; relationships; the Note editor; search; sorting and the Done toggle; deleting with the "not in any other list?" question; Trash, Orphans and restore; undo (20 steps, per tab); dragging; the Asana keys listed in the README; several tabs in step; working with the server stopped and catching up when it returns.
- **How it was checked:** 25 automated tests pass (the core, the server over http). Beyond those, Claude drove the pages in an automated Chrome on Linux through each of the things above. That is not the Mac's Chrome, and no person has used it yet. The screen-driving checks are not part of the test suite, because they need a browser-automation tool that is not installed in the project.
- **Faults found and fixed on the way:** text typed during a redraw could be lost; typing in the right-hand List could be interrupted when the card's details redrew.
- **Details settled while building:**
  - New items are typed into a box that appears where the item will go; a card exists only once it has a title. So no empty cards are left behind.
  - The quick-access bar is the List of a built-in card; "Edit bar" opens it as a List to reorder it or add headings. Dragging within the bar itself is not done.
  - Undoing the making of a card puts it in Trash, since other copies may already know of it.
  - The laptop's PWA keeps Home, the bar, and the 150 most recently opened cards with their Lists.
  - Until there is a hub, the laptop's server keeps every change to pass on later, merged per field. Nothing is lost and it does not grow without limit.
- **Not done in this version:** Asana's Tab-S and Tab-Q; Conflicts cannot occur until there is a hub, so their display is untested in a browser; the phone layout (stage 4).
- **A limit met:** Claude's tools cannot write into a `.vscode` folder, so the launch file for the VS Code debugger is at `app/vscode-launch.json` for Mitra to move.

**Stage 2, first feedback (15 Nov 2026).** Mitra tried it on the Mac: mostly good. Four things fixed, each checked in an automated Chrome:

- **Adding a relationship** needed its name typed first, which was not obvious. The name is now filled in with the last one used, starting as `#Blocking / Blocked`.
- **Seeing completed tasks.** The toggle existed but was labelled "Done". It now reads "Show completed".
- **Dragging a card out from under a heading.** There was nothing to drop it onto. A "No heading" line now appears when a List has headings.
- **Tab then H.** Pressing Shift on the way to the H cancelled the shortcut. Modifier keys are now ignored, capital or small letter both work, and Tab then H or / also work when no row has the focus.

Added to future features in the spec: acting on several selected cards at once; custom repeats such as every 3 days.

**Order of work without the VM.** The VM's upgrade waits on someone else, so stage 3 as written (the hub on the VM) and the syncing half of stage 4 (the phone can only reach the hub) are set aside. These do not need the VM, in the order I would suggest:

1. **The hub, built and tested on the laptop.** The same server program in hub mode, run as a second copy on the laptop for testing, with the laptop's server syncing to it. This makes Conflicts real and testable on screen, and leaves only the move to the VM for later. Login by passkey can also be built and tried, since passkeys work on `localhost`.
2. **The phone layout**, tried in a narrow Chrome window. It cannot reach a real phone until the hub is on the VM.
3. **MCP on the laptop**, so Claude can read and act on the data (spec 7.1).
4. **Asana import**, so real projects can be brought in for the parallel run.
5. **Finishing items:** Markdown export, backup of the laptop's database, purge on a timer.
6. **Smaller things:** Tab-S and Tab-Q; dragging within the bar; "save this search as a card".

Mitra agreed this order (15 Nov).

**Item 1 done: the hub, on the laptop (15 Nov 2026).** How to try it is in `app/README.md`.

- **Built:** the server program now runs in either role. As a hub it numbers changes, judges conflicts, and purges old Trash on a timer. A laptop's server given the hub's address and key sends up what it holds and fetches what is new, every 30 seconds and whenever its PWA changes something. The foot of the bar shows a second line for the hub: online or not, and how many changes are waiting for it.
- **Checked:** 27 automated tests pass, including two laptops' servers syncing through a hub over http, a clash, and the hub going away. In an automated Chrome, Claude ran a hub and two laptop servers, stopped the hub, renamed one card differently on each laptop, and restarted the hub: the later name stood on both, Conflicts showed 1, and "Use this instead" on one laptop settled it on both. Not yet run by Mitra.
- **Faults found and fixed on the way**, all in what was already built:
  - A redraw while a title was being typed could save the half-typed text. Saving now happens only when the field is left.
  - With an empty "new item" box open, a click on a row was lost. Pressing Esc straight after Return could bring the box back.
  - A device that overrode another's change twice in a row raised the conflict twice. (The rule is refined in section 5.)
  - Each copy now has a name of its own. Before, two copies on one machine shared the machine's name, which would have hidden conflicts between them.
- **Not built:** a login for browsers on the hub. On the laptop the hub answers only its own front end and a server presenting its key, which is enough for testing. Passkey login is to be added before the hub goes on the VM; it can be built and tried on `localhost` whenever wanted.
- **Not affected:** without a hub configured the laptop works exactly as before.

**Items 2 to 6, built on 15 Nov 2026 while Mitra was away.** He asked for as much as could be done without his input. None of it has been tried by him. How to use each is in `app/README.md` and `app/mcp/README.md`. 29 automated tests pass.

- **Item 2, the phone layout.** Below about 700 pixels wide, one card shows at a time: its details folded into one line, then its List; `‹` to go back; Home, Search, Bar and `+` along the bottom; a line at the top only when offline or with changes waiting. Checked in an automated Chrome at phone size, and the laptop layout re-checked. Not seen on a real phone, which cannot reach it until the hub is on the VM.
- **Item 3, MCP on the laptop.** A small program in `app/mcp` offering thirteen tools (search, query, read a card, create, update, complete, lists, headings, tags, relationships, delete, restore). It asks the laptop's server through two new calls that read and act on the full copy. Its changes are labelled as the AI's. Every tool was driven with a test client on Linux. Not yet used from Claude Code or the Claude desktop app.
- **Item 4, Asana import.** `app/scripts/import-asana.js` reads Asana's JSON export of one project. Sections become headings, sub-tasks the task's own List, tags are kept, and importing again updates and does not copy. **It has not seen a real export.** It was written from Asana's published description of a task, and tested only on a made-up file. What the real file contains was never confirmed (spec 10.9), so expect to adjust it after the first real try.
- **Item 5, finishing.** Markdown export, one linked file per card, for Obsidian (`npm run export`). A dated backup of the database once a day, keeping 21, on the laptop and the hub. Purge on a timer was already in the hub.
- **Item 6, smaller things.** Tab then S (new sub-task) and Tab then Q (new item). "Save as card" on a search, which makes a Dynamic card on Home. Dragging within the bar is not done.

**What now waits for the VM**

1. Moving the hub there, behind Apache at `sutra.mitra.biz`.
2. A login for it (passkey, password as fallback). Can be built and tried on `localhost` beforehand.
3. The phone for real: installing from the VM's address, offline marking in use, and the leftover question of the aeroplane-mode alert (spec 10.12).

**MCP in use, and second feedback (16 Nov 2026).** Mitra connected the MCP server to the Claude desktop app, and Claude, in this project's own chat, read and changed his cards through it. So MCP is confirmed working from a real Claude on the Mac. One thing learned: several MCP calls sent at once were dropped; sent one at a time they all worked.

Mitra now keeps his bug list in Sutra itself, as a card "Bug Reports" with headings "Not reported to Claude yet", "Reported to claude", "Fixed by claude, not tested by mitra", "Fixed and tested by mitra", "Future features". Claude moves cards along as it works. Six were fixed in this round, each checked in an automated Chrome, none yet by Mitra:

- A card can be dropped anywhere in a List, including an empty one, and goes to the end.
- Several lines pasted into the new-item box become one item per line (bullets, numbers and tick boxes stripped).
- Dragging shows where the card will land: a blue line above the row, a tint on a heading, a line at the foot of a List; the dragged row fades.
- The boxes for "In" and for the other card of a relationship suggest cards as you type; Return takes the first.
- Headings can be reordered, by their own grip or with Cmd-Up and Cmd-Down.
- The security warning from `npm install` in `app/mcp` came from one library, since updated; none is reported now.

**The working arrangement from 16 Nov.** Mitra finds MCP "could be the most useful AI integration". He writes tasks as cards in "Bug Reports", with details in each card's Note. Claude picks up cards under "Ready for claude" (and, when convenient, "Future features - can do any time"), replies in the card's Note, and moves the card to "Fixed by claude, not tested by mitra", or to "claude questions in notes for mitra to answer" when it needs an answer. Cards under "Still editing" are left alone. What is said in a Note is not repeated in chat.

Third round, 16 Nov: dropping a card after a row (bottom half), which reaches the end of a sub-list; custom repeats (`3d`, `2w`, `6m`), built ahead of plan since it was small. Both checked in an automated Chrome and by tests; not yet by Mitra.

Fourth round, 16 Nov: choosing several cards and acting on them together (Cmd-click, Shift-click, a strip of actions, dragging the set, one undo for the lot). Checked in an automated Chrome; not yet by Mitra. If Sutra's server is found not running, Claude asks Mitra to restart it before going on.

Fifth round, 16 Nov: thirteen cards from Mitra's testing. Fixed: the drop line under a heading; drops in empty space below a sub-list; "Unsorted" for the unfiled part; suggestions closing on a click elsewhere; a chosen row draggable by any part; date colours as in Asana; Shift-Return or `›` to add an item and open its details; sort returning to "My order" on a different List; the custom-repeat box no longer sticking; a hand-made tag card (the `#🛖` case) treated as the tag; due-date sort ordered by overdue within a day. Also found and fixed from his report of a lost Note: **a Note saved a moment after typing stops could go to the wrong card, or be lost, if another card was selected within that moment.** The bar no longer waits on the server's status before drawing; his report that the bar did not update after adding a card to Quick access could not be reproduced, and this may or may not be its cause. All checked in an automated Chrome or by tests; the drag fixes by sending the drag events to the page, since a real mouse drag is not reliable there. None yet checked by Mitra.

One card was a question, whether anything stops work on Person cards and the integrations. Nothing does: they need the laptop only. Claude has proposed an order and asked how to read Contacts (built-in scripting first, nothing to install); awaiting his answer in the card.

Sixth round, 21 Nov: Sutra always wins when importing from Asana (spec 8); several chosen cards dragged no longer go astray or leave some behind (the List was being redrawn mid-drag; redrawing now waits until the drop); "+ add to a list" in the strip; the bar reordered by dragging within it; calendar repeats (`app/core/repeat.js`); Notes shown formatted (`app/public/live-markdown.js`, using extra CodeMirror parts added to the one combined file); the browser tests saved in the project; the hub's login (above). The remaining research is in spec 10.13. All checked by tests, mostly in Chrome; none yet by Mitra.

**Suggested next, once Mitra has tested:** fix what his testing finds; then the VM (hub, phone, MCP connector) when it is upgraded, or Person cards when Contacts is sorted out.

## 13. Risks

| Risk | What would be done |
| ---- | ------------------ |
| iPhone deletes the PWA's data after a long gap (spec 10.1). | Only unsent changes are at stake; everything else re-fetches. The pending count makes unsent changes visible. Tested in stage 0. |
| SQLite in the browser misbehaves on iPhone. | Fall back to the browser's simpler built-in store for the phone, at the cost of queries running differently there. |
| The iPhone shows its aeroplane-mode alert each time the app opens offline (seen in stage 0; the app works behind it). | Skip the check for a newer version when offline. If the alert remains, it is a nuisance, not a failure. |
| Sync has a subtle fault that loses or duplicates edits. | The pretend-devices tests; the hub's change record, from which any state can be re-examined; nightly backups. |
| Node's built-in SQLite changes before it is declared stable. | Swap to `better-sqlite3`; the core hides which one is used. |
| Stored queries break when tables change. | Queries only see the stable view (section 6). |
| Several tabs sharing the browser database prove unreliable in daily use (three tabs worked in stage 0). | Fall back to the laptop PWA reading and writing the local server directly, with no browser copy. That gives unlimited tabs, at the cost of a second way of working in the front end. |
| Redrawing a web component while you are typing in it loses the cursor. | Keep components small (one per card row) and never redraw the field being edited; extend `html-element-extended` if it needs help with this. To be tried early in stage 2. |
| A library turns out to need a build step. | Prepare that one library once as a single ready-made file kept in the repository; the app itself still has no build step. |

## 14. Questions

Decided so far, for the record:

- **D1** the laptop PWA keeps its own browser copy.
- **D2** in a conflict the later value stands.
- **D3** `html-element-extended` and web components.
- **D4** Apache in front of Express at `sutra.mitra.biz`; Chrome on the laptop.
- **D5** query helper words, and the field list in section 6.
- CodeMirror from the start, prepared once as a single file.
- Promises with `async` and `await` for new code.
- The tool is called **Sutra**.

- The built-in cards start at the bottom of the quick-access bar and can be moved or removed.
- The sketches' structure, for laptop and phone.
- Opening a card is by double click or the `>` mark, with no key.

- Opening moves cards between panes as described in section 8 (K1, confirmed).

- Relationships between cards: one entry shown from both ends; both names in the heading, separated by `/`; `#` reserved for tags and relationships; shown next to "In:"; in the first version.

No questions are open on the plan.

## 15. Sources added for this document

Checked 15 Nov 2026. Earlier sources are in spec section 10.

- [SQLite: persistent storage options for browsers](https://sqlite.org/wasm/doc/trunk/persistence.md)
- [Node.js documentation: SQLite module](https://r2.nodejs.org/api/sqlite.html)
- [Claude Code documentation: MCP](https://code.claude.com/docs/en/mcp.md)
- Read on the laptop, not the web: `frugal-iot-server` and `frugal-iot-client` (package files, `CLAUDE.md`, `index.html`, the VS Code launch file) and the `html-element-extended` module.
