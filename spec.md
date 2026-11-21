# Sutra — Spec (draft 27)

**Status:** Design continues alongside building. A first version exists of everything that does not need the VM: the laptop app (in use), the hub (run on the laptop for now), the phone layout, MCP for AI tools, Markdown export, backups, an Asana importer, and the hub's login (passkey or password). See `app/README.md`. Still to come: the hub on the VM, and so a real phone.
**Source:** `firstthoughts.txt` (13 Nov 2026), Mitra's answers to seven rounds of open questions and to the first round of design decisions in `plan.md`, three further points from him (15 Nov 2026), and web research (14–15 Nov 2026). Answers are folded into the body. Section 9 holds open questions (none at present) and next steps; section 10 records the research, what it means for the design, and what remains unverified. Anything I have inferred is marked *(assumption)*.

---

## 1. Purpose and scope

- **Sutra** (a riff on Asana) is a personal productivity app, specific to Mitra. Single user; no plan to offer it to anyone else.
- Combines some aspects of **Asana** (tasks and lists), some of a **CRM** (people and companies), and some of **Notes**.
- Will run in parallel with Asana for a while, not replace it on day one.
- **AI friendly, but not AI dependent.** When Mitra asks an AI (such as Claude) to analyse the data or act on it, that should be as easy as possible. But everything must still work, especially offline, with no AI access at all. How an AI reaches the data is in 7.1.

### How this spec is used

- The spec is kept up to date. The order of work is always: spec, then implementation plan and architecture, then code.
- Any change wanted later is made to the spec first, and flows from there to the plan and the code.
- The spec should therefore always be something that could be handed to Claude for a design-and-build exercise. That includes someone else copying it, editing it, and building their own variant.

## 2. Architecture

| Part          | Description |
| ------------- | ----------- |
| **A. Phone**  | A PWA, installed to the home screen, holding offline-marked data locally and syncing when it is open and connected. |
| **B. Laptop** | A local server on the laptop holding a full copy of all data, so everything works with no connectivity. It is also where the laptop-only integrations run (Contacts, Mail, file links, LinkedIn export). |
| **C. Server** | Runs on Mitra's existing Linux VM, reachable over the public internet. The hub that everything syncs with (see Topology below). |

- **One front end.** The same PWA is the user interface everywhere, and can talk to either server. Following the research (10.4), the simplest way to get this is for each server to serve the front end itself: open the laptop's local address and it uses the local server; open the VM's address and it uses the VM. A page loaded from the VM reaching across to the laptop's local server is the awkward case and is best avoided.
- Offline and sync are designed in from the start, even though the first version only covers Tasks and Lists.
- It is acceptable for phone and laptop to have different functionality, particularly for integrations.

### Topology

- **Hub.** Everything syncs to the server. Devices do not sync with each other directly. The server is the master: it puts all changes into one agreed order.
- **Full copies:** the server, and the local server on each laptop. A second laptop would simply be another node.
- **Partial copies:** the PWA, whether on the phone or on a laptop, holds only what is marked offline, but can work offline with that.

### Technology preferences

- JavaScript for all three parts, as plain modules with **no build step** and no significant toolchain to install, in the manner of Mitra's Frugal IoT server and client. The point is the quick development loop: edit a file, reload, see the change. A one-off build step to prepare a dependency is acceptable. Developed in VS Code.
- Front end: web components built on Mitra's own `html-element-extended` module, which can be updated as this app requires.
- Database: SQLite, with the same tables on the server, the laptop and in the PWA. This should make the PWA's code easier to maintain. On the phone that means SQLite running in the browser (10.1).
- Backend: Express.

### Current platforms

- Phone: iOS 26.6.2
- Laptop: macOS 27.0.1, mostly using Chrome
- VM: an older Ubuntu and Node, due to be upgraded as a separate task; Apache provides https in front of Express
- VM domain: `mitra.biz`; this tool's address is `sutra.mitra.biz` (a riff on Asana)

## 3. Data model

### 3.1 Cards

Everything is a **Card**. There are five types: **Task**, **Note**, **Person**, **Company**, **Dynamic**. A card's type can be changed between Task, Note, Person and Company; a Dynamic card stays one.

Base fields, on every card:

- **Title**
- **Note**: a single Markdown body. Where several separate notes are wanted, they are separate cards in the card's List.
- **List**: every card contains exactly one List, which may be empty.
- **Tags** (see 3.4)
- **Created** and **modified** dates
- **Offline** flag (see 4)

Additional fields by type:

| Type | Adds |
| ---- | ---- |
| **Task** | Completed state; due date; overdue date; recurrence |
| **Note** | Nothing. Base fields only, including its List. |
| **Person**, **Company** | Dates as for a Task. The completed state exists but is hidden for now. Link to a Contact (see 6.1). |
| **Dynamic** | A search query. Its List is worked out from the query, and is read-only (see 3.8). |

More fields may be added as the design develops.

### 3.2 Lists

- A List is always part of a card. It is never a free-standing thing.
- A List is a list of **sub-lists**, each with a **heading**. The cards sit inside the sub-lists, which makes it easy to file something straight into a particular sub-list, as in Asana.
- Every List also has an **unheaded sub-list** for items not yet filed. It is first in the List, except on Home where it is at the bottom.
- A List can contain cards of any type.
- A sub-list whose heading starts with `#` is a **relationship** (3.9), and is shown differently.
- **A card can sit in more than one List**, in one sub-list of each. A card shows all the Lists it is a member of.
- **Loops are allowed** (a Person in a Company's List, and that Company in the Person's List).
- **Editing membership:** opening a card shows the Lists it belongs to, and these can be added to or removed there, as in Asana's right-hand pane. This is how a card is removed from one List without deleting it.

