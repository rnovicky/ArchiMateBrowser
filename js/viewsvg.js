// Native SVG rendering of a stored view using its own node coordinates and
// bendpoints — a faithful, offline alternative to the PlantUML auto-layout.

import { elementColor, elementBadge, prettyType, spriteInline } from './archimate.js';
import { t as tr } from './i18n.js'; // `t` names SVG text nodes below

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}

const rgb = c => (c && c.r != null ? `rgb(${c.r},${c.g},${c.b})` : null);
/** Exchange-format alpha is a percentage (0–100); null/undefined = opaque. */
const opacity = c => (c && c.a != null && c.a < 100 ? Math.max(0, c.a) / 100 : null);

// ---------------------------------------------------------------- ArchiMate shapes (LV-1)

/** Notation family of each element type (ArchiMate 3.x rectangle notation, as drawn by Archi). */
const SHAPE_OF = {
  // behaviour: rounded corners
  BusinessProcess: 'round', BusinessFunction: 'round', BusinessInteraction: 'round',
  ApplicationProcess: 'round', ApplicationFunction: 'round', ApplicationInteraction: 'round',
  TechnologyProcess: 'round', TechnologyFunction: 'round', TechnologyInteraction: 'round',
  Capability: 'round', CourseOfAction: 'round', WorkPackage: 'round',
  // services: fully rounded ends
  BusinessService: 'service', ApplicationService: 'service', TechnologyService: 'service',
  // events: notched left, pointed right
  BusinessEvent: 'event', ApplicationEvent: 'event', TechnologyEvent: 'event', ImplementationEvent: 'event',
  // passive structure
  BusinessObject: 'object', DataObject: 'object', Contract: 'contract', Product: 'product',
  Representation: 'wavy', Deliverable: 'wavy', Artifact: 'artifact',
  // technology
  Node: 'node',
  // strategy
  ValueStream: 'chevron',
  // motivation: cut corners; value/meaning have their own figures
  Stakeholder: 'cut', Driver: 'cut', Assessment: 'cut', Goal: 'cut', Outcome: 'cut',
  Principle: 'cut', Requirement: 'cut', Constraint: 'cut', Value: 'ellipse', Meaning: 'cloud',
  Grouping: 'grouping',
};

export function shapeOf(type) {
  return SHAPE_OF[type] || 'rect';
}

/**
 * Draw the outline of an element of `type` in box b. Returns the outline
 * element (class "v-shape"; selection/hover styles target it). Extra
 * notation lines (object header, node faces…) get class "v-deco".
 */
