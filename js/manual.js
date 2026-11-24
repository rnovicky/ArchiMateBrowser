// Manual layout of generated diagrams (LV-6): elements dragged in the Diagram
// tab are "pinned" at their new position on top of the automatic layout, and
// the relationships of moved elements are re-routed orthogonally. "Tidy"
// instead feeds all current positions to ELK's interactive strategies (see
// elklayout.js), which re-arrange the diagram around the manual order.
//
// A manual layout = { hints: Map|null, pins: Map } of node id ("e<elementId>",
// "r<relationshipId>" for helper dots) -> {x, y} (absolute top-left).

export const emptyManual = () => ({ hints: null, pins: new Map() });
export const isManual = m => !!(m && (m.hints?.size || m.pins?.size));

// ---------------------------------------------------------------- applying pins

/**
 * Copy of an automatic layout ({nodes, connections} as returned by
 * layoutElements) with the pinned nodes moved. Children move with their
 * container; containers grow to keep moved children inside. Connections whose
 * ends moved together are translated, others touching a moved or resized node
 * are re-routed.
 */
export function applyPins({ nodes, connections }, pins) {
  nodes = structuredClone(nodes);
  connections = structuredClone(connections);
  const byId = new Map(), parentOf = new Map(), depth = new Map();
  const index = (list, parent, d) => list.forEach(n => {
    byId.set(n.id, n);
    if (parent) parentOf.set(n.id, parent);
    depth.set(n.id, d);
    index(n.children || [], n, d + 1);
  });
  index(nodes, null, 0);

  // title room of every container in the automatic layout, kept when it grows
  const topPad = new Map();
  for (const n of byId.values()) {
    if (n.children?.length) topPad.set(n.id, Math.max(24, Math.min(...n.children.map(c => c.y)) - n.y));
  }

  const delta = new Map(); // node id -> {dx, dy} applied to it
  const translate = (n, dx, dy) => {
    n.x += dx; n.y += dy;
    const d = delta.get(n.id) || { dx: 0, dy: 0 };
    delta.set(n.id, { dx: d.dx + dx, dy: d.dy + dy });
    (n.children || []).forEach(c => translate(c, dx, dy));
  };
  // ancestors first, so a pinned child inside a pinned container ends where it was dropped
  const order = [...pins.keys()].filter(id => byId.has(id)).sort((a, b) => depth.get(a) - depth.get(b));
  for (const id of order) {
    const n = byId.get(id), p = pins.get(id);
    if (p.x !== n.x || p.y !== n.y) translate(n, p.x - n.x, p.y - n.y);
  }
  const placed = positionsOf(nodes); // before containers grow (the base for further moves)

  // containers grow around moved children (innermost first)
  const resized = new Set();
  const grow = n => {
    for (let c = n, a = parentOf.get(n.id); a; c = a, a = parentOf.get(a.id)) {
      const pad = 12, top = topPad.get(a.id) ?? 24;
      const x1 = Math.min(a.x, c.x - pad), y1 = Math.min(a.y, c.y - top);
      const x2 = Math.max(a.x + a.w, c.x + c.w + pad), y2 = Math.max(a.y + a.h, c.y + c.h + pad);
      if (x1 === a.x && y1 === a.y && x2 === a.x + a.w && y2 === a.y + a.h) break;
      Object.assign(a, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      resized.add(a.id);
    }
  };
  order.forEach(id => grow(byId.get(id)));

  const box = id => byId.get(id);
  const same = (a, b) => a && b && a.dx === b.dx && a.dy === b.dy;
  const reroute = [];
  for (const c of connections) {
    const ds = delta.get(c.sourceNodeId), dt = delta.get(c.targetNodeId);
    if (resized.has(c.sourceNodeId) || resized.has(c.targetNodeId) || ((ds || dt) && !same(ds, dt))) {
      reroute.push(c);
    } else if (ds && (ds.dx || ds.dy)) {
      // both ends moved together (e.g. inside a dragged container): keep the route
      c.points = c.points.map(p => ({ x: p.x + ds.dx, y: p.y + ds.dy }));
      if (c.labelAt) c.labelAt = { ...c.labelAt, x: c.labelAt.x + ds.dx, y: c.labelAt.y + ds.dy };
    }
  }
  routeOrthogonal(reroute, box);
  return { nodes, connections, placed, moved: new Set(delta.keys()) };
}

/**
 * Orthogonal routes between node borders: leave the source on the side facing
 * the target, enter the target on the opposite side, with one bend line in
 * the middle. Ends sharing a node side are spread along it.
 */
function routeOrthogonal(conns, box) {
  const plans = [];
  const slots = new Map(); // "nodeId|side" -> [{plan, end, along}]
  const addSlot = (nodeId, side, plan, end, along) => {
    const k = `${nodeId}|${side}`;
    if (!slots.has(k)) slots.set(k, []);
    slots.get(k).push({ plan, end, along });
  };
  for (const c of conns) {
    const s = box(c.sourceNodeId), t = box(c.targetNodeId);
    if (!s || !t) continue;
    const gaps = {
      S: t.y - (s.y + s.h), N: s.y - (t.y + t.h), E: t.x - (s.x + s.w), W: s.x - (t.x + t.w),
    };
    const side = Object.keys(gaps).reduce((a, b) => (gaps[b] > gaps[a] ? b : a));
    const plan = { c, s, t, side, overlap: gaps[side] < 0 };
    plans.push(plan);
    if (plan.overlap) continue;
    const vertical = side === 'S' || side === 'N';
    const cx = b => b.x + b.w / 2, cy = b => b.y + b.h / 2;
    addSlot(c.sourceNodeId, side, plan, 'start', vertical ? cx(t) : cy(t));
    addSlot(c.targetNodeId, OPPOSITE[side], plan, 'end', vertical ? cx(s) : cy(s));
  }
  // spread the ends on each side, ordered by where the other end lies (fewer crossings)
  for (const [k, list] of slots) {
    const [nodeId, side] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)];
    const b = box(nodeId);
    list.sort((p, q) => p.along - q.along);
    list.forEach((e, i) => {
      const f = (i + 1) / (list.length + 1);
      const pt = side === 'N' ? { x: b.x + b.w * f, y: b.y }
        : side === 'S' ? { x: b.x + b.w * f, y: b.y + b.h }
        : side === 'W' ? { x: b.x, y: b.y + b.h * f }
        : { x: b.x + b.w, y: b.y + b.h * f };
      e.plan[e.end] = pt;
    });
  }
  for (const p of plans) {
    const { c } = p;
    c.labelAt = null; // placed at the middle segment by the renderer
    c.curve = false;
    if (p.overlap) {
      // overlapping boxes: a straight line between the centres, clipped at the borders
      const a = { x: p.s.x + p.s.w / 2, y: p.s.y + p.s.h / 2 }, b = { x: p.t.x + p.t.w / 2, y: p.t.y + p.t.h / 2 };
      c.points = [clip(p.s, b), clip(p.t, a)];
      continue;
    }
    const { start, end } = p;
    if (p.side === 'S' || p.side === 'N') {
      const mid = (start.y + end.y) / 2;
      c.points = Math.abs(start.x - end.x) < 1 ? [start, { x: start.x, y: end.y }]
        : [start, { x: start.x, y: mid }, { x: end.x, y: mid }, end];
    } else {
      const mid = (start.x + end.x) / 2;
      c.points = Math.abs(start.y - end.y) < 1 ? [start, { x: end.x, y: start.y }]
        : [start, { x: mid, y: start.y }, { x: mid, y: end.y }, end];
    }
  }
}

