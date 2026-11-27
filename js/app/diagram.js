// ArchiMate Browser: Diagrams: rendering, the explorer (ALT-1), drag and drop, notes of an editable copy.
// Part of js/app.js until 2026-10-24 (EN-6); app.js wires it to the page.

import { isAbort, isPartialCopy } from '../api.js';
import { settings, saveSettings } from '../config.js';
import { t } from '../i18n.js';
import { DRAG_TYPE } from '../tree.js';
import { LAYERS, prettyType } from '../archimate.js';
import { diagramFromView, plantumlUrl, fetchPlantUmlSvg, parseSvg, annotateSvg } from '../plantuml.js';
import { renderViewSvg, createMinimap } from '../viewsvg.js';
import { layoutElements, nodeSize } from '../elklayout.js';
import { collapseAround, hintsForExpansion, START_NEIGHBOURS } from '../explorer.js';
import { applyPins, positionsOf, findNode, emptyManual, isManual, loadManual, saveManual } from '../manual.js';
import { escapeRef } from '../refs.js';
import { DIRECTIONS } from '../impact.js';
import * as graph from '../graph.js';
import { layerElementIds, relTypeEndIds } from './basket.js';
import { ctx, fill } from './details.js';
import {
  clearHighlight, copyText, markElements, openCanvasMenu, openConnMenu, openLegendMenu, openMinimapMenu, openNodeMenu,
  openViewNodeMenu, openViewOtherNodeMenu, plainSelect, popupMenu, refreshMarks, withContextMenu,
} from './menus.js';
import {
  decoInfo, drillToView, encodeDef, fadedInView, impactStarts, namesOf, renderDef, renderLayoutPanel,
  renderTrail, setDiagramInfo, updateDefaultButtons, viewElements,
} from './panels.js';
import { highlightInDiagrams, keyInFor, keyOut, linkDef, modelKey, writeHash } from './routing.js';
import { autoPane } from './shell.js';
import { canRecipe, canWrite, editBar, editingOf, isCreated, openRecipe, proposalBar, recipeOf, saveAsRecipe, saveAsView, saveIntoRecipe } from './views.js';
import { paletteStrip } from './toolbox.js';
import { $, newDoc, state } from './state.js';
import { consumeNewTab, docPanel, newTabRequested, openDoc, renderDocTabs } from './tabs.js';
import { RENDER_MODE, cancelJob, errorBox, errorMessage, h, startJob, status } from './ui.js';

// ================================================================ diagrams

// Tabs: "layout" = the native Diagram (stored coordinates for views, ELK
// auto-layout for generated diagrams; nothing leaves the browser),
// "plantuml" = optional server rendering (only when that tab is opened),
// "source" = the PlantUML text (export / editing).
export function setTab(tab) {
  state.tab = tab;
  saveSettings({ diagramTab: tab });
  for (const b of document.querySelectorAll('#view-menu [data-tab]')) b.setAttribute('aria-checked', String(b.dataset.tab === tab));
  for (const t of ['plantuml', 'layout', 'source']) $(`#tab-${t}`).hidden = t !== tab;
  if (tab === 'plantuml' && state.diagram && !state.diagram.pumlRequested) renderPlantUml(state.diagram.source);
  updateToolbar();
}

/**
 * UX-4: mark the options that do not change the diagram shown. They stay usable: depth and
 * Follow are also what "Neighbourhood diagram", "+ neighbours" and the explorer use next.
 */
export function updateOptionHints() {
  const kind = state.diagramDef?.kind;
  const mark = (sel, active, why) => {
    const label = $(sel).closest('label');
    label.dataset.title ??= label.getAttribute('title') || '';
    label.classList.toggle('inactive', !active);
    if (active) { if (label.dataset.title) label.title = label.dataset.title; else label.removeAttribute('title'); }
    else label.title = why;
  };
  const nb = kind === 'neighbourhood' && state.diagramDef.depth > 0;
  mark('#opt-direction', !kind || kind !== 'view', t('A stored view keeps its own layout; the direction applies to generated diagrams.'));
  mark('#opt-depth', !kind || nb, t('Not used by the diagram shown; it sets the depth of the next neighbourhood diagram and of “+ neighbours”.'));
  mark('#opt-follow', !kind || nb || kind === 'explore', t('Not used by the diagram shown; it applies to neighbourhood diagrams, “+ neighbours” and the explorer’s counts.'));
}

export function updateToolbar() {
  updateOptionHints();
  const has = !!state.diagram;
  $('#btn-link').disabled = !state.diagramDef;
  syncAddButton();
  syncOnDiagram();
  $('#btn-copy').disabled = !has;
  $('#btn-dl-puml').disabled = !has;
  $('#btn-open').disabled = !(state.tab === 'plantuml' && state.diagram?.url);
  $('#btn-dl-svg').disabled = !(state.tab === 'plantuml' ? state.diagram?.url : state.layout);
  $('#btn-dl-png').disabled = $('#btn-dl-svg').disabled;
  $('#btn-copy-png').disabled = $('#btn-dl-svg').disabled || typeof ClipboardItem !== 'function' || !navigator.clipboard?.write;
  $('#btn-dl-csv').disabled = !(state.diagramDef && (state.gen || state.diagramDef.kind === 'view'));
  $('#btn-dl-json').disabled = $('#btn-dl-csv').disabled;
  $('#btn-share-menu').disabled = [...$('#share-menu').querySelectorAll('button')].every(b => b.disabled);
}

/** PlantUML tab placeholder: rendering is on demand because it sends the source to the server. */
export function plantumlPlaceholder() {
  $('#tab-plantuml').replaceChildren(h('div', { class: 'placeholder' },
    h('p', {}, t('PlantUML rendering sends the diagram source (element names) to {server}.').split('{server}')
      .flatMap((part, i) => (i ? [h('code', {}, settings.plantumlServer), part] : [part]))),
    h('button', { class: 'primary', onclick: () => renderPlantUml(state.diagram.source) }, t('Render with PlantUML'))));
}

export async function renderPlantUml(source, doc = state.doc) {
  if (!doc.diagram || doc !== state.doc) return; // one PlantUML panel: it shows the active tab's diagram
  doc.diagram.pumlRequested = true;
  const panel = $('#tab-plantuml');
  const seq = ++doc.renderSeq;
  const current = () => seq === doc.renderSeq && doc === state.doc;
  panel.replaceChildren(h('div', { class: 'placeholder' }, t('Rendering…')));
  let url;
  try {
    url = await plantumlUrl(source, 'svg');
  } catch (e) {
    panel.replaceChildren(h('div', { class: 'diagram-error' }, t('Cannot encode diagram: {message}', { message: e.message })));
    return;
  }
  doc.diagram.url = url;
  updateToolbar();

  // Preferred: inline the SVG so elements and relationships are clickable.
  try {
    const svg = parseSvg(await fetchPlantUmlSvg(url, { source })); // PU-2: a long one by POST
    if (!current()) return; // a newer diagram was requested meanwhile, or another tab is shown
    svg.classList.add('puml-svg');
    annotateSvg(svg, doc.diagram.refs);
    panel.replaceChildren(svg);
    highlightInDiagrams();
    return;
  } catch (e) {
    if (!current()) return;
    console.info('Inline PlantUML SVG unavailable, falling back to <img>:', e.message);
  }

  // Fallback (e.g. a PlantUML server without CORS): a plain, non-clickable image.
  const img = h('img', { alt: doc.diagram?.title || t('diagram'), title: t('Click to toggle between fit-to-width and actual size') });
  img.addEventListener('load', () => { if (current()) panel.replaceChildren(img); });
  img.addEventListener('error', () => panel.replaceChildren(h('div', { class: 'diagram-error' },
    t('The PlantUML server ({server}) did not return an image.', { server: settings.plantumlServer }) + '\n' +
    t('Check your network / the server URL in Settings, or copy the source from the Source tab.') + '\n' +
    (url.length > 8000 ? '\n' + t('The encoded diagram is long ({n} chars); some servers reject long GET URLs.', { n: url.length }) : ''))));
  img.src = url;
}

/**
 * Set the current diagram's title and PlantUML source (for the Source tab,
 * exports and the optional PlantUML tab). The native Diagram tab is filled
 * separately (mountLayout).
 */