function drawShape(g, type, b, attrs) {
  const { x, y, w, h } = b;
  const kind = shapeOf(type);
  const deco = d => el('path', { d, fill: 'none', stroke: attrs.stroke, 'stroke-width': attrs['stroke-width'], 'stroke-opacity': attrs['stroke-opacity'], class: 'v-deco' }, g);
  const path = d => el('path', { d, ...attrs, class: 'v-shape' }, g);
  switch (kind) {
    case 'round':
      return el('rect', { x, y, width: w, height: h, rx: Math.min(10, h / 4), ...attrs, class: 'v-shape' }, g);
    case 'service': {
      const r = Math.min(h / 2, w / 2);
      return el('rect', { x, y, width: w, height: h, rx: r, ry: r, ...attrs, class: 'v-shape' }, g);
    }
    case 'event': {
      const n = Math.min(h / 2, w / 4, 14);
      return path(`M${x},${y} L${x + w - n},${y} Q${x + w},${y + h / 2} ${x + w - n},${y + h} L${x},${y + h} Q${x + n},${y + h / 2} ${x},${y} Z`);
    }
    case 'chevron': {
      const n = Math.min(h / 2, w / 4, 16);
      return path(`M${x},${y} L${x + w - n},${y} L${x + w},${y + h / 2} L${x + w - n},${y + h} L${x},${y + h} L${x + n},${y + h / 2} Z`);
    }
    case 'cut': {
      const c = Math.min(8, w / 6, h / 6);
      return path(`M${x + c},${y} L${x + w - c},${y} L${x + w},${y + c} L${x + w},${y + h - c} L${x + w - c},${y + h} L${x + c},${y + h} L${x},${y + h - c} L${x},${y + c} Z`);
    }
    case 'ellipse':
      return el('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...attrs, class: 'v-shape' }, g);
    case 'cloud': {
      // five bumps along the top/bottom, one on each side
      const r = Math.min(h / 4, w / 8);
      return path(`M${x + w * 0.2},${y + h * 0.85}`
        + ` A${w * 0.14},${h * 0.2} 0 0 1 ${x + w * 0.08},${y + h * 0.5}`
        + ` A${w * 0.14},${h * 0.22} 0 0 1 ${x + w * 0.25},${y + h * 0.17}`
        + ` A${w * 0.18},${h * 0.2} 0 0 1 ${x + w * 0.55},${y + h * 0.1}`
        + ` A${w * 0.16},${h * 0.2} 0 0 1 ${x + w * 0.85},${y + h * 0.3}`
        + ` A${w * 0.13},${h * 0.22} 0 0 1 ${x + w * 0.88},${y + h * 0.78}`
        + ` A${w * 0.2},${h * 0.18} 0 0 1 ${x + w * 0.55},${y + h * 0.93}`
        + ` A${w * 0.18},${Math.max(r, h * 0.16)} 0 0 1 ${x + w * 0.2},${y + h * 0.85} Z`);
    }
    case 'object': case 'contract': {
      const shape = el('rect', { x, y, width: w, height: h, ...attrs, class: 'v-shape' }, g);
      const band = Math.min(14, h / 3);
      deco(`M${x},${y + band} L${x + w},${y + band}`);
      if (kind === 'contract') deco(`M${x},${y + h - band} L${x + w},${y + h - band}`);
      return shape;
    }
    case 'product': {
      const shape = el('rect', { x, y, width: w, height: h, ...attrs, class: 'v-shape' }, g);
      const tw = Math.min(w / 2, 60), th = Math.min(12, h / 4);
      deco(`M${x},${y + th} L${x + tw},${y + th} L${x + tw},${y}`);
      return shape;
    }
    case 'wavy': {
      const a = Math.min(6, h / 8); // wave amplitude
      return path(`M${x},${y} L${x + w},${y} L${x + w},${y + h - a}`
        + ` C${x + w * 0.75},${y + h - 3 * a} ${x + w * 0.5},${y + h - 3 * a} ${x + w / 2},${y + h - a}`
        + ` C${x + w * 0.5},${y + h + a} ${x + w * 0.25},${y + h + a} ${x},${y + h - a} Z`);
    }
    case 'artifact': {
      const f = Math.min(12, w / 5, h / 4);
      const shape = path(`M${x},${y} L${x + w - f},${y} L${x + w},${y + f} L${x + w},${y + h} L${x},${y + h} Z`);
      deco(`M${x + w - f},${y} L${x + w - f},${y + f} L${x + w},${y + f}`);
      return shape;
    }
    case 'node': {
      // 3D box: front face plus top and right faces
      const d = Math.min(10, w / 8, h / 5);
      const shape = path(`M${x},${y + d} L${x + d},${y} L${x + w},${y} L${x + w},${y + h - d} L${x + w - d},${y + h} L${x},${y + h} Z`);
      deco(`M${x},${y + d} L${x + w - d},${y + d} L${x + w - d},${y + h} M${x + w - d},${y + d} L${x + w},${y}`);
      return shape;
    }
    case 'grouping': {
      // dashed body with a tab holding the name
      const th = 16, tw = Math.min(w * 0.6, Math.max(60, w / 2));
      const dashed = { ...attrs, 'stroke-dasharray': '6 4' };
      const shape = el('path', {
        d: `M${x},${y + th} L${x},${y} L${x + tw},${y} L${x + tw},${y + th} L${x + w},${y + th} L${x + w},${y + h} L${x},${y + h} Z`,
        ...dashed, class: 'v-shape',
      }, g);
      return shape;
    }
    default:
      return el('rect', { x, y, width: w, height: h, rx: 0, ...attrs, class: 'v-shape' }, g);
  }
}

/** Distance of the type icon from the top-right corner, so it stays inside curved/cut outlines. */
function iconOffset(type, b) {
  switch (shapeOf(type)) {
    case 'service': return { x: Math.max(4, Math.min(b.h / 2, b.w / 2) * 0.45), y: 4 };
    case 'event': case 'chevron': return { x: Math.min(b.h / 2, b.w / 4, 16) * 0.7 + 3, y: 4 };
    case 'cut': return { x: 5, y: 5 };
    case 'ellipse': case 'cloud': return { x: b.w * 0.2, y: b.h * 0.18 };
    case 'node': return { x: Math.min(10, b.w / 8, b.h / 5) + 3, y: Math.min(10, b.w / 8, b.h / 5) + 3 };
    case 'artifact': return { x: Math.min(12, b.w / 5, b.h / 4) + 3, y: 3 };
    default: return { x: 3, y: 3 };
  }
}

/** Left/right text inset for shapes whose sides are not straight. */
function textInset(type, b) {
  const kind = shapeOf(type);
  if (kind === 'event' || kind === 'chevron') return Math.min(b.h / 2, b.w / 4, 16);
  if (kind === 'ellipse' || kind === 'cloud') return b.w * 0.12;
  return 0;
}

// ---------------------------------------------------------------- fonts (LV-2)

/**
 * Text attributes from an exchange-format font ({name, size (pt), style, color}).
 * Emitted as an inline `style`: the .v-text CSS uses the `font` shorthand, which
 * would override plain SVG presentation attributes. `bold` forces the weight
 * (used for group titles) unless the font says otherwise.
 */
function fontAttrs(font, { bold = false } = {}) {
  const style = String(font?.style || '').toLowerCase();
  // 9 pt (Archi's default) renders as 11 px, matching the base .v-text size
  const px = font?.size ? Math.round(font.size * (11 / 9) * 10) / 10 : null;
  const css = [
    font?.name ? `font-family:"${font.name}","Segoe UI",Arial,sans-serif` : '',
    px && px !== 11 ? `font-size:${px}px` : '',
    /bold/.test(style) || bold ? 'font-weight:700' : '',
    /italic/.test(style) ? 'font-style:italic' : '',
    /underline/.test(style) ? 'text-decoration:underline' : /strike/.test(style) ? 'text-decoration:line-through' : '',
  ].filter(Boolean).join(';');
  return { style: css || null, 'fill-opacity': opacity(font?.color) };
}

/** Font size in px for line-height / wrapping calculations. */
const fontPx = font => (font?.size ? font.size * (11 / 9) : 11);

/**
 * Resolve absolute bounds for every node. The Open Exchange Format stores
 * absolute coordinates, but some tools emit child coordinates relative to the
 * parent; if a child does not fit inside its parent we treat it as relative.
 * Automatic layouts (`absolute`) are always absolute: no guessing.
 */
function layoutNodes(nodes, { absolute = false } = {}) {
  const bounds = new Map();
  const order = [];
  const visit = (list, parent) => {
    for (const n of [...list].sort((a, b) => a.sortOrder - b.sortOrder)) {
      let { x, y } = n;
      if (parent && !absolute) {
        const inside = x >= parent.x && y >= parent.y && x + n.w <= parent.x + parent.w + 1 && y + n.h <= parent.y + parent.h + 1;
        if (!inside) { x += parent.x; y += parent.y; }
      }
      const b = { x, y, w: n.w, h: n.h };
      bounds.set(n.id, b);
      order.push(n);
      visit(n.children || [], b);
    }
  };
  visit(nodes, null);
  return { bounds, order };
}

export function wrap(text, maxChars) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Point where the segment from the rect centre towards (px,py) leaves the rect. */
/** The point half-way along a line given by its points. */
function middleOf(pts) {
  const lengths = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let rest = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (rest <= lengths[i]) {
      const f = lengths[i] ? rest / lengths[i] : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f };
    }
    rest -= lengths[i];
  }
  return { ...pts[pts.length - 1] };
}

function clipToRect(b, px, py) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = px - cx, dy = py - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx !== 0 ? (b.w / 2) / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? (b.h / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy, 1);
  return { x: cx + dx * s, y: cy + dy * s };
}

// 2.28.0: the ids of a drawing's arrowheads are its own. With fixed ids every drawing's url(#m-open) meant the
// first marker of the page, and when that one was in a hidden tab (display: none) Chrome drew no arrowheads.
let markerSeq = 0;

