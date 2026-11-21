# Sutra for AI tools (MCP)

This small program lets an AI tool such as Claude read and act on your Sutra data. The AI tool starts it on your laptop and talks to it directly; it then asks Sutra's local server. No web address, certificate or login is involved, and Sutra works exactly the same with or without it.

Whatever the AI does goes through the same rules as a tap on the screen: it appears in the app, syncs, and can be put right by hand. Deleted cards go to Trash as usual.

## Setting it up

1. Once only, install its library:

   ```
   cd app/mcp
   npm install
   ```

2. Sutra's server must be running (`npm start` in `app/`).

3. Tell the AI tool about it.

   **Claude Code** (in a terminal, or VS Code's):

   ```
   claude mcp add sutra -- node "/Users/mitra/Claude/productivity tool/app/mcp/sutra-mcp.js"
   ```

   **Claude desktop app:** Settings, Developer, Edit Config, and add under `mcpServers`:

   ```
   "sutra": { "command": "node", "args": ["/Users/mitra/Claude/productivity tool/app/mcp/sutra-mcp.js"] }
   ```

   then restart the app. *(The Claude Code command is from its documentation. The desktop app's setting is from memory and was not re-checked.)*

If Sutra's server is on another port, set `SUTRA_URL`, for example `SUTRA_URL=http://localhost:8472`.

## What it offers

| Tool | Does |
| ---- | ---- |
| `search_cards` | Finds cards by a word, phrase or regular expression in title or Note. |
| `query_cards` | Finds cards by a query, as in a Dynamic card: `tagged('Urgent') AND done = 0`. |
| `get_card` | Reads one card in full, with the cards in its List. Start from `home`. |
| `create_card`, `update_card`, `complete_card` | Makes, changes, ticks. |
| `add_to_list`, `remove_from_list`, `add_heading` | Arranges cards in Lists. |
| `tag_card`, `relate_cards` | Tags and relationships. |
| `delete_card`, `restore_card` | To Trash and back. |

## Things to try saying

- "Look up the notes in 'Spec for XYZ' in Sutra and tell me which of the tasks tagged #Urgent are complete."
- "In Sutra, file the unfiled tasks in 'Home' under sensible headings."
- "What is due this week in Sutra?"

## What was checked

Claude drove every tool with a test client on Linux on 15 Nov 2026. It has not been used from Claude Code or the Claude desktop app on the Mac.
