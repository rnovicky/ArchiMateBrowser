// ArchiMate Browser: the reports of API 3.6.0 (ALT-4): the quality report (HLP-10), the
// relationship matrix (HLP-11) and the landscape map (HLP-12). Each opens in #report-dialog;
// what it lists leads back into the model: a click selects, "Diagram" draws.

import { api } from '../api.js';
import { t } from '../i18n.js';
import { CSV_DELIMITER, csvFile } from '../csv.js';
import { LAYERS, RELATIONSHIP_TYPES, elementColor, prettyType } from '../archimate.js';
import { colourScale } from '../properties.js';
import { shownIds, showView } from './diagram.js';
import { showElements } from './panels.js';
import { select } from './routing.js';
import { $, state } from './state.js';
import { download, errorMessage, h, safeName } from './ui.js';

const REPORTS_NEED = '3.6.0';

// ---------------------------------------------------------------- the dialog

function openDialog(title) {
  const dlg = $('#report-dialog');
  $('#report-title').textContent = title;
  const body = $('#report-body');
  body.replaceChildren();
  if (!dlg.open) dlg.showModal();
  return body;
}

function closeDialog() {
  const dlg = $('#report-dialog');
  if (dlg.open) dlg.close();
}

function failed(container, e) {
  const text = e?.status === 404 || e?.status === 405
    ? t('This report needs ArchiMate API {version} or newer.', { version: REPORTS_NEED })
    : errorMessage(e);
  container.replaceChildren(h('p', { class: 'report-error', role: 'alert' }, text));
}

const elementName = id => state.store.element(id)?.name || `#${id}`;

/** A button that selects an element (or relationship, view) and closes the dialog. */
function itemButton(label, kind, id, extra = {}) {
  return h('button', {
    type: 'button', class: 'linklike', ...extra,
    onclick: () => { closeDialog(); kind === 'view' ? showView(id) : select(kind, id); },
  }, label);
}

function diagramButton(ids, label) {
  return h('button', {
    type: 'button', class: 'report-diagram', title: t('Draw these elements as a diagram'),
    onclick: () => { closeDialog(); showElements(ids, label); },
  }, t('Diagram'));
}

// ---------------------------------------------------------------- element sets

/** The options of an element set chooser: basket, diagram, layers, the types the model has. */
function setChooser(name, preferred) {
  const sel = h('select', { name });
  const shown = [...shownIds()]; // the elements of a generated diagram
  if (state.basket.size) sel.append(h('option', { value: 'basket' }, t('Basket ({n} elements)', { n: state.basket.size })));
  if (shown.length) sel.append(h('option', { value: 'diagram' }, t('Elements of the diagram ({n})', { n: shown.length })));
  const layers = h('optgroup', { label: t('Layers') });
  for (const l of LAYERS) layers.append(h('option', { value: `layer:${l.api}` }, l.label));
  const byType = state.store.stats?.elements?.byType || {};
  const types = h('optgroup', { label: t('Element types') });
  for (const type of Object.keys(byType).sort((a, b) => prettyType(a).localeCompare(prettyType(b)))) {
    if (!type.endsWith('Junction')) types.append(h('option', { value: `type:${type}` }, `${prettyType(type)} (${byType[type]})`));
  }
  sel.append(layers, types);
  if (preferred && [...sel.options].some(o => o.value === preferred)) sel.value = preferred;
  return sel;
}

/** The API's element set for a chooser value. */
function setOf(value) {
  if (value === 'basket') return { elementIds: [...state.basket] };
  if (value === 'diagram') return { elementIds: [...shownIds()] };
  const [kind, key] = value.split(':');
  return kind === 'layer' ? { layer: key } : { elementType: key };
}

function relationshipTypeSelect(name, value = '') {
  const sel = h('select', { name }, h('option', { value: '' }, t('any relationship')));
  for (const type of RELATIONSHIP_TYPES) sel.append(h('option', { value: type }, prettyType(type)));
  sel.value = value;
  return sel;
}

function directionSelect(name, value = 'any') {
  const sel = h('select', { name },
    h('option', { value: 'out' }, t('outgoing (→)')),
    h('option', { value: 'in' }, t('incoming (←)')),
    h('option', { value: 'any' }, t('either way')));
  sel.value = value;
  return sel;
}

// ---------------------------------------------------------------- HLP-10: quality report

const CHECKS = {
  elementsInNoView: () => t('Elements in no view'),
  elementsWithoutRelationships: () => t('Elements without relationships'),
  unfiledElements: () => t('Elements in no folder'),
  unfiledRelationships: () => t('Relationships in no folder'),
  unfiledViews: () => t('Views in no folder'),
  duplicateNames: () => t('Elements of one type with the same name'),
  emptyViews: () => t('Views without nodes'),
  emptyLabels: () => t('Empty labels (drill-down links whose view was deleted)'),
  relationshipsNotAllowed: () => t('Relationships ArchiMate does not allow between their ends'), // API 3.7.0
};

