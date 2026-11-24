// ArchiMate Browser: editing (BR-11, 2.23.0; the API's BROWSER_EDITING.md, step 1: change what is there).
//
// Only a model mastered here (API 3.16.0: `master: "api"`) is edited; one linked to a file stays read-only, and
// says why. Editing is switched on with ✎ Edit in the top bar, per browser tab, by a key that may write, never in
// an offline copy. Then the details of an element or a relationship are a form: name, documentation, type (and a
// relationship's attributes), properties. *Save* sends what changed in one request (/changes: one transaction),
// checked against the version the form was opened with; when someone saved in between (412) the form says who
// and what, and offers to take their version or to save anyway. The page's own change is not reported as a
// change by someone else. The record of changes keeps the before; History offers to put a value back.

import { api } from '../api.js';
import { t } from '../i18n.js';
import { LAYERS, layerOf, prettyType, typesOfLayer, ELEMENT_TYPES } from '../archimate.js';
import { drawGenerated, showView } from './diagram.js';
import { ownChange } from './history.js';
import { tree } from './models.js';
import { revealInTree, select } from './routing.js';
import { $, state } from './state.js';
import { buildTree } from './treespecs.js';
import { errorMessage, h, status } from './ui.js';
import { canWrite } from './views.js';
import { cancelPalette } from './toolbox.js';

const KEY = 'archixmi-edit-mode'; // sessionStorage: this browser tab only (E5)
const ACCESS_TYPES = ['Access', 'Read', 'Write', 'ReadWrite'];

// ---------------------------------------------------------------- may it, and is it on

/** Why the open model cannot be edited (a text), or null when it can. */
export function whyNotEditable() {
  const m = state.store?.model;
  if (!m) return t('Open a model first.');
  if (!canWrite()) return t('Your key may not change the model, or this is an offline copy.');
  if (!m.master) return t('The API is too old for editing (it needs 3.16.0).');
  if (m.master === 'file') return t('This model is linked to a file and is updated from it: it is read-only here. Change it in Archi, or unlink it.');
  return null;
}

export const canEdit = () => whyNotEditable() === null;

/** Is editing on (and possible)? */
export const editing = () => !!state.editMode && canEdit();

export function initEditMode() {
  try { state.editMode = sessionStorage.getItem(KEY) === '1'; } catch { state.editMode = false; }
  syncEditButton();
}

export function setEditMode(on) {
  state.editMode = !!on && canEdit();
  try { sessionStorage.setItem(KEY, state.editMode ? '1' : '0'); } catch { /* storage unavailable: on for this page only */ }
  syncEditButton();
  if (state.selection) select(state.selection.kind, state.selection.id);
  if (state.gen) drawGenerated(state.layout?.view()); // the palette (2.24.0) comes or goes
  if (!state.editMode) cancelPalette();
}

/** The ✎ Edit button of the top bar: shown to a key that may write; pressed while editing is on. */
export function syncEditButton() {
  const btn = $('#btn-edit-mode');
  if (!btn) return;
  const why = whyNotEditable();
  btn.hidden = !canWrite() || !state.store;
  btn.disabled = why !== null;
  btn.setAttribute('aria-pressed', String(editing()));
  // what it does is in its tooltip, not in the status line (2.25.1)
  btn.title = why || (editing()
    ? t('Editing is on: the details of an element or a relationship can be changed. Click to turn it off.')
    : t('Editing is off. Click to turn on editing of names, documentation, types and properties.'));
}

/** "Mastered here: changed 3 times since its import" / "Linked to a file: read-only", for the model's details. */
export function masterText(m) {
  if (m.master === 'file') return t('Its file (linked): read-only here');
  if (m.master !== 'api') return null;
  return m.editedSinceImport
    ? t('Here (the API): changed {n} time(s) since its last import, which a replace from a file would undo', { n: m.editedSinceImport })
    : t('Here (the API)');
}

// ---------------------------------------------------------------- the form

