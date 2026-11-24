// ArchiMate Browser: several diagrams open at once, in tabs (BR-15).
//
// Each tab is a document (state.js, newDoc) with its own diagram, drawing,
// manual layout and undo, explorer history, filters, property options and
// layout options. Its drawing stays alive in a panel of its own inside
// #tab-layout, so switching tabs is instant. The URL hash describes the tab
// shown (links share one diagram); the open tabs are kept in sessionStorage
// per model and come back on a reload, drawn when they are first shown.
//
// A diagram opens in the tab shown, as before; "in a new tab" from a menu, or
// a Ctrl- or middle-click on a menu entry or a button of the details pane,
// opens a new one.

import { settings } from '../config.js';
import { t } from '../i18n.js';
import { askConfirm, describeDef, showDocHead, startHint } from './diagram.js';
import { copyText, popupMenu, refreshMarks } from './menus.js';
import { decodeDef, encodeDef, filterPanel, propertyPanel, renderDef, renderLayoutPanel, updateDefaultButtons,
  updateFilterButton, updateLayoutButton } from './panels.js';
import { highlightInDiagrams, modelKey, writeHash } from './routing.js';
import { DiagramFilter } from '../filters.js';
import { PropertyOptions } from '../properties.js';
import { LayoutPrefs } from '../layoutprefs.js';
import { $, newDoc, state } from './state.js';
import { cancelJob, h, status } from './ui.js';

/** Most tabs open at once. */
export const MAX_TABS = 15;

// ---------------------------------------------------------------- "in a new tab" by Ctrl- or middle-click

let newTabUntil = 0;
const NEW_TAB_WINDOW_MS = 3000; // what was clicked starts its diagram within this time (some ask the API first)

/**
 * The next diagram opens in a new tab (a Ctrl- or middle-click on what leads to it; `ms` longer for the
 * "in a new diagram" button of a menu entry, whose action may ask the API first).
 */
export function requestNewTab(ms = NEW_TAB_WINDOW_MS) { newTabUntil = Date.now() + ms; }

/** Whether a new tab has been asked for, without taking the request (addToDiagram: a new diagram then). */
export function newTabRequested() { return Date.now() < newTabUntil; }

/** Whether the diagram about to open goes into a new tab; asking clears the request. */
export function consumeNewTab() {
  const asked = newTabRequested();
  newTabUntil = 0;
  return asked;
}

/** The "in a new diagram" variant of a menu action: what it opens goes into a tab of its own. */
export function inNewTab(action) {
  requestNewTab(15000);
  return action();
}

/**
 * Ctrl-click (Cmd on a Mac) or middle-click on an entry of a menu or a button of the details pane:
 * what it opens goes into a new tab. Installed once, by app.js.
 */
export function installNewTabClicks() {
  const target = ev => ev.target.closest?.('.node-menu button:not(:disabled), #details button:not(:disabled)');
  document.addEventListener('click', ev => {
    if ((ev.ctrlKey || ev.metaKey) && target(ev)) requestNewTab();
  }, true);
  document.addEventListener('auxclick', ev => {
    const button = ev.button === 1 && target(ev);
    if (!button) return;
    ev.preventDefault();
    requestNewTab();
    button.click();
  }, true);
  // a middle-click would start the browser's autoscroll there
  document.addEventListener('mousedown', ev => { if (ev.button === 1 && target(ev)) ev.preventDefault(); }, true);
}

// ---------------------------------------------------------------- documents

/** A document's panel in #tab-layout, made on first use; only the active one is visible. */
export function docPanel(doc) {
  if (!doc.panel) {
    doc.panel = h('div', { class: 'doc-panel', 'data-doc': doc.id });
    doc.panel.hidden = doc !== state.doc;
    $('#tab-layout').append(doc.panel);
  }
  return doc.panel;
}

/** Open a new, empty tab next to the active one (with its filters), and show it; null at the limit. */
export function openDoc({ activate = true } = {}) {
  if (state.docs.length >= MAX_TABS) {
    status(t('At most {n} diagrams can be open; close one first.', { n: MAX_TABS }), true);
    return null;
  }
  const doc = newDoc(state.doc);
  state.docs.splice(state.docs.indexOf(state.doc) + 1, 0, doc);
  docPanel(doc).replaceChildren(h('div', { class: 'placeholder' }, startHint()));
  if (activate) activateDoc(doc);
  else renderDocTabs();
  return doc;
}

