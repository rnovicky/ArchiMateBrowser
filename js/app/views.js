// ArchiMate Browser: created views (BR-25, 2.22.0), the Browser's first writes (API 3.15.0, BL-56).
//
// A view is a source view (it came from the model's file) or a created view (made through the API).
// Source views are never changed. A generated diagram, an editable copy of a view among them, is saved as a
// new created view: *Save as view…*. A created view is edited as a generated diagram of its elements, each
// pinned where the view has it, so that dragging, Tidy, adding, expanding and hiding work as everywhere;
// *Save* writes the diagram as drawn back into the view (If-Match: someone who saved in between is not
// overwritten), *Discard* shows the view again. What an update from the source took out of a created view
// is shown in its details until it is saved again. All of this needs a key that may write; an offline copy
// never offers it. See the API's CREATED_VIEWS.md.

import { api, isOffline, olderThan } from '../api.js';
import { t } from '../i18n.js';
import * as graph from '../graph.js';
import { escapeRef } from '../refs.js';
import { contentOfLayout, contentOfView, isCreated } from '../viewcontent.js';
import { describeDef, flatViewNodes, isNote, showView } from './diagram.js';
import { ownChange } from './history.js';
import { tree } from './models.js';
import { renderDef } from './panels.js';
import { applyHash, modelRef, recipeOfDiagram, resolveHash, revealInTree, select } from './routing.js';
import { $, state } from './state.js';
import { docPanel } from './tabs.js';
import { buildTree } from './treespecs.js';
import { errorMessage, h, may, status } from './ui.js';

export { isCreated };

/** May this page write views: a key that may write, not an offline copy, an API that has created views (3.15.0). */
export const canWrite = () => !isOffline() && may('write') && !!state.apiVersion && !olderThan(state.apiVersion, '3.15.0');

/**
 * 2.31.0: may this page rename and delete the view: a created view or recipe; or (API 3.23.0) a view of the model's
 * source on a model mastered here (a linked model's views come from its file and are changed there).
 */
export const canManageView = v => canWrite() && !!v
  && (isCreated(v) || (state.store?.model?.master === 'api' && !olderThan(state.apiVersion, '3.23.0')));

/** The view a tab edits ({ viewId, name, version }), or null. */
export const editingOf = (doc = state.doc) => (doc?.editing && state.store?.view(doc.editing.viewId) ? doc.editing : null);

/** 2.30.0: a recipe: a created view that holds the recipe of a generated diagram (its link) instead of a drawing. */
export const isRecipe = v => isCreated(v) && v?.recipe != null;

/** May this page save recipes: as canWrite, with an API that has them (3.22.0). */
export const canRecipe = () => canWrite() && !olderThan(state.apiVersion, '3.22.0');

/** The recipe a tab's diagram was opened from (it may be saved back into it), or null. */
export const recipeOf = (doc = state.doc) => (doc?.recipeOf != null && isRecipe(state.store?.view(doc.recipeOf)) ? state.store.view(doc.recipeOf) : null);

/** A view's mark in the tree, the tabs and the palette: a pencil for a created view, a scroll for a recipe. */
export const viewIcon = v => (isRecipe(v) ? '📜' : isCreated(v) ? '✎' : '🖼');

/** "Created by jnovak on 29 Oct 2026", "Copy of view 'X'", or "From the model's source". */
export function originText(v) {
  if (!isCreated(v)) return t('From the model\'s source');
  const by = v.createdBy || t('someone');
  const on = v.createdAt ? new Date(v.createdAt + (v.createdAt.endsWith('Z') ? '' : 'Z')).toLocaleDateString() : '';
  const made = on ? t('Created by {who} on {date}', { who: by, date: on }) : t('Created by {who}', { who: by });
  const source = v.basedOn ? state.store?.views.find(x => x.xmiIdentifier === v.basedOn) : null;
  const copy = source ? `${made} · ${t('copy of view “{name}”', { name: source.name })}` : made;
  // 2.33.0 (API 3.24.0): made by a recipe script, which updates it when it runs again
  return v.script ? `${copy} · ${t('made by the recipe script “{name}”', { name: v.script })}` : copy;
}

// ---------------------------------------------------------------- a dialog for the name