const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

function clip(b, p) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = p.x - cx, dy = p.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity, 1);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** All node positions of a layout (for "Tidy"): id -> {x, y}. */
export function positionsOf(nodes) {
  const out = new Map();
  const walk = list => list.forEach(n => { out.set(n.id, { x: Math.round(n.x), y: Math.round(n.y) }); walk(n.children || []); });
  walk(nodes);
  return out;
}

/** Find a node of a layout tree by id. */
export function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children || [], id);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------- encoding

/**
 * Map -> "e12.340.-20_r5.10.20". The keys are layout node ids ("e" + element id,
 * "r" + relationship id); `keyOut` may turn them into tokens of links and storage
 * (BR-17: "e" + an escaped XMI identifier, see refs.js), `keyIn` back (null drops one).
 */
const encodeMap = (m, keyOut = k => k) => [...(m || new Map())].map(([id, p]) => `${keyOut(id)}.${Math.round(p.x)}.${Math.round(p.y)}`).join('_');

function decodeMap(s, keyIn = k => k) {
  const m = new Map();
  for (const part of String(s || '').split('_')) {
    const [token, x, y] = part.split('.');
    if (!/^[er][A-Za-z0-9*-]+$/.test(token || '') || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) continue;
    const id = keyIn(token);
    if (id) m.set(id, { x: Number(x), y: Number(y) });
  }
  return m;
}

/** The same manual layout with its keys translated by `fn` (null drops a position). */
export function mapManualKeys(m, fn) {
  const tr = map => new Map([...(map || new Map())].map(([k, p]) => [fn(k), p]).filter(([k]) => k));
  const hints = m.hints ? tr(m.hints) : null;
  return { hints: hints?.size ? hints : null, pins: tr(m.pins) };
}

/**
 * URL form: "<signature>!<hints>!<pins>". The signature (direction and
 * nesting) says which automatic layout the positions belong to.
 */
export function encodeManual(m, signature, keyOut) {
  return `${signature}!${encodeMap(m.hints, keyOut)}!${encodeMap(m.pins, keyOut)}`;
}

export function decodeManual(str) {
  const [signature, h, p] = String(str || '').split('!');
  const hints = decodeMap(h);
  return { signature, manual: { hints: hints.size ? hints : null, pins: decodeMap(p) } };
}

// ---------------------------------------------------------------- storage

const STORE = 'archixmi-manual-layouts';
const MAX_STORED = 200;

function readAll() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; }
}

export function loadManual(key, keyIn) {
  const rec = readAll()[key];
  if (!rec) return emptyManual();
  const hints = decodeMap(rec.h, keyIn);
  return { hints: hints.size ? hints : null, pins: decodeMap(rec.p, keyIn) };
}

/** Remember (or forget, when empty) a manual layout; the oldest entries are dropped beyond MAX_STORED. */
export function saveManual(key, m, keyOut) {
  try {
    const all = readAll();
    if (isManual(m)) all[key] = { t: Date.now(), h: encodeMap(m.hints, keyOut), p: encodeMap(m.pins, keyOut) };
    else delete all[key];
    const keys = Object.keys(all);
    if (keys.length > MAX_STORED) keys.sort((a, b) => all[a].t - all[b].t).slice(0, keys.length - MAX_STORED).forEach(k => delete all[k]);
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch { /* storage unavailable: manual positions live until the diagram changes */ }
}
