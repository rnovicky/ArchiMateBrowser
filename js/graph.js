// The model's graph rules, asked of the API (PLAN.md, phase 3):
//
//   neighbourhood()     HLP-1  POST …/graph/neighbourhood
//   subgraph()          HLP-2  POST …/graph/subgraph
//   impact()            HLP-3  POST …/graph/impact (also as CSV)
//   paths()             HLP-4  GET  …/graph/paths
//   expansionCounts()   HLP-5  POST …/graph/expansion-counts
//
// The API decides what is related to what: junctions passed through,
// relationship ends resolved, filters, nesting. This module turns the
// app's own terms (a DiagramFilter, PropertyOptions, the nesting setting)
// into requests, and the answers into what the app draws: ids, the
// relationship objects, a nesting forest. The elements and relationships of
// every answer are kept in the store's cache (UP-3), complete, so that what is
// drawn can be looked up. (Until 2.8.0 the browser could also compute every
// answer itself and compare, UP-5; that code went in phase 4.)

import { api } from './api.js';
import { settings } from './config.js';
import { ELEMENT_TYPES, RELATIONSHIP_TYPES, LAYERS } from './archimate.js';
import { FILTER_OPS } from './properties.js';
import { NESTING_TYPES } from './nesting.js';
import { CSV_DELIMITER } from './csv.js';

// ---------------------------------------------------------------- the app's terms as request properties

/**
 * A DiagramFilter and PropertyOptions as the filter properties of a request:
 * { elementTypes, relationshipTypes, property }, each only when it restricts.
 */
export function filterParams(filter, props) {
  const out = {};
  if (filter && filter.elementTypes.size < ELEMENT_TYPES.length) out.elementTypes = [...filter.elementTypes];
  if (filter && filter.relTypes.size < RELATIONSHIP_TYPES.length) out.relationshipTypes = [...filter.relTypes];
  // 2.17.0 (API 3.13.0): relationships by their type and the types of their ends
  if (filter?.hidden?.length) {
    out.hideRelationships = filter.hidden.map(r => ({
      ...(r.type ? { type: r.type } : {}), ...(r.source ? { sourceType: r.source } : {}), ...(r.target ? { targetType: r.target } : {}),
    }));
  }
  if (props?.hasFilter()) {
    const op = FILTER_OPS[props.filterOp] || FILTER_OPS.has;
    out.property = { name: props.filterName, op: op.api, ...(op.needsValue ? { value: props.filterValue } : {}) };
  }
  return out;
}

/** Element types that contain others with "only inside a Grouping" (API 2.9.0). */
export const GROUPING_CONTAINERS = ['Grouping'];

/** The nesting setting (LV-5) as the `nesting` of a request, or undefined when nesting is off. */
export function nestingParam() {
  if (!settings.nestGenerated) return undefined;
  return {
    types: settings.nestAssignment ? [...NESTING_TYPES] : NESTING_TYPES.slice(0, 2),
    ...(settings.nestGroupingOnly ? { containerTypes: GROUPING_CONTAINERS } : {}),
  };
}

/** The API's name of a layer, from this app's key ('implementation' -> 'ImplementationMigration'). */
export const apiLayer = key => LAYERS.find(l => l.key === key)?.api;

/** The `nesting` of an answer as the forest the layout and PlantUML generators use (see nesting.js), or null. */
function toNesting(n) {
  if (!n) return null;
  return {
    parentOf: new Map(Object.entries(n.parentOf).map(([child, parent]) => [Number(child), parent])),
    nestedRelIds: new Set(n.nestedRelationshipIds),
    ancestorEdgeIds: new Set(n.hiddenRelationshipIds),
  };
}

/** Answers that list elements and relationships give them complete (properties for labels and colours). */
const COMPLETE = { fields: 'full' };

/** Keep the elements and relationships of an answer; its relationships, as cached. */
function kept(store, res) {
  store.remember({ elements: res.elements || [], relationships: res.relationships || [] });
  return (res.relationships || []).map(r => store.relationship(r.id));
}

// ---------------------------------------------------------------- HLP-1: neighbourhood

/**
 * The elements within `depth` hops of `seeds` and the relationships to draw between them.
 * @returns {{ ids: Set<number>, relationships: object[], nesting: object|null,
 *             filtered: { elements, relationships }, truncated: boolean }}
 *   ids in the API's order (by distance, then id); `filtered`: what the filters left out.
 */
export async function neighbourhood(store, { seeds, depth = 1, direction = 'both', filter = null, props = null, nesting = true }, { signal } = {}) {
  const request = {
    seeds: [...seeds], depth, direction, ...filterParams(filter, props), ...COMPLETE,
    include: ['filtered', 'degree'], ...(nesting && nestingParam() ? { nesting: nestingParam() } : {}),
  };
  const res = await api.graph.neighbourhood(store.id, request, { signal });
  const out = {
    ids: new Set(res.elements.map(e => e.id)), relationships: kept(store, res),
    nesting: toNesting(res.nesting), filtered: res.filtered, truncated: res.truncated,
  };
  return out;
}

// ---------------------------------------------------------------- HLP-2: subgraph of a set

/**
 * The elements of a set and the relationships to draw between them.
 * @param set  exactly one of { elementIds }, { folderId }, { elementType }, { layer } (this app's key),
 *             { viewId }, { relationshipType }, { onRelationships: true }, { allElements: true } (API 3.20.0)
 * @param o    filter, props: narrow the set and the relationships; exclude: relationship ids to leave out;
 *             nesting: false to get none whatever the setting says
 * @returns {{ ids: Set<number>, relationships: object[], nesting: object|null,
 *             filtered: { elements, relationships }, truncated: boolean }}
 */
