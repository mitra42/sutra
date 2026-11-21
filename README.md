> **This project is 100% vibe-coded, currently between Mitra and Claude.** It's an experiment in personal design meeting open source.
>
> Intentionally, none of the code has been reviewed by a human. It is designed for Mitra's specific needs, and bugs get fixed and features changed along with those needs. You are welcome to fork it and continue the experiment. We believe `CLAUDE-HANDOFF.md` should be enough for Claude (or ChatGPT?) to pick up the project and run with it.
>
> PRs are welcome; be warned that it's likely Claude that will review whether to accept them.
>
> Issues are also welcome: we'll ask Claude to fix them. Again, it's an experiment.

# Sutra

A personal productivity tool: tasks and projects (in the style of Asana), people and companies (a small CRM), and Markdown notes, for one person, working offline on a laptop and a phone and syncing through a server.

| File | What it is |
| ---- | ---------- |
| `spec.md` | What the tool does. Written so that it could be handed to Claude, or anyone, to design and build their own variant. Changes start here. |
| `plan.md` | How it is built: architecture, data, sync, and the stages of building. |
| `app/README.md` | The code: how to install, run and test it. |
| `CLAUDE-HANDOFF.md` | Notes for an AI picking up the work: the rules, how each round works, and the current state. |
| `firstthoughts.txt` | Mitra's original notes, kept as written. |

## Where it stands (November 2026)

Mitra uses the laptop app every day, alongside Asana. Everything that runs on the laptop is built. The hub on a public server, and so the phone in real use, wait on a server upgrade. Person and Company cards and their links to Contacts and mail are designed but not built. The list of what Mitra is testing and what Claude is fixing lives in Sutra itself.

## What it does

**Cards and Lists**
- Everything is a card: a task, a note, a person or a company. Any card can hold a List of other cards, so projects, sub-projects and sub-tasks are all the same thing, nested as deep as you like.
- A card can sit in several Lists at once and shows all of them. Moving it in one List leaves it where it is in the others.
- Lists have headings, which can be dragged into a new order. Cards are added with Return, reordered by dragging, and several can be chosen together to complete, date, tag, move or delete in one step.
- Tags are cards too, so a tag has its own Note and List. Two cards can be related ("blocks" / "blocked by"), and the relationship shows on both.
- A quick-access bar down the left holds whatever you drag into it.

**Dates and repeats**
- A due date and an overdue date: when to start bothering, and when it is really late.
- Repeats count from the day you finished, not from the old due date ("every 3 days", "every 2 weeks"), or follow the calendar ("every Monday and Thursday", "the 1st", "the last day of the month"). Completing a repeating task moves its dates on; it doesn't make a new copy.

**Notes**
- Every card has a Markdown Note, shown formatted as in Obsidian, with the Markdown visible only on the line being edited.
- A link to any card can be copied, either as a web link or as an app link that opens the installed Sutra app from anywhere on the Mac, Notes included.

**Finding things**
- Search, and saved searches that are cards of their own and stay up to date ("Dynamic cards"). A search can be a query, for example `tagged('Home') and due <= today()`.

**Works offline, syncs when it can**
- The laptop keeps a full copy and works with no connection at all. The phone keeps the parts it needs. A hub server joins them up.
- Every edit is recorded field by field. If the same thing was changed in two places, the later change stands and the other is kept as a Conflict to look at, not silently lost.
- Your data stays on your own machines and your own server. There is no third-party cloud.

**Works with an AI assistant, but doesn't need one**
- Sutra includes an MCP server, the standard way for an AI assistant to use another program's tools. With it, Claude (the desktop app, or Claude Code) can read and change your cards for you: "add the tag #BeforeLeave to every Home task due today", or "check which tasks in the spec project are done".
- Claude's changes go through the same steps as your own: they sync, can conflict, can be undone, and are labelled as made by the AI.
- This project itself is run that way: Mitra writes bug reports as cards in Sutra, and Claude reads them through the MCP server, fixes them, and replies in each card's Note.

**Coming from Asana**
- Asana's keyboard shortcuts.
- An importer for Asana's JSON export of a project, headings and sub-tasks included. A task already in Sutra is never overwritten.

**Looking after the data**
- A dated backup every day (the last 21 kept), and export of everything as Markdown files that open as an Obsidian vault.
- The hub needs a passkey or a password to sign in.

## Compared with Asana

A rough guide, from Mitra's use of Asana's free plan and Asana's published plans (checked November 2026). Asana's plans change, so check theirs before relying on this.

**In Sutra but not in Asana's free plan**
- Tags (in Mitra's experience they weren't available to him on the free plan).
- Working fully offline on the laptop.
- Your own data, on your own machines.
- Repeats that count from the day you finished.
- Dynamic cards: saved searches written as queries.
- Relationships between any two cards, seen from both ends.
- Markdown Notes, and export to Obsidian.
- An MCP server that runs on your own machine. (Asana also offers an official MCP server for AI assistants, over the internet to your Asana account. Which Asana plans may use it wasn't checked.)

**In Asana's free plan but not in Sutra**
- Other people: sharing, assignees, comments, followers and notifications. Sutra is for one person.
- Board and calendar views.
- File attachments.
- Native apps for iPhone and Mac. Sutra is a web app installed from Chrome or Safari, and the phone side isn't in real use yet.
- Over 100 ready-made integrations with other services.

**In Asana's paid plans but not in Sutra**
- Starter: timeline and Gantt views, rules and automations, custom fields, forms, templates, reporting dashboards, and Asana's built-in AI.
- Advanced: portfolios, goals, workload and resource planning, approvals and proofing.

Some of these may come to Sutra if Mitra finds he misses them. Being one person's tool, it's unlikely ever to have the ones about working with other people.

## Licence

MIT: see `LICENSE`. The libraries Sutra uses carry their own licences.
