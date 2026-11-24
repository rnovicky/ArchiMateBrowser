// ArchiMate Browser: The Options / Filters / Layout panels, diagram definitions, filters, property options, view drill-down.
// Part of js/app.js until 2026-10-24 (EN-6); app.js wires it to the page.

import { isAbort, isPartialCopy } from '../api.js';
import { settings, saveSettings, DEFAULTS } from '../config.js';
import { t } from '../i18n.js';
import { LAYERS, RELATIONSHIP_TYPES, prettyType } from '../archimate.js';
import { diagramFromElements } from '../plantuml.js';
import { LayoutPrefs, PRESETS, LAYERING, PLACEMENT, ROUTING } from '../layoutprefs.js';
import { isManual, saveManual } from '../manual.js';
import { isId } from '../refs.js';
import { DiagramFilter, VIEWPOINTS, renderFilterPanel } from '../filters.js';
import { PropertyOptions, renderPropertyPanel, propertyDisplayRow, NOT_SET } from '../properties.js';
import { DIRECTIONS, encodeTypes, decodeTypes } from '../impact.js';
import * as graph from '../graph.js';
import { fill } from './details.js';
import {
  countHidden, describeDef, layoutGenerated, manualButtons, manualKey, nestingMode, notesForDiagram, setDiagram,
  setNesting, showDiagramError, showView, updateOptionHints,
} from './diagram.js';
import { keyOut, select, writeHash } from './routing.js';
import { $, state } from './state.js';
import { consumeNewTab, openDoc } from './tabs.js';
import { RENDER_MODE, errorMessage, h, startJob, status } from './ui.js';

// ---------------------------------------------------------------- layout panel (LV-6)

// ---------------------------------------------------------------- "Set to default" of the three tabs

export const optionsAreDefault = () => settings.plantumlDirection === DEFAULTS.plantumlDirection
  && Number(settings.neighbourDepth) === DEFAULTS.neighbourDepth && (settings.neighbourDirection || 'both') === DEFAULTS.neighbourDirection;
export const filtersAreDefault = () => state.filter.isDefault() && !state.props.filterName && !state.props.lang;
export const layoutIsDefault = () => state.layoutPrefs.isDefault() && nestingMode() === 0 && !state.props.label && !state.props.colour;

/** Enable each tab's "Set to default" only when something differs from the defaults. */
export function updateDefaultButtons() {
  $('#btn-options-default').disabled = optionsAreDefault();
  $('#btn-filters-default').disabled = filtersAreDefault();
  const layout = $('#btn-layout-default');
  if (layout) layout.disabled = layoutIsDefault();
}

/** Options tab: direction, neighbour depth, follow; the diagram shown is drawn again once. */
export function optionsToDefault() {
  const { plantumlDirection, neighbourDepth, neighbourDirection } = DEFAULTS;
  saveSettings({ plantumlDirection, neighbourDepth, neighbourDirection });
  $('#opt-direction').value = plantumlDirection;
  $('#opt-depth').value = String(neighbourDepth);
  $('#opt-follow').value = neighbourDirection;
  const def = state.diagramDef;
  if (def?.kind === 'neighbourhood' && def.depth > 0) renderDef({ ...def, depth: neighbourDepth, dir: neighbourDirection });
  else if (def) renderDef(def);
  updateDefaultButtons();
  updateOptionHints();
}

/** Filters tab: every type, no property filter, any language; Label and Colour by stay (Layout tab). */
export function filtersToDefault() {
  setFilter(new DiagramFilter(), { rerender: false });
  setPropertyOptions(new PropertyOptions({ label: state.props.label, colour: state.props.colour }), { redraw: true });
}

/** Layout tab: the Balanced preset, no nesting, no Label or Colour by; moved elements stay. */
export function layoutToDefault() {
  setLayoutPrefs(LayoutPrefs.decode(''), { rerender: false });
  setNesting(0, { rerender: false });
  setPropertyOptions(new PropertyOptions({ ...state.props, label: '', colour: '' }), { redraw: true });
}

export function setLayoutPrefs(lp, { rerender = true } = {}) {
  state.layoutPrefs = lp;
  saveSettings({ layoutPrefs: lp.encode() });
  renderLayoutPanel();
  updateLayoutButton();
  if (rerender && state.diagramDef && state.diagramDef.kind !== 'view') renderDef(state.diagramDef);
  else writeHash();
}