export function setDiagram({ title, source, refs = null, view = null }, doc = state.doc) {
  doc.renderSeq++; // drop a PlantUML render of the previous diagram still in flight
  doc.diagram = { title, source, refs, view, url: null, pumlRequested: false };
  renderDocTabs();
  if (doc !== state.doc) return; // drawn in a tab not shown: its title and source are shown when it is
  autoPane('diagram'); // UX-1
  showDocHead(doc);
}

/** The title, the PlantUML source and panel, the info line and the toolbar of the document shown (BR-15). */
export function showDocHead(doc = state.doc) {
  const title = doc.diagram?.title || (doc.pending ? describeDef(doc.pending.def) : t('No diagram'));
  $('#diagram-title').textContent = title;
  $('#diagram-title').title = title;
  $('#source').value = doc.diagram?.source || '';
  if (!doc.diagram) {
    $('#tab-plantuml').replaceChildren(h('div', { class: 'placeholder' }, startHint()));
  } else if (state.tab === 'plantuml') {
    renderPlantUml(doc.diagram.source, doc);
  } else plantumlPlaceholder();
  $('#diagram-info').textContent = doc.info || '';
  renderTrail(doc.diagramDef);
  updateToolbar();
}

/** What an empty diagram pane says. */
export const startHint = () => t('Select a view, or an element and choose Neighbourhood diagram, or collect elements into the basket.');

/** Tidy / Undo / Reset buttons for the manual layout of a generated diagram (LV-6). */
export function manualButtons() {
  const g = state.gen;
  const manual = isManual(g?.manual);
  return [
    h('button', { type: 'button', onclick: tidyLayout, disabled: !manual, title: t('Re-run the automatic layout, keeping the rows/columns and order of your manual arrangement') }, t('Tidy')),
    h('button', { type: 'button', onclick: undoLayout, disabled: !g?.undo.length, title: t('Undo the last move, Tidy or Reset') }, t('Undo')),
    h('button', { type: 'button', onclick: resetLayout, disabled: !manual, title: t('Forget the manual positions of this diagram') }, t('Reset')),
  ];
}

/** Put a rendered diagram (renderViewSvg result) into its document's panel, with zoom tools, legend and minimap. */
export function mountLayout(layout, deco = {}, { generated = false, doc = state.doc } = {}) {
  doc.layout = layout;
  layout.svg.toggleAttribute('data-hide-rel-labels', !!settings.hideRelLabels); // 2.32.0
  if (RENDER_MODE) document.dispatchEvent(new CustomEvent('archi-render-drawn', { detail: { doc } })); // RN-1 (2.29.0)
  doc.highlight = null; // a new drawing has no highlighted path (CM-9)
  layout.svg.addEventListener('click', () => clearHighlight()); // background click (element clicks don't bubble here)
  doc.minimap?.destroy();
  const minimap = doc.minimap = settings.minimap !== false ? createMinimap(layout) : null;
  const mapButton = h('button', {
    type: 'button', 'data-tool': 'map', 'aria-pressed': String(settings.minimap !== false),
    title: t('Overview map, shown while part of the diagram is off screen (zoom in to see it)'),
    onclick: () => {
      saveSettings({ minimap: settings.minimap === false });
      mountLayout(layout, deco, { generated, doc });
    },
  }, t('Map'));
  const backButton = generated && doc.exploreBack?.length
    ? withContextMenu(h('button', { type: 'button', onclick: () => exploreBack(), title: t('Back to the diagram before the last expand/hide; right-click to jump further back') }, '← ' + t('Back')), openBackMenu)
    : null;
  // CM-7: each legend entry has a menu (its elements, filter by its value)
  const legendRow = ([colour, text]) => withContextMenu(h('div', { class: 'legend-row', tabindex: 0, title: t('Right-click for actions on these elements') },
    h('span', { class: 'swatch', style: `background:${colour}` }), text), at => openLegendMenu(deco, colour, text, at));
  if (minimap) {
    minimap.el.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); openMinimapMenu(ev, layout, minimap); });
  }
  fill(docPanel(doc),
    generated ? editBar(doc) ?? proposalBar(doc) : null, // BR-25: the created view this tab edits, or a proposed one
    generated ? paletteStrip(doc) : null, // BR-11 step 2 (2.24.0): the palette, while editing
    h('div', { class: 'layout-tools' },
      h('button', { onclick: () => layout.zoom(1 / 1.25), title: t('Zoom in') }, '+'),
      h('button', { onclick: () => layout.zoom(1.25), title: t('Zoom out') }, '−'),
      h('button', { onclick: () => layout.fit() }, t('Fit')),
      mapButton,
      backButton ? [h('span', { class: 'sep' }), backButton] : null,
      generated ? [h('span', { class: 'sep' }), ...manualButtons()] : null,
      generated && canWrite() && !editingOf(doc) && !doc.proposal ? [h('span', { class: 'sep' }), h('button', {
        type: 'button', 'data-tool': 'save-view', onclick: () => saveAsView(doc),
        title: t('Store this diagram, as it is drawn, as a view of the model (a created view)'),
      }, t('Save as view…'))] : null,
      // 2.30.0: a recipe: the link of the diagram, drawn again from the model whenever it is opened
      generated && canRecipe() && !editingOf(doc) && !doc.proposal ? h('button', {
        type: 'button', 'data-tool': 'save-recipe', onclick: () => (recipeOf(doc) ? saveIntoRecipe(doc) : saveAsRecipe(doc)),
        title: recipeOf(doc) ? t('Write what this diagram draws, its filters and options back into the recipe it was opened from')
          : t('Keep how this diagram is made (what it draws, filters, nesting) as a recipe in the model tree; it is drawn again from the model whenever it is opened'),
      }, recipeOf(doc) ? t('Save recipe “{name}”', { name: recipeOf(doc).name }) : t('Save as recipe…')) : null,
      h('span', { class: 'sep' }),
      h('button', {
        type: 'button', 'data-tool': 'clear', onclick: askClearDiagram, disabled: !canClear(),
        title: t('Empty the diagram, then add elements with “Add to diagram” in the element details (← Back restores it)'),
      }, t('Clear diagram'))),
    deco.legend ? h('div', { class: 'layout-legend', 'aria-label': t('Legend: {title}', { title: deco.legendTitle }) },
      h('strong', {}, deco.legendTitle),
      deco.legend.map(legendRow)) : null,
    minimap?.el,
    layout.svg);
  minimap?.update();
  highlightInDiagrams();
  refreshMarks();
  if (doc === state.doc) updateToolbar();
}

/**
 * The nesting of generated diagrams (LV-5) as one number, as links and manual layouts carry it:
 * 0 off, 1 Composition and Aggregation, 2 and Assignment, 3 and 4 the same inside a Grouping only.
 */
export function nestingMode() {
  if (!settings.nestGenerated) return 0;
  return (settings.nestGroupingOnly ? 3 : 1) + (settings.nestAssignment ? 1 : 0);
}

export function nestingSettings(mode) {
  return { nestGenerated: mode > 0, nestAssignment: mode === 2 || mode === 4, nestGroupingOnly: mode >= 3 };
}

/** Which automatic layout manual positions belong to: direction and nesting mode, e.g. "TB.n1". */
export function layoutSignature() {
  return `${settings.plantumlDirection === 'LR' ? 'LR' : 'TB'}.n${nestingMode()}`;
}

/** Adopt the direction/nesting of a diagram link's manual layout. */
export function adoptSignature(sig) {
  const [dir, nest] = String(sig || '').split('.');
  if (!['TB', 'LR'].includes(dir) || !/^n[0-4]$/.test(nest || '')) return;
  saveSettings({ plantumlDirection: dir, ...nestingSettings(Number(nest[1])) });
  $('#opt-direction').value = dir;
  updateDefaultButtons();
}

/** Choose the nesting (Layout tab, or a link's n=); a generated diagram is drawn again. */
export function setNesting(mode, { rerender = true } = {}) {
  if (mode === nestingMode()) return;
  saveSettings(nestingSettings(mode));
  renderLayoutPanel();
  if (rerender && state.diagramDef && state.diagramDef.kind !== 'view') renderDef(state.diagramDef);
  else writeHash();
}

/**
 * Storage key of a generated diagram's manual layout: same content, filters and layout settings.
 * BR-17: the content by reference, so the layout is found again after a replace of the model;
 * `legacy` gives the key with ids, as stored before.
 */
export function manualKey(def, { legacy = false, doc = state.doc } = {}) {
  const m = state.store.model;
  return [settings.apiBase, modelKey(m), legacy ? encodeDef(def) : linkDef(def), doc.filter.encode(), doc.props.encode(),
    layoutSignature(), doc.layoutPrefs.encode()].join('|');
}