function defineMarkers(defs, prefix) {
  const mk = (name, path, { fill = 'var(--diagram-line)', w = 12, h = 12, refX = 11, refY = 6 } = {}) => {
    const m = el('marker', { id: prefix + name, viewBox: `0 0 ${w} ${h}`, markerWidth: w, markerHeight: h, refX, refY, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, defs);
    el('path', { d: path, fill, stroke: 'var(--diagram-line)', 'stroke-width': 1.2 }, m);
  };
  mk('m-open', 'M1,1 L11,6 L1,11', { fill: 'none' });
  mk('m-filled', 'M1,1 L11,6 L1,11 Z');
  mk('m-hollow', 'M1,1 L11,6 L1,11 Z', { fill: 'var(--diagram-bg)' });
  mk('m-diamond', 'M1,6 L7,1 L13,6 L7,11 Z', { w: 14, refX: 13 });
  mk('m-diamond-hollow', 'M1,6 L7,1 L13,6 L7,11 Z', { w: 14, refX: 13, fill: 'var(--diagram-bg)' });
  mk('m-dot', 'M3,6 a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0', { refX: 6 });
  mk('m-small', 'M2,3 L9,6 L2,9', { fill: 'none', w: 10, refX: 9 });
}

function connectionStyle(rel) {
  const s = { dash: null, start: null, end: null };
  switch (rel?.type) {
    case 'Composition': s.start = 'm-diamond'; break;
    case 'Aggregation': s.start = 'm-diamond-hollow'; break;
    case 'Assignment': s.start = 'm-dot'; s.end = 'm-filled'; break;
    case 'Realization': s.dash = '6 4'; s.end = 'm-hollow'; break;
    case 'Specialization': s.end = 'm-hollow'; break;
    case 'Serving': s.end = 'm-open'; break;
    case 'Triggering': s.end = 'm-filled'; break;
    case 'Flow': s.dash = '6 4'; s.end = 'm-filled'; break;
    case 'Influence': s.dash = '6 4'; s.end = 'm-open'; break;
    case 'Access':
      s.dash = '2 3';
      if (rel.accessType === 'Write' || rel.accessType === 'ReadWrite') s.end = 'm-small';
      if (rel.accessType === 'Read' || rel.accessType === 'ReadWrite') s.start = 'm-small';
      break;
    case 'Association': if (rel.isDirected) s.end = 'm-open'; break;
    default: s.dash = '3 3';
  }
  return s;
}

/** The most "Fit" enlarges a diagram: 1 = its own size (elements as in any other diagram). */
const MAX_FIT_ZOOM = 1;

/**
 * @returns {{svg: SVGSVGElement, fit: Function, zoom: Function, view: Function}}
 * onSelect(kind, id) is called with ('element', elementId) or ('relationship', relationshipId).
 * onMoveNode(nodeIds, dx, dy) (LV-6, generated diagrams): element nodes can be
 * dragged; called once on drop with the offset in diagram units. Dragging one
 * of the selected (marked) elements moves all of them (CM-6): `nodeIds` are
 * the nodes moved, without those nested in another one. Dragging elsewhere pans. `viewBox` restores a previous zoom/pan (see view()).
 * Explorer (ALT-1): badge(elementId) -> number of hidden related elements,
 * drawn as "+N" (click = onExpand); onExpand(elementId) also on double-click;
 * onNodeMenu(elementId, event) on right-click; `fresh` = element ids just
 * added (briefly highlighted).
 * `faded` (stored views): { elements: Set, relationships: Set } of ids the
 * diagram filters leave out; they are drawn faint, and so are the lines that
 * end on a faded element.
 */
export function renderViewSvg({
  nodes, connections, elementById, relationshipById, onSelect, onOpenView, viewName, deco = {}, onMoveNode = null, viewBox = null,
  badge = null, onExpand = null, onNodeMenu = null, fresh = null, absolute = false, onConnMenu = null, onBackgroundMenu = null,
  onOtherNodeMenu = null, onMark = null, faded = null,
}) {
  // onMark(elementIds, mode) multi-selection (CM-6): Ctrl/Shift-click on an element ('toggle'),
  // Shift- or Ctrl-drag on the diagram selects an area ('add')
  // onOtherNodeMenu(node, event) -> bool: right-click on a node without an element (drill-down
  // link, group/container, label/note); return false to fall back to the background menu
  // onBackgroundMenu(event): right-click on the canvas (element/connection menus stop the event first)
  // onConnMenu(relationshipId, event): right-click on a relationship (line or helper dot)
  const connMenu = (g, relId) => {
    if (onConnMenu && relId != null) g.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); onConnMenu(relId, ev); });
  };
  const propsTooltip = item => (item?.properties || []).map(p => `\n${p.propertyDefinitionName}: ${p.value}${p.lang ? ` [${p.lang}]` : ''}`).join('');
  const { bounds, order } = layoutNodes(nodes, { absolute });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const b of bounds.values()) { grow(b.x, b.y); grow(b.x + b.w, b.y + b.h); }
  for (const c of connections) for (const p of c.points || c.bendpoints || []) grow(p.x, p.y);
  if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 100; }
  const pad = 20;
  const vb = { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };

  const svg = el('svg', { xmlns: NS, class: 'view-svg', viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}` });
  const markerPrefix = `v${++markerSeq}-`;
  defineMarkers(el('defs', {}, svg), markerPrefix);
  el('rect', { x: vb.x, y: vb.y, width: vb.w, height: vb.h, fill: 'var(--diagram-bg)' }, svg);
  const gNodes = el('g', {}, svg);
  const gConns = el('g', {}, svg);
  const fadedNodes = new Set(); // node ids of faded elements: their lines fade too

  for (const n of order) {
    const b = bounds.get(n.id);

    // helper dot standing in for a relationship that other relationships attach to (generated diagrams)
    if (n.dotRelationshipId != null) {
      const rel = relationshipById(n.dotRelationshipId);
      const g = el('g', { class: 'v-node v-dot clickable', 'data-node': n.id, 'data-relationship': n.dotRelationshipId }, gNodes);
      el('title', {}, g).textContent = rel ? `${rel.type}${rel.name ? ': ' + rel.name : ''} ${tr('(other relationships attach here)')}` : '';
      el('circle', { cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.min(b.w, b.h) / 2, fill: '#666', stroke: '#444' }, g);
      g.addEventListener('click', ev => { ev.stopPropagation(); onSelect?.('relationship', n.dotRelationshipId); });
      connMenu(g, n.dotRelationshipId);
      continue;
    }

    const elem = n.elementRefId != null ? elementById(n.elementRefId) : null;
    const fade = !!(elem && faded?.elements.has(elem.id));
    if (fade) fadedNodes.add(String(n.id));
    const g = el('g', {
      class: 'v-node' + (elem ? ' clickable' : '') + (n.focus ? ' v-focus' : '') + (fade ? ' v-faded' : ''), 'data-node': n.id, 'data-element': elem?.id,
      'data-movable': onMoveNode && (elem || n.noteRef != null) ? '' : null, 'data-note': n.noteRef,
    }, gNodes);
    if (!elem && onOtherNodeMenu) {
      g.addEventListener('contextmenu', ev => { if (onOtherNodeMenu(n, ev)) { ev.preventDefault(); ev.stopPropagation(); } });
    }
    const title = el('title', {}, g);
    const label = n.label || elem?.name || '';
    title.textContent = elem ? `${label}\n«${prettyType(elem.type)}»${propsTooltip(elem)}` : label;
    if (elem) { // EN-4: reachable with the arrow keys (keyboardNodes), named for screen readers
      g.setAttribute('tabindex', '-1');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', `${label || tr('(unnamed)')}, ${prettyType(elem.type)}`);
    }
    const style = n.style || {};
    const decoFill = elem && deco.colour ? deco.colour(elem) : null; // colour-by-property wins over the view's own fill
    const fill = decoFill || rgb(style.fillColor) || (elem ? elementColor(elem.type) : 'transparent');
    const extra = elem && deco.extraLabel ? deco.extraLabel(elem) : null;
    const stroke = rgb(style.lineColor) || 'var(--diagram-line)';
    const fontColor = rgb(style.font?.color) || '#000';
    const isGroup = elem?.type === 'Grouping' || (!elem && n.type === 'Container');
    const isJunction = elem && /Junction$/.test(elem.type);

    // BR-8: a node without an element that references another view is a
    // drill-down link (Archi "diagram model reference"): box + ↗, click opens the view
    if (!elem && n.viewRefId != null) {
      g.setAttribute('class', 'v-node v-drill clickable');
      g.dataset.view = n.viewRefId;
      title.textContent = `${label}\n${tr('Opens view: {name}', { name: viewName?.(n.viewRefId) || '#' + n.viewRefId })}`;
      el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 4, fill: rgb(style.fillColor) || '#f2f2f2', stroke: '#888', 'stroke-width': 1 }, g);
      el('text', { x: b.x + b.w - 5, y: b.y + 13, 'text-anchor': 'end', class: 'v-drill-icon' }, g).textContent = '↗';
      const lines = wrap(label, Math.max(4, Math.floor((b.w - 20) / 6.2)));
      // A drill box with nested nodes, or one that visually frames other nodes
      // (overview views often place elements on top of a large reference box),
      // behaves like a group: title at the top, only the title opens the view.
      const inside = o => o.x >= b.x && o.y >= b.y && o.x + o.w <= b.x + b.w && o.y + o.h <= b.y + b.h;
      const nested = (n.children || []).length > 0 || order.some(m => m !== n && inside(bounds.get(m.id)));
      const top = nested ? b.y + 14 : b.y + b.h / 2 - ((lines.length - 1) * 13) / 2 + 4;
      lines.forEach((line, i) => {
        el('text', {
          x: nested ? b.x + 6 : b.x + b.w / 2, y: top + i * 13, 'text-anchor': nested ? 'start' : 'middle',
          class: 'v-text v-drill-text', 'font-weight': nested ? 600 : null,
        }, g).textContent = line;
      });
      const open = ev => { ev.stopPropagation(); onOpenView?.(n.viewRefId); };
      if (nested) {
        // a container: only its title/↗ (or a double click) opens the view, so clicks on empty space don't navigate away
        g.setAttribute('class', 'v-node v-drill v-drill-nested');
        g.querySelectorAll('text').forEach(t => { t.classList.add('clickable'); t.style.pointerEvents = 'auto'; t.addEventListener('click', open); });
        g.addEventListener('dblclick', open);
        title.textContent += `\n${tr('(click the title or double-click to open)')}`;
      } else {
        g.addEventListener('click', open);
      }
      continue;
    }

    const font = fontAttrs(style.font);
    const px = fontPx(style.font);
    const lh = Math.round(px * 1.2);
    if (n.type === 'Label') {
      // the text alone is hard to hit: an invisible box makes the whole note grabbable and right-clickable
      el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent', class: 'v-note-box' }, g);
      wrap(label, Math.max(4, Math.floor(b.w / (px * 0.55)))).forEach((line, i) =>
        el('text', { x: b.x + 4, y: b.y + px + 3 + i * lh, class: 'v-text', fill: rgb(style.font?.color) || 'var(--diagram-ink)', ...font }, g).textContent = line);
      continue;
    }
    if (isJunction) {
      // ArchiMate junctions are small fixed-size dots, whatever box the view stores
      const r = Math.min(7.5, Math.min(b.w, b.h) / 2);
      el('circle', {
        cx: b.x + b.w / 2, cy: b.y + b.h / 2, r, class: 'v-shape',
        fill: elem.type === 'OrJunction' ? '#fff' : (rgb(style.fillColor) || '#000'), stroke: rgb(style.lineColor) || '#000',
        'stroke-width': style.lineWidth || 1,
      }, g);
    } else {
      const shapeType = elem ? elem.type : (isGroup ? 'Grouping' : null);
      drawShape(g, shapeType, b, {
        fill: isGroup && !style.fillColor && !decoFill ? 'transparent' : fill,
        'fill-opacity': decoFill ? null : opacity(style.fillColor),
        stroke, 'stroke-opacity': opacity(style.lineColor), 'stroke-width': style.lineWidth || 1,
      });
      const hasChildren = (n.children || []).length > 0;
      const inset = elem ? textInset(elem.type, b) : 0;
      const lines = wrap(label, Math.max(4, Math.floor((b.w - 12 - 2 * inset) / (px * 0.56))));
      // grouping: name in the tab; containers: name at the top; otherwise centred
      const top = isGroup ? b.y + Math.min(12, px + 1) : hasChildren ? b.y + px + 4 : b.y + b.h / 2 - ((lines.length - 1) * lh) / 2 + px * 0.36;
      lines.forEach((line, i) => {
        const t = el('text', {
          x: isGroup ? b.x + 6 : b.x + b.w / 2, y: top + i * lh,
          'text-anchor': isGroup ? 'start' : 'middle', class: 'v-text', fill: fontColor,
          ...(isGroup ? fontAttrs(style.font, { bold: true }) : font),
        }, g);
        t.textContent = line;
      });
      if (extra) {
        // property line at the bottom edge of the node
        const maxChars = Math.max(4, Math.floor((b.w - 8) / 5));
        el('text', {
          x: isGroup ? b.x + 6 : b.x + b.w / 2, y: b.y + b.h - 4, 'text-anchor': isGroup ? 'start' : 'middle', class: 'v-prop',
        }, g).textContent = extra.length > maxChars ? extra.slice(0, maxChars - 1) + '…' : extra;
      }
      if (elem && b.w > 50) {
        // ArchiMate type icon in the top-right corner (inline, so exported SVGs are self-contained);
        // groupings get it too, junctions never reach here. Falls back to the text acronym.
        const sp = spriteInline(elem.type);
        const ic = iconOffset(elem.type, b);
        const size = 12, sx = b.x + b.w - size - ic.x, sy = b.y + ic.y;
        if (sp?.d) {
          const icon = el('svg', { x: sx, y: sy, width: size, height: size, viewBox: sp.viewBox, class: 'v-sprite' }, g);
          el('path', { d: sp.d, fill: '#000' }, icon);
        } else if (sp?.dataUri) {
          el('image', { x: sx, y: sy, width: size, height: size, href: sp.dataUri, class: 'v-sprite' }, g);
        } else if (!isGroup) {
          el('text', { x: b.x + b.w - 4, y: b.y + 10, 'text-anchor': 'end', class: 'v-badge' }, g).textContent = elementBadge(elem.type);
        }
      }
      if (elem && n.viewRefId != null) {
        // element node that also drills down to a view: separate clickable ↗ in the top-left corner
        const link = el('text', { x: b.x + 4, y: b.y + 12, class: 'v-drill-icon clickable', 'data-view': n.viewRefId }, g);
        link.textContent = '↗';
        el('title', {}, link).textContent = tr('Open view: {name}', { name: viewName?.(n.viewRefId) || '#' + n.viewRefId });
        link.addEventListener('click', ev => { ev.stopPropagation(); onOpenView?.(n.viewRefId); });
      }
    }
    if (elem) {
      g.addEventListener('click', ev => {
        ev.stopPropagation();
        if (onMark && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) onMark([elem.id], 'toggle');
        else onSelect?.('element', elem.id);
      });
    }
    if (elem && fresh?.has(elem.id)) g.classList.add('v-fresh');
    if (elem && onExpand) g.addEventListener('dblclick', ev => { ev.stopPropagation(); onExpand(elem.id); });
    if (elem && onNodeMenu) g.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); onNodeMenu(elem.id, ev, n); });
    const more = elem && badge ? badge(elem.id) : 0;
    if (more > 0) {
      // "+N" pill on the bottom-right corner: shows the related elements not in the diagram yet
      const text = `+${more}`;
      const w = 8 + text.length * 6.2, hgt = 15;
      const cx = isJunction ? b.x + b.w : b.x + b.w - 2, cy = b.y + b.h - 2;
      const pill = el('g', { class: 'v-more', 'data-expand': elem.id }, g);
      el('title', {}, pill).textContent = tr('Show {n} related element not in the diagram yet (or double-click the element; right-click for choices)|Show {n} related elements not in the diagram yet (or double-click the element; right-click for choices)', { n: more });
      el('rect', { x: cx - w / 2, y: cy - hgt / 2, width: w, height: hgt, rx: hgt / 2 }, pill);
      el('text', { x: cx, y: cy + 4, 'text-anchor': 'middle' }, pill).textContent = text;
      pill.addEventListener('click', ev => { ev.stopPropagation(); onExpand?.(elem.id); });
    }
  }

  // Routes first, then the drawing. An end of a connection is a node or, in a
  // stored view, another connection (API-9: a relationship on a relationship).
  // Such an end lies on the middle of that connection's line, so that one has
  // to be routed before; chains are resolved in passes, and a connection
  // whose end cannot be found (or that is part of a cycle) is not drawn.
  const ordered = [...connections].sort((a, b) => a.sortOrder - b.sortOrder);
  const routes = new Map(); // connection id -> points
  const endOf = (nodeId, connectionId) => {
    if (connectionId != null) return routes.has(connectionId) ? { point: middleOf(routes.get(connectionId)) } : null;
    return bounds.has(nodeId) ? { box: bounds.get(nodeId) } : null;
  };
  const centre = e => e.point || { x: e.box.x + e.box.w / 2, y: e.box.y + e.box.h / 2 };
  for (let todo = ordered, progress = true; todo.length && progress;) {
    const waiting = [];
    for (const c of todo) {
      if (c.points?.length >= 2) {
        // exact route from an automatic layout (start and end already on the node borders)
        routes.set(c.id, c.points.map(p => ({ x: p.x, y: p.y })));
        continue;
      }
      const se = endOf(c.sourceNodeId, c.sourceConnectionId), te = endOf(c.targetNodeId, c.targetConnectionId);
      if (!se || !te) { waiting.push(c); continue; }
      // stored view: explicit attachment points (absolute) win; otherwise clip towards the
      // first/last bendpoint (or the other end's centre) at the node border (LV-2)
      const bps = (c.bendpoints || []).map(p => ({ x: p.x, y: p.y }));
      const first = bps[0] || c.targetAttachment || centre(te), last = bps[bps.length - 1] || c.sourceAttachment || centre(se);
      const at = (e, attachment, towards) => (attachment ? { x: attachment.x, y: attachment.y } : e.point || clipToRect(e.box, towards.x, towards.y));
      routes.set(c.id, [at(se, c.sourceAttachment, first), ...bps, at(te, c.targetAttachment, last)]);
    }
    progress = waiting.length < todo.length;
    todo = waiting;
  }

  for (const c of ordered) {
    const pts = routes.get(c.id);
    if (!pts) continue;
    const rel = c.relationshipRefId != null ? relationshipById(c.relationshipRefId) : null;
    const st = connectionStyle(rel);
    // a relationship split at a helper dot: source decoration on the first half, head on the second
    if (c.half === 'first') st.end = null;
    if (c.half === 'second') st.start = null;
    const fade = !!faded && ((rel && faded.relationships.has(rel.id)) || fadedNodes.has(String(c.sourceNodeId)) || fadedNodes.has(String(c.targetNodeId)));
    const g = el('g', { class: 'v-conn' + (rel ? ' clickable' : '') + (fade ? ' v-faded' : ''), 'data-connection': c.id, 'data-relationship': rel?.id, 'data-src': c.sourceNodeId, 'data-tgt': c.targetNodeId,
      'data-src-connection': c.sourceConnectionId, 'data-tgt-connection': c.targetConnectionId }, gConns);
    el('title', {}, g).textContent = rel ? `${rel.type}${rel.name ? ': ' + rel.name : ''}${propsTooltip(rel)}` : (c.label || c.type);
    // spline routes (LV-6): start, then (control, control, end) triples of cubic Bézier curves
    const d = c.curve && pts.length >= 4 && (pts.length - 1) % 3 === 0
      ? `M${pts[0].x},${pts[0].y}` + pts.slice(1).map((p, i) => `${i % 3 ? ' ' : ' C'}${p.x},${p.y}`).join('')
      : 'M' + pts.map(p => `${p.x},${p.y}`).join(' L');
    el('path', { d, class: 'v-hit' }, g);
    el('path', {
      d, fill: 'none', stroke: rgb(c.style?.lineColor) || 'var(--diagram-line)', 'stroke-width': c.style?.lineWidth || 1.2,
      'stroke-opacity': opacity(c.style?.lineColor),
      'stroke-dasharray': st.dash, 'marker-start': st.start ? `url(#${markerPrefix}${st.start})` : null,
      'marker-end': st.end ? `url(#${markerPrefix}${st.end})` : null,
    }, g);
    const text = c.half === 'first' ? null : c.label || rel?.name;
    const labelFont = { ...fontAttrs(c.style?.font), fill: rgb(c.style?.font?.color) || null };
    if (text && c.labelAt) {
      // label position computed by the automatic layout
      el('text', { x: c.labelAt.x + c.labelAt.w / 2, y: c.labelAt.y + c.labelAt.h - 2, 'text-anchor': 'middle', class: 'v-text v-conn-label', ...labelFont }, g).textContent = text;
    } else if (text) {
      const mid = pts[Math.floor((pts.length - 1) / 2)], nxt = pts[Math.floor((pts.length - 1) / 2) + 1];
      el('text', { x: (mid.x + nxt.x) / 2, y: (mid.y + nxt.y) / 2 - 4, 'text-anchor': 'middle', class: 'v-text v-conn-label', ...labelFont }, g).textContent = text;
    }
    if (rel) g.addEventListener('click', ev => { ev.stopPropagation(); onSelect?.('relationship', rel.id); });
    if (rel) connMenu(g, rel.id);
    if (c.viewRefId != null) {
      // connection drill-down: single click selects the relationship, double click opens the view
      g.classList.add('clickable');
      g.dataset.view = c.viewRefId;
      g.querySelector('title').textContent += `\n${tr('Double-click to open view: {name}', { name: viewName?.(c.viewRefId) || '#' + c.viewRefId })}`;
      g.addEventListener('dblclick', ev => { ev.stopPropagation(); onOpenView?.(c.viewRefId); });
    }
  }

  // wheel zoom + drag pan on the viewBox (+ dragging nodes when onMoveNode is given)
  let cur = viewBox ? { ...viewBox } : { ...vb };
  const viewListeners = new Set(); // LV-3: the minimap follows zoom and pan
  const apply = () => {
    svg.setAttribute('viewBox', `${cur.x} ${cur.y} ${cur.w} ${cur.h}`);
    viewListeners.forEach(cb => cb());
  };
  // "Fit" shows the whole diagram, but never larger than its own size (1 unit = 1 px): a
  // diagram of one or two elements is shown at the size elements have in any other diagram,
  // in the middle of the pane, instead of filling it. Larger diagrams are shrunk to fit.
  // While fitted, the view follows the size of the pane; zooming or panning ends that.
  let fitted = !viewBox;
  const fitBox = () => {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return { ...vb };
    const s = Math.max(vb.w / r.width, vb.h / r.height, 1 / MAX_FIT_ZOOM);
    const w = r.width * s, h = r.height * s;
    return { x: vb.x + (vb.w - w) / 2, y: vb.y + (vb.h - h) / 2, w, h };
  };
  const refit = () => { cur = fitBox(); apply(); };
  if (viewBox) apply();
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (fitted) refit(); }).observe(svg);

  // node id -> ids of the node and everything nested in it (they move together)
  const subtree = new Map();
  const collect = n => { const ids = [n.id, ...(n.children || []).flatMap(collect)]; subtree.set(n.id, ids); return ids; };
  nodes.forEach(collect);
  const gOf = id => gNodes.querySelector(`[data-node="${CSS.escape(String(id))}"]`);
  svg.addEventListener('wheel', ev => {
    ev.preventDefault();
    if (fitted) { cur = fitBox(); fitted = false; }
    const r = svg.getBoundingClientRect();
    const scale = Math.min(cur.w / r.width, cur.h / r.height);
    const f = ev.deltaY > 0 ? 1.15 : 1 / 1.15;
    // keep the point under the cursor fixed (approximation for preserveAspectRatio=meet)
    const px = cur.x + (ev.clientX - r.left) * scale, py = cur.y + (ev.clientY - r.top) * scale;
    cur = { x: px - (px - cur.x) * f, y: py - (py - cur.y) * f, w: cur.w * f, h: cur.h * f };
    apply();
  }, { passive: false });
  let drag = null;
  const toDiagram = (cx, cy) => {
    const m = svg.getScreenCTM();
    return m ? new DOMPoint(cx, cy).matrixTransform(m.inverse()) : null;
  };
  svg.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    if (fitted) cur = fitBox();
    drag = { x: ev.clientX, y: ev.clientY, start: { ...cur }, moved: false };
    if (onMark && (ev.shiftKey || ev.ctrlKey || ev.metaKey)) {
      // area selection (CM-6); without moving it stays a click (toggles the element under it)
      drag.band = toDiagram(ev.clientX, ev.clientY);
      if (drag.band) ev.preventDefault();
      return;
    }
    const ng = onMoveNode && ev.target.closest?.('.v-node[data-movable]');
    if (ng) {
      // move the element (and what is nested in it); one of the selected elements moves all of
      // them (CM-6). Their connections fade until the drop re-routes them.
      const picked = ng.classList.contains('marked')
        ? [...gNodes.querySelectorAll('.v-node.marked[data-movable]')].map(g => g.dataset.node)
        : [ng.dataset.node];
      const inside = new Set(picked.flatMap(id => (subtree.get(id) || [id]).slice(1)));
      const roots = picked.filter(id => !inside.has(id));
      const set = new Set(roots.flatMap(id => subtree.get(id) || [id]));
      drag.node = roots;
      drag.groups = [...set].map(gOf).filter(Boolean);
      drag.conns = [...gConns.children].filter(c => set.has(c.dataset.src) || set.has(c.dataset.tgt));
    }
  });
  svg.addEventListener('pointermove', ev => {
    if (!drag) return;
    const r = svg.getBoundingClientRect();
    const scale = Math.max(cur.w / r.width, cur.h / r.height);
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3 && !drag.moved) {
      drag.moved = true;
      if (drag.node) { svg.classList.add('v-dragging'); drag.conns.forEach(c => c.classList.add('v-moving')); }
    }
    if (!drag.moved) return;
    try { svg.setPointerCapture(ev.pointerId); } catch { /* pointer already gone */ }
    if (drag.band) {
      const p = toDiagram(ev.clientX, ev.clientY);
      if (!p) return;
      drag.rect ??= el('rect', { class: 'v-band' }, svg);
      drag.box = { x: Math.min(p.x, drag.band.x), y: Math.min(p.y, drag.band.y), w: Math.abs(p.x - drag.band.x), h: Math.abs(p.y - drag.band.y) };
      for (const [k, v] of Object.entries({ x: drag.box.x, y: drag.box.y, width: drag.box.w, height: drag.box.h })) drag.rect.setAttribute(k, v);
    } else if (drag.node) {
      drag.dx = Math.round(dx * scale); drag.dy = Math.round(dy * scale);
      drag.groups.forEach(g => g.setAttribute('transform', `translate(${drag.dx},${drag.dy})`));
    } else {
      fitted = false; // panned
      cur = { ...drag.start, x: drag.start.x - dx * scale, y: drag.start.y - dy * scale };
      apply();
    }
  });
  let justDragged = false;
  const end = ev => {
    justDragged = !!drag?.moved;
    const d = drag;
    drag = null;
    if (d?.band) {
      d.rect?.remove();
      if (!d.moved || !d.box || ev.type === 'pointercancel') return;
      // elements whose box overlaps the area, except containers the area lies entirely within
      const a = d.box, ids = [];
      for (const n of order) {
        const b = bounds.get(n.id);
        if (n.elementRefId == null || !elementById(n.elementRefId) || !b) continue;
        const overlaps = b.x < a.x + a.w && b.x + b.w > a.x && b.y < a.y + a.h && b.y + b.h > a.y;
        const around = b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h;
        if (overlaps && !around && !ids.includes(n.elementRefId)) ids.push(n.elementRefId);
      }
      onMark(ids, 'add');
      return;
    }
    if (!d?.node || !d.moved) return;
    svg.classList.remove('v-dragging');
    if (ev.type === 'pointercancel' || (!d.dx && !d.dy)) {
      d.groups.forEach(g => g.removeAttribute('transform'));
      d.conns.forEach(c => c.classList.remove('v-moving'));
      return;
    }
    onMoveNode(d.node, d.dx, d.dy);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  // suppress the click that ends a drag
  svg.addEventListener('click', ev => { if (justDragged) { ev.stopPropagation(); justDragged = false; } }, true);
  if (onBackgroundMenu) svg.addEventListener('contextmenu', ev => { ev.preventDefault(); onBackgroundMenu(ev); });
  keyboardNodes(svg, gNodes, () => visible(), v => { fitted = false; cur = { ...v }; apply(); });

  /** Diagram area actually on screen (the viewBox widened to the element's aspect ratio, as with "meet"). */
  const visible = () => {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return { ...cur };
    const scale = Math.max(cur.w / r.width, cur.h / r.height);
    const w = r.width * scale, h = r.height * scale;
    return { x: cur.x - (w - cur.w) / 2, y: cur.y - (h - cur.h) / 2, w, h };
  };

  return {
    svg,
    bounds: () => ({ ...vb }), // the whole diagram (exports, minimap)
    view: () => (fitted ? fitBox() : { ...cur }),
    visible,
    setView: v => { fitted = false; cur = { ...v }; apply(); },
    onView: cb => { viewListeners.add(cb); return () => viewListeners.delete(cb); },
    fit: () => { fitted = true; refit(); },
    zoom: f => {
      if (fitted) { cur = fitBox(); fitted = false; }
      const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
      cur = { x: cx - cur.w * f / 2, y: cy - cur.h * f / 2, w: cur.w * f, h: cur.h * f };
      apply();
    } };
}

