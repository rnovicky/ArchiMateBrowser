// ArchiMate Browser: The basket.
// Part of js/app.js until 2026-10-24 (EN-6); app.js wires it to the page.

import { api } from '../api.js';
import { settings } from '../config.js';
import { t } from '../i18n.js';
import { Tree } from '../tree.js';
import { typesOfLayer, prettyType } from '../archimate.js';
import { renderDetails } from './details.js';
import { dragElementIds, treeDragData, viewElementPositions } from './diagram.js';
import { markElements, openBasketMenu, openTreeMenu } from './menus.js';
import { byName } from './models.js';
import { modelKey, select } from './routing.js';
import { $, state } from './state.js';
import { elementSpec } from './treespecs.js';
import { errorMessage, status } from './ui.js';

// ================================================================ basket
// Persisted per model in localStorage as element *XMI identifiers*, which stay
// stable when a model is re-imported (database ids may change).

export function basketKey() {
  const m = state.store.model;
  return `archixmi-basket:${settings.apiBase}:${modelKey(m)}`;
}

/** The basket stored for the model; its identifiers are resolved by the API (BL-35), its elements cached. */
export async function loadBasket({ signal } = {}) {
  state.basket.clear();
  let xmiIds = [];
  try { xmiIds = JSON.parse(localStorage.getItem(basketKey()) || '[]'); } catch { /* storage unavailable or corrupt: start empty */ }
  if (!Array.isArray(xmiIds) || !xmiIds.length) return;
  const s = state.store;
  const ids = [];
  for (let i = 0; i < xmiIds.length; i += 1000) {
    const { items } = await api.resolve(s.id, { xmiIdentifiers: xmiIds.slice(i, i + 1000) }, { signal });
    for (const x of xmiIds.slice(i, i + 1000)) if (items[x]?.kind === 'element') ids.push(items[x].id);
  }
  await s.ensure({ elements: ids }, { signal, degree: true });
  if (state.store === s) ids.forEach(id => state.basket.add(id));
}

export function saveBasket() {
  if (!state.store) return;
  if ([...state.basket].some(id => !state.store.element(id))) return; // not all known yet: updateBasket() saves when they are
  try {
    const xmiIds = [...state.basket].map(id => state.store.element(id)?.xmiIdentifier).filter(Boolean);
    if (xmiIds.length) localStorage.setItem(basketKey(), JSON.stringify(xmiIds));
    else localStorage.removeItem(basketKey());
  } catch { /* storage unavailable: basket lives for this page load only */ }
}

export function toggleBasket(id) {
  if (state.basket.has(id)) state.basket.delete(id); else state.basket.add(id);
  updateBasket();
}

/** Add elements to the basket, with a status message. */
export function basketAdd(ids) {
  const before = state.basket.size;
  ids.forEach(x => state.basket.add(x));
  updateBasket();
  status(t('{n} element(s) added to the basket ({total} in it).', { n: state.basket.size - before, total: state.basket.size }));
  if (state.selection?.kind === 'element' && ids.includes(state.selection.id)) renderDetails(state.selection);
}

/** Element ids of a layer (CM-5), by type then name. */
export async function layerElementIds(key, { signal } = {}) {
  const s = state.store;
  const types = typesOfLayer(key).filter(t => s.stats.elements.byType[t]);
  return (await Promise.all(types.map(t => s.elementsOfType(t, { signal })))).flat().map(e => e.id);
}

/** 2.28.0: the ids of every element of the model (for a model small enough to draw whole). */
export async function allElementIds({ signal } = {}) {
  const s = state.store;
  const types = Object.keys(s.stats.elements.byType).filter(t => s.stats.elements.byType[t]);
  return (await Promise.all(types.map(t => s.elementsOfType(t, { signal })))).flat().map(e => e.id);
}

/** Relationships of a type, or '@rel': those attached to other relationships (BR-6); with their ends cached. */
export function relTypeList(type, { signal } = {}) {
  const s = state.store;
  return type === '@rel' ? s.relationshipsOnRelationships({ signal }) : s.relationshipsOfType(type, { signal });
}

