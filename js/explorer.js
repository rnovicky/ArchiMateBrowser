// Interactive graph explorer (ALT-1): a generated diagram grows step by step.
// Expanding an element adds its related elements that are not shown yet; the
// existing arrangement is kept by feeding the current positions to ELK's
// interactive strategies (the LV-6 "Tidy" mechanism), with the new elements
// hinted next to the element they were expanded from.
//
// Diagram definition: { kind: 'explore', seeds, ids }  ->  ex~<seeds>~<ids>

import { nodeSize } from './elklayout.js';

/** Relationship types laid out against their arrow (same as elklayout.js REVERSED). */
const REVERSED = new Set(['Serving', 'Realization', 'Specialization']);

/**
 * Collapse (CM-13): which elements fold away when the relationships of `at` are collapsed,
 * except the way towards `toward` (the selected element). The diagram's elements `ids` and
 * relationships `edges` ([a, b] element ids) form a graph that need not be a tree, so: the
 * relationships of `at` are cut, except those to its neighbours on a shortest path to
 * `toward`; then whatever was connected to `at` and is now no longer connected to `toward`
 * folds away. With `toward` equal to `at`, missing or not in the diagram, everything
 * connected to `at` folds away. `at` itself always stays, and so does `toward`.
 * @returns {Set<number>} the element ids to remove
 */
export function collapseAround({ ids, edges, at, toward = null }) {
  const adj = new Map([...ids].map(i => [i, new Set()]));
  for (const [a, b] of edges) {
    if (a !== b && adj.has(a) && adj.has(b)) { adj.get(a).add(b); adj.get(b).add(a); }
  }
  if (!adj.has(at)) return new Set();
  const reach = from => {
    const seen = new Set([from]);
    for (const queue = [from]; queue.length;) for (const n of adj.get(queue.shift())) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    return seen;
  };
  const before = reach(at);
  const root = toward != null && toward !== at && adj.has(toward) ? toward : at;
  // the neighbours of `at` one step closer to `root`: the way that stays
  const way = new Set();
  if (root !== at && before.has(root)) {
    const dist = new Map([[root, 0]]);
    for (const queue = [root]; queue.length;) {
      const x = queue.shift();
      for (const n of adj.get(x)) if (!dist.has(n)) { dist.set(n, dist.get(x) + 1); queue.push(n); }
    }
    for (const n of adj.get(at)) if (dist.get(n) === dist.get(at) - 1) way.add(n);
  }
  for (const n of [...adj.get(at)]) if (!way.has(n)) { adj.get(at).delete(n); adj.get(n).delete(at); }
  const stays = reach(root);
  stays.add(at);
  return new Set([...before].filter(x => !stays.has(x)));
}

/**
 * Position hints for the next layout: every current node where it is now,
 * new elements in a row next to `fromId` — after it in layout direction when
 * the relationship leads "down" the layered order, before it otherwise.
 * @param store         the model's cache: the sizes of the elements
 * @param relationships the relationships of the new diagram: which side of `fromId` a new element goes
 * @param positions     Map node id -> {x, y} of the current layout
 * @param from          the expanded node {x, y, w, h}
 * @param parentOf      nesting of the new diagram (Map child id -> parent id), if nesting is on
 */
export function hintsForExpansion({ store, relationships = [], positions, fromId, from, newIds, direction = 'TB', parentOf = null }) {
  const hints = rowHints({ store, relationships, positions, fromId, from, newIds, direction });
  if (!parentOf?.size) return hints;
  // Nesting (LV-5) may change with the new elements:
  const fresh = new Set(newIds);
  const shownKids = p => [...parentOf].filter(([c, q]) => q === p && !fresh.has(c) && positions.has(`e${c}`)).map(([c]) => c);
  for (const id of newIds) {
    // a new container wraps the shown elements it now contains, so they stay where they are
    const kids = shownKids(id).map(c => positions.get(`e${c}`));
    if (kids.length) hints.set(`e${id}`, { x: Math.min(...kids.map(p => p.x)) - 12, y: Math.min(...kids.map(p => p.y)) - 30 });
  }
  const placed = new Map(); // container -> next free y inside it
  for (const id of newIds) {
    // a new element nested in a shown container goes inside it, below what is there
    const p = parentOf.get(id);
    if (p == null || fresh.has(p) || !positions.has(`e${p}`)) continue;
    const box = positions.get(`e${p}`);
    if (!placed.has(p)) {
      const sib = shownKids(p);
      placed.set(p, sib.length
        ? Math.max(...sib.map(c => positions.get(`e${c}`).y + nodeSize(store.element(c)).h)) + 30
        : box.y + 40);
    }
    hints.set(`e${id}`, { x: box.x + 12, y: placed.get(p) });
    placed.set(p, placed.get(p) + nodeSize(store.element(id)).h + 30);
  }
  return hints;
}

function rowHints({ store, relationships, positions, fromId, from, newIds, direction }) {
  const hints = new Map(positions);
  if (!from) return hints;
  const lr = direction === 'LR';
  const outgoing = relationships.filter(r => r.sourceElementId === fromId), incoming = relationships.filter(r => r.targetElementId === fromId);
  // does the relationship to `other` place it after `fromId` in the layered order?
  const after = other => {
    for (const r of outgoing) if (r.targetElementId === other) return !REVERSED.has(r.type);
    for (const r of incoming) if (r.sourceElementId === other) return REVERSED.has(r.type);
    return true; // via a junction or a relationship end: default downstream
  };
  const groups = { after: [], before: [] };
  for (const id of newIds) groups[after(id) ? 'after' : 'before'].push(id);
  const gap = 90, spread = 30, rowGap = 40;
  // rows of at most ~√n elements (like the Coffman-Graham bound of automatic layouts):
  // the interactive layering keeps hinted rows, so one long row would stay one long row
  const perRow = Math.max(6, Math.ceil(Math.sqrt(positions.size + newIds.length) * 1.1));
  for (const [side, ids] of Object.entries(groups)) {
    for (let r = 0; r * perRow < ids.length; r++) {
      const row = ids.slice(r * perRow, (r + 1) * perRow);
      const sizes = row.map(id => nodeSize(store.element(id)));
      const deep = Math.max(...sizes.map(z => (lr ? z.w : z.h)));
      // the row runs across the layout direction, centred on the expanded node
      const total = sizes.reduce((s, z) => s + (lr ? z.h : z.w) + spread, -spread);
      let pos = (lr ? from.y + from.h / 2 : from.x + from.w / 2) - total / 2;
      const offset = gap + r * (deep + rowGap); // further rows further away
      row.forEach((id, i) => {
        const z = sizes[i];
        const depth = side === 'after'
          ? (lr ? from.x + from.w : from.y + from.h) + offset
          : (lr ? from.x - z.w : from.y - z.h) - offset;
        hints.set(`e${id}`, lr ? { x: Math.round(depth), y: Math.round(pos) } : { x: Math.round(pos), y: Math.round(depth) });
        pos += (lr ? z.h : z.w) + spread;
      });
    }
  }
  return hints;
}

/** Up to this many related elements are shown right away when exploring starts from one element. */
export const START_NEIGHBOURS = 12;
