// ArchiMate Browser: the palette for creating (BR-11 step 2, 2.24.0; E15 of the API's BROWSER_EDITING.md).
//
// While ✎ Edit is on, a generated diagram (a created view being edited among them) has a strip at its left with
// every element type, by layer, and every relationship type, each with its ArchiMate sprite.
// * An element: drag a type onto the diagram, or click it and then a place in the diagram; the name is asked
//   for, the element is created there, filed in its layer's folder (E12) and selected. One of the same type and
//   name is named first; creating it anyway is allowed (E10).
// * A relationship: *Connect*, then the source and the target element; the palette then offers only the types
//   ArchiMate allows between them. Or a type first, then its source and target. Esc ends either.
// The menus do the same: *New element here…* (the diagram's), *Connect to…* (an element's), *New … element…*
// (a type in the tree), so the keyboard and Ctrl+K reach it too.

import { api } from '../api.js';
import { t } from '../i18n.js';
import { DRAG_TYPE } from '../tree.js';
import { LAYERS, RELATIONSHIP_TYPES, layerOf, prettyType, spriteUrl, typesOfLayer } from '../archimate.js';
import { positionsOf } from '../manual.js';
import { addToDiagram, askConfirm } from './diagram.js';
import { editing } from './editing.js';
import { ownChange } from './history.js';
import { tree } from './models.js';
import { renderDef } from './panels.js';
import { revealInTree, select } from './routing.js';
import { $, state } from './state.js';
import { buildTree } from './treespecs.js';
import { errorMessage, h, status } from './ui.js';

/** The drag payload of a palette type: "new:ApplicationComponent" (app.js's drop handler takes it). */
export const NEW_PREFIX = 'new:';

// D17 of the MCP server: the top-level folders Archi makes, by layer; the first one there is is used
const LAYER_FOLDERS = {
  strategy: ['Strategy'], business: ['Business'], application: ['Application'],
  technology: ['Technology & Physical', 'Technology'], physical: ['Technology & Physical', 'Physical'],
  motivation: ['Motivation'], implementation: ['Implementation & Migration'], other: ['Other'],
};
const RELATIONS_FOLDERS = ['Relations'];

// what the palette is doing: { place: type } after clicking an element type; { connect: { type?, from? } }
const ui = { folded: new Set(), filter: '' };
let mode = null;

/** Is there a palette for this tab's diagram: a generated one, with editing on. */
export const hasPalette = (doc = state.doc) => editing() && !!doc.gen && doc.diagramDef?.kind !== 'view';

// ---------------------------------------------------------------- the strip

/** The palette strip of a tab's generated diagram (mountLayout puts it into the panel); null without one. */
export function paletteStrip(doc) {
  if (!hasPalette(doc)) return null;
  const filter = h('input', { type: 'search', class: 'palette-filter', placeholder: t('Filter types…'), value: ui.filter, 'aria-label': t('Filter the element types') });
  const groups = h('div', { class: 'palette-groups' });
  const typeButton = type => {
    const src = spriteUrl(type);
    const b = h('button', {
      type: 'button', class: 'palette-type', draggable: 'true', 'data-new-element': type, title: t('{type}: drag it onto the diagram, or click it and then a place', { type: prettyType(type) }),
      'aria-pressed': String(mode?.place === type),
      onclick: () => setMode(mode?.place === type ? null : { place: type }),
    }, src ? h('img', { src, alt: '', width: 15, height: 15 }) : h('span', { class: 'palette-badge' }, type.slice(0, 3)), h('span', { class: 'palette-type-name' }, prettyType(type)));
    b.addEventListener('dragstart', e => { e.dataTransfer.setData(DRAG_TYPE, NEW_PREFIX + type); e.dataTransfer.effectAllowed = 'copy'; });
    return b;
  };
  const draw = () => {
    const q = ui.filter.trim().toLowerCase();
    groups.replaceChildren(...LAYERS.map(layer => {
      const types = typesOfLayer(layer.key).filter(x => !q || prettyType(x).toLowerCase().includes(q) || x.toLowerCase().includes(q));
      if (!types.length) return null;
      const open = q || !ui.folded.has(layer.key);
      return h('div', { class: 'palette-layer', style: `--layer:${layer.color}` },
        h('button', { type: 'button', class: 'palette-layer-head', 'aria-expanded': String(!!open),
          onclick: () => { if (ui.folded.has(layer.key)) ui.folded.delete(layer.key); else ui.folded.add(layer.key); draw(); } },
        (open ? '▾ ' : '▸ ') + layer.label),
        open ? h('div', { class: 'palette-types' }, types.map(typeButton)) : null);
    }));
  };
  filter.addEventListener('input', () => { ui.filter = filter.value; draw(); });
  draw();
  return h('div', { class: 'palette-strip', 'aria-label': t('Palette') },
    h('div', { class: 'palette-title' }, t('Palette')),
    filter, groups, relationsBox(), h('div', { class: 'palette-hint', role: 'status' }, hint()));
}