/**
 * EN-4: the diagram from the keyboard. The drawing is one tab stop; the arrow keys move the focus from
 * element to element (to the nearest one in that direction), Enter or Space does what a click does (the
 * details), the menu key or Shift+F10 opens its menu, + shows its related elements (as a double-click),
 * Escape gives the focus back to the drawing. An element off screen is brought into view.
 */
function keyboardNodes(svg, gNodes, visible, setView) {
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', tr('Diagram. Arrow keys: move between elements; Enter: details; menu key: actions'));
  const nodes = () => [...gNodes.querySelectorAll('.v-node[data-element][tabindex]')];
  const centre = g => { const r = g.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const DIR = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
  const nearest = (from, [dx, dy]) => {
    const a = centre(from);
    let best = null, bestScore = Infinity;
    for (const g of nodes()) {
      if (g === from) continue;
      const b = centre(g), ax = b.x - a.x, ay = b.y - a.y;
      const along = ax * dx + ay * dy, across = Math.abs(ax * dy - ay * dx);
      if (along <= 0) continue;
      const score = along + 2 * across; // straight ahead first
      if (score < bestScore) { bestScore = score; best = g; }
    }
    return best;
  };
  const first = () => nodes().sort((p, q) => { const a = centre(p), b = centre(q); return a.y - b.y || a.x - b.x; })[0];
  const show = g => {
    g.focus({ preventScroll: true });
    try { // bring it into view: the drawing scrolls by its viewBox, not by the page
      const bb = g.getBBox(), v = visible();
      if (bb.x < v.x || bb.y < v.y || bb.x + bb.width > v.x + v.w || bb.y + bb.height > v.y + v.h) {
        setView({ x: bb.x + bb.width / 2 - v.w / 2, y: bb.y + bb.height / 2 - v.h / 2, w: v.w, h: v.h });
      }
    } catch { /* not rendered */ }
  };
  const fire = (g, type) => {
    const c = centre(g);
    g.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y }));
  };
  svg.addEventListener('keydown', ev => {
    const g = ev.target.closest?.('.v-node[data-element]');
    if (DIR[ev.key]) {
      const next = g ? nearest(g, DIR[ev.key]) : first();
      if (next) show(next);
    } else if (g && (ev.key === 'Enter' || ev.key === ' ')) fire(g, 'click');
    else if (g && (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey))) fire(g, 'contextmenu');
    else if (g && ev.key === '+') fire(g, 'dblclick');
    else if (g && ev.key === 'Escape') svg.focus();
    else return;
    ev.preventDefault();
  });
}