/** Elements at the ends of the relationships of a type (through relationship ends, BR-6). */
export async function relTypeEndIds(type, { signal } = {}) {
  return [...new Set((await relTypeList(type, { signal })).flatMap(r => dragElementIds(`relationship:${r.id}`)))];
}

export async function addViewToBasket(viewId) {
  let shape;
  try { shape = await viewElementPositions(viewId); } catch (e) { status(errorMessage(e), true); return; }
  for (const id of shape.keys()) state.basket.add(id);
  updateBasket();
}

/** The basket's elements in the order chosen in its menu (CM-8: Sort). */
export function basketSorted() {
  const s = state.store;
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
  const order = {
    name: byName,
    type: (a, b) => prettyType(a.type).localeCompare(prettyType(b.type)) || byName(a, b),
    added: () => 0, // the basket's insertion order
  }[settings.basketSort] || byName;
  return [...state.basket].map(id => s?.element(id)).filter(Boolean).sort(order);
}

export let basketTree = null;

export function removeFromBasket(id) {
  state.basket.delete(id);
  updateBasket();
  if (state.selection?.kind === 'element' && state.selection.id === id) renderDetails(state.selection);
}

/**
 * The basket as a tree, like the search results: an "Elements" group (its menu acts on
 * the whole basket) with one row per element, as in the model tree (relationship counts,
 * the relationships below it, the element's menu, dragging, Ctrl-click selection).
 */
export function updateBasket() {
  // UP-3: elements added from where only their id was at hand are asked for, then the basket is drawn again
  const s = state.store, unknown = s ? [...state.basket].filter(id => !s.element(id)) : [];
  if (unknown.length) {
    s.ensure({ elements: unknown }, { degree: true })
      .then(() => {
        if (state.store !== s) return;
        unknown.filter(id => !s.element(id)).forEach(id => state.basket.delete(id)); // not in the model
        updateBasket();
      })
      .catch(e => status(errorMessage(e), true));
  }
  $('#basket-count').textContent = state.basket.size;
  const countTail = $('#basket-count').nextSibling; // "elements" after the count, in the right plural form
  if (countTail?.nodeType === Node.TEXT_NODE) countTail.nodeValue = ` ${t('element|elements', { n: state.basket.size })}`;
  basketTree ??= new Tree($('#basket-items'), {
    label: t('Basket'),
    onSelect: d => {
      if (d.kind === 'basket') return; // the group heading (its menu acts on the whole basket)
      if (state.marked.size) markElements([], 'set');
      select(d.kind, d.id, { reveal: false });
    },
    dragData: spec => (spec.data?.kind === 'basket' ? 'basket' : treeDragData(spec)),
    onContextMenu: (data, spec, at) => (data.kind === 'basket' ? (openBasketMenu(at), true) : openTreeMenu(data, spec, at, basketTree.root)),
    onMark: markElements, isMarked: d => d?.kind === 'element' && state.marked.has(d.id),
  });
  const elements = state.store ? basketSorted() : [];
  const group = basketTree.root.firstElementChild;
  const open = group?.getAttribute('aria-expanded') !== 'false'; // keep the group as the user left it
  basketTree.setRoots(elements.length ? [{
    key: 'b:elements', icon: '◧', label: t('Elements'), sub: String(elements.length), expanded: open,
    title: t('Right-click for actions on the whole basket'),
    data: { kind: 'basket' },
    children: elements.map(e => ({
      ...elementSpec(e),
      action: { label: '×', title: t('Remove {name} from basket', { name: e.name || t('element') }), run: () => removeFromBasket(e.id) },
    })),
  }] : []);
  basketTree.refreshMarks();
  const all = $('#basket-label');
  all.draggable = state.basket.size > 0;
  all.tabIndex = state.basket.size ? 0 : -1;
  all.title = state.basket.size ? t('Drag into the diagram to add all basket elements; right-click for actions') : '';
  for (const b of ['#btn-basket-render', '#btn-basket-expand', '#btn-basket-explore', '#btn-basket-clear']) $(b).disabled = !state.basket.size;
  $('#basket').classList.toggle('empty', !state.basket.size); // UX-5: a hint instead of disabled buttons
  saveBasket();
}