export function updateLayoutButton() {
  const b = $('#btn-layout');
  const lp = state.layoutPrefs;
  const parts = lp.isDefault() ? [] : [lp.describe()];
  if (state.props.colour) parts.push(t('colour: {property}', { property: state.props.colour }));
  if (state.props.label) parts.push(t('label: {property}', { property: state.props.label }));
  b.textContent = parts.length ? t('Layout: {options}', { options: parts.join(' · ') }) : t('Layout');
  b.classList.toggle('active', parts.length > 0);
  updateDefaultButtons();
}

/**
 * The Layout tab's nesting (LV-5): Composition and Aggregation as nested boxes, everywhere or
 * only inside a Grouping (API 2.9.0), optionally Assignment too.
 */
export function nestingRow() {
  const mode = nestingMode();
  const where = mode === 0 ? 'off' : mode >= 3 ? 'grouping' : 'all';
  const assignment = mode === 2 || mode === 4;
  const choose = (w, a) => setNesting(w === 'off' ? 0 : (w === 'grouping' ? 3 : 1) + (a ? 1 : 0));
  const option = (value, label, title) => h('label', { class: 'chip', title },
    h('input', { type: 'radio', name: 'layout-nesting', value, checked: where === value, onchange: () => choose(value, assignment) }), label);
  return h('div', { class: 'filter-row' }, h('strong', {}, t('Nesting')),
    option('off', t('Off'), t('All relationships as lines')),
    option('all', t('Composition and Aggregation'), t('The whole is drawn around its parts, and the relationship is not drawn as a line, as in Archi')),
    option('grouping', t('Only inside a Grouping'), t('Only a Grouping is drawn around its parts; other Composition and Aggregation stay lines')),
    h('label', { class: 'chip', title: t('Assignment nested as well, e.g. a node around the system software assigned to it') },
      h('input', { type: 'checkbox', name: 'layout-nesting-assignment', checked: assignment, disabled: where === 'off', onchange: e => choose(where, e.target.checked) }),
      t('… and Assignment too')));
}

export function renderLayoutPanel() {
  const panel = $('#layout-panel');
  if (panel.hidden) return; // drawn when opened
  const lp = state.layoutPrefs;
  const preset = lp.preset();
  const choice = (label, map, value, key) => h('label', { class: 'field' }, label,
    h('select', { onchange: e => setLayoutPrefs(lp.with({ [key]: e.target.value })) },
      Object.entries(map).map(([k, text]) => h('option', { value: k, selected: k === value }, text))));
  const pct = v => `${Math.round(v * 100)} %`;
  const g = state.gen;
  fill(panel,
    h('div', { class: 'filter-row' }, h('strong', {}, t('Preset')),
      Object.entries(PRESETS).map(([k, p]) => h('label', { class: 'chip', title: p.title },
        h('input', { type: 'radio', name: 'layout-preset', checked: preset === k, onchange: () => setLayoutPrefs(LayoutPrefs.fromPreset(k)) }), p.label)),
      preset ? null : h('span', { class: 'hint' }, t('Custom'))),
    h('div', { class: 'filter-row' }, h('strong', {}, t('Spacing')),
      h('input', {
        type: 'range', min: 0.4, max: 2.5, step: 0.1, value: lp.spacing, 'aria-label': t('Spacing'),
        oninput: e => { e.target.nextElementSibling.textContent = pct(e.target.value); },
        onchange: e => setLayoutPrefs(lp.with({ spacing: Number(e.target.value) })),
      }),
      h('span', {}, pct(lp.spacing))),
    h('div', { class: 'filter-row' }, h('strong', {}, t('Strategy')),
      choice(t('Layers'), LAYERING, lp.layering, 'layering'),
      choice(t('Placement'), PLACEMENT, lp.placement, 'placement'),
      choice(t('Lines'), ROUTING, lp.routing, 'routing'),
      h('label', { class: 'chip', title: t('Relationships of one type leave busy elements (5+ relationships) from one point') },
        h('input', { type: 'checkbox', checked: lp.hubs, onchange: e => setLayoutPrefs(lp.with({ hubs: e.target.checked })) }), t('Bundle at busy elements'))),
    nestingRow(),
    propertyDisplayRow(state.props, state.store?.propertyIndex, o => setPropertyOptions(o)),
    h('div', { class: 'filter-row' }, h('strong', {}, t('Manual')),
      ...manualButtons(),
      h('span', { class: 'hint' }, g && isManual(g.manual)
        ? (g.manual.hints
          ? t('{n} element(s) moved after Tidy.', { n: g.manual.pins.size })
          : t('{n} element(s) moved.', { n: g.manual.pins.size }))
        : t('Drag elements in the Diagram tab to move them.'))),
    h('div', { class: 'filter-row panel-default' },
      h('button', {
        type: 'button', id: 'btn-layout-default', disabled: layoutIsDefault(), onclick: layoutToDefault,
        title: t('Balanced preset, no nesting, no label or colour by a property; moved elements stay (Manual: Reset)'),
      }, t('Set to default'))),
    h('div', { class: 'filter-row hint' },
      t('Applies to generated diagrams (neighbourhood, basket, type, folder, impact); stored views keep their own layout and nesting.') + ' '
      + t('Labels and colours by a property apply to stored views too.') + ' '
      + t('Moved positions are remembered per diagram in this browser and included in Copy link.') + ' '
      + t('Tidy re-runs the automatic layout, keeping the rows/columns and order of your arrangement.')));
}


