// ArchiMate Browser: The page around the panes: the left pane, Options / Filters / Layout switching, one pane at a time in narrow windows, downloads.
// Part of js/app.js until 2026-10-24 (EN-6); app.js wires it to the page.

import { api, isAbort } from '../api.js';
import { settings, saveSettings } from '../config.js';
import { t } from '../i18n.js';
import { layerOf } from '../archimate.js';
import { unescapeRef } from '../refs.js';
import { flatViewNodes, nodeElementPositions } from './diagram.js';
import { byName, openModel } from './models.js';
import { fadedInView, renderLayoutPanel } from './panels.js';
import { $, state } from './state.js';
import { errorBox, errorMessage, h, startJob, status } from './ui.js';

// ---------------------------------------------------------------- the left pane: basket, search results, model tree

/** Collapse or expand a section of the left pane; remembered in this browser. */
export function setSectionCollapsed(section, collapsed, { remember = true } = {}) {
  section.classList.toggle('collapsed', collapsed);
  const toggle = section.querySelector('.side-toggle');
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.title = collapsed ? t('Expand') : t('Collapse');
  toggle.setAttribute('aria-label', `${collapsed ? t('Expand') : t('Collapse')}: ${section.getAttribute('aria-label')}`);
  if (remember) saveSettings({ sideCollapsed: { ...(settings.sideCollapsed || {}), [section.dataset.section]: collapsed } });
}

// ---------------------------------------------------------------- Options / Filters / Layout: one panel at a time

export const PANELS = { options: ['#btn-options', '#diagram-options'], filters: ['#btn-filters', '#filter-panel'], layout: ['#btn-layout', '#layout-panel'] };

/** Show one of the panels below the toolbar (null: none); its tab is highlighted. */
export function showPanel(name) {
  for (const [key, [button, panel]] of Object.entries(PANELS)) {
    $(panel).hidden = key !== name;
    $(button).setAttribute('aria-selected', String(key === name));
  }
  if (name === 'layout') renderLayoutPanel();
}

// ---------------------------------------------------------------- UX-1: one pane at a time in narrow windows

/** Show one pane (tree, diagram or details); in wide windows all three are shown anyway. */
export function showPane(pane) {
  document.body.dataset.pane = pane;
  for (const b of document.querySelectorAll('#pane-switch [role=tab]')) b.setAttribute('aria-selected', String(b.dataset.pane === pane));
}

/** In a narrow window, bring the pane forward that an action just filled. */
export function autoPane(pane) {
  if (window.matchMedia('(max-width: 900px)').matches) showPane(pane); // as the CSS of .pane-switch
}
export async function switchModel(id) {
  const signal = startJob('model');
  try {
    const model = await api.getModel(id, { signal });
    if (signal.aborted) return;
    location.hash = '';
    openModel(model);
  } catch (e) {
    if (isAbort(e) || signal.aborted) return;
    status(errorMessage(e), true);
    $('#tree').replaceChildren(errorBox(e, () => switchModel(id)));
  }
}

/** Status line after a PNG was made: its size, and whether it was reduced. */
export function pngStatus(png, copied) {
  const vars = { width: png.width, height: png.height, percent: Math.round(png.scale * 100) };
  if (copied) {
    return png.scale < 2
      ? t('Image copied ({width}×{height} px, reduced to {percent} % to stay within browser limits).', vars)
      : t('Image copied ({width}×{height} px).', vars);
  }
  return png.scale < 2
    ? t('PNG downloaded ({width}×{height} px, reduced to {percent} % to stay within browser limits).', vars)
    : t('PNG downloaded ({width}×{height} px).', vars);
}

/** Folder path of every element filed in a folder, from the folder tree: element id -> "A › B". */
export async function elementFolders() {
  const folders = await state.store.elementFolders();
  return new Map([...folders].map(([id, path]) => [id, path.join(' › ')]));
}

/**
 * The properties of an item as one object: name -> value; a property with values in
 * several languages -> { lang: value } ("" for one without); repeated values -> [values].
 */
export function propertiesObject(item) {
  const byName = new Map();
  for (const p of item?.properties || []) {
    if (!byName.has(p.propertyDefinitionName)) byName.set(p.propertyDefinitionName, []);
    byName.get(p.propertyDefinitionName).push(p);
  }
  const out = {};
  for (const [name, vals] of byName) {
    if (vals.length === 1 && !vals[0].lang) out[name] = vals[0].value;
    else if (vals.some(v => v.lang) && new Set(vals.map(v => v.lang || '')).size === vals.length) out[name] = Object.fromEntries(vals.map(v => [v.lang || '', v.value]));
    else out[name] = vals.map(v => v.value);
  }
  return out;
}

