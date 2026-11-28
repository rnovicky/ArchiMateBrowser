// 2.35.0: the editor of recipe scripts, shared by the recipe script dialog and "Edit as script…" (scriptdialog.js).
// A textarea with, behind it, the same text coloured (keywords, types, texts, properties, comments); line numbers that
// mark the lines with errors; a check a moment after typing stops; completion of keywords, types, layers, viewpoints
// and property names (as you type, or Ctrl+Space); and indentation kept on Enter. The language: the API's
// RECIPE_SCRIPTS.md; the tokens follow its app/services/recipe_script/syntax.py.

import { t } from '../i18n.js';
import { OPENS_BLOCK, completions, highlightLine } from '../scriptlang.js';

const AUTO_CHECK_MS = 900; // a check this long after typing stops
import { state } from './state.js';
import { h } from './ui.js';

/**
 * The editor. `onChange` after every change; `onCheck` for Ctrl+Enter; `onAutoCheck` a moment after typing stops.
 * Returns the textarea, the box to insert, goToLine(n), setText(text) and markErrors(problems).
 */
export function scriptEditor(text, { onChange = () => {}, onCheck = () => {}, onAutoCheck = null } = {}) {
  const editor = h('textarea', {
    id: 'script-text', spellcheck: false, autocomplete: 'off', wrap: 'off', rows: 18,
    'aria-label': t('Recipe script'), 'aria-describedby': 'script-help', 'aria-autocomplete': 'list',
  });
  editor.value = text;
  const gutter = h('div', { class: 'script-gutter', 'aria-hidden': 'true' });
  const shown = h('pre', { class: 'script-highlight', 'aria-hidden': 'true' });
  const popup = h('ul', { class: 'script-complete', role: 'listbox', hidden: true, 'aria-label': t('Suggestions') });
  const code = h('div', { class: 'script-code' }, shown, editor, popup);
  let errors = new Map(); // line -> message
  let timer = null, choices = [], chosen = 0, replaceFrom = 0;

  const paint = () => {
    const lines = editor.value.split('\n');
    shown.innerHTML = lines.map(highlightLine).join('\n') + '\n';
    gutter.replaceChildren(...lines.map((_, i) => {
      const message = errors.get(i + 1);
      return h('div', { class: message ? 'bad' : null, title: message || null }, String(i + 1));
    }));
    sync();
  };
  const sync = () => {
    shown.scrollTop = editor.scrollTop;
    shown.scrollLeft = editor.scrollLeft;
    gutter.scrollTop = editor.scrollTop;
  };
  const changed = ({ auto = true } = {}) => {
    paint();
    onChange();
    if (onAutoCheck && auto) {
      clearTimeout(timer);
      timer = setTimeout(() => { if (editor.isConnected) onAutoCheck(); }, AUTO_CHECK_MS);
    }
  };

  const goToLine = line => {
    const lines = editor.value.split('\n');
    const start = lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0);
    editor.focus();
    editor.setSelectionRange(start, start + (lines[line - 1] || '').length);
    const lineHeight = editor.scrollHeight / Math.max(1, lines.length);
    editor.scrollTop = Math.max(0, (line - 4) * lineHeight);
    sync();
  };
  const setText = value => { editor.value = value; closePopup(); changed({ auto: false }); };
  const markErrors = problems => {
    errors = new Map();
    for (const p of problems || []) if (!errors.has(p.line)) errors.set(p.line, p.message);
    paint();
  };

  // ---------------------------------------------------------- completion
  const closePopup = () => { popup.hidden = true; choices = []; editor.removeAttribute('aria-activedescendant'); };
  const wordBefore = () => {
    const pos = editor.selectionStart, before = editor.value.slice(0, pos);
    const m = /(@)?([\p{L}_][\p{L}\d_-]*|)$/u.exec(before);
    return { prop: !!m[1], prefix: m[2], from: pos - m[2].length - (m[1] ? 1 : 0) };
  };
  const properties = () => [...(state.store?.propertyIndex?.keys() || [])].sort((a, b) => a.localeCompare(b));
  const openPopup = (force = false) => {
    if (editor.selectionStart !== editor.selectionEnd) return closePopup();
    const w = wordBefore();
    if (!w.prop && !force && w.prefix.length < 2) return closePopup();
    if (insideString()) return closePopup();
    choices = completions(w.prefix, { prop: w.prop, properties: properties() });
    if (!choices.length) return closePopup();
    replaceFrom = w.from;
    chosen = 0;
    renderPopup();
    placePopup();
    popup.hidden = false;
  };
  const insideString = () => {
    const line = editor.value.slice(0, editor.selectionStart).split('\n').pop();
    return ((line.match(/"/g) || []).length % 2) === 1;
  };
  const renderPopup = () => {
    popup.replaceChildren(...choices.map((c, i) => h('li', {
      id: `script-complete-${i}`, role: 'option', 'aria-selected': i === chosen ? 'true' : 'false', class: i === chosen ? 'on' : null,
      onmousedown: ev => { ev.preventDefault(); chosen = i; accept(); },
    }, c.label)));
    editor.setAttribute('aria-activedescendant', `script-complete-${chosen}`);
  };
  const placePopup = () => {
    const style = getComputedStyle(editor);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${style.fontSize} ${style.fontFamily}`;
    const charWidth = ctx.measureText('M').width || 8;
    const lineHeight = parseFloat(style.lineHeight) || 19;
    const before = editor.value.slice(0, replaceFrom).split('\n');
    const row = before.length, col = before[before.length - 1].length;
    popup.style.left = `${Math.max(0, parseFloat(style.paddingLeft) + col * charWidth - editor.scrollLeft)}px`;
    popup.style.top = `${parseFloat(style.paddingTop) + row * lineHeight - editor.scrollTop + 2}px`;
  };
  const accept = () => {
    const c = choices[chosen];
    if (!c) return;
    const w = wordBefore();
    const from = w.prop ? w.from + 1 : w.from;
    editor.setRangeText(c.insert, from, editor.selectionStart, 'end');
    closePopup();
    changed();
  };

  // ---------------------------------------------------------- keys
  editor.addEventListener('input', ev => {
    changed();
    if (ev.inputType?.startsWith('insert') && !ev.inputType.includes('LineBreak')) openPopup();
    else closePopup();
  });
  editor.addEventListener('scroll', () => { sync(); if (!popup.hidden) placePopup(); });
  editor.addEventListener('blur', () => setTimeout(closePopup, 150));
  editor.addEventListener('click', closePopup);
  editor.addEventListener('keydown', ev => {
    if (!popup.hidden) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        chosen = (chosen + (ev.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
        renderPopup();
        return;
      }
      if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); accept(); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closePopup(); return; }
    }
    if (ev.key === ' ' && ev.ctrlKey) { ev.preventDefault(); openPopup(true); return; }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); clearTimeout(timer); onCheck(); return; }
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.altKey) { // the indentation of the line, two more under a block
      ev.preventDefault();
      const line = editor.value.slice(0, editor.selectionStart).split('\n').pop();
      const indent = /^\s*/.exec(line)[0] + (OPENS_BLOCK.test(line.trim()) ? '  ' : '');
      editor.setRangeText('\n' + indent, editor.selectionStart, editor.selectionEnd, 'end');
      changed();
      return;
    }
    if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey) { // two spaces: indentation is meaningful here
      ev.preventDefault();
      const start = editor.value.lastIndexOf('\n', editor.selectionStart - 1) + 1;
      if (ev.shiftKey) {
        const take = /^ {0,2}/.exec(editor.value.slice(start))[0].length;
        if (take) {
          const caret = editor.selectionStart;
          editor.setRangeText('', start, start + take, 'preserve');
          editor.setSelectionRange(Math.max(start, caret - take), Math.max(start, caret - take));
        }
      } else editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
      changed();
    }
  });

  paint();
  return { editor, box: h('div', { class: 'script-editor' }, gutter, code), goToLine, setText, markErrors };
}
