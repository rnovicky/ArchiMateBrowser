// Offline copy (2.20.0): the graph helpers of the API (POST …/graph/neighbourhood, subgraph, impact,
// expansion-counts; GET …/graph/paths), ported from its app/services/graph.py and
// app/routers/v2/graph.py, with the same rules, orders and limits. The model is in memory, so the
// API's GraphReader is a few look-ups here.

import { OfflineModel, byKey, casefold, sortedIds } from './model.js';
import { LAYER_LABEL_OF, LAYER_TYPES } from './layers.js';

const JUNCTION_TYPES = new Set(['AndJunction', 'OrJunction']);
const RELATIONSHIP_END = 'Relationship';
/** settings.max_graph_elements of the API (MAX_GRAPH_ELEMENTS, 5000 by default). */
export const MAX_GRAPH_ELEMENTS = 5000;

export class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const notFoundIds = (what, ids) => {
  const sorted = [...ids].sort((a, b) => a - b);
  const shown = sorted.slice(0, 20).join(', ') + (sorted.length > 20 ? ` and ${sorted.length - 20} more` : '');
  return new HttpError(404, `${what} not found in this model: ${shown}.`);
};

// ---------------------------------------------------------------------------------------- the reader

/** What the API's GraphReader answers, over the model in memory; `condition` is the request's `property`. */
class Reader {
  constructor(model, condition = null) {
    this.m = model;
    this.condition = condition; // element -> true when it meets the property condition
  }

  typeOf(id) { return this.m.elements.get(id)?.type ?? null; }
  isJunction(id) { return JUNCTION_TYPES.has(this.typeOf(id)); }
  accepts(id, filters) {
    if (!filters.elementOk(this.typeOf(id))) return false;
    return !filters.byProperty || !this.condition || this.condition(this.m.elements.get(id));
  }

  outgoing(id) { return this.m.out.get(id) || []; }
  incoming(id) { return this.m.in.get(id) || []; }
  relationship(id) { return this.m.relationships.get(id) || null; }

  /** Rule 2: the element(s) at one end of a relationship. */
  ends(elementId, relationshipId, seen = new Set()) {
    if (elementId != null) return [elementId];
    if (relationshipId == null || seen.has(relationshipId)) return [];
    seen.add(relationshipId);
    const r = this.relationship(relationshipId);
    if (!r) return [];
    return [...this.ends(r.sourceElementId, r.sourceRelationshipId, seen), ...this.ends(r.targetElementId, r.targetRelationshipId, seen)];
  }

  allEndElements(r) {
    return [...this.ends(r.sourceElementId, r.sourceRelationshipId), ...this.ends(r.targetElementId, r.targetRelationshipId)];
  }

  onRelationships() {
    this._onRel ??= this.m.relationshipList.filter(r => r.sourceRelationshipId != null || r.targetRelationshipId != null);
    return this._onRel;
  }

  ofType(type) { return this.m.relationshipList.filter(r => r.type === type); }

  withSomethingAttached() {
    return new Set(this.onRelationships().flatMap(r => [r.sourceRelationshipId, r.targetRelationshipId]).filter(x => x != null));
  }

  /** Relationships whose source and target are both elements of the set, by id. */
  among(ids) {
    const found = [];
    for (const id of ids) for (const r of this.outgoing(id)) if (ids.has(r.targetElementId)) found.push(r);
    return found.sort((a, b) => a.id - b.id);
  }

  missingElements(ids) { return [...new Set(ids)].filter(id => !this.m.elements.has(id)); }
}

// ---------------------------------------------------------------------------------------- filters (rule 4)

class Filters {
  constructor({ elementTypes = null, relationshipTypes = null, byProperty = false, hidden = [], endType = null } = {}) {
    this.elementTypes = elementTypes;
    this.relationshipTypes = relationshipTypes;
    this.byProperty = byProperty;
    this.hidden = hidden;
    this.endType = endType;
  }