### 3.3 Things that are just cards and lists

Several features are deliberately not special concepts, only uses of the same structure. Each of these is a card with a List:

- **Project:** there is no project concept. The equivalent of an Asana project is a Task whose List holds its contents.
- **Home:** a card titled "Home", with a probably-empty Note, whose List is what the home page shows.
- **Quick-access bar:** can be ordered and given sub-headings (e.g. one for projects being worked on today).
- **Tags:** each tag is a Note card whose title starts with `#` (see 3.4). A **Tags** card lists them all.
- **Trash:** see 5.4.
- **Orphans:** cards that are in no ordinary List (see 5.4). Orphans is a Dynamic card (3.8), not a filed List.
- **Conflicts:** where sync conflicts are flagged for review (see 4).

**Two ways to build these.** Any such feature can be implemented either as a List that is constructed and maintained, or as a Dynamic card (3.8) that is worked out when viewed. Tags are maintained Lists: tagging a card is adding it to a List. Orphans is dynamic, and Conflicts probably is too, depending on how conflicts end up being handled. Trash is to be decided the same way *(assumption)*. The choice is kept flexible during implementation and can change if one way proves easier. The guide is that simpler code is easier to maintain.

### 3.4 Tags

- Tags work across all card types and are flat.
- A tag is a Note card titled `#name`, however it was made: a card given such a title by hand is that tag. Its List holds the tagged items. Its Note may be empty, and it may have no sub-headings.
- Tagging a card is therefore adding it to the tag's List. A task in `Project X` and tagged `#urgent` shows itself as a member of "`Project X`, `#urgent`".
- Clicking a tag opens that list.
- Ways to apply a tag: a tags area on the card with a "+" that suggests existing tags as you type and adds the `#` if it was not typed (the main way), typing `#name`, or dragging the card into the tag.
- A tag can be marked offline like any card, e.g. tag a group of tasks `#WorkOnPlane` and mark that tag offline.

### 3.5 Person and Company cards

Both have the base fields, so notes, tags, a List and dates can be added independently of the underlying Contact.

**Person**

- Created as needed. There does not have to be a card for each of the thousands of people in LinkedIn or Contacts.
- Can be linked to a Company card explicitly, which may simply mean being added to that Company's List.

**Company**

- Similar to a Person card.
- Finds any person whose email domain belongs to that company.
- Can find any email with that company.

### 3.6 Dates and repeating tasks

**Dates**

- Plain dates, with no time of day.
- A task can have a **due date**, an **overdue date**, both, or (often) neither. Usually at most one is set.
- The pair is for things flagged to do from one date that also have a second date they must be finished by.

**Repeating**

- Deliberately different from Asana. When a repeating task is marked done it does **not** create a fresh task. The same task's due date moves forward by the repeat interval.
- The interval counts **from the date it was completed**, not from the previous due date.
- The overdue date sits a fixed gap after the due date and moves forward with it. Examples: a weekly task due a week after last completion and overdue about a week after that; a daily task that is overdue only after 3 days.
- Repeats: daily, weekly, monthly, and custom intervals written as a number and a unit: `3d` every 3 days, `2w` every 2 weeks, `6m` every 6 months. Dates are often edited by hand afterwards.
- Calendar repeats (added 21 Nov 2026): on days of the week ("every Monday", "Monday and Thursday", "every weekday") or a day of the month ("the 1st", "the 15th", "the last day"). These are typed in ordinary words and shown back in words. When done, the due date moves to the next matching day after the day it was done; a day of the month that a month lacks (the 31st) means that month's last day. The overdue date keeps its gap, as above. Something that can't be understood is refused, not guessed.
- No history of past completions is kept.
- Ending a repeating task: usually by deleting it, which is distinct from completing it. Removing the repeat and then completing it also works.

### 3.7 Text

- Markdown is the core way of handling text everywhere.
- Notes are edited in CodeMirror and stored as plain Markdown.
- They are shown formatted, in the style of Obsidian's editor: headings, bold, italics, code, quotes, bullets and links appear as they will look, and the Markdown marks show only on the line(s) being edited (built 21 Nov 2026; see 10.8). Code blocks stay as typed.
- A plain click on a link on a formatted line follows it; Cmd-click follows a link anywhere, including the line being edited.

### 3.8 Dynamic cards

- A **Dynamic** card contains a search query. What it shows is whatever currently matches the query.
- Examples:
  - **Orphans** (5.4).
  - "All tasks marked due today".
  - "All tasks tagged `#UseAI` and in the list `Work Priorities`".
- The aim is that dynamic cards save building other hard-coded workflows (see section 8).
- **Fields:** the Title is editable and the Note works as on any card. An extra field holds the query, which is the `WHERE` clause of an SQL query. Helper words keep it readable, for example `tagged('UseAI')`, `in_list('Work Priorities')` and `today()`; the full list is in `plan.md`.
- **Making one:** type the query into the Search box, which runs it when it looks like a query (it uses a helper word or compares a field), then "Save as card", which keeps the query as typed. Words that are not a query become a query over titles and Notes. A search's results have a "Save as card" button, which puts the new Dynamic card on Home.
- **Read-only List:** cards cannot be dragged in, removed or reordered by hand, and there are no sub-headings. The card remembers the last sort order chosen.
- **Offline** (provisional; Mitra: "not sure, I think"): marking a Dynamic card offline syncs the card, the cards it surfaces (B), and the cards in their Lists (C), the same three levels as in section 4. The query is then run on the phone over what it holds, so changes made on the phone appear in the results if they match.
- **Phasing:** the concept exists in the first version and is used to implement built-in features. Dynamic cards written by the user come later.

