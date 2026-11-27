// ArchiMate Browser: one action registry (CM-11, 2.21.0).
//
// Every action on an item is defined once here, per kind of item: an element, a relationship, a view, a
// folder, an element type, a layer, a relationship type, a property, the model, and the diagram itself.
// The context menus (menus.js), the buttons of the details (details.js), the keyboard shortcuts (keys.js)
// and the command palette (palette.js, Ctrl+K) are made from it, so they offer the same actions under the
// same names, in the same order.
//
// An action: { id, group, label, run(c), when?(c), title?, count?, note?, disabled?, newTab?,
//   button?: true | { primary?, attrs?(c), sync?(button), refresh? }, menu?: false, palette?: false,
//   key?: { keys: ['Ctrl', 'A'], scope: 'diagram' | 'page' | 'anywhere', help } }.
// label, title, count, note and disabled are a value or a function of the context `c` (actionContext).
// Actions of different groups are separated in menus. `button` makes it a button of the details;
// `menu: false` and `palette: false` leave it out of the menus or the palette.

import { settings, saveSettings } from '../config.js';
import { t } from '../i18n.js';
import { csvText, csvFile } from '../csv.js';
import { LAYERS, prettyType, layerOf } from '../archimate.js';
import { isOffline } from '../api.js';
import { isManual } from '../manual.js';
import { REL_END, ruleText } from '../filters.js';
import { PropertyOptions } from '../properties.js';
import { addViewToBasket, basketAdd, basketSorted, toggleBasket, updateBasket } from './basket.js';
import { impactOptions, renderDetails } from './details.js';
import {
  addToDiagram, askClearDiagram, automaticLayout, collapseAndShowLevel, collapseEntry, dragElementIds, editableCopy, expandElement, exploreBack,
  exploreFrom, hiddenCount, hideElement, inDiagram, resetLayout, setHiddenRels, shownIds, syncAddButton, tidyLayout, undoLayout,
  viewElementPositions,
} from './diagram.js';
import { hideSelected, showShortcuts } from './keys.js';
import { paneClosed, setPaneClosed, toggleFullScreen } from '../panes.js';
import {
  clearHighlight, copyText, diagramElementIds, filterExcept, filterOnly, findWithProperty, markElements, openSelectionMenu,
  removePropertyFilterEntry, selectInfo,
} from './menus.js';
import { openDeleteModel, openImport, refreshModels, renameModel, selectType } from './models.js';
import { openPalette } from './palette.js';
import { canWalkTypes, renderDef, setFilter, setPropertyOptions, showNeighbourhood, showPaths } from './panels.js';
import { askNeighbourhoodWalk } from './walkdialog.js';
import { canScripts, openRecipeScript } from './scriptdialog.js';
import { modelRef, revealInTree, select } from './routing.js';
import { showPanel } from './shell.js';
import { $, state } from './state.js';
import { consumeNewTab, duplicateDoc, newEmptyTab } from './tabs.js';
import { canEdit, editing, setEditMode } from './editing.js';
import { connectFrom, createElementAt, newElementHere } from './toolbox.js';
import { deleteElement, deleteFolder, deleteRelationship, fileItem, moveFolder, newFolder, renameFolder } from './manage.js';
import {
  canManageView, canRecipe, canWrite, deleteView, discardEdit, editView, editingOf, isCreated, isRecipe, recipeOf, renameView, saveAsRecipe, saveAsView,
  saveIntoRecipe, saveIntoView,
} from './views.js';
import { download, h, may, safeName, status } from './ui.js';

const val = (x, c) => (typeof x === 'function' ? x(c) : x);
const short = str => (str.length > 40 ? str.slice(0, 39) + '…' : str);
const basketAll = ids => { ids.forEach(x => state.basket.add(x)); updateBasket(); status(t('{n} element(s) in the basket.', { n: ids.length })); };
const addLabel = c => (c.generated ? t('Add to diagram') : t('Add to new diagram'));
const impact = (c, dir) => { const o = impactOptions(); renderDef({ kind: 'impact', id: c.id, dir, depth: o.depth, types: o.types }); };
const setProps = patch => setPropertyOptions(new PropertyOptions({ ...state.props, ...patch }), { redraw: true });

/**
 * What the actions of an item work with: { kind, item, id, s (the store), generated (a generated diagram
 * is shown), selectOpts (for "Details"), diagramActions (false: the menu offers the diagram's own) }, and
 * what the kind works out (DERIVE). `opts` may add what was asked for first: `attached` (a relationship's
 * attached relationships), `ids` (a type's or layer's elements), `rels` and `ends` (a relationship type's).
 */
export function actionContext(kind, item = null, opts = {}) {
  const c = {
    kind, item, id: item?.id ?? null, s: state.store,
    generated: !!(state.diagramDef && state.diagramDef.kind !== 'view' && state.gen),
    selectOpts: { fromTree: true }, diagramActions: true, ...opts,
  };
  DERIVE[kind]?.(c);
  return c;
}