  elementOk(type) { return type != null && (this.elementTypes == null || this.elementTypes.has(type)); }

  relationshipOk = r => {
    if (this.relationshipTypes != null && !this.relationshipTypes.has(r.type)) return false;
    return !this.hidden.some(rule => this.#hides(rule, r));
  };

  #hides([type, source, target], r) {
    return (type == null || r.type === type) && this.#endIs(source, r.sourceElementId, r.sourceRelationshipId)
      && this.#endIs(target, r.targetElementId, r.targetRelationshipId);
  }

  #endIs(wanted, elementId, relationshipId) {
    if (wanted == null) return true;
    if (wanted === RELATIONSHIP_END) return relationshipId != null;
    return elementId != null && this.endType != null && this.endType(elementId) === wanted;
  }
}

const NO_FILTER = new Filters();

/** routers/v2/graph.py _reader: a reader that evaluates the request's `property` condition. */
function readerFor(model, body) {
  const p = body.property;
  if (!p) return new Reader(model);
  const op = p.op || (p.value == null ? 'exists' : 'eq');
  return new Reader(model, e => model.meets(e, p.name, op, p.value ?? null));
}

/** routers/v2/graph.py _filters: `layers`, `elementTypes` and `property` together mean that all must hold. */
function filtersFor(body, reader = null) {
  let types = body.elementTypes != null ? new Set(body.elementTypes) : null;
  if (body.layers != null) {
    const inLayers = new Set(body.layers.flatMap(l => LAYER_TYPES[l] || []));
    types = types == null ? inLayers : new Set([...types].filter(t => inLayers.has(t)));
  }
  const hidden = (body.hideRelationships || []).map(r => [r.type ?? null, r.sourceType ?? null, r.targetType ?? null]);
  return new Filters({
    elementTypes: types,
    relationshipTypes: body.relationshipTypes != null ? new Set(body.relationshipTypes) : null,
    byProperty: body.property != null,
    hidden, endType: reader && hidden.length ? id => reader.typeOf(id) : null,
  });
}

function requireElements(reader, ids, what = 'Elements') {
  ids = [...new Set(ids)];
  const missing = reader.missingElements(ids);
  if (missing.length) throw notFoundIds(what, missing);
  return ids;
}

// ---------------------------------------------------------------------------------------- rules 1 to 5

/** Neighbourhood: { element id: distance } in the order reached (a Map), and whether `limit` cut it. */
function neighbourhood(reader, seeds, depth, { direction = 'both', filters = NO_FILTER, relationshipOk = null, limit = null, incomingTypes = null, outgoingTypes = null } = {}) {
  const relOk = relationshipOk || filters.relationshipOk;
  // API 3.24.0: the relationship types followed against / along their direction, at every step (null: every type)
  const inTypes = incomingTypes == null ? null : new Set(incomingTypes), outTypes = outgoingTypes == null ? null : new Set(outgoingTypes);
  const outOk = outTypes ? r => outTypes.has(r.type) && relOk(r) : relOk;
  const inOk = inTypes ? r => inTypes.has(r.type) && relOk(r) : relOk;
  const distance = new Map(seeds.map(s => [s, 0]));
  let truncated = false;
  let frontier = [...distance.keys()];
  for (let level = 1; level <= depth; level++) {
    if (!frontier.length || truncated) break;
    const next = [];
    const queue = [...frontier];
    while (queue.length && !truncated) {
      const current = queue.shift();
      const reached = [];
      if (direction !== 'in') for (const r of reader.outgoing(current)) if (outOk(r)) reached.push(...reader.ends(r.targetElementId, r.targetRelationshipId));
      if (direction !== 'out') for (const r of reader.incoming(current)) if (inOk(r)) reached.push(...reader.ends(r.sourceElementId, r.sourceRelationshipId));
      for (const other of reached) {
        if (distance.has(other) || !reader.accepts(other, filters)) continue;
        if (limit != null && distance.size >= limit) { truncated = true; break; }
        distance.set(other, level);
        next.push(other);
        if (reader.isJunction(other)) queue.push(other); // rule 3: pass through within this hop
      }
    }
    frontier = next;
  }
  return [distance, truncated];
}

