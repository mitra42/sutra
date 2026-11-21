// Shows a Note formatted, the way Obsidian does (spec 3.7): headings big, bold bold, links as
// links, bullets as dots. The Markdown marks (#, **, [ ](…) and so on) are hidden on every line
// except those the cursor is on, where they come back so they can be edited.
// A plain click on a link on a formatted line follows it; Cmd-click works anywhere.
import { EditorView, Decoration, ViewPlugin, WidgetType, syntaxTree } from 'codemirror';

class Bullet extends WidgetType {
  eq() { return true; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-md-bullet';
    span.textContent = '•';
    return span;
  }
}

const hide = Decoration.replace({});
const codeLine = Decoration.line({ class: 'cm-md-codeblock' });
const bullet = Decoration.replace({ widget: new Bullet() });
const styles = {
  ATXHeading1: 'cm-md-h1', ATXHeading2: 'cm-md-h2', ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4', ATXHeading5: 'cm-md-h4', ATXHeading6: 'cm-md-h4',
  StrongEmphasis: 'cm-md-strong', Emphasis: 'cm-md-em', Strikethrough: 'cm-md-strike',
  InlineCode: 'cm-md-code', Link: 'cm-md-link', URL: 'cm-md-link', Blockquote: 'cm-md-quote',
};
const marks = Object.fromEntries(Object.entries(styles).map(([name, cls]) => [name, Decoration.mark({ class: cls })]));
const HIDDEN = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'LinkMark', 'StrikethroughMark', 'QuoteMark']);

// The line numbers the cursor or selection is on, while the editor has focus.
function activeLines(view) {
  const lines = new Set();
  if (!view.hasFocus) return lines;
  for (const range of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(range.from).number;
    const last = view.state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n += 1) lines.add(n);
  }
  return lines;
}

function build(view) {
  const { doc } = view.state;
  const active = activeLines(view);
  const isActive = (pos) => active.has(doc.lineAt(pos).number);
  const found = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter(node) {
        const { name } = node;
        if (name === 'FencedCode' || name === 'CodeBlock') { // code stays as typed, in a fixed-width font
          for (let at = node.from; at <= node.to;) {
            const line = doc.lineAt(at);
            found.push(codeLine.range(line.from));
            at = line.to + 1;
          }
          return false;
        }
        if (name === 'Link' || (name === 'URL' && node.node.parent?.name !== 'Link')) {
          // A link shows where it goes when the pointer rests on it.
          const url = name === 'Link' ? node.node.getChild('URL') : node;
          const address = url ? doc.sliceString(url.from, url.to) : '';
          found.push(Decoration.mark({ class: 'cm-md-link', attributes: address ? { title: address } : {} }).range(node.from, node.to));
        } else if (marks[name] && node.to > node.from) found.push(marks[name].range(node.from, node.to));
        if (isActive(node.from)) return undefined;
        if (HIDDEN.has(name)) {
          // A heading's # takes the space after it with it.
          const end = name === 'HeaderMark' && doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
          if (end > node.from) found.push(hide.range(node.from, end));
        } else if (name === 'URL' && node.node.parent?.name === 'Link') {
          found.push(hide.range(node.from, node.to)); // the address of [text](address)
        } else if (name === 'LinkTitle') {
          found.push(hide.range(node.from, node.to));
        } else if (name === 'ListMark' && /^[-*+]$/.test(doc.sliceString(node.from, node.to))) {
          found.push(bullet.range(node.from, node.to));
        }
        return undefined;
      },
    });
  }
  return Decoration.set(found, true);
}

// The address of the link at a position, if that position's line is shown formatted.
export function formattedLinkAt(view, pos) {
  if (activeLines(view).has(view.state.doc.lineAt(pos).number)) return null;
  for (let node = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'URL' && node.parent?.name !== 'Link') return view.state.doc.sliceString(node.from, node.to);
    if (node.name === 'Autolink' || node.name === 'Link') {
      const url = node.getChild('URL');
      return url ? view.state.doc.sliceString(url.from, url.to) : null;
    }
  }
  return null;
}

export function liveMarkdown(follow) {
  return [
    ViewPlugin.fromClass(class {
      constructor(view) { this.decorations = build(view); }
      update(update) {
        if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
          this.decorations = build(update.view);
        }
      }
    }, { decorations: (plugin) => plugin.decorations }),
    EditorView.domEventHandlers({
      mousedown: (e, view) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return false;
        const url = formattedLinkAt(view, pos);
        if (!url) return false;
        e.preventDefault();
        follow(url);
        return true;
      },
    }),
  ];
}