const DERIVE = {
  element(c) {
    c.inDia = inDiagram(c.id);
    c.shown = c.generated && shownIds().has(c.id);
    c.more = c.diagramActions && c.shown ? hiddenCount(c.id) : 0;
    c.collapse = c.diagramActions ? collapseEntry(c.id) : null;
  },
  relationship(c) {
    const s = c.s, r = c.item;
    c.attached ??= [];
    c.ends = dragElementIds(`relationship:${r.id}`);
    c.label = s.relationshipLabel(r);
    c.missing = c.ends.filter(id => !inDiagram(id));
    // BR-6: relationships whose source or target is this one, with the elements at their other ends
    c.attachedEnds = [...new Set(c.attached.flatMap(a => dragElementIds(`relationship:${a.id}`)))];
    c.attachedMissing = c.attachedEnds.filter(id => !inDiagram(id));
    // 2.17.0: a hide rule of the diagram filter for relationships like this one
    const endType = (eid, rid) => (eid != null ? s.element(eid)?.type || null : rid != null ? REL_END : null);
    c.rule = { type: r.type, source: endType(r.sourceElementId, r.sourceRelationshipId), target: endType(r.targetElementId, r.targetRelationshipId) };
  },
  folder(c) {
    c.n = c.s.folderCounts(c.id).elements;
    c.label = c.item.label || t('(folder)');
    c.path = c.s.folderPath(c.id).map(f => f.label).filter(Boolean).join(' › ') || c.label;
  },
  diagram(c) {
    c.layout = state.layout;
    c.def = state.diagramDef;
    c.g = state.gen;
    c.basket = [...state.basket];
    c.view = c.def?.kind === 'view' ? c.s?.view(c.def.id) : null;
  },
};

// ---------------------------------------------------------------- the actions, per kind

const ELEMENT = [
  { id: 'details', group: 'open', label: t('Details'), run: c => select('element', c.id, c.selectOpts) },
  { id: 'neighbourhood', group: 'diagram', newTab: true, button: { primary: true }, label: t('Neighbourhood diagram'),
    run: c => showNeighbourhood([c.id], c.item.name) },
  // 2.33.0 (API 3.24.0): the relationship types followed in each direction
  { id: 'neighbourhood-types', group: 'diagram', newTab: true, when: () => canWalkTypes(), label: t('Neighbourhood with relationship types…'),
    title: t('Choose the depth and which incoming and outgoing relationship types to follow, e.g. every incoming one, outgoing only Serving and Realization'),
    run: c => askNeighbourhoodWalk([c.id], c.item.name || prettyType(c.item.type), { newTab: consumeNewTab() }) },
  { id: 'explore', group: 'diagram', newTab: true, button: true, label: t('Explore'),
    title: t('Start a diagram with this element and grow it step by step: click +N or double-click elements to show their related elements'),
    run: c => exploreFrom([c.id]) },
  { id: 'add', group: 'diagram', when: c => c.diagramActions, newTab: c => !c.inDia,
    label: c => (c.inDia ? '✓ ' + t('In diagram') : addLabel(c)), disabled: c => c.inDia,
    button: { attrs: c => ({ 'data-add-element': c.id }), sync: btn => syncAddButton(btn) },
    run: c => addToDiagram(c.id) },
  { id: 'expand', group: 'diagram', when: c => c.more > 0, button: true, label: t('Expand in diagram'), count: c => c.more,
    title: t('Add the related elements of this element to the current diagram (same as double-clicking it there)'),
    run: c => expandElement(c.id) },
  { id: 'hide', group: 'diagram', when: c => c.diagramActions && c.generated && c.inDia, label: t('Hide from diagram'), note: 'Del',
    run: c => hideElement(c.id) },
  // BR-11 step 2 (2.24.0): a relationship from it to the element clicked next
  { id: 'connect-to', group: 'diagram', when: c => c.diagramActions && c.generated && c.inDia && editing(), label: t('Connect to…'),
    title: t('Then click the target element; the palette offers the relationship types ArchiMate allows'), run: c => connectFrom(c.id) },
  { id: 'collapse', group: 'diagram', when: c => !!c.collapse, label: c => c.collapse.label, count: c => c.collapse.count,
    disabled: c => c.collapse.disabled, title: c => c.collapse.title, run: c => c.collapse.action() },
  // 2.28.0: collapse and show the next level in one step
  { id: 'collapse-level', group: 'diagram', when: c => !!c.collapse, label: t('Collapse and show one level'),
    title: t('Fold away what hangs off this element, then show its directly related elements; ← Back undoes it'),
    run: c => collapseAndShowLevel(c.id) },
  { id: 'impact', group: 'analysis', newTab: true, label: t('Impact analysis (what is affected)'), run: c => impact(c, 'impact') },
  { id: 'dependencies', group: 'analysis', newTab: true, label: t('Dependencies (what it depends on)'), run: c => impact(c, 'dependencies') },
  // HLP-4: choose one end here, the other on another element
  { id: 'paths-to', group: 'analysis', newTab: true,
    when: c => state.pathFrom != null && state.pathFrom !== c.id && !!c.s.element(state.pathFrom),
    label: c => t('Paths from {name} to here', { name: c.s.element(state.pathFrom).name || '#' + state.pathFrom }),
    run: c => showPaths(state.pathFrom, c.id) },
  { id: 'paths-from', group: 'analysis', label: t('Paths from here…'), title: t('Then choose “Paths from … to here” in the menu of another element'),
    run: c => { state.pathFrom = c.id; status(t('Paths from {name}: now choose “Paths from … to here” in the menu of another element.', { name: c.item.name || '#' + c.id })); } },
  { id: 'basket', group: 'basket', button: { refresh: true },
    label: c => (state.basket.has(c.id) ? t('Remove from basket') : t('Add to basket')), run: c => toggleBasket(c.id) },
  { id: 'show-in-tree', group: 'find', button: true, label: t('Show in tree (by type)'), title: t('Expand the model tree to this item'),
    run: c => revealInTree('element', c.id) },
  { id: 'show-in-folders', group: 'find', button: true, label: t('Show in folders'), title: t('Reveal this item in the Folders branch'),
    run: c => revealInTree('element', c.id, { via: 'folders' }) },
  { id: 'copy-name', group: 'find', label: t('Copy name'), run: c => copyText(c.item.name || '', t('Name')) },
  // BR-11 step 3 (2.25.0): with Edit on
  { id: 'file-in-folder', group: 'manage', when: () => editing(), button: true, label: t('File in folder…'), run: c => fileItem('element', c.id) },
  { id: 'delete-element', group: 'manage', when: () => editing(), button: true, label: t('Delete…'), run: c => deleteElement(c.id) },
];

