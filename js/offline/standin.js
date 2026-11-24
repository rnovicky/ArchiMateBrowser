// Offline copy (2.20.0): a stand-in for the ArchiMate API, over one model's snapshot (GET …/snapshot,
// API 3.14.0). `offlineFetch(snapshot)` returns a function with the shape of fetch(): js/api.js sends
// it every request of an offline copy, and it answers what the API would, from memory. It knows the
// requests the Browser makes; anything else is refused with 404 or, for writes, 403.
//
// The rules come from the API's code (named at each answer); tests/unit/offline.test.js asks the
// stand-in and the real API the same questions about the test models and compares the answers.

import { OfflineModel, byKey, byName, casefold, elementSummary, page, relationshipSummary, sortedIds, viewSummary } from './model.js';
import { HttpError, MAX_GRAPH_ELEMENTS, expansionCountsAnswer, impactAnswer, neighbourhoodAnswer, pathsAnswer, subgraphAnswer } from './graph.js';
import { LAYER_TYPES } from './layers.js';
import { hierarchyAnswer, matrixAnswer, qualityAnswer } from './reports.js';

const DEFAULT_PAGE_SIZE = 100, MAX_PAGE_SIZE = 1000, SEARCH_PAGE_SIZE = 50;

/** The permissions of a reader key: what an offline copy may do. */
export const OFFLINE_ME = {
  name: 'offline', role: 'reader', permissions: ['read'], source: 'offline',
  keyLabel: null, displayName: null, expiresAt: null, expiresSoon: false,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function error(e) {
  const status = e.status || 500;
  const code = e.code || { 400: 'BAD_REQUEST', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 422: 'VALIDATION_ERROR' }[status] || 'ERROR';
  return json({ code, message: e.message }, status);
}

function paging(q, defaultLimit = DEFAULT_PAGE_SIZE) {
  const limit = q.has('limit') ? Number(q.get('limit')) : Math.min(defaultLimit, MAX_PAGE_SIZE);
  const offset = q.has('offset') ? Number(q.get('offset')) : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE || !Number.isInteger(offset) || offset < 0) {
    throw new HttpError(422, `limit must be 1 to ${MAX_PAGE_SIZE}, offset at least 0.`, 'VALIDATION_ERROR');
  }
  return { limit, offset };
}

const csv = value => (value == null ? [] : String(value).split(',').map(s => s.trim()).filter(Boolean));
const flag = value => value === 'true' || value === '1';
const ids = value => (value == null ? null : csv(value).map(Number));

// ---------------------------------------------------------------------------------------- the routes

/**
 * [method, pattern, handler(model, match, query, body)]: the path after the API's base (…/api/v2). The
 * handler returns what the API answers as JSON, or a Response.
 */
