// ArchiMate Browser: Popup menus, details pane menus (CM-1), multi-selection (CM-6), legend and filter chips (CM-7), diagram chrome (CM-8).
// Part of js/app.js until 2026-10-24 (EN-6); app.js wires it to the page.

import { olderThan } from '../api.js';
import { settings, saveSettings } from '../config.js';
import { t } from '../i18n.js';
import { LAYERS, ELEMENT_TYPES, RELATIONSHIP_TYPES, typesOfLayer, prettyType } from '../archimate.js';
import { DiagramFilter, VIEWPOINTS } from '../filters.js';
import { PropertyOptions, NOT_SET } from '../properties.js';
import { pathTo } from '../impact.js';
import { VIEW_SHOWING, actionContext, actionEntries } from './actions.js';
import { addViewToBasket, allElementIds, basketAdd, basketTree, layerElementIds, relTypeEndIds, relTypeList, updateBasket } from './basket.js';
import { fill, impactOptions, renderDetails } from './details.js';
import {
  addToDiagram, automaticLayout, collapseAndShowLevel, collapseEntry, dragElementIds, editableCopy, expandElement, exploreFrom, hiddenRelsOf,
  hideElement, inDiagram, nodeElementPositions, openBackMenu, setHiddenRels, showView, viewElementPositions,
} from './diagram.js';
import { runSearch, searchTree, tree } from './models.js';
import {
  drillToView, filterPanel, renderDef, setFilter, setPropertyOptions, showElements, showNeighbourhood, showPaths,
} from './panels.js';
import { revealInTree, select } from './routing.js';
import { $, state } from './state.js';
import { inNewTab } from './tabs.js';
import { errorMessage, h, status } from './ui.js';

// ---------------------------------------------------------------- popup menus (diagram elements, tree items)
export let nodeMenu = null;
export let menuReturnFocus = null; // where focus goes back to when the menu closes without an action

export function closeNodeMenu({ restoreFocus = false } = {}) {
  nodeMenu?.remove();
  nodeMenu = null;
  if (restoreFocus) menuReturnFocus?.focus();
  menuReturnFocus = null;
}

/**
 * Show a popup menu at {x, y} (client coordinates).
 * entries: { label, count?, note?, action, disabled?, title? } or '-' (separator), in nested lists; null/false are skipped.
 * count: shown on the right ("+N", what the item adds; 0 disables the item).
 * note: a plain number or text on the right (how many it acts on; 0 disables the item).
 * submenu: [entries] instead of an action: the item opens them below itself, inside the menu (CM-10, 2.27.0).
 */
export function popupMenu(title, entries, at, { returnFocus = null } = {}) {
  closeNodeMenu();
  const list = entries.flat(Infinity).filter(Boolean);
  nodeMenu = h('div', { class: 'node-menu', role: 'menu', 'aria-label': t('Actions for {title}', { title }) },
    h('div', { class: 'menu-title' }, title),
    list.map((e, i) => (e === '-'
      ? (i > 0 && list[i - 1] !== '-' && i < list.length - 1 ? h('hr') : null)
      : menuEntry(e))));
  document.body.appendChild(nodeMenu);
  menuReturnFocus = returnFocus;
  const r = nodeMenu.getBoundingClientRect();
  nodeMenu.style.left = `${Math.max(4, Math.min(at.x, innerWidth - r.width - 4))}px`;
  nodeMenu.style.top = `${Math.max(4, Math.min(at.y, innerHeight - r.height - 4))}px`;
  nodeMenu.querySelector('button:not(:disabled)')?.focus();
}

/**
 * One entry of a popup menu. An entry with `newTab: true` opens a diagram; it gets a second button at the
 * end of its row, "in a new diagram", that opens it in a tab of its own (2.16.0).
 */
function menuEntry(e) {
  if (e.submenu) return submenuEntry(e);
  const disabled = e.disabled || e.count === 0 || e.note === 0;
  const main = h('button', {
    type: 'button', role: 'menuitem', disabled, title: e.title,
    onclick: () => { closeNodeMenu(); e.action(); },
  }, h('span', {}, e.label),
  e.count != null ? h('span', { class: 'count' }, e.count ? `+${e.count}` : '0')
    : e.note != null ? h('span', { class: 'count note' }, String(e.note)) : null);
  if (!e.newTab) return main;
  const label = e.label.replace(/^✓ /, '');
  return h('div', { class: 'menu-row' }, main, h('button', {
    type: 'button', role: 'menuitem', class: 'menu-new-tab', disabled,
    title: t('{action} — in a new diagram', { action: label }), 'aria-label': t('{action} — in a new diagram', { action: label }),
    onclick: () => { closeNodeMenu(); inNewTab(e.action); },
  }, '⧉'));
}

/** CM-10 (2.27.0): an item that opens its entries below itself (→ and ← from the keyboard, app.js). */
function submenuEntry(e) {
  const items = e.submenu.flat(Infinity).filter(Boolean);
  const group = h('div', { class: 'submenu', role: 'group', 'aria-label': e.label, hidden: true },
    items.map(x => (x === '-' ? h('hr') : menuEntry(x))));
  const opener = h('button', {
    type: 'button', role: 'menuitem', class: 'submenu-opener', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    disabled: !items.some(x => x !== '-'),
    onclick: () => {
      group.hidden = !group.hidden;
      opener.setAttribute('aria-expanded', String(!group.hidden));
      keepInWindow();
    },
  }, h('span', {}, e.label), e.count != null ? h('span', { class: 'count' }, `+${e.count}`) : h('span', { class: 'count note' }, '▸'));
  return h('div', { class: 'submenu-wrap' }, opener, group);
}