*Consequences, confirmed in round six:* the query must also run on the phone, so the phone uses SQLite in the browser (section 2). The Search box stays simple, with the app turning a search into a `WHERE` clause; editing the clause by hand is the advanced option. A stored clause must not break when the database layout changes later; how that is ensured is in `plan.md`.

### 3.9 Relationships between cards

- **The need.** Peer relationships between cards. Example: Task A is "blocked by" Task B, which means Task B is "blocking" Task A. This is a general case, not only blocking.
- **How.** The existing structure is used. B goes into A's List, in a sub-list named for the relationship. There is no predefined set: any sub-list whose heading starts with `#` is a relationship. `#` was chosen because these are like tagging links.
- **`#` is reserved.** At the start of a card's title it means a tag (3.4); at the start of a sub-list's heading it means a relationship. Ordinary titles and headings do not start with `#`. *(assumption: the rule is about the start, not about `#` appearing later in the text)*
- **Two names in the heading**, separated by `/`: `#blocked by / blocking`. The first name is what the cards in the sub-list are to the card that owns it; the second is what the owner is to them. A relationship that reads the same both ways, such as `#related`, needs one name. The app offers headings already used on other cards, so each is typed once.
- **One entry, seen from both ends.** The record "B is in A's List, in the sub-list `#blocked by / blocking`" is all that is stored. On A it shows as "Blocked by: B". On B it shows as "Blocking: A". B needs no entry in its own List, so the two ends can never fall out of step.
- **Parent and child** can be set up the same way: putting B in A's `#Parent / Child` shows "Parent: B" on A and "Child: A" on B. This is separate from ordinary List membership, which also remains.
- **Display.** Relationships are shown at the top of the card, next to "In:", on both cards, and not among the List's ordinary items.
- **Adding one.** The box for the relationship's name is already filled in with the last one used, so only the other card has to be chosen. A button beside it shows which name this card will show ("this card: Blocking ⇄") and turns the relationship round, so "this card is Blocked by …" can be set from either card. On a new database it starts as `#Blocking / Blocked`.
- **First version.** This is core functionality that other things will be built on.
- *(assumption)* A relationship is not a home, in the same way a tag is not (5.4). A card that is only in A's `#blocked by / blocking` is still an orphan, and deleting A never offers to delete it.
- *(assumption)* Since a card sits in one sub-list of each List (3.2), B cannot be both an ordinary item in A's List and in a relationship sub-list of A, nor in two relationships with A from A's side. A blocked by B and B blocked by A at once is allowed, as loops are.
- *(assumption)* No mark on List rows for a blocked task in the first version; it can be added once the relationships are in use.

## 4. Connectivity and sync

Three working modes must be supported, on both phone and laptop:

1. **Fully online.**
2. **Working but poor connection** (e.g. tethered to a phone). Changes are queued and sent as soon as possible.
3. **No connectivity at all** (e.g. on a plane).

**What is held where**

- The laptop's local server holds everything.
- The PWA, on the phone or on a laptop, holds what is marked offline, and reaches the rest live.

**Offline rules (which in practice govern the phone)**

- Any card can be marked **offline**, including tags and the system cards (Home, quick-access, Tags). Nothing is offline unless flagged. It is a property of the card, the same on every device.
- Marking a card offline syncs **three levels**: the card (A), the cards in its List (B), and the cards in their Lists (C), but not the contents of C's Lists. This depth is a starting value to tune later.
- At the edge, C shows a count such as "12 items not available offline". C can then be marked offline from the phone, to be synced the next time the phone connects.
- New cards can be created anywhere while offline. A card made on the phone that is in no held List is passed to the server at the next sync and then no longer kept on the phone; it shows in Orphans.
- Search and tags, when offline, cover only what is held locally.
- On opening with no connection, the phone shows Home if Home is flagged offline; otherwise a list of the offline-marked cards.

**Limit found in research (10.2):** an iPhone PWA cannot sync in the background. "Sent as soon as possible" on the phone therefore means "as soon as the app is open and has a connection". Edits made offline and not yet sent exist only on the phone until the app is next opened online. The app must therefore show clearly when it is offline, and how many changes are waiting to be sent (normally zero when online). On the laptop it shows the same for the next step up as well: whether the laptop's server can reach the hub, and how many changes are waiting for it.

**Conflicts**

- Same card edited on two devices: merge field by field.
- Same field changed on both: the later change stands, and the earlier value is kept for review in the **Conflicts** list. (Whoever changes something may not know the old value, only what it should now be.)
- Same Note changed on both: keep both versions in the Note text with a separator between them, since the likely fix is editing them back together by hand.
- Structure (a List reordered, or a card moved, on two devices): apply both where possible, otherwise the last change wins.

## 5. User interface

### 5.1 Home page

- The Home card's List is always the starting point.
- "Pinned" is not a separate feature: it is a sub-list kept at the top of Home. The unheaded sub-list sits at the bottom of Home.

### 5.2 Layout

**Laptop:** three-pane view.

1. Quick-access bar down the left side. It holds Home, Search, and anything dragged into it. Any card can be dragged in, ordered (by dragging within the bar), and grouped under sub-headings. The built-in cards (Tags, Conflicts, Orphans, Trash) start at the bottom of it and can be moved or removed like anything else there. At its foot it shows the connection state and the number of changes waiting to be sent.
2. The List being worked on.
3. The selected card from that List, with its own List underneath it, and the Lists it belongs to (editable).

**Phone:** one card at a time, with a back button.

**Selecting and opening:**

- Selecting a row in the second pane (a click, or the arrow keys) shows that card in the third pane.
- Opening a card is by double click or by its `>` mark. There is no key for it.
- Opening a row in the second pane opens the card in the third pane.
- Opening a row in the third pane's own List moves everything one step left: the card that was in the third pane becomes the List being worked on in the second, and the newly opened card appears in the third. There is a way back.