/** Rule 5: the relationships to draw for a set of elements, by id. */
function relationshipsOf(reader, elementIds, relationshipOk = () => true) {
  const ids = new Set(elementIds);
  const drawn = new Map(reader.among(ids).filter(relationshipOk).map(r => [r.id, r]));
  const endOk = (e, r) => (e != null ? ids.has(e) : drawn.has(r));
  const candidates = reader.onRelationships().filter(relationshipOk);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of candidates) {
      if (drawn.has(r.id)) continue;
      if (endOk(r.sourceElementId, r.sourceRelationshipId) && endOk(r.targetElementId, r.targetRelationshipId)) {
        drawn.set(r.id, r);
        changed = true;
      }
    }
  }
  return [...drawn.values()].sort((a, b) => a.id - b.id);
}

// ---------------------------------------------------------------------------------------- impact

const PROPAGATION = {
  Serving: 'out', Realization: 'out', Assignment: 'out', Flow: 'out', Triggering: 'out', Influence: 'out',
  Composition: 'in', Aggregation: 'in', Access: 'in', Specialization: 'in', Association: 'both',
};
const DEFAULT_IMPACT_TYPES = ['Serving', 'Realization', 'Assignment', 'Composition', 'Aggregation', 'Access', 'Flow', 'Triggering'];

function impact(reader, starts, { direction = 'impact', types = DEFAULT_IMPACT_TYPES, maxDepth = 5, propagation = null, filters = NO_FILTER, limit = null } = {}) {
  const typeSet = new Set(types);
  const rules = { ...PROPAGATION, ...(propagation || {}) };
  const follow = (r, fromSource) => {
    const rule = rules[r.type] || 'both';
    if (rule === 'both') return true;
    const forward = direction === 'impact' ? rule === 'out' : rule === 'in';
    return fromSource ? forward : !forward;
  };
  const visited = new Set(starts);
  const results = new Map();
  let truncated = false;
  let frontier = [...new Set(starts)];
  let level = 0;
  while (frontier.length && level < maxDepth + 1 && !truncated) {
    level += 1;
    const next = [];
    const queue = [...frontier];
    while (queue.length && !truncated) {
      const current = queue.shift();
      const steps = [];
      for (const r of reader.outgoing(current)) if (typeSet.has(r.type) && follow(r, true)) steps.push([r, reader.ends(r.targetElementId, r.targetRelationshipId)]);
      for (const r of reader.incoming(current)) if (typeSet.has(r.type) && follow(r, false)) steps.push([r, reader.ends(r.sourceElementId, r.sourceRelationshipId)]);
      for (const [r, others] of steps) {
        for (const other of others) {
          if (visited.has(other) || !reader.accepts(other, filters)) continue;
          if (limit != null && results.size >= limit) { truncated = true; break; }
          visited.add(other);
          results.set(other, { elementId: other, level, via: r.id, origin: current });
          if (reader.isJunction(other)) queue.push(other);
          else next.push(other);
        }
      }
    }
    frontier = next;
  }
  const kept = [...results.values()].filter(r => r.level <= maxDepth);
  return [kept, truncated || kept.length < results.size];
}

function withAttachedTo(reader, relationshipIds) {
  const found = new Set();
  const todo = [...relationshipIds];
  while (todo.length) {
    const rid = todo.pop();
    if (found.has(rid)) continue;
    const r = reader.relationship(rid);
    if (!r) continue;
    found.add(rid);
    todo.push(...[r.sourceRelationshipId, r.targetRelationshipId].filter(x => x != null));
  }
  return sortedIds(found);
}

// ---------------------------------------------------------------------------------------- expansion counts