/** The open menu moved up when it grew below the window (a submenu opened). */
function keepInWindow() {
  if (!nodeMenu) return;
  const r = nodeMenu.getBoundingClientRect();
  if (r.bottom > innerHeight - 4) nodeMenu.style.top = `${Math.max(4, innerHeight - r.height - 4)}px`;
}

// More relationship types than this in a diagram element's menu go into a submenu (CM-10)
const TYPES_INLINE = 6;

/** Right-click menu on a diagram element (explorer actions). */
export function openNodeMenu(id, ev) {
  const s = state.store, el = s.element(id);
  if (!el || !state.gen) return;
  if (selectionMenuFor(id, { x: ev.clientX, y: ev.clientY })) return;
  // HLP-5: counted by the API when the diagram was drawn
  const c = state.counts.get(id) || { total: 0, out: 0, in: 0, byType: [] };
  const count = direction => (direction === 'out' ? c.out : direction === 'in' ? c.in : c.total);
  const byType = c.byType || [];
  popupMenu(el.name || t('(unnamed {type})', { type: prettyType(el.type) }), [
    { label: t('Show all related'), count: count('both'), action: () => expandElement(id, { direction: 'both' }) },
    { label: t('Show outgoing →'), count: count('out'), action: () => expandElement(id, { direction: 'out' }) },
    { label: t('Show incoming ←'), count: count('in'), action: () => expandElement(id, { direction: 'in' }) },
    '-',
    (entries => (entries.length > TYPES_INLINE
      ? { label: t('Show by relationship type'), count: c.total, submenu: entries }
      : entries))(byType.map(bt => ({
      label: bt.direction === 'out' ? `${bt.type} →` : `← ${bt.type}`, count: bt.count,
      action: () => expandElement(id, { direction: bt.direction, type: bt.type }),
    }))),
    '-',
    { label: t('Hide from diagram'), note: 'Del', action: () => hideElement(id) },
    collapseEntry(id),
    // 2.28.0: collapse and show the next level in one step
    { label: t('Collapse and show one level'), title: t('Fold away what hangs off this element, then show its directly related elements; ← Back undoes it'),
      action: () => collapseAndShowLevel(id) },
    '-',
    // the general element actions (as in the tree), without the diagram ones above
    elementMenuEntries(el, { diagramActions: false, selectOpts: {} }),
  ], { x: ev.clientX, y: ev.clientY });
}

/** Right-click menu on an element of a stored view: the general element actions (+ its drill-down link). */
export function openViewNodeMenu(id, ev, node = null) {
  const s = state.store, el = s?.element(id);
  if (!el) return;
  if (selectionMenuFor(id, { x: ev.clientX, y: ev.clientY })) return;
  const target = node?.viewRefId != null ? s.view(node.viewRefId) : null;
  popupMenu(el.name || t('(unnamed {type})', { type: prettyType(el.type) }), [
    target ? [{ label: t('Open linked view “{name}”', { name: target.name }), action: () => drillToView(target.id) }, '-'] : null,
    elementMenuEntries(el, { selectOpts: {} }),
  ], { x: ev.clientX, y: ev.clientY });
}

/**
 * Right-click menu on a stored-view node without an element (CM-4): drill-down
 * links, groups/containers, labels and notes. Offers what the node has: its
 * linked view, the elements nested in it, its text, the concept it refers to.
 * Returns false (no menu → background menu) when there is nothing to offer.
 */
export function openViewOtherNodeMenu(node, ev) {
  const s = state.store;
  if (!s) return false;
  const target = node.viewRefId != null ? s.view(node.viewRefId) : null;
  const shape = nodeElementPositions(node.children || [], { x: node.x, y: node.y, w: node.w, h: node.h });
  const inside = [...shape.keys()];
  const text = (node.label || '').trim();
  const conceptEl = node.conceptRefElementId != null ? s.element(node.conceptRefElementId) : null;
  const conceptRel = node.conceptRefRelationshipId != null ? s.relationship(node.conceptRefRelationshipId) : null;
  const what = target ? t('Link') : node.type === 'Container' || inside.length ? t('Group') : t('Note');
  const short = str => (str.length > 40 ? str.slice(0, 39) + '…' : str);

  const entries = [
    target ? [
      { label: t('Open view “{name}”', { name: short(target.name) }), action: () => drillToView(target.id) },
      { label: t('View details'), action: () => select('view', target.id, { reveal: false }) },
      { newTab: true, label: t('Editable copy of that view (keeps its arrangement)'), action: () => editableCopy(target.id) },
      { newTab: true, label: t('Automatic layout of its elements'), action: () => automaticLayout(target.id) },
      { label: t('Add its elements to basket'), action: () => addViewToBasket(target.id) },
      '-',
    ] : null,
    inside.length ? [
      { newTab: true, label: t('Diagram of the {n} element inside|Diagram of the {n} elements inside', { n: inside.length }), action: () => showElements(inside, t('{name}: nested elements', { name: text || t('Group') })) },
      { newTab: true, label: t('Editable copy of the group (keeps the arrangement)'), action: () => addToDiagram(inside, { label: t('group “{name}”', { name: text || t('group') }), shape }) },
      { label: t('Add the {n} element inside to basket|Add the {n} elements inside to basket', { n: inside.length }), action: () => { inside.forEach(x => state.basket.add(x)); updateBasket(); status(t('{n} element(s) in the basket.', { n: inside.length })); } },
      '-',
    ] : null,
    conceptEl ? { label: t('Details of “{name}”', { name: short(conceptEl.name || prettyType(conceptEl.type)) }), action: () => select('element', conceptEl.id) } : null,
    conceptRel ? { label: t('Details of the {type} relationship', { type: conceptRel.type }), action: () => select('relationship', conceptRel.id) } : null,
    text ? { label: t('Copy text'), action: () => copyText(text, t('Text')) } : null,
    node.documentation ? { label: t('Copy documentation'), action: () => copyText(node.documentation, t('Documentation')) } : null,
  ];
  if (!entries.flat().some(e => e && e !== '-')) return false;
  popupMenu(`${what}${text ? `: ${short(text.replace(/\s+/g, ' '))}` : ''}`, entries, { x: ev.clientX, y: ev.clientY });
  return true;
}

