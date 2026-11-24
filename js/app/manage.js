// ArchiMate Browser: removing and organising (BR-11 step 3, 2.25.0; the API's BROWSER_EDITING.md).
//
// With ✎ Edit on (a model mastered here, a key that may write):
// * Delete… an element or a relationship: it asks first and names what goes with it (an element's
//   relationships and the views it is shown in; a relationship's attached relationships and its views). It
//   cannot be undone; the record of changes keeps what was there.
// * File in folder… an element, a relationship or a view of the source (a created view is not filed, BL-56).
// * Folders: New folder… (in a folder, or at the top), Rename…, Move to…, Delete… (an empty one, or its
//   contents moved to another folder first; what is filed in it is never deleted).
// Each is one request (/changes, one transaction) checked against the version the item was read with.

import { api } from '../api.js';
import { t } from '../i18n.js';
import { prettyType } from '../archimate.js';
import { isFolder } from '../store.js';
import { askConfirm } from './diagram.js';
import { editing } from './editing.js';
import { renderDef } from './panels.js';
import { revealInTree, select } from './routing.js';
import { $, state } from './state.js';
import { structureChanged } from './toolbox.js';
import { errorMessage, h, status } from './ui.js';

const nameOf = x => x?.name || x?.label || `#${x?.id}`;
const list = (items, n = 8) => items.slice(0, n).join(', ') + (items.length > n ? ', ' + t('and {n} more', { n: items.length - n }) : '');

async function apply(operations) {
  return api.changes(state.store.id, { operations });
}

// ---------------------------------------------------------------- deleting elements and relationships

/** "Delete…" an element: after a confirmation that names its relationships and views. */
export async function deleteElement(id) {
  const s = state.store, e = s.element(id);
  if (!editing() || !e) return;
  try {
    const [rels, views] = await Promise.all([s.relationshipsOf(id), s.viewsShowing('element', id)]);
    const n = rels.outgoing.length + rels.incoming.length;
    const text = [t('Delete the {type} “{name}”? It cannot be undone.', { type: prettyType(e.type), name: nameOf(e) }),
      n ? t('{n} relationship(s) go with it.', { n }) : null,
      views.length ? t('It is taken out of {n} view(s): {names}.', { n: views.length, names: list(views.map(nameOf)) }) : null].filter(Boolean).join(' ');
    if (!await askConfirm(text, t('Delete'))) return;
    await apply([{ op: 'deleteElement', element: { id }, cascade: true, expectedVersion: e.version }]);
    s.elements.delete(id);
    for (const r of [...rels.outgoing, ...rels.incoming]) s.relationships.delete(r.id);
    await gone(views);
    status(t('Deleted {name}', { name: nameOf(e) }) + (n ? ' ' + t('with {n} relationship(s).', { n }) : '.'));
  } catch (err) { status(errorMessage(err), true); }
}

/** "Delete…" a relationship: after a confirmation that names the relationships attached to it and its views. */
export async function deleteRelationship(id) {
  const s = state.store, r = s.relationship(id);
  if (!editing() || !r) return;
  try {
    const [attached, views] = await Promise.all([s.attachedTo(id), s.viewsShowing('relationship', id)]);
    const text = [t('Delete the {type} relationship {label}? It cannot be undone.', { type: r.type, label: s.relationshipLabel(r) }),
      attached.length ? t('{n} relationship(s) attached to it go with it.', { n: attached.length }) : null,
      views.length ? t('It is taken out of {n} view(s): {names}.', { n: views.length, names: list(views.map(nameOf)) }) : null].filter(Boolean).join(' ');
    if (!await askConfirm(text, t('Delete'))) return;
    await apply([{ op: 'deleteRelationship', relationship: { id }, expectedVersion: r.version }]);
    for (const x of [r, ...attached]) s.relationships.delete(x.id);
    for (const end of [r.sourceElementId, r.targetElementId]) if (s.element(end)) s.element(end).degree = undefined;
    await gone(views);
    status(t('Deleted the {type} relationship.', { type: r.type }));
  } catch (err) { status(errorMessage(err), true); }
}

