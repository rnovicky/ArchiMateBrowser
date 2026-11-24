// PlantUML source generation (ArchiMate stdlib macros) and server URL encoding.
// Macros: https://github.com/plantuml/plantuml-stdlib/tree/master/stdlib/archimate

import { plantumlMacro, plantumlStereotype, relationshipMacro, elementColor, prettyType } from './archimate.js';
import { settings } from './config.js';
import { t } from './i18n.js';

// ---------------------------------------------------------------- encoding

/** PlantUML text -> URL-safe encoded string (raw deflate + PlantUML base64). */
export async function encodePlantUml(text) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(new TextEncoder().encode(text));
  writer.close();
  const bytes = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  return encode64(bytes);
}

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

function encode64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i], b2 = bytes[i + 1] ?? 0, b3 = bytes[i + 2] ?? 0;
    out += ALPHABET[b1 >> 2]
      + ALPHABET[((b1 & 0x3) << 4) | (b2 >> 4)]
      + ALPHABET[((b2 & 0xf) << 2) | (b3 >> 6)]
      + ALPHABET[b3 & 0x3f];
  }
  return out;
}

export async function plantumlUrl(text, format = 'svg') {
  const server = settings.plantumlServer.replace(/\/+$/, '');
  return `${server}/${format}/${await encodePlantUml(text)}`;
}

// ---------------------------------------------------------------- generation