/**
 * ELK auto-layout of a generated diagram (ALT-2), drawn by the native renderer.
 * Manual positions remembered for this diagram (LV-6) are applied on top.
 */
export async function layoutGenerated(args, { keepView = false, doc = state.doc } = {}) {
  const { elements, relationships, focus = new Set(), deco = {}, nesting = null, notes = [], lines = [] } = args;
  const seq = ++doc.layoutSeq;
  const key = manualKey(doc.diagramDef, { doc });
  const prev = doc.gen?.key === key ? doc.gen : null; // same diagram again (Tidy, Undo, Reset): keep the undo history
  let stored = loadManual(key, keyInFor(elements, relationships, notes)); // may just have arrived with a diagram link
  if (!isManual(stored)) {
    // stored before BR-17, under the key with ids: move it to the key with references
    stored = loadManual(manualKey(doc.diagramDef, { legacy: true, doc }));
    if (isManual(stored)) saveManual(key, stored, keyOut);
  }
  const manual = isManual(stored) || !prev ? stored : prev.manual;
  const view = keepView && doc.layout?.view ? doc.layout.view() : null;
  doc.layout = null;
  doc.gen = null;
  docPanel(doc).replaceChildren(h('div', { class: 'placeholder' }, t('Laying out {n} elements…', { n: elements.length })));
  if (doc === state.doc) updateToolbar();
  try {
    const base = await layoutElements({
      elements, relationships, focus, direction: settings.plantumlDirection, extraLabel: !!deco.extraLabel, nesting,
      prefs: state.layoutPrefs, hints: manual.hints, notes, lines,
    });
    if (seq !== doc.layoutSeq) return; // a newer diagram was requested for this tab meanwhile
    doc.gen = { args, base, key, manual, undo: prev?.undo || [] };
    drawGenerated(view, doc);
    let info = doc.info || '';
    if (nesting?.nestedRelIds.size) {
      info += ' · ' + (nesting.ancestorEdgeIds.size
        ? t('{n} relationship(s) shown as nesting, {m} more between nested elements not drawn', { n: nesting.nestedRelIds.size, m: nesting.ancestorEdgeIds.size })
        : t('{n} relationship(s) shown as nesting', { n: nesting.nestedRelIds.size }));
    }
    doc.info = info;
    if (doc !== state.doc) return;
    $('#diagram-info').textContent = info;
    writeHash(); // with the manual layout, if any
  } catch (e) {
    if (seq !== doc.layoutSeq) return;
    console.error(e);
    if (RENDER_MODE) document.dispatchEvent(new CustomEvent('archi-render-error', { detail: t('Automatic layout failed: {message}', { message: e.message }) }));
    docPanel(doc).replaceChildren(h('div', { class: 'diagram-error' },
      t('Automatic layout failed: {message}', { message: e.message }) + '\n' + t('The PlantUML tab can still render this diagram.')));
  }
}

/** Draw the current generated diagram: automatic layout + pinned positions (no new ELK run). */
export function drawGenerated(viewBox = null, doc = state.doc) {
  const g = doc.gen, s = state.store;
  g.shown = g.manual.pins.size ? applyPins(g.base, g.manual.pins) : g.base;
  const layout = renderViewSvg({
    nodes: g.shown.nodes, connections: g.shown.connections, deco: g.args.deco,
    elementById: id => s.element(id), relationshipById: id => s.relationship(id),
    onSelect: plainSelect, onMark: markElements,
    onMoveNode: moveNode, viewBox,
    absolute: true, // ELK coordinates (elk.json.shapeCoords = ROOT)
    // ALT-1: every generated diagram can be expanded (it turns into an explorer), so each shows its "+N" (2.19.0)
    onExpand: id => expandElement(id),
    onNodeMenu: (id, ev) => openNodeMenu(id, ev),
    onOtherNodeMenu: (node, ev) => (node.noteRef != null ? (openNoteMenu(node, ev), true) : false),
    onConnMenu: (id, ev) => openConnMenu(id, ev),
    onBackgroundMenu: ev => openCanvasMenu(ev),
    badge: id => hiddenCount(id, undefined, doc),
    fresh: g.args.fresh,
  });
  g.args.fresh = null; // highlight new elements once, not on every redraw
  mountLayout(layout, g.args.deco, { generated: true, doc });
  if (doc === state.doc) renderLayoutPanel(); // Tidy/Undo/Reset states
}

/** Change the manual layout of the current generated diagram (remembered, undoable). */
export function setManual(m) {
  const g = state.gen;
  g.undo.push(g.manual);
  if (g.undo.length > 50) g.undo.shift();
  g.manual = m;
  saveManual(g.key, m, keyOut);
  writeHash();
}

/** An element was dragged by (dx, dy): pin it at its new position. */
/** Elements dropped after a drag: one, or all the selected ones (CM-6); one step for Undo. */
export function moveNode(ids, dx, dy) {
  const g = state.gen;
  if (!g) return;
  const pins = new Map(g.manual.pins);
  let moved = false;
  for (const id of [ids].flat()) {
    const n = findNode(g.shown.nodes, id);
    if (!n) continue;
    // position before containers grew around moved children, so the container doesn't jump
    const at = g.shown.placed?.get(id) || n;
    // elements nested in it that were pinned before move along
    const walk = list => list.forEach(c => {
      const p = pins.get(c.id);
      if (p) pins.set(c.id, { x: p.x + dx, y: p.y + dy });
      walk(c.children || []);
    });
    walk(n.children || []);
    pins.set(id, { x: Math.round(at.x + dx), y: Math.round(at.y + dy) });
    moved = true;
  }
  if (!moved) return;
  setManual({ hints: g.manual.hints, pins });
  drawGenerated(state.layout?.view());
}

/** Re-run ELK with the current positions as hints (interactive strategies). */
export function tidyLayout() {
  const g = state.gen;
  if (!g) return;
  setManual({ hints: positionsOf(g.shown.nodes), pins: new Map() });
  layoutGenerated(g.args);
}

export function resetLayout() {
  const g = state.gen;
  if (!g) return;
  setManual(emptyManual());
  layoutGenerated(g.args);
}

export function undoLayout() {
  const g = state.gen;
  if (!g?.undo.length) return;
  const prev = g.undo.pop();
  const relayout = prev.hints !== g.manual.hints;
  g.manual = prev;
  saveManual(g.key, prev, keyOut);
  writeHash();
  if (relayout) layoutGenerated(g.args);
  else drawGenerated(state.layout?.view());
}

// ---------------------------------------------------------------- explorer (ALT-1)
// Any generated diagram can grow: expanding an element (double-click, its "+N"
// badge or the right-click menu) adds its related elements and turns the
// diagram into an explorer diagram (d=ex~…). The current arrangement is kept
// (positions become layout hints, see explorer.js); "← Back" undoes steps.

/** The diagram filters, as the explorer applies them to related elements. */
export function explorerOpts() {
  return { filter: state.filter, props: state.props };
}

/** Element ids drawn in the current generated diagram. */
export function shownIds() { return new Set((state.gen?.args.elements || []).map(e => e.id)); }

/**
 * "+N" of an element: related elements not shown yet (Follow direction, current filters).
 * The API counts them for all elements of a diagram at once when it is drawn (HLP-5, see countHidden).
 */
export function hiddenCount(id, direction = settings.neighbourDirection || 'both', doc = state.doc) {
  const c = doc.counts.get(id);
  return !c ? 0 : direction === 'out' ? c.out : direction === 'in' ? c.in : c.total;
}

/** Ask the API what the elements `ids`, about to be drawn, can still show; kept in state.counts. */
export async function countHidden(ids, signal, doc = state.doc) {
  doc.counts = await graph.expansionCounts(state.store, ids, ids, { filter: doc.filter, props: doc.props }, { signal });
}

/** Start exploring from elements: the element and (if only a few) its related elements. */
export async function exploreFrom(ids) {
  const s = state.store;
  await s.ensure({ elements: [...ids] });
  const seeds = [...ids].filter(id => s.element(id));
  if (!seeds.length) return;
  const shown = new Set(seeds);
  if (seeds.length === 1) {
    const near = await graph.hiddenNeighbours(s, seeds[0], shown, { ...explorerOpts(), direction: settings.neighbourDirection || 'both' });
    if (near.size <= START_NEIGHBOURS) near.forEach(id => shown.add(id));
  }
  renderDef({ kind: 'explore', seeds, ids: [...shown] });
}