/** After a delete: the caches, the views it was shown in, the diagram, the details. */
async function gone(views) {
  const s = state.store;
  for (const v of views) s.viewCache.delete(v.id);
  await structureChanged();
  const def = state.diagramDef;
  if (def?.kind === 'explore') renderDef({ ...def, ids: def.ids.filter(x => s.element(x)) }, { explorerStep: true });
  else if (def) renderDef(def, { explorerStep: true });
  select('model', s.id);
}

// ---------------------------------------------------------------- choosing a folder

/** Every folder as [{ id, path }], in tree order; `but` (a folder id) and what is below it left out. */
function folderChoices(but = null) {
  const s = state.store, out = [];
  const walk = (items, path) => {
    for (const f of [...items].filter(isFolder).sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (f.id === but) continue;
      const here = [...path, f.label || t('(folder)')];
      out.push({ id: f.id, path: here.join(' › ') });
      walk(f.children || [], here);
    }
  };
  walk(s.folders?.roots || [], []);
  return out;
}

/** Ask for a folder (a filtered list of paths); `top`: also "the top level". Resolves to an id, 'top', or null. */
function chooseFolder(title, { but = null, top = false, okLabel = t('Choose') } = {}) {
  return new Promise(resolve => {
    const choices = folderChoices(but);
    const filter = h('input', { type: 'search', placeholder: t('Filter folders…'), 'aria-label': t('Filter folders') });
    const select = h('select', { size: 12, required: true, 'aria-label': t('Folder') });
    const draw = () => {
      const q = filter.value.trim().toLowerCase();
      select.replaceChildren(
        top && !q ? h('option', { value: 'top' }, t('(the top level)')) : null,
        ...choices.filter(c => !q || c.path.toLowerCase().includes(q)).map(c => h('option', { value: String(c.id) }, c.path)));
      if (select.options.length) select.selectedIndex = 0;
    };
    filter.addEventListener('input', draw);
    draw();
    const dialog = h('dialog', { id: 'folder-choice-dialog' }, h('form', { method: 'dialog' },
      h('h2', {}, title), filter, select,
      h('menu', {}, h('button', { value: 'cancel', formnovalidate: true }, t('Cancel')), h('button', { value: 'ok', class: 'primary' }, okLabel))));
    select.addEventListener('dblclick', () => { dialog.returnValue = 'ok'; dialog.close('ok'); });
    $('#folder-choice-dialog')?.remove();
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      const v = dialog.returnValue === 'ok' ? select.value : '';
      resolve(v === 'top' ? 'top' : v ? Number(v) : null);
      dialog.remove();
    }, { once: true });
    dialog.showModal();
    filter.focus();
  });
}

/** Ask for a folder's name (and documentation); resolves to { label, documentation } or null. */
function askFolderName(title, folder = null) {
  return new Promise(resolve => {
    const name = h('input', { type: 'text', required: true, value: folder?.label || '', 'aria-label': t('Name') });
    const doc = h('textarea', { rows: 3, 'aria-label': t('Documentation') });
    doc.value = folder?.documentation || '';
    const dialog = h('dialog', { id: 'folder-name-dialog' }, h('form', { method: 'dialog' },
      h('h2', {}, title), h('label', {}, t('Name'), name), h('label', {}, t('Documentation'), doc),
      h('menu', {}, h('button', { value: 'cancel', formnovalidate: true }, t('Cancel')), h('button', { value: 'ok', class: 'primary' }, t('Save')))));
    $('#folder-name-dialog')?.remove();
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok' && name.value.trim() ? { label: name.value.trim(), documentation: doc.value.trim() || null } : null);
      dialog.remove();
    }, { once: true });
    dialog.showModal();
    name.focus();
  });
}

// ---------------------------------------------------------------- filing and folders