/** Escape a label for use inside a double-quoted PlantUML macro argument. */
function q(s) {
  const text = String(s ?? '')
    .replace(/\\/g, '/')
    .replace(/"/g, "'")
    .replace(/\r?\n/g, '\\n')
    .trim();
  return `"${text}"`;
}

function header(title, direction = settings.plantumlDirection) {
  const lines = ['@startuml', '!include <archimate/Archimate>', ''];
  lines.push(direction === 'LR' ? 'left to right direction' : 'top to bottom direction');
  lines.push('skinparam wrapWidth 160', 'skinparam defaultTextAlignment center');
  // PU-5 (2.27.0): a sketch, not a finished drawing ("skinparam handwritten" is deprecated since PlantUML 1.2025)
  if (settings.plantumlSketch) lines.push('!option handwritten true');
  if (title) lines.push(`title ${String(title).replace(/\r?\n/g, ' ')}`);
  lines.push('');
  return lines;
}

/**
 * Optional decoration (see PropertyOptions.decorate):
 *   extraLabel(el) -> string|null   second label line, e.g. "domain: Finance"
 *   colour(el)     -> '#rrggbb'|null fill colour overriding the layer colour
 *   legend [[colour, text]], legendTitle
 */
const NO_DECO = { extraLabel: null, colour: null, legend: null };

function labelText(el, label, deco) {
  const text = label ?? el?.name ?? '';
  const extra = el && deco.extraLabel?.(el);
  return extra ? `${text}\n<size:9><i>${extra}</i></size>` : text;
}

function elementLine(alias, el, label, deco = NO_DECO) {
  const macro = plantumlMacro(el.type);
  const text = labelText(el, label, deco);
  if (!macro) return `rectangle ${q(text)} as ${alias}`;
  const fill = deco.colour?.(el);
  const stereo = plantumlStereotype(el.type);
  if (fill && stereo) {
    // same output as the macro, but with our own fill colour
    return el.type === 'Grouping'
      ? `folder ${q(text)} <<grouping>> as ${alias} ${fill}`
      : `archimate ${fill} ${q(text)} <<${stereo}>> as ${alias}`;
  }
  return `${macro}(${alias}, ${q(text)})`;
}

/** Opening line of an element that contains nested nodes (a PlantUML group block). */
function containerOpen(alias, el, label, deco = NO_DECO) {
  const text = labelText(el, label, deco);
  if (!el || el.type === 'Grouping') return `rectangle ${q(text)} <<Grouping>> as ${alias} #line.dashed {`;
  const color = deco.colour?.(el) || elementColor(el.type);
  // PU-4 (2.27.0): the type's ArchiMate sprite in the corner, as the stdlib's elements have it
  const stereo = plantumlStereotype(el.type);
  if (stereo) return `rectangle ${q(text)} <<$archimate/${stereo}>> as ${alias} ${color} {`;
  return `rectangle ${q(`${text}\n«${prettyType(el.type)}»`)} as ${alias} ${color} {`;
}

// Types the stdlib has no sprite for (a junction has no stereotype at all)
const NO_SPRITE = new Set(['Grouping']);

/**
 * The diagram's legend: the colours of a property (deco.legend), and with the setting plantumlLegend the
 * element types drawn, each with its sprite (PU-5, 2.27.0). One block: PlantUML draws only the last legend.
 * `types`: the element types in the diagram.
 */
function legendLines(deco, types = []) {
  const colours = (deco.legend || []).map(([colour, text]) => `<back:${colour}>      </back> ${String(text).replace(/\r?\n/g, ' ')}`);
  const kinds = settings.plantumlLegend
    ? [...new Set(types)].filter(x => plantumlStereotype(x) && !NO_SPRITE.has(x)).sort((a, b) => prettyType(a).localeCompare(prettyType(b)))
      .map(x => `<$archimate/${plantumlStereotype(x)}> ${prettyType(x)}`)
    : [];
  if (!colours.length && !kinds.length) return [];
  const lines = ['', 'legend right'];
  if (colours.length) lines.push(`<b>${deco.legendTitle || ''}</b>`, ...colours);
  if (colours.length && kinds.length) lines.push(' ');
  if (kinds.length) lines.push('<b>Element types</b>', ...kinds);
  return [...lines, 'endlegend'];
}

/** PU-5: a view's own colours as a PlantUML colour spec ("#rrggbb;line:rrggbb;text:rrggbb"), or null. */
const hex = c => (c && c.r != null ? [c.r, c.g, c.b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('') : null);
function viewColours(style) {
  const fill = hex(style?.fillColor), line = hex(style?.lineColor), text = hex(style?.font?.color);
  if (!fill && !line && !text) return null;
  const rest = [line && `line:${line}`, text && `text:${text}`].filter(Boolean).join(';');
  return fill ? `#${fill}${rest ? ';' + rest : ''}` : `#${rest}`;
}

/**
 * PU-3 (2.27.0): the arrangement of a stored view as hidden links between sibling nodes, so that PlantUML
 * keeps them in the view's rows and order: left to right within a row, row below row.
 */
function arrangementLines(siblings) {
  const placed = siblings.filter(n => n.x != null && n.y != null).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const n of placed) {
    const row = rows.at(-1);
    // a row: nodes whose middles lie within half the height of the row's first node
    if (row && Math.abs((n.y + (n.h || 0) / 2) - (row[0].y + (row[0].h || 0) / 2)) <= (row[0].h || 55) / 2) row.push(n);
    else rows.push([n]);
  }
  const lines = [];
  rows.forEach((row, i) => {
    row.sort((a, b) => a.x - b.x);
    for (let j = 1; j < row.length; j++) lines.push(`n${row[j - 1].id} -[hidden]right- n${row[j].id}`);
    if (i) lines.push(`n${rows[i - 1][0].id} -[hidden]down- n${row[0].id}`);
  });
  return lines;
}

/** `direction`: Up, Down, Left or Right, the stdlib's variant of the macro that draws it that way (PU-3). */
function relationshipLine(fromAlias, toAlias, rel, label, direction = null) {
  return `${relationshipMacro(rel)}${direction ? '_' + direction : ''}(${fromAlias}, ${toAlias}, ${q(label ?? rel.name ?? '')})`;
}

/**
 * PU-3 (2.27.0): the middle of every node of a view, in the view's coordinates. The exchange format
 * stores them absolute; a child that does not lie inside its parent was stored relative to it (as
 * js/viewsvg.js reads them).
 */
function nodeMiddles(nodes) {
  const middles = new Map();
  const walk = (list, parent) => {
    for (const n of list) {
      let { x, y } = n;
      if (x == null || y == null) { walk(n.children || [], parent); continue; }
      if (parent && !(x >= parent.x && y >= parent.y && x + n.w <= parent.x + parent.w + 1 && y + n.h <= parent.y + parent.h + 1)) {
        x += parent.x;
        y += parent.y;
      }
      middles.set(n.id, { x: x + (n.w || 0) / 2, y: y + (n.h || 0) / 2, top: y, bottom: y + (n.h || 0) });
      walk(n.children || [], { x, y, w: n.w, h: n.h });
    }
  };
  walk(nodes, null);
  return middles;
}

/**
 * The way from one node to another: sideways (Right, Left) when they are in one row (their boxes overlap
 * from top to bottom), else Down or Up; null when either is not known.
 */
function directionBetween(a, b) {
  if (!a || !b) return null;
  const oneRow = Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
  return oneRow ? (b.x >= a.x ? 'Right' : 'Left') : (b.y >= a.y ? 'Down' : 'Up');
}

// Arrow strings used by the stdlib Rel_* macros (stdlib/archimate/Archimate.puml).
const ARROWS = {
  Rel_Composition: '*--', Rel_Aggregation: 'o--', Rel_Assignment: '@-->>', Rel_Realization: '~~|>',
  Rel_Serving: '-->', Rel_Access: '~~', Rel_Access_r: '<-~', Rel_Access_w: '~->', Rel_Access_rw: '<~~>',
  Rel_Influence: '..>', Rel_Triggering: '-->>', Rel_Flow: '..>>', Rel_Specialization: '--|>',
  Rel_Association: '--', Rel_Association_dir: '--\\\\',
};

/**
 * A relationship that other relationships attach to (BR-6) is drawn in two
 * halves meeting at a small helper dot: source-side decoration (diamond,
 * dot, read arrow) on the first half, target head on the second. PlantUML
 * cannot attach a line to another line.
 */
function splitRelationshipLines(fromAlias, helperAlias, toAlias, rel) {
  const arrow = ARROWS[relationshipMacro(rel)] || '--';
  const m = /^([^-.~]*)([-.~]+)(.*)$/.exec(arrow);
  const [, head, body, tail] = m || ['', '', '--', ''];
  const label = rel.name ? ` : ${q(rel.name)}` : '';
  return [`${fromAlias} ${head}${body} ${helperAlias}`, `${helperAlias} ${body}${tail} ${toAlias}${label}`];
}

/** Small dot standing in for a relationship that is the endpoint of another relationship. */
function helperNode(alias) {
  return `circle #666666 " " as ${alias}`;
}

/**
 * Diagram of a set of elements and the relationships among them.
 * @param {object} p
 * @param {Array}  p.elements       element objects (API shape)
 * @param {Array}  p.relationships  relationship objects; only those whose endpoints are both in `elements` are drawn
 * @param {string} [p.title]
 * @param {Set<number>} [p.highlight] element ids to emphasise
 * @param {object} [p.deco]  label/colour decoration (PropertyOptions.decorate)
 * @returns {{source: string, refs: DiagramRefs}}
 *
 * @typedef {object} DiagramRefs  maps PlantUML aliases back to model items (for clickable SVG)
 * @property {Object<string, number>} entities  alias -> element id
 * @property {Object<string, number>} [relEntities]  helper-dot alias -> relationship id (relationships on relationships)
 * @property {Object<string, number>} [viewEntities]  alias -> referenced view id (drill-down nodes)
 * @property {Array<{from: string, to: string, id: number}>} links  relationship lines in source order
 */
export function diagramFromElements({ elements, relationships, title, highlight, deco = NO_DECO, nesting = null }) {
  const lines = header(title);
  const refs = { entities: {}, links: [] };
  const ids = new Set(elements.map(e => e.id));
  const sorted = [...elements].sort((a, b) => a.type.localeCompare(b.type) || (a.name || '').localeCompare(b.name || ''));

  // LV-5: with a nesting forest, children are emitted inside their parent's block
  const parentOf = nesting?.parentOf || new Map();
  const childrenOf = new Map();
  for (const el of sorted) {
    const p = parentOf.get(el.id);
    if (p != null && ids.has(p)) {
      if (!childrenOf.has(p)) childrenOf.set(p, []);
      childrenOf.get(p).push(el);
    }
  }
  const emit = (el, depth) => {
    const pad = '  '.repeat(depth);
    if (highlight?.has(el.id)) lines.push(pad + "' focus element:");
    refs.entities[`e${el.id}`] = el.id;
    const kids = childrenOf.get(el.id);
    if (kids?.length) {
      lines.push(pad + containerOpen(`e${el.id}`, el, undefined, deco));
      kids.forEach(k => emit(k, depth + 1));
      lines.push(pad + '}');
    } else {
      lines.push(pad + elementLine(`e${el.id}`, el, undefined, deco));
    }
  };
  for (const el of sorted) if (!(parentOf.get(el.id) != null && ids.has(parentOf.get(el.id)))) emit(el, 0);
  lines.push('');
  const hidden = new Set([...(nesting?.nestedRelIds || []), ...(nesting?.ancestorEdgeIds || [])]);

  // Which relationships can be drawn: element endpoints must be in the diagram,
  // relationship endpoints must themselves be drawn (closure, for chains).
  const drawn = new Map();
  const endOk = (eid, rid) => (eid != null ? ids.has(eid) : drawn.has(rid));
  let changed = true;
  while (changed) {
    changed = false;
    for (const rel of relationships) {
      if (drawn.has(rel.id)) continue;
      if (endOk(rel.sourceElementId, rel.sourceRelationshipId) && endOk(rel.targetElementId, rel.targetRelationshipId)) {
        drawn.set(rel.id, rel);
        changed = true;
      }
    }
  }
  // relationships that are an endpoint of another drawn relationship get a helper dot
  const helpers = new Set();
  for (const rel of drawn.values()) {
    if (rel.sourceRelationshipId != null) helpers.add(rel.sourceRelationshipId);
    if (rel.targetRelationshipId != null) helpers.add(rel.targetRelationshipId);
  }
  refs.relEntities = {};
  for (const id of helpers) {
    lines.push(helperNode(`r${id}`));
    refs.relEntities[`r${id}`] = id;
  }
  if (helpers.size) lines.push('');

  const alias = (eid, rid) => (eid != null ? `e${eid}` : `r${rid}`);
  for (const rel of drawn.values()) {
    if (hidden.has(rel.id)) continue; // shown as nesting (or would run inside a box)
    const from = alias(rel.sourceElementId, rel.sourceRelationshipId);
    const to = alias(rel.targetElementId, rel.targetRelationshipId);
    if (helpers.has(rel.id)) {
      const helper = `r${rel.id}`;
      lines.push(...splitRelationshipLines(from, helper, to, rel));
      refs.links.push({ from, to: helper, id: rel.id }, { from: helper, to, id: rel.id });
    } else {
      lines.push(relationshipLine(from, to, rel));
      refs.links.push({ from, to, id: rel.id });
    }
  }
  const skipped = relationships.length - drawn.size;
  if (skipped) lines.push('', `' ${skipped} relationship(s) not drawn: an endpoint is not in the diagram`);
  if (nesting?.nestedRelIds.size) lines.push(`' ${nesting.nestedRelIds.size} relationship(s) shown as nesting`);
  lines.push(...legendLines(deco, elements.map(e => e.type)));
  lines.push('', '@enduml');
  return { source: lines.join('\n'), refs };
}

/**
 * Diagram of a stored view (nodes + connections), preserving node nesting. PlantUML lays it out, kept close to
 * the view's arrangement by hidden links between siblings (PU-3), always top to bottom (the arrangement
 * says where things are); the view's colours are kept (PU-5).
 * @returns {{source: string, refs: DiagramRefs}}
 */
export function diagramFromView({ view, nodes, connections, elementById, relationshipById, deco = NO_DECO }) {
  const lines = header(view.name, 'TB');
  const refs = { entities: {}, viewEntities: {}, links: [] };
  const indent = d => '  '.repeat(d);
  const middles = nodeMiddles(nodes);
  const layout = [];
  const types = [];
  // PU-5: the node's own fill, line and text colours, unless a colour by property is chosen
  const nodeDeco = n => {
    const own = viewColours(n.style);
    return own ? { ...deco, colour: e => deco.colour?.(e) || own } : deco;
  };

  const walk = (list, depth) => {
    layout.push(...arrangementLines(list));
    for (const n of [...list].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const alias = `n${n.id}`;
      const el = n.elementRefId != null ? elementById(n.elementRefId) : null;
      const kids = n.children || [];
      if (el) { refs.entities[alias] = el.id; types.push(el.type); }
      if (n.viewRefId != null && !el) {
        // BR-8: drill-down reference to another view (Archi "diagram model reference");
        // it may contain nested nodes, in which case it becomes a container
        refs.viewEntities[alias] = n.viewRefId;
        const text = q(`↗ ${n.label || 'view'}`);
        if (kids.length) {
          lines.push(indent(depth) + `rectangle ${text} as ${alias} #f2f2f2;line:888888 {`);
          walk(kids, depth + 1);
          lines.push(indent(depth) + '}');
        } else {
          lines.push(indent(depth) + `card ${text} as ${alias} #f2f2f2;line:888888`);
        }
        continue;
      }
      if (n.type === 'Label') {
        lines.push(indent(depth) + `card ${q(n.label || '')} as ${alias}`);
        continue;
      }
      if (kids.length) {
        lines.push(indent(depth) + containerOpen(alias, el, n.label || (n.type === 'Container' ? '' : undefined), nodeDeco(n)));
        walk(kids, depth + 1);
        lines.push(indent(depth) + '}');
      } else if (el) {
        lines.push(indent(depth) + elementLine(alias, el, n.label || undefined, nodeDeco(n)));
      } else {
        lines.push(indent(depth) + `rectangle ${q(n.label || '')} as ${alias} #line.dashed`);
      }
    }
  };
  walk(nodes, 0);
  if (layout.length) lines.push('', "' the view's arrangement (PU-3)", ...layout);
  lines.push('');

  // API-9: a connection may end on another connection (a relationship on a relationship).
  // PlantUML cannot attach a line to a line, so a connection that others end on is drawn
  // in two halves that meet at a helper dot, as in the diagrams of elements (BR-6).
  const ordered = [...connections].sort((a, b) => a.sortOrder - b.sortOrder);
  const byId = new Map(ordered.map(c => [c.id, c]));
  const ended = new Set(ordered.flatMap(c => [c.sourceConnectionId, c.targetConnectionId]).filter(id => id != null && byId.has(id)));
  refs.relEntities = {};
  for (const id of ended) {
    lines.push(helperNode(`c${id}`));
    const relId = byId.get(id).relationshipRefId;
    if (relId != null) refs.relEntities[`c${id}`] = relId;
  }
  if (ended.size) lines.push('');
  const end = (nodeId, connectionId) => (connectionId != null ? (ended.has(connectionId) ? `c${connectionId}` : null) : nodeId != null ? `n${nodeId}` : null);

  for (const c of ordered) {
    const from = end(c.sourceNodeId, c.sourceConnectionId), to = end(c.targetNodeId, c.targetConnectionId);
    if (!from || !to) continue;
    const rel = c.relationshipRefId != null ? relationshipById(c.relationshipRefId) : null;
    if (rel && ended.has(c.id)) {
      const helper = `c${c.id}`;
      lines.push(...splitRelationshipLines(from, helper, to, c.label ? { ...rel, name: c.label } : rel));
      refs.links.push({ from, to: helper, id: rel.id }, { from: helper, to, id: rel.id });
    } else if (ended.has(c.id)) {
      const helper = `c${c.id}`;
      lines.push(`${from} .. ${helper}`, `${helper} .. ${to}${c.label ? ' : ' + q(c.label) : ''}`);
      refs.links.push({ from, to: helper, id: null }, { from: helper, to, id: null });
    } else if (rel) {
      // PU-3: drawn the way it goes in the view, so that it keeps the view's rows (an arrow drawn down would
      // put two elements of one row below each other)
      lines.push(relationshipLine(from, to, rel, c.label || undefined, directionBetween(middles.get(c.sourceNodeId), middles.get(c.targetNodeId))));
      refs.links.push({ from, to, id: rel.id });
    } else {
      lines.push(`${from} .. ${to}${c.label ? ' : ' + q(c.label) : ''}`);
      refs.links.push({ from, to, id: null }); // keeps link order aligned with the SVG
    }
  }
  lines.push(...legendLines(deco, types));
  lines.push('', '@enduml');
  return { source: lines.join('\n'), refs };
}

// ---------------------------------------------------------------- clickable SVG

/** URLs longer than this are not sent as a GET (PU-2): many servers and proxies refuse them. */
export const LONG_URL = 4000;

/**
 * Fetch the rendered SVG as text so it can be inlined (and made clickable).
 * Throws when the server is unreachable or does not allow CORS.
 */
export async function fetchPlantUmlSvg(url, { source = null, fetchFn = fetch } = {}) {
  let res = null;
  if (source != null && url.length > LONG_URL) {
    // PU-2 (2.27.0): a long diagram is sent in the body of a POST (servers and proxies refuse long URLs). The
    // PlantUML server (plantuml-server, as plantuml.com) takes the text at <server>/svg; PlantUML's own small
    // server (java -jar plantuml.jar -picoweb) takes JSON at /render, and redirects a POST to /svg to a fixed
    // image. Whichever answers with an SVG; the long GET last.
    const base = url.slice(0, url.lastIndexOf('/'));
    const attempts = [
      () => fetchFn(base, { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: source }),
      // sent as text/plain: a JSON content type would make the browser ask first (CORS), which PicoWeb redirects
      () => fetchFn(new URL('/render', base).href, {
        method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: JSON.stringify({ source, options: ['-tsvg'] }) }),
    ];
    for (const attempt of attempts) {
      try {
        const answer = await attempt();
        if ((answer.headers.get('content-type') || '').includes('svg')) { res = answer; break; }
      } catch { /* the next way */ }
    }
  }
  res ??= await fetchFn(url);
  const type = res.headers.get('content-type') || '';
  // PlantUML answers syntax errors with HTTP 400 *and* an SVG describing the error
  if (!type.includes('svg')) throw new Error(t('PlantUML server returned {status} {text}', { status: res.status, text: res.statusText }));
  return res.text();
}

/** Parse SVG text and strip anything executable (the SVG comes from a remote server). */
export function parseSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName !== 'svg' || doc.querySelector('parsererror')) throw new Error(t('Invalid SVG from PlantUML server'));
  doc.querySelectorAll('script, foreignObject, iframe, object, embed').forEach(n => n.remove());
  for (const n of doc.querySelectorAll('*')) {
    for (const a of [...n.attributes]) {
      const v = a.value.trim().toLowerCase();
      if (a.name.startsWith('on') || ((a.name === 'href' || a.name === 'xlink:href') && v.startsWith('javascript:'))) n.removeAttribute(a.name);
    }
  }
  return document.importNode(svg, true);
}