/**
 * Context menu on any element: right-click, or the Context Menu key /
 * Shift+F10 while it has focus (the menu then opens below it).
 */
export function withContextMenu(el, open) {
  el.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); open({ x: ev.clientX, y: ev.clientY }); });
  el.addEventListener('keydown', ev => {
    if (ev.target !== el || !(ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey))) return;
    ev.preventDefault();
    const r = el.getBoundingClientRect();
    open({ x: r.left + 8, y: r.bottom + 2 });
  });
  return el;
}

/** Context menu of the basket as a whole ("Basket: N elements"). */
export function openBasketMenu(at) {
  const ids = [...state.basket];
  if (!ids.length || !state.store) return;
  popupMenu(t('Basket ({n} element)|Basket ({n} elements)', { n: ids.length }), actionEntries(actionContext('basket', null, { ids })), at, { returnFocus: $('#basket-label') });
}

/**
 * Right-click on the diagram background (CM-3): view, layout, diagram and
 * export actions (actions.js); for stored views also view actions. Zooming centres
 * on the clicked point, "Add basket here" drops the basket there.
 */
export function openCanvasMenu(ev) {
  const layout = state.layout, def = state.diagramDef, s = state.store;
  if (!layout || !def || !s) return;
  const m = layout.svg.getScreenCTM();
  const p = m ? new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()) : null;
  const at = { x: ev.clientX, y: ev.clientY };
  const c = actionContext('diagram', null, { point: p ? { x: p.x, y: p.y } : null, at });
  const view = c.view;
  popupMenu(view ? t('View: {name}', { name: view.name }) : (state.diagram?.title || t('Diagram')), [
    actionEntries(c, { omit: ['shortcuts'] }),
    view ? ['-', actionEntries(actionContext('view', view, { open: { label: t('View details'), run: () => select('view', view.id, { reveal: false }), newTab: false } }), { groups: VIEW_SHOWING })] : null,
    '-',
    actionEntries(c, { groups: ['help'] }),
  ], at);
}

/** Copy text to the clipboard with a status message. */
export async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); status(t('{what} copied.', { what })); } catch { status(t('Copy failed.'), true); }
}

/**
 * Menu entries for an element (tree, basket chips, stored views; the general
 * part of the generated-diagram menu): its actions (actions.js). `diagramActions: false`
 * leaves out Add/Expand/Hide for menus that offer them themselves.
 * `selectOpts` are passed to select() for "Details" (e.g. fromTree: don't move the tree).
 */
export function elementMenuEntries(e, { diagramActions = true, selectOpts = { fromTree: true } } = {}) {
  return actionEntries(actionContext('element', e, { diagramActions, selectOpts }));
}

/**
 * A menu whose entries need what is asked for first (UP-3): shown when `build` resolves to its
 * arguments [title, entries, at, opts]; a failure goes to the status line. Returns true.
 */
function menuWhenReady(build) {
  build().then(args => { if (args) popupMenu(...args); }).catch(e => status(errorMessage(e), true));
  return true;
}

/**
 * CM-2 (2.18.0): right-click on the PlantUML tab's drawing. Its groups carry data-element, data-relationship
 * or data-view (plantuml.js): the element's actions, the relationship's, the linked view's; empty space gives
 * the diagram's menu (as its title).
 */
export function openPlantUmlMenu(target, ev) {
  const at = { x: ev.clientX, y: ev.clientY };
  const s = state.store;
  if (target?.dataset.element) return openViewNodeMenu(Number(target.dataset.element), ev);
  if (target?.dataset.relationship) {
    const id = Number(target.dataset.relationship);
    return menuWhenReady(async () => {
      const { r, attached } = await relationshipForMenu(id);
      return r ? [`${r.type}: ${s.relationshipLabel(r)}`, relationshipMenuEntries(r, { selectOpts: {}, attached }), at] : null;
    });
  }
  if (target?.dataset.view) {
    const v = s?.view(Number(target.dataset.view));
    if (!v) return false;
    popupMenu(v.name, actionEntries(actionContext('view', v, { open: { label: t('Open linked view “{name}”', { name: v.name }), run: () => drillToView(v.id) } }), { groups: VIEW_SHOWING }), at);
    return true;
  }
  openTitleMenu(at);
  return true;
}

/** A relationship complete, with its ends, and the relationships attached to it (BR-6), for its menu. */
export async function relationshipForMenu(id) {
  const s = state.store;
  const [attached] = await Promise.all([s.attachedTo(id), s.ensure({ relationships: [id] })]);
  await s.ensure({ relationships: attached.map(a => a.id) }); // the ends of the attached ones, for their elements
  return { r: s.relationship(id), attached };
}

/**
 * Menu entries for a relationship (tree, diagram connections): its actions (actions.js).
 * The source and target can be another relationship (BR-6); "both ends" are their elements.
 * `attached`: the relationships attached to it, see relationshipForMenu().
 */
export function relationshipMenuEntries(r, { selectOpts = { fromTree: true }, attached = [] } = {}) {
  return actionEntries(actionContext('relationship', r, { selectOpts, attached }));
}