**Addresses:** every view has its own web address, so the browser's back and forward buttons work, a view can be bookmarked, and different tabs can show different Lists.

**Sketches** of both layouts are in `plan.md`, section 8.

**Several tabs:** on the laptop the app must work in several browser tabs at once, as Asana does; Mitra uses this a lot. (Asana also has apps for macOS and iOS that work offline; Mitra uses the macOS one all the time.) Not needed on the phone.

Both: a compact UI that does not waste screen space.

### 5.3 Interaction

- Conceptually like Asana in many, but not all, ways.
- Use Asana's shortcut keys where possible (the official list is in 10.9). The ones that matter most:
  - Basic editing (Cmd-B, Cmd-K, etc.)
  - Return ends one new item and starts the next, for quick brainstorming of lists. Return in a heading starts the first item under it. Shift-Return (or the `›` beside the box) instead makes the item and opens its details, with the cursor in its Note, for adding one item slowly. A new item is typed into a box where it will go, and becomes a card once it has a title, so no empty cards are left behind
  - Tab-Del deletes the card (moves it to Trash)
- Shortcuts can be relearned where they clash with the browser.
- **Sorting** is available on any List. It is a temporary view and never changes the stored order (e.g. briefly sorting an ordered list to see what is due when). It sorts within each sub-list, not across headings. Options: most recently modified, most recently created, alphabetical, due date. Within one due day, the card that becomes overdue sooner comes first. Each List remembers the sort last chosen for it on that device only, not synced, so the laptop and the phone can differ. A Dynamic card's own sort is only its starting point.
- **Repeating tasks** show a circular arrow in place of the tick box; pressing it does the task for now and moves its dates on.
- **Selecting:** a click anywhere on a row of the working List shows that card on the right, and a card just added with Return is shown at once.
- **Row marks:** a small icon when the card has a Note; `› n` when its List has n items.
- **Links:** a link button beside the title of the working List and of the card on the right copies that card's address.
- **Dates on a row** are coloured as in Asana: green when due today or tomorrow, red when past due, with a "!" when past the overdue date, or past due with no overdue date set.
- **Completed tasks** are hidden by default, with a toggle on each List labelled "Show completed".
- **Dragging** shows where the card will land, with a line, as Asana does. A card can be dropped ahead of a row (over its top half) or after it (over its bottom half); onto a heading, where the line shows beneath the heading and the card lands first under it; or in empty space, where it goes after the nearest row above. In an empty List it simply goes in. Headings can be reordered too, by dragging or with Cmd-Up and Cmd-Down.
- **Several cards at once.** Cmd-click chooses rows (Shift-click a run of them). A strip above the List then offers: complete, set a due date, tag, add to another List (they stay in this one too), move under a heading, remove from the List, delete. Dragging one chosen row takes them all, in the order shown. The whole action is one step to undo. Esc lets go. Not yet: choosing across the two Lists on show, and choosing several on the phone (no Cmd-click there).
- **Pasting** several lines into the box for a new item makes one item per line, as Asana does.
- **Choosing a card** (to add to a List, or as the other end of a relationship) suggests matches as the name is typed.
- Dragging a card onto a heading files it under that heading. When a List has headings, its unfiled part shows an "Unsorted" line to drop onto, so a card can be dragged back out.
- The Tab shortcuts accept the letter with or without Shift, and Tab then H (Home) and Tab then / (Search) work wherever the focus is.
- **Undo** (Cmd-Z, and on the Edit menu) is general and lasting. Unlike Asana's, it does not disappear after a few seconds. It is per device (a deletion on the laptop cannot be undone from the phone), is not kept across app restarts, and within a session goes back a generous number of steps (say 20).
- **Search** goes across all cards. A word or phrase is looked for in the title and Note of every card; more fields may be added as needed. Regular expressions are allowed as wildcards, in preference to SQL's `LIKE` patterns.

### 5.4 Deletions, Trash and Orphans

**Deleting**

- Deleting a card puts it in Trash. Its membership of other Lists is **not changed**; a trashed card is simply not displayed in any List other than Trash.
- If the card's List contains cards that are in no other List, deleting asks: **"Delete cards not in any other list?"**
  - **Yes:** those cards are deleted too, and so on down through their Lists. Cards that are also in another List are left alone.
  - **No:** those cards are left and become Orphans.
- Cards that are also in another List are never affected. Example: create "While at Workshop", drag ten tasks in, delete the project afterwards; the tasks live on wherever they came from.

**Trash**

- Restoring is trivial: the card is still in its Lists and becomes visible again. If it was deleted with "Yes", restoring it also restores, in one step, the contents that were trashed with it.
- Trash can be opened and viewed in reverse order of deletion.
- Search also covers Trash, with trashed results marked as such.
- Trashed cards are **purged** after a configurable time (e.g. 7 days). On purge the card and its List are removed for good.

**Orphans**

- A card is an orphan when it is in no ordinary List. Membership of a tag or of the quick-access bar does not count as a home.
- Orphans is worked out, not filed. It is a Dynamic card (3.8) that shows every live card whose Lists are all trashed, purged, tags or quick-access.

## 6. Integrations (later phase)

General principle: ideally *read* the external content inside this app, read-only. Going to the original app to *write* (e.g. to send a WhatsApp message) is fine, as long as there is a link that opens it there.

Research findings for each are in section 10; the summary of what looks achievable is given here.

### 6.1 Contacts (iOS or macOS)

- Show the Contact's details inside the Person card if possible, read-only, with a link to open it in Contacts. If details cannot be shown, at least link to it.
- Matching a card to a Contact: show a list of possible names and select from them.
- **Laptop:** looks achievable through the local server (10.5).
- **Phone:** the PWA cannot read Contacts (10.5). That is accepted; contact details will not be copied through the server to make up for it.