export async function openQualityReport() {
  const body = openDialog(t('Quality report: {model}', { model: state.store.model.name }));
  body.append(h('p', { class: 'placeholder' }, t('Loading…')));
  let report;
  try {
    report = await api.reports.quality(state.store.id, { limit: 200 });
    // the ends of the relationships listed, by name (UP-3); a relationship not allowed with its ends, which may be relationships
    const rels = report.checks.unfiledRelationships?.items || [];
    await state.store.ensure({
      elements: rels.flatMap(r => [r.sourceElementId, r.targetElementId]),
      relationships: (report.checks.relationshipsNotAllowed?.items || []).map(r => r.id),
    });
  } catch (e) {
    failed(body, e);
    return;
  }
  body.replaceChildren(h('p', { class: 'report-intro' },
    t('What is probably unfinished or wrong. A finding is not an error by itself: an element in no view can be on purpose.')));
  for (const [check, group] of Object.entries(report.checks)) {
    const section = h('details', { class: 'report-check', open: group.total > 0 && group.total <= 30 },
      h('summary', {}, h('span', {}, CHECKS[check]?.() || check), h('span', { class: group.total ? 'count warn' : 'count' }, group.total)));
    const list = h('ul', { class: 'report-list' });
    if (check === 'duplicateNames') {
      for (const g of group.items) {
        list.append(h('li', {}, `${g.name} (${prettyType(g.type)}) ×${g.elements.length} `,
          diagramButton(g.elements.map(e => e.id), g.name),
          ...g.elements.map(e => itemButton(`#${e.id}`, 'element', e.id))));
      }
    } else if (check === 'emptyLabels') {
      for (const x of group.items) list.append(h('li', {}, itemButton(x.view.name || `#${x.view.id}`, 'view', x.view.id), ` (${t('node {id}', { id: x.nodeId })})`));
    } else if (check === 'unfiledViews' || check === 'emptyViews') {
      for (const v of group.items) list.append(h('li', {}, itemButton(v.name || `#${v.id}`, 'view', v.id)));
    } else if (check === 'unfiledRelationships') {
      for (const r of group.items) {
        const label = `${prettyType(r.type)}${r.name ? ` “${r.name}”` : ''}: ${elementName(r.sourceElementId)} → ${elementName(r.targetElementId)}`;
        list.append(h('li', {}, itemButton(label, 'relationship', r.id)));
      }
    } else if (check === 'relationshipsNotAllowed') {
      for (const r of group.items) {
        const rel = state.store.relationship(r.id) || r;
        const label = `${prettyType(r.type)}${r.name ? ` “${r.name}”` : ''}: ${state.store.relationshipLabel(rel)}`;
        list.append(h('li', {}, itemButton(label, 'relationship', r.id),
          h('small', {}, ` ${t('{source} → {target}', { source: concept(r.sourceType), target: concept(r.targetType) })}`)));
      }
    } else {
      for (const e of group.items) {
        list.append(h('li', {}, h('span', { class: 'swatch', style: `background:${elementColor(e.type)}` }),
          itemButton(e.name || `(${prettyType(e.type)})`, 'element', e.id), h('small', {}, ` ${prettyType(e.type)}`)));
      }
      if (group.items.length) list.prepend(h('li', { class: 'report-actions' }, diagramButton(group.items.map(e => e.id), CHECKS[check]())));
    }
    if (group.total > group.items.length) list.append(h('li', { class: 'more' }, t('… and {n} more', { n: group.total - group.items.length })));
    if (group.total) section.append(list);
    body.append(section);
  }
}

/** A concept of the API's table of allowed relationships: an element type, or `Relationship`. */
const concept = type => (type === 'Relationship' ? t('relationship') : prettyType(type));

// ---------------------------------------------------------------- HLP-11: relationship matrix