/** Right-click menu on a relationship (connection line or helper dot) in any diagram. */
export function openConnMenu(relId, ev) {
  if (!state.store?.relationship(relId)) return;
  menuWhenReady(async () => {
    const { r, attached } = await relationshipForMenu(relId);
    return [`${r.type}: ${state.store.relationshipLabel(r)}`, connMenuEntries(r, attached), { x: ev.clientX, y: ev.clientY }];
  });
}

function connMenuEntries(r, attached) {
  const generated = state.diagramDef && state.diagramDef.kind !== 'view' && state.gen;
  const path = pathThrough(r);
  return [
    relationshipMenuEntries(r, { selectOpts: {}, attached }),
    '-',
    // CM-9
    { label: path.rels.size > 1 ? t('Highlight the {type} path through it ({n} relationships)', { type: r.type, n: path.rels.size }) : t('Highlight it and its ends'),
      title: t('Follows {type} relationships in the diagram from its target onwards and back from its source; the rest is dimmed until you click the background', { type: r.type }),
      action: () => highlightPath(path) },
    state.highlight ? { label: t('Clear highlight'), action: clearHighlight } : null,
    generated ? { label: t('Hide this relationship'), action: () => setHiddenRels([...hiddenRelsOf(state.diagramDef), r.id]),
      title: t('Remove the line from this diagram (the canvas menu can show hidden relationships again)') } : null,
  ];
}

/**
 * The chain of relationships of the same type through `r` in the current
 * diagram (CM-9): from its target forwards (source → target) and from its
 * source backwards; undirected Association chains in both directions.
 * @returns {{ rels: Set<number>, els: Set<number> }}
 */
export function pathThrough(r) {
  const s = state.store;
  const drawn = new Set([...(state.layout?.svg.querySelectorAll('.v-conn[data-relationship]') || [])].map(g => Number(g.dataset.relationship)));
  drawn.add(r.id);
  const rels = new Set([r.id]), els = new Set();
  const undirected = r.type === 'Association' && !r.isDirected;
  const ends = (eid, rid) => (eid != null ? [eid] : dragElementIds(`relationship:${rid}`));
  // only the relationships of the diagram matter, so the path is read from them, not from the model
  const lines = [...drawn].map(id => s.relationship(id)).filter(x => x && x.type === r.type);
  const outgoing = id => lines.filter(x => x.sourceElementId === id), incoming = id => lines.filter(x => x.targetElementId === id);
  const walk = (start, forward) => {
    const queue = [...start];
    while (queue.length) {
      const id = queue.shift();
      if (els.has(id)) continue;
      els.add(id);
      const next = [];
      if (forward || undirected) for (const x of outgoing(id)) next.push([x, ends(x.targetElementId, x.targetRelationshipId)]);
      if (!forward || undirected) for (const x of incoming(id)) next.push([x, ends(x.sourceElementId, x.sourceRelationshipId)]);
      for (const [x, others] of next) { rels.add(x.id); queue.push(...others.filter(o => !els.has(o))); }
    }
  };
  const src = ends(r.sourceElementId, r.sourceRelationshipId), tgt = ends(r.targetElementId, r.targetRelationshipId);
  walk(tgt, true);
  src.forEach(id => els.delete(id)); // a cycle may have reached the source: walk back from it too
  walk(src, false);
  return { rels, els };
}

/** Dim everything except a path (CM-9); cleared by a click on the background, Escape or a redraw. */
export function highlightPath({ rels, els }) {
  const svg = state.layout?.svg;
  if (!svg) return;
  clearHighlight();
  svg.classList.add('v-highlighting');
  svg.querySelectorAll('.v-conn[data-relationship], .v-dot[data-relationship]').forEach(g => g.classList.toggle('v-hl', rels.has(Number(g.dataset.relationship))));
  svg.querySelectorAll('.v-node[data-element]').forEach(g => g.classList.toggle('v-hl', els.has(Number(g.dataset.element))));
  state.highlight = svg;
  status(t('Highlighted {n} relationship(s) and {m} element(s) — click the background or press Escape to clear.', { n: rels.size, m: els.size }));
}

export function clearHighlight() {
  const svg = state.highlight;
  state.highlight = null;
  if (!svg) return;
  svg.classList.remove('v-highlighting');
  svg.querySelectorAll('.v-hl').forEach(g => g.classList.remove('v-hl'));
}

/**
 * Context menu of a tree item (model tree and search results): every action
 * the details pane offers for it, plus diagram and basket actions.
 * Returns true when a menu was shown.
 */