### 6.2 Email

- Find messages to or from any address on a person's Contact, or any address at a company's domain.
- Search live rather than building an index.
- **Phone, and anywhere online:** the VM server runs IMAP searches against Mitra's own mail server, which is on the same machine (10.13: a suitable library exists).
- **Laptop:** Apple Mail keeps its own index database, which the local server could query by address (10.6, 10.13). Each result can link straight to the message in Mail. *(assumption)* IMAP first, since it serves every device; the Mail index as a laptop extra covering accounts IMAP doesn't reach.

### 6.3 LinkedIn, WhatsApp, Facebook Messenger

- Show how Mitra connects with a person. Do whatever proves possible; the minimum is a link to the conversation or profile.
- **WhatsApp:** a chat link can be built from the Contact's phone number alone (10.7), so nothing needs to be stored.
- **LinkedIn:** no API for a personal account; the profile link can come from the Contact or from LinkedIn's own data export (10.7). Requesting that export by hand now and then is acceptable.
- **Messenger:** `https://m.me/<username>` opens the conversation with a person. Meta documents it only for business Pages (10.13), but Mitra tried it on a friend's profile on 21 Nov: after signing in to Messenger it lands in the conversation. So a Person card can build the link from the person's Facebook username.

### 6.4 Notes (iOS or macOS)

- Undecided. A link from a card to a note is feasible but getting the link is fiddly (10.7). To revisit when integrations are designed.

### 6.5 Files, folders and links

- Link files or folders on the laptop to cards.
- The phone cannot open laptop links, but should still show that they exist.
- Currently one laptop, but links could name the machine (e.g. `mitragranite/foo/bar/baz.doc`) in case that changes.
- Possibly no separate mechanism: all links, local or https, could simply live in the Note using the usual conventions (e.g. Cmd-K to add a link).

## 7. Server and operations

- HTTPS, certainly.
- Reachable over the public internet at `sutra.mitra.biz`.
- The laptop's local server listens only to the laptop itself and needs no login.
- Authentication: passkeys preferred, for consistency with other apps; password as the fallback. A suitable library exists (10.3). Built 21 Nov 2026, on the hub only:
  - A browser must sign in to use the hub: with a passkey, or with the password. The laptop's own server still needs none; the laptop's server reaches the hub with the hub key, as before.
  - The password is set on the hub's machine from the command line, never through the web. It is stored only as a one-way hash.
  - Passkeys are made from a page reached once signed in (the first one after signing in with the password), named by device, and can be listed and forgotten there.
  - Signing in sets a cookie set by the server, readable only by it and sent only to the hub's own pages, lasting as long as browsers allow (400 days). Signing out ends it.
  - Login data is kept apart from the database and never synced.
  - A passkey belongs to one site name, so passkeys made while the hub runs on the laptop will not work once it is at `sutra.mitra.biz`.
  - The later MCP connector (7.1) asks for permission through this same sign-in.
- Backup of the database: a dated copy once a day, keeping the last 21, on the laptop and on the hub.
- Export as Markdown files, one per card, in a form that opens as an Obsidian vault. (Obsidian copes well with a directory mixing Markdown and other files.)

### 7.1 AI access

- The AI is presumed to run outside the app: for example a Claude chat, or Claude Code inside VS Code. An example request: *Look up the spec notes in "Spec for XYZ" and check which of the tasks tagged "#Urgent" are complete.*
- The route is an **MCP server**. MCP is a standard way for an AI tool to call another program's functions, so any AI tool that supports it could read and act on the data (10.11).
- The server's API is designed with MCP in mind from the first version, so that the MCP server is a thin layer over the same API the front end uses.
- **Order of building:** first an MCP server on the laptop, as soon as the first version works. It needs no login and no https, because the AI tool runs it as a local program (10.11). Then one on the VM, added to Claude as a connector, which does need https and a login for the AI. *(assumption)* That login is the standard way (OAuth) for one service to be given access to another, and its "is this you, and do you allow it?" step uses the hub's own sign-in (section 7).
- Nothing in the app depends on an AI being available.
- **AI features inside the app:** none in the first version. With MCP they can all be done from a Claude chat with no code in the app. Anything asked for repeatedly can be moved inside later. Candidates noted for then: plain words turned into a query (the likeliest); suggested filing for unfiled items; a "brief me" summary of a card and its List; breaking a task into sub-tasks; search by meaning.

## 8. Phasing

**First version:** Tasks and Lists, the core structure, with offline and sync built into the architecture. Relationships between cards (3.9) are included. The Dynamic concept is included for built-in features such as Orphans.

**Later:**

- Person and Company integrations (section 6)
- Asana import, one project at a time (10.9). Built. Importing a project whose tasks are already in Sutra (from another project, or imported before) never changes them: Sutra always wins. Such a task is only added to the List being imported into, under its Asana section, if it is not there already.
- Calendar-rule repeats (built 21 Nov 2026, 3.6)
- Dynamic cards written by the user (3.8)
- MCP access for AI: laptop first, soon after the first version, then the VM (7.1)
- Custom workflows (below)

**Out of scope for now:** attachments or photos captured on the phone, notifications, calendar integration.

### Custom workflows

The tool should be able to accommodate personal workflows. Some will just be arrangements of tasks; others may need functionality built in.

Example, the **"Daily" project**: in Asana this has a sub-category for each day; tasks are moved to the next day when complete, and overdue tasks are easy to see. With repeating tasks (3.6) and the due / overdue pair of dates, this could instead be a single list sorted on due date.

Dynamic cards (3.8) are intended to cover many such workflows without building anything specific: a workflow becomes a saved query.

---

## 9. Open Questions and next steps

### Open questions

