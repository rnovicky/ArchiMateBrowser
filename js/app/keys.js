// ArchiMate Browser: keyboard shortcuts (2.19.0; from the action registry since 2.21.0, CM-11).
//
// The keys are those of the actions that have one (actions.js): Delete hides what is
// selected, Backspace goes ← Back, Ctrl+A selects every element, ? lists the keys,
// Ctrl+K opens the commands (palette.js). The diagram's keys act only where they cannot
// mean something else: not while typing, in a dialog or a menu, in the trees (whose
// Delete removes a basket row) or on the tab bar (whose Delete closes the tab).
// The keys of a focused element (arrows, Enter, +, the menu key) are in viewsvg.js;
// Escape is in app.js.

import { t } from '../i18n.js';
import { actionContext, keyedActions, pressed } from './actions.js';
import { hiddenRelsOf, hideElement, setHiddenRels, shownIds } from './diagram.js';
import { nodeMenu } from './menus.js';
import { $, state } from './state.js';
import { h, status } from './ui.js';

/** Where the keys below are left to the page's own handling. */
const ELSEWHERE = 'input, textarea, select, dialog, [contenteditable], .tree, #doc-tabs, .detail-tabs';

/** The keys in the diagram, or with nothing focused (the page itself). */
const inDiagram = target => target === document.body || !!target.closest?.('#tab-layout');

/**
 * Delete: hide from the diagram the element focused in it, else the selected elements shown there,
 * else the element or relationship whose details are shown. ← Back (Backspace) brings them back.
 */
export function hideSelected(target = null) {
  const def = state.diagramDef;
  if (!def) return false;
  if (def.kind === 'view' || !state.gen) {
    status(t('A stored view cannot hide elements; an editable copy of it (its menu) can.'));
    return true;
  }
  const shown = shownIds();
  const focused = Number(target?.closest?.('.v-node[data-element]')?.dataset.element);
  let ids = [...state.marked].filter(id => shown.has(id));
  if (shown.has(focused) && !state.marked.has(focused)) ids = [focused];
  const sel = state.selection;
  if (!ids.length && sel?.kind === 'element' && shown.has(sel.id)) ids = [sel.id];
  if (ids.length) {
    hideElement(ids);
    status(t('{n} element(s) hidden; Backspace or ← Back shows them again.', { n: ids.length }));
    return true;
  }
  if (sel?.kind === 'relationship' && state.layout?.svg.querySelector(`[data-relationship="${sel.id}"]`)) {
    setHiddenRels([...hiddenRelsOf(def), sel.id]);
    status(t('Relationship hidden; Backspace or ← Back shows it again.'));
    return true;
  }
  return false;
}

/** The keys, as a list (the ? key, and "Keyboard shortcuts" in the diagram's menu). */
export function showShortcuts() {
  let dialog = $('#keys-dialog');
  if (!dialog) {
    dialog = h('dialog', { id: 'keys-dialog', 'aria-labelledby': 'keys-title' });
    document.body.append(dialog);
  }
  const rows = list => h('table', { class: 'keys' }, list.map(([keys, what]) => h('tr', {}, h('th', {}, keys.flatMap((k, i) => [i ? ' ' : '', h('kbd', {}, k)])), h('td', {}, what))));
  dialog.replaceChildren(h('form', { method: 'dialog' },
    h('h2', { id: 'keys-title' }, t('Keyboard shortcuts')),
    h('h3', {}, t('Diagram')),
    rows([
      ...keyedActions().filter(a => a.key.scope === 'diagram').map(a => [a.key.keys, a.key.help]),
      [['Esc'], t('Clear the highlighted path, then the selection')],
      [['Tab'], t('Into the drawing; then the arrow keys move from element to element')],
      [['Enter'], t('Details of the focused element')],
      [['+'], t('Show the related elements of the focused element')],
      [['Shift', 'F10'], t('Menu of the focused element (or the menu key)')],
    ]),
    h('h3', {}, t('Tabs and menus')),
    rows([
      [['←', '→'], t('Move between the diagram tabs, or the tabs of the details')],
      [['Delete'], t('Close the focused diagram tab (asks first)')],
      [['Ctrl', 'click'], t('On a menu entry: open the diagram in a new tab; on an element: add it to the selection')],
      ...keyedActions().filter(a => a.key.scope !== 'diagram').map(a => [a.key.keys, a.key.help]),
    ]),
    h('menu', {}, h('button', { value: 'close', class: 'primary' }, t('Close')))));
  dialog.showModal();
}

/**
 * Installed once, by app.js. An action's key works where its scope says: 'diagram' in the diagram or with
 * nothing focused, 'page' anywhere but where the page's own keys are (ELSEWHERE), 'anywhere' also while
 * typing (not in a dialog). An action that does nothing (returns false) leaves the key to the browser.
 */
export function installKeys() {
  document.addEventListener('keydown', ev => {
    if (nodeMenu || ev.defaultPrevented || ev.altKey) return;
    const a = keyedActions().find(x => pressed(x, ev));
    if (!a) return;
    const scope = a.key.scope;
    if (ev.target.closest?.(scope === 'anywhere' ? 'dialog' : ELSEWHERE)) return;
    if (scope === 'diagram' && !inDiagram(ev.target)) return;
    const c = actionContext('diagram', null, { target: ev.target });
    if (a.when && !a.when(c)) return;
    if (a.run(c) !== false) ev.preventDefault();
  });
}