export function openTreeMenu(data, spec, at, treeRoot, { extra = [] } = {}) {
  const s = state.store;
  if (!s || !data) return false;
  const opts = { returnFocus: treeRoot };
  const withExtra = entries => (extra.length ? [...extra, '-', ...entries] : entries);
  const generated = state.diagramDef && state.diagramDef.kind !== 'view' && state.gen;
  const addLabel = generated ? t('Add to diagram') : t('Add to new diagram');
  const basketAll = ids => () => { ids.forEach(x => state.basket.add(x)); updateBasket(); status(t('{n} element(s) in the basket.', { n: ids.length })); };

  if (data.kind === 'element') {
    const e = s.element(data.id);
    if (!e) return false;
    if (!extra.length && selectionMenuFor(e.id, at, opts)) return true;
    popupMenu(e.name || t('(unnamed {type})', { type: prettyType(e.type) }), withExtra(elementMenuEntries(e)), at, opts);
    return true;
  }

  if (data.kind === 'relationship') {
    if (!s.relationship(data.id)) return false;
    return menuWhenReady(async () => {
      const { r, attached } = await relationshipForMenu(data.id);
      return [`${r.type}: ${s.relationshipLabel(r)}`, relationshipMenuEntries(r, { attached }), at, opts];
    });
  }

  if (data.kind === 'view') {
    const v = s.view(data.id);
    if (!v) return false;
    popupMenu(v.name, actionEntries(actionContext('view', v)), at, opts);
    return true;
  }

  if (data.kind === 'folder' && data.id != null) {
    const f = s.folders?.byId.get(data.id) || { id: data.id, label: spec.label };
    popupMenu(spec.label, actionEntries(actionContext('folder', { ...f, label: f.label || spec.label })), at, opts);
    return true;
  }

  // 2.28.0: the tree's Folders and Elements: a diagram of the whole model, when it is small enough (Settings)
  if (data.kind === 'whole') {
    const total = s.stats.elements.total, max = Number(settings.wholeModelMax) || 0;
    const title = t('The whole model ({n} element)|The whole model ({n} elements)', { n: total });
    if (!state.apiVersion || olderThan(state.apiVersion, '3.20.0')) {
      popupMenu(title, [{ label: t('A diagram of the whole model needs API 3.20.0'), disabled: true }], at, opts);
      return true;
    }
    if (!total || total > max) {
      popupMenu(title, [{ label: total ? t('A diagram of the whole model is offered up to {max} elements (Settings)', { max }) : t('The model has no elements.'), disabled: true }], at, opts);
      return true;
    }
    return menuWhenReady(async () => {
      const ids = await allElementIds();
      return [title, actionEntries(actionContext('whole', {}, { ids })), at, opts];
    });
  }

  if (data.kind === 'type') return menuWhenReady(async () => {
    const ids = (await s.elementsOfType(data.type)).map(e => e.id);
    return [prettyType(data.type), actionEntries(actionContext('type', { type: data.type }, { ids })), at, opts];
  });

  // ---- group headings (CM-5)
  if (data.kind === 'layer') return menuWhenReady(async () => {
    const layer = LAYERS.find(l => l.key === data.key);
    const ids = await layerElementIds(data.key);
    return [t('{layer} layer', { layer: layer?.label || data.key }), actionEntries(actionContext('layer', { key: data.key }, { ids })), at, opts];
  });

  if (data.kind === 'reltype') return menuWhenReady(async () => {
    const rels = await relTypeList(data.type);
    const ends = await relTypeEndIds(data.type);
    return [data.type === '@rel' ? t('Connected to relationships') : `${data.type} (${rels.length})`,
      actionEntries(actionContext('reltype', { type: data.type }, { rels, ends })), at, opts];
  });

  if (data.kind === 'property') {
    popupMenu(t('Property: {name}', { name: data.name }), propertyMenuEntries(data.name), at, opts);
    return true;
  }

  if (data.kind === 'propvalue') {
    popupMenu(`${data.name} = “${data.value}”`, propertyValueMenuEntries(data.name, data.value), at, opts);
    return true;
  }

  if (data.kind === 'model') {
    popupMenu(s.model.name, actionEntries(actionContext('model', s.model)), at, opts);
    return true;
  }

  if (data.kind === 'results') {
    // search result headings: Elements / Relationships / Views
    if (data.what === 'views') {
      const views = data.ids.map(id => s.view(id)).filter(Boolean);
      const gather = async () => [...new Set((await Promise.all(views.map(v => viewElementPositions(v.id)))).flatMap(m => [...m.keys()]))];
      popupMenu(t('Views ({n})', { n: views.length }), [
        { label: t('Diagram of their elements'), action: async () => showElements(await gather(), t('Elements of {n} views', { n: views.length })), disabled: !views.length },
        { label: t('Add their elements to basket'), action: async () => basketAdd(await gather()), disabled: !views.length },
      ], at, opts);
      return true;
    }
    const ids = data.what === 'relationships' ? [...new Set(data.ids.flatMap(id => dragElementIds(`relationship:${id}`)))] : data.ids;
    const label = data.what === 'relationships' ? t('ends of the found relationships') : t('search results');
    popupMenu(data.what === 'relationships' ? t('Relationships ({n})', { n: data.ids.length }) : t('Elements ({n})', { n: data.ids.length }), [
      { newTab: true, label: data.what === 'relationships' ? t('Diagram of their ends') : t('Diagram of the results'), action: () => showElements(ids, t('Search: {query}', { query: $('#search-input').value })), disabled: !ids.length },
      { newTab: true, label: t('Explore'), action: () => exploreFrom(ids), disabled: !ids.length },
      { newTab: true, label: addLabel, count: ids.length, action: () => addToDiagram(ids, { label }) },
      { label: t('Add to basket'), action: basketAll(ids), disabled: !ids.length },
      { label: t('Select them'), note: ids.length, action: () => markElements(ids, 'set') },
      { label: t('Copy names'), action: () => copyText(ids.map(id => s.element(id)?.name || '').join('\n'), t('Names')), disabled: !ids.length },
    ], at, opts);
    return true;
  }

  return false; // other rows (top-level headings): the browser's own menu
}

/** Show details of a tree heading that has no URL state (layer, relationship type). */
export function selectInfo(sel) {
  state.selection = sel;
  renderDetails(sel).catch(e => status(e.message, true));
}

/** Search for the items with a property (CM-5), or with one of its values. */
export function findWithProperty(name, value) {
  const q = value === undefined ? `@${name}` : `@${name}=${value}`;
  $('#search-input').value = q;
  runSearch(q);
}

/** The entry that removes the diagrams' property filter, when there is one. */
export function removePropertyFilterEntry() {
  const po = state.props;
  return po.filterName ? {
    label: t('Remove the property filter ({filter})', { filter: po.describeFilter() }),
    action: () => setPropertyOptions(new PropertyOptions({ ...po, filterName: '', filterOp: 'has', filterValue: '' }), { redraw: true }),
  } : null;
}