// ---------------------------------------------------------------- diagram definitions
// A definition says *what* a diagram shows, so it can be re-rendered (filter or
// depth change) and shared in the URL (`d=` hash parameter):
//   { kind: 'elements', ids, label?, notes? }  explicit set, e.g. the basket   -> el~1.2.3[~<view>.<note>…]
//   { kind: 'neighbourhood', seeds, depth, dir, label? }      dir: both|out|in -> nb~<depth>~1.2.3[~o|~i]
//   { kind: 'type', type }                     all elements of one type        -> ty~BusinessActor
//   { kind: 'view', id, trail? }               stored view; trail = views drilled through -> v~4[~58.2]
//   { kind: 'folder', id }                     elements filed in a folder (recursive)     -> fo~12
//   { kind: 'impact', id, dir, depth, types }  impact/dependency analysis (BR-12)         -> im~459~i~5[~Serving.Flow]
//   { kind: 'explore', seeds, ids, hiddenRels?, notes? } explorer: elements expanded so far (ALT-1),
//                                              notes { view, refs } of a view's editable copy (CM-14) -> ex~…~…~…~<view>.<note>…
//                                              relationships hidden (CM-9)  -> ex~459~459.502.68[~811.812]
//   { kind: 'layer', key }                     all elements of a layer (CM-5)            -> la~business
//   { kind: 'reltype', type }                  ends of all relationships of a type (CM-5) -> rt~Serving | rt~@rel
//   impact with several start elements (CM-6): ids                                        -> im~459.502~i~5
//   { kind: 'paths', from, to }                the shortest paths between two elements (HLP-4) -> pa~459~502
//   { kind: 'whole' }                          every element of the model (2.28.0, API 3.20.0)  -> wm

export const DIR_CODES = { out: 'o', in: 'i' };

/** Start elements of an impact diagram. */
export function impactStarts(def) {
  return def.ids?.length ? def.ids : [def.id];
}

/**
 * A diagram definition as text. `ref(kind, id)` writes an item (default: its id; BR-17:
 * refOf, its XMI identifier, for links and the keys of stored layouts).
 */
export function encodeDef(def, ref = (kind, id) => String(id)) {
  const list = (kind, ids) => ids.map(id => ref(kind, id)).join('.');
  switch (def.kind) {
    case 'elements': return `el~${list('element', def.ids)}${def.notes?.refs?.length ? `~${ref('view', def.notes.view)}.${def.notes.refs.join('.')}` : ''}`;
    case 'neighbourhood': return `nb~${def.depth}~${list('element', def.seeds)}${DIR_CODES[def.dir] ? '~' + DIR_CODES[def.dir] : ''}`;
    case 'type': return `ty~${def.type}`;
    case 'layer': return `la~${def.key}`;
    case 'whole': return 'wm';
    case 'reltype': return `rt~${def.type}`;
    case 'view': return `v~${ref('view', def.id)}${def.trail?.length ? '~' + list('view', def.trail) : ''}`;
    case 'folder': return `fo~${ref('folder', def.id)}`;
    case 'explore': {
      // CM-14: ~<view>.<note>.<note> after the hidden relationships: the notes of the view copied
      const notes = def.notes?.refs?.length ? `~${ref('view', def.notes.view)}.${def.notes.refs.join('.')}` : '';
      const hidden = def.hiddenRels?.length ? list('relationship', def.hiddenRels) : '';
      return `ex~${list('element', def.seeds)}~${list('element', def.ids)}${hidden || notes ? '~' + hidden : ''}${notes}`;
    }
    case 'impact': {
      const t = encodeTypes(def.types);
      return `im~${list('element', impactStarts(def))}~${def.dir === 'dependencies' ? 'd' : 'i'}~${def.depth}${t ? '~' + t : ''}`;
    }
    case 'paths': return `pa~${ref('element', def.from)}~${ref('element', def.to)}`;
    default: return '';
  }
}

/**
 * A diagram definition from text. `idOf(token, kind)` reads an item: an id, or null
 * to leave it out (default: ids only; resolveHash turns XMI identifiers into ids first).
 */
