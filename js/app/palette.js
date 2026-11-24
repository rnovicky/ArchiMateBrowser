// ArchiMate Browser: the commands (CM-11, 2.21.0), Ctrl+K or the ⌘ button by the search.
//
// Type to find an element, a relationship or a view of the model (the API's search) or a command of the
// diagram and the model; choose an item to see its actions, and choose one to run it. The actions are
// those of its menus and its details (actions.js). ↑/↓ choose, Enter runs, Ctrl+Enter opens a diagram in a
// new tab, Backspace in the empty field goes back from an item to the search, Escape closes.

import { api, isAbort } from '../api.js';
import { t } from '../i18n.js';
import { prettyType } from '../archimate.js';
import { isCreated } from '../viewcontent.js';
import { actionContext, applicable, menuEntry } from './actions.js';
import { relBadge, typeBadge } from './details.js';
import { relationshipForMenu } from './menus.js';
import { $, state } from './state.js';
import { inNewTab } from './tabs.js';
import { errorMessage, h, status } from './ui.js';

const FOUND = 8; // items of each kind
let seq = 0;

/** Does `text` hold every word of the query (case and accents ignored)? */
const fold = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const matches = (text, query) => fold(query).split(/\s+/).filter(Boolean).every(w => fold(text).includes(w));

/** The item of a search hit or the selection, with what its actions need, as an action context. */
async function itemContext(kind, id) {
  const s = state.store;
  if (kind === 'element') {
    await s.ensure({ elements: [id] });
    return s.element(id) ? actionContext('element', s.element(id), { selectOpts: {} }) : null;
  }
  if (kind === 'relationship') {
    const { r, attached } = await relationshipForMenu(id);
    return r ? actionContext('relationship', r, { selectOpts: {}, attached }) : null;
  }
  if (kind === 'view') return s.view(id) ? actionContext('view', s.view(id), { selectOpts: {} }) : null;
  if (kind === 'folder') {
    const f = s.folders?.byId.get(id);
    return f ? actionContext('folder', f, { selectOpts: {} }) : null;
  }
  return null;
}

const itemName = (kind, item) => (kind === 'relationship' ? `${item.type}: ${state.store.relationshipLabel(item)}`
  : item.name || item.label || t('(unnamed {type})', { type: prettyType(item.type || '') }));
const itemIcon = (kind, item) => (kind === 'element' ? typeBadge(item.type) : kind === 'relationship' ? relBadge(item)
  : h('span', { class: 'palette-icon' }, kind === 'view' ? (isCreated(item) ? '✎' : '🖼') : '📁'));

