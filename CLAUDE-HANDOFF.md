# Handoff notes for Claude

Written 15 Nov 2026 so that a new chat, possibly on a different account, can pick this project up. Everything needed is in this folder; do not rely on chat history, project docs or memory from the earlier account.

## What this is

Mitra is designing a personal productivity tool, named **Sutra**, (Asana + CRM + Notes, for himself only). The work so far is the spec.

- `firstthoughts.txt`: Mitra's original notes. Do not edit.
- `spec.md`: the spec, currently **draft 22**. This is the single source of truth.
- `plan.md`: the architecture and implementation plan, currently **draft 15**. It follows from the spec; anything that changes what the tool does goes into the spec first.
- The folder is an Obsidian vault and a git repository. Mitra edits `spec.md` in Obsidian.

## Rules Mitra has set

- **No app code until he says so.** On 15 Nov he approved stage 0 only (throwaway tests in `app/stage0`). Each later stage of the plan needs its own go-ahead.
- The spec is developed slowly over many interactions.
- Order of work is always spec, then implementation plan and architecture, then code. Any later change goes into the spec first, so the spec can always be handed to Claude (by Mitra or by someone building a variant) for a design-and-build exercise.
- Before relying on your own knowledge for anything about the current state of the world (software behaviour, versions, prices), check that web search actually works. If any tool is missing or failing, say so immediately and plainly, and say what it means for the task. Never work around a missing capability silently.

## How each round has worked

1. Claude lists numbered questions in section 9 of `spec.md`.
2. Mitra answers inline, under each question, and says "questions answered".
3. Claude reads the file from the folder (he may have edited other parts too), folds each answer into the body of the spec, removes the answered questions, adds any new questions the answers raise, and bumps the draft number in the title.
4. Claude replies with a short summary: main changes, anything assumed, and the most important new questions.

Conventions:

- The content is Mitra's. Keep his meaning; tidy wording only. Mark anything inferred as *(assumption)* and ask about it.
- Edit `spec.md` in place, and check it has not changed since it was read before overwriting anything.
- Do not make git commits unless asked. Mitra commits himself.
- Research findings go in section 10 with sources, stating plainly what is unverified or rests on a single source.
- Plain language in the spec; he reads it closely.

## State (updated 16 Nov 2026, spec draft 22, plan draft 15)