export function decodeDef(str, idOf = token => (isId(token) ? Number(token) : null)) {
  const [kind, a, b, c, d] = String(str).split('~');
  const ids = (s, k = 'element') => (s || '').split('.').filter(Boolean).map(x => idOf(x, k)).filter(Number.isInteger);
  const one = (s, k) => (s ? idOf(s, k) : null);
  const notesIn = part => {
    const [v, ...refs] = (part || '').split('.').filter(Boolean);
    const view = v ? one(v, 'view') : null;
    return Number.isInteger(view) && refs.length ? { notes: { view, refs } } : {};
  };
  if (kind === 'el') return { kind: 'elements', ids: ids(a), ...notesIn(b) };
  if (kind === 'nb') {
    const dir = c === 'o' ? 'out' : c === 'i' ? 'in' : 'both';
    return { kind: 'neighbourhood', depth: Math.max(0, Math.min(3, Number(a) || 0)), seeds: ids(b), dir };
  }
  if (kind === 'ty') return { kind: 'type', type: a };
  if (kind === 'la') return LAYERS.some(l => l.key === a) ? { kind: 'layer', key: a } : null;
  if (kind === 'wm') return { kind: 'whole' };
  if (kind === 'rt') return RELATIONSHIP_TYPES.includes(a) || a === '@rel' ? { kind: 'reltype', type: a } : null;
  if (kind === 'v') { const id = one(a, 'view'); return Number.isInteger(id) ? { kind: 'view', id, trail: ids(b, 'view') } : null; }
  if (kind === 'fo') { const id = one(a, 'folder'); return Number.isInteger(id) ? { kind: 'folder', id } : null; }
  if (kind === 'pa') {
    const from = one(a, 'element'), to = one(b, 'element');
    return Number.isInteger(from) && Number.isInteger(to) ? { kind: 'paths', from, to } : null;
  }
  if (kind === 'ex') return { kind: 'explore', seeds: ids(a), ids: ids(b), hiddenRels: ids(c, 'relationship'), ...notesIn(d) };
  if (kind === 'im') {
    const [, , , , t] = String(str).split('~');
    const starts = ids(a);
    if (!starts.length) return null;
    return {
      kind: 'impact', id: starts[0], ids: starts.length > 1 ? starts : undefined,
      dir: b === 'd' ? 'dependencies' : 'impact', depth: Math.max(1, Math.min(10, Number(c) || 5)), types: decodeTypes(t),
    };
  }
  return null;
}

export function namesOf(ids) {
  const names = ids.map(id => state.store.element(id)?.name || `#${id}`);
  return names.length <= 3 ? names.join(', ') : t('{n} elements', { n: names.length });
}

/**
 * Render a diagram definition (the single entry point for all diagrams).
 * Explorer steps (ALT-1) pass `hints` (positions for the layout), `fresh`
 * (element ids just added) and `explorerStep` (keeps the Back history).
 * BR-15: it is drawn in the tab shown, or in `doc`; `newTab` (or a Ctrl- or middle-click on what
 * asked for it, see tabs.js) opens a new tab for it.
 */
export async function renderDef(def, { hints = null, pins = null, fresh = null, explorerStep = false, doc = null, newTab = false } = {}) {
  if (!def || !state.store) return;
  doc ??= (newTab || consumeNewTab()) ? openDoc() ?? state.doc : state.doc;
  if (!explorerStep) {
    doc.exploreBack = [];
    doc.editing = null; // BR-25: a new diagram is no longer the view this tab edited, nor a copy of one
    doc.copyOf = null;
    doc.proposal = null;
    doc.recipeOf = null; // 2.30.0: openRecipe() sets it again after this
  }
  doc.pending = null;
  if (def.kind === 'view') { showView(def.id, def.trail || [], doc); return; }
  // BR-18: a folder diagram's link and stored layout name the folder by its path
  if (def.kind === 'folder' && !state.store.folders) await state.store.loadFolders().catch(() => {});
  if (doc === state.doc) renderTrail(null);
  // EN-2: one diagram at a time per tab; a stored view or another diagram of this tab still loading is dropped
  const signal = startJob(`view:${doc.id}`);
  try {
    if (def.kind === 'impact') await renderImpact(def, signal, doc);
    else if (def.kind === 'paths') await renderPaths(def, signal, doc);
    else await renderSet(def, { hints, pins, fresh }, signal, doc);
  } catch (e) {
    if (isAbort(e) || signal.aborted) return;
    status(errorMessage(e), true);
    showDiagramError(e, describeDef(def), () => renderDef(def, { hints, fresh, explorerStep, doc }), doc);
  }
}

