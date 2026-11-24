// ArchiMate Browser: Shared state of the page: the `state` object and `$`.
// Part of js/app.js until 2026-10-24 (EN-6); app.js wires it to the page.
//
// BR-15: several diagrams can be open at once, each in a tab of its own. What
// belongs to one diagram is kept in a *document* (newDoc); `state.docs` holds
// them in tab order and `state.doc` is the active one. The old names
// (state.diagram, state.gen, state.filter …) read and write the active
// document, so code that acts on the diagram shown needs no change. Work that
// waits (a layout, a view loading) keeps the document it started for, so that
// its result lands in its own tab even when another one is shown by then.

import { settings } from '../config.js';
import { LayoutPrefs } from '../layoutprefs.js';
import { DiagramFilter } from '../filters.js';
import { PropertyOptions } from '../properties.js';

export const $ = sel => document.querySelector(sel);

let lastDocId = 0;

/**
 * A diagram document (one tab). `from`: the document whose filters, property options and
 * layout options the new one starts with (each tab has its own, BR-15 phase 3).
 */
export function newDoc(from = null) {
  return {
    id: ++lastDocId,
    diagram: null,    // { title, source, refs?, view?, url? }
    diagramDef: null, // what the diagram shows (see renderDef)
    layout: null,     // result of renderViewSvg
    gen: null,        // generated diagram on the Diagram tab: { args, base, shown, key, manual, undo } (LV-6)
    exploreBack: [],  // explorer (ALT-1): diagram definitions before each expand/hide
    counts: new Map(), // HLP-5: per element of the generated diagram, the related elements not shown: { total, out, in, byType }
    info: '',         // the info line under the title
    highlight: null,  // CM-9: the drawing whose path is highlighted
    minimap: null,    // the overview map of its drawing
    layoutSeq: 0,     // a newer layout of this document drops an older one still running
    renderSeq: 0,     // … and a PlantUML rendering
    panel: null,      // its container in #tab-layout (shell.js)
    pending: null,    // a tab restored after a reload: { def, hash } drawn when it is first shown
    filter: from ? DiagramFilter.decode(from.filter.encode()) : DiagramFilter.decode(settings.filter || ''),
    props: from ? PropertyOptions.decode(from.props.encode()) : PropertyOptions.decode(settings.propertyOptions || ''),
    layoutPrefs: from ? LayoutPrefs.decode(from.layoutPrefs.encode()) : LayoutPrefs.decode(settings.layoutPrefs || ''), // LV-6
  };
}

const first = newDoc();

export const state = {
  store: null,
  models: [], // every model of the API, by id, as listed when the page loaded them
  basket: new Set(),
  docs: [first], // BR-15: the open diagrams, in tab order
  doc: first,    // … and the one shown
  pathFrom: null, // HLP-4: the element chosen with "Paths from here…"
  tab: 'layout', // set from settings.diagramTab at start-up
  selection: null, // { kind, id }
  marked: new Set(), // CM-6: multi-selection (element ids), shared by the tree, search results and diagrams
  apiVersion: null, // the API's version, from /health when the models are loaded
  editMode: false, // BR-11 (2.23.0): ✎ Edit is on in this browser tab (editing.js)
};

// The fields of the active document under their old names.
for (const key of ['diagram', 'diagramDef', 'layout', 'gen', 'exploreBack', 'counts', 'info', 'highlight',
  'filter', 'props', 'layoutPrefs']) {
  Object.defineProperty(state, key, {
    get: () => state.doc[key],
    set: value => { state.doc[key] = value; },
    enumerable: true,
  });
}