/** The relationship part: Connect, and the types (only the allowed ones once two elements are chosen). */
function relationsBox() {
  const c = mode?.connect;
  const allowed = c?.allowed ?? null;
  return h('div', { class: 'palette-relations' },
    h('div', { class: 'palette-layer-head static' }, t('Relationships')),
    h('button', { type: 'button', class: 'palette-connect', 'data-connect': '', 'aria-pressed': String(!!c && !c.type),
      onclick: () => setMode(c && !c.type ? null : { connect: {} }) }, '⇢ ', t('Connect')),
    h('div', { class: 'palette-types' }, RELATIONSHIP_TYPES.map(type => {
      const src = spriteUrl(type);
      const off = allowed ? !allowed.includes(type) : false;
      return h('button', {
        type: 'button', class: 'palette-type', 'data-new-relationship': type, disabled: off,
        'aria-pressed': String(c?.type === type), title: off ? t('{type} is not allowed between these two', { type }) : t('{type}: then click its source and its target', { type }),
        onclick: () => (allowed ? connect(c.from, c.to, type) : setMode(c?.type === type ? null : { connect: { type } })),
      }, src ? h('img', { src, alt: '', width: 15, height: 15 }) : null, h('span', { class: 'palette-type-name' }, type));
    })));
}

function hint() {
  if (mode?.place) return t('Click a place in the diagram for the new {type}; Esc cancels.', { type: prettyType(mode.place) });
  const c = mode?.connect;
  if (c?.allowed) return t('Choose the type of the relationship; Esc cancels.');
  if (c?.from != null) return t('Now click the target element; Esc cancels.');
  if (c) return t('Click the source element{type}; Esc cancels.', { type: c.type ? ` (${c.type})` : '' });
  return '';
}

/** Change what the palette does, and draw it again. */
function setMode(next) {
  mode = next;
  const strip = state.doc.panel?.querySelector('.palette-strip');
  const fresh = paletteStrip(state.doc);
  if (strip && fresh) strip.replaceWith(fresh);
  for (const g of $('#tab-layout').querySelectorAll('.v-node.connect-from')) g.classList.remove('connect-from');
  if (mode?.connect?.from != null) {
    $('#tab-layout').querySelectorAll(`.v-node[data-element="${mode.connect.from}"]`).forEach(g => g.classList.add('connect-from'));
  }
  $('#tab-layout').classList.toggle('palette-placing', !!mode?.place || !!mode?.connect);
  if (hint()) status(hint());
}

export const cancelPalette = () => { if (mode) { setMode(null); status(''); return true; } return false; };

/** "Connect to…" (an element's menu): it is the source; the next element clicked is the target. */
export function connectFrom(id) {
  setMode({ connect: { from: id } });
}

// ---------------------------------------------------------------- clicks in the diagram