/**
 * A neighbourhood, or a set of elements (the basket, a type, a layer, a
 * folder, a relationship type, an explorer step), with the relationships
 * between them. The API says what belongs to it and what to draw (HLP-1,
 * HLP-2); the diagram filters are part of the question.
 */
export async function renderSet(def, { hints, pins = null, fresh }, signal, doc = state.doc) {
  const s = state.store;
  const f = doc.filter;
  const po = doc.props;
  const filtering = !f.isDefault() || po.hasFilter();
  let res, seeds = new Set(), title;

  // UP-3: the elements a definition names (a link, the basket) may not be cached yet
  await s.ensure({ elements: [...(def.seeds || []), ...(def.ids || [])] }, { signal });
  if (def.kind === 'neighbourhood') {
    const dir = def.dir || 'both';
    seeds = new Set(def.seeds.filter(id => s.element(id)));
    if (!seeds.size) { status(t('Element #{id} not found.', { id: def.seeds[0] ?? '?' }), true); return; }
    res = await graph.neighbourhood(s, { seeds, depth: def.depth, direction: dir, filter: f, props: po }, { signal });
    const what = def.label || namesOf([...seeds]);
    const vars = { what, depth: def.depth };
    title = !def.depth ? what
      : dir === 'out' ? t('Outgoing neighbourhood of {what} (depth {depth})', vars)
      : dir === 'in' ? t('Incoming neighbourhood of {what} (depth {depth})', vars)
      : t('Neighbourhood of {what} (depth {depth})', vars);
  } else {
    // how the set is named
    const named = def.kind === 'type' ? { elementType: def.type }
      : def.kind === 'folder' ? { folderId: def.id }
      : def.kind === 'layer' ? { layer: def.key }
      : def.kind === 'whole' ? { allElements: true }
      : def.kind === 'reltype' ? (def.type === '@rel' ? { onRelationships: true } : { relationshipType: def.type })
      : { elementIds: def.ids.filter(id => s.element(id)) };
    res = await graph.subgraph(s, named, {
      filter: f, props: po, exclude: def.kind === 'explore' ? def.hiddenRels || [] : [],
    }, { signal });
  }
  if (signal.aborted) return;
  // the API orders by id; a diagram of given elements keeps their order, so that an explorer step leaves the rest in place
  const ids = def.ids ? new Set(def.ids.filter(id => res.ids.has(id))) : res.ids;
  const candidates = ids.size + res.filtered.elements;
  if (def.kind !== 'neighbourhood') {
    if (def.kind === 'explore') seeds = new Set(def.seeds.filter(id => ids.has(id)));
    title = def.kind === 'type' ? t('All {type} elements', { type: prettyType(def.type) })
      : def.kind === 'layer' || def.kind === 'reltype' || def.kind === 'folder' || def.kind === 'whole' ? describeDef(def)
      : def.kind === 'explore' ? (!ids.size && !candidates ? t('Empty diagram')
        : `${def.seeds.length > 3 ? t('Explorer') : def.seeds.length ? t('Explorer: {names}', { names: namesOf(def.seeds) }) : t('Diagram')} (${t('{n} element|{n} elements', { n: ids.size })})`)
      : (def.label || t('Selection: {names}', { names: namesOf(def.ids.filter(id => s.element(id))) }));
  }

  if (ids.size > 400 && !RENDER_MODE && !confirm(t('The diagram has {n} elements and may be slow or unreadable. Continue?', { n: ids.size }))) return;
  await countHidden(ids, signal, doc); // the "+N" of every element (HLP-5)
  if (signal.aborted) return;
  // includes relationships attached to other drawn relationships (BR-6); a relationship-type
  // diagram draws only that type (CM-5); relationships hidden in an explorer stay hidden (CM-9)
  const hiddenRelIds = new Set(def.kind === 'explore' ? def.hiddenRels || [] : []);
  const relationships = res.relationships;
  const elements = [...ids].map(id => s.element(id)).filter(Boolean);
  const deco = po.decorate(elements);
  const { notes, lines } = def.notes ? await notesForDiagram(def.notes, ids, signal) : { notes: [], lines: [] };
  if (signal.aborted) return;
  doc.diagramDef = def;
  const nesting = res.nesting;
  setDiagram({ title, ...diagramFromElements({ elements, relationships, title, highlight: seeds, deco, nesting }) }, doc);
  // an explorer step's arrangement is remembered like a manual layout (LV-6), so reloads and links reproduce it
  // BR-25: a created view being edited starts with each element pinned where the view has it
  if (hints || pins) saveManual(manualKey(def, { doc }), { hints, pins: pins || new Map() }, keyOut);
  layoutGenerated({ elements, relationships, focus: seeds, deco, nesting, fresh, notes, lines }, { doc });

  const active = [!f.isDefault() && `“${filterLabel(f)}”`, po.hasFilter() && `“${po.describeFilter()}”`].filter(Boolean).join(' + ');
  setDiagramInfo(t('{n} elements · {m} relationships', { n: ids.size, m: relationships.length })
    + (notes.length ? ' · ' + t('{n} note|{n} notes', { n: notes.length }) : '')
    + (filtering ? ' · ' + t('filter {filter} hides {n} element(s) and {m} relationship(s) among the shown ones', { filter: active, n: res.filtered.elements, m: res.filtered.relationships }) : '')
    + decoInfo(deco)
    + (res.truncated ? ' · ' + t('the API cut the result at its limit') : '')
    + (hiddenRelIds.size ? ' · ' + t('{n} relationship(s) hidden (right-click the background to show them)', { n: hiddenRelIds.size }) : '')
    + (def.kind === 'explore' && !candidates ? ' — ' + t('select elements in the tree and choose “Add to diagram”')
      : ids.size === 0 ? ' — ' + t('nothing to show; relax the filter') : '')
    + (def.kind === 'explore' && candidates ? ' · ' + t('click +N or double-click an element to show related elements, right-click for choices') : ''), doc);
  if (doc === state.doc) writeHash();
}