/** "File in folder…": an element, a relationship or a view (kind) leaves its folders for the one chosen. */
export async function fileItem(kind, id) {
  const s = state.store;
  const item = kind === 'element' ? s.element(id) : kind === 'relationship' ? s.relationship(id) : s.view(id);
  if (!editing() || !item) return;
  await s.loadFolders();
  const to = await chooseFolder(t('File “{name}” in a folder', { name: kind === 'relationship' ? s.relationshipLabel(item) : nameOf(item) }), { okLabel: t('File it') });
  if (to == null || to === 'top') return;
  await run([{ op: 'fileItem', item: { kind, id }, folderId: to, expectedVersion: item.version }],
    t('Filed in {path}.', { path: s.folderPath(to).map(f => f.label).join(' › ') }), () => revealInTree(kind, id, { via: 'folders' }));
}

/** "New folder…": in `parentId`, or at the top level (null). */
export async function newFolder(parentId = null) {
  const s = state.store;
  if (!editing()) return;
  await s.loadFolders();
  const asked = await askFolderName(parentId ? t('New folder in {name}', { name: nameOf(s.folders.byId.get(parentId)) }) : t('New top-level folder'));
  if (!asked) return;
  await run([{ op: 'createFolder', ref: 'new', ...asked, ...(parentId ? { parent: { id: parentId } } : {}) }],
    t('Folder “{name}” made.', { name: asked.label }), answer => {
      const id = answer.results[0].id;
      select('folder', id);
      revealInTree('folder', id);
    });
}

/** "Rename…" a folder (its name and documentation). */
export async function renameFolder(id) {
  const s = state.store, f = s.folders?.byId.get(id);
  if (!editing() || !f) return;
  const asked = await askFolderName(t('Rename folder'), f);
  if (!asked) return;
  // 2.29.0: the version of the folder as the tree shows it (refused, 412, when someone changed it since; an API
  // with REQUIRE_IF_MATCH refuses a change without one, 428)
  await run([{ op: 'updateFolder', folder: { id }, ...asked, expectedVersion: f.version }], t('Folder renamed to “{name}”.', { name: asked.label }), () => select('folder', id));
}

/** "Move to…" a folder: into another folder, or to the top level; never below itself. */
export async function moveFolder(id) {
  const s = state.store, f = s.folders?.byId.get(id);
  if (!editing() || !f) return;
  const to = await chooseFolder(t('Move “{name}” to…', { name: nameOf(f) }), { but: id, top: true, okLabel: t('Move it') });
  if (to == null) return;
  await run([{ op: 'updateFolder', folder: { id }, parent: to === 'top' ? null : { id: to }, expectedVersion: f.version }],
    t('Folder moved.'), () => { select('folder', id); revealInTree('folder', id); });
}

/** "Delete…" a folder: an empty one after a confirmation; one with contents, after choosing where they go. */
export async function deleteFolder(id) {
  const s = state.store, f = s.folders?.byId.get(id);
  if (!editing() || !f) return;
  const c = s.folderCounts(id);
  const direct = (f.children || []).length + (await s.folderItems(id).then(x => x.elements.length + x.relationships.length + x.views.length).catch(() => 0));
  let move = null;
  if (direct) {
    move = await chooseFolder(t('Delete “{name}”: where do its contents go?', { name: nameOf(f) }), { but: id, okLabel: t('Move them and delete') });
    if (move == null || move === 'top') { if (move === 'top') status(t('Choose a folder for the contents.'), true); return; }
  } else if (!await askConfirm(t('Delete the empty folder “{name}”?', { name: nameOf(f) }), t('Delete'))) return;
  await run([{ op: 'deleteFolder', folder: { id }, ...(move ? { moveContentsTo: { id: move } } : {}), expectedVersion: f.version }],
    direct ? t('Folder deleted; its {n} item(s) moved.', { n: c.elements + c.relationships + c.views + c.folders }) : t('Folder deleted.'),
    () => select('model', s.id));
}

/** One request of folder changes, then the tree and what to show. */
async function run(operations, done, then) {
  try {
    const answer = await apply(operations);
    await structureChanged({ typeChanged: false });
    status(done);
    then?.(answer);
  } catch (err) { status(errorMessage(err), true); }
}
