#!/usr/bin/env node
// Sutra's MCP server. An AI tool (Claude Code, the Claude desktop app) starts this as a local
// program and talks to it directly; it in turn asks the laptop's local Sutra server. It can do
// what the app can do and no more, and nothing in Sutra depends on it (spec 7.1).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const SUTRA = (process.env.SUTRA_URL || 'http://localhost:8470').replace(/\/$/, '');

async function call(kind, op, ...args) {
  let response;
  try {
    response = await fetch(`${SUTRA}/api/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sutra': '1' },
      body: JSON.stringify({ op, args, as: 'ai' }),
    });
  } catch (err) {
    throw new Error(`Sutra's server is not running at ${SUTRA}. Start it with "npm start" in the app folder.`);
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Sutra said ${response.status}`);
  return body.result;
}
const read = (op, ...args) => call('read', op, ...args);
const act = (op, ...args) => call('act', op, ...args);

// What an AI needs to see of a card in a list of cards.
function brief(c) {
  const out = { id: c.id, type: c.type, title: c.title };
  if (c.completed) out.completed = c.completed;
  if (c.due) out.due = c.due;
  if (c.overdue) out.overdue = c.overdue;
  if (c.repeat && c.repeat !== 'none') out.repeat = c.repeat;
  if (c.tags && c.tags.length) out.tags = c.tags;
  if (c.count) out.itemsInItsList = c.count;
  if (c.trashed) out.inTrash = true;
  return out;
}

async function cards(ids) {
  const found = await Promise.all(ids.slice(0, 200).map((id) => read('card', id)));
  return found.filter(Boolean).map(brief);
}

const server = new McpServer({ name: 'sutra', version: '0.1.0' });

function tool(name, description, inputSchema, run) {
  server.registerTool(name, { description, inputSchema }, async (input) => {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await run(input), null, 1) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }
  });
}

const id = z.string().describe('The id of a card. The built-in cards have the ids home, quick, tags, conflicts, orphans and trash.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().describe('A date as YYYY-MM-DD, or null to clear it');

tool('search_cards', 'Find cards whose title or Note contains a word, a phrase or a regular expression. Capitals are ignored. Includes cards in Trash, marked as such.',
  { text: z.string() },
  async ({ text }) => cards(await read('search', text)));

tool('query_cards', `Find cards with a condition written as the WHERE part of an SQL statement over the view "cards".
Fields: type ('task', 'note', 'dynamic'), title, note, due, overdue, completed (dates as 'YYYY-MM-DD' or NULL), done (1 or 0), repeat, created, modified, offline.
Helpers: tagged('UseAI'), in_list('title or id of a card'), today(), today(7) for 7 days ahead, rel('blocked by') for cards in a relationship of that name, orphan(), conflicted(). REGEXP is available.
Example: type = 'task' AND done = 0 AND tagged('Urgent') AND due <= today(7)`,
  { where: z.string() },
  async ({ where }) => cards(await read('query', where)));

tool('get_card', 'Read one card in full: its fields and Note, the Lists and tags it is in, its relationships to other cards, and the cards in its own List under their headings. Use the id "home" to start from the top.',
  { id },
  async (input) => {
    const card = await read('card', input.id);
    if (!card) throw new Error(`No card with the id ${input.id}`);
    const [memberships, list] = await Promise.all([read('memberships', input.id), read('list', input.id, { showCompleted: true })]);
    return {
      ...brief(card),
      note: card.note,
      query: card.query || undefined,
      inLists: memberships.lists,
      tags: memberships.tags.map((t) => t.title),
      relationships: [
        ...list.relationships.flatMap((r) => r.cards.map((c) => ({ this_card_is: `the owner; "${c.title}" is its "${r.label}"`, heading: r.heading, other: c.id }))),
        ...memberships.relationships.map((r) => ({ this_card_is: `"${r.label}" of "${r.card.title}"`, other: r.card.id })),
      ],
      list: list.sublists.map((s) => ({ heading: s.heading, headingId: s.id, cards: s.cards.map(brief) })),
    };
  });

tool('create_card', 'Make a new card, optionally inside the List of another card (use "home" for the top level) and under one of that List\'s headings.',
  {
    title: z.string(),
    type: z.enum(['task', 'note']).default('task'),
    note: z.string().optional().describe('Markdown'),
    list: id.optional().describe('The card whose List the new card goes into'),
    headingId: z.string().optional().describe('The id of a heading in that List, from get_card'),
    due: date.optional(),
  },
  async ({ title, type, note, list, headingId, due }) => {
    const made = await act('createCard', { title, type, note }, list ? { list, sublist: headingId || null } : undefined);
    if (due) await act('edit', made, { due });
    return { id: made };
  });

tool('update_card', 'Change a card\'s title, Note, dates or repeat. Only the fields given are changed.',
  {
    id, title: z.string().optional(), note: z.string().optional().describe('Markdown; replaces the whole Note'),
    due: date.optional(), overdue: date.optional(), repeat: z.string().optional().describe('none; daily, weekly, monthly or 3d, 2w, 6m (counted from the day done); or on calendar days: mon, mon+thu, weekdays (days of the week), m1, m15, mlast (day of the month)'),
  },
  async ({ id: cardId, ...fields }) => {
    await act('edit', cardId, fields);
    return brief(await read('card', cardId));
  });

tool('complete_card', 'Tick a task as done, or un-tick it. A repeating task is not completed: its dates move on instead.',
  { id, done: z.boolean().default(true) },
  async ({ id: cardId, done }) => {
    await act(done ? 'complete' : 'uncomplete', cardId);
    return brief(await read('card', cardId));
  });

tool('add_to_list', 'Put a card into the List of another card (it stays in any Lists it is already in), or move it to a different heading there.',
  { list: id, card: id, headingId: z.string().optional() },
  async ({ list, card, headingId }) => {
    await act('addToList', list, card, { sublist: headingId || null });
    return 'done';
  });

tool('remove_from_list', 'Take a card out of one List. The card itself is not deleted.',
  { list: id, card: id },
  async ({ list, card }) => {
    await act('removeFromList', list, card);
    return 'done';
  });

tool('add_heading', 'Add a heading to a card\'s List.',
  { list: id, heading: z.string() },
  async ({ list, heading }) => ({ headingId: await act('addSublist', list, heading) }));

tool('tag_card', 'Add a tag to a card, or remove one.',
  { id, tag: z.string().describe('With or without the leading #'), remove: z.boolean().default(false) },
  async ({ id: cardId, tag, remove }) => {
    await act(remove ? 'untag' : 'tag', cardId, tag);
    return 'done';
  });

tool('relate_cards', 'Record a relationship between two cards, or remove it. The heading names both ends, for example "#Blocking / Blocked": the first name is what the other card is to the owner, the second what the owner is to the other.',
  { owner: id, other: id, heading: z.string().describe('Starts with #'), remove: z.boolean().default(false) },
  async ({ owner, other, heading, remove }) => {
    if (remove) await act('unrelate', owner, other); else await act('relate', owner, other, heading);
    return 'done';
  });

tool('delete_card', 'Move a card to Trash, from where it can be restored for 7 days. Set also_cards_only_in_its_list to delete as well the cards in its List that are in no other List; otherwise they are left and become orphans.',
  { id, also_cards_only_in_its_list: z.boolean().default(false) },
  async ({ id: cardId, also_cards_only_in_its_list: cascade }) => ({ movedToTrash: await act('trash', cardId, { cascade }) }));

tool('restore_card', 'Bring a card back from Trash, with anything deleted along with it.',
  { id },
  async ({ id: cardId }) => ({ restored: await act('restore', cardId) }));

await server.connect(new StdioServerTransport());