// Distance colours for impact diagrams: the start element is the "hottest".
export const DISTANCE_COLOURS = ['#fd8d3c', '#fdae6b', '#fdd0a2', '#fee6ce', '#fff5eb'];

/**
 * Impact/dependency diagram (BR-12): start element + everything reached, drawn
 * along the relationships the analysis walked. The API analyses and says what to draw (HLP-3).
 */
export async function renderImpact(def, signal, doc = state.doc) {
  const s = state.store;
  await s.ensure({ elements: impactStarts(def) }, { signal });
  const starts = impactStarts(def).filter(id => s.element(id)); // several start elements: CM-6
  const start = s.element(starts[0]);
  if (!start) { status(t('Element #{id} not found.', { id: def.id }), true); return; }
  const startSet = new Set(starts);
  const a = await graph.impact(s, starts, { direction: def.dir, types: def.types, maxDepth: def.depth, draw: true }, { signal });
  if (signal.aborted) return;
  const ids = new Set([...starts, ...a.results.keys()]);
  const elements = [...ids].map(id => s.element(id)).filter(Boolean);
  // only the relationships the analysis walked along (plus relationships they attach to, BR-6)
  const relationships = a.relationships;
  await countHidden(ids, signal, doc);
  if (signal.aborted) return;

  const level = id => (startSet.has(id) ? 0 : a.results.get(id)?.level ?? 0);
  const po = doc.props;
  let deco = po.decorate(elements);
  if (!po.colour) {
    const levels = [...new Set(elements.map(e => level(e.id)))].sort((x, y) => x - y);
    const colourOf = l => DISTANCE_COLOURS[Math.min(l, DISTANCE_COLOURS.length - 1)];
    deco = {
      ...deco,
      colour: el => colourOf(level(el.id)),
      legendTitle: t('Distance'),
      legend: levels.map(l => [colourOf(l), l === 0 ? `0 — ${starts.length > 1 ? t('{n} start elements', { n: starts.length }) : start.name || t('start')}` : `${l}`]),
    };
  }
  const title = `${DIRECTIONS[def.dir]?.short || t('Impact of')} ${starts.length > 1 ? namesOf(starts) : start.name || '#' + def.id}`;
  doc.diagramDef = def;
  const nesting = a.nesting;
  setDiagram({ title, ...diagramFromElements({ elements, relationships, title, highlight: startSet, deco, nesting }) }, doc);
  layoutGenerated({ elements, relationships, focus: startSet, deco, nesting }, { doc });

  const usedTypes = [...new Set(relationships.map(r => r.type))];
  const filtersSet = !doc.filter.isDefault() || po.hasFilter();
  setDiagramInfo(t('{n} element(s) over {levels} level(s) · depth ≤ {depth} · via {types}', { n: a.results.size, levels: a.maxLevel, depth: def.depth, types: usedTypes.join(', ') || '—' })
    + (a.truncated ? ' · ' + t('more beyond depth {depth}', { depth: def.depth }) : '')
    + (filtersSet ? ' · ' + t('type/property filters are not applied to impact analysis') : ''), doc);
  if (doc === state.doc) writeHash();
}

/** HLP-4: the shortest paths between two elements, as a diagram of what lies on them. */
export function showPaths(from, to) {
  state.pathFrom = null;
  renderDef({ kind: 'paths', from, to });
}