/** "Source: …" or "Target: …" of a relationship: its element, or the relationship it ends on (BR-6). */
function endAction(id, word, eidOf, ridOf) {
  const end = c => {
    const eid = eidOf(c.item), rid = ridOf(c.item);
    if (eid != null && c.s.element(eid)) return { kind: 'element', id: eid, name: c.s.element(eid).name || prettyType(c.s.element(eid).type) };
    if (rid != null && c.s.relationship(rid)) return { kind: 'relationship', id: rid, name: t('{type} (relationship)', { type: c.s.relationship(rid).type }) };
    return null;
  };
  return { id, group: 'open', when: c => !!end(c), label: c => `${word}: ${end(c).name}`, run: c => { const e = end(c); select(e.kind, e.id, c.selectOpts); } };
}

const RELATIONSHIP = [
  { id: 'details', group: 'open', label: t('Details'), run: c => select('relationship', c.id, c.selectOpts) },
  endAction('source', t('Source'), r => r.sourceElementId, r => r.sourceRelationshipId),
  endAction('target', t('Target'), r => r.targetElementId, r => r.targetRelationshipId),
  { id: 'diagram', group: 'diagram', newTab: true, button: { primary: true }, label: t('Diagram of both ends'), disabled: c => !c.ends.length,
    run: c => showNeighbourhood(c.ends, `${c.item.type}: ${c.label}`, 0) },
  { id: 'neighbourhood', group: 'diagram', newTab: true, button: true, label: t('Neighbourhood diagram'), disabled: c => !c.ends.length,
    run: c => showNeighbourhood(c.ends, t('Around {name}', { name: c.label })) },
  { id: 'add', group: 'diagram', newTab: c => !(c.generated && !c.missing.length), disabled: c => !c.ends.length || (c.generated && !c.missing.length),
    label: c => (c.generated && !c.missing.length ? '✓ ' + t('Both ends in diagram') : c.generated ? t('Add to diagram (both ends)') : t('Add to new diagram (both ends)')),
    run: c => addToDiagram(c.ends, { label: t('relationship {type}', { type: c.item.type }) }) },
  { id: 'attached', group: 'diagram', when: c => c.attached.length > 0, button: true,
    newTab: c => !(c.generated && !c.attachedMissing.length), disabled: c => c.generated && !c.attachedMissing.length,
    label: c => (c.generated && !c.attachedMissing.length ? '✓ ' + t('Attached relationships shown')
      : t('Show the {n} relationship attached to it|Show the {n} relationships attached to it', { n: c.attached.length })),
    count: c => (c.generated && !c.attachedMissing.length ? null : c.generated ? c.attachedMissing.length : c.attachedEnds.length),
    title: t('Adds the elements at the other ends of relationships that connect to this relationship (they are drawn from a dot on its line)'),
    run: c => addToDiagram([...c.ends, ...c.attachedEnds], { label: t('relationships attached to {type}', { type: c.item.type }) }) },
  { id: 'hide-rule', group: 'filter', label: c => t('Diagram filter: hide {rule}', { rule: ruleText(c.rule) }),
    title: t('Leaves out every relationship of this type between elements of these types (Filters tab)'),
    run: c => setFilter(state.filter.withRule(c.rule)) },
  { id: 'select-ends', group: 'filter', label: t('Select both ends'), disabled: c => !c.ends.length, run: c => markElements(c.ends, 'set') },
  { id: 'basket', group: 'filter', button: true, label: t('Add both ends to basket'), disabled: c => !c.ends.length, run: c => basketAdd(c.ends) },
  { id: 'show-in-tree', group: 'find', button: true, label: t('Show in tree'), title: t('Expand the model tree to this item'),
    run: c => revealInTree('relationship', c.id) },
  { id: 'show-in-folders', group: 'find', button: true, label: t('Show in folders'), title: t('Reveal this item in the Folders branch'),
    run: c => revealInTree('relationship', c.id, { via: 'folders' }) },
  { id: 'copy-name', group: 'find', when: c => !!c.item.name, label: t('Copy name'), run: c => copyText(c.item.name, t('Name')) },
  // BR-11 step 3 (2.25.0): with Edit on
  { id: 'file-in-folder', group: 'manage', when: () => editing(), button: true, label: t('File in folder…'), run: c => fileItem('relationship', c.id) },
  { id: 'delete-relationship', group: 'manage', when: () => editing(), button: true, label: t('Delete…'), run: c => deleteRelationship(c.id) },
];

