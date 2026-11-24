// Automatic layout of generated diagrams (neighbourhood, basket, type, folder,
// impact) in the browser with ELK — the Eclipse Layout Kernel (ALT-2).
// The result is drawn by viewsvg.js, like stored views, so nothing is sent to
// a server. ELK runs in a Web Worker (vendor/elk/elk-worker.min.js).

import { wrap } from './viewsvg.js';
import { t as tr } from './i18n.js';

let elk = null;

function engine() {
  if (!elk) {
    if (!window.ELK) throw new Error(tr('The ELK layout library is not loaded (vendor/elk/elk-api.js).'));
    // relative to this module, so pages in other folders (tests/) find the worker too; an offline copy
    // carries it (2.20.0, js/offline/package.js)
    const workerUrl = globalThis.ARCHIXMI_OFFLINE?.elkWorkerUrl ?? new URL('../vendor/elk/elk-worker.min.js', import.meta.url).href;
    elk = new window.ELK({ workerUrl });
  }
  return elk;
}

/**
 * Relationship types laid out against their arrow direction, so the common
 * ArchiMate reading order appears: what is served/realised sits above (or
 * left of) its provider, the general concept above the specialised one.
 * Drawn arrows still point source → target.
 */
const REVERSED = new Set(['Serving', 'Realization', 'Specialization']);

/** Node box size from the label (same wrapping as the renderer). */
export function nodeSize(el, { extraLabel = false } = {}) {
  if (/Junction$/.test(el.type)) return { w: 14, h: 14 };
  const name = el.name || '';
  const longest = Math.max(0, ...name.split(/\s+/).map(w => w.length));
  const w = Math.min(220, Math.max(120, Math.ceil(longest * 6.4) + 24));
  const lines = wrap(name, Math.max(4, Math.floor((w - 12) / 6.2))).length || 1;
  const h = Math.max(55, lines * 13 + 28) + (extraLabel ? 12 : 0);
  return { w, h };
}

/** Above this many nodes the width-bounded layering is too slow; ELK's default layering is used. */
const BOUNDED_LAYERING_MAX = 150;
/** Above this many nodes (per component) network-simplex node placement is replaced by linear segments. */
const NETWORK_SIMPLEX_MAX = 100;

/** Spacing options (px at spacing factor 1), scaled by the Layout panel's spacing (LV-6). */
const SPACING = {
  'elk.layered.spacing.nodeNodeBetweenLayers': 60,
  'elk.spacing.nodeNode': 30,
  'elk.spacing.edgeNode': 16,
  'elk.spacing.edgeEdge': 10,
  'elk.layered.spacing.edgeEdgeBetweenLayers': 12,
  'elk.layered.spacing.edgeNodeBetweenLayers': 16,
  'elk.spacing.componentComponent': 50,
};

/** Options that every (sub)graph needs: ELK does not inherit them into compound nodes. */
function localOptions(prefs) {
  const o = { 'elk.edgeRouting': prefs?.routing || 'ORTHOGONAL' };
  const f = prefs?.spacing || 1;
  for (const [k, v] of Object.entries(SPACING)) o[k] = String(Math.max(4, Math.round(v * f)));
  return o;
}

const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  // Neighbourhoods are often stars (one element with dozens of neighbours). Plain
  // layering puts all neighbours into one very wide layer (ERP Core: 4571×1157 px);
  // Coffman-Graham with a layer-width bound (set per graph below) spreads them over
  // several layers (2423×1516 px), and network-simplex placement keeps edges straight.
  'elk.layered.layering.strategy': 'COFFMAN_GRAHAM',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.edgeLabels.inline': 'false',
  'elk.separateConnectedComponents': 'true',
  'elk.aspectRatio': '1.6',
};

/**
 * Manual layout (LV-6, "Tidy"): ELK's interactive strategies keep the layer
 * and the order within layers that the given node positions imply, so an
 * element dragged into another row/column stays there and the rest is
 * re-arranged around it.
 */
const INTERACTIVE_OPTIONS = {
  'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
  'elk.layered.layering.strategy': 'INTERACTIVE',
  'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
  'elk.layered.considerModelOrder.strategy': 'NONE',
};

// ---------------------------------------------------------------- transposed layout
// ELK bug (elkjs 0.12.0): with the interactive strategies, nesting and a
// vertical direction, compound nodes come back with width and height swapped
// (a 144×94 container as 120×144), so children stick out of their box and
// neighbours overlap it. Left-to-right is correct, and a top-to-bottom layered
// layout is the transpose of a left-to-right one, so such graphs are laid out
// transposed and transposed back.