/** Seeds of an explorer grown out of the current diagram. */
export function explorerSeeds(def, fallback) {
  if (def.kind === 'explore' || def.kind === 'neighbourhood') return def.seeds;
  if (def.kind === 'impact') return impactStarts(def);
  return [fallback];
}

export function pushExploreBack() {
  state.exploreBack.push(state.diagramDef);
  if (state.exploreBack.length > 50) state.exploreBack.shift();
}

/** Add the hidden related elements of `id` (optionally one direction / relationship type). */
export async function expandElement(id, { direction = settings.neighbourDirection || 'both', type = null } = {}) {
  const g = state.gen, def = state.diagramDef, s = state.store;
  if (!g || !def || def.kind === 'view') return;
  const visible = shownIds();
  const add = await graph.hiddenNeighbours(s, id, visible, { ...explorerOpts(), direction, type });
  if (state.gen !== g) return; // another diagram was drawn meanwhile
  const name = s.element(id)?.name || `#${id}`;
  if (!add.size) {
    const vars = { name, type, direction: direction === 'out' ? t('outgoing') : t('incoming') };
    status(type
      ? (direction !== 'both'
        ? t('{name}: no more related elements via {type} ({direction}) with the current filters.', vars)
        : t('{name}: no more related elements via {type} with the current filters.', vars))
      : (direction !== 'both'
        ? t('{name}: no more related elements ({direction}) with the current filters.', vars)
        : t('{name}: no more related elements with the current filters.', vars)));
    return;
  }
  if (visible.size + add.size > 400 && !RENDER_MODE && !confirm(t('The diagram would have {n} elements and may be slow or unreadable. Continue?', { n: visible.size + add.size }))) return;
  await growDiagram(add, { fromId: id, seeds: explorerSeeds(def, id) });
  status(t('Added {n} element related to {name}.|Added {n} elements related to {name}.', { n: add.size, name }));
}

/**
 * Next explorer step with `add` (element ids) added to the current generated
 * diagram. New elements are hinted next to `fromId`, or to the right of the
 * diagram when it is null (nothing related is shown).
 */
/**
 * Hints from a view's arrangement (`shape`: element id -> {x, y}) for `ids`,
 * centred on `at` (or at the origin).
 */
export function shapeHints(shape, ids, at = null, base = new Map()) {
  const hints = new Map(base);
  const pts = ids.map(id => shape.get(id)).filter(Boolean);
  if (!pts.length) return hints;
  const cx = (Math.min(...pts.map(p => p.x)) + Math.max(...pts.map(p => p.x))) / 2;
  const cy = (Math.min(...pts.map(p => p.y)) + Math.max(...pts.map(p => p.y))) / 2;
  for (const id of ids) {
    const p = shape.get(id);
    if (p) hints.set(`e${id}`, { x: Math.round(p.x - cx + (at?.x ?? 0)), y: Math.round(p.y - cy + (at?.y ?? 0)) });
  }
  return hints;
}

/** Hints for notes (ref -> {x, y} in the view) in the frame shapeHints() put the elements `ids` in. */
export function noteHints(shape, ids, positions, hints) {
  const pts = ids.map(id => shape.get(id)).filter(Boolean);
  if (!pts.length || !positions?.size) return hints;
  const cx = (Math.min(...pts.map(p => p.x)) + Math.max(...pts.map(p => p.x))) / 2;
  const cy = (Math.min(...pts.map(p => p.y)) + Math.max(...pts.map(p => p.y))) / 2;
  const out = new Map(hints);
  for (const [ref, p] of positions) out.set(`n${ref}`, { x: Math.round(p.x - cx), y: Math.round(p.y - cy) });
  return out;
}

export async function growDiagram(add, { fromId = null, seeds, at = null, shape = null, exact = false }) {
  const g = state.gen, def = state.diagramDef, s = state.store;
  const visible = shownIds();
  const base = def.kind === 'explore' ? def.ids : [...visible]; // keeps elements a filter hides for now
  const next = [...new Set([...base, ...add])];
  // the grown diagram: its relationships say on which side of `fromId` the new elements go, its nesting
  // whether they become containers of shown ones or go into shown containers. It is the question
  // renderDef() asks next, so that one gets the kept answer.
  const grown = await graph.subgraph(s, { elementIds: next }, { ...explorerOpts(), exclude: hiddenRelsOf(def) });
  if (state.gen !== g) return;
  const parentOf = grown.nesting?.parentOf ?? null;
  // keep the arrangement, unless the diagram more than doubles: then a fresh automatic layout reads better
  let hints = null, pins = null;
  if (shape) {
    // a view: its arrangement, centred on the drop point (whatever its size), or without
    // one (menu, details) right of the diagram
    let centre = at;
    if (!centre && visible.size) {
      const all = [...positionsOf(g.shown.nodes).keys()].map(k => findNode(g.shown.nodes, k)).filter(Boolean);
      const pts = [...add].map(id => shape.get(id)).filter(Boolean);
      const w = Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x));
      const h = Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y));
      centre = { x: Math.max(...all.map(n => n.x + n.w)) + 100 + w / 2, y: Math.min(...all.map(n => n.y)) + h / 2 };
    }
    hints = shapeHints(shape, [...add], centre, visible.size ? positionsOf(g.shown.nodes) : new Map());
  } else if (at && visible.size && add.size < visible.size) {
    // dropped at a point (drag & drop): there, side by side; the interactive layout keeps the
    // row (and order within it) the drop position implies. Many elements (a folder) wrap
    // into rows of ~√n below the drop point, like the automatic layout's bounded layers.
    hints = positionsOf(g.shown.nodes);
    const items = [...add].map(x => [x, nodeSize(s.element(x))]);
    const perRow = Math.max(4, Math.ceil(Math.sqrt(items.length) * 1.1));
    let y = at.y;
    for (let i = 0; i < items.length; i += perRow) {
      const row = items.slice(i, i + perRow);
      let x = at.x - row.reduce((sum, [, z]) => sum + z.w + 30, -30) / 2;
      const rowH = Math.max(...row.map(([, z]) => z.h));
      for (const [id, z] of row) { hints.set(`e${id}`, { x: Math.round(x), y: Math.round(y - rowH / 2) }); x += z.w + 30; }
      y += rowH + 60;
    }
    // 2.27.0: an element made with the palette stays where it was dropped (pinned, as if moved there);
    // the layout would otherwise fit it in near that point
    if (exact) pins = new Map([...g.manual.pins, ...[...add].map(x => [`e${x}`, hints.get(`e${x}`)])]);
  } else if (add.size < visible.size) {
    const positions = positionsOf(g.shown.nodes);
    let from = fromId != null ? findNode(g.shown.nodes, `e${fromId}`) : null;
    if (!from) {
      // unrelated to anything shown: a virtual anchor right of the diagram, so the new elements start a column there
      const all = [...positions.keys()].map(k => findNode(g.shown.nodes, k)).filter(Boolean);
      const right = Math.max(...all.map(n => n.x + n.w)), top = Math.min(...all.map(n => n.y));
      from = { x: right + 80, y: top - 145, w: 120, h: 55 };
    }
    hints = hintsForExpansion({
      store: s, relationships: grown.relationships, positions, fromId, from, newIds: [...add], direction: settings.plantumlDirection, parentOf,
    });
  }
  pushExploreBack();
  renderDef({ kind: 'explore', seeds, ids: next, hiddenRels: hiddenRelsOf(def), notes: notesOf(def) }, { hints, pins, fresh: add, explorerStep: true });
}

/** Relationships hidden in the current explorer diagram (CM-9); kept through its steps. */
export function hiddenRelsOf(def) {
  return def?.kind === 'explore' && def.hiddenRels?.length ? [...def.hiddenRels] : [];
}

/**
 * "Add to diagram": put an element into the current generated diagram, next
 * to a related element already shown. With a stored view or no diagram, a new
 * (explorer) diagram starts with it.
 */
