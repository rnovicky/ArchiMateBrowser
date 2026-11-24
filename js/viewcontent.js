// ArchiMate Browser: the content of a created view (BR-25, 2.22.0; API 3.15.0, BL-56).
//
// What the API takes as a view's content (POST …/views with `content`, PUT …/views/{id}/content):
// { nodes: [{ ref, parentRef?, type, x, y, w, h, elementId?, label?, documentation?, viewId?, style? }],
//   connections: [{ ref?, type, relationshipId?, sourceRef, targetRef, bendpoints, label?, style?, … }] }.
// Nodes nest by parentRef (a parent comes first); a connection's ends are nodes or earlier connections.
// Made from a generated diagram as drawn (contentOfLayout) or from a stored view (contentOfView).
// No DOM here: the unit tests run it as it is.

const round = v => Math.round(Number(v) || 0);
const MARGIN = 20;

/** Connections in an order the API takes: one that ends on another connection after that one. */
function ordered(connections) {
  const out = [], placed = new Set(), refs = new Set(connections.map(c => c.ref).filter(Boolean));
  let pending = connections;
  while (pending.length) {
    const later = [];
    for (const c of pending) {
      const waits = [c.sourceRef, c.targetRef].some(r => refs.has(r) && !placed.has(r));
      if (waits) later.push(c);
      else { out.push(c); if (c.ref) placed.add(c.ref); }
    }
    if (later.length === pending.length) break; // a cycle: left out
    pending = later;
  }
  return out;
}

/** Moves everything so that nothing lies left of or above MARGIN when something did (the API takes x, y ≥ 0). */
function normalise(nodes, connections) {
  const points = c => [...c.bendpoints, c.sourceAttachment, c.targetAttachment].filter(Boolean);
  const xs = [...nodes.map(n => n.x), ...connections.flatMap(c => points(c).map(b => b.x))];
  const ys = [...nodes.map(n => n.y), ...connections.flatMap(c => points(c).map(b => b.y))];
  const dx = xs.length && Math.min(...xs) < 0 ? MARGIN - Math.min(...xs) : 0;
  const dy = ys.length && Math.min(...ys) < 0 ? MARGIN - Math.min(...ys) : 0;
  if (!dx && !dy) return;
  const move = b => ({ x: b.x + dx, y: b.y + dy });
  for (const n of nodes) { n.x += dx; n.y += dy; }
  for (const c of connections) {
    c.bendpoints = c.bendpoints.map(move);
    if (c.sourceAttachment) c.sourceAttachment = move(c.sourceAttachment);
    if (c.targetAttachment) c.targetAttachment = move(c.targetAttachment);
  }
}

/**
 * 2.30.0: where a route meets its boxes, kept as the connection's attachment points. Without them a stored view
 * draws a line's ends towards the middle of its boxes, so an orthogonal route got slanted ends.
 */
function attachments(points, fromNode, toNode) {
  if (!points || points.length < 2) return {};
  const at = p => ({ x: round(p.x), y: round(p.y) });
  return { ...(fromNode ? { sourceAttachment: at(points[0]) } : {}), ...(toNode ? { targetAttachment: at(points.at(-1)) } : {}) };
}

/**
 * The content of a generated diagram as drawn: `shown` is { nodes, connections } of elklayout.js with the
 * manual positions applied (absolute coordinates). Element nodes ("e12") show their element, notes ("n…")
 * are Label nodes, helper dots ("r5", where a relationship ends on a relationship) are left out: the
 * relationships ending there end on the connection that draws relationship 5. A relationship drawn in
 * two halves through its dot becomes one connection.
 */
