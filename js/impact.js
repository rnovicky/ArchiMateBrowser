// Impact / dependency analysis (BR-12): the API computes it (POST …/graph/impact,
// js/graph.js); this module holds the semantics the panel shows and the links
// encode: how a change propagates along each relationship type, the default
// types, the directions, and the path to a reached element.

import { RELATIONSHIP_TYPES } from './archimate.js';
import { t as tr } from './i18n.js';

/**
 * Direction in which a *change* propagates along each relationship type:
 *   'out' — a change of the source affects the target (the target depends on the source)
 *   'in'  — a change of the target affects the source (the source depends on the target)
 *   'both'
 * Serving/Realization/Assignment/Flow/Triggering/Influence: the target depends on the source
 * (it is served, realised, performed, fed or triggered by it).
 * Composition/Aggregation: the whole (source) depends on its parts (target).
 * Access: the behaviour (source) depends on the data it accesses (target).
 * Specialization: the specialised concept (source) depends on its generalisation (target).
 * Association: undirected.
 */
export const PROPAGATION = {
  Serving: 'out', Realization: 'out', Assignment: 'out', Flow: 'out', Triggering: 'out', Influence: 'out',
  Composition: 'in', Aggregation: 'in', Access: 'in', Specialization: 'in',
  Association: 'both',
};

/** Relationship types followed by default (structural/behavioural dependencies). */
export const DEFAULT_TYPES = ['Serving', 'Realization', 'Assignment', 'Composition', 'Aggregation', 'Access', 'Flow', 'Triggering'];

export const DIRECTIONS = {
  impact: { label: tr('Impact (what depends on it)'), short: tr('Impact of') },
  dependencies: { label: tr('Dependencies (what it needs)'), short: tr('Dependencies of') },
};

/** The path start → … → id as a list of {element, relationship} steps. */
export function pathTo(analysis, id) {
  const steps = [];
  for (let cur = analysis.results.get(id); cur; cur = analysis.results.get(cur.from)) {
    steps.unshift(cur);
  }
  return steps;
}

/** URL encoding of the non-default parts: types as initials-free full names. */
export function encodeTypes(types) {
  const same = types.length === DEFAULT_TYPES.length && DEFAULT_TYPES.every(t => types.includes(t));
  return same ? '' : types.filter(t => RELATIONSHIP_TYPES.includes(t)).join('.');
}

export function decodeTypes(str) {
  if (!str) return [...DEFAULT_TYPES];
  return str.split('.').filter(t => RELATIONSHIP_TYPES.includes(t));
}