export async function addToDiagram(idOrIds, { at = null, label = null, shape = null, notes = null, exact = false } = {}) {
  const s = state.store, def = state.diagramDef;
  await s.ensure({ elements: [idOrIds].flat() }); // UP-3: from a folder, a view or the basket only their ids may be known
  const ids = [...new Set([idOrIds].flat())].filter(x => s.element(x));
  if (!ids.length) { if (label) status(t('Nothing to add from {source}.', { source: label })); return; }
  const name = ids.length === 1 ? s.element(ids[0])?.name || `#${ids[0]}`
    : label ? t('{n} elements of {source}', { n: ids.length, source: label }) : t('{n} elements', { n: ids.length });
  const newTab = newTabRequested(); // "in a new diagram": not added to this one (2.16.0)
  const generated = def && def.kind !== 'view' && state.gen && !newTab;
  const total = (generated ? shownIds().size : 0) + ids.length;
  if (total > 400 && !RENDER_MODE && !confirm(t('The diagram would have {n} elements and may be slow or unreadable. Continue?', { n: total }))) return;
  if (!generated) {
    if (def && !newTab) pushExploreBack();
    // many elements (a folder, the basket): no start elements, so the title doesn't list them;
    // a view's arrangement becomes the layout hint
    // an editable copy of a view brings the view's notes (CM-14), placed as there
    const withNotes = notes?.refs?.length ? { view: notes.view, refs: notes.refs } : null;
    let hints = shape ? shapeHints(shape, ids) : null;
    if (hints && withNotes) hints = noteHints(shape, ids, notes.positions, hints);
    renderDef({ kind: 'explore', seeds: ids.length <= 3 ? ids : [], ids, ...(withNotes ? { notes: withNotes } : {}) }, { explorerStep: !!def && !newTab, hints });
    status(t('New diagram with {name}.', { name }));
    return;
  }
  const add = ids.filter(x => !inDiagram(x));
  if (!add.length) { status(ids.length === 1 ? t('{name} is already in the diagram.', { name }) : t('{name} are already in the diagram.', { name })); return; }
  const visible = shownIds();
  // a shown element related to it (any direction, ignoring filters: it was asked for explicitly)
  const near = at || shape ? null
    : [...(await graph.neighbourhood(s, { seeds: add, depth: 1, nesting: false })).ids].find(x => !add.includes(x) && visible.has(x)) ?? null;
  const seeds = explorerSeeds(def, add[0]);
  await growDiagram(new Set(add), { fromId: near, seeds: seeds.length || add.length > 3 ? seeds : add, at, shape, exact });
  const one = s.element(add[0])?.name || `#${add[0]}`;
  const added = add.length === 1
    ? (label ? t('{name} (from {source})', { name: one, source: label }) : one)
    : (label ? t('{n} elements of {source}', { n: add.length, source: label }) : t('{n} elements', { n: add.length }));
  const already = ids.length - add.length;
  const vars = { what: added, other: near != null ? s.element(near)?.name || '#' + near : '', n: already };
  status(at || shape
    ? (already ? t('Added {what} ({n} already shown).', vars) : t('Added {what}.', vars))
    : near != null
      ? (already ? t('Added {what} next to {other} ({n} already shown).', vars) : t('Added {what} next to {other}.', vars))
      : (already ? t('Added {what} (not related to anything shown) ({n} already shown).', vars) : t('Added {what} (not related to anything shown).', vars)));
  const hidden = add.filter(x => !(state.filter.elementOk(s.element(x)) && state.props.elementOk(s.element(x)))).length;
  if (hidden) {
    status(`${status.last} ${hidden === 1 && add.length === 1 ? t('The diagram filter hides it.') : t('The diagram filter hides {n}.', { n: hidden })}`, true);
  }
}

// ---------------------------------------------------------------- drag & drop from the tree

/**
 * Drag payload of a tree row: elements, relationships (= their element ends),
 * folders (all elements in them, sub-folders included) and element type groups.
 */
export function treeDragData(spec) {
  const d = spec.data, s = state.store;
  if (d?.kind === 'element' && s?.element(d.id)) return `element:${d.id}`;
  if (d?.kind === 'relationship' && s?.relationship(d.id)) return `relationship:${d.id}`;
  if (d?.kind === 'folder' && d.id != null && s?.folderCounts(d.id).elements) return `folder:${d.id}`;
  if (d?.kind === 'type' && s?.stats.elements.byType[d.type]) return `type:${d.type}`;
  if (d?.kind === 'view' && s?.view(d.id)) return `view:${d.id}`;
  if (d?.kind === 'layer' && s) return `layer:${d.key}`;
  if (d?.kind === 'reltype' && s) return `reltype:${d.type}`;
  return null;
}

/**
 * Elements of a stored view with their positions there: a Map element id ->
 * { x, y }, from the API (HLP-7). An element shown more than once has the
 * position of the first node that shows it.
 */
export function viewElementPositions(viewId) {
  return state.store.viewElementPositions(viewId);
}

/** Element id -> {x, y} for the element nodes in `nodes` and their descendants (`parent`: their container's box). */
export function nodeElementPositions(nodes, parent = null) {
  const shape = new Map();
  const walk = (list, parent) => {
    for (const n of [...list].sort((a, b) => a.sortOrder - b.sortOrder)) {
      let { x, y } = n;
      if (parent && !(x >= parent.x && y >= parent.y && x + n.w <= parent.x + parent.w + 1 && y + n.h <= parent.y + parent.h + 1)) { x += parent.x; y += parent.y; }
      if (n.elementRefId != null && state.store.element(n.elementRefId) && !shape.has(n.elementRefId)) shape.set(n.elementRefId, { x, y });
      walk(n.children || [], { x, y, w: n.w, h: n.h });
    }
  };
  walk(nodes, parent);
  return shape;
}

/** Make an element (basket chip) or the whole basket draggable into the diagram. */
export function makeDraggable(el, payload) {
  el.draggable = true;
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData(DRAG_TYPE, typeof payload === 'function' ? payload() : payload);
    e.dataTransfer.setData('text/plain', el.textContent);
    e.dataTransfer.effectAllowed = 'copy';
  });
  return el;
}

/**
 * What a drag payload adds: element ids, a name for the status bar and, for
 * a view, the elements' arrangement there (`shape`).
 */
export async function dragSource(payload) {
  const [kind, ...rest] = String(payload).split(':');
  const arg = rest.join(':');
  const s = state.store;
  if (kind === 'view') {
    const shape = await viewElementPositions(Number(arg));
    return { ids: [...shape.keys()], label: t('view “{name}”', { name: s.view(Number(arg))?.name || '#' + arg }), shape };
  }
  if (kind === 'folder') {
    const path = s.folderPath(Number(arg)).map(f => f.label).filter(Boolean).join(' › ');
    return { ids: await s.folderElementIds(Number(arg), true), label: t('folder {path}', { path: path || '#' + arg }) };
  }
  if (kind === 'type') return { ids: (await s.elementsOfType(arg)).map(e => e.id), label: t('all {type} elements', { type: prettyType(arg) }) };
  if (kind === 'basket') return { ids: [...state.basket], label: t('the basket') };
  const ids = () => arg.split('.').map(Number).filter(Number.isInteger);
  if (kind === 'found') return { ids: ids(), label: t('search results') };
  if (kind === 'foundrels') {
    await s.ensure({ relationships: ids() });
    return { ids: [...new Set(ids().flatMap(id => dragElementIds(`relationship:${id}`)))], label: t('ends of the found relationships') };
  }
  if (kind === 'foundviews') {
    status(t('Loading the view…'));
    const views = ids();
    const shown = await Promise.all(views.map(id => viewElementPositions(id)));
    return { ids: [...new Set(shown.flatMap(m => [...m.keys()]))], label: t('the elements of {n} views', { n: views.length }) };
  }
  if (kind === 'layer') return { ids: await layerElementIds(arg), label: t('the {layer} layer', { layer: LAYERS.find(l => l.key === arg)?.label || arg }) };
  if (kind === 'reltype') return { ids: await relTypeEndIds(arg), label: arg === '@rel' ? t('relationships on relationships') : t('all {type} relationships', { type: arg }) };
  if (kind === 'relationship') await s.ensure({ relationships: [Number(arg)] });
  return { ids: dragElementIds(payload), label: null };
}

/** Element ids of an element / relationship drag payload (a relationship and its ends must be cached). */
export function dragElementIds(payload) {
  const [kind, id] = String(payload).split(':');
  const s = state.store;
  if (kind === 'element') return [Number(id)];
  if (kind === 'relationship') {
    // the elements at both ends (through relationships on relationships, BR-6)
    const out = [], seen = new Set();
    const ends = (eid, rid) => {
      if (eid != null) out.push(eid);
      else if (rid != null && !seen.has(rid)) { seen.add(rid); const r = s.relationship(rid); if (r) { ends(r.sourceElementId, r.sourceRelationshipId); ends(r.targetElementId, r.targetRelationshipId); } }
    };
    const r = s.relationship(Number(id));
    if (r) { ends(r.sourceElementId, r.sourceRelationshipId); ends(r.targetElementId, r.targetRelationshipId); }
    return out;
  }
  return [];
}