/** Show a tab: its drawing, title, info line, filters and options; a restored tab is drawn now. */
export function activateDoc(doc) {
  if (!doc || doc === state.doc) return;
  state.doc = doc;
  for (const d of state.docs) if (d.panel) d.panel.hidden = d !== doc;
  docPanel(doc).hidden = false;
  showDocHead(doc);
  filterPanel.redraw();
  propertyPanel.redraw();
  renderLayoutPanel();
  updateFilterButton();
  updateLayoutButton();
  updateDefaultButtons();
  highlightInDiagrams();
  refreshMarks();
  renderDocTabs();
  if (doc.pending) {
    const { def } = doc.pending;
    renderDef(def, { doc }); // keeps `pending` until it is drawn, for the title meanwhile
  } else writeHash();
}

/** Close a tab; the last one cannot be closed. */
export function closeDoc(doc) {
  if (state.docs.length < 2 || !state.docs.includes(doc)) return;
  doc.renderSeq++;
  doc.layoutSeq++;
  cancelJob(`view:${doc.id}`);
  doc.minimap?.destroy();
  doc.panel?.remove();
  const at = state.docs.indexOf(doc);
  state.docs.splice(at, 1);
  if (state.doc === doc) {
    state.doc = null; // so that the neighbour is activated, not kept
    activateDoc(state.docs[Math.min(at, state.docs.length - 1)]);
  } else renderDocTabs();
}

/**
 * Close tabs after a confirmation (2.19.0), as "Clear diagram" asks: a closed tab cannot be brought back
 * (← Back is the tab's own). Empty tabs close without asking.
 */
export async function askCloseDocs(docs) {
  docs = docs.filter(d => state.docs.includes(d));
  if (!docs.length || state.docs.length - docs.length < 1) return;
  const drawn = docs.filter(d => d.diagramDef || d.pending);
  const title = d => d.diagram?.title || describeDef(d.pending?.def ?? d.diagramDef);
  if (drawn.length && !await askConfirm(drawn.length === 1 && docs.length === 1
    ? t('Close the diagram “{title}”? It cannot be opened again from here.', { title: title(drawn[0]) })
    : t('Close {n} diagrams? They cannot be opened again from here.', { n: docs.length }), t('Close'))) return;
  docs.forEach(closeDoc);
}

/** The same diagram in a new tab: same definition, filters and options (manual positions are shared by it). */
export function duplicateDoc(doc) {
  const def = doc.diagramDef ?? doc.pending?.def;
  if (state.doc !== doc) activateDoc(doc);
  const copy = openDoc();
  if (copy && def) renderDef(structuredClone(def), { doc: copy });
}

// ---------------------------------------------------------------- the tab bar

/**
 * The tab bar above the diagram, also with one diagram (its title, and + for another; 2.16.0). `save: false`
 * leaves the tabs kept for a reload as they are (a model being opened has not restored them yet).
 */