export async function subgraph(store, set, { filter = null, props = null, exclude = [], nesting = true } = {}, { signal } = {}) {
  const named = set.layer != null ? { layer: apiLayer(set.layer) } : set.elementIds ? { elementIds: [...set.elementIds] } : set;
  const request = {
    ...named, ...filterParams(filter, props), ...COMPLETE, include: ['filtered', 'degree'],
    ...(exclude.length ? { excludeRelationshipIds: [...exclude] } : {}),
    ...(nesting && nestingParam() ? { nesting: nestingParam() } : {}),
  };
  const res = await api.graph.subgraph(store.id, request, { signal });
  const out = {
    ids: new Set(res.elements.map(e => e.id)), relationships: kept(store, res),
    nesting: toNesting(res.nesting), filtered: res.filtered, truncated: res.truncated,
  };
  return out;
}

// ---------------------------------------------------------------- HLP-3: impact and dependency analysis

/**
 * What a change of `starts` affects (direction 'impact') or what they need ('dependencies').
 * @param o  direction, types (relationship types followed), maxDepth;
 *           draw: also return the relationships to draw and, if the setting says so, the nesting
 * @returns {{ starts: number[], results: Map<number, {id, level, via, from}>, maxLevel: number, truncated: boolean,
 *             relationships?: object[], nesting?: object|null }}
 *   via = relationship followed to reach the element, from = element it was reached from.
 *   The elements reached and the relationships walked along are cached when it resolves.
 */
export async function impact(store, starts, { direction = 'impact', types, maxDepth = 5, draw = false } = {}, { signal } = {}) {
  const request = {
    start: [...starts], direction, relationshipTypes: [...types], maxDepth, ...COMPLETE,
    ...(draw ? { include: ['relationships'] } : {}), ...(draw && nestingParam() ? { nesting: nestingParam() } : {}),
  };
  const res = await api.graph.impact(store.id, request, { signal });
  // the answer names what it reached by id
  await store.ensure({ elements: [...res.start, ...res.results.map(r => r.elementId)], relationships: res.relationshipIds || [] }, { signal });
  const out = {
    starts: res.start, maxLevel: res.maxLevel, truncated: res.truncated,
    results: new Map(res.results.map(r => [r.elementId, { id: r.elementId, level: r.level, via: r.viaRelationshipId, from: r.fromElementId }])),
  };
  if (draw) Object.assign(out, { relationships: kept(store, res), nesting: toNesting(res.nesting) });
  return out;
}

/**
 * The impact analysis as the API's CSV file (text): one row per element reached, by level, then
 * name; separated by the browser's semicolon (API 3.2.0; an older API ignores it and uses commas).
 */
export function impactCsv(store, starts, { direction = 'impact', types, maxDepth = 5 } = {}, { signal } = {}) {
  return api.graph.impactCsv(store.id, {
    start: [...starts], direction, relationshipTypes: [...types], maxDepth, csvDelimiter: CSV_DELIMITER,
  }, { signal });
}

// ---------------------------------------------------------------- HLP-5: what an explorer can still show

/**
 * For each of `ids`: the related elements, one hop away, that are not in `visible`.
 * @returns {Map<number, { total, out, in, byType: [{ type, direction, count }] }>}
 *   total counts in `direction`; out and in are always given.
 */
export async function expansionCounts(store, ids, visible, { direction = 'both', filter = null, props = null } = {}, { signal } = {}) {
  if (![...ids].length) return new Map();
  const request = { elementIds: [...ids], visibleIds: [...visible], direction, ...filterParams(filter, props) };
  const res = await api.graph.expansionCounts(store.id, request, { signal });
  const out = new Map(Object.entries(res.counts).map(([id, c]) => [Number(id), c]));
  return out;
}

/**
 * The related elements of `id`, one hop away, that are not in `visible`: what expanding it adds.
 * `type` restricts the step to one relationship type.
 * @returns {Set<number>}
 */
export async function hiddenNeighbours(store, id, visible, { direction = 'both', type = null, filter = null, props = null } = {}, { signal } = {}) {
  const params = filterParams(filter, props);
  if (type) params.relationshipTypes = !filter || filter.relTypes.has(type) ? [type] : [];
  const request = { seeds: [id], depth: 1, direction, ...params, ...COMPLETE, include: ['degree'] };
  const res = await api.graph.neighbourhood(store.id, request, { signal });
  kept(store, res);
  const shown = new Set(visible);
  const found = new Set(res.elements.map(e => e.id).filter(x => x !== id && !shown.has(x)));
  return found;
}

// ---------------------------------------------------------------- HLP-4: paths between two elements

/**
 * Up to `k` shortest paths from one element to another, ignoring the direction of relationships.
 * @returns {{ paths: [{ length, elements: number[], relationships: number[] }], truncated: boolean }}
 *   elements in the order of the path, from `from` to `to`; they and the relationships are cached when it resolves.
 */
export async function paths(store, from, to, { k = 3, maxLength = 6 } = {}, { signal } = {}) {
  const res = await api.graph.paths(store.id, { from, to, k, maxLength }, { signal });
  const steps = res.paths.flatMap(p => p.steps);
  await store.ensure({
    elements: steps.map(st => st.elementId).filter(x => x != null),
    relationships: steps.map(st => st.relationshipId).filter(x => x != null),
  }, { signal });
  return {
    truncated: res.truncated,
    paths: res.paths.map(p => ({
      length: p.length,
      elements: p.steps.filter(st => st.elementId != null).map(st => st.elementId),
      relationships: p.steps.filter(st => st.relationshipId != null).map(st => st.relationshipId),
    })),
  };
}
