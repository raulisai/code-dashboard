import React, {useEffect, useRef} from 'react';
import {EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars} from '@codemirror/view';
import {EditorState} from '@codemirror/state';
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle} from '@codemirror/language';
import {highlightSelectionMatches, searchKeymap} from '@codemirror/search';
import {autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap} from '@codemirror/autocomplete';
import {oneDark} from '@codemirror/theme-one-dark';
import {javascript} from '@codemirror/lang-javascript';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {python} from '@codemirror/lang-python';
import {json} from '@codemirror/lang-json';
import {markdown} from '@codemirror/lang-markdown';
import {yaml} from '@codemirror/lang-yaml';

function language(path) {
  const ext = String(path).split('.').pop().toLowerCase();
  const base = String(path).split('/').pop().toLowerCase();
  if (['js', 'mjs', 'cjs'].includes(ext)) return javascript();
  if (ext === 'jsx') return javascript({jsx: true});
  if (ext === 'ts') return javascript({typescript: true});
  if (ext === 'tsx') return javascript({jsx: true, typescript: true});
  if (['html', 'htm', 'vue', 'svelte'].includes(ext)) return html();
  if (['css', 'scss', 'less'].includes(ext)) return css();
  if (ext === 'py') return python();
  if (['json', 'webmanifest'].includes(ext)) return json();
  if (['md', 'markdown'].includes(ext)) return markdown();
  if (['yml', 'yaml'].includes(ext) || base === 'compose.yaml') return yaml();
  return [];
}

const theme = EditorView.theme({
  '&': {height: '100%', fontSize: '13.5px', backgroundColor: 'var(--bg)'},
  '.cm-scroller': {fontFamily: 'var(--mono)', lineHeight: '1.55'},
  '.cm-gutters': {backgroundColor: 'var(--bg)', borderRight: '1px solid var(--line)'},
  '.cm-content': {paddingBottom: '40vh'},
});

export default function Editor({path, value, readOnly = false, onChange, onSave}) {
  const host = useRef(null), view = useRef(null);
  const handlers = useRef({onChange, onSave});
  handlers.current = {onChange, onSave};
  useEffect(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
        lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(), drawSelection(), indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, {fallback: true}), bracketMatching(), closeBrackets(), autocompletion(), highlightActiveLine(), highlightSelectionMatches(),
        keymap.of([{key: 'Mod-s', preventDefault: true, run: () => { handlers.current.onSave?.(); return true; }}, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
        language(path), oneDark, theme, EditorView.lineWrapping,
        EditorView.updateListener.of(update => { if (update.docChanged) handlers.current.onChange?.(update.state.doc.toString()); }),
      ],
    });
    view.current = new EditorView({state, parent: host.current});
    return () => view.current?.destroy();
  }, [path, readOnly]);
  // Si el archivo se recarga desde el servidor, reemplazar el contenido sin recrear el editor.
  useEffect(() => {
    const current = view.current;
    if (current && current.state.doc.toString() !== value) current.dispatch({changes: {from: 0, to: current.state.doc.length, insert: value}});
  }, [value]);
  return <div className="cm-host" ref={host}/>;
}