/** Open the commands. */
export function openPalette() {
  if (!state.store) { status(t('Open a model first.')); return; }
  let dialog = $('#palette-dialog');
  if (!dialog) {
    dialog = h('dialog', { id: 'palette-dialog', class: 'palette', 'aria-label': t('Commands') });
    document.body.append(dialog);
  }
  const input = h('input', {
    type: 'text', role: 'combobox', 'aria-controls': 'palette-list', 'aria-expanded': 'true', 'aria-autocomplete': 'list',
    autocomplete: 'off', spellcheck: 'false', 'aria-label': t('Find an item or a command'),
  });
  const crumb = h('span', { class: 'palette-crumb', hidden: true });
  const list = h('ul', { id: 'palette-list', role: 'listbox', 'aria-label': t('Commands') });
  dialog.replaceChildren(
    h('div', { class: 'palette-head' }, crumb, input),
    list,
    h('p', { class: 'palette-hint' }, t('↑↓ choose · Enter runs · Ctrl+Enter: in a new tab · Backspace: back · Esc closes')));

  let item = null; // the context whose actions are shown, or null: the search
  let rows = [], active = 0, found = [];

  const run = async (row, ev) => {
    if (!row || row.disabled) return;
    if (row.open) { // an item: its actions
      try {
        const c = await row.open();
        if (!c) return;
        item = { c, name: row.label };
        input.value = '';
        draw();
      } catch (e) { if (!isAbort(e)) status(errorMessage(e), true); }
      return;
    }
    dialog.close();
    const go = () => row.entry.action();
    try {
      if (row.entry.newTab && (ev?.ctrlKey || ev?.metaKey)) await inNewTab(go); else await go();
    } catch (e) { status(errorMessage(e), true); }
  };

  const draw = () => {
    const q = input.value.trim();
    crumb.hidden = !item;
    crumb.textContent = item ? item.name : '';
    input.placeholder = item ? t('Filter its actions…') : t('Find an element, a relationship, a view or a command…');
    if (item) {
      rows = applicable(item.c, { where: 'palette' }).map(a => ({ entry: menuEntry(a, item.c) }))
        .filter(r => !r.entry.disabled && matches(r.entry.label, q))
        .map(r => ({ ...r, label: r.entry.label, hint: r.entry.count ? `+${r.entry.count}` : r.entry.note ?? (r.entry.newTab ? '⧉' : '') }));
    } else {
      const sel = state.selection;
      const selected = !q && sel && ['element', 'relationship', 'view', 'folder'].includes(sel.kind)
        && (sel.kind === 'element' ? state.store.element(sel.id) : sel.kind === 'relationship' ? state.store.relationship(sel.id)
          : sel.kind === 'view' ? state.store.view(sel.id) : state.store.folders?.byId.get(sel.id));
      const commands = [actionContext('diagram', null), actionContext('model', state.store.model)]
        .flatMap(c => applicable(c, { where: 'palette' }).map(a => ({ entry: menuEntry(a, c) })))
        .filter(r => !r.entry.disabled && matches(r.entry.label, q))
        .map(r => ({ ...r, label: r.entry.label, hint: r.entry.note ?? '' }));
      rows = [
        selected ? { label: itemName(sel.kind, selected), icon: itemIcon(sel.kind, selected), hint: t('selected'), open: () => itemContext(sel.kind, sel.id) } : null,
        ...commands,
        ...found.map(f => ({ label: itemName(f.kind, f.item), icon: itemIcon(f.kind, f.item), hint: f.kind === 'element' ? prettyType(f.item.type) : '', open: () => itemContext(f.kind, f.item.id) })),
      ].filter(Boolean);
    }
    active = Math.min(active, Math.max(0, rows.length - 1));
    list.replaceChildren(...(rows.length ? rows.map((r, i) => h('li', {
      id: `palette-row-${i}`, role: 'option', 'aria-selected': String(i === active), class: r.open ? 'palette-item' : null,
      onclick: ev => run(r, ev), onmousemove: () => { if (active !== i) { active = i; mark(); } },
    }, r.icon ?? null, h('span', { class: 'palette-label' }, r.label), r.open ? h('span', { class: 'palette-more' }, '›') : null,
    r.hint ? h('span', { class: 'palette-hint-right' }, String(r.hint)) : null))
      : [h('li', { class: 'palette-empty', role: 'presentation' }, q.length >= 2 || item ? t('Nothing found.') : t('Type to find an item of the model.'))]));
    mark();
  };

  const mark = () => {
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    const li = list.children[active];
    if (li?.id) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };

  // the API's search, a moment after the typing stops; a newer search makes an older answer go
  let timer = null;
  const search = () => {
    clearTimeout(timer);
    const q = input.value.trim();
    const mine = ++seq;
    if (item || q.length < 2) { found = []; draw(); return; }
    draw();
    timer = setTimeout(async () => {
      try {
        const res = await api.search(state.store.id, { q, kinds: 'elements,relationships,views', limit: FOUND });
        if (mine !== seq) return;
        const s = state.store;
        await s.ensure({ relationships: (res.relationships?.items || []).map(r => r.id) }); // their ends, for their names
        if (mine !== seq) return;
        found = [
          ...(res.elements?.items || []).map(e => ({ kind: 'element', item: s.element(e.id) || e })),
          ...(res.relationships?.items || []).map(r => ({ kind: 'relationship', item: s.relationship(r.id) || r })),
          ...(res.views?.items || []).map(v => ({ kind: 'view', item: s.view(v.id) || v })),
        ];
        active = 0;
        draw();
      } catch (e) {
        if (mine === seq && !isAbort(e)) status(errorMessage(e), true);
      }
    }, 150);
  };

  input.addEventListener('input', () => { active = 0; search(); });
  input.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (rows.length) { active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; mark(); }
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      run(rows[active], ev);
    } else if (ev.key === 'Backspace' && !input.value && item) {
      ev.preventDefault();
      item = null;
      active = 0;
      search();
    }
  });
  dialog.addEventListener('close', () => { clearTimeout(timer); seq++; }, { once: true });
  draw();
  dialog.showModal();
  input.focus();
}