/** The edit form of an element or a relationship (kind), for the details; null when editing is off. */
export function editForm(kind, item) {
  if (!editing() || !item) return null;
  const s = state.store;
  const field = (label, input) => h('label', { class: 'field edit-field' }, h('span', {}, label), input);
  const name = h('input', { type: 'text', name: 'name', value: item.name || '', maxlength: 500 });
  const doc = h('textarea', { name: 'documentation', rows: 4 });
  doc.value = item.documentation || '';
  const fields = [field(t('Name'), name), field(t('Documentation'), doc)];

  let type = null;
  if (kind === 'element') {
    // E13: the types of its layer first, the others below
    const own = layerOf(item.type);
    const others = ELEMENT_TYPES.filter(x => layerOf(x).key !== own.key);
    type = h('select', { name: 'type' },
      h('optgroup', { label: own.label }, typesOfLayer(own.key).map(x => h('option', { value: x, selected: x === item.type }, prettyType(x)))),
      LAYERS.filter(l => l.key !== own.key).map(l => {
        const list = others.filter(x => layerOf(x).key === l.key);
        return list.length ? h('optgroup', { label: l.label }, list.map(x => h('option', { value: x }, prettyType(x)))) : null;
      }));
    fields.push(field(t('Type'), type));
  } else {
    // the types ArchiMate allows between its ends, asked of the API
    type = h('select', { name: 'type' }, h('option', { value: item.type, selected: true }, item.type));
    const endType = (eid, rid) => (eid != null ? s.element(eid)?.type : rid != null ? 'Relationship' : null);
    const source = endType(item.sourceElementId, item.sourceRelationshipId), target = endType(item.targetElementId, item.targetRelationshipId);
    if (source && target) {
      api.allowedRelationships(source, target).then(({ allowed = [] }) => {
        const all = [...new Set([item.type, ...allowed])];
        type.replaceChildren(...all.map(x => h('option', { value: x, selected: x === item.type }, x)));
      }).catch(() => { /* the current type stays the only choice */ });
    }
    fields.push(field(t('Type'), type));
    if (item.type === 'Access' || item.accessType) {
      fields.push(field(t('Access'), h('select', { name: 'accessType' },
        ACCESS_TYPES.map(x => h('option', { value: x, selected: x === (item.accessType || 'Write') }, x)))));
    }
    if (item.type === 'Influence') fields.push(field(t('Influence'), h('input', { type: 'text', name: 'influenceModifier', value: item.influenceModifier || '' })));
    if (item.type === 'Association') {
      fields.push(h('label', { class: 'field edit-field' }, h('input', { type: 'checkbox', name: 'isDirected', checked: !!item.isDirected }), t('Directed')));
    }
  }

  // properties: a value is changed in place, removed with ✕, added in the last row
  const rows = (item.properties || []).map(p => {
    const value = h('input', { type: 'text', value: p.value ?? '', 'data-prop': p.propertyDefinitionName, 'data-lang': p.lang || '' });
    const drop = h('input', { type: 'checkbox', 'aria-label': t('Remove {name}', { name: p.propertyDefinitionName }), 'data-drop': p.propertyDefinitionName, 'data-lang': p.lang || '' });
    return h('tr', {}, h('th', {}, p.propertyDefinitionName, p.lang ? h('span', { class: 'muted' }, ` [${p.lang}]`) : ''), h('td', {}, value),
      h('td', { class: 'edit-drop', title: t('Remove') }, h('label', {}, drop, ' ✕')));
  });
  const names = h('datalist', { id: 'edit-prop-names' });
  api.propertyDefinitions(s.id).then(defs => names.replaceChildren(...defs.map(d => h('option', { value: d.name })))).catch(() => {});
  const newName = h('input', { type: 'text', name: 'newName', list: 'edit-prop-names', placeholder: t('New property') });
  const newValue = h('input', { type: 'text', name: 'newValue', placeholder: t('Value') });
  const props = h('table', { class: 'edit-props' }, rows, h('tr', {}, h('th', {}, newName), h('td', {}, newValue), h('td', {})));

  const out = h('div', { class: 'edit-result', role: 'status' });
  const form = h('form', { id: 'edit-form', class: 'edit-form', 'data-kind': kind, 'data-id': item.id },
    h('h3', {}, '✎ ', t('Edit')), ...fields, h('h4', {}, t('Properties')), props, names, out,
    h('div', { class: 'actions' },
      h('button', { type: 'submit', class: 'primary', 'data-edit': 'save' }, t('Save')),
      h('button', { type: 'button', 'data-edit': 'cancel', onclick: () => select(kind, item.id) }, t('Cancel'))));
  form.addEventListener('submit', ev => { ev.preventDefault(); save(kind, item, form, out); });
  return form;
}

/** The operations of /changes the form asks for, compared with `item` (the version it was opened with). */
function operationsOf(kind, item, form, version) {
  const ref = kind === 'element' ? { element: { id: item.id } } : { relationship: { id: item.id } };
  const fields = {};
  const name = form.name.value.trim(), doc = form.documentation.value.trim();
  if (name !== (item.name || '')) fields.name = name || null;
  if (doc !== (item.documentation || '')) fields.documentation = doc || null;
  if (form.type && form.type.value !== item.type) fields.type = form.type.value;
  if (form.accessType && form.accessType.value !== (item.accessType || 'Write')) fields.accessType = form.accessType.value;
  if (form.influenceModifier && form.influenceModifier.value.trim() !== (item.influenceModifier || '')) fields.influenceModifier = form.influenceModifier.value.trim() || null;
  if (form.isDirected && form.isDirected.checked !== !!item.isDirected) fields.isDirected = form.isDirected.checked;
  const ops = [];
  const owner = { kind, id: item.id };
  if (Object.keys(fields).length) ops.push({ op: kind === 'element' ? 'updateElement' : 'updateRelationship', ...ref, expectedVersion: version, ...fields });
  for (const input of form.querySelectorAll('input[data-drop]')) {
    if (input.checked) ops.push({ op: 'removeProperty', owner, name: input.dataset.drop, ...(input.dataset.lang ? { lang: input.dataset.lang } : {}), expectedVersion: version });
  }
  const dropped = new Set([...form.querySelectorAll('input[data-drop]:checked')].map(i => `${i.dataset.drop}|${i.dataset.lang}`));
  for (const input of form.querySelectorAll('input[data-prop]')) {
    const p = (item.properties || []).find(x => x.propertyDefinitionName === input.dataset.prop && (x.lang || '') === input.dataset.lang);
    if (!dropped.has(`${input.dataset.prop}|${input.dataset.lang}`) && p && input.value !== (p.value ?? '')) {
      ops.push({ op: 'setProperty', owner, name: input.dataset.prop, value: input.value, ...(input.dataset.lang ? { lang: input.dataset.lang } : {}), expectedVersion: version });
    }
  }
  if (form.newName.value.trim()) ops.push({ op: 'setProperty', owner, name: form.newName.value.trim(), value: form.newValue.value, expectedVersion: version });
  return { ops, typeChanged: 'type' in fields, nameChanged: 'name' in fields };
}