export function renderDocTabs({ save = true } = {}) {
  const bar = $('#doc-tabs');
  if (!bar) return;
  if (save) saveTabs();
  bar.hidden = !state.docs.length;
  if (bar.hidden) { bar.replaceChildren(); return; }
  const single = state.docs.length < 2;
  bar.replaceChildren(...state.docs.map(doc => {
    const title = doc.diagram?.title || (doc.pending || doc.diagramDef ? describeDef(doc.pending?.def ?? doc.diagramDef) : t('Empty diagram'));
    const active = doc === state.doc;
    const tab = h('div', {
      class: active ? 'doc-tab active' : 'doc-tab', role: 'tab', 'aria-selected': String(active), tabindex: active ? 0 : -1,
      title: t('{title} — middle-click closes it, right-click for more', { title }), 'data-doc': doc.id,
    },
      h('span', { class: 'doc-tab-title' }, title),
      single ? null : h('button', { type: 'button', class: 'doc-tab-close', 'aria-label': t('Close {title}', { title }), title: t('Close'),
        onclick: ev => { ev.stopPropagation(); askCloseDocs([doc]); } }, '×'));
    tab.addEventListener('click', () => activateDoc(doc));
    tab.addEventListener('auxclick', ev => { if (ev.button === 1) { ev.preventDefault(); askCloseDocs([doc]); } });
    tab.addEventListener('mousedown', ev => { if (ev.button === 1) ev.preventDefault(); });
    tab.addEventListener('contextmenu', ev => { ev.preventDefault(); openTabMenu(doc, { x: ev.clientX, y: ev.clientY }); });
    tab.addEventListener('keydown', ev => {
      const i = state.docs.indexOf(doc);
      const go = d => { if (d) { activateDoc(d); $(`#doc-tabs [data-doc="${d.id}"]`)?.focus(); } };
      if (ev.key === 'ArrowRight') go(state.docs[i + 1]);
      else if (ev.key === 'ArrowLeft') go(state.docs[i - 1]);
      else if (ev.key === 'Delete') askCloseDocs([doc]);
      else if (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey)) {
        ev.preventDefault();
        const r = tab.getBoundingClientRect();
        openTabMenu(doc, { x: r.left + 8, y: r.bottom + 2 });
      } else return;
      ev.preventDefault();
    });
    return tab;
  }), h('button', { type: 'button', class: 'doc-tab-new', title: t('New empty diagram in a tab of its own'), 'aria-label': t('New tab'),
    onclick: () => newEmptyTab() }, '+'));
}

/** A new tab with an empty diagram, to add elements to. */
export function newEmptyTab() {
  const doc = openDoc();
  if (doc) renderDef({ kind: 'explore', seeds: [], ids: [] }, { doc });
}

function openTabMenu(doc, at) {
  popupMenu(doc.diagram?.title || t('Diagram'), [
    { label: t('Duplicate'), action: () => duplicateDoc(doc) },
    { label: t('Copy link'), action: () => { activateDoc(doc); copyText(location.href, t('Link')); }, disabled: !doc.diagramDef && !doc.pending },
    '-',
    { label: t('Close'), action: () => askCloseDocs([doc]), disabled: state.docs.length < 2 },
    { label: t('Close the others'), action: () => askCloseDocs(state.docs.filter(d => d !== doc)), disabled: state.docs.length < 2 },
  ], at);
}

// ---------------------------------------------------------------- open tabs across a reload

const tabsKey = () => (state.store ? `archixmi-tabs:${settings.apiBase}:${modelKey(state.store.model)}` : null);

/** Keep the open tabs of the model for a reload of the page (sessionStorage: this browser tab only). */
export function saveTabs() {
  const key = tabsKey();
  if (!key) return;
  const tabs = state.docs.map(doc => {
    const def = doc.diagramDef ?? doc.pending?.def;
    return def ? { d: encodeDef(def), f: doc.filter.encode(), p: doc.props.encode(), lo: doc.layoutPrefs.encode() } : null;
  });
  try {
    if (state.docs.length < 2) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify({ active: state.docs.indexOf(state.doc), tabs }));
  } catch { /* storage unavailable: the tabs live for this page only */ }
}

/**
 * After a reload: the tabs that were open, around the one the URL shows (which takes the place of
 * the tab that was shown). The others are drawn when they are first shown.
 */
export function restoreTabs() {
  const key = tabsKey();
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { /* corrupt: none */ }
  if (!saved?.tabs?.length || saved.tabs.length < 2) return;
  const shown = state.doc;
  const docs = saved.tabs.slice(0, MAX_TABS).map((entry, i) => {
    if (i === saved.active) return shown;
    const def = entry?.d ? decodeDef(entry.d) : null;
    if (!def) return null;
    const doc = newDoc(shown);
    doc.filter = DiagramFilter.decode(entry.f || '');
    doc.props = PropertyOptions.decode(entry.p || '');
    doc.layoutPrefs = LayoutPrefs.decode(entry.lo || '');
    doc.pending = { def };
    return doc;
  }).filter(Boolean);
  if (!docs.includes(shown)) docs.unshift(shown);
  state.docs = docs;
  renderDocTabs();
}