/** Installed once (app.js): while placing or connecting, clicks in the diagram are the palette's. */
export function installPalette() {
  const pane = $('#tab-layout');
  pane.addEventListener('click', ev => {
    if (!mode || !state.layout || ev.target.closest('.palette-strip, .layout-tools, .edit-bar, .layout-legend, .minimap')) return;
    const node = ev.target.closest('.v-node[data-element]');
    if (mode.place) {
      if (node) return; // a place, not an element
      ev.preventDefault();
      ev.stopPropagation();
      const type = mode.place;
      setMode(null);
      createElementAt(type, pointOf(ev));
      return;
    }
    if (!node) return;
    ev.preventDefault();
    ev.stopPropagation();
    const id = Number(node.dataset.element);
    const c = mode.connect;
    if (c.from == null) { setMode({ connect: { ...c, from: id } }); return; }
    if (id === c.from) return;
    if (c.type) connect(c.from, id, c.type);
    else offerTypes(c.from, id);
  }, true);
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && mode && !ev.target.closest?.('dialog')) { ev.preventDefault(); ev.stopPropagation(); cancelPalette(); }
  }, true);
}

/** A click or a drop in diagram coordinates. */
export function pointOf(ev) {
  const m = state.layout?.svg?.getScreenCTM();
  if (!m) return null;
  const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

// ---------------------------------------------------------------- creating

const typeOf = id => state.store.element(id)?.type;

/** The relationship types ArchiMate allows from one element to the other (API). */
async function allowedBetween(from, to) {
  const { allowed = [] } = await api.allowedRelationships(typeOf(from), typeOf(to));
  return allowed;
}

async function offerTypes(from, to) {
  try {
    const allowed = await allowedBetween(from, to);
    if (!allowed.length) { status(t('ArchiMate allows no relationship from this element to that one.'), true); setMode({ connect: {} }); return; }
    setMode({ connect: { from, to, allowed } });
  } catch (e) { status(errorMessage(e), true); }
}

/** The top-level folder for a new item: its layer's (or "Relations"), the first that is there; null without one. */
async function folderFor(labels) {
  const { roots } = await state.store.loadFolders();
  const tops = new Map(roots.map(f => [(f.label || '').toLowerCase(), f]));
  for (const label of labels) if (tops.has(label.toLowerCase())) return tops.get(label.toLowerCase());
  return null;
}

/** Ask for a name (the page's own dialog); resolves to the name, or null. */
function askName(title, value = '') {
  return new Promise(resolve => {
    const input = h('input', { type: 'text', required: true, value, maxlength: 500, 'aria-label': t('Name') });
    const dialog = h('dialog', { id: 'new-name-dialog' }, h('form', { method: 'dialog' },
      h('h2', {}, title), h('label', {}, t('Name'), input),
      h('menu', {}, h('button', { value: 'cancel', formnovalidate: true }, t('Cancel')), h('button', { value: 'ok', class: 'primary' }, t('Create')))));
    $('#new-name-dialog')?.remove();
    document.body.append(dialog);
    dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'ok' && input.value.trim() ? input.value.trim() : null); dialog.remove(); }, { once: true });
    dialog.showModal();
    input.focus();
  });
}

/** After a create: the caches that list what is there, the tree, the change bar. */
export async function structureChanged({ typeChanged = true } = {}) {
  const s = state.store;
  s.lists.clear(); // relationship lists, type lists, folder contents
  s.folders = null;
  if (typeChanged) s.stats = await api.stats(s.id);
  await s.loadFolders().catch(() => {});
  ownChange();
  tree?.setRoots(buildTree(s));
}