/** Label/state of the details pane's "Add to diagram" button (given, or the one on the page). */
export function syncAddButton(btn = document.querySelector('#details [data-add-element]')) {
  if (!btn) return btn;
  const has = inDiagram(Number(btn.dataset.addElement));
  const generated = state.diagramDef && state.diagramDef.kind !== 'view';
  btn.disabled = has;
  // the same words as its menu entry (CM-11)
  btn.textContent = has ? '✓ ' + t('In diagram') : generated ? t('Add to diagram') : t('Add to new diagram');
  btn.title = has ? t('This element is in the current diagram')
    : generated ? t('Add this element to the current diagram, next to a related element if one is shown')
    : t('Start a new diagram with this element');
  return btn;
}

/** 2.28.0: is the element drawn in the diagram shown, a generated one or a stored view? */
export function onDiagram(id) {
  const def = state.diagramDef;
  if (!def) return false;
  if (def.kind === 'view') return !!state.doc.viewElementIds?.has(id);
  return shownIds().has(id);
}

/** 2.28.0: the "on diagram" marks of the details' related elements follow the diagram shown. */
export function syncOnDiagram() {
  for (const mark of document.querySelectorAll('#details [data-on-diagram]')) mark.hidden = !onDiagram(Number(mark.dataset.onDiagram));
  const addable = canAddToDiagram();
  for (const add of document.querySelectorAll('#details [data-add-to-diagram]')) add.hidden = !addable || onDiagram(Number(add.dataset.addToDiagram));
}

/** 2.30.0: whether "add to diagram" may be offered: a generated diagram is shown, or none (a stored view is not added to). */
export function canAddToDiagram() {
  return !state.diagramDef || state.diagramDef.kind !== 'view';
}

/**
 * 2.30.0: an element of the diagram shown brought into view and marked (the "on diagram" of the details): the
 * drawing moves so that the element is in the middle when it was off screen, and the element flashes.
 */
export function showOnDiagram(id) {
  if (state.tab !== 'layout') setTab('layout');
  const layout = state.layout;
  const g = layout?.svg.querySelector(`.v-node[data-element="${id}"]`);
  if (!g) { status(t('The element is not drawn in the diagram shown.'), true); return; }
  markElements([id], 'set');
  const svg = layout.svg, ctm = svg.getScreenCTM(), r = g.getBoundingClientRect();
  if (ctm && r.width) {
    const inv = ctm.inverse(), p = svg.createSVGPoint();
    p.x = r.left; p.y = r.top;
    const a = p.matrixTransform(inv);
    p.x = r.right; p.y = r.bottom;
    const b = p.matrixTransform(inv);
    const box = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, v = layout.visible ? layout.visible() : layout.view();
    const inside = box.x >= v.x && box.y >= v.y && box.x + box.w <= v.x + v.w && box.y + box.h <= v.y + v.h;
    if (!inside) {
      const w = Math.max(v.w, box.w * 1.5), hh = Math.max(v.h, box.h * 1.5);
      layout.setView({ x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - hh / 2, w, h: hh });
    }
  }
  g.classList.remove('v-flash');
  void g.getBoundingClientRect(); // restart the animation
  g.classList.add('v-flash');
  setTimeout(() => g.classList.remove('v-flash'), 1600);
}

/** Is the element part of the current generated diagram (also when a filter hides it)? */
export function inDiagram(id) {
  const def = state.diagramDef;
  if (!def || def.kind === 'view') return false;
  return def.kind === 'explore' ? def.ids.includes(id) : shownIds().has(id);
}

/** 2.32.0: the names of relationships drawn or not, in every open diagram at once (no new layout). */
export function setRelLabelsHidden(hidden) {
  saveSettings({ hideRelLabels: !!hidden });
  for (const d of state.docs) d.layout?.svg.toggleAttribute('data-hide-rel-labels', !!hidden);
}

/** "Clear diagram": an empty diagram to add elements to (← Back restores the previous one). */
export function clearDiagram() {
  if (state.diagramDef) pushExploreBack();
  renderDef({ kind: 'explore', seeds: [], ids: [] }, { explorerStep: true });
}

/** Ask, in the page's own dialog; resolves to true for OK. */
export function askConfirm(text, okLabel) {
  return new Promise(resolve => {
    const dialog = $('#confirm-dialog');
    $('#confirm-text').textContent = text;
    $('#btn-confirm-ok').textContent = okLabel;
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    dialog.showModal();
    $('#btn-confirm-ok').focus();
  });
}

/** "Clear diagram" (on the diagram and in its menu): only after a confirmation. */
export async function askClearDiagram() {
  if (await askConfirm(t('Are you sure you want to clear the diagram? ← Back restores it.'), t('Clear diagram'))) clearDiagram();
}

export const canClear = () => !!state.store && !(state.diagramDef?.kind === 'explore' && !state.diagramDef.ids.length);

/**
 * Collapse (CM-13): the element the collapse keeps the way to, in the diagram shown: the
 * selected element, else the first start element of the exploration; null for none.
 */
export function collapseTarget() {
  const shown = shownIds();
  if (state.selection?.kind === 'element' && shown.has(state.selection.id)) return state.selection.id;
  const def = state.diagramDef;
  return (def ? explorerSeeds(def, null) : []).find(id => shown.has(id)) ?? null;
}

/** The elements a collapse of `id` would remove (see collapseAround). */
export function collapsing(id) {
  const g = state.gen, s = state.store;
  if (!g) return new Set();
  // a relationship that ends on another relationship connects to that one's elements
  const ends = (elementId, relationshipId, seen = new Set()) => {
    if (elementId != null) return [elementId];
    const r = s.relationship(relationshipId);
    if (!r || seen.has(r.id)) return [];
    seen.add(r.id);
    return [...ends(r.sourceElementId, r.sourceRelationshipId, seen), ...ends(r.targetElementId, r.targetRelationshipId, seen)];
  };
  const edges = [];
  for (const r of g.args.relationships || []) {
    for (const a of ends(r.sourceElementId, r.sourceRelationshipId)) for (const b of ends(r.targetElementId, r.targetRelationshipId)) edges.push([a, b]);
  }
  return collapseAround({ ids: shownIds(), edges, at: id, toward: collapseTarget() });
}

/** The menu entry for collapsing `id`, or null outside a generated diagram that shows it. */
export function collapseEntry(id) {
  if (!state.gen || !state.diagramDef || state.diagramDef.kind === 'view' || !shownIds().has(id)) return null;
  const target = collapseTarget();
  const away = collapsing(id).size;
  const label = target != null && target !== id
    ? t('Collapse, keeping the way to {name}', { name: state.store.element(target)?.name || `#${target}` })
    : t('Collapse around this element');
  return { label, count: away, disabled: !away, action: () => collapseElement(id),
    title: t('Fold away the related elements of this element and what hangs off them; ← Back brings them back') };
}

/** Collapse (CM-13): fold away what hangs off `id`, except the way to the selected element. */
export function collapseElement(id) {
  const g = state.gen, def = state.diagramDef;
  if (!g || !def || def.kind === 'view') return;
  const drop = collapsing(id);
  const name = state.store.element(id)?.name || `#${id}`;
  if (!drop.size) { status(t('{name}: nothing to collapse.', { name })); return; }
  const base = (def.kind === 'explore' ? def.ids : [...shownIds()]).filter(x => !drop.has(x));
  const hints = positionsOf(g.shown.nodes);
  drop.forEach(x => hints.delete(`e${x}`));
  let seeds = explorerSeeds(def, id).filter(x => !drop.has(x));
  if (!seeds.length) seeds = [collapseTarget() ?? id];
  pushExploreBack();
  drop.forEach(x => state.marked.delete(x));
  renderDef({ kind: 'explore', seeds, ids: base, hiddenRels: hiddenRelsOf(def), notes: notesOf(def) }, { hints, explorerStep: true });
  status(t('Collapsed {name}: {n} element folded away; ← Back brings it back.|Collapsed {name}: {n} elements folded away; ← Back brings them back.', { name, n: drop.size }));
}

/**
 * 2.28.0: collapse around `id` and show one level: what hangs off it folds away (as Collapse, keeping the way
 * to the selected element), then its direct neighbours are shown (Follow direction, current filters). One
 * step: ← Back brings the diagram as it was.
 */