function hiddenNeighbours(reader, elementId, visible, { direction = 'both', filters = NO_FILTER, relationshipType = null } = {}) {
  const relOk = r => (relationshipType == null || r.type === relationshipType) && filters.relationshipOk(r);
  const [found] = neighbourhood(reader, [elementId], 1, { direction, filters, relationshipOk: relOk });
  return new Set([...found.keys()].filter(x => x !== elementId && !visible.has(x)));
}

function hiddenByType(reader, elementId, visible, { filters = NO_FILTER } = {}) {
  const counts = [];
  const types = new Set([...reader.outgoing(elementId), ...reader.incoming(elementId)].map(r => r.type));
  for (const type of types) {
    for (const direction of ['out', 'in']) {
      const count = hiddenNeighbours(reader, elementId, visible, { direction, filters, relationshipType: type }).size;
      if (count) counts.push({ type, direction, count });
    }
  }
  return counts.sort(byKey(c => [-c.count, c.type, c.direction !== 'out']));
}

// ---------------------------------------------------------------------------------------- nesting

function nesting(reader, elementIds, relationships, types, containerTypes = null) {
  const ids = new Set(elementIds);
  const parentOf = new Map();
  const nested = new Set();
  const isAncestor = (candidate, of) => {
    for (let p = parentOf.get(of); p != null; p = parentOf.get(p)) if (p === candidate) return true;
    return false;
  };
  const attachedTo = new Set(relationships.flatMap(r => [r.sourceRelationshipId, r.targetRelationshipId]).filter(x => x != null));
  const candidates = relationships.filter(r => types.includes(r.type) && !attachedTo.has(r.id)
    && ids.has(r.sourceElementId) && ids.has(r.targetElementId) && r.sourceElementId !== r.targetElementId
    && !reader.isJunction(r.sourceElementId) && !reader.isJunction(r.targetElementId)
    && (containerTypes == null || containerTypes.has(reader.typeOf(r.sourceElementId))))
    .sort(byKey(r => [types.indexOf(r.type), r.id]));
  for (const r of candidates) {
    const parent = r.sourceElementId, child = r.targetElementId;
    if (parentOf.has(child) || isAncestor(child, parent)) continue;
    parentOf.set(child, parent);
    nested.add(r.id);
  }
  const hidden = relationships.filter(r => !nested.has(r.id) && r.sourceElementId != null && r.targetElementId != null
    && (isAncestor(r.sourceElementId, r.targetElementId) || isAncestor(r.targetElementId, r.sourceElementId))).map(r => r.id);
  return { parentOf, nested: sortedIds(nested), hidden: sortedIds(hidden) };
}

function nestingAnswer(reader, ids, rels, wanted) {
  const containers = wanted.containerTypes == null ? null : new Set(wanted.containerTypes);
  const types = [...new Set(wanted.types || ['Composition', 'Aggregation'])];
  const n = nesting(reader, ids, rels, types, containers);
  const parentOf = {};
  for (const [child, parent] of [...n.parentOf].sort((a, b) => a[0] - b[0])) parentOf[String(child)] = parent;
  return { parentOf, nestedRelationshipIds: n.nested, hiddenRelationshipIds: n.hidden };
}

// ---------------------------------------------------------------------------------------- paths

function stepsOf(reader, elementId, directed, relOk) {
  const found = [];
  for (const r of reader.outgoing(elementId)) if (relOk(r)) for (const e of reader.ends(r.targetElementId, r.targetRelationshipId)) found.push([r.id, e]);
  if (!directed) for (const r of reader.incoming(elementId)) if (relOk(r)) for (const e of reader.ends(r.sourceElementId, r.sourceRelationshipId)) found.push([r.id, e]);
  const unique = new Map(found.filter(([, e]) => e !== elementId && reader.typeOf(e) != null).map(s => [s.join(','), s]));
  return [...unique.values()].sort(byKey(s => s));
}

