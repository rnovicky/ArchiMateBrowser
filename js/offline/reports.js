// Offline copy (2.20.0): the reports of the API. The quality report depends on nothing but the model,
// so the snapshot carries what the API found (API 3.14.0); the relationship matrix and the hierarchy of
// the landscape map are ported from its app/services/reports.py and app/routers/v2/reports.py.

import { HttpError, MAX_GRAPH_ELEMENTS, Reader } from './graph.js';
import { LAYER_TYPES } from './layers.js';
import { casefold } from './model.js';

const QUALITY_CHECKS = ['elementsInNoView', 'elementsWithoutRelationships', 'unfiledElements', 'unfiledRelationships',
  'unfiledViews', 'duplicateNames', 'emptyViews', 'emptyLabels', 'relationshipsNotAllowed'];
const JUNCTION_TYPES = new Set(['AndJunction', 'OrJunction']);
const PATHS_PER_CELL = 20;
const MAX_MATRIX_PATHS = 100000;
const MAX_GRID_CELLS = 250000;

/** Python's comparison of (nested) tuples of numbers and strings. */
function compare(a, b) {
  if (Array.isArray(a)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = compare(a[i], b[i]); if (c) return c; }
    return a.length - b.length;
  }
  if (typeof a === 'boolean') return Number(a) - Number(b);
  return a < b ? -1 : a > b ? 1 : 0;
}
const sortBy = (list, key) => list.sort((x, y) => compare(key(x), key(y)));

/** reports.name_key: by name without regard to case, elements without a name last, then id. */
const nameKey = item => { const name = (item.name || '').trim(); return [!name, casefold(name), item.id]; };

// ---------------------------------------------------------------------------------------- quality (HLP-10)

export function qualityAnswer(m, q) {
  const quality = m.snapshot.quality;
  if (!quality) throw new HttpError(404, 'This offline copy was made without the quality report.');
  const limit = q.has('limit') ? Number(q.get('limit')) : 100, offset = q.has('offset') ? Number(q.get('offset')) : 0;
  const wanted = (q.get('checks') || '').split(',').map(s => s.trim()).filter(Boolean);
  const checks = {};
  for (const check of QUALITY_CHECKS) {
    if (wanted.length && !wanted.includes(check)) continue;
    const found = quality[check] || [];
    checks[check] = { items: found.slice(offset, offset + limit), total: found.length, limit, offset };
  }
  return { modelId: m.id, revision: m.model.revision, checks };
}

// ---------------------------------------------------------------------------------------- element sets

/** reports.resolve_set: the ids of an element set, by id; junctions are never members. */
function resolveSet(m, spec) {
  let test = e => !JUNCTION_TYPES.has(e.type);
  const and = more => { const before = test; test = e => before(e) && more(e); };
  if (spec.elementIds != null) {
    const wanted = [...new Set(spec.elementIds)];
    const missing = wanted.filter(id => !m.elements.has(id));
    if (missing.length) {
      const sorted = missing.sort((a, b) => a - b);
      throw new HttpError(404, `Elements not found in this model: ${sorted.slice(0, 20).join(', ')}${sorted.length > 20 ? ` and ${sorted.length - 20} more` : ''}.`);
    }
    const set = new Set(wanted);
    and(e => set.has(e.id));
  } else if (spec.elementType != null) and(e => e.type === spec.elementType);
  else if (spec.layer != null) { const types = new Set(LAYER_TYPES[spec.layer] || []); and(e => types.has(e.type)); }
  else if (spec.folderId != null) {
    if (!m.orgById.has(spec.folderId)) throw new HttpError(404, 'Organization not found.');
    const below = new Set(m.foldersBelow(spec.folderId));
    const filed = new Set([...m.orgById.values()].filter(o => o.refElementId != null && below.has(m.orgParent.get(o.id))).map(o => o.refElementId));
    and(e => filed.has(e.id));
  } else if (spec.viewId != null) {
    if (!m.viewById.has(spec.viewId)) throw new HttpError(404, 'View not found.');
    const shown = m.viewElements(spec.viewId);
    and(e => shown.has(e.id));
  }
  if (spec.elementTypes != null) { const types = new Set(spec.elementTypes); and(e => types.has(e.type)); }
  if (spec.property != null) {
    const p = spec.property, op = p.op || (p.value == null ? 'exists' : 'eq');
    and(e => m.meets(e, p.name, op, p.value ?? null));
  }
  return m.elementList.filter(test).map(e => e.id);
}

const summary = (m, id) => { const e = m.elements.get(id); return { id: e.id, xmiIdentifier: e.xmiIdentifier, type: e.type, name: e.name }; };