/**
 * Property menu (CM-5): colour or label diagrams by it, filter by whether it is
 * set, find items with it (actions.js). Filtering by one value is in that value's menu.
 */
export function propertyMenuEntries(name) {
  return actionEntries(actionContext('property', { name }));
}

/** Menu of one value of a property (under the property in the tree): filter diagrams by it, find items with it. */
export function propertyValueMenuEntries(name, value) {
  const po = state.props;
  const active = po.filterName === name && po.filterOp === 'eq' && po.filterValue === value;
  return [
    { label: t('Only elements where {name} = “{value}”', { name, value }), note: state.store.propertyIndex.get(name)?.valueCounts.get(value),
      disabled: active, action: () => setPropertyOptions(new PropertyOptions({ ...po, filterName: name, filterOp: 'eq', filterValue: value }), { redraw: true }) },
    removePropertyFilterEntry(),
    '-',
    { label: t('Find items with it'), action: () => findWithProperty(name, value) },
  ];
}

// ---------------------------------------------------------------- details pane context menus (CM-1)
// Items marked with ctx() (elements, relationships, views, folders) get the same
// menus as in the tree. A relationship row's other-end link is that element, the
// rest of the row the relationship. Impact results add the path from the start.

/** Extra entries for an impact-analysis result: the path from the start element to it. */
export function impactPathEntries(target) {
  const info = target.closest('.impact-list')?._analysis;
  const id = Number(target.dataset.ctx.split(':')[1]);
  if (!info || !info.a.results.has(id)) return [];
  const s = state.store;
  const name = x => s.element(x)?.name || `#${x}`;
  const steps = pathTo(info.a, id); // start → … → id, each step {id, via, from}
  const ids = [info.start.id, ...steps.map(st => st.id)];
  const text = [name(info.start.id), ...steps.map(st => {
    const r = s.relationship(st.via);
    return `${r?.sourceElementId === st.from ? `—${r?.type}→` : `←${r?.type}—`} ${name(st.id)}`;
  })].join(' ');
  return [
    { newTab: true, label: t('Diagram of the path from {name} ({n} step)|Diagram of the path from {name} ({n} steps)', { name: name(info.start.id), n: steps.length }),
      action: () => showElements(ids, t('Path: {from} → {to}', { from: name(info.start.id), to: name(id) })) },
    { label: t('Copy the path as text'), action: () => copyText(text, t('Path')), title: text },
  ];
}

// ---------------------------------------------------------------- multi-selection (CM-6)
// state.marked holds element ids. Ctrl-click (or Shift-click for a range) in the
// tree and search results, Ctrl/Shift-click or Shift-drag (an area) in diagrams,
// Ctrl-click on basket chips. A right-click on a marked element opens one menu
// for all of them; a plain click or Escape ends the selection.

/** Change the multi-selection: mode 'toggle' | 'add' | 'set'. Tree data, ids or both are accepted. */
export function markElements(items, mode = 'toggle') {
  const s = state.store;
  if (!s) return;
  const ids = items.map(x => (typeof x === 'object' ? (x?.kind === 'element' ? x.id : null) : x)).filter(id => id != null && s.element(id));
  if (mode === 'set') state.marked = new Set(ids);
  else {
    // Ctrl-clicking a second element keeps the one selected before
    if (!state.marked.size && state.selection?.kind === 'element' && !ids.includes(state.selection.id) && s.element(state.selection.id)) state.marked.add(state.selection.id);
    for (const id of ids) {
      if (mode === 'toggle' && state.marked.has(id)) state.marked.delete(id); else state.marked.add(id);
    }
  }
  if (!ids.length && mode !== 'set' && items.length) status(t('Only elements can be selected together.'));
  refreshMarks();
}

/** A plain click in a diagram: select the item, ending a multi-selection. */
export function plainSelect(kind, id) {
  if (state.marked.size) markElements([], 'set');
  select(kind, id);
}

/** Draw the marks in the trees, the diagram and the basket, and the selection bar. */
export function refreshMarks() {
  tree?.refreshMarks();
  searchTree?.refreshMarks();
  $('#tab-layout').querySelectorAll('.v-node[data-element]').forEach(g => g.classList.toggle('marked', state.marked.has(Number(g.dataset.element))));
  basketTree?.refreshMarks();
  const bar = $('#multi-bar');
  const n = state.marked.size;
  bar.hidden = !n;
  if (!n) { bar.replaceChildren(); return; }
  const names = [...state.marked].slice(0, 3).map(id => state.store.element(id)?.name || `#${id}`);
  const actions = h('button', { type: 'button', class: 'primary', 'aria-haspopup': 'menu' }, t('Actions…'));
  actions.addEventListener('click', () => { const r = actions.getBoundingClientRect(); openSelectionMenu({ x: r.left, y: r.bottom + 2 }, { returnFocus: actions }); });
  fill(bar,
    h('strong', {}, t('{n} selected', { n })),
    h('span', { class: 'ellipsis' }, n > 3 ? t('{names} and {n} more', { names: names.join(', '), n: n - 3 }) : names.join(', ')),
    actions,
    h('button', { type: 'button', class: 'link', onclick: () => markElements([], 'set') }, t('selection::Clear')),
    h('span', { class: 'hint' }, t('Ctrl-click adds or removes, Shift-drag selects an area, Esc clears')));
}

/** Element ids drawn in the current diagram (generated or stored view). */
export function diagramElementIds() {
  return [...new Set([...(state.layout?.svg.querySelectorAll('.v-node[data-element]') || [])].map(g => Number(g.dataset.element)))];
}