export const PATHS_WANTED = 3, PATH_MAX_LENGTH = 6;

export async function renderPaths(def, signal, doc = state.doc) {
  const s = state.store;
  await s.ensure({ elements: [def.from, def.to] }, { signal });
  const from = s.element(def.from), to = s.element(def.to);
  if (!from || !to) { status(t('Element #{id} not found.', { id: from ? def.to : def.from }), true); return; }
  const title = describeDef(def);
  if (def.from === def.to) { status(t('A path needs two different elements.'), true); return; }
  const found = await graph.paths(s, def.from, def.to, { k: PATHS_WANTED, maxLength: PATH_MAX_LENGTH }, { signal });
  if (signal.aborted) return;
  if (!found.paths.length) {
    status(t('No path of up to {n} relationships between {from} and {to}.', { n: PATH_MAX_LENGTH, from: from.name || '#' + from.id, to: to.name || '#' + to.id }), true);
    return; // the current diagram stays
  }
  // what lies on the paths, in the order of the shortest one first; only the relationships of the paths are drawn
  const ids = new Set(found.paths.flatMap(p => p.elements));
  const onPath = new Set(found.paths.flatMap(p => p.relationships));
  // a relationship of a path that ends on a relationship needs that one drawn too, with its own ends (BR-6)
  const need = rid => {
    const r = s.relationship(rid);
    for (const end of [r?.sourceRelationshipId, r?.targetRelationshipId]) {
      const other = end != null && !onPath.has(end) ? s.relationship(end) : null;
      if (!other) continue;
      onPath.add(end);
      for (const e of [other.sourceElementId, other.targetElementId]) if (e != null) ids.add(e);
      need(end);
    }
  };
  [...onPath].forEach(need);
  const res = await graph.subgraph(s, { elementIds: [...ids] }, { nesting: false }, { signal });
  await countHidden(ids, signal, doc);
  if (signal.aborted) return;
  const relationships = res.relationships.filter(r => onPath.has(r.id));
  const elements = [...ids].map(id => s.element(id)).filter(Boolean);
  const ends = new Set([def.from, def.to]);
  const deco = doc.props.decorate(elements);
  doc.diagramDef = def;
  setDiagram({ title, ...diagramFromElements({ elements, relationships, title, highlight: ends, deco, nesting: null }) }, doc);
  layoutGenerated({ elements, relationships, focus: ends, deco, nesting: null }, { doc });
  const shortest = found.paths[0].length;
  setDiagramInfo(t('{n} path, {m} relationship(s) long|{n} paths, the shortest {m} relationship(s) long', { n: found.paths.length, m: shortest })
    + ' · ' + t('the direction of relationships is ignored')
    + (found.paths.length === PATHS_WANTED ? ' · ' + t('there may be more paths') : '')
    + decoInfo(deco), doc);
  if (doc === state.doc) writeHash();
}

export function decoInfo(deco) {
  if (!deco.legend) return '';
  const n = deco.legend.filter(([, text]) => text !== NOT_SET).length;
  return ' · ' + (deco.reused
    ? t('coloured by “{title}” ({n} value; colours repeat)|coloured by “{title}” ({n} values; colours repeat)', { title: deco.legendTitle, n })
    : t('coloured by “{title}” ({n} value)|coloured by “{title}” ({n} values)', { title: deco.legendTitle, n }));
}

// ---------------------------------------------------------------- filters (BR-3)

export function filterLabel(filter = state.filter) {
  const vp = filter.matchingViewpoint();
  const code = filter.encode();
  return vp ? VIEWPOINTS[vp].label : (settings.savedFilters || []).find(sf => sf.code === code)?.name || t('Custom');
}

export const filterPanel = renderFilterPanel($('#type-filter-panel'), () => state.filter, f => setFilter(f), { saved: () => settings.savedFilters || [] });

export function setFilter(f, { rerender = true } = {}) {
  state.filter = f;
  saveSettings({ filter: f.encode() });
  filterPanel.redraw();
  updateFilterButton();
  if (rerender && state.diagramDef) renderDef(state.diagramDef); // a stored view fades what is left out
  else writeHash();
}

// ---------------------------------------------------------------- property options (BR-7)

export const propertyPanel = renderPropertyPanel($('#property-panel'), () => state.props, () => state.store?.propertyIndex, // the API's index (HLP-9)
  o => setPropertyOptions(o));

/**
 * The panel redraws itself after its own edits (redraw: false keeps focus in
 * the value input while typing); external changes (URL) pass redraw: true.
 * Display options (label/colour) apply to stored views too, so all diagrams re-render.
 */