/** Styles of the app's stylesheet that an exported diagram needs (no hover/selection states). */
const EXPORT_CSS = '.v-text{font:11px "Segoe UI",Arial,sans-serif}.v-badge{font:8px "Segoe UI",Arial,sans-serif;fill:#555}'
  + '.v-prop{font:italic 9px "Segoe UI",Arial,sans-serif;fill:#333}.v-sprite{opacity:.85}.v-hit{stroke:transparent;fill:none}'
  + '.v-conn-label{fill:#333}.v-drill-icon{font:bold 12px "Segoe UI",Arial,sans-serif;fill:#2f6fde}.v-drill-text{fill:#1d2330}'
  + '.v-node.v-focus>.v-shape{stroke-width:2.5;stroke:#1d2330}';

/**
 * Serialize an SVG element to a standalone SVG string (CSS variables resolved).
 * With `bounds` the whole diagram is exported at 1 unit = 1 px, whatever the
 * current zoom; without, the current viewBox is kept.
 */
export function svgToString(svg, { bounds = null } = {}) {
  const clone = svg.cloneNode(true);
  if (bounds) {
    clone.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
    clone.setAttribute('width', Math.ceil(bounds.w));
    clone.setAttribute('height', Math.ceil(bounds.h));
  }
  clone.removeAttribute('class'); // the app's .view-svg sizing (100 %) doesn't apply outside the page
  clone.querySelectorAll('[transform^="translate"]').forEach(g => g.closest('.v-node') && g.removeAttribute('transform'));
  clone.querySelectorAll('.diagram-selected, .v-moving, .v-fresh, .marked, .v-hl').forEach(g => g.classList.remove('diagram-selected', 'v-moving', 'v-fresh', 'marked', 'v-hl'));
  clone.querySelectorAll('.v-more, .v-band').forEach(g => g.remove()); // explorer controls are not part of the picture
  const cs = getComputedStyle(svg);
  const vars = ['--diagram-bg', '--diagram-line', '--diagram-ink'];
  let s = new XMLSerializer().serializeToString(clone);
  for (const v of vars) s = s.split(`var(${v})`).join(cs.getPropertyValue(v).trim() || '#000');
  return s.replace(/(<svg[^>]*>)/, `$1<style>${EXPORT_CSS}</style>`);
}