export function openMatrix() {
  const body = openDialog(t('Relationship matrix: {model}', { model: state.store.model.name }));
  const form = h('form', { class: 'report-form' });
  const rows = setChooser('rows', 'type:ApplicationComponent');
  const columns = setChooser('columns', 'type:BusinessProcess');
  const mode = h('select', { name: 'mode' },
    h('option', { value: 'direct' }, t('directly')),
    h('option', { value: 'path' }, t('along a path')));
  const direct = h('span', { class: 'report-inline' }, relationshipTypeSelect('type', 'Serving'), directionSelect('direction', 'out'));
  const steps = [0, 1, 2].map(i => h('span', { class: 'report-step', 'data-step': i },
    `${i + 1}. `, relationshipTypeSelect(`step${i}`, ['Realization', 'Serving', ''][i]), directionSelect(`dir${i}`, 'out')));
  const stepCount = h('select', { name: 'steps' }, h('option', { value: '2' }, t('2 steps')), h('option', { value: '3' }, t('3 steps')));
  const path = h('span', { class: 'report-inline', hidden: true }, stepCount, ...steps);
  const sync = () => {
    direct.hidden = mode.value !== 'direct';
    path.hidden = mode.value !== 'path';
    steps[2].hidden = stepCount.value !== '3';
  };
  mode.addEventListener('change', sync);
  stepCount.addEventListener('change', sync);
  const out = h('div', { class: 'report-result' });
  const csv = h('button', { type: 'button', disabled: true }, t('Download as CSV'));
  form.append(
    h('label', {}, t('Rows'), rows), h('label', {}, t('Columns'), columns),
    h('div', { class: 'report-via' }, h('span', {}, t('Connected')), mode, direct, path),
    h('div', { class: 'report-buttons' }, h('button', { type: 'submit', class: 'primary' }, t('Show')), csv));
  sync();

  const request = () => {
    const via = mode.value === 'direct'
      ? { direction: form.direction.value, ...(form.type.value ? { types: [form.type.value] } : {}) }
      : { path: steps.slice(0, Number(stepCount.value)).map((_s, i) => ({
          direction: form[`dir${i}`].value, ...(form[`step${i}`].value ? { types: [form[`step${i}`].value] } : {}),
        })) };
    return { rows: setOf(rows.value), columns: setOf(columns.value), via };
  };
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    out.replaceChildren(h('p', { class: 'placeholder' }, t('Loading…')));
    try {
      const m = await api.reports.matrix(state.store.id, request());
      renderMatrix(out, m);
      csv.disabled = !m.cells.length;
    } catch (e) {
      failed(out, e);
    }
  });
  csv.addEventListener('click', async () => {
    try {
      const text = await api.reports.matrixCsv(state.store.id, { ...request(), csvDelimiter: CSV_DELIMITER });
      download(safeName(`matrix ${state.store.model.name}`) + '.csv', csvFile(String(text).replace(/^﻿/, '')), 'text/csv');
    } catch (e) {
      failed(out, e);
    }
  });
  body.append(form, out);
}

function pathText(rowId, p) {
  const parts = [elementName(rowId)];
  let previous = rowId;
  for (const rid of p.relationshipIds) {
    const r = state.store.relationship(rid);
    const forward = r?.sourceElementId === previous;
    const other = forward ? r?.targetElementId : r?.sourceElementId;
    parts.push(forward ? ` —${prettyType(r?.type)}→ ` : ` ←${prettyType(r?.type)}— `, other != null ? elementName(other) : '…');
    previous = other;
  }
  return parts.join('');
}

function renderMatrix(out, m) {
  if (!m.cells.length) {
    out.replaceChildren(h('p', { class: 'placeholder' }, t('No element of the rows is connected to an element of the columns.')));
    return;
  }
  const cells = new Map(m.cells.map(c => [`${c.row}:${c.column}`, c]));
  const detail = h('div', { class: 'report-cell-detail' });
  const table = h('table', { class: 'report-matrix' });
  table.append(h('thead', {}, h('tr', {}, h('th', {}),
    ...m.columns.map(c => h('th', { title: `${c.name} (${prettyType(c.type)})` }, h('span', {}, c.name || `#${c.id}`))))));
  const tbody = h('tbody');
  for (const r of m.rows) {
    const tr = h('tr', {}, h('th', { title: prettyType(r.type) }, itemButton(r.name || `#${r.id}`, 'element', r.id)));
    for (const c of m.columns) {
      const cell = cells.get(`${r.id}:${c.id}`);
      tr.append(h('td', {}, cell ? h('button', {
        type: 'button', class: 'report-count', title: t('{row} → {column}: {n} paths', { row: r.name, column: c.name, n: cell.count }),
        onclick: async () => {
          const ids = new Set([r.id, c.id]);
          for (const p of cell.paths || []) p.intermediateIds.forEach(i => ids.add(i));
          // the paths are named by their elements and relationships (UP-3)
          try {
            await state.store.ensure({ elements: [...ids], relationships: (cell.paths || []).flatMap(p => p.relationshipIds) });
          } catch (e) {
            detail.replaceChildren(h('p', { class: 'report-error', role: 'alert' }, errorMessage(e)));
            return;
          }
          detail.replaceChildren(
            h('h3', {}, `${r.name} → ${c.name}`, ' ', diagramButton([...ids], `${r.name} → ${c.name}`)),
            h('ul', { class: 'report-list' }, ...(cell.paths || []).map(p => h('li', {}, pathText(r.id, p)))),
            cell.count > (cell.paths || []).length ? h('p', { class: 'more' }, t('… and {n} more', { n: cell.count - cell.paths.length })) : '');
        },
      }, cell.count) : ''));
    }
    tbody.append(tr);
  }
  table.append(tbody);
  out.replaceChildren(
    h('p', { class: 'report-intro' }, t('{rows} rows, {columns} columns, {cells} connected pairs. Click a number to see its paths.',
      { rows: m.totals.rows, columns: m.totals.columns, cells: m.totals.cells }),
    m.truncated ? ` ${t('The answer was cut at the server\'s limit.')}` : ''),
    h('div', { class: 'report-scroll' }, table), detail);
}