const ROUTES = [
  ['GET', /^\/auth\/me$/, () => OFFLINE_ME],
  ['GET', /^\/models$/, (m, _, q) => page([m.model], paging(q))],
  ['GET', /^\/models\/links$/, () => ({ items: [] })],
  ['GET', /^\/models\/(\d+)$/, m => m.model],
  ['GET', /^\/models\/(\d+)\/stats$/, m => m.snapshot.stats],
  ['GET', /^\/models\/(\d+)\/properties\/index$/, propertyIndex],
  ['GET', /^\/models\/(\d+)\/property-definitions$/, (m, _, q) => page(m.snapshot.propertyDefinitions, paging(q))],
  ['GET', /^\/models\/(\d+)\/properties$/, (m, _, q) => page(m.snapshot.modelProperties, paging(q))],
  ['GET', /^\/models\/(\d+)\/metadata$/, m => m.snapshot.metadata],
  ['GET', /^\/models\/(\d+)\/elements$/, listElements],
  ['GET', /^\/models\/(\d+)\/elements\/(\d+)$/, (m, x, q) => item(m.elements, x[2], 'Element', q.get('include') === 'degree' ? e => ({ ...e, degree: m.degree(e.id) }) : null)],
  ['GET', /^\/models\/(\d+)\/relationships$/, listRelationships],
  ['GET', /^\/models\/(\d+)\/relationships\/(\d+)$/, (m, x) => item(m.relationships, x[2], 'Relationship')],
  ['GET', /^\/models\/(\d+)\/views$/, (m, _, q) => page(m.views, paging(q))],
  ['GET', /^\/models\/(\d+)\/views\/(\d+)$/, (m, x) => item(m.viewById, x[2], 'View')],
  ['GET', /^\/models\/(\d+)\/views\/(\d+)\/content$/, viewContent],
  ['GET', /^\/models\/(\d+)\/views\/(\d+)\/elements$/, viewElements],
  ['GET', /^\/models\/(\d+)\/views\/(\d+)\/links$/, viewLinks],
  ['GET', /^\/models\/(\d+)\/elements\/(\d+)\/views$/, elementViews],
  ['GET', /^\/models\/(\d+)\/relationships\/(\d+)\/views$/, relationshipViews],
  ['GET', /^\/models\/(\d+)\/organizations$/, organizations],
  ['GET', /^\/models\/(\d+)\/organizations\/(\d+)\/contents$/, folderContents],
  ['GET', /^\/models\/(\d+)\/(element|relationship|view)s\/(\d+)\/folder$/, folderPath],
  ['GET', /^\/models\/(\d+)\/search$/, search],
  ['GET', /^\/models\/(\d+)\/graph\/paths$/, (m, _, q) => pathsAnswer(m, q)],
  ['GET', /^\/models\/(\d+)\/analysis\/quality$/, (m, _, q) => qualityAnswer(m, q)],
  ['POST', /^\/models\/(\d+)\/resolve$/, resolve],
  ['POST', /^\/models\/(\d+)\/graph\/neighbourhood$/, (m, _, q, b) => neighbourhoodAnswer(m, b)],
  ['POST', /^\/models\/(\d+)\/graph\/subgraph$/, (m, _, q, b) => subgraphAnswer(m, b)],
  ['POST', /^\/models\/(\d+)\/graph\/impact$/, (m, _, q, b, accept) => impactAnswer(m, b, { csv: accept.includes('text/csv') })],
  ['POST', /^\/models\/(\d+)\/graph\/expansion-counts$/, (m, _, q, b) => expansionCountsAnswer(m, b)],
  ['POST', /^\/models\/(\d+)\/graph\/matrix$/, (m, _, q, b, accept) => matrixAnswer(m, b, { csv: accept.includes('text/csv') })],
  ['POST', /^\/models\/(\d+)\/graph\/hierarchy$/, (m, _, q, b) => hierarchyAnswer(m, b)],
];

/**
 * A function with the shape of fetch() that answers from `snapshot`. `base` is the path of the API's
 * base as the page builds its URLs (settings.apiBase); `/health` is answered wherever it is asked.
 */