async function save(kind, item, form, out, version = item.version) {
  const { ops, typeChanged, nameChanged } = operationsOf(kind, item, form, version);
  if (!ops.length) { out.className = 'edit-result'; out.textContent = t('Nothing to save: nothing was changed.'); return; }
  const s = state.store;
  const buttons = form.querySelectorAll('button');
  buttons.forEach(b => { b.disabled = true; });
  out.className = 'edit-result';
  out.textContent = t('Saving…');
  try {
    const answer = await api.changes(s.id, { operations: ops });
    await written(kind, item.id, { typeChanged, nameChanged });
    status(t('Saved: {n} change(s).', { n: ops.length }) + (answer.warnings?.length ? ' ' + answer.warnings.join(' ') : ''), !!answer.warnings?.length);
  } catch (e) {
    buttons.forEach(b => { b.disabled = false; });
    if (e.status === 412 && e.current) { conflict(kind, item, form, out, e); return; }
    out.className = 'edit-result error';
    out.textContent = errorMessage(e);
  }
}

/** E8: someone saved in between. What they changed; take theirs, or save mine on top of theirs. */
function conflict(kind, item, form, out, e) {
  const c = e.lastChange || {};
  const when = c.time ? new Date(c.time.endsWith('Z') ? c.time : c.time + 'Z').toLocaleString() : '';
  const what = Object.keys(c.after || {}).map(k => (['name', 'value', 'type'].includes(k)
    ? `${k}: “${c.before?.[k] ?? ''}” → “${c.after[k] ?? ''}”` : k)).join('; ');
  out.className = 'edit-result error';
  out.replaceChildren(
    h('p', {}, t('Someone saved this in between: {who} on {when}{via}.', { who: c.user || t('someone'), when, via: c.client ? ` (${c.client})` : '' })),
    what ? h('p', { class: 'muted' }, what) : null,
    h('div', { class: 'actions' },
      h('button', { type: 'button', 'data-edit': 'theirs', onclick: async () => {
        await refresh(kind, item.id);
        select(kind, item.id);
        status(t('Their version is shown; your changes were not saved.'));
      } }, t('Take theirs')),
      h('button', { type: 'button', 'data-edit': 'mine', onclick: () => save(kind, item, form, out, e.current.version) }, t('Save mine anyway'))));
}

/** The item as the API has it now, into the store. */
async function refresh(kind, id) {
  const s = state.store;
  const fresh = kind === 'element' ? await api.getElement(s.id, id) : await api.getRelationship(s.id, id);
  s.remember(kind === 'element' ? { elements: [fresh] } : { relationships: [fresh] });
  return fresh;
}

/** After a save: the store, the tree, the diagram and the details show the item as saved. */
async function written(kind, id, { typeChanged, nameChanged }) {
  const s = state.store;
  await refresh(kind, id);
  ownChange();
  if (typeChanged) s.stats = await api.stats(s.id); // the counts per type of the tree
  if (typeChanged || nameChanged) {
    tree?.setRoots(buildTree(s));
    revealInTree(kind, id);
  }
  if (state.gen) drawGenerated(state.layout?.view());
  else if (state.diagramDef?.kind === 'view') showView(state.diagramDef.id, state.diagramDef.trail || []);
  select(kind, id);
}

/** E9: a value from the record of changes back into the open form (History, "Put back"). */
export function putBack(entry) {
  const form = $('#edit-form');
  if (!form || form.dataset.kind !== entry.kind || Number(form.dataset.id) !== entry.itemId) return false;
  for (const key of ['name', 'documentation']) {
    if (entry.before && key in entry.before && form[key]) form[key].value = entry.before[key] ?? '';
  }
  form.name.focus();
  status(t('The earlier value is in the form; Save to keep it.'));
  return true;
}

/** Can an entry of the record be put back into the open form? */
export const canPutBack = entry => editing() && entry.op === 'update' && ['element', 'relationship'].includes(entry.kind)
  && entry.before && ('name' in entry.before || 'documentation' in entry.before);