function paths(reader, start, goal, { maxLength = 6, k = 3, directed = false, filters = NO_FILTER, limit = null, maxWork = 200000 } = {}) {
  const relOk = filters.relationshipOk;
  const steps = new Map();
  const fromStart = new Map([[start, 0]]);
  let truncated = false;
  let frontier = [start];
  for (let level = 1; level <= maxLength; level++) {
    if (!frontier.length || truncated) break;
    const next = [];
    for (const current of frontier) {
      steps.set(current, stepsOf(reader, current, directed, relOk));
      for (const [, other] of steps.get(current)) {
        if (fromStart.has(other)) continue;
        if (limit != null && fromStart.size >= limit) { truncated = true; break; }
        fromStart.set(other, level);
        next.push(other);
      }
    }
    frontier = next;
  }
  if (!fromStart.has(goal)) return [[], truncated];

  const reverse = new Map();
  for (const [current, list] of steps) for (const [, other] of list) { if (!reverse.has(other)) reverse.set(other, new Set()); reverse.get(other).add(current); }
  const toGoal = new Map([[goal, 0]]);
  const queue = [goal];
  while (queue.length) {
    const current = queue.shift();
    for (const previous of reverse.get(current) || []) {
      if (!toGoal.has(previous)) { toGoal.set(previous, toGoal.get(current) + 1); queue.push(previous); }
    }
  }

  const found = [];
  let work = 0;
  const search = (path, onPath, remaining) => {
    const current = path.at(-1);
    if (remaining === 0) { found.push([...path]); return true; }
    for (const [relId, other] of steps.get(current) || []) {
      work += 1;
      if (work > maxWork) return false;
      if (onPath.has(other) || (toGoal.has(other) ? toGoal.get(other) : maxLength + 1) > remaining - 1) continue;
      if ((other === goal) !== (remaining === 1)) continue;
      path.push(relId, other);
      onPath.add(other);
      const alive = search(path, onPath, remaining - 1);
      path.splice(-2);
      onPath.delete(other);
      if (!alive) return false;
      if (found.length >= k) return true;
    }
    return true;
  };
  for (let length = fromStart.get(goal); length <= maxLength; length++) {
    if (found.length >= k) break;
    if (!search([start], new Set([start]), length)) { truncated = true; break; }
  }
  return [found.slice(0, k), truncated];
}

// ---------------------------------------------------------------------------------------- the endpoints

const relationshipList = (m, rels, fields) => rels.map(r => m.relationshipPayload(r.id, fields));

function filtered(reader, candidates, kept, rels) {
  return { elements: Math.max(0, candidates - kept.length), relationships: relationshipsOf(reader, kept).length - rels.length };
}

export function neighbourhoodAnswer(m, body) {
  const b = { depth: 1, direction: 'both', fields: 'summary', include: [], ...body };
  const reader = readerFor(m, b);
  const seeds = requireElements(reader, b.seeds, 'Seeds');
  const filters = filtersFor(b, reader);
  if (b.incomingTypes != null && b.direction === 'out') throw new HttpError(422, "incomingTypes needs direction 'both' or 'in'", 'VALIDATION_ERROR');
  if (b.outgoingTypes != null && b.direction === 'in') throw new HttpError(422, "outgoingTypes needs direction 'both' or 'out'", 'VALIDATION_ERROR');
  const walk = { incomingTypes: b.incomingTypes ?? null, outgoingTypes: b.outgoingTypes ?? null };
  const [distance, truncated] = neighbourhood(reader, seeds, b.depth, { direction: b.direction, filters, limit: MAX_GRAPH_ELEMENTS, ...walk });
  const ordered = [...distance.keys()].sort(byKey(i => [distance.get(i), i]));
  const rels = relationshipsOf(reader, [...distance.keys()], filters.relationshipOk);
  const result = {
    seeds,
    elements: ordered.map(i => ({ ...m.elementPayload(i, b.fields, b.include.includes('degree')), distance: distance.get(i) })),
    relationships: relationshipList(m, rels, b.fields),
    truncated,
  };
  if (b.nesting != null) result.nesting = nestingAnswer(reader, [...distance.keys()], rels, b.nesting);
  if (b.include.includes('filtered')) {
    const [unfiltered] = neighbourhood(reader, seeds, b.depth, { direction: b.direction, limit: MAX_GRAPH_ELEMENTS, ...walk });
    result.filtered = filtered(reader, unfiltered.size, [...distance.keys()], rels);
  }
  return result;
}