/**
 * A view's actions. Its first one opens it; where the view is met says how (opts.open: { label, run,
 * newTab }): in the tree it opens with its details, from a drill-down link it is followed.
 */
const VIEW = [
  { id: 'open', group: 'open', button: { primary: true }, newTab: c => c.open?.newTab ?? true,
    label: c => c.open?.label ?? t('Open view (and details)'), run: c => (c.open ? c.open.run() : select('view', c.id, c.selectOpts)) },
  { id: 'automatic-layout', group: 'diagram', when: c => !isRecipe(c.item), newTab: true, label: t('Automatic layout of its elements'), run: c => automaticLayout(c.id) },
  { id: 'editable-copy', group: 'diagram', when: c => !isRecipe(c.item), newTab: true, label: t('Editable copy (keeps the arrangement)'),
    title: t('A generated diagram of the view\'s elements, laid out like the view; then expand, drag, tidy'), run: c => editableCopy(c.id) },
  { id: 'add', group: 'diagram', when: c => c.generated && !isRecipe(c.item), label: t('Add to diagram (its elements, in their arrangement)'),
    run: async c => { const shape = await viewElementPositions(c.id); addToDiagram([...shape.keys()], { label: t('view “{name}”', { name: c.item.name }), shape }); } },
  { id: 'basket', group: 'diagram', when: c => !isRecipe(c.item), button: true, label: t('Add its elements to basket'), run: c => addViewToBasket(c.id) },
  // BR-25: a created view is edited, renamed and deleted; a source view never
  { id: 'edit', group: 'diagram', when: c => canWrite() && isCreated(c.item) && !isRecipe(c.item), button: true, label: t('Edit view'),
    title: t('Move, add and hide its elements in a diagram, then Save'), run: c => editView(c.id) },
  // 2.31.0: also a view of the model's source, on a model mastered here (API 3.23.0)
  { id: 'rename', group: 'manage', when: c => canManageView(c.item), button: true, label: t('Rename…'), run: c => renameView(c.id) },
  { id: 'delete', group: 'manage', when: c => canManageView(c.item), button: true, label: t('Delete…'), run: c => deleteView(c.id) },
  { id: 'show-in-tree', group: 'find', button: true, label: t('Show in tree'), title: t('Expand the model tree to this item'),
    run: c => revealInTree('view', c.id) },
  { id: 'show-in-folders', group: 'find', when: c => !isCreated(c.item), button: true, label: t('Show in folders'), title: t('Reveal this item in the Folders branch'),
    run: c => revealInTree('view', c.id, { via: 'folders' }) },
  // BR-11 step 3 (2.25.0): a view of the source is filed in the folders (a created view is not, BL-56)
  { id: 'file-in-folder', group: 'manage', when: c => editing() && !isCreated(c.item), label: t('File in folder…'), run: c => fileItem('view', c.id) },
  { id: 'copy-name', group: 'find', label: t('Copy name'), run: c => copyText(c.item.name, t('Name')) },
];

/** The groups of a view's actions that act on what it shows (the diagram's menu, a drill-down link's). */
export const VIEW_SHOWING = ['open', 'diagram'];

const FOLDER = [
  { id: 'details', group: 'open', label: t('Details'), run: c => select('folder', c.id, c.selectOpts) },
  // HLP-7: how many elements the folder holds is known from the tree; which ones is asked for when an action needs them
  { id: 'diagram', group: 'diagram', newTab: true, button: { primary: true }, label: t('Diagram of folder'), disabled: c => !c.n,
    run: c => renderDef({ kind: 'folder', id: c.id }) },
  { id: 'add', group: 'diagram', label: addLabel, count: c => c.n,
    run: async c => addToDiagram(await c.s.folderElementIds(c.id), { label: t('folder {path}', { path: c.path }) }) },
  { id: 'basket', group: 'diagram', button: true, label: t('Add elements to basket'), note: c => c.n, disabled: c => !c.n,
    run: async c => basketAll(await c.s.folderElementIds(c.id)) },
  { id: 'show-in-folders', group: 'find', button: true, label: t('Show in folders'), title: t('Expand the model tree to this item'),
    run: c => revealInTree('folder', c.id) },
  // BR-11 step 3 (2.25.0): with Edit on
  { id: 'new-folder', group: 'manage', when: () => editing(), button: true, label: t('New folder…'), run: c => newFolder(c.id) },
  { id: 'rename-folder', group: 'manage', when: () => editing(), button: true, label: t('Rename…'), run: c => renameFolder(c.id) },
  { id: 'move-folder', group: 'manage', when: () => editing(), button: true, label: t('Move to…'), run: c => moveFolder(c.id) },
  { id: 'delete-folder', group: 'manage', when: () => editing(), button: true, label: t('Delete…'), run: c => deleteFolder(c.id) },
  { id: 'copy-name', group: 'find', label: t('Copy name'), run: c => copyText(c.label, t('Name')) },
];

