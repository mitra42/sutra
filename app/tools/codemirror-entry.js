// The parts of CodeMirror that Sutra uses, gathered so they can be combined into one file.
// Run "npm install" then "npm run codemirror" in this folder; it rewrites ../vendor/codemirror.js.
// Only needed when CodeMirror itself is to be updated, or another part of it is wanted.
export { EditorView, keymap, placeholder, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
export { EditorState, RangeSetBuilder } from '@codemirror/state';
export { syntaxTree } from '@codemirror/language';
export { minimalSetup } from 'codemirror';
export { markdown, markdownLanguage } from '@codemirror/lang-markdown';