- The tool is named **Sutra**; address `sutra.mitra.biz`.
- Design continues alongside testing; Mitra adds ideas as he thinks of them.
- **No open questions** on the spec or the plan. Seven rounds of spec questions are folded in; the latest decided relationships between cards (spec 3.9: a sub-list headed `#first name / second name`, one membership entry shown from both ends, in the first version).
- **Stage 0 is complete; results are in spec 10.12.** Everything passed on the Mac (Chrome, `opfs`, several tabs) and the iPhone (`sahpool`, install, passkey, works in aeroplane mode after a fix to the test pages: the stored copy had failed because the server refuses bare folder addresses). Two loose ends: the iPhone still shows its aeroplane-mode alert before the working page (to tidy in stage 4), and the slow test of data surviving a week or two unopened on the iPhone is still running; ask Mitra about it later.
- Mitra writes test results inline in `app/stage0/README.md`; read it from the folder, never overwrite it.
- **Stage 1 is built: the shared core, in `app/core`, with tests in `app/test`** (`npm test` in `app/`; 22 pass; needs Node 22.13+; no dependencies). Read `app/README.md` and plan section 5 ("As built in stage 1") before touching it. The random multi-device test in `test/fuzz.test.js` is the safety net: run it after any change to `core/replica.js`.
- **Stage 2 has a first working version**: `app/server.js` (Express, 127.0.0.1:8470, data in `app/data/`), `app/public/` (web components on html-element-extended, SQLite in the browser via `worker.js` and `browser-db.js`), `app/vendor/codemirror.js` (made by `app/tools/`). Run with `npm install` and `npm start` in `app/`. Claude checked it only in headless Chrome on Linux by driving the pages; those checks are not in the test suite. **Awaiting Mitra's feedback from real use on the Mac.** Expect UI changes. Known gaps are listed in `app/README.md` ("Not there yet") and plan section 12.
- Front-end pitfalls already met: a redraw replaces every element, so `SutraElement.draw()` in `public/ui.js` carries over focus and typed text by `data-key`; the card pane keeps its Note editor and own List in place across redraws; EL() from html-element-extended only wires `onclick` and `onchange`, so other events use `on()`.
- Claude's device tools refuse to write into `.vscode`; the launch file is `app/vscode-launch.json` for Mitra to move.
- Mitra has used stage 2 on the Mac ("mostly looking good"); his first four faults are fixed (plan section 12). He reports problems briefly in chat; reproduce each in a browser before and after fixing.
- **The VM upgrade is blocked on someone else.** All six items of the no-VM list (end of plan section 12) are built in a first version: hub on the laptop (Mitra has connected it), phone layout, MCP (`app/mcp`), Asana import and Markdown export (`app/scripts`), daily backups, Tab-S, Tab-Q, "Save as card". **Items 2 to 6 were built while Mitra was away on the evening of 15 Nov and he has not tried them; he plans a long test session next.** Expect a list of faults: reproduce each in a browser before and after fixing.
- **Mitra's bug list lives in Sutra itself**: the card "Bug Reports" (id 30560381-4a52-4eb4-8b34-b132134f7988) on Home, whose headings Mitra changes as the workflow settles; on 16 Nov they were "Still editing claude shouldnt work on these" (leave alone), "claude questions in notes for mitra to answer", "Ready for claude", "Future features - can do any time", "Fixed by claude, not tested by mitra", "For ME TO DO" (his), "Fixed and tested by mitra". **Details are in each card's Note; reply in the Note, and do not repeat in chat what the Note says.** Pick up "Ready for claude" cards; ask questions by writing in the Note and moving the card to the questions heading. When the Sutra MCP tools are present (Mitra has added the MCP server to his Claude desktop app; they appear as `mcp__remote-devices__sutra__*`), read the list with `get_card` (and each card's Note with `get_card` on the card), and move each card to "Fixed by claude, not tested by mitra" when done. **Send MCP calls one at a time; several at once get dropped.** Without the MCP tools, the database can be read (never written) at `app/data/sutra.db`.
- **If Sutra's server is not running** (an MCP call says so), ask Mitra to restart it before doing the rest of the task; do not work around it. This is expected to happen often while he is testing.
- **Asana import mix-up (17 Nov).** The first importer took the project from the first task's first membership; tasks in several projects made it put one project into another's card and rename it. Found: "Partial" merged into by "Trip 2026Q4" (card asana:project:1216097977766700), "Daily" merged into by "Worklist" (asana:project:1211486451658029); "Incremental" and "Frugal IoT - Projects" sit under other projects' ids. Importer fixed; `app/scripts/split-merged-import.js` written and tested on a reproduction; Mitra asked to run it (Trip: default --keep later; Worklist: --keep earlier). Re-imports of Partial, Worklist, Incremental and Frugal IoT - Projects need `--into "<title>"`.
- What waits for the VM: moving the hub, a login (passkey; buildable on localhost), the real phone.
- The hub: `npm run hub` (port 8471, `app/data-hub/`, prints a key); a node is pointed at it by `app/data/config.json` or `SUTRA_HUB` / `SUTRA_HUB_KEY`. Claude tested it with playwright scripts run in its own workspace (hub plus two node servers); those scripts are not in the repository. **Since 21 Nov the screen has tests in the repository: `app/test-browser` (`npm run test:browser`, playwright-core driving Chrome; set `SUTRA_CHROME` to a Chromium binary in Claude's workspace). Add a test there for every screen fix.** The hub now has a login (`app/auth.js`, spec 7): a browser on port 8471 must sign in; `npm run set-password`; the laptop server is unaffected. When driving two pages in headless Chrome, call `bringToFront()` on a page before typing in it, or focus events do not fire.
- Front end rule learned: a text field saves on leaving it (change or blur) and never during a redraw; see `field()` in `public/ui.js`.
- `node_modules` is now under `app/stage0`, inside the Obsidian vault; the offered alternative is moving code to its own folder such as `~/git/github_mitra42/sutra`.
- **The 21 Nov batch is done** (spec draft 26, plan draft 17): every card from that list is either in "Fixed by claude, not tested by mitra", on hold, or under Future features (AI features in the app; choosing across two Lists; several cards on the phone). Research results are spec 10.13 and four "Research:" cards. Note: Claude's shell on Mitra's machine is a Linux VM that can't delete, so `npm install` run there leaves stray `.name-xxxx` folders in node_modules; prefer asking Mitra to run `npm install` himself.
- **Everything outstanding is now a card in Bug Reports** (21 Nov), under the heading "From the chat - not yet done (Claude, 21 Nov)": VM-dependent work (hub on VM, phone for real, MCP connector), the hub login (buildable now), Mitra's checks (iPhone data survival, Asana repair steps), research, future features, a decision on Asana re-imports overwriting Sutra edits, and saving the browser tests into app/test. Person cards and Contacts are on hold ("BlOCKED TIll fix contacts"). Keep that list current instead of tracking loose ends here.
- Mitra's other projects `~/git/github_mitra42/frugal-iot-server` and `frugal-iot-client` are the model for toolchain and style (Express, plain modules, import maps, VS Code launch file, `node --test`; but promises with async/await for new code). Read them, and their CLAUDE.md files, before any app code. Do not change them.
- Stage 3 depends on Mitra upgrading the VM's Ubuntu and Node.
- Remaining research is listed in spec section 9.
- A copy of the spec exists as `claude/spec.md` in the "Productivity Tool" project on claude.ai, but it is stuck at draft 5: saving to the project was refused (permission denied) on 15 Nov. The folder copy is the source of truth.