/** The elements of a group heading (a type, a layer): a diagram of them, add them, the basket, select them. */
const groupActions = (diagram, addWhat) => [
  { id: 'diagram', group: 'diagram', newTab: true, button: { primary: true }, label: diagram.label, disabled: c => !c.ids.length, run: c => renderDef(diagram.def(c)) },
  { id: 'add', group: 'diagram', newTab: true, label: addLabel, count: c => c.ids.length, run: c => addToDiagram(c.ids, { label: addWhat(c) }) },
  { id: 'basket', group: 'diagram', button: true, label: t('Add all to basket'), disabled: c => !c.ids.length, run: c => basketAll(c.ids) },
  { id: 'select', group: 'diagram', label: t('Select them'), note: c => c.ids.length, run: c => markElements(c.ids, 'set') },
];

const TYPE = [
  { id: 'details', group: 'open', label: t('Details'), run: c => selectType(c.item.type) },
  { id: 'new-element', group: 'open', when: () => editing(), label: c => t('New {type}…', { type: prettyType(c.item.type) }),
    run: c => createElementAt(c.item.type) },
  ...groupActions({ label: t('Diagram of these elements'), def: c => ({ kind: 'type', type: c.item.type }) },
    c => t('all {type} elements', { type: prettyType(c.item.type) })),
];

const LAYER = [
  { id: 'details', group: 'open', label: t('Details'), run: c => selectInfo({ kind: 'layer', key: c.item.key }) },
  ...groupActions({ label: t('Diagram of the layer'), def: c => ({ kind: 'layer', key: c.item.key }) },
    c => t('the {layer} layer', { layer: LAYERS.find(l => l.key === c.item.key)?.label })),
  { id: 'filter-only', group: 'filter', label: t('Diagram filter: only this layer'), run: c => filterOnly('layer', c.item.key) },
];

// 2.28.0: the model as a whole, from the tree's Folders and Elements (up to settings.wholeModelMax elements)
const WHOLE = [
  ...groupActions({ label: t('Diagram of the whole model'), def: () => ({ kind: 'whole' }) }, () => t('the whole model')),
];

const RELTYPE = [
  { id: 'details', group: 'open', label: t('Details'), run: c => selectInfo({ kind: 'reltype', type: c.item.type }) },
  { id: 'diagram', group: 'diagram', newTab: true, button: { primary: true }, label: c => t('Diagram of the {n} relationships', { n: c.rels.length }),
    title: t('Their ends, connected by these relationships only'), disabled: c => !c.ends.length, run: c => renderDef({ kind: 'reltype', type: c.item.type }) },
  { id: 'add', group: 'diagram', newTab: true, label: c => (c.generated ? t('Add to diagram (their ends)') : t('Add to new diagram (their ends)')), count: c => c.ends.length,
    run: c => addToDiagram(c.ends, { label: c.item.type === '@rel' ? t('all relationships on relationships') : t('all {type} relationships', { type: c.item.type }) }) },
  { id: 'basket', group: 'diagram', button: true, label: t('Add their ends to basket'), disabled: c => !c.ends.length, run: c => basketAll(c.ends) },
  { id: 'filter-only', group: 'filter', when: c => c.item.type !== '@rel', label: t('Diagram filter: only this relationship type'), run: c => filterOnly('rel', c.item.type) },
  { id: 'filter-hide', group: 'filter', when: c => c.item.type !== '@rel', label: t('Diagram filter: hide this relationship type'),
    disabled: c => !state.filter.relTypes.has(c.item.type), run: c => filterExcept('rel', c.item.type) },
];

/** A property (CM-5): colour or label diagrams by it, filter by whether it is set, find items with it. */
const PROPERTY = [
  { id: 'colour', group: 'show', button: { refresh: true }, label: c => (state.props.colour === c.item.name ? t('Stop colouring by it') : t('Colour diagrams by it')),
    run: c => setProps({ colour: state.props.colour === c.item.name ? '' : c.item.name }) },
  { id: 'label', group: 'show', button: { refresh: true }, label: c => (state.props.label === c.item.name ? t('Stop showing it in labels') : t('Show it in diagram labels')),
    run: c => setProps({ label: state.props.label === c.item.name ? '' : c.item.name }) },
  { id: 'only-set', group: 'filter', label: t('Only elements where it is set'), note: c => c.s.propertyIndex.get(c.item.name)?.count,
    run: c => setProps({ filterName: c.item.name, filterOp: 'has', filterValue: '' }) },
  { id: 'only-missing', group: 'filter', label: t('Only elements where it is not set'), run: c => setProps({ filterName: c.item.name, filterOp: 'missing', filterValue: '' }) },
  { id: 'remove-filter', group: 'filter', when: () => !!removePropertyFilterEntry(), label: () => removePropertyFilterEntry().label,
    run: () => removePropertyFilterEntry().action() },
  { id: 'find', group: 'find', button: true, label: t('Find items with it'), run: c => findWithProperty(c.item.name) },
];