export function offlineFetch(snapshot, { base = '/api/v2' } = {}) {
  const model = new OfflineModel(snapshot);
  const prefix = new URL(base, 'http://x/').pathname.replace(/\/+$/, '');
  return async (url, init = {}) => {
    const u = new URL(url, 'http://x/');
    const method = (init.method || 'GET').toUpperCase();
    const accept = (init.headers && (init.headers.Accept || init.headers.accept)) || 'application/json';
    if (u.pathname.endsWith('/health')) return json({ status: 'ok', version: snapshot.apiVersion, apiVersions: ['v2'] });
    // from a page opened from disk on Windows, '/api/v2/…' becomes file:///C:/api/v2/…: the drive stays
    const at = u.pathname.indexOf(`${prefix}/`);
    const path = at >= 0 ? u.pathname.slice(at + prefix.length) : u.pathname;
    const modelMatch = path.match(/^\/models\/(\d+)/);
    try {
      if (modelMatch && Number(modelMatch[1]) !== model.id) throw new HttpError(404, 'ArchimateModel not found.');
      for (const [m, pattern, handle] of ROUTES) {
        const found = method === m && path.match(pattern);
        if (!found) continue;
        const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {};
        const result = handle(model, found, u.searchParams, body, accept);
        if (result instanceof Response) return result;
        if (typeof result === 'string') return new Response(result, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
        return json(result);
      }
      if (method !== 'GET') throw new HttpError(403, 'This is an offline copy of the model: it can be browsed, not changed.');
      throw new HttpError(404, 'Not available in an offline copy of the model.');
    } catch (e) {
      if (e instanceof HttpError) return error(e);
      console.error(e);
      return error({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: `The offline copy could not answer: ${e.message}` });
    }
  };
}

function item(map, id, what, transform = null) {
  const found = map.get(Number(id));
  if (!found) throw new HttpError(404, `${what} not found.`);
  return transform ? transform(structuredClone(found)) : found;
}

// ---------------------------------------------------------------------------------------- lists (routers/elements.py, relationships.py)

function listElements(m, _, q) {
  const p = paging(q);
  let list = m.elementList;
  if (q.get('type')) list = list.filter(e => e.type === q.get('type'));
  if (q.get('name')) list = list.filter(e => e.name != null && casefold(e.name).includes(casefold(q.get('name'))));
  const wanted = ids(q.get('ids'));
  if (wanted) { const set = new Set(wanted); list = list.filter(e => set.has(e.id)); }
  const test = OfflineModel.propertyTest(m, q.get('property'), q.get('propertyValue'), q.get('propertyOp'));
  if (test) list = list.filter(test);
  const out = page(list, p);
  if (csv(q.get('include')).includes('degree')) out.items = out.items.map(e => ({ ...e, degree: m.degree(e.id) }));
  return out;
}

function listRelationships(m, _, q) {
  const p = paging(q);
  let list = m.relationshipList;
  if (q.has('onRelationship')) {
    const on = flag(q.get('onRelationship'));
    list = list.filter(r => (r.sourceRelationshipId != null || r.targetRelationshipId != null) === on);
  }
  if (q.get('type')) list = list.filter(r => r.type === q.get('type'));
  if (q.get('name')) list = list.filter(r => r.name != null && casefold(r.name).includes(casefold(q.get('name'))));
  for (const key of ['sourceElementId', 'sourceRelationshipId', 'targetElementId', 'targetRelationshipId']) {
    if (q.has(key)) { const id = Number(q.get(key)); list = list.filter(r => r[key] === id); }
  }
  const wanted = ids(q.get('ids'));
  if (wanted) { const set = new Set(wanted); list = list.filter(r => set.has(r.id)); }
  const test = OfflineModel.propertyTest(m, q.get('property'), q.get('propertyValue'), q.get('propertyOp'));
  if (test) list = list.filter(test);
  if (q.get('sort') === 'ends') {
    const name = id => (id == null ? null : m.elements.get(id)?.name ?? null);
    list = [...list].sort(byKey(r => {
      const s = name(r.sourceElementId), t = name(r.targetElementId);
      return [s == null, casefold(s ?? ''), t == null, casefold(t ?? ''), r.id];
    }));
  }
  const out = page(list, p);
  if (csv(q.get('include')).includes('ends')) out.ends = ends(m, out.items);
  return out;
}

/** relationships.py _ends: summaries of what the relationships start and end on, recursively. */
function ends(m, rows) {
  const relIds = withAttached(m, rows.flatMap(r => [r.sourceRelationshipId, r.targetRelationshipId]).filter(x => x != null));
  const elementIds = new Set(rows.flatMap(r => [r.sourceElementId, r.targetElementId]).filter(x => x != null));
  for (const rid of relIds) { const r = m.relationships.get(rid); for (const e of [r.sourceElementId, r.targetElementId]) if (e != null) elementIds.add(e); }
  return {
    elements: sortedIds(elementIds).filter(id => m.elements.has(id)).map(id => elementSummary(m.elements.get(id))),
    relationships: relIds.map(id => relationshipSummary(m.relationships.get(id))),
  };
}

function withAttached(m, start) {
  const found = new Set(), todo = [...start];
  while (todo.length) {
    const rid = todo.pop();
    if (found.has(rid)) continue;
    const r = m.relationships.get(rid);
    if (!r) continue;
    found.add(rid);
    todo.push(...[r.sourceRelationshipId, r.targetRelationshipId].filter(x => x != null));
  }
  return sortedIds(found);
}

// ---------------------------------------------------------------------------------------- views (routers/v2/views.py, helpers.py)

function viewOr404(m, id) {
  const v = m.viewById.get(Number(id));
  if (!v) throw new HttpError(404, 'View not found.');
  return v;
}

function viewContent(m, x, q) {
  const v = viewOr404(m, x[2]);
  const c = m.content.get(v.id);
  const out = { view: v, nodes: c.nodes, connections: c.connections };
  if (!csv(q.get('include')).includes('concepts')) return out;
  const fields = q.get('fields') || 'summary';
  const nodes = m.viewNodes(v.id);
  const elementIds = sortedIds(nodes.flatMap(n => [n.elementRefId, n.conceptRefElementId]).filter(i => i != null));
  const relIds = sortedIds([...nodes.map(n => n.conceptRefRelationshipId), ...c.connections.map(cn => cn.relationshipRefId)].filter(i => i != null));
  out.elements = elementIds.map(id => m.elementPayload(id, fields)).filter(Boolean);
  out.relationships = relIds.map(id => m.relationshipPayload(id, fields)).filter(Boolean);
  return out;
}

function viewElements(m, x, q) {
  const v = viewOr404(m, x[2]);
  const p = paging(q);
  const shown = m.viewElements(v.id);
  const rows = [...shown.keys()].map(id => m.elements.get(id)).filter(Boolean).map(elementSummary).sort(byName);
  const out = page(rows, p);
  if (flag(q.get('positions'))) out.items = out.items.map(e => ({ ...e, position: shown.get(e.id) }));
  return out;
}

function usagePage(usages, p) {
  const ordered = [...usages.values()].sort(byKey(u => u.key)).map(u => u.usage);
  return { items: ordered.slice(p.offset, p.offset + p.limit), total: ordered.length, limit: p.limit, offset: p.offset };
}

function elementViews(m, x, q) {
  const id = Number(x[2]);
  if (!m.elements.has(id)) throw new HttpError(404, 'Element not found.');
  const p = paging(q);
  const usages = new Map();
  const nodes = m.nodes.filter(n => n.elementRefId === id || n.conceptRefElementId === id).sort(byKey(n => [n.sortOrder, n.id]));
  for (const n of nodes) {
    const v = m.viewById.get(n.viewId);
    if (!usages.has(v.id)) usages.set(v.id, { key: [v.sortOrder, v.id], usage: { view: viewSummary(v), nodeIds: [], labelNodeIds: [] } });
    (n.elementRefId === id ? usages.get(v.id).usage.nodeIds : usages.get(v.id).usage.labelNodeIds).push(n.id);
  }
  return usagePage(usages, p);
}

function relationshipViews(m, x, q) {
  const id = Number(x[2]);
  if (!m.relationships.has(id)) throw new HttpError(404, 'Relationship not found.');
  const p = paging(q);
  const usages = new Map();
  const usage = viewId => {
    const v = m.viewById.get(viewId);
    if (!usages.has(v.id)) usages.set(v.id, { key: [v.sortOrder, v.id], usage: { view: viewSummary(v), connectionIds: [], labelNodeIds: [] } });
    return usages.get(v.id).usage;
  };
  for (const c of m.connections.filter(cn => cn.relationshipRefId === id).sort(byKey(cn => [cn.sortOrder, cn.id]))) usage(c.viewId).connectionIds.push(c.id);
  for (const n of m.nodes.filter(nd => nd.conceptRefRelationshipId === id).sort(byKey(nd => [nd.sortOrder, nd.id]))) usage(n.viewId).labelNodeIds.push(n.id);
  return usagePage(usages, p);
}

/** views.py _links: every node and connection that links to a view. */
function allLinks(m) {
  return [
    ...m.nodes.filter(n => n.viewRefId != null).map(n => ({ kind: 0, via: n.id, from: n.viewId, to: n.viewRefId, label: n.label ?? null, elementRefId: n.elementRefId ?? null, sort: n.sortOrder })),
    ...m.connections.filter(c => c.viewRefId != null).map(c => ({ kind: 1, via: c.id, from: c.viewId, to: c.viewRefId, label: c.label ?? null, elementRefId: null, sort: c.sortOrder })),
  ];
}

const via = l => ({ viaNodeId: l.kind === 0 ? l.via : null, viaConnectionId: l.kind === 1 ? l.via : null, label: l.label });

function viewLinks(m, x) {
  const v = viewOr404(m, x[2]);
  const links = allLinks(m);
  const outgoing = links.filter(l => l.from === v.id && m.viewById.has(l.to)).sort(byKey(l => [l.kind, l.sort, l.via]))
    .map(l => ({ targetViewId: l.to, targetViewName: m.viewById.get(l.to).name, elementRefId: l.elementRefId, ...via(l) }));
  const incoming = links.filter(l => l.to === v.id && m.viewById.has(l.from))
    .sort(byKey(l => [m.viewById.get(l.from).sortOrder, l.from, l.kind, l.sort, l.via]))
    .map(l => ({ sourceViewId: l.from, sourceViewName: m.viewById.get(l.from).name, elementRefId: l.elementRefId, ...via(l) }));
  return { viewId: v.id, outgoing, incoming };
}

// ---------------------------------------------------------------------------------------- folders (organizations.py, helpers.py, services/folders.py)

/** folders.add_counts, in place. */
function addCounts(nodes) {
  const total = { elements: 0, relationships: 0, views: 0, folders: 0 };
  for (const n of nodes) {
    if (n.refElementId != null) total.elements += 1;
    else if (n.refRelationshipId != null) total.relationships += 1;
    else if (n.refViewId != null) total.views += 1;
    else {
      n.counts = addCounts(n.children || []);
      total.folders += 1;
      for (const [key, value] of Object.entries(n.counts)) total[key] += value;
    }
  }
  return total;
}

const foldersOf = nodes => nodes.filter(OfflineModel.isFolder).map(n => ({ ...n, children: foldersOf(n.children || []) }));

function organizations(m, _, q) {
  let content = structuredClone(m.snapshot.organizations);
  if (flag(q.get('counts'))) addCounts(content);
  if (flag(q.get('foldersOnly'))) content = foldersOf(content);
  return content;
}

function folderContents(m, x, q) {
  const folder = m.orgById.get(Number(x[2]));
  if (!folder) throw new HttpError(404, 'Organization not found.');
  if (!OfflineModel.isFolder(folder)) throw new HttpError(400, 'This organization item references an element, relationship or view; it is not a folder.');
  const p = paging(q);
  const recursive = q.has('recursive') ? flag(q.get('recursive')) : true;
  const order = q.get('order') || 'name';
  const wanted = csv(q.get('kinds'));
  const kinds = wanted.length ? wanted : ['elements', 'relationships', 'views'];
  const below = m.foldersBelow(folder.id, recursive);
  const maps = { elements: m.elements, relationships: m.relationships, views: m.viewById };
  const summary = { elements: elementSummary, relationships: relationshipSummary, views: viewSummary };
  const result = {};
  for (const kind of ['elements', 'relationships', 'views']) {
    if (!kinds.includes(kind)) continue;
    const ordered = m.filedInOrder(kind, below).filter(id => maps[kind].has(id));
    let rows, total;
    if (order === 'model') {
      rows = ordered.slice(p.offset, p.offset + p.limit).map(id => maps[kind].get(id));
      total = ordered.length;
    } else {
      const all = ordered.map(id => maps[kind].get(id)).sort(byName);
      rows = all.slice(p.offset, p.offset + p.limit);
      total = all.length;
    }
    result[kind] = { items: rows.map(summary[kind]), total, limit: p.limit, offset: p.offset };
  }
  return result;
}

function folderPath(m, x) {
  const kind = `${x[2]}s`, id = Number(x[3]);
  const map = { elements: m.elements, relationships: m.relationships, views: m.viewById }[kind];
  if (!map.has(id)) throw new HttpError(404, `${{ elements: 'Element', relationships: 'Relationship', views: 'View' }[kind]} not found.`);
  return m.folderPaths(kind, id)[0] || [];
}

// ---------------------------------------------------------------------------------------- properties

function propertyIndex(m, _, q) {
  const owner = q.get('owner') || 'element';
  const max = q.has('maxValues') ? Number(q.get('maxValues')) : 50;
  if (owner !== 'element') throw new HttpError(404, 'An offline copy has the property index of elements only.');
  return m.snapshot.propertyIndex.map(entry => ({ ...entry, values: entry.values.slice(0, max) }));
}

// ---------------------------------------------------------------------------------------- resolve (helpers.py)

function resolve(m, _, q, body) {
  const result = {};
  const identifiers = body.xmiIdentifiers || [];
  if (identifiers.length) {
    const wanted = [...new Set(identifiers)];
    const found = new Map();
    const kinds = [
      ['element', m.elementList], ['relationship', m.relationshipList],
      ['view', [...m.views].sort((a, b) => a.id - b.id)],
      ['folder', [...m.orgById.values()].filter(o => o.label != null).sort((a, b) => a.id - b.id)],
    ];
    for (const [kind, list] of kinds) {
      const rest = new Set(wanted.filter(x => !found.has(x)));
      for (const o of list) if (rest.has(o.xmiIdentifier) && !found.has(o.xmiIdentifier)) found.set(o.xmiIdentifier, { kind, id: o.id });
    }
    result.items = Object.fromEntries(wanted.filter(x => found.has(x)).map(x => [x, found.get(x)]));
    result.notFound = wanted.filter(x => !found.has(x));
  }
  if ((body.folderPaths || []).length) {
    const rows = [...m.orgById.values()].filter(o => o.label != null).sort(byKey(o => [o.sortOrder, o.id]));
    const children = new Map();
    for (const o of rows) {
      const key = `${m.orgParent.get(o.id) ?? ''}\u0000${o.label}`;
      if (!children.has(key)) children.set(key, o.id);
    }
    result.folderPaths = body.folderPaths.map(path => {
      let at = null;
      for (const label of path) {
        at = children.get(`${at ?? ''}\u0000${label}`) ?? null;
        if (at == null) break;
      }
      return at;
    });
  }
  return result;
}

// ---------------------------------------------------------------------------------------- search (routers/v2/search.py)

const WORD_SEPARATORS = [' ', '-', '_', '.', '(', '['];
const FIELDS = ['name', 'documentation', 'properties'];

function search(m, _, q) {
  const p = paging(q, SEARCH_PAGE_SIZE);
  const kindsWanted = csv(q.get('kinds'));
  const kinds = kindsWanted.length ? kindsWanted : ['elements', 'relationships'];
  const fieldsWanted = csv(q.get('in'));
  const fields = fieldsWanted.length ? fieldsWanted : ['name', 'documentation'];
  const property = q.get('property');
  const value = q.get('propertyValue'), op = q.get('propertyOp');
  if (value != null && property == null) throw new HttpError(422, 'propertyValue: needs `property`, the name of the property it is a value of.', 'VALIDATION_ERROR');
  if (op != null && property == null) throw new HttpError(422, 'propertyOp: needs `property`, the name of the property it compares.', 'VALIDATION_ERROR');
  const text = (q.get('q') || '').trim();
  const filters = { elements: [], relationships: [], views: [] };
  const elementTypes = csv(q.get('elementTypes')), relationshipTypes = csv(q.get('relationshipTypes')), layers = csv(q.get('layers'));
  if (elementTypes.length) { const s = new Set(elementTypes); filters.elements.push(e => s.has(e.type)); }
  if (layers.length) { const s = new Set(layers.flatMap(l => LAYER_TYPES[l] || [])); filters.elements.push(e => s.has(e.type)); }
  if (relationshipTypes.length) { const s = new Set(relationshipTypes); filters.relationships.push(r => s.has(r.type)); }
  if (property != null) for (const kind of Object.keys(filters)) filters[kind].push(OfflineModel.propertyTest(m, property, value, op));
  // API 3.20.0: several conditions, groups joined by OR, the conditions of a group by AND (search.py _property_groups)
  if (q.get('properties') != null) {
    if (property != null) throw new HttpError(422, 'properties: cannot be combined with `property`; put that condition into `properties`.', 'VALIDATION_ERROR');
    const groups = propertyGroups(q.get('properties'));
    const tests = groups.map(g => g.map(c => OfflineModel.propertyTest(m, c.name, c.value ?? null, c.op ?? null)));
    for (const kind of Object.keys(filters)) filters[kind].push(o => tests.some(g => g.every(test => test(o))));
  }
  const lists = { elements: m.elementList, relationships: m.relationshipList, views: m.views };
  const result = { query: q.get('q') || '' };
  for (const kind of ['elements', 'relationships', 'views']) {
    if (!kinds.includes(kind)) continue;
    if (!text && !filters[kind].length) { result[kind] = { items: [], total: 0, limit: p.limit, offset: p.offset }; continue; }
    result[kind] = searchKind(m, lists[kind], text, fields, filters[kind], property, p);
  }
  if (csv(q.get('include')).includes('degree') && result.elements) {
    result.elements.items = result.elements.items.map(e => ({ ...e, degree: m.degree(e.id) }));
  }
  return result;
}

/** The `properties` parameter of the search, checked as the API does (search.py _property_groups). */
function propertyGroups(raw) {
  const bad = message => new HttpError(422, `properties: ${message}`, 'VALIDATION_ERROR');
  let groups;
  try { groups = JSON.parse(raw); } catch { throw bad('must be JSON: a list of groups, each a list of conditions.'); }
  if (!Array.isArray(groups) || groups.length < 1 || groups.length > 10) throw bad('must be a list of 1 to 10 groups.');
  for (const g of groups) {
    if (!Array.isArray(g) || g.length < 1 || g.length > 10) throw bad('each group must be a list of 1 to 10 conditions.');
    for (const c of g) {
      if (!c || typeof c !== 'object' || Array.isArray(c) || typeof c.name !== 'string' || !c.name.trim()
        || Object.keys(c).some(k => !['name', 'op', 'value'].includes(k))) {
        throw bad('each condition must be an object with "name" and optionally "op" and "value".');
      }
      if (['op', 'value'].some(k => c[k] != null && typeof c[k] !== 'string')) throw bad('"op" and "value" must be text.');
    }
  }
  return groups;
}

function searchKind(m, list, text, fields, filters, propertyName, p) {
  const needle = casefold(text);
  let hits = list.filter(o => filters.every(f => f(o))).map(o => {
    if (!text) return { o, rank: 0, matched: [] };
    const name = o.name != null ? casefold(o.name) : null;
    const matched = [];
    let rank = 9;
    const better = r => { if (r < rank) rank = r; };
    if (fields.includes('name') && name != null && name.includes(needle)) {
      matched.push('name');
      if (name === needle) better(1);
      else if (name.startsWith(needle)) better(2);
      else if (WORD_SEPARATORS.some(sep => name.includes(sep + needle))) better(3);
      else better(4);
    }
    if (fields.includes('properties')) {
      const wanted = propertyName != null ? casefold(propertyName) : null;
      if (OfflineModel.props(o).some(pv => (wanted == null || casefold(m.definitionName(pv) ?? '') === wanted) && casefold(pv.value ?? '').includes(needle))) {
        matched.push('properties');
        better(5);
      }
    }
    if (fields.includes('documentation') && o.documentation != null && casefold(o.documentation).includes(needle)) {
      matched.push('documentation');
      better(6);
    }
    return matched.length ? { o, rank, matched } : null;
  }).filter(Boolean);
  hits = hits.sort(byKey(h => [h.rank, h.o.name == null, casefold(h.o.name ?? ''), h.o.id]));
  const items = hits.slice(p.offset, p.offset + p.limit).map(h => ({
    ...structuredClone(h.o), match: { fields: text ? FIELDS.filter(f => h.matched.includes(f)) : [], rank: h.rank },
  }));
  return { items, total: hits.length, limit: p.limit, offset: p.offset };
}

export { MAX_GRAPH_ELEMENTS };