/**
 * What the diagram shows: element and relationship ids, notes, groups, links to other
 * views and plain lines, and what the filters fade (stored views). Lines name their ends
 * as { element } / { note } / { group } / { viewLink }.
 */
export async function diagramContent() {
  const s = state.store, def = state.diagramDef, g = state.gen;
  const elements = new Set(), relationships = new Set(), notes = [], groups = [], viewLinks = [], lines = [];
  let faded = null;
  if (def.kind === 'view') {
    const { nodes, connections } = await s.viewContent(def.id);
    const endOf = new Map(); // view node id -> line end
    for (const n of flatViewNodes(nodes)) {
      if (n.elementRefId != null && s.element(n.elementRefId)) {
        elements.add(n.elementRefId);
        endOf.set(n.id, { element: n.elementRefId });
      } else if (n.viewRefId != null) {
        viewLinks.push({ label: n.label || '', viewId: n.viewRefId, viewName: s.view(n.viewRefId)?.name ?? null });
        endOf.set(n.id, { viewLink: n.viewRefId });
      } else if (n.type === 'Container' || (n.children || []).length) {
        groups.push({ label: n.label || '', elements: [...nodeElementPositions(n.children || []).keys()] });
        endOf.set(n.id, { group: n.label || '' });
      } else if (n.type === 'Label') {
        notes.push({ xmiIdentifier: n.xmiIdentifier ?? null, text: n.label || '' });
        endOf.set(n.id, { note: n.xmiIdentifier ?? null });
      }
    }
    for (const c of connections) {
      if (c.relationshipRefId != null) { if (s.relationship(c.relationshipRefId)) relationships.add(c.relationshipRefId); }
      else if (endOf.has(c.sourceNodeId) && endOf.has(c.targetNodeId)) lines.push({ from: endOf.get(c.sourceNodeId), to: endOf.get(c.targetNodeId) });
    }
    faded = fadedInView(nodes, connections);
  } else if (g) {
    for (const e of g.args.elements) elements.add(e.id);
    for (const r of g.args.relationships) relationships.add(r.id);
    const end = key => (key[0] === 'e' ? { element: Number(key.slice(1)) } : { note: unescapeRef(key.slice(1)) });
    for (const n of g.args.notes || []) notes.push({ xmiIdentifier: unescapeRef(n.key.slice(1)), text: n.label || '' });
    for (const l of g.args.lines || []) lines.push({ from: end(l.from), to: end(l.to) });
  }
  await s.ensure({ elements: [...elements], relationships: [...relationships] }); // complete, for the exports
  return { elements: [...elements], relationships: [...relationships], notes, groups, viewLinks, lines, faded };
}

export const elementRow = (e, folders) => ({
  id: e.id, xmiIdentifier: e.xmiIdentifier, type: e.type, layer: layerOf(e.type)?.label ?? null,
  name: e.name ?? null, documentation: e.documentation ?? null, folder: folders.get(e.id) || null,
  properties: propertiesObject(e),
});

/** How many lines of a model's export the dialog lists by name; the rest are counted. */
export const EXPORT_LINES_LISTED = 10;

/**
 * BL-41: lines without ends are valid by the XSD, but Archi refuses to import them.
 * Asks whether to leave them out; resolves to 'omit', 'all' or null (Cancel).
 */
export function askExportOpenLines(check) {
  return new Promise(resolve => {
    const dialog = $('#export-dialog');
    const n = check.openLines.length;
    $('#export-text').textContent = [
      t('The model has {n} line without ends.|The model has {n} lines without ends.', { n }),
      t('The file is valid, but Archi cannot import it.'),
      t('Leaving them out also leaves out the connections that end on them: {n} in all.', { n: check.omitted }),
    ].join(' ');
    const missing = l => (l.missing.length > 1 ? t('no source and no target') : l.missing[0] === 'source' ? t('no source') : t('no target'));
    const rows = check.openLines.slice(0, EXPORT_LINES_LISTED).map(l => h('li', {}, `${l.viewName}: ${l.xmiIdentifier} (${missing(l)})`));
    if (n > EXPORT_LINES_LISTED) rows.push(h('li', {}, t('… and {n} more', { n: n - EXPORT_LINES_LISTED })));
    $('#export-lines').replaceChildren(...rows);
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(['omit', 'all'].includes(dialog.returnValue) ? dialog.returnValue : null), { once: true });
    dialog.showModal();
    $('#btn-export-omit').focus();
  });
}