function resolveSet(m, reader, b) {
  if (b.elementIds != null) return [sortedIds(requireElements(reader, b.elementIds)), null];
  if (b.viewId != null) {
    if (!m.viewById.has(b.viewId)) throw new HttpError(404, 'View not found.');
    return [sortedIds(m.viewElements(b.viewId).keys()), null];
  }
  if (b.relationshipType != null || b.onRelationships) {
    let rels, setOk;
    if (b.onRelationships) {
      rels = reader.onRelationships();
      const attachedTo = reader.withSomethingAttached();
      const listed = new Set(rels.map(r => r.id));
      setOk = r => listed.has(r.id) || attachedTo.has(r.id);
    } else {
      const wanted = b.relationshipType;
      rels = reader.ofType(wanted);
      setOk = r => r.type === wanted;
    }
    const ends = sortedIds(rels.flatMap(r => reader.allEndElements(r)));
    return [ends.filter(e => reader.typeOf(e) != null), setOk];
  }
  let condition;
  if (b.folderId != null) {
    const folder = m.orgById.get(b.folderId);
    if (!folder) throw new HttpError(404, 'Organization not found.');
    const below = new Set(m.foldersBelow(folder.id));
    const filed = new Set([...m.orgById.values()].filter(o => o.refElementId != null && below.has(m.orgParent.get(o.id))).map(o => o.refElementId));
    condition = e => filed.has(e.id);
  } else if (b.elementType != null) condition = e => e.type === b.elementType;
  else if (b.allElements) condition = () => true; // API 3.20.0
  else {
    const types = new Set(LAYER_TYPES[b.layer] || []);
    condition = e => types.has(e.type);
  }
  return [m.elementList.filter(condition).map(e => e.id), null];
}

export function subgraphAnswer(m, body) {
  const b = { fields: 'summary', include: [], excludeRelationshipIds: [], ...body };
  if (b.elementIds != null && b.elementIds.length > MAX_GRAPH_ELEMENTS) {
    throw new HttpError(422, `at most ${MAX_GRAPH_ELEMENTS} ids may be given, got ${b.elementIds.length}.`, 'VALIDATION_ERROR');
  }
  const reader = readerFor(m, b);
  const [candidates, setOk] = resolveSet(m, reader, b);
  const filters = filtersFor(b, reader);
  const passing = candidates.filter(i => reader.accepts(i, filters));
  const truncated = passing.length > MAX_GRAPH_ELEMENTS;
  const ids = passing.slice(0, MAX_GRAPH_ELEMENTS);
  const excluded = new Set(b.excludeRelationshipIds);
  const relOk = r => filters.relationshipOk(r) && !excluded.has(r.id) && (setOk == null || setOk(r));
  const rels = relationshipsOf(reader, ids, relOk);
  const result = {
    elements: ids.map(i => m.elementPayload(i, b.fields, b.include.includes('degree'))),
    relationships: relationshipList(m, rels, b.fields),
    truncated,
  };
  if (b.nesting != null) result.nesting = nestingAnswer(reader, ids, rels, b.nesting);
  if (b.include.includes('filtered')) result.filtered = filtered(reader, candidates.length - (passing.length - ids.length), ids, rels);
  return result;
}

const prettyType = t => (t || '').replace(/([a-z])([A-Z])/g, '$1 $2');

function csvField(value) { return `"${String(value).replace(/"/g, '""')}"`; }