// ---------------------------------------------------------------------------------------- one step

/** reports.hop: the elements one step away, junctions passed within the step, with the relationships followed. */
function hop(reader, start, types, direction) {
  const found = [];
  const stack = [[start, [], new Set([start])]];
  while (stack.length) {
    const [current, via, seen] = stack.pop();
    const reached = [];
    if (direction === 'out' || direction === 'any') {
      for (const r of reader.outgoing(current)) if (types == null || types.has(r.type)) for (const e of reader.ends(r.targetElementId, r.targetRelationshipId)) reached.push([e, r.id]);
    }
    if (direction === 'in' || direction === 'any') {
      for (const r of reader.incoming(current)) if (types == null || types.has(r.type)) for (const e of reader.ends(r.sourceElementId, r.sourceRelationshipId)) reached.push([e, r.id]);
    }
    for (const [element, relId] of reached) {
      if (seen.has(element) || reader.typeOf(element) == null) continue;
      if (reader.isJunction(element)) stack.push([element, [...via, relId], new Set([...seen, element])]);
      else found.push([element, [...via, relId]]);
    }
  }
  const unique = new Map(found.map(f => [JSON.stringify(f), f]));
  return sortBy([...unique.values()], f => f);
}

// ---------------------------------------------------------------------------------------- matrix (HLP-11)