export function contentOfLayout(shown) {
  const nodes = [];
  const walk = (list, parentRef) => {
    for (const n of list) {
      if (n.dotRelationshipId != null) continue;
      const base = { ref: n.id, x: round(n.x), y: round(n.y), w: Math.max(1, round(n.w)), h: Math.max(1, round(n.h)) };
      if (parentRef) base.parentRef = parentRef;
      if (n.elementRefId != null) nodes.push({ ...base, type: 'Element', elementId: n.elementRefId });
      else if (n.type === 'Label') nodes.push({ ...base, type: 'Label', label: n.label || '', ...(n.style ? { style: n.style } : {}) });
      else continue;
      walk(n.children || [], n.id);
    }
  };
  walk(shown.nodes || [], null);
  const nodeRefs = new Set(nodes.map(n => n.ref));

  // a relationship's halves (x5a, x5b) are joined; the end "r5" is the connection of relationship 5
  const end = alias => (alias?.[0] === 'r' ? `x${alias.slice(1)}` : alias);
  const byRel = new Map();
  const lines = [];
  for (const c of shown.connections || []) {
    if (c.type === 'Line') { lines.push(c); continue; }
    if (c.relationshipRefId == null) continue;
    const parts = byRel.get(c.relationshipRefId) || {};
    parts[c.half === 'second' ? 'second' : c.half === 'first' ? 'first' : 'whole'] = c;
    byRel.set(c.relationshipRefId, parts);
  }
  const connections = [];
  for (const [rid, { whole, first, second }] of byRel) {
    const from = whole ? whole.sourceNodeId : first?.sourceNodeId;
    const to = whole ? whole.targetNodeId : second?.targetNodeId;
    if (from == null || to == null) continue;
    const points = whole ? whole.points : [...(first?.points || []), ...(second?.points || []).slice(1)];
    connections.push({
      ref: `x${rid}`, type: 'Relationship', relationshipId: rid, sourceRef: end(from), targetRef: end(to),
      bendpoints: points.slice(1, -1).map(p => ({ x: round(p.x), y: round(p.y) })),
      // a curved route (splines) is kept as its corners only: its ends are left to the view
      ...(whole?.curve || first?.curve ? {} : attachments(points, from?.[0] !== 'r', to?.[0] !== 'r')),
    });
  }
  const relRefs = new Set(connections.map(c => c.ref));
  const known = r => nodeRefs.has(r) || relRefs.has(r);
  const kept = connections.filter(c => known(c.sourceRef) && known(c.targetRef));
  for (const l of lines) {
    if (!nodeRefs.has(l.sourceNodeId) || !nodeRefs.has(l.targetNodeId)) continue;
    kept.push({
      type: 'Line', sourceRef: l.sourceNodeId, targetRef: l.targetNodeId,
      bendpoints: (l.points || []).slice(1, -1).map(p => ({ x: round(p.x), y: round(p.y) })), ...(l.style ? { style: l.style } : {}),
      ...(l.curve ? {} : attachments(l.points, true, true)),
    });
  }
  const result = { nodes, connections: ordered(kept) };
  normalise(result.nodes, result.connections);
  return result;
}

/**
 * The content of a stored view as the API answered it (GET …/content: the node tree and the connections),
 * to send it back unchanged (e.g. to clear `lost`). Nodes are "n<id>", connections "c<id>".
 */
export function contentOfView({ nodes = [], connections = [] }) {
  const out = [];
  const walk = (list, parentRef) => {
    for (const n of [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
      const node = {
        ref: `n${n.id}`, type: n.type, x: Math.max(0, round(n.x)), y: Math.max(0, round(n.y)),
        w: Math.max(1, round(n.w)), h: Math.max(1, round(n.h)),
      };
      if (parentRef) node.parentRef = parentRef;
      if (n.type === 'Element') node.elementId = n.elementRefId;
      if (n.label != null) node.label = n.label;
      if (n.documentation != null) node.documentation = n.documentation;
      if (n.viewRefId != null) node.viewId = n.viewRefId;
      if (n.style) node.style = n.style;
      out.push(node);
      walk(n.children || [], node.ref);
    }
  };
  walk(nodes, null);
  const refOf = (nodeId, connId) => (nodeId != null ? `n${nodeId}` : connId != null ? `c${connId}` : null);
  const conns = [...connections].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id).map(c => {
    const conn = {
      ref: `c${c.id}`, type: c.type, sourceRef: refOf(c.sourceNodeId, c.sourceConnectionId),
      targetRef: refOf(c.targetNodeId, c.targetConnectionId),
      bendpoints: (c.bendpoints || []).map(b => ({ x: Math.max(0, round(b.x)), y: Math.max(0, round(b.y)) })),
    };
    if (c.relationshipRefId != null) conn.relationshipId = c.relationshipRefId;
    for (const key of ['label', 'documentation', 'style', 'sourceAttachment', 'targetAttachment']) if (c[key] != null) conn[key] = c[key];
    return conn;
  }).filter(c => c.sourceRef && c.targetRef); // a line without ends cannot be sent back
  return { nodes: out, connections: ordered(conns) };
}

/** Is it a view made through the API (BR-25), not one of the model's source? */
export const isCreated = v => v?.origin === 'created';