const SIDE_T = { NORTH: 'WEST', WEST: 'NORTH', SOUTH: 'EAST', EAST: 'SOUTH' };

/** Mirror a graph at the diagonal: x↔y, width↔height, plus the options that depend on the axes. */
function transpose(g) {
  const pt = p => (p ? { ...p, x: p.y, y: p.x } : p);
  const box = o => {
    const t = { ...o };
    if ('x' in o || 'y' in o) { t.x = o.y; t.y = o.x; }
    if ('width' in o || 'height' in o) { t.width = o.height; t.height = o.width; }
    return t;
  };
  const opts = lo => {
    if (!lo) return lo;
    const o = { ...lo };
    if (o['elk.direction']) o['elk.direction'] = { DOWN: 'RIGHT', RIGHT: 'DOWN', UP: 'LEFT', LEFT: 'UP' }[o['elk.direction']] || o['elk.direction'];
    if (o['elk.padding']) {
      const v = k => new RegExp(`${k}=(\\d+)`).exec(o['elk.padding'])?.[1] ?? 0;
      o['elk.padding'] = `[top=${v('left')},left=${v('top')},bottom=${v('right')},right=${v('bottom')}]`;
    }
    if (o['elk.nodeSize.minimum']) o['elk.nodeSize.minimum'] = o['elk.nodeSize.minimum'].replace(/\(([\d.]+),([\d.]+)\)/, '($2,$1)');
    if (o['elk.port.side']) o['elk.port.side'] = SIDE_T[o['elk.port.side']] || o['elk.port.side'];
    return o;
  };
  const edge = e => ({
    ...e,
    labels: (e.labels || []).map(box),
    sections: e.sections?.map(s => ({ ...s, startPoint: pt(s.startPoint), endPoint: pt(s.endPoint), bendPoints: s.bendPoints?.map(pt) })),
    junctionPoints: e.junctionPoints?.map(pt),
  });
  const node = n => ({
    ...box(n),
    layoutOptions: opts(n.layoutOptions),
    ports: n.ports?.map(p => ({ ...box(p), layoutOptions: opts(p.layoutOptions) })),
    children: n.children?.map(node),
    edges: n.edges?.map(edge),
  });
  return node(g);
}

const hasCompound = g => (g.children || []).some(c => c.children?.length);

/**
 * ELK occasionally rejects option combinations on particular graphs. Retry
 * without hub ports, then with Brandes-Köpf placement, before giving up.
 * Vertical interactive layouts with nesting run transposed (see above).
 */
async function layoutWithFallback(graph) {
  const lo = graph.layoutOptions || {};
  if (lo['elk.layered.layering.strategy'] === 'INTERACTIVE' && ['DOWN', 'UP'].includes(lo['elk.direction']) && hasCompound(graph)) {
    return transpose(await layoutWithFallbackAsIs(transpose(graph)));
  }
  return layoutWithFallbackAsIs(graph);
}

async function layoutWithFallbackAsIs(graph) {
  try {
    return await engine().layout(structuredClone(graph));
  } catch (first) {
    console.warn('ELK layout failed, retrying without hub ports:', first?.message || first);
    const noPorts = structuredClone(graph);
    const strip = n => { delete n.ports; if (n.layoutOptions) delete n.layoutOptions['elk.portConstraints']; (n.children || []).forEach(strip); };
    strip(noPorts);
    noPorts.edges.forEach(e => { e.sources = e.sources.map(s => s.split('~')[0]); e.targets = e.targets.map(t => t.split('~')[0]); });
    try {
      return await engine().layout(structuredClone(noPorts));
    } catch {
      noPorts.layoutOptions['elk.layered.nodePlacement.strategy'] = 'BRANDES_KOEPF';
      return engine().layout(noPorts);
    }
  }
}