/** Load a standalone SVG string as an <img> (for canvas drawing). */
function svgImage(str) {
  const url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml' }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(tr('The diagram could not be converted to an image.'))); };
    img.src = url;
  });
}

/** Canvas limits that work in all current browsers (Safari/iOS are the strictest on area). */
const MAX_SIDE = 16000, MAX_AREA = 100e6;

/**
 * Rasterize the whole diagram to PNG (LV-3). `scale` 2 = sharp on high-DPI
 * screens and in documents; it is reduced automatically for very large
 * diagrams so the canvas stays within browser limits.
 * @returns {Promise<{blob: Blob, width: number, height: number, scale: number}>}
 */
export async function svgToPng(svg, { bounds, scale = 2 }) {
  const s = Math.min(scale, MAX_SIDE / bounds.w, MAX_SIDE / bounds.h, Math.sqrt(MAX_AREA / (bounds.w * bounds.h)));
  const width = Math.max(1, Math.round(bounds.w * s)), height = Math.max(1, Math.round(bounds.h * s));
  const img = await svgImage(svgToString(svg, { bounds }));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = getComputedStyle(svg).getPropertyValue('--diagram-bg').trim() || '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error(tr('The browser could not create a {width}×{height} px image.', { width, height }));
  return { blob, width, height, scale: s };
}