const MODEL = [
  { id: 'details', group: 'open', label: t('Details and statistics'), run: c => select('model', c.id, c.selectOpts) },
  { id: 'refresh', group: 'open', when: () => !isOffline(), label: t('Refresh'), run: () => refreshModels() },
  // BR-11 (2.23.0): ✎ Edit, for a model mastered here
  { id: 'edit-mode', group: 'open', when: () => canEdit(), label: () => (state.editMode ? t('Turn off editing') : t('Turn on editing')),
    run: () => setEditMode(!state.editMode) },
  { id: 'new-top-folder', group: 'model', when: () => editing(), label: t('New top-level folder…'), run: () => newFolder(null) },
  // 2.30.0: its name and documentation (admin)
  { id: 'rename-model', group: 'model', when: () => !isOffline() && may('import'), button: true, label: t('Rename model…'), run: () => renameModel() },
  // 2.33.0 (API 3.24.0): recipe scripts
  { id: 'recipe-script', group: 'model', when: () => canScripts(), label: t('Recipe script…'),
    title: t('Make the recipes of many diagrams at once, e.g. one for each business service with a property'), run: () => openRecipeScript() },
  { id: 'export', group: 'model', when: () => !isOffline(), label: t('Export model'), run: () => $('#btn-export').click() },
  { id: 'import', group: 'model', when: () => !isOffline() && may('import'), label: t('Import model…'), run: () => openImport() },
  { id: 'delete', group: 'model', when: () => !isOffline() && may('deleteModel'), label: t('Delete model…'), run: () => openDeleteModel() },
  { id: 'copy-name', group: 'find', label: t('Copy name'), run: c => copyText(c.item.name, t('Name')) },
  { id: 'copy-link', group: 'find', label: t('Copy link to the model'),
    run: c => copyText(`${location.origin}${location.pathname}#model=${modelRef(c.item)}`, t('Link')) },
];

// ---- the diagram itself (CM-3): the background's menu, the keys, the palette

/** Zoom centred on the clicked point (or the middle of the diagram); 100 % = one diagram unit per screen pixel. */
function zoomAt(c, w, hh) {
  const p = c.point ?? (() => { const v = c.layout.view(); return { x: v.x + v.w / 2, y: v.y + v.h / 2 }; })();
  c.layout.setView({ x: p.x - w / 2, y: p.y - hh / 2, w, h: hh });
}
const zoomBy = (c, f) => { const v = c.layout.view(); zoomAt(c, v.w * f, v.h * f); };
const toolButton = tool => state.doc.panel?.querySelector(`.layout-tools [data-tool="${tool}"]`);
const drawn = c => !!(c.layout && c.def && c.s);
const generatedDiagram = c => drawn(c) && c.generated;