/** Root layout options for a graph (or component) with `count` top-level nodes. */
function graphOptions(count, { elkDir, nested, prefs, interactive }) {
  const o = {
    ...LAYOUT_OPTIONS,
    ...localOptions(prefs),
    'elk.direction': elkDir,
    'elk.layered.thoroughness': String(prefs?.thoroughness || 7),
    // absolute coordinates for nested nodes, edges and labels
    'elk.json.shapeCoords': 'ROOT',
    'elk.json.edgeCoords': 'ROOT',
    ...(nested ? { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' } : {}),
    ...(count <= BOUNDED_LAYERING_MAX
      // at most ~√n real nodes per layer → roughly the 1.6 aspect ratio
      ? {
        'elk.layered.layering.coffmanGraham.layerBound': String(Math.max(6, Math.ceil(Math.sqrt(count) * 1.1))),
        // network-simplex placement is the most compact but slow with hub ports on bigger graphs
        // (110 nodes: 6.6 s vs 1.1 s for linear segments, 3066 vs 4406 px wide)
        ...(count > NETWORK_SIMPLEX_MAX ? { 'elk.layered.nodePlacement.strategy': 'LINEAR_SEGMENTS' } : {}),
      }
      // large components: Coffman-Graham gets slow (543 elements: > 45 s vs 1.2 s), use ELK's defaults
      : { 'elk.layered.layering.strategy': 'NETWORK_SIMPLEX', 'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF' }),
  };
  // explicit choices in the Layout panel win over the size-dependent defaults
  if (prefs?.layering && prefs.layering !== 'auto') o['elk.layered.layering.strategy'] = prefs.layering;
  if (prefs?.placement && prefs.placement !== 'auto') o['elk.layered.nodePlacement.strategy'] = prefs.placement;
  if (interactive) {
    Object.assign(o, INTERACTIVE_OPTIONS);
    // ELK fails on nested graphs with interactive crossing minimisation + network-simplex placement
    // ("NEdge must have a source and target NNode")
    if (nested && o['elk.layered.nodePlacement.strategy'] === 'NETWORK_SIMPLEX') o['elk.layered.nodePlacement.strategy'] = 'BRANDES_KOEPF';
  }
  return o;
}

const COMPONENT_GAP = 50;
const TARGET_RATIO = 1.6;

/**
 * Lay out each connected component on its own and pack the results into rows.
 * ELK's own component packing is disabled with hierarchical layout (nesting),
 * and even without it a large folder came out 12873×3602 px (33050×4523 px nested);
 * with packing the drawing approaches the 1.6 target ratio. Isolated nodes
 * without edges or children skip ELK entirely.
 * Returns an ELK-shaped result {children, edges} in absolute coordinates.
 */
async function layoutComponents(rootChildren, edges, opts) {
  // top-level unit of every node / port id (nested nodes belong to their top-level ancestor)
  const unitOf = new Map();
  const mark = (n, unit) => {
    unitOf.set(n.id, unit);
    for (const p of n.ports || []) unitOf.set(p.id, unit);
    (n.children || []).forEach(c => mark(c, unit));
  };
  rootChildren.forEach(n => mark(n, n.id));

  // union-find over top-level units
  const up = new Map(rootChildren.map(n => [n.id, n.id]));
  const find = x => { while (up.get(x) !== x) { up.set(x, up.get(up.get(x))); x = up.get(x); } return x; };
  for (const e of edges) {
    const a = find(unitOf.get(e.sources[0])), b = find(unitOf.get(e.targets[0]));
    if (a !== b) up.set(a, b);
  }
  const groups = new Map();
  for (const n of rootChildren) {
    const k = find(n.id);
    if (!groups.has(k)) groups.set(k, { nodes: [], edges: [] });
    groups.get(k).nodes.push(n);
  }
  for (const e of edges) groups.get(find(unitOf.get(e.sources[0]))).edges.push(e);

  if (groups.size === 1) {
    const g = [...groups.values()][0];
    return layoutWithFallback({ id: 'root', layoutOptions: graphOptions(g.nodes.length, opts), children: g.nodes, edges: g.edges });
  }

  // lay out every non-trivial component (sequentially: one worker)
  const boxes = [];
  for (const g of groups.values()) {
    const single = g.nodes.length === 1 && !g.edges.length && !g.nodes[0].children?.length;
    if (single) {
      const n = g.nodes[0];
      boxes.push({ w: n.width, h: n.height, children: [{ ...n, x: 0, y: 0 }], edges: [] });
      continue;
    }
    const r = await layoutWithFallback({ id: 'root', layoutOptions: graphOptions(g.nodes.length, opts), children: g.nodes, edges: g.edges });
    r.edges = collectEdges(r); // all edges at the top, once
    // normalise to the component's own bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of r.children || []) { minX = Math.min(minX, c.x); minY = Math.min(minY, c.y); maxX = Math.max(maxX, c.x + c.width); maxY = Math.max(maxY, c.y + c.height); }
    for (const e of r.edges || []) for (const s of e.sections || []) for (const p of [s.startPoint, s.endPoint, ...(s.bendPoints || [])]) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    shift(r, -minX, -minY);
    boxes.push({ w: maxX - minX, h: maxY - minY, children: r.children || [], edges: r.edges });
  }

  const gap = Math.round(COMPONENT_GAP * (opts.prefs?.spacing || 1));
  const out = { children: [], edges: [] };
  const place = (b, x, y) => {
    const part = { children: b.children, edges: b.edges };
    shift(part, x, y);
    out.children.push(...part.children);
    out.edges.push(...part.edges);
  };

  if (opts.hints?.size) {
    // manual layout: each component goes where its elements were, pushed down if it would overlap
    const hinted = boxes.map(b => {
      const hs = b.children.map(c => opts.hints.get(c.id)).filter(Boolean);
      return { b, x: hs.length ? Math.min(...hs.map(p => p.x)) : null, y: hs.length ? Math.min(...hs.map(p => p.y)) : null };
    });
    let bottom = Math.max(0, ...hinted.filter(t => t.y != null).map(t => t.y + t.b.h));
    for (const t of hinted.filter(t => t.y == null)) { t.x = 0; t.y = bottom + gap; bottom = t.y + t.b.h; }
    // top to bottom: a part that would overlap one placed before moves down below it, so
    // parts hinted above the rest (e.g. elements dropped above the diagram) stay above it
    // and the rest makes room
    hinted.sort((p, q) => p.y - q.y || p.x - q.x);
    const placed = [];
    // only real overlaps (plus a small margin) count: hinted elements may sit closer than `gap`
    // on purpose (e.g. a dropped folder's grid), and pushing them would stack them in a column
    const margin = 10;
    for (const t of hinted) {
      let { x, y } = t;
      for (let moved = true; moved;) {
        moved = false;
        for (const p of placed) {
          if (x < p.x + p.w + margin && x + t.b.w + margin > p.x && y < p.y + p.h + margin && y + t.b.h + margin > p.y) { y = p.y + p.h + gap; moved = true; }
        }
      }
      placed.push({ x, y, w: t.b.w, h: t.b.h });
      place(t.b, x, y);
    }
    return out;
  }

  // shelf packing: tallest first, rows up to a width that gives roughly TARGET_RATIO
  const area = boxes.reduce((s, b) => s + (b.w + gap) * (b.h + gap), 0);
  const rowWidth = Math.max(Math.sqrt(area * TARGET_RATIO), ...boxes.map(b => b.w));
  boxes.sort((a, b) => b.h - a.h || b.w - a.w);
  let x = 0, y = 0, rowH = 0;
  for (const b of boxes) {
    if (x > 0 && x + b.w > rowWidth) { x = 0; y += rowH + gap; rowH = 0; }
    place(b, x, y);
    x += b.w + gap;
    rowH = Math.max(rowH, b.h);
  }
  return out;
}

/**
 * All edges of an ELK result, including those ELK placed inside compound
 * nodes. The nested `edges` arrays are emptied, so every edge exists once
 * (at the top) and is neither moved nor drawn twice.
 */
function collectEdges(r) {
  const all = [...(r.edges || [])];
  const walk = n => { all.push(...(n.edges || [])); n.edges = []; (n.children || []).forEach(walk); };
  (r.children || []).forEach(walk);
  return all;
}

/** Translate nodes (recursively), edge sections and labels of an ELK result (absolute coordinates). */
function shift(r, dx, dy) {
  const moveNode = n => { n.x += dx; n.y += dy; (n.children || []).forEach(moveNode); };
  (r.children || []).forEach(moveNode);
  for (const e of new Set(collectEdges(r))) {
    for (const s of e.sections || []) for (const p of [s.startPoint, s.endPoint, ...(s.bendPoints || [])]) { p.x += dx; p.y += dy; }
    for (const l of e.labels || []) if (l.x != null) { l.x += dx; l.y += dy; }
  }
}

/**
 * Make position hints of nested nodes agree with their containers. Hints
 * come from an earlier layout, where the nesting may have been different:
 * an explorer step can add the parent of an element already shown, or move
 * an element into a container shown elsewhere. ELK then receives children far
 * outside their parent's box and returns them outside it. Here, top-down,
 * each container's hinted children are moved as a group (keeping their
 * relative order) to the container's top-left inside its padding. A container
 * without a hint (just added) is hinted around its children instead, so the
 * elements already on screen stay where they were.
 * Returns a new map; `hints` is not changed.
 */
function consistentHints(rootChildren, hints) {
  const pos = new Map(hints);
  const shiftAll = (n, dx, dy) => (n.children || []).forEach(c => {
    const p = pos.get(c.id);
    if (p) pos.set(c.id, { x: p.x + dx, y: p.y + dy });
    shiftAll(c, dx, dy);
  });
  const fix = n => {
    if (n.children?.length) {
      const kids = n.children.map(c => pos.get(c.id)).filter(Boolean);
      if (kids.length) {
        const pad = String(n.layoutOptions?.['elk.padding'] || '');
        const top = Number(/top=(\d+)/.exec(pad)?.[1] || 24), left = Number(/left=(\d+)/.exec(pad)?.[1] || 12);
        const minX = Math.min(...kids.map(p => p.x)), minY = Math.min(...kids.map(p => p.y));
        let own = pos.get(n.id);
        if (!own) { own = { x: minX - left, y: minY - top }; pos.set(n.id, own); }
        const dx = own.x + left - minX, dy = own.y + top - minY;
        if (dx || dy) shiftAll(n, dx, dy);
      }
    }
    (n.children || []).forEach(fix);
  };
  rootChildren.forEach(fix);
  return pos;
}

/** Nodes with at least this many relationship ends get one port per relationship type and side (LV-4). */
const HUB_DEGREE = 5;

/**
 * Lay out elements and the relationships among them.
 * Relationships whose endpoint is another relationship (BR-6) are drawn
 * through a small helper dot on the target relationship, as in PlantUML.
 *
 * Hubs (LV-4): on busy nodes, relationships of the same type leaving on the
 * same side share one port, so they start from one point and run together
 * instead of forming a wide "comb" of parallel lines.
 *
 * Nesting (LV-5, optional): with `nesting` (see nesting.js) children are laid
 * out inside their parent's box (ELK hierarchical layout); the relationships
 * represented by nesting, and those between an element and its ancestor, are
 * not drawn as lines.
 *
 * @returns {Promise<{nodes, connections}>} in the shape renderViewSvg() expects (absolute coordinates):
 *   nodes: {id, x, y, w, h, elementRefId | dotRelationshipId, focus, children}
 *   connections: {id, sourceNodeId, targetNodeId, relationshipRefId, points, curve?, half?, labelAt?}
 *
 * Layout panel (LV-6): `prefs` (LayoutPrefs) scales spacing and overrides
 * strategies; `hints` (Map node id -> {x, y}) switches to ELK's interactive
 * strategies, which keep the layers and order of a manual arrangement.
 */
export async function layoutElements({
  elements, relationships, direction = 'TB', focus = new Set(), extraLabel = false, nesting = null, prefs = null, hints = null,
  notes = [], lines = [],
}) {
  // notes (CM-14): [{ key: "n<ref>", w, h, label, style }] of the view an editable copy was made of;
  // lines: [{ key: "l<ref>", from, to, style }] between notes and elements ("e<id>") or notes
  // hints (LV-6): node id -> {x, y} (absolute top-left) of a manually arranged diagram
  const interactive = !!hints?.size;
  const ids = new Set(elements.map(e => e.id));
  const elkDir = direction === 'LR' ? 'RIGHT' : 'DOWN';

  // drawable relationships: element endpoints in the diagram, relationship endpoints drawn (closure)
  const drawn = new Map();
  const endOk = (eid, rid) => (eid != null ? ids.has(eid) : drawn.has(rid));
  for (let changed = true; changed;) {
    changed = false;
    for (const r of relationships) {
      if (!drawn.has(r.id) && endOk(r.sourceElementId, r.sourceRelationshipId) && endOk(r.targetElementId, r.targetRelationshipId)) {
        drawn.set(r.id, r);
        changed = true;
      }
    }
  }
  const helpers = new Set();
  for (const r of drawn.values()) {
    if (r.sourceRelationshipId != null) helpers.add(r.sourceRelationshipId);
    if (r.targetRelationshipId != null) helpers.add(r.targetRelationshipId);
  }

  // ---- nodes (nested when a nesting forest is given)
  const parentOf = nesting?.parentOf || new Map();
  const hidden = new Set([...(nesting?.nestedRelIds || []), ...(nesting?.ancestorEdgeIds || [])]);
  const hasChildren = new Set(parentOf.values());
  const elkNodes = new Map();
  const sorted = [...elements].sort((a, b) => a.type.localeCompare(b.type) || (a.name || '').localeCompare(b.name || ''));
  for (const e of sorted) {
    const { w, h } = nodeSize(e, { extraLabel });
    const n = { id: `e${e.id}`, width: w, height: h };
    if (hasChildren.has(e.id)) {
      // compound: ELK sizes it around its children; keep room for the name at the top
      const lines = wrap(e.name || '', Math.max(4, Math.floor((w - 12) / 6.2))).length || 1;
      n.children = [];
      n.layoutOptions = {
        ...localOptions(prefs),
        'elk.direction': elkDir,
        'elk.padding': `[top=${lines * 13 + 14},left=12,bottom=12,right=12]`,
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': `(${w},${h})`,
      };
    }
    elkNodes.set(e.id, n);
  }
  const rootChildren = [];
  for (const e of sorted) {
    const parent = parentOf.get(e.id);
    (parent != null && elkNodes.get(parent) ? elkNodes.get(parent).children : rootChildren).push(elkNodes.get(e.id));
  }
  // Nested children are often unconnected to each other (e.g. 26 functions assigned to one
  // component) and would form a single wide row; bound each container's layers to ~√k nodes.
  for (const n of elkNodes.values()) {
    if (!n.children?.length) continue;
    n.layoutOptions['elk.layered.layering.strategy'] = prefs?.layering && prefs.layering !== 'auto' ? prefs.layering : 'COFFMAN_GRAHAM';
    n.layoutOptions['elk.layered.layering.coffmanGraham.layerBound'] = String(Math.max(3, Math.ceil(Math.sqrt(n.children.length) * 1.1)));
    if (interactive) Object.assign(n.layoutOptions, INTERACTIVE_OPTIONS);
  }
  // helper dots go into the lowest container holding both ends of their relationship,
  // so a relationship inside a box stays inside it
  const chain = eid => { const c = []; for (let p = parentOf.get(eid); p != null; p = parentOf.get(p)) c.push(p); return c; };
  const containerOf = rid => {
    const r = drawn.get(rid);
    if (!r || r.sourceElementId == null || r.targetElementId == null) return null;
    const targetSide = new Set([r.targetElementId, ...chain(r.targetElementId)]);
    return chain(r.sourceElementId).find(p => targetSide.has(p)) ?? null; // closest shared container
  };
  const noteOf = new Map(notes.map(n => [n.key, n]));
  for (const n of notes) rootChildren.push({ id: n.key, width: n.w, height: n.h });
  for (const id of helpers) {
    const host = containerOf(id);
    (host != null && elkNodes.get(host)?.children ? elkNodes.get(host).children : rootChildren).push({ id: `r${id}`, width: 8, height: 8 });
  }
  // positions guide the interactive strategies (absolute, like the output: elk.json.shapeCoords = ROOT)
  const pos = interactive ? consistentHints(rootChildren, hints) : null;
  if (interactive) {
    const setPos = n => { const p = pos.get(n.id); if (p) { n.x = p.x; n.y = p.y; } (n.children || []).forEach(setPos); };
    rootChildren.forEach(setPos);
  }

  // ---- edges (logical: in source → target direction; laid out reversed for some types)
  const alias = (eid, rid) => (eid != null ? `e${eid}` : `r${rid}`);
  const logical = []; // { id, rel, from, to, half }
  for (const r of drawn.values()) {
    if (hidden.has(r.id)) continue;
    const from = alias(r.sourceElementId, r.sourceRelationshipId);
    const to = alias(r.targetElementId, r.targetRelationshipId);
    if (helpers.has(r.id)) {
      logical.push({ id: `x${r.id}a`, rel: r, from, to: `r${r.id}`, half: 'first' });
      logical.push({ id: `x${r.id}b`, rel: r, from: `r${r.id}`, to, half: 'second' });
    } else {
      logical.push({ id: `x${r.id}`, rel: r, from, to });
    }
  }

  // ---- hub ports (LV-4): per node, relationship type and side
  const degree = new Map();
  for (const l of logical) for (const n of [l.from, l.to]) degree.set(n, (degree.get(n) || 0) + 1);
  const outSide = elkDir === 'DOWN' ? 'SOUTH' : 'EAST', inSide = elkDir === 'DOWN' ? 'NORTH' : 'WEST';
  const ports = new Map(); // node alias -> Map(portId -> side)
  const portFor = (node, rel, layoutOutgoing) => {
    if (node[0] !== 'e' || prefs?.hubs === false || (degree.get(node) || 0) < HUB_DEGREE) return node;
    // ELK limitation: ports on compound nodes + network-simplex placement fail
    // ("NEdge must have a source and target NNode"), so containers get no hub ports
    if (hasChildren.has(Number(node.slice(1)))) return node;
    const side = layoutOutgoing ? outSide : inSide;
    const id = `${node}~${rel.type}~${side}`;
    if (!ports.has(node)) ports.set(node, new Map());
    ports.get(node).set(id, side);
    return id;
  };

  const meta = new Map(); // edge id -> logical edge + reversed
  const edges = logical.map(l => {
    const reversed = REVERSED.has(l.rel.type);
    const lsrc = reversed ? l.to : l.from, ltgt = reversed ? l.from : l.to;
    const labelText = l.half === 'first' ? '' : l.rel.name || '';
    meta.set(l.id, { ...l, reversed });
    return {
      id: l.id,
      sources: [portFor(lsrc, l.rel, true)],
      targets: [portFor(ltgt, l.rel, false)],
      labels: labelText ? [{ id: `${l.id}l`, text: labelText, width: Math.min(160, labelText.length * 5.6 + 6), height: 12 }] : [],
    };
  });
  // note lines: plain edges, no ports, no labels
  const nodeIds = new Set([...elements.map(e => `e${e.id}`), ...noteOf.keys()]);
  for (const l of lines) {
    if (!nodeIds.has(l.from) || !nodeIds.has(l.to) || l.from === l.to) continue;
    meta.set(l.key, { id: l.key, from: l.from, to: l.to, line: l, reversed: false });
    edges.push({ id: l.key, sources: [l.from], targets: [l.to], labels: [] });
  }
  for (const [node, map] of ports) {
    const n = elkNodes.get(Number(node.slice(1)));
    if (!n) continue;
    // zero-sized ports: shared edge ends sit exactly on the border
    n.ports = [...map].map(([id, side]) => ({ id, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } }));
    n.layoutOptions = { ...(n.layoutOptions || {}), 'elk.portConstraints': 'FIXED_SIDE' };
  }

  const res = await layoutComponents(rootChildren, edges, { elkDir, nested: parentOf.size > 0, prefs, interactive, hints: pos });

  // ---- back to the renderer's shape
  const toNode = c => {
    const base = { id: c.id, x: c.x, y: c.y, w: c.width, h: c.height };
    if (c.id[0] === 'r') return { ...base, dotRelationshipId: Number(c.id.slice(1)) };
    if (c.id[0] === 'n') {
      const note = noteOf.get(c.id);
      return { ...base, type: 'Label', label: note?.label || '', style: note?.style || null, noteRef: c.id.slice(1) };
    }
    const elementRefId = Number(c.id.slice(1));
    return { ...base, elementRefId, focus: focus.has(elementRefId), children: (c.children || []).map(toNode) };
  };
  const nodes = (res.children || []).map(toNode);

  const allEdges = collectEdges(res);
  const connections = [];
  for (const e of allEdges) {
    const m = meta.get(e.id);
    const s = e.sections?.[0];
    if (!m || !s) continue;
    let points = [s.startPoint, ...(s.bendPoints || []), s.endPoint];
    if (m.reversed) points = points.reverse(); // back to source → target so the markers sit right
    const label = e.labels?.[0];
    connections.push({
      id: e.id,
      sourceNodeId: m.from,
      targetNodeId: m.to,
      relationshipRefId: m.rel ? m.rel.id : null,
      ...(m.line ? { type: 'Line', style: m.line.style || null } : {}),
      points,
      curve: prefs?.routing === 'SPLINES', // bend points are Bézier control points
      half: m.half,
      labelAt: label && label.x != null ? { x: label.x, y: label.y, w: label.width, h: label.height } : null,
    });
  }
  return { nodes, connections, nestedCount: nesting?.nestedRelIds.size || 0, hiddenCount: nesting?.ancestorEdgeIds.size || 0 };
}