export function setPropertyOptions(o, { rerender = true, redraw = false } = {}) {
  state.props = o;
  saveSettings({ propertyOptions: o.encode() });
  if (redraw) propertyPanel.redraw();
  updateFilterButton();
  updateLayoutButton();
  renderLayoutPanel(); // Label and Colour by are in the Layout tab
  if (rerender && state.diagramDef) renderDef(state.diagramDef);
  else writeHash();
}

export function updateFilterButton() {
  const b = $('#btn-filters');
  const parts = [];
  if (!state.filter.isDefault()) parts.push(filterLabel());
  if (state.props.hasFilter()) parts.push(state.props.describeFilter());
  b.textContent = parts.length ? t('Filters: {filters}', { filters: parts.join(' · ') }) : t('Filters');
  b.classList.toggle('active', parts.length > 0);
  updateDefaultButtons();
  b.title = parts.length ? parts.join('\n') : t('Filter element/relationship types and properties');
}

export function setDiagramInfo(text, doc = state.doc) {
  doc.info = text || ''; // layoutGenerated() appends layout notes to it
  if (doc === state.doc) $('#diagram-info').textContent = doc.info;
}

export function showElements(ids, label) { renderDef({ kind: 'elements', ids: [...ids], label }); }

export function showNeighbourhood(ids, label, depth = Number(settings.neighbourDepth)) {
  renderDef({ kind: 'neighbourhood', seeds: [...ids], depth, dir: settings.neighbourDirection || 'both', label });
}

/** Elements referenced by the nodes of a view (for colour scales). */
export function viewElements(nodes) {
  const out = [];
  const walk = list => list.forEach(n => {
    const el = n.elementRefId != null ? state.store.element(n.elementRefId) : null;
    if (el) out.push(el);
    walk(n.children || []);
  });
  walk(nodes);
  return out;
}

// ---------------------------------------------------------------- view drill-down (BR-8)

/**
 * Open a view referenced from the current view (a drill-down link). The
 * current view is appended to the breadcrumb trail, and a browser history
 * entry is added so the Back button returns to the previous view.
 */
export function drillToView(viewId) {
  const s = state.store;
  if (!s.view(viewId)) {
    // 2.27.2: a copy of part of the model holds only the views of that part
    if (isPartialCopy()) status(t('The view this link opens is not in this offline copy: it holds only part of the model.'));
    else status(t('Referenced view #{id} does not exist in this model.', { id: viewId }), true);
    return;
  }
  const cur = state.diagramDef?.kind === 'view' ? state.diagramDef : null;
  let trail = cur ? [...(cur.trail || []), cur.id] : [];
  const loop = trail.indexOf(viewId);
  if (loop >= 0) trail = trail.slice(0, loop); // drilling back up to a view already on the trail
  history.pushState(null, '', location.href); // keep the current view as a Back target
  select('view', viewId);
  showView(viewId, trail);
}

/** Breadcrumbs: "View A › View B › current"; null/empty clears the bar. */
export function renderTrail(def) {
  const bar = $('#view-trail');
  const trail = def?.kind === 'view' ? def.trail || [] : [];
  if (!trail.length) { bar.replaceChildren(); return; }
  const s = state.store;
  const crumbs = [];
  trail.forEach((id, i) => {
    crumbs.push(h('a', {
      title: t('Back to this view'),
      onclick: () => { history.pushState(null, '', location.href); select('view', id); showView(id, trail.slice(0, i)); },
    }, s.view(id)?.name || `#${id}`), h('span', { class: 'sep' }, '›'));
  });
  crumbs.push(h('span', { class: 'current' }, s.view(def.id)?.name || `#${def.id}`));
  bar.replaceChildren(h('span', { class: 'muted' }, '🖼'), ...crumbs);
}

/**
 * What the diagram filters leave out of a stored view: { elements, relationships } (sets of ids),
 * drawn faint, so that the view keeps its layout; null when no filter is set.
 */
export function fadedInView(nodes, connections, doc = state.doc) {
  const { filter, props } = doc;
  if (filter.isDefault() && !props.hasFilter()) return null;
  const s = state.store;
  const elements = new Set(), relationships = new Set();
  for (const id of viewElements(nodes).map(e => e.id)) {
    const e = s.element(id);
    if (e && !(filter.elementOk(e) && props.elementOk(e))) elements.add(id);
  }
  for (const c of connections) {
    const r = c.relationshipRefId != null ? s.relationship(c.relationshipRefId) : null;
    if (r && !filter.relOk(r, id => s.element(id)?.type)) relationships.add(r.id);
  }
  return { elements, relationships };
}