export async function collapseAndShowLevel(id) {
  const g = state.gen, def = state.diagramDef, s = state.store;
  if (!g || !def || def.kind === 'view') return;
  const drop = collapsing(id);
  const base = (def.kind === 'explore' ? def.ids : [...shownIds()]).filter(x => !drop.has(x));
  const add = await graph.hiddenNeighbours(s, id, new Set(base), { ...explorerOpts(), direction: settings.neighbourDirection || 'both' });
  if (state.gen !== g) return; // another diagram was drawn meanwhile
  const ids = [...new Set([...base, ...add])];
  const name = s.element(id)?.name || `#${id}`;
  const gone = [...drop].filter(x => !add.has(x)), shown = [...add].filter(x => !base.includes(x) && !drop.has(x));
  if (!gone.length && !shown.length) { status(t('{name}: the diagram shows one level around it already.', { name })); return; }
  if (ids.length > 400 && !RENDER_MODE && !confirm(t('The diagram would have {n} elements and may be slow or unreadable. Continue?', { n: ids.length }))) return;
  const hints = positionsOf(g.shown.nodes);
  gone.forEach(x => hints.delete(`e${x}`)); // the neighbours folded away and shown again keep their places
  let seeds = explorerSeeds(def, id).filter(x => ids.includes(x));
  if (!seeds.length) seeds = [id];
  pushExploreBack();
  gone.forEach(x => state.marked.delete(x));
  renderDef({ kind: 'explore', seeds, ids, hiddenRels: hiddenRelsOf(def), notes: notesOf(def) }, { hints, fresh: new Set(shown), explorerStep: true });
  status(t('{name}: {gone} element(s) folded away, {shown} shown; ← Back undoes it.', { name, gone: gone.length, shown: shown.length }));
}

/** Remove elements from the diagram (the rest stays where it is). */
export function hideElement(idOrIds) {
  const g = state.gen, def = state.diagramDef;
  if (!g || !def || def.kind === 'view') return;
  const drop = new Set([idOrIds].flat());
  const base = (def.kind === 'explore' ? def.ids : [...shownIds()]).filter(x => !drop.has(x));
  const hints = positionsOf(g.shown.nodes);
  drop.forEach(x => hints.delete(`e${x}`));
  let seeds = explorerSeeds(def, [...drop][0]).filter(x => !drop.has(x));
  if (!seeds.length && base.length) seeds = [base[0]];
  pushExploreBack();
  drop.forEach(x => state.marked.delete(x));
  renderDef({ kind: 'explore', seeds, ids: base, hiddenRels: hiddenRelsOf(def), notes: notesOf(def) }, { hints, explorerStep: true });
}

// ---------------------------------------------------------------- notes of an editable copy (CM-14)
// "Editable copy" of a stored view keeps the view's notes (Label nodes without a view link) and the
// lines between them and its elements. The diagram definition names the view and the notes by their
// XMI identifiers (a link carries them); the lines are taken from the view each time it is drawn,
// so a line goes when either of its ends is hidden.

/** The notes of a definition (an editable copy, or the automatic layout of a view), for its next step; null for none. */
export function notesOf(def) {
  return def?.notes?.refs?.length ? { view: def.notes.view, refs: [...def.notes.refs] } : null;
}

/** The nodes of a stored view, flat, with absolute positions (as nodeElementPositions reads them). */
export function flatViewNodes(nodes) {
  const out = [];
  const walk = (list, parent) => {
    for (const n of list) {
      let { x, y } = n;
      if (parent && !(x >= parent.x && y >= parent.y && x + n.w <= parent.x + parent.w + 1 && y + n.h <= parent.y + parent.h + 1)) { x += parent.x; y += parent.y; }
      out.push({ ...n, x, y });
      walk(n.children || [], { x, y, w: n.w, h: n.h });
    }
  };
  walk(nodes, null);
  return out;
}

export const isNote = n => n.type === 'Label' && n.viewRefId == null && n.xmiIdentifier;

/** The notes of a stored view: { refs, positions: Map ref -> {x, y} }. */
export async function viewNotes(viewId) {
  const { nodes } = await state.store.viewContent(viewId);
  const positions = new Map();
  for (const n of flatViewNodes(nodes)) if (isNote(n)) positions.set(escapeRef(n.xmiIdentifier), { x: n.x, y: n.y });
  return { refs: [...positions.keys()], positions };
}

/** The notes of a definition that are in its view, and the lines among them and the elements `ids`. */
export async function notesForDiagram(notesDef, ids, signal) {
  if (!notesDef?.refs?.length || !state.store.view(notesDef.view)) return { notes: [], lines: [] };
  const { nodes, connections } = await state.store.viewContent(notesDef.view, { signal });
  const wanted = new Set(notesDef.refs);
  const keyOf = new Map(); // view node id -> layout node id
  const notes = [];
  for (const n of flatViewNodes(nodes)) {
    if (n.elementRefId != null && ids.has(n.elementRefId)) keyOf.set(n.id, `e${n.elementRefId}`);
    else if (isNote(n) && wanted.has(escapeRef(n.xmiIdentifier))) {
      const key = `n${escapeRef(n.xmiIdentifier)}`;
      keyOf.set(n.id, key);
      notes.push({ key, w: n.w, h: n.h, label: n.label || '', style: n.style || null });
    }
  }
  const noteKeys = new Set(notes.map(n => n.key));
  const lines = connections
    .filter(c => c.relationshipRefId == null && keyOf.has(c.sourceNodeId) && keyOf.has(c.targetNodeId))
    .map(c => ({ key: `l${escapeRef(c.xmiIdentifier || String(c.id))}`, from: keyOf.get(c.sourceNodeId), to: keyOf.get(c.targetNodeId), style: c.style || null }))
    // a line between two elements without a relationship is not a note's line
    .filter(l => noteKeys.has(l.from) || noteKeys.has(l.to));
  return { notes, lines };
}

/** Automatic layout of a stored view's elements, with its notes (and their lines). */
export async function automaticLayout(viewId) {
  const view = state.store.view(viewId);
  const shape = await viewElementPositions(viewId);
  const { refs } = await viewNotes(viewId).catch(() => ({ refs: [] }));
  renderDef({
    kind: 'elements', ids: [...shape.keys()], label: t('Elements of {name}', { name: view?.name || `#${viewId}` }),
    ...(refs.length ? { notes: { view: viewId, refs } } : {}),
  });
}

/** Editable copy of a stored view: its elements where the view has them, and its notes. */
export async function editableCopy(viewId) {
  const view = state.store.view(viewId);
  const shape = await viewElementPositions(viewId);
  const notes = await viewNotes(viewId).catch(() => ({ refs: [], positions: new Map() }));
  const doc = state.doc;
  const anew = !(doc.diagramDef && doc.diagramDef.kind !== 'view' && doc.gen) || newTabRequested(); // not added to a diagram shown
  await addToDiagram([...shape.keys()], { label: t('view “{name}”', { name: view?.name || `#${viewId}` }), shape, notes: { view: viewId, ...notes } });
  if (anew) state.doc.copyOf = viewId; // BR-25: "Save as view" names it as the view this one copies
}

/** Right-click on a note of an editable copy. */
export function openNoteMenu(node, ev) {
  const text = (node.label || '').trim();
  popupMenu(t('Note'), [
    { label: t('Hide note'), action: () => hideNote(node.noteRef) },
    text ? { label: t('Copy text'), action: () => copyText(text, t('Text')) } : null,
  ], { x: ev.clientX, y: ev.clientY });
}

/** Remove a note (and its lines) from the editable copy; the rest stays where it is. */
export function hideNote(ref) {
  const g = state.gen, def = state.diagramDef;
  if (!g || !def?.notes) return;
  const refs = def.notes.refs.filter(r => r !== ref);
  const hints = positionsOf(g.shown.nodes);
  hints.delete(`n${ref}`);
  pushExploreBack();
  renderDef({ ...def, notes: refs.length ? { view: def.notes.view, refs } : null }, { hints, explorerStep: true });
  status(t('Note hidden; ← Back brings it back.'));
}

/**
 * Hide relationships from the generated diagram, or show them again (CM-9).
 * The diagram becomes an explorer diagram that lists them (`hiddenRels`);
 * the arrangement stays.
 */