/** A new element of `type`, named by the user, at `at` (diagram coordinates) or only into the model. */
export async function createElementAt(type, at = null, { toDiagram = true } = {}) {
  const s = state.store;
  const name = await askName(t('New {type}', { type: prettyType(type) }));
  if (!name) return null;
  try {
    // E10: one of the same type and name is named first; creating it anyway is allowed
    const same = (await api.listElements(s.id, { type, name })).filter(e => (e.name || '').trim().toLowerCase() === name.toLowerCase());
    if (same.length && !await askConfirm(t('There is a {type} “{name}” already (#{id}). Create another one?', { type: prettyType(type), name, id: same[0].id }), t('Create'))) return null;
    const folder = await folderFor(LAYER_FOLDERS[layerOf(type).key] || []);
    const answer = await api.changes(s.id, { operations: [{ op: 'createElement', type, name, ...(folder ? { folderId: folder.id } : {}) }] });
    const id = answer.results[0].id;
    await s.ensure({ elements: [id] });
    await structureChanged();
    if (toDiagram && state.gen) await addToDiagram([id], { at, exact: !!at }); // dropped: exactly there (2.27.0)
    select('element', id);
    revealInTree('element', id);
    status(t('Created {type} “{name}”.', { type: prettyType(type), name }) + (folder ? ' ' + t('Filed in {folder}.', { folder: folder.label }) : ''));
    return id;
  } catch (e) { status(errorMessage(e), true); return null; }
}

/** A new relationship of `type` from one element to another; the diagram draws it where it is. */
export async function connect(from, to, type) {
  const s = state.store;
  setMode(null);
  try {
    const allowed = await allowedBetween(from, to);
    if (!allowed.includes(type)) {
      status(t('{type} is not allowed from {source} to {target}; allowed: {list}.', {
        type, source: s.element(from)?.name || '#' + from, target: s.element(to)?.name || '#' + to, list: allowed.join(', ') || t('none') }), true);
      return null;
    }
    const folder = await folderFor(RELATIONS_FOLDERS);
    const answer = await api.changes(s.id, { operations: [{ op: 'createRelationship', type, source: { elementId: from }, target: { elementId: to }, ...(folder ? { folderId: folder.id } : {}) }] });
    const id = answer.results[0].id;
    for (const e of [from, to]) if (s.element(e)) s.element(e).degree = undefined; // their counts are asked again
    await s.ensure({ relationships: [id] });
    await structureChanged();
    if (state.gen && state.diagramDef) await renderDef(state.diagramDef, { hints: positionsOf(state.gen.shown.nodes), explorerStep: true });
    select('relationship', id);
    status(t('Created {type} from {source} to {target}.', { type, source: s.element(from)?.name || '#' + from, target: s.element(to)?.name || '#' + to })
      + (answer.warnings?.length ? ' ' + answer.warnings.join(' ') : ''));
    return id;
  } catch (e) { status(errorMessage(e), true); return null; }
}

// ---------------------------------------------------------------- "New element here…" without the mouse

/** Choose an element type (a filtered list, with the sprites); resolves to the type, or null. */
export function chooseType() {
  return new Promise(resolve => {
    const input = h('input', { type: 'search', placeholder: t('Filter types…'), 'aria-label': t('Filter the element types') });
    const list = h('ul', { class: 'type-choice', role: 'listbox' });
    const dialog = h('dialog', { id: 'type-choice-dialog' }, h('form', { method: 'dialog' },
      h('h2', {}, t('New element')), input, list,
      h('menu', {}, h('button', { value: 'cancel' }, t('Cancel')))));
    let chosen = null;
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      list.replaceChildren(...LAYERS.flatMap(l => typesOfLayer(l.key)).filter(x => !q || prettyType(x).toLowerCase().includes(q)).map(type => h('li', {},
        h('button', { type: 'button', 'data-type': type, onclick: () => { chosen = type; dialog.close(); } },
          spriteUrl(type) ? h('img', { src: spriteUrl(type), alt: '', width: 15, height: 15 }) : null, ' ', prettyType(type), h('span', { class: 'muted' }, ` · ${layerOf(type).label}`)))));
    };
    input.addEventListener('input', draw);
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); list.querySelector('button')?.click(); } });
    draw();
    $('#type-choice-dialog')?.remove();
    document.body.append(dialog);
    dialog.addEventListener('close', () => { resolve(chosen); dialog.remove(); }, { once: true });
    dialog.showModal();
    input.focus();
  });
}

/** "New element here…" (the diagram's menu): choose a type, then name it; it is drawn at the point. */
export async function newElementHere(at) {
  const type = await chooseType();
  if (type) await createElementAt(type, at);
}