/**
 * Minimap (LV-3): a small overview of the whole diagram with the visible area
 * as a rectangle; click or drag in it to move the view. Shown while part of
 * the diagram is off screen (after zooming in). The overview is a picture of
 * the diagram, rendered once on first use.
 * @returns {{el: HTMLElement, destroy: Function}}
 */
export function createMinimap(layout, { maxW = 200, maxH = 150 } = {}) {
  const b = layout.bounds();
  const k = Math.min(maxW / b.w, maxH / b.h);
  const w = Math.max(40, Math.round(b.w * k)), h = Math.max(30, Math.round(b.h * k));
  const box = document.createElement('div');
  box.className = 'minimap';
  box.hidden = true;
  box.title = tr('Overview: click or drag to move the view');
  const svg = el('svg', { xmlns: NS, width: w, height: h, viewBox: `${b.x} ${b.y} ${b.w} ${b.h}`, preserveAspectRatio: 'xMidYMid meet' });
  box.appendChild(svg);
  el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'var(--diagram-bg)' }, svg);
  const picture = el('image', { x: b.x, y: b.y, width: b.w, height: b.h, preserveAspectRatio: 'none' }, svg);
  const frame = el('rect', { class: 'minimap-view', 'vector-effect': 'non-scaling-stroke' }, svg);
  let pictureUrl = null;

  const update = () => {
    const v = layout.visible();
    const all = v.x <= b.x + 1 && v.y <= b.y + 1 && v.x + v.w >= b.x + b.w - 1 && v.y + v.h >= b.y + b.h - 1;
    box.hidden = all || !box.isConnected;
    if (box.hidden) return;
    if (!pictureUrl) {
      pictureUrl = URL.createObjectURL(new Blob([svgToString(layout.svg, { bounds: b })], { type: 'image/svg+xml' }));
      picture.setAttribute('href', pictureUrl);
    }
    // the visible area, clipped to the diagram
    const x1 = Math.max(b.x, v.x), y1 = Math.max(b.y, v.y);
    const x2 = Math.min(b.x + b.w, v.x + v.w), y2 = Math.min(b.y + b.h, v.y + v.h);
    frame.setAttribute('x', x1); frame.setAttribute('y', y1);
    frame.setAttribute('width', Math.max(0, x2 - x1)); frame.setAttribute('height', Math.max(0, y2 - y1));
  };

  // centre the view on the clicked point; keep following while the button is held
  const centreAt = ev => {
    const m = svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    const cur = layout.view();
    layout.setView({ ...cur, x: p.x - cur.w / 2, y: p.y - cur.h / 2 });
  };
  let dragging = false;
  svg.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    dragging = true;
    try { svg.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    centreAt(ev);
    ev.preventDefault();
  });
  svg.addEventListener('pointermove', ev => { if (dragging) centreAt(ev); });
  const stop = () => { dragging = false; };
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointercancel', stop);
  box.addEventListener('wheel', ev => ev.stopPropagation());

  const off = layout.onView(update);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
  ro?.observe(layout.svg);
  requestAnimationFrame(update);
  return {
    el: box,
    update,
    destroy: () => { off(); ro?.disconnect(); if (pictureUrl) URL.revokeObjectURL(pictureUrl); },
  };
}