export function setHiddenRels(relIds) {
  const g = state.gen, def = state.diagramDef;
  if (!g || !def || def.kind === 'view') return;
  const ids = def.kind === 'explore' ? def.ids : [...shownIds()];
  const seeds = ['explore', 'neighbourhood', 'impact'].includes(def.kind) ? explorerSeeds(def) : [];
  pushExploreBack();
  renderDef({ kind: 'explore', seeds, ids, hiddenRels: [...new Set(relIds)], notes: notesOf(def) }, { hints: positionsOf(g.shown.nodes), explorerStep: true });
}

export function exploreBack(steps = 1) {
  if (!Number.isInteger(steps) || steps < 1) steps = 1; // also when used directly as an event handler
  let prev = null;
  for (let i = 0; i < steps && state.exploreBack.length; i++) prev = state.exploreBack.pop();
  if (prev) renderDef(prev, { explorerStep: true }); // its arrangement was remembered with it
}

/** "← Back" menu (CM-8): the earlier explorer steps, newest first; pick one to jump there. */
export function openBackMenu(at) {
  const steps = state.exploreBack;
  if (!steps.length) return;
  popupMenu(t('Back to'), [...steps].reverse().slice(0, 25).map((def, i) => ({
    label: `${i + 1}. ${describeDef(def)}`, action: () => exploreBack(i + 1),
  })), at);
}

/** A short description of a diagram definition (menus). */
export function describeDef(def) {
  const s = state.store;
  const count = n => t('{n} element|{n} elements', { n });
  switch (def?.kind) {
    case 'explore': {
      if (!def.ids.length) return t('Empty diagram');
      const head = def.seeds.length && def.seeds.length <= 3 ? t('Explorer: {names}', { names: namesOf(def.seeds) }) : t('Diagram');
      const size = def.hiddenRels?.length
        ? t('{elements}, {n} relationship(s) hidden', { elements: count(def.ids.length), n: def.hiddenRels.length })
        : count(def.ids.length);
      return `${head} (${size})`;
    }
    case 'neighbourhood': return def.depth
      ? t('Neighbourhood of {what} (depth {depth})', { what: def.label || namesOf(def.seeds), depth: def.depth })
      : t('Neighbourhood of {what}', { what: def.label || namesOf(def.seeds) });
    case 'elements': return def.label || t('Selection: {names}', { names: namesOf(def.ids) });
    case 'type': return t('All {type} elements', { type: prettyType(def.type) });
    case 'layer': return t('{layer} layer', { layer: LAYERS.find(l => l.key === def.key)?.label || def.key });
    case 'whole': return t('The whole model');
    case 'reltype': return def.type === '@rel' ? t('Relationships on relationships') : t('All {type} relationships', { type: def.type });
    case 'folder': return t('Folder: {path}', { path: s.folderPath(def.id).map(f => f.label || '…').join(' › ') || '#' + def.id });
    case 'impact': return `${DIRECTIONS[def.dir]?.short || t('Impact of')} ${namesOf(impactStarts(def))}`;
    case 'paths': return t('Paths: {from} → {to}', { from: namesOf([def.from]), to: namesOf([def.to]) });
    case 'view': return t('View: {name}', { name: s.view(def.id)?.name || '#' + def.id });
    default: return t('Diagram');
  }
}

/** Clear the diagram pane (model switched or deleted). */
export function resetDiagram() {
  // BR-15: the tabs belong to the model; a new model starts with one empty tab (with the filters of the one shown)
  for (const d of state.docs) {
    d.renderSeq++; // drop any PlantUML render still in flight
    d.layoutSeq++; // … and any auto-layout
    cancelJob(`view:${d.id}`); // … and a diagram still loading (EN-2)
    d.minimap?.destroy();
    d.panel?.remove();
  }
  const doc = newDoc(state.doc);
  state.docs = [doc];
  state.doc = doc;
  $('#tab-layout').replaceChildren();
  docPanel(doc).replaceChildren(h('div', { class: 'placeholder' }, startHint()));
  showDocHead(doc);
  renderDocTabs({ save: false }); // the tabs of before a reload are restored once the model is open (restoreTabs)
}

export async function showView(viewId, trail = [], doc = null) {
  const s = state.store;
  const v = s.view(viewId);
  if (!v) { status(t('View #{id} not found.', { id: viewId }), true); return; }
  if (v.recipe != null) { await openRecipe(viewId); return; } // 2.30.0: a recipe draws its generated diagram
  doc ??= consumeNewTab() ? openDoc() ?? state.doc : state.doc; // BR-15: Ctrl- or middle-click opened it in a new tab
  const signal = startJob(`view:${doc.id}`); // EN-2: a diagram of this tab still loading is cancelled
  status(t('Loading view "{name}"…', { name: v.name }));
  try {
    const { nodes, connections } = await s.viewContent(viewId, { signal });
    const shownElements = new Set(); // 2.28.0: for the details' "on diagram"
    const walk = list => list.forEach(n => { if (n.elementRefId != null) shownElements.add(n.elementRefId); walk(n.children || []); });
    walk(nodes);
    doc.viewElementIds = shownElements;
    if (signal.aborted) return;
    const deco = doc.props.decorate(viewElements(nodes));
    const faded = fadedInView(nodes, connections, doc);
    const ctx = {
      view: v, nodes, connections, elementById: id => s.element(id), relationshipById: id => s.relationship(id), deco,
      onOpenView: id => drillToView(id), viewName: id => s.view(id)?.name ?? (isPartialCopy() ? t('a view not in this offline copy') : undefined),
    };
    doc.diagramDef = { kind: 'view', id: viewId, trail: trail.filter(id => id !== viewId && s.view(id)) };
    doc.editing = null; // BR-25
    doc.copyOf = null;
    doc.recipeOf = null; // 2.30.0
    const shown = doc === state.doc;
    if (shown) renderTrail(doc.diagramDef);
    setDiagram({ title: (isCreated(v) ? '✎ ' : '') + t('View: {name}', { name: v.name }), ...diagramFromView(ctx), view: v }, doc);
    let nodeCount = 0;
    const count = list => list.forEach(n => { nodeCount++; count(n.children || []); });
    count(nodes);
    setDiagramInfo(t('{n} nodes · {m} connections', { n: nodeCount, m: connections.length })
      + (faded ? ' · ' + t('faded by the filters: {n} element(s), {m} relationship(s)', { n: faded.elements.size, m: faded.relationships.size }) : '')
      + decoInfo(deco), doc);
    if (shown) writeHash();
    doc.layoutSeq++; // a stored view replaces any auto-layout still running
    doc.gen = null;
    if (shown) renderLayoutPanel();
    mountLayout(renderViewSvg({ ...ctx, faded, onSelect: plainSelect, onMark: markElements, onNodeMenu: (id, ev, node) => openViewNodeMenu(id, ev, node), onOtherNodeMenu: (node, ev) => openViewOtherNodeMenu(node, ev),
      onConnMenu: (id, ev) => openConnMenu(id, ev), onBackgroundMenu: ev => openCanvasMenu(ev) }), deco, { doc });
    status('');
  } catch (e) {
    if (isAbort(e) || signal.aborted) return;
    status(errorMessage(e), true);
    showDiagramError(e, t('View: {name}', { name: v.name }), () => showView(viewId, trail, doc), doc);
    // keep the view as the current diagram, so the URL (and a reload) still points to it
    doc.diagramDef = { kind: 'view', id: viewId, trail: trail.filter(id => id !== viewId && s.view(id)) };
    if (doc === state.doc) {
      renderTrail(doc.diagramDef);
      writeHash();
    }
  }
}

/** The diagram pane when its content could not be loaded (EN-2): title, error and Retry. */
export function showDiagramError(e, title, retry, doc = state.doc) {
  if (RENDER_MODE) document.dispatchEvent(new CustomEvent('archi-render-error', { detail: errorMessage(e) })); // RN-1
  doc.renderSeq++;
  doc.layoutSeq++;
  doc.diagram = null;
  doc.layout = null;
  doc.gen = null;
  doc.minimap?.destroy();
  doc.minimap = null;
  doc.info = '';
  docPanel(doc).replaceChildren(errorBox(e, retry));
  renderDocTabs();
  if (doc !== state.doc) return;
  $('#diagram-title').textContent = title;
  $('#diagram-title').title = title;
  $('#source').value = '';
  setDiagramInfo('', doc);
  $('#tab-plantuml').replaceChildren(h('div', { class: 'placeholder' }, errorMessage(e)));
  updateToolbar();
}