/** Open the selection menu instead of an element's own menu when it is part of a multi-selection. */
export function selectionMenuFor(id, at, opts = {}) {
  if (state.marked.size < 2 || !state.marked.has(id)) return false;
  openSelectionMenu(at, opts);
  return true;
}

/** One menu for all selected elements. */
export function openSelectionMenu(at, { returnFocus = null } = {}) {
  const s = state.store;
  const ids = [...state.marked].filter(id => s.element(id));
  if (!ids.length) return;
  const n = ids.length;
  const generated = state.diagramDef && state.diagramDef.kind !== 'view' && state.gen;
  const missing = ids.filter(id => !inDiagram(id));
  const shown = generated ? ids.filter(id => inDiagram(id)) : [];
  const inBasket = ids.filter(id => state.basket.has(id));
  const impact = dir => () => { const o = impactOptions(); renderDef({ kind: 'impact', id: ids[0], ids, dir, depth: o.depth, types: o.types }); };
  popupMenu(t('Selection ({n} element)|Selection ({n} elements)', { n }), [
    { newTab: true, label: t('Diagram of the selection'), action: () => showElements(ids, t('Selection ({n} elements)', { n })) },
    { newTab: true, label: t('Diagram with neighbours'), action: () => showNeighbourhood(ids, t('selection ({n} elements)', { n })) },
    { newTab: true, label: t('Explore'), action: () => exploreFrom(ids) },
    generated && !missing.length ? { label: '✓ ' + t('All in diagram'), disabled: true }
      : { newTab: true, label: generated ? t('Add to diagram') : t('Add to new diagram'), count: missing.length, action: () => addToDiagram(ids, { label: t('the selection') }) },
    shown.length ? { label: t('Hide from diagram'), note: shown.length, action: () => hideElement(shown) } : null,
    '-',
    { newTab: true, label: t('Impact analysis of all of them'), action: impact('impact') },
    { newTab: true, label: t('Dependencies of all of them'), action: impact('dependencies') },
    n === 2 ? { newTab: true, label: t('Paths between the two'), action: () => showPaths(ids[0], ids[1]) } : null,
    '-',
    { label: t('Add to basket'), count: n - inBasket.length, action: () => basketAdd(ids) },
    inBasket.length ? { label: t('Remove from basket'), note: inBasket.length, action: () => { inBasket.forEach(id => state.basket.delete(id)); updateBasket(); } } : null,
    '-',
    { label: t('Copy names'), action: () => copyText(ids.map(id => s.element(id).name || '').join('\n'), t('Names')) },
    { label: t('Clear selection'), action: () => markElements([], 'set') },
  ], at, { returnFocus });
}

// ---------------------------------------------------------------- legend, filter chips, viewpoints (CM-7)

/** Menu of a colour-legend entry: its elements in the current diagram; for a property legend, filter by the value. */
export function openLegendMenu(deco, colour, text, at) {
  const s = state.store;
  if (!s || !deco.colour) return;
  const ids = diagramElementIds().filter(id => s.element(id) && deco.colour(s.element(id)) === colour);
  const prop = state.props.colour && deco.legendTitle === state.props.colour ? state.props.colour : null;
  const notSet = text === NOT_SET;
  const set = patch => setPropertyOptions(new PropertyOptions({ ...state.props, ...patch }), { redraw: true });
  const view = state.diagramDef?.kind === 'view';
  const filterNote = view ? t('In a stored view, elements that do not pass are faded') : null;
  popupMenu(`${deco.legendTitle}: ${text}`, [
    { label: t('Select these elements'), note: ids.length, action: () => markElements(ids, 'set') },
    { label: t('Add them to basket'), note: ids.length, action: () => basketAdd(ids) },
    { newTab: true, label: t('Diagram of them'), note: ids.length, action: () => showElements(ids, `${deco.legendTitle}: ${text}`) },
    prop ? [
      '-',
      { label: notSet ? t('Only elements without {property}', { property: prop }) : t('Only elements where {property} = this value', { property: prop }), title: filterNote,
        action: () => set(notSet ? { filterName: prop, filterOp: 'missing', filterValue: '' } : { filterName: prop, filterOp: 'eq', filterValue: text }) },
      { label: notSet ? t('Hide elements without {property}', { property: prop }) : t('Hide elements with this value'), title: filterNote,
        action: () => set(notSet ? { filterName: prop, filterOp: 'has', filterValue: '' } : { filterName: prop, filterOp: 'ne', filterValue: text }) },
      state.props.filterName ? { label: t('Remove the property filter'), action: () => set({ filterName: '', filterOp: 'has', filterValue: '' }) } : null,
      { label: t('Stop colouring by {property}', { property: prop }), action: () => set({ colour: '' }) },
    ] : null,
  ], at);
}

/** Diagram filter showing only one layer / element type / relationship type. */
export function filterOnly(kind, key) {
  const f = state.filter;
  const nf = f.copy();
  if (kind === 'layer') nf.elementTypes = new Set(typesOfLayer(key));
  if (kind === 'el') nf.elementTypes = new Set([key]);
  if (kind === 'rel') nf.relTypes = new Set([key]);
  setFilter(nf);
}

/** Diagram filter hiding one layer / element type / relationship type. */
export function filterExcept(kind, key) {
  const f = state.filter;
  const nf = f.copy();
  if (kind === 'layer') typesOfLayer(key).forEach(t => nf.elementTypes.delete(t));
  if (kind === 'el') nf.elementTypes.delete(key);
  if (kind === 'rel') nf.relTypes.delete(key);
  setFilter(nf);
}