/**
 * Annotate an inlined PlantUML SVG with model references.
 * PlantUML (≥ 1.2023) emits `<g class="entity|cluster" data-qualified-name="a.b.alias" id="ent0001">`
 * and `<g class="link" data-entity-1="ent0001" data-entity-2="ent0002">` in source order.
 * Links are matched to relationship lines per (from, to) pair, in order, so
 * parallel relationships between the same two elements map correctly.
 * Sets `data-element` / `data-relationship` on the matching groups and returns how many were mapped.
 */
export function annotateSvg(svg, refs) {
  const aliasOfGroupId = {};
  let mapped = 0;
  for (const g of svg.querySelectorAll('g.entity[data-qualified-name], g.cluster[data-qualified-name]')) {
    const alias = g.dataset.qualifiedName.split('.').pop();
    aliasOfGroupId[g.id] = alias;
    const elementId = refs?.entities?.[alias];
    const relId = refs?.relEntities?.[alias];   // helper dot of a relationship (BR-6)
    const viewId = refs?.viewEntities?.[alias]; // drill-down reference (BR-8)
    if (elementId != null) g.dataset.element = elementId;
    else if (relId != null) g.dataset.relationship = relId;
    else if (viewId != null) { g.dataset.view = viewId; g.classList.add('puml-drill'); }
    if (elementId != null || relId != null || viewId != null) { g.classList.add('puml-clickable'); mapped++; }
  }
  const queues = new Map();
  for (const l of refs?.links || []) {
    const key = `${l.from}>${l.to}`;
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(l.id);
  }
  for (const g of svg.querySelectorAll('g.link[data-entity-1]')) {
    // note: dataset can't be used here — "data-entity-1" is not camel-cased (digit after dash)
    const from = aliasOfGroupId[g.getAttribute('data-entity-1')], to = aliasOfGroupId[g.getAttribute('data-entity-2')];
    const q = queues.get(`${from}>${to}`) || queues.get(`${to}>${from}`);
    const id = q?.shift();
    if (id != null) {
      g.dataset.relationship = id;
      g.classList.add('puml-clickable');
      mapped++;
      // thin 1px arrows are hard to hit: add an invisible wide stroke along the line
      const line = g.querySelector('path');
      if (line) {
        const hit = line.cloneNode(false);
        hit.removeAttribute('id');
        hit.setAttribute('style', 'stroke:transparent;stroke-width:10;fill:none');
        hit.setAttribute('class', 'puml-hit');
        g.appendChild(hit);
      }
    }
  }
  return mapped;
}
