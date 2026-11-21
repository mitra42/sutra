// The Note editor: CodeMirror, showing the Markdown formatted except on the line being edited (spec 3.7).
import { EditorView, EditorState, keymap, placeholder, minimalSetup, markdown, markdownLanguage } from 'codemirror';
import { liveMarkdown } from './live-markdown.js';

// The link under a position in the text: a Markdown link [text](url), an <url>, or a bare
// address (http, https, mailto, web+sutra).
export function linkAt(text, offset) {
  const patterns = [/\[[^\]]*\]\(([^)\s]+)[^)]*\)/g, /<((?:https?|mailto|web\+sutra):[^>\s]+)>/g, /((?:https?:\/\/|mailto:|web\+sutra:)[^\s)<>\]]+)/g];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      if (offset >= m.index && offset <= m.index + m[0].length) return m[1];
    }
  }
  return null;
}

// Opens a link from a Note: a Sutra link in this window, anything else in a new tab.
function follow(url) {
  try {
    const target = new URL(url, location.href);
    if (target.protocol === 'web+sutra:') {
      location.hash = `#/l/${encodeURIComponent(target.pathname.replace(/^\/*/, ''))}/c/${encodeURIComponent(target.pathname.replace(/^\/*/, ''))}`;
      return;
    }
    if (target.origin === location.origin && target.hash) {
      location.hash = target.hash;
      return;
    }
    window.open(target.href, '_blank', 'noopener');
  } catch (err) {
    // Not something that can be opened.
  }
}

function wrap(view, before, after) {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `${before}${text}${after}` },
    selection: { anchor: from + before.length, head: from + before.length + text.length },
  });
  return true;
}

// onSave is called with the text a moment after typing stops, and when the editor loses focus.
export function makeEditor(onSave) {
  let timer;
  let saved = '';
  const save = (view) => {
    clearTimeout(timer);
    const text = view.state.doc.toString();
    if (text !== saved) {
      saved = text;
      onSave(text);
    }
  };
  const view = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: [
        keymap.of([
          { key: 'Mod-b', run: (v) => wrap(v, '**', '**') },
          { key: 'Mod-i', run: (v) => wrap(v, '*', '*') },
          { key: 'Mod-k', run: (v) => wrap(v, '[', '](url)') },
        ]),
        minimalSetup,
        markdown({ base: markdownLanguage }),
        liveMarkdown(follow),
        EditorView.lineWrapping,
        // Cmd-click (Ctrl-click) on a link opens it, on any line. (A plain click opens it too where the
        // line is shown formatted: see live-markdown.js.)
        EditorView.domEventHandlers({
          mousedown: (e, v) => {
            if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return false;
            const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos === null) return false;
            const line = v.state.doc.lineAt(pos);
            const url = linkAt(line.text, pos - line.from);
            if (!url) return false;
            e.preventDefault();
            follow(url);
            return true;
          },
        }),
        EditorView.theme({ '.cm-content': { cursor: 'text' } }),
        placeholder('Note'),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            clearTimeout(timer);
            timer = setTimeout(() => save(update.view), 1000);
          }
          if (update.focusChanged && !update.view.hasFocus) save(update.view);
        }),
      ],
    }),
  });
  return {
    element: view.dom,
    // A different card: its text replaces whatever is here, typed or not. (Call flush first.)
    load(text) {
      clearTimeout(timer);
      saved = text || '';
      const current = view.state.doc.toString();
      if (current !== saved) view.dispatch({ changes: { from: 0, to: current.length, insert: saved } });
    },
    // Shows the stored text, unless it is being typed in right now.
    show(text) {
      const current = view.state.doc.toString();
      if (view.hasFocus && current !== saved) return;
      saved = text || '';
      if (current !== saved) view.dispatch({ changes: { from: 0, to: current.length, insert: saved } });
    },
    flush: () => save(view),
  };
}