/** Menu of a filter-panel chip (layer, element type, relationship type) or the viewpoint list. */
export function openFilterChipMenu(spec, at) {
  const f = state.filter;
  const all = (what, on) => {
    const nf = f.copy();
    if (what === 'el') nf.elementTypes = new Set(on ? ELEMENT_TYPES : []); else nf.relTypes = new Set(on ? RELATIONSHIP_TYPES : []);
    setFilter(nf);
  };
  if (spec === 'viewpoint') { openViewpointMenu(at); return; }
  const [kind, key] = spec.split(':');
  const name = kind === 'layer' ? t('{layer} layer', { layer: LAYERS.find(l => l.key === key)?.label }) : kind === 'el' ? prettyType(key) : key;
  popupMenu(name, [
    { label: kind === 'rel' ? t('Only this relationship type') : kind === 'layer' ? t('Only this layer') : t('Only this element type'), action: () => filterOnly(kind, key) },
    { label: t('All except this'), action: () => filterExcept(kind, key) },
    { label: kind === 'rel' ? t('All relationship types') : t('All element types'), action: () => all(kind === 'rel' ? 'rel' : 'el', true) },
    '-',
    { label: t('Reset the filter'), action: () => setFilter(new DiagramFilter()), disabled: f.isDefault() },
    kind === 'el' ? ['-', { newTab: true, label: t('Diagram of all {type} elements', { type: prettyType(key) }), action: () => renderDef({ kind: 'type', type: key }), disabled: !state.store?.stats.elements.byType[key] }] : null,
    kind === 'layer' ? ['-', { newTab: true, label: t('Diagram of the layer'), action: () => renderDef({ kind: 'layer', key }), disabled: !state.store }] : null,
  ], at);
}

/** Viewpoint presets and saved filters: apply one, save the current filter, delete a saved one. */
export function openViewpointMenu(at) {
  const f = state.filter;
  const vp = f.matchingViewpoint();
  const saved = settings.savedFilters || [];
  const code = f.encode();
  popupMenu(t('Viewpoint filter'), [
    Object.entries(VIEWPOINTS).map(([k, v]) => ({ label: `${k === vp ? '✓ ' : ''}${v.label}`, action: () => setFilter(DiagramFilter.fromViewpoint(k)) })),
    saved.length ? '-' : null,
    saved.map(sf => ({ label: `${sf.code === code && !vp ? '✓ ' : ''}${sf.name}`, title: t('Saved filter'), action: () => setFilter(DiagramFilter.decode(sf.code)) })),
    '-',
    { label: t('Save the current filter as…'), disabled: f.isDefault() || !!vp, title: vp ? t('This filter is a preset') : null, action: () => {
      const name = prompt(t('Name of the saved filter:'), t('My filter'))?.trim();
      if (!name) return;
      saveSettings({ savedFilters: [...saved.filter(sf => sf.name !== name), { name, code }] });
      filterPanel.redraw();
      status(t('Filter saved as “{name}”.', { name }));
    } },
    saved.map(sf => ({ label: t('Delete saved “{name}”', { name: sf.name }), action: () => {
      saveSettings({ savedFilters: saved.filter(x => x !== sf) });
      filterPanel.redraw();
    } })),
  ], at);
}

// ---------------------------------------------------------------- diagram chrome (CM-8)

/** Menu of the minimap: centre the view at the clicked point, fit, hide the map. */
export function openMinimapMenu(ev, layout, minimap) {
  const m = minimap.el.querySelector('svg')?.getScreenCTM();
  const p = m ? new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()) : null;
  popupMenu(t('Overview map'), [
    { label: t('Centre the view here'), disabled: !p, action: () => { const cur = layout.view(); layout.setView({ ...cur, x: p.x - cur.w / 2, y: p.y - cur.h / 2 }); } },
    { label: t('Zoom in here'), disabled: !p, action: () => { const cur = layout.view(); const w = cur.w / 1.5, hh = cur.h / 1.5; layout.setView({ x: p.x - w / 2, y: p.y - hh / 2, w, h: hh }); } },
    { label: t('Fit to window'), action: () => layout.fit() },
    '-',
    { label: t('Hide overview map'), action: () => state.doc.panel?.querySelector('.layout-tools [data-tool="map"]')?.click() },
  ], { x: ev.clientX, y: ev.clientY });
}

/** Menu of the diagram title and the view breadcrumbs: link, title, view details, back to a breadcrumb. */
export function openTitleMenu(at) {
  const def = state.diagramDef, s = state.store;
  if (!def || !s) return;
  const view = def.kind === 'view' ? s.view(def.id) : null;
  const trail = view ? def.trail || [] : [];
  popupMenu(state.diagram?.title || t('Diagram'), [
    { label: t('Copy link'), action: () => $('#btn-link').click() },
    { label: t('Copy title'), action: () => copyText(state.diagram?.title || '', t('Title')) },
    view ? { label: t('View details'), action: () => select('view', view.id, { reveal: false }) } : null,
    view ? { label: t('Show in tree'), action: () => revealInTree('view', view.id) } : null,
    trail.length ? ['-', ...trail.map((id, i) => ({
      label: t('Back to “{name}”', { name: s.view(id)?.name || '#' + id }),
      action: () => { history.pushState(null, '', location.href); select('view', id); showView(id, trail.slice(0, i)); },
    })).reverse()] : null,
    !view && state.exploreBack.length ? ['-', { label: t('Back to an earlier step…'), action: () => openBackMenu(at) }] : null,
    '-',
    { label: t('Copy image'), action: () => $('#btn-copy-png').click(), disabled: $('#btn-copy-png').disabled },
    { label: t('Download .svg'), action: () => $('#btn-dl-svg').click(), disabled: $('#btn-dl-svg').disabled },
    { label: t('Download .png'), action: () => $('#btn-dl-png').click(), disabled: $('#btn-dl-png').disabled },
  ], at);
}