None outstanding on the spec. All seven rounds are answered and folded into the body.

### Next steps

1. **Remaining research:** done on 21 Nov (10.13), except checking on the Mac itself where Apple Mail's database is on macOS 27, which waits with the Contacts work. Asana's API and clashes with its shortcuts were dropped as not needed (Mitra, 21 Nov).
2. **Implementation plan and architecture design:** draft 16 is in `plan.md`. It covers the data layout, changes and sync, the API, the front end, the first version's scope, and the stages of building. It includes screen sketches for laptop and phone, agreed in structure. Still no code until Mitra says so.
3. **Hands-on tests:** stage 0 is complete (results in 10.12) apart from the slow test, still running, of whether the iPhone keeps the data over a week or two unopened. The installed iPhone app now opens and works in aeroplane mode; a system alert still appears first, which is a small point to tidy in the real app.

## 10. Research findings (14–15 Nov 2026)

Sources are listed at the end. Where a finding rests on a single or secondary source, or was not confirmed, it says so. Nothing here has been tested hands-on.

### 10.1 Phone: local storage

- **Space is not a constraint.** Since iOS 17 a site, including one added to the home screen, may store up to roughly 60% of the disk.
- **Eviction.** Safari deletes script-written data for sites not used for seven days of browser use. WebKit has said home-screen web apps have their own usage counter and that it does "not expect" their data to be deleted; a WebKit engineer later repeated that storage on a home-screen app's own domain should not be removed. The wording is hedged, not a guarantee.
- **Persistent mode.** The app can ask for storage to be protected from eviction; WebKit grants this by heuristics that include being opened as a home-screen web app.
- **Storage engines available:** IndexedDB, and a private file system on which a real SQLite database can run in the browser. The SQLite route needs iOS 17 or later for its main mode, has a fallback mode for older versions, adds a few hundred KB to the download (one author's figure: about 400 KB), and allows only one connection at a time, which matters if the app is open in two tabs.

*Design implications:* install to the home screen; request persistent storage; treat the servers as the source of truth and the phone's store as a cache plus a queue of unsent changes. SQLite in the browser has since been chosen (section 2), giving the same database on phone, laptop and VM.

### 10.2 Phone: background behaviour

- Background Sync, Periodic Background Sync and Background Fetch are **not supported** on iOS, and Safari's position makes that unlikely to change.

*Design implication:* the phone syncs only while the app is open. Already reflected in section 4.

### 10.3 Login

- **Passkeys are feasible.** SimpleWebAuthn is an MIT-licensed pair of JavaScript libraries (server and browser) for exactly this, supporting current Node LTS versions (22 and up).
- iOS has supported the underlying standard since 14.5 and passkeys since iOS 16.
- **Login cookie.** On iOS, cookies set by script are capped at seven days even in a home-screen app. A cookie set by the server (HttpOnly) keeps its full lifetime. So the session must be a server-set cookie.
- **Not confirmed:** I found no source stating explicitly that passkeys work inside a home-screen web app, as opposed to Safari. To be tested early.

### 10.4 One front end, two servers

- A page loaded from the VM (https) calling the laptop's local server is the problem case. Chrome now asks the user's permission before a public site may reach the local machine (from Chrome 142). In Safari, the request to treat local addresses as safe from an https page was still open in the bug record I could read, which ran only to 2021, so its current state is unknown.

*Design implication:* each server serves the front end itself (already in section 2). The two addresses are then separate sites to the browser, with separate local storage and separate logins.

### 10.5 Contacts

- **Phone:** the web Contact Picker is not supported in Safari (it has sat behind an experimental switch since iOS 14.5), and even where supported it is a one-off picker, not ongoing access. So the phone PWA cannot read Contacts.
- **Laptop:** `node-mac-contacts` is a Node module that reads the macOS Contacts database: search by name, with emails, phone numbers, organisation, social profiles and a stable identifier per contact, plus a notification when contacts change. It needs the user's Contacts permission.
- **Not confirmed:** its documentation describes the permission in terms of a packaged Mac app. Whether a plain Node server gets the permission prompt needs a hands-on test. I did not check how recently the module was updated. The alternative, scripting the Contacts app, was not researched.

### 10.6 Email

- **Apple Mail's index.** Mail keeps an SQLite database of every message's sender, recipients, subject, date and a short snippet (`~/Library/Mail/V10/MailData/Envelope Index` on macOS Sonoma and Sequoia, per one developer article). It can be read while Mail is running and must never be written to. That fits "search live, no index of our own": Mail has already built the index.
- **Opening a message.** A `message:` link containing the email's Message-ID opens that message in Mail, on both macOS and iOS. It is undocumented by Apple but long-standing. On macOS the message must already be downloaded.
- **Not confirmed:** this rests on one article; the database is undocumented and its location changes between macOS versions; reading it very probably needs Full Disk Access for the server, which the article did not cover. Spotlight as an alternative was not verified. IMAP search was not researched (it is a standard part of the protocol). Mitra's laptop runs macOS 27, newer than the versions the article names, so the folder may no longer be `V10`; to check on the machine.

### 10.7 WhatsApp, LinkedIn, Notes

- **WhatsApp:** `https://wa.me/<number>` with the full international number opens a chat with any WhatsApp user, on the phone and on WhatsApp Web (WhatsApp's own help page). So the link can be generated from the Contact's phone number. Reading message history was not found to be possible and was not pursued.
- **LinkedIn:** there is no self-service API for a personal account's connections or messages. LinkedIn's "Get a copy of your data" export includes `Connections.csv` with name, profile URL, company, position, connection date, and email only where the person allows it (often blank). Importing that file on the laptop would let Person cards find their profile link.
- **Apple Notes:** links of the form `applenotes:note/<identifier>` open a specific iCloud note on Mac and iPhone (forum reports, recent macOS). Getting the identifier is the hard part: a manual copy-link trick in Notes, or reading Notes' own database.
- **Messenger:** not researched this round.

### 10.8 Markdown editor

- Obsidian's editor is built on CodeMirror 6 (general knowledge, consistent with Obsidian's developer documentation).
- Open-source CodeMirror 6 extensions exist that give the same hybrid behaviour: rendered text everywhere except the line being edited. One example is `codemirror-markdown-hybrid` (MIT). Assessed 21 Nov (10.13): early, so Sutra has its own small extension instead.

*Design implication:* use CodeMirror 6 as the plain Markdown editor from the start, so the hybrid view can be added later without changing editors. CodeMirror is published as many small pieces meant to be combined by a build tool, so it is combined once into a single file; that one-off step for a dependency is acceptable (section 2).

### 10.9 Asana

- **Shortcuts (Asana's official list, macOS):**

| Action | Keys |
| ------ | ---- |
| New task | Return |
| New task above | Shift-Return |
| Delete task | Tab-Del |
| Complete task | Cmd-Return |
| Open / close task details | Tab then Return / Esc |
| Set due date | Tab-D |
| Add subtask | Tab-S |
| New section | Tab-N |
| Move task up / down | Cmd-Up / Cmd-Down |
| Move task to previous / next section | Cmd-Shift-Up / Cmd-Shift-Down |
| Search | Tab-/ |
| Home | Tab-H |
| Quick add | Tab-Q |

  Tab-Del is correct as Mitra wrote it; my earlier doubt was unfounded. Clashes with browser shortcuts were not checked.

- **Import.** Asana exports one project at a time, as CSV or JSON, from the project's menu. JSON is the fuller format. Exactly what the JSON contains (subtasks, tags, membership of several projects) was not confirmed before building; real exports have since been imported. Asana's API is not needed (Mitra, 21 Nov).

### 10.10 Sync design

- The ready-made sync engines that came up (PowerSync, ElectricSQL, Zero) are built around a Postgres server, not SQLite. `cr-sqlite`, which adds merging to SQLite itself, was judged too early for production by one author in late 2025. This was not an exhaustive survey and rests on secondary sources.
- The same author's advice for simple apps: per-field timestamps with a custom push and pull against the server can beat a general engine, provided it is fully understood; keep changes to the data layout additive; log sync events in detail.
- The rules in section 4 go beyond the usual "last write wins": a same-field clash must be flagged, not silently resolved. That needs each device to record what it changed and from what.

*Design implication:* a purpose-built sync based on a log of changes (card, field, old value, new value, time, device) looks the best fit. The same log would provide lasting undo (5.3) and the Conflicts list (section 4). This is a proposal for the design stage, not a decision.

### 10.11 MCP (15 Nov 2026)

- **Claude chats** can be connected to an MCP server by its web address, as a "custom connector". This is available on all plans (the Free plan allows one). The address must be https.
- **Login for a connector.** The dependable route is OAuth, a standard sign-in flow which the server must provide. A simpler fixed key sent with each request exists, but Anthropic's documentation describes it as a beta available to a limited set of organisations, so it cannot be counted on.
- **On the laptop.** The Claude desktop app can install an MCP server that runs on the computer itself (a "desktop extension"), and Anthropic's documentation says the same server can be added to Claude Code from the command line. **No https is needed there:** Claude Code starts a local MCP server as an ordinary program on the machine and talks to it directly, with no web address or certificate involved (Claude Code's documentation). Https applies only to a server reached by its web address. For a server inside a private network there is also something called an MCP tunnel, which I did not read up on.
- **Building one.** The official MCP SDK for JavaScript (`@modelcontextprotocol/sdk`, MIT licence) supports both a local mode and a web mode, which fits the JavaScript preference in section 2.
- **Not confirmed:** how much work the OAuth sign-in is on our own server, and whether it can reuse the passkey login; how neatly the SDK fits into an Express server; which Node versions it supports. I relied on Anthropic's documentation and the SDK's own site only.

### 10.12 Stage 0 results (15 Nov 2026)

Run by Mitra with the throwaway pages in `app/stage0`.

| Test | Mac, Chrome | iPhone, installed to home screen |
| ---- | ----------- | -------------------------------- |
| SQLite in the browser, loaded with no build step | Works | Works |
| Storage method | `opfs` (several tabs) | `sahpool` (one tab) |
| Three tabs sharing one database, staying in step | Works | Not needed |
| `REGEXP` supplied by the page | Works | Not separately reported |
| Installs and opens as its own app | Works | Works |
| Opens with the server stopped / in aeroplane mode | Works | Failed at first; **works after a fix**, behind a system alert (see below) |
| Rows still there after closing and reopening | Works | Works |
| Protected storage | Not asked | Granted |
| Passkey: create, then sign in | Not reported | Works |
| Data survives a week or two unopened | Not applicable | Still running |

What this settles:

- The browser-database design stands on both devices: the several-tabs method on the laptop, the one-tab method on the phone, which is all the phone needs.
- Passkeys work inside an installed iPhone web app.
- The laptop's local address works in Chrome as an installed app that opens with no server.

- The installed iPhone app opens and works with no connection, including adding rows to the database.

**The aeroplane-mode failure, explained.** On the first run the pages asked the web server for the bare folder address as one of the files to keep. Mitra's server does not allow bare folder reads, so that one request failed, and the way the pages were written made the whole stored copy fail with it. Nothing was stored, so nothing could open offline. The retest pages store each file separately and report the outcome: 15 of 16 stored, the one failure being the bare folder address, and the app then opened and worked in aeroplane mode.

Lessons carried into the plan: store each file separately and never let one failure spoil the rest; do not rely on bare folder addresses; show on screen what has been stored.

**Still open, minor.** In aeroplane mode the iPhone still shows its own small alert, "Turn off Airplane Mode or Use Wi-Fi to Access Data", with the working page behind it. Something still tries the network on opening. The likeliest cause is the browser's routine check for a newer version of the app, which the page asks for each time it opens; the real app can skip asking when offline. Whether that removes the alert is unverified.

**Also noted.** The iPhone reported that the two isolation headers were not in effect, so Mitra's web server did not send them. That is why the iPhone used `sahpool`. Whether Safari would offer `opfs` with the headers is untested and does not matter: the phone needs one tab only.

### 10.13 Research, 21 Nov 2026

- **Messenger.** Meta documents `m.me` links only for business Pages, as a way into a Page's conversation. No documented link to a conversation with a person was found. Tried by Mitra on 21 Nov: `m.me/<username>` does open a conversation with a person, after a Messenger sign-in step.
- **IMAP from Node.** ImapFlow (MIT, current version 2.12.2, Node 20 or later) is a maintained IMAP library. Its search accepts "any of" (OR) conditions, so one search finds mail from, to or copied to an address, optionally since a date; then only the envelopes (date, sender, recipients, subject, Message-ID) need fetching. It needs the mail account's password (or an app password), kept in the server's settings, never in the browser. Checked from its README and the type definitions in its published package.
- **Apple Mail's database.** Per a second secondary source, the index is `~/Library/Mail/V<n>/MailData/Envelope Index` and the number rises with macOS versions (that source has V10 up to Catalina and V11 from Big Sur; 10.6's source said V10 for Sonoma and Sequoia, so the sources disagree). The server should look for the highest `V` folder rather than assume one. Reading it needs Full Disk Access for the program reading it. Not checked on macOS 27: to do on the Mac (`ls ~/Library/Mail/`).
- **CodeMirror hybrid editing.** `codemirror-markdown-hybrid` is its author's first extension and brings extras Sutra does not need. No established package was found. Building it from CodeMirror's own parts (the Markdown syntax tree, and decorations that hide the marks away from the cursor's line) is about 150 lines, so Sutra does that (3.7).

### Not yet verified, to test hands-on when building starts

- Whether the iPhone's aeroplane-mode alert can be avoided when the app opens offline (10.12).
- Whether the phone's local data really survives long gaps between uses (test running).
- Contacts permission for a plain Node server on the Mac.
- Reading Apple Mail's index on the laptop's macOS version, and the permission it needs.
- LinkedIn message links.

### Sources

- [WebKit: Updates to Storage Policy](https://webkit.org/?p=14403)
- [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [Michael Tsai: Safari 13.1 and 7-day script-writeable storage (quotes WebKit's clarification)](https://mjtsai.com/blog/2020/03/26/safari-13-1-third-party-cookie-blocking-and-7-day-script-writeable-storage/)
- [WebKit bug 237350: home-screen web app cookies deleted after 7 days](https://bugs.webkit.org/show_bug.cgi?id=237350)
- [SQLite: persistent storage options for WASM](https://sqlite.org/wasm/doc/trunk/persistence.md)
- [firt.dev: iOS PWA compatibility](https://firt.dev/notes/pwa-ios/)
- [Web features explorer: Background Sync](https://web-platform-dx.github.io/web-features-explorer/features/background-sync)
- [SimpleWebAuthn](https://github.com/MasterKale/SimpleWebAuthn)
- [passkeys.dev: iOS reference](https://passkeys.dev/docs/reference/ios)
- [Chrome: Local Network Access](https://developer.chrome.com/blog/local-network-access)
- [WebKit bug 171934: loopback addresses and mixed content](https://bugs.webkit.org/show_bug.cgi?id=171934)
- [web.dev: accessing contacts from the address book](https://web.dev/articles/web-apps/contacts)
- [node-mac-contacts](https://npmjs.com/package/node-mac-contacts)
- [dev.to: reading Apple Mail without AppleScript](https://dev.to/whoffagents/how-to-read-apple-mail-without-applescript-its-1000x-faster-cji)
- [NSHipster: Message-ID and Mail.app deep linking](https://www.nshipster.com/message-id/)
- [WhatsApp: how to use click to chat](https://whatsapp.com/faq/en/general/26000030)
- [Linked API: exporting LinkedIn connections](https://linkedapi.io/guides/export-linkedin-connections.md)
- [Keyboard Maestro forum: Apple Notes deep links](https://forum.keyboardmaestro.com/t/macro-to-copy-apple-notes-deep-link/38494)
- [codemirror-markdown-hybrid](https://cdn.jsdelivr.net/npm/codemirror-markdown-hybrid@1.2.2/README.md)
- [Asana: keyboard shortcuts](https://help.asana.com/s/article/keyboard-shortcuts)
- [Breeze: exporting from Asana](https://www.breeze.pm/articles/export-from-asana)
- [Smashing Magazine: the architecture of local-first web development](https://www.smashingmagazine.com/2026/05/architecture-local-first-web-development/)
- [Claude docs: add a connector that isn't in the directory](https://claude.com/docs/connectors/custom/remote-mcp)
- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/)
- [Claude Code documentation: MCP](https://code.claude.com/docs/en/mcp.md)
- [Meta: m.me links (Messenger Platform)](https://developers.facebook.com/documentation/business-messaging/messenger-platform/discovery/m-me-links.md)
- [ImapFlow](https://github.com/postalsys/imapflow)
- [Haven: Mail app cache structure](https://chrispatten.github.io/haven/reference/mail_app_cache_structure)
- [RFC 9051, IMAP: the SEARCH command](https://www.rfc-editor.org/rfc/rfc9051#section-6.4.4)