/** Ask for a view's name and documentation; resolves to { name, documentation } or null. */
export function askNameAndText({ title, name = '', documentation = '', okLabel }) {
  return new Promise(resolve => {
    const nameInput = h('input', { type: 'text', required: true, value: name, maxlength: 500, 'aria-label': t('Name') });
    const docInput = h('textarea', { rows: 4, 'aria-label': t('Documentation') });
    docInput.value = documentation || '';
    const dialog = h('dialog', { id: 'view-name-dialog', 'aria-labelledby': 'view-name-title' },
      h('form', { method: 'dialog' },
        h('h2', { id: 'view-name-title' }, title),
        h('label', {}, t('Name'), nameInput),
        h('label', {}, t('Documentation'), docInput),
        h('menu', {},
          h('button', { value: 'cancel', formnovalidate: true }, t('Cancel')),
          h('button', { value: 'ok', class: 'primary' }, okLabel))));
    $('#view-name-dialog')?.remove();
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      const ok = dialog.returnValue === 'ok' && nameInput.value.trim();
      resolve(ok ? { name: nameInput.value.trim(), documentation: docInput.value.trim() || null } : null);
      dialog.remove();
    }, { once: true });
    dialog.showModal();
    nameInput.select();
  });
}

// ---------------------------------------------------------------- after a write

/** The store and the tree after this page made or changed a view; the view is selected in the tree. */
function written(view) {
  const s = state.store;
  s.putView(view);
  ownChange();
  tree?.setRoots(buildTree(s));
  revealInTree('view', view.id);
}

function failed(e, what) {
  if (e.status === 412) {
    status(t('{what}: someone saved this view meanwhile. Show it again to see their version.', { what }), true);
    return;
  }
  status(`${what}: ${errorMessage(e)}`, true);
}

// ---------------------------------------------------------------- saving a generated diagram

/** The content of the generated diagram of a tab, as drawn. */
const drawnContent = (doc = state.doc) => contentOfLayout(doc.gen.shown);

/** The source view a generated diagram is a copy of (an editable copy), by XMI identifier. */
function basedOn(doc) {
  const v = state.store.view(doc.diagramDef?.notes?.view ?? doc.copyOf);
  return v && !isCreated(v) ? v.xmiIdentifier : null;
}

/** "Save as view…": the generated diagram of this tab as a new created view. */
export async function saveAsView(doc = state.doc) {
  if (!doc.gen?.shown) { status(t('Nothing to save: the diagram is still being laid out.'), true); return; }
  const editing = editingOf(doc);
  const source = state.store.view(doc.copyOf);
  const name = doc.proposal?.name
    || (editing ? t('Copy of {name}', { name: editing.name }) : source ? t('Copy of {name}', { name: source.name }) : describeDef(doc.diagramDef));
  const asked = await askNameAndText({ title: t('Save as view'), name, okLabel: t('Save') });
  if (!asked) return;
  const content = drawnContent(doc);
  try {
    const view = await api.createView(state.store.id, { ...asked, basedOn: basedOn(doc), content });
    written(view);
    doc.editing = null;
    doc.proposal = null;
    status(t('Saved as view “{name}” ({n} nodes).', { name: view.name, n: content.nodes.length }));
    showView(view.id, [], doc);
  } catch (e) { failed(e, t('Save as view')); }
}

// ---------------------------------------------------------------- recipes (2.30.0, API 3.22.0)

/** "Save as recipe…": the generated diagram shown kept as its recipe (the link: what it draws, filters, nesting). */
export async function saveAsRecipe(doc = state.doc) {
  const recipe = doc === state.doc ? recipeOfDiagram() : null;
  if (!recipe) { status(t('Only a generated diagram is saved as a recipe.'), true); return; }
  const asked = await askNameAndText({ title: t('Save as recipe'), name: doc.diagram?.title || describeDef(doc.diagramDef), okLabel: t('Save') });
  if (!asked) return;
  try {
    const view = await api.createView(state.store.id, { ...asked, recipe });
    written(view);
    doc.recipeOf = view.id;
    const button = docPanel(doc).querySelector('[data-tool="save-recipe"]');
    if (button) {
      button.textContent = t('Save recipe “{name}”', { name: view.name });
      button.title = t('Write what this diagram draws, its filters and options back into the recipe it was opened from');
    }
    status(t('Saved as recipe “{name}”: it draws the diagram again from the model as it is then.', { name: view.name }));
  } catch (e) { failed(e, t('Save as recipe')); }
}

/** "Save recipe “…”": the diagram shown written back into the recipe it was opened from. */
export async function saveIntoRecipe(doc = state.doc) {
  const v = recipeOf(doc), recipe = doc === state.doc ? recipeOfDiagram() : null;
  if (!v || !recipe) return;
  try {
    written(await api.updateView(state.store.id, v.id, { recipe }, { version: v.version }));
    status(t('Recipe “{name}” saved.', { name: v.name }));
  } catch (e) { failed(e, t('Save recipe')); }
}