export function impactAnswer(m, body, { csv = false } = {}) {
  const b = { direction: 'impact', maxDepth: 5, include: [], fields: 'summary', csvDelimiter: ',', ...body };
  const reader = readerFor(m, b);
  const starts = requireElements(reader, b.start, 'Start elements');
  const types = b.relationshipTypes == null ? DEFAULT_IMPACT_TYPES : b.relationshipTypes;
  const [reached, truncated] = impact(reader, starts, {
    direction: b.direction, types, maxDepth: b.maxDepth, propagation: b.propagation || {},
    filters: filtersFor(b), limit: MAX_GRAPH_ELEMENTS,
  });
  if (csv) {
    const name = id => m.elements.get(id)?.name || '';
    const ordered = [...reached].sort(byKey(r => [r.level, casefold(name(r.elementId)), r.elementId]));
    const rows = [['level', 'name', 'type', 'layer', 'via relationship', 'from', 'xmi identifier']];
    for (const r of ordered) {
      const e = m.elements.get(r.elementId);
      rows.push([r.level, e.name || '', prettyType(e.type), LAYER_LABEL_OF[e.type], reader.relationship(r.via).type, name(r.origin), e.xmiIdentifier]);
    }
    return rows.map(row => row.map(csvField).join(b.csvDelimiter)).join('\r\n');
  }
  const relationshipIds = withAttachedTo(reader, new Set(reached.map(r => r.via)));
  const result = {
    start: starts,
    results: [...reached].sort(byKey(r => [r.level, r.elementId]))
      .map(r => ({ elementId: r.elementId, level: r.level, viaRelationshipId: r.via, fromElementId: r.origin })),
    maxLevel: reached.reduce((x, r) => Math.max(x, r.level), 0),
    truncated,
    relationshipIds,
  };
  if (b.include.includes('relationships') || b.nesting != null) {
    const shown = [...starts, ...reached.map(r => r.elementId)];
    const walked = new Set(relationshipIds);
    const drawn = relationshipsOf(reader, shown, r => walked.has(r.id));
    if (b.include.includes('relationships')) result.relationships = relationshipList(m, drawn, b.fields);
    if (b.nesting != null) result.nesting = nestingAnswer(reader, shown, drawn, b.nesting);
  }
  return result;
}

export function pathsAnswer(m, query) {
  const from = Number(query.get('from')), to = Number(query.get('to'));
  const maxLength = Number(query.get('maxLength') ?? 6), k = Number(query.get('k') ?? 3);
  const direction = query.get('direction') || 'any';
  const types = (query.get('relationshipTypes') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (from === to) throw new HttpError(422, 'to: must differ from `from`.', 'VALIDATION_ERROR');
  const reader = new Reader(m);
  requireElements(reader, [from, to]);
  const [found, truncated] = paths(reader, from, to, {
    maxLength, k, directed: direction === 'directed',
    filters: new Filters({ relationshipTypes: types.length ? new Set(types) : null }), limit: MAX_GRAPH_ELEMENTS,
  });
  return {
    from, to,
    paths: found.map(path => ({ length: Math.floor(path.length / 2), steps: path.map((s, i) => (i % 2 === 0 ? { elementId: s } : { relationshipId: s })) })),
    truncated,
  };
}

export function expansionCountsAnswer(m, body) {
  const b = { visibleIds: [], direction: 'both', byType: true, ...body };
  const reader = readerFor(m, b);
  const ids = requireElements(reader, b.elementIds);
  const visible = new Set(b.visibleIds);
  const filters = filtersFor(b, reader);
  const counts = {};
  for (const id of ids) {
    const count = direction => hiddenNeighbours(reader, id, visible, { direction, filters }).size;
    const entry = { total: count(b.direction), out: count('out'), in: count('in') };
    if (b.byType) entry.byType = hiddenByType(reader, id, visible, { filters });
    counts[String(id)] = entry;
  }
  return { counts };
}

/** For the reports (reports.js): the same rules, reused. */
export { Reader, Filters, NO_FILTER, readerFor, filtersFor, relationshipsOf, OfflineModel };