const DIAGRAM = [
  { id: 'fit', group: 'zoom', when: drawn, label: t('Fit to window'), run: c => c.layout.fit() },
  // 2.28.0: the side panes and full screen
  { id: 'pane-tree', group: 'zoom', label: () => (paneClosed('tree') ? t('Show the model tree') : t('Hide the model tree')), run: () => setPaneClosed('tree') },
  { id: 'pane-details', group: 'zoom', label: () => (paneClosed('details') ? t('Show the details pane') : t('Hide the details pane')), run: () => setPaneClosed('details') },
  { id: 'fullscreen', group: 'zoom', when: () => !!document.fullscreenEnabled,
    label: () => (document.fullscreenElement ? t('Leave full screen') : t('Full screen')), run: () => toggleFullScreen() },
  { id: 'zoom-100', group: 'zoom', when: drawn, label: t('Zoom 100 % here'),
    run: c => { const r = c.layout.svg.getBoundingClientRect(); zoomAt(c, r.width, r.height); } },
  { id: 'zoom-in', group: 'zoom', when: drawn, label: t('Zoom in here'), run: c => zoomBy(c, 1 / 1.5) },
  { id: 'zoom-out', group: 'zoom', when: drawn, label: t('Zoom out'), run: c => zoomBy(c, 1.5) },
  { id: 'minimap', group: 'zoom', when: drawn, label: () => (settings.minimap !== false ? t('Hide overview map') : t('Show overview map')),
    run: () => toolButton('map')?.click() },
  { id: 'tidy', group: 'layout', when: generatedDiagram, label: t('Tidy'), disabled: c => !isManual(c.g.manual),
    title: t('Re-run the layout, keeping your arrangement of rows and order'), run: () => tidyLayout() },
  { id: 'undo', group: 'layout', when: generatedDiagram, label: t('Undo'), disabled: c => !c.g.undo.length, run: () => undoLayout() },
  { id: 'reset-layout', group: 'layout', when: generatedDiagram, label: t('Reset layout'), disabled: c => !isManual(c.g.manual), run: () => resetLayout() },
  { id: 'back', group: 'layout', when: c => drawn(c) && state.exploreBack.length > 0, label: '← ' + t('Back'), note: '⌫', run: () => exploreBack(),
    key: { keys: ['Backspace'], scope: 'diagram', help: t('← Back: undo the last step of the diagram (shows hidden elements again)') } },
  { id: 'layout-options', group: 'layout', when: generatedDiagram, label: t('Layout options…'), run: () => showPanel('layout') },
  { id: 'show-hidden-rels', group: 'layout', when: c => generatedDiagram(c) && !!c.def.hiddenRels?.length,
    label: c => t('Show the {n} hidden relationship|Show the {n} hidden relationships', { n: c.def.hiddenRels.length }), run: () => setHiddenRels([]) },
  { id: 'hide-selected', group: 'layout', when: drawn, menu: false, label: t('Hide the selected elements'),
    run: c => hideSelected(c.target),
    key: { keys: ['Delete'], scope: 'diagram', help: t('Hide the selected elements (or the selected relationship) from the diagram') } },
  // BR-25: a generated diagram stored as a view; the view a tab edits saved
  { id: 'save-into-view', group: 'save', when: c => generatedDiagram(c) && !!editingOf(), label: () => t('Save view “{name}”', { name: editingOf().name }),
    run: () => saveIntoView() },
  { id: 'save-as-view', group: 'save', when: c => generatedDiagram(c) && canWrite(), label: t('Save as view…'),
    title: t('Store this diagram, as it is drawn, as a view of the model (a created view)'), run: () => saveAsView() },
  { id: 'discard-edit', group: 'save', when: c => generatedDiagram(c) && !!editingOf(), label: t('Discard the changes'), run: () => discardEdit() },
  // 2.30.0: the diagram's recipe (its link) kept in the model tree
  { id: 'save-into-recipe', group: 'save', when: c => generatedDiagram(c) && canRecipe() && !!recipeOf(), label: () => t('Save recipe “{name}”', { name: recipeOf().name }),
    run: () => saveIntoRecipe() },
  { id: 'save-as-recipe', group: 'save', when: c => generatedDiagram(c) && canRecipe(), label: t('Save as recipe…'),
    title: t('Keep how this diagram is made (what it draws, filters, nesting) as a recipe in the model tree'), run: () => saveAsRecipe() },
  { id: 'clear-highlight', group: 'highlight', when: () => !!state.highlight, label: t('Clear highlight'), run: () => clearHighlight() },
  { id: 'select-all', group: 'select', when: drawn, label: t('Select all elements'), note: 'Ctrl+A', run: () => markElements(diagramElementIds(), 'set'),
    key: { keys: ['Ctrl', 'A'], scope: 'diagram', help: t('Select all elements of the diagram') } },
  { id: 'selection', group: 'select', when: c => drawn(c) && state.marked.size > 0, palette: false, label: () => t('Selection ({n})…', { n: state.marked.size }),
    run: c => openSelectionMenu(c.at ?? { x: innerWidth / 2, y: innerHeight / 3 }) },
  { id: 'clear-selection', group: 'select', when: () => state.marked.size > 0, label: t('Clear selection'), run: () => markElements([], 'set') },
  { id: 'new-element-here', group: 'diagram', when: c => generatedDiagram(c) && editing(), label: t('New element here…'),
    title: t('Choose a type and a name; the element is created where you clicked'), run: c => newElementHere(c.point) },
  { id: 'add-basket-here', group: 'diagram', when: c => generatedDiagram(c) && c.basket.length > 0, label: c => t('Add basket here ({n})', { n: c.basket.length }),
    run: c => addToDiagram(c.basket, { at: c.point, label: t('the basket') }) },
  { id: 'basket-diagram', group: 'diagram', when: c => drawn(c) && !c.generated && c.basket.length > 0, newTab: true,
    label: c => t('Basket in a new diagram ({n})', { n: c.basket.length }), run: c => addToDiagram(c.basket, { label: t('the basket') }) },
  { id: 'clear', group: 'diagram', when: drawn, label: t('Clear diagram'), disabled: c => c.def.kind === 'explore' && !c.def.ids.length, run: () => askClearDiagram() },
  { id: 'copy-link', group: 'diagram', when: drawn, label: t('Copy link'), run: () => $('#btn-link').click() },
  { id: 'duplicate', group: 'tabs', when: drawn, label: t('Duplicate in a new tab'), title: t('The same diagram, with its filters and arrangement, in a tab of its own'),
    run: () => duplicateDoc(state.doc) },
  { id: 'new-tab', group: 'tabs', when: c => !!c.s, label: t('New empty tab'), run: () => newEmptyTab() },
  { id: 'copy-image', group: 'image', when: drawn, label: t('Copy image'), run: () => $('#btn-copy-png').click() },
  { id: 'download-svg', group: 'image', when: drawn, label: t('Download .svg'), run: () => $('#btn-dl-svg').click() },
  { id: 'download-png', group: 'image', when: drawn, label: t('Download .png'), run: () => $('#btn-dl-png').click() },
  { id: 'palette', group: 'help', menu: false, palette: false, label: t('Commands…'), run: () => openPalette(),
    key: { keys: ['Ctrl', 'K'], scope: 'anywhere', help: t('Commands: find an item and choose what to do with it, or run a command of the diagram') } },
  { id: 'shortcuts', group: 'help', label: t('Keyboard shortcuts'), note: '?', run: () => showShortcuts(),
    key: { keys: ['?'], scope: 'page', help: t('This list') } },
];