/** A recipe opened: its diagram drawn from the model as it is now, with the recipe's filters and options. */
export async function openRecipe(viewId) {
  const s = state.store, v = s.view(viewId);
  if (!isRecipe(v)) return;
  const hash = { model: modelRef(s.model), ...Object.fromEntries(new URLSearchParams(v.recipe)) };
  try {
    const resolved = await resolveHash(hash);
    if (!resolved.d) { status(t('Recipe “{name}”: what it draws is not in the model any more.', { name: v.name }), true); return; }
    applyHash(resolved);
    state.doc.recipeOf = viewId;
  } catch (e) { status(`${t('Recipe “{name}”', { name: v.name })}: ${errorMessage(e)}`, true); }
}

/** 2.35.0: an entry of a live recipe template: its diagram drawn from the model as it is now. */
export async function openLiveRecipe(recipe, name) {
  const s = state.store;
  try {
    const resolved = await resolveHash({ model: modelRef(s.model), ...Object.fromEntries(new URLSearchParams(recipe)) });
    if (!resolved.d) { status(t('“{name}”: what it draws is not in the model any more.', { name }), true); return; }
    applyHash(resolved);
  } catch (e) { status(`“${name}”: ${errorMessage(e)}`, true); }
}

/** "Save": the generated diagram of a tab that edits a created view, written back into it. */
export async function saveIntoView(doc = state.doc) {
  const editing = editingOf(doc);
  if (!editing || !doc.gen?.shown) return;
  const content = drawnContent(doc);
  try {
    const answer = await api.putViewContent(state.store.id, editing.viewId, content, { version: editing.version });
    written(answer.view);
    doc.editing = null;
    status(t('View “{name}” saved ({n} nodes).', { name: answer.view.name, n: content.nodes.length }));
    showView(editing.viewId, [], doc);
  } catch (e) { failed(e, t('Save')); }
}

/** "Discard": the view again, as it is stored. */
export function discardEdit(doc = state.doc) {
  const editing = editingOf(doc);
  doc.editing = null;
  if (editing) showView(editing.viewId, [], doc);
}

// ---------------------------------------------------------------- editing a created view

/**
 * "Edit": a generated diagram of the view's elements and notes, each pinned where the view has it; the
 * relationships the view does not draw stay hidden. The tab remembers the view: its bar offers Save.
 */
export async function editView(viewId) {
  const s = state.store, v = s.view(viewId);
  if (!v || !isCreated(v)) return;
  status(t('Loading view "{name}"…', { name: v.name }));
  try {
    const [{ nodes, connections }, fresh] = await Promise.all([s.viewContent(viewId), api.getView(s.id, viewId)]);
    const pins = new Map();
    for (const n of flatViewNodes(nodes)) {
      if (n.elementRefId != null && s.element(n.elementRefId) && !pins.has(`e${n.elementRefId}`)) pins.set(`e${n.elementRefId}`, { x: n.x, y: n.y });
      else if (isNote(n)) pins.set(`n${escapeRef(n.xmiIdentifier)}`, { x: n.x, y: n.y });
    }
    const ids = [...pins.keys()].filter(k => k[0] === 'e').map(k => Number(k.slice(1)));
    const refs = [...pins.keys()].filter(k => k[0] === 'n').map(k => k.slice(1));
    // relationships between its elements that the view does not draw stay hidden
    // (those shown by nesting a box in another are not hidden: hiding them would undo the nesting)
    const drawn = new Set(connections.map(c => c.relationshipRefId).filter(x => x != null));
    const all = ids.length ? await graph.subgraph(s, { elementIds: ids }) : { relationships: [], nesting: null };
    const nested = new Set([...(all.nesting?.nestedRelIds || []), ...(all.nesting?.ancestorEdgeIds || [])]);
    const hiddenRels = all.relationships.map(r => r.id).filter(id => !drawn.has(id) && !nested.has(id));
    const doc = state.doc;
    await renderDef({ kind: 'explore', seeds: [], ids, ...(hiddenRels.length ? { hiddenRels } : {}), ...(refs.length ? { notes: { view: viewId, refs } } : {}) },
      { hints: pins, pins, doc });
    doc.editing = { viewId, name: v.name, version: fresh.version };
    s.putView(fresh);
    status(t('Editing view “{name}”: move, add or hide elements, then Save.', { name: v.name }));
  } catch (e) { failed(e, t('Edit view')); }
}