function matrix(reader, rows, columns, steps, intermediateTypes) {
  const columnSet = new Set(columns);
  const cells = new Map(); // "row,column" -> [[rels, middle]]
  let count = 0;
  const last = steps.length - 1;
  let frontier = rows.map(row => [row, row, [], [], new Set([row])]);
  for (let index = 0; index < steps.length; index++) {
    const [types, direction] = steps[index];
    const allowed = index === last || intermediateTypes == null ? null : intermediateTypes[index];
    const next = [];
    for (const [row, element, rels, middle, onPath] of frontier) {
      for (const [other, via] of hop(reader, element, types, direction)) {
        if (onPath.has(other)) continue;
        if (index === last) {
          if (columnSet.has(other)) {
            const key = `${row},${other}`;
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key).push([[...rels, ...via], middle]);
            count += 1;
            if (count >= MAX_MATRIX_PATHS) return [cells, true];
          }
        } else if (allowed == null || allowed.has(reader.typeOf(other))) {
          next.push([row, other, [...rels, ...via], [...middle, other], new Set([...onPath, other])]);
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return [cells, false];
}

const typeSet = values => (values == null ? null : new Set(values));

function csvRows(rows, delimiter) {
  return rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(delimiter)).join('\r\n');
}

export function matrixAnswer(m, body, { csv = false } = {}) {
  const b = { via: {}, includeEmpty: false, details: true, sort: 'name', csvLabels: 'name', csvLayout: 'grid', csvDelimiter: ',', ...body };
  const via = { direction: 'any', ...b.via };
  const reader = new Reader(m);
  let rowIds = resolveSet(m, b.rows), columnIds = resolveSet(m, b.columns);
  let truncated = rowIds.length > MAX_GRAPH_ELEMENTS || columnIds.length > MAX_GRAPH_ELEMENTS;
  rowIds = rowIds.slice(0, MAX_GRAPH_ELEMENTS);
  columnIds = columnIds.slice(0, MAX_GRAPH_ELEMENTS);
  const steps = via.path != null ? via.path.map(s => [typeSet(s.types), s.direction || 'any']) : [[typeSet(via.types), via.direction]];
  const middle = via.intermediateTypes == null ? null : via.intermediateTypes.map(typeSet);
  const [cells, cut] = matrix(reader, rowIds, columnIds, steps, middle);
  truncated = truncated || cut;

  const usedRows = new Set(), usedColumns = new Set();
  for (const key of cells.keys()) { const [r, c] = key.split(',').map(Number); usedRows.add(r); usedColumns.add(c); }
  const rows = rowIds.filter(i => b.includeEmpty || usedRows.has(i)).map(i => summary(m, i));
  const columns = columnIds.filter(i => b.includeEmpty || usedColumns.has(i)).map(i => summary(m, i));
  if (b.sort === 'name') { sortBy(rows, nameKey); sortBy(columns, nameKey); } else if (b.sort === 'count') {
    const perRow = new Map(), perColumn = new Map();
    for (const [key, paths] of cells) {
      const [r, c] = key.split(',').map(Number);
      perRow.set(r, (perRow.get(r) || 0) + paths.length);
      perColumn.set(c, (perColumn.get(c) || 0) + paths.length);
    }
    sortBy(rows, x => [-(perRow.get(x.id) || 0), ...nameKey(x)]);
    sortBy(columns, x => [-(perColumn.get(x.id) || 0), ...nameKey(x)]);
  }
  const relType = id => reader.relationship(id).type;

  if (csv) {
    if (b.csvLayout === 'grid' && rows.length * columns.length > MAX_GRID_CELLS) {
      throw new HttpError(422, `csvLayout: a grid of ${rows.length} x ${columns.length} cells is too large; use list`, 'VALIDATION_ERROR');
    }
    const label = item => (b.csvLabels === 'xmi' ? item.xmiIdentifier : b.csvLabels === 'name+type' ? `${item.name || ''} (${item.type})` : item.name || '');
    const out = [];
    if (b.csvLayout === 'grid') {
      out.push(['', ...columns.map(label)]);
      for (const row of rows) out.push([label(row), ...columns.map(c => (cells.has(`${row.id},${c.id}`) ? String(cells.get(`${row.id},${c.id}`).length) : ''))]);
    } else {
      out.push(['row', 'row type', 'column', 'column type', 'count', 'relationship types', 'intermediates']);
      for (const row of rows) {
        for (const column of columns) {
          const paths = cells.get(`${row.id},${column.id}`);
          if (!paths?.length) continue;
          const kinds = [...new Set(paths.flatMap(([rels]) => rels.map(relType)))].sort();
          const mids = [...new Set(paths.flatMap(([, mid]) => mid))].sort((x, y) => x - y);
          out.push([label(row), row.type, label(column), column.type, paths.length, kinds.join(' '), mids.join(' ')]);
        }
      }
    }
    return '﻿' + csvRows(out, b.csvDelimiter);
  }

  const outCells = [];
  for (const row of rows) {
    for (const column of columns) {
      const paths = cells.get(`${row.id},${column.id}`);
      if (!paths?.length) continue;
      const cell = { row: row.id, column: column.id, count: paths.length };
      if (b.details) cell.paths = paths.slice(0, PATHS_PER_CELL).map(([rels, mid]) => ({ relationshipIds: rels, intermediateIds: mid }));
      outCells.push(cell);
    }
  }
  return {
    rows, columns, cells: outCells, via: dumpVia(via),
    totals: { rows: rows.length, columns: columns.length, cells: outCells.length, paths: outCells.reduce((s, c) => s + c.count, 0) },
    truncated,
  };
}

/** body.via as the API echoes it: model_dump(exclude_none=True), with its defaults. */
function dumpVia(via) {
  const out = { direction: via.direction || 'any' };
  if (via.types != null) out.types = via.types;
  if (via.path != null) out.path = via.path.map(s => ({ ...(s.types != null ? { types: s.types } : {}), direction: s.direction || 'any' }));
  if (via.intermediateTypes != null) out.intermediateTypes = via.intermediateTypes;
  return out;
}

// ---------------------------------------------------------------------------------------- hierarchy (HLP-12)

function children(reader, parent, rules, childTypes) {
  const found = [];
  rules.forEach(([relType, direction], index) => {
    for (const [child, via] of hop(reader, parent, new Set([relType]), direction)) {
      if (childTypes == null || childTypes.has(reader.typeOf(child))) found.push([index, via[0], child, via.at(-1)]);
    }
  });
  return found;
}

function hierarchy(reader, roots, rules, { childTypes = null, maxDepth = 3, topLevelOnly = true, limit = MAX_GRAPH_ELEMENTS } = {}) {
  const rootSet = new Set(roots);
  let top = [...roots];
  if (topLevelOnly) {
    const belowOther = new Set();
    for (const root of roots) {
      const reach = new Set([root]);
      let level = [root];
      for (let i = 0; i < maxDepth; i++) {
        level = level.flatMap(f => children(reader, f, rules, childTypes).map(c => c[2])).filter(c => !reach.has(c));
        level.forEach(c => reach.add(c));
      }
      for (const r of reach) if (r !== root && rootSet.has(r)) belowOther.add(r);
    }
    top = roots.filter(r => !belowOther.has(r));
    if (!top.length) top = roots.slice(0, 1);
  }
  const placed = new Set(top);
  const parentOf = new Map();
  const otherParents = [];
  const more = new Set();
  let truncated = false;
  for (const root of top) {
    let frontier = [root];
    let completed = true;
    for (let level = 1; level <= maxDepth; level++) {
      const candidates = sortBy(frontier.flatMap(parent => children(reader, parent, rules, childTypes)
        .map(([index, relId, child, lastRel]) => [index, relId, parent, child, lastRel])), c => c);
      const next = [];
      for (const [index, relId, parent, child] of candidates) {
        if (child === parent) continue;
        if (placed.has(child)) {
          const p = parentOf.get(child);
          if (!(p && p[0] === parent && p[1] === relId && p[2] === index)) otherParents.push([child, parent, relId, index]);
          continue;
        }
        if (placed.size >= limit) { truncated = true; break; }
        placed.add(child);
        parentOf.set(child, [parent, relId, index]);
        next.push(child);
      }
      frontier = next;
      if (!frontier.length || truncated) { completed = false; break; }
    }
    if (completed) {
      for (const node of frontier) if (children(reader, node, rules, childTypes).some(c => !placed.has(c[2]))) more.add(node);
    }
  }
  for (const root of roots) if (!placed.has(root)) { top.push(root); placed.add(root); }
  if (more.size) truncated = true;
  const unique = new Map(otherParents.map(o => [o.join(','), o]));
  return [top, parentOf, [...unique.values()], more, truncated];
}

/** reports.property_values: per element, the value of each requested property (preferred lang, no lang, first). */
function propertyValues(m, ids, names, lang) {
  const wanted = new Map(names.map(n => [casefold(n), n]));
  if (!wanted.size) return new Map();
  const result = new Map();
  for (const id of ids) {
    const props = [...(m.elements.get(id)?.properties || [])].sort((a, b) => a.id - b.id);
    const best = new Map();
    for (const p of props) {
      const key = casefold(m.definitionName(p) ?? '');
      if (!wanted.has(key)) continue;
      const rank = lang && p.lang === lang ? 0 : !p.lang ? 1 : 2;
      const current = best.get(key);
      if (!current || rank < current[0]) best.set(key, [rank, p.value]);
    }
    if (best.size) result.set(id, Object.fromEntries([...best].map(([key, [, value]]) => [wanted.get(key), value])));
  }
  return result;
}

export function hierarchyAnswer(m, body) {
  const b = { nesting: [{ type: 'Composition', direction: 'out' }, { type: 'Aggregation', direction: 'out' }],
    childTypes: null, maxDepth: 3, topLevelOnly: true, properties: [], lang: null, counts: true, ...body };
  const reader = new Reader(m);
  const everyRoot = resolveSet(m, b.roots);
  const names = new Map(everyRoot.map(id => [id, summary(m, id)]));
  const roots = sortBy([...everyRoot], i => nameKey(names.get(i))).slice(0, MAX_GRAPH_ELEMENTS);
  const rules = b.nesting.map(r => [r.type, r.direction || 'out']);
  const [top, parentOf, otherParents, more, cut] = hierarchy(reader, roots, rules, {
    childTypes: typeSet(b.childTypes), maxDepth: b.maxDepth, topLevelOnly: b.topLevelOnly,
  });
  const truncated = cut || roots.length < everyRoot.length;
  const every = new Set([...top, ...parentOf.keys()]);
  for (const id of every) if (!names.has(id)) names.set(id, summary(m, id));
  const values = propertyValues(m, every, b.properties, b.lang);
  const childrenOf = new Map();
  for (const [child, [parent]] of parentOf) { if (!childrenOf.has(parent)) childrenOf.set(parent, []); childrenOf.get(parent).push(child); }

  const node = id => {
    const item = { ...names.get(id) };
    if (b.properties.length) item.properties = values.get(id) || {};
    if (parentOf.has(id)) { const [, relId, index] = parentOf.get(id); item.via = { relationshipId: relId, type: rules[index][0] }; }
    const kids = sortBy([...(childrenOf.get(id) || [])], i => nameKey(names.get(i)));
    const built = kids.map(node);
    const descendants = built.reduce((s, [, d]) => s + 1 + d, 0);
    if (b.counts) item.descendants = descendants;
    if (more.has(id)) item.more = true;
    item.children = built.map(([n]) => n);
    return [item, descendants];
  };
  const found = Object.fromEntries(b.properties.map(name => [name, new Set()]));
  for (const props of values.values()) for (const [name, value] of Object.entries(props)) found[name].add(value);
  return {
    roots: sortBy([...top], i => nameKey(names.get(i))).map(r => node(r)[0]),
    otherParents: otherParents.map(([c, p, r, i]) => ({ id: c, parentId: p, relationshipId: r, type: rules[i][0] })),
    propertyValues: Object.fromEntries(Object.entries(found).map(([name, set]) => [name, [...set].sort(compare)])),
    truncated,
  };
}