/** The basket as a whole ("Basket: N elements"). */
const BASKET = [
  { id: 'diagram', group: 'diagram', newTab: true, label: t('Diagram of basket'),
    run: c => renderDef({ kind: 'elements', ids: c.ids, label: t('Basket ({n} elements)', { n: c.ids.length }) }) },
  { id: 'neighbourhood', group: 'diagram', newTab: true, label: t('Diagram with neighbours'),
    run: c => showNeighbourhood(c.ids, t('basket ({n} elements)', { n: c.ids.length })) },
  { id: 'explore', group: 'diagram', newTab: true, label: t('Explore'), run: c => exploreFrom(c.ids) },
  { id: 'add', group: 'diagram', newTab: true, label: c => (c.generated ? t('Add all to diagram') : t('Add all to new diagram')),
    run: c => addToDiagram(c.ids, { label: t('the basket') }) },
  { id: 'select', group: 'diagram', label: t('Select all of them'), run: c => markElements(c.ids, 'set') },
  // CM-8: chip order and export
  ...Object.entries({ name: () => t('Sort by name'), type: () => t('Sort by type'), added: () => t('Order as added') }).map(([k, label]) => ({
    id: `sort-${k}`, group: 'order', label: () => `${(settings.basketSort || 'name') === k ? '✓ ' : ''}${label()}`,
    run: () => { saveSettings({ basketSort: k }); updateBasket(); },
  })),
  { id: 'copy-names', group: 'export', label: t('Copy names'), run: () => copyText(basketSorted().map(e => e.name || '').join('\n'), t('Names')) },
  { id: 'copy-xmi', group: 'export', label: t('Copy XMI identifiers'), title: t('One per line; they stay valid when the model is re-imported'),
    run: () => copyText(basketSorted().map(e => e.xmiIdentifier).join('\n'), t('XMI identifiers')) },
  { id: 'csv', group: 'export', label: t('Download as CSV'), run: () => {
    const rows = [['name', 'type', 'layer', 'xmi identifier'], ...basketSorted().map(e => [e.name, prettyType(e.type), layerOf(e.type).label, e.xmiIdentifier])];
    download(safeName(`basket ${state.store.model.name}`) + '.csv', csvFile(csvText(rows)), 'text/csv');
  } },
  { id: 'clear', group: 'clear', label: t('Clear basket'), run: () => $('#btn-basket-clear').click() },
];

export const ACTIONS = {
  element: ELEMENT, relationship: RELATIONSHIP, view: VIEW, folder: FOLDER, type: TYPE, layer: LAYER, reltype: RELTYPE, whole: WHOLE,
  property: PROPERTY, model: MODEL, diagram: DIAGRAM, basket: BASKET,
};

// ---------------------------------------------------------------- what is made from it

/** The actions of a context that apply now, in order; `groups` keeps only those groups, `omit` leaves out ids. */
export function applicable(c, { groups = null, omit = [], where = 'menu' } = {}) {
  return (ACTIONS[c.kind] || []).filter(a => (!groups || groups.includes(a.group)) && !omit.includes(a.id)
    && (where !== 'menu' || a.menu !== false) && (where !== 'palette' || a.palette !== false)
    && (!a.when || a.when(c)));
}

/** One action as a popupMenu entry. */
export function menuEntry(a, c) {
  return {
    label: val(a.label, c), title: val(a.title, c) || undefined, count: val(a.count, c), note: val(a.note, c),
    disabled: !!val(a.disabled, c), newTab: !!val(a.newTab, c), action: () => a.run(c),
  };
}

/** The entries of a context menu (popupMenu), a separator between groups. */
export function actionEntries(c, opts = {}) {
  const entries = [];
  let group = null;
  for (const a of applicable(c, opts)) {
    if (group !== null && a.group !== group) entries.push('-');
    group = a.group;
    entries.push(menuEntry(a, c));
  }
  return entries;
}

/**
 * The buttons of the details (`.actions`): the actions with `button`, in their order. `replace` gives a
 * button of its own for an id (e.g. "Show in folders", shown once the item's folder is known).
 */
export function actionButtons(c, { replace = {} } = {}) {
  return applicable(c, { where: 'details' }).filter(a => a.button).map(a => {
    if (a.id in replace) return replace[a.id];
    const b = typeof a.button === 'object' ? a.button : {};
    const count = val(a.count, c), note = val(a.note, c);
    const button = h('button', {
      type: 'button', class: b.primary ? 'primary' : null, title: val(a.title, c) || null, disabled: !!val(a.disabled, c) || count === 0 || note === 0,
      ...(b.attrs ? b.attrs(c) : {}),
      onclick: async () => {
        await a.run(c);
        if (b.sync) b.sync(button);
        if (b.refresh) renderDetails(state.selection);
      },
    }, val(a.label, c), count ? h('span', { class: 'count' }, ` +${count}`) : note != null ? h('span', { class: 'count' }, ` ${note}`) : null);
    if (b.sync) b.sync(button);
    return button;
  });
}

/** The actions with a key (keys.js, the list of keys). */
export const keyedActions = () => Object.values(ACTIONS).flat().filter(a => a.key);

/** Does the key event press the keys of `a`? ('Ctrl' is Ctrl or ⌘.) */
export function pressed(a, ev) {
  const keys = a.key.keys;
  const ctrl = keys.includes('Ctrl'), shift = keys.includes('Shift');
  const key = keys[keys.length - 1];
  if (ctrl !== (ev.ctrlKey || ev.metaKey) || ev.altKey) return false;
  if (key.length === 1 && /[a-z]/i.test(key)) return ev.key.toLowerCase() === key.toLowerCase() && shift === ev.shiftKey;
  return ev.key === key && (key === '?' || shift === ev.shiftKey); // '?' is a shifted key on most layouts
}

export { short };