// ---------------------------------------------------------------- HLP-12: landscape map

const NESTING = {
  'comp-agg': [{ type: 'Composition', direction: 'out' }, { type: 'Aggregation', direction: 'out' }],
  'comp-agg-real': [{ type: 'Composition', direction: 'out' }, { type: 'Aggregation', direction: 'out' }, { type: 'Realization', direction: 'in' }],
  'comp-agg-assign': [{ type: 'Composition', direction: 'out' }, { type: 'Aggregation', direction: 'out' }, { type: 'Assignment', direction: 'out' }],
  real: [{ type: 'Realization', direction: 'in' }],
};

export function openLandscape() {
  const body = openDialog(t('Landscape map: {model}', { model: state.store.model.name }));
  const form = h('form', { class: 'report-form' });
  const roots = setChooser('roots', 'type:Capability');
  const nesting = h('select', { name: 'nesting' },
    h('option', { value: 'comp-agg' }, t('Composition and Aggregation')),
    h('option', { value: 'comp-agg-real' }, t('… and the elements that realize them')),
    h('option', { value: 'comp-agg-assign' }, t('… and what is assigned to them')),
    h('option', { value: 'real' }, t('The elements that realize them')));
  const colour = h('select', { name: 'colour' }, h('option', { value: '' }, t('(no colour)')));
  for (const name of [...state.store.propertyIndex.keys()].sort()) colour.append(h('option', { value: name }, name));
  const depth = h('select', { name: 'depth' }, ...[1, 2, 3, 4, 5, 6].map(n => h('option', { value: n }, n)));
  depth.value = '3';
  const out = h('div', { class: 'report-result' });
  form.append(h('label', {}, t('Roots'), roots), h('label', {}, t('Below them'), nesting),
    h('label', {}, t('Colour by'), colour), h('label', {}, t('Levels'), depth),
    h('div', { class: 'report-buttons' }, h('button', { type: 'submit', class: 'primary' }, t('Show'))));
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    out.replaceChildren(h('p', { class: 'placeholder' }, t('Loading…')));
    try {
      const result = await api.reports.hierarchy(state.store.id, {
        roots: setOf(roots.value), nesting: NESTING[nesting.value], maxDepth: Number(depth.value),
        properties: colour.value ? [colour.value] : [],
      });
      renderLandscape(out, result, colour.value);
    } catch (e) {
      failed(out, e);
    }
  });
  body.append(form, out);
}

function renderLandscape(out, result, property) {
  if (!result.roots.length) {
    out.replaceChildren(h('p', { class: 'placeholder' }, t('The set has no elements.')));
    return;
  }
  const values = [];
  const walk = nodes => nodes.forEach(n => { values.push(n.properties?.[property]); walk(n.children); });
  walk(result.roots);
  const scale = property ? colourScale(values) : null;
  const shared = new Set(result.otherParents.map(o => o.id));
  const ids = n => [n.id, ...n.children.flatMap(ids)];
  const box = n => h('div', {
    class: `landscape-box${n.children.length ? ' has-children' : ''}${shared.has(n.id) ? ' shared' : ''}`,
    style: scale ? `background:${scale.colour(n.properties?.[property])}` : `border-left-color:${elementColor(n.type)}`,
    title: [prettyType(n.type), property && `${property}: ${n.properties?.[property] ?? '–'}`,
      shared.has(n.id) && t('Also below another element')].filter(Boolean).join('\n'),
  },
  h('div', { class: 'landscape-head' }, itemButton(n.name || `#${n.id}`, 'element', n.id),
    n.children.length ? diagramButton(ids(n), n.name) : '', n.more ? h('span', { class: 'more', title: t('More levels below') }, '…') : ''),
  n.children.length ? h('div', { class: 'landscape-children' }, ...n.children.map(box)) : '');
  const legend = scale ? h('div', { class: 'legend' }, h('strong', {}, `${property}: `),
    ...scale.legend.map(([c, v]) => h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: `background:${c}` }), v))) : '';
  out.replaceChildren(legend, h('div', { class: 'landscape' }, ...result.roots.map(box)),
    result.truncated ? h('p', { class: 'more' }, t('Not everything is shown: the levels or the server\'s limit cut it.')) : '');
}