/** The bar above a tab that edits a created view: what it edits, Save, Save as a new view, Discard. */
export function editBar(doc) {
  const editing = editingOf(doc);
  if (!editing || !doc.gen) return null;
  return h('div', { class: 'edit-bar', role: 'status' },
    h('span', {}, '✎ ', t('Editing view “{name}”', { name: editing.name })),
    h('button', { type: 'button', class: 'primary', 'data-edit': 'save', onclick: () => saveIntoView(doc) }, t('Save')),
    h('button', { type: 'button', 'data-edit': 'save-as', onclick: () => saveAsView(doc) }, t('Save as new view…')),
    h('button', { type: 'button', 'data-edit': 'discard', onclick: () => discardEdit(doc) }, t('Discard')));
}

/**
 * The bar above a proposed view (2.22.1): a link of the MCP server's propose_view names the view to make; the
 * diagram is arranged here and saved. Without a key that may write it says so.
 */
export function proposalBar(doc) {
  if (!doc.proposal || !doc.gen) return null;
  return h('div', { class: 'edit-bar', role: 'status' },
    h('span', {}, '✎ ', t('Proposed view “{name}”: arrange it, then save it.', { name: doc.proposal.name })),
    canWrite()
      ? h('button', { type: 'button', class: 'primary', 'data-edit': 'save-proposal', onclick: () => saveAsView(doc) }, t('Save as view…'))
      : h('span', { class: 'muted' }, t('Your key may not save views.')));
}

// ---------------------------------------------------------------- name, deletion, what was lost

/** "Rename…": a created view's name and documentation. */
export async function renameView(viewId) {
  const s = state.store, v = s.view(viewId);
  if (!canManageView(v)) return;
  const asked = await askNameAndText({ title: t('Rename view'), name: v.name, documentation: v.documentation, okLabel: t('Save') });
  if (!asked) return;
  try {
    written(await api.updateView(s.id, viewId, asked, { version: v.version }));
    if (state.diagramDef?.kind === 'view' && state.diagramDef.id === viewId) showView(viewId, state.diagramDef.trail || []);
    if (state.selection?.kind === 'view' && state.selection.id === viewId) select('view', viewId);
    status(t('View renamed to “{name}”.', { name: asked.name }));
  } catch (e) { failed(e, t('Rename view')); }
}

/** "Delete…": a created view, after a confirmation; it cannot be undone. */
export async function deleteView(viewId) {
  const s = state.store, v = s.view(viewId);
  if (!canManageView(v)) return;
  const { askConfirm } = await import('./diagram.js');
  // 2.31.0: a view of the model's source comes back with a replace of the model from its file
  const text = isCreated(v) ? t('Delete the view “{name}”? This cannot be undone.', { name: v.name })
    : t('Delete the view “{name}”? It came with the model\'s file: this cannot be undone here, and a replace of the model from a file that has it brings it back.', { name: v.name });
  if (!await askConfirm(text, t('Delete view'))) return;
  try {
    await api.deleteView(s.id, viewId, { version: v.version });
    s.dropView(viewId);
    ownChange();
    tree?.setRoots(buildTree(s));
    for (const d of state.docs) if (d.editing?.viewId === viewId) d.editing = null;
    if (state.diagramDef?.kind === 'view' && state.diagramDef.id === viewId) renderDef({ kind: 'explore', seeds: [], ids: [] });
    select('model', s.id);
    status(t('View “{name}” deleted.', { name: v.name }));
  } catch (e) { failed(e, t('Delete view')); }
}

/** What the last update from the source took out of a created view, with "Dismiss" (it saves the view as it is). */
export function lostBox(v) {
  if (!isCreated(v) || !v.lost?.length) return null;
  const what = x => `${x.type || (x.kind === 'view' ? t('view') : x.kind)} “${x.name || x.xmiIdentifier}”`;
  const why = { gone: t('no longer in the model'), 'ends changed': t('now joins other elements'), 'end gone': t('what it joined went') };
  return h('div', { class: 'lost-box', role: 'note' },
    h('p', {}, t('The last update from the source took out {n} item(s) of this view:', { n: v.lost.length })),
    h('ul', {}, v.lost.slice(0, 12).map(x => h('li', {}, what(x), h('span', { class: 'muted' }, ` (${why[x.reason] || x.reason})`)))),
    v.lost.length > 12 ? h('p', { class: 'muted' }, t('… and {n} more', { n: v.lost.length - 12 })) : null,
    canWrite() ? h('button', { type: 'button', onclick: () => dismissLost(v.id) }, t('Dismiss')) : null);
}

/** "Dismiss": the view saved unchanged, which clears the list. */
export async function dismissLost(viewId) {
  const s = state.store, v = s.view(viewId);
  if (!v) return;
  try {
    const content = contentOfView(await s.viewContent(viewId));
    const answer = await api.putViewContent(s.id, viewId, content, { version: v.version });
    written(answer.view);
    select('view', viewId);
  } catch (e) { failed(e, t('Dismiss')); }
}
